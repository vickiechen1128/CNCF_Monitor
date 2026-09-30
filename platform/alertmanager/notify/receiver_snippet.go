package notify

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrReceiverNameInvalid 接收人名称覆盖值非法（sanitize 后为空，无法作为 AM receiver 名）。
var ErrReceiverNameInvalid = errors.New("接收人名称非法（仅允许字母/数字，请提供可用的接收人名）")

// receiverSnippetTokenPlaceholder 是桥令牌未配置时片段 http_config.authorization.credentials
// 中的醒目占位符（保证片段可被用户直接粘贴，但明确提示先配置令牌，而非伪造一个必失败的真令牌）。
const receiverSnippetTokenPlaceholder = "<未配置桥令牌>"

// ReceiverSnippetConfig 是「生成接收人配置片段」端点所需的运行配置：桥基础地址
// （由服务端监听地址推导，禁止硬编码）与桥内网调用令牌（为空时片段用占位符）。
type ReceiverSnippetConfig struct {
	// BridgeURL 是桥端点基础地址（形如 http://127.0.0.1:8080，不含路径）。
	BridgeURL string
	// BridgeToken 是桥内网调用令牌；为空表示未配置（片段用占位符、token_configured=false）。
	BridgeToken string
}

// ReceiverSnippet 是「生成接收人配置片段」端点的响应 data（可直接粘贴的 receiver 片段）。
type ReceiverSnippet struct {
	// ReceiverName 是建议的 AM receiver 名（已 sanitize，可直接使用）。
	ReceiverName string `json:"receiver_name"`
	// URL 是桥地址：只带真实数字 channel ID（渠道绑定了模板时附 `&template=<ID>`），
	// **不含令牌**（H-1：令牌走 Authorization 头）。
	URL string `json:"url"`
	// Snippet 是可直接粘进 alertmanager.yml receivers: 段的 YAML 片段（含 http_config.authorization）。
	Snippet string `json:"snippet"`
	// TokenConfigured 表示桥令牌是否已配置（false 时片段使用占位符，UI 需据此告警）。
	TokenConfigured bool `json:"token_configured"`
}

// DeriveBridgeBaseURL 由 metric-center 监听地址推导通知渲染桥基础地址（供接收人片段
// 拼桥 URL）。监听主机为空 / 通配（0.0.0.0 / ::）时回落回环地址 127.0.0.1（AM 与
// metric-center 同机部署，片段由用户粘进本机 alertmanager.yml）；端口缺失返回错误，
// 避免拼出不可达地址。
func DeriveBridgeBaseURL(listenAddr string) (string, error) {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return "", fmt.Errorf("解析监听地址 %q: %w", listenAddr, err)
	}
	if port == "" {
		return "", fmt.Errorf("监听地址 %q 缺少端口", listenAddr)
	}
	switch host {
	case "", "0.0.0.0", "::":
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port), nil
}

// sanitizeReceiverName 由渠道名生成合法 AM receiver 名；委托 models.SanitizeReceiverName
// 单一实现（决策 74 定稿第 1 条：物化侧 receiver 名必须与此同源，禁止两处各写一份）。
// 结果可为空（调用方负责回落 notify-<id> 或报错）。
func sanitizeReceiverName(raw string) string {
	return models.SanitizeReceiverName(raw)
}

// BuildReceiverSnippet 由渠道生成接收人配置片段（纯计算、无副作用、不下发请求）：
// receiver 名由渠道名 sanitize（可用 nameOverride 覆盖，二者均做同样 sanitize + 非空校验），
// 空则回落 notify-<id>（同源 models.ReceiverName）；桥 URL 只带真实数字 channel ID，
// 令牌写入片段的 http_config.authorization（H-1：不落 URL query；未配置时用占位符）。
// 片段为可直接粘进 alertmanager.yml receivers: 段的 YAML（含 webhook_configs /
// send_resolved: true）。目标地址恒由服务端按 channel ID 拼装，绝不接受调用方传入（SSRF 硬约束）。
func BuildReceiverSnippet(ch *models.NotifyChannel, nameOverride string, cfg ReceiverSnippetConfig) (ReceiverSnippet, error) {
	if cfg.BridgeURL == "" {
		return ReceiverSnippet{}, errors.New("服务端监听地址未配置，无法生成桥地址")
	}
	name := ch.ReceiverName()
	if strings.TrimSpace(nameOverride) != "" {
		name = sanitizeReceiverName(nameOverride)
		if name == "" {
			return ReceiverSnippet{}, ErrReceiverNameInvalid
		}
	}
	rawURL := buildBridgeURL(cfg.BridgeURL, ch)
	credentials := cfg.BridgeToken
	if credentials == "" {
		credentials = receiverSnippetTokenPlaceholder
	}
	return ReceiverSnippet{
		ReceiverName:    name,
		URL:             rawURL,
		Snippet:         buildReceiverSnippetYAML(name, rawURL, credentials),
		TokenConfigured: cfg.BridgeToken != "",
	}, nil
}

// buildBridgeURL 拼桥地址：只带 channel 参数（真实数字 ID）；渠道绑定了通知模板时追加
// `&template=<真实数字 ID>`（渠道 ↔ 模板一等绑定，dev-feedback #30）；令牌不经 query 传递
// （H-1）。参数名与语义必须与 bridge.go 的 c.Query("channel") / c.Query("template") 解析
// 口径严格一致，且与 M09 物化（configcenter/generator/notify_receivers.go）同源。
func buildBridgeURL(baseURL string, ch *models.NotifyChannel) string {
	u := strings.TrimRight(baseURL, "/") + "/api/v1/webhooks/notify?channel=" +
		strconv.FormatUint(uint64(ch.ID), 10)
	if ch.DefaultTemplateID != nil && *ch.DefaultTemplateID != 0 {
		u += "&template=" + strconv.FormatUint(uint64(*ch.DefaultTemplateID), 10)
	}
	return u
}

// buildReceiverSnippetYAML 生成可粘进 receivers: 段的 YAML 片段（列表项相对 receivers:
// 缩进 2 空格）；url 与 credentials 以单引号包裹并转义内部单引号，receiver 名已 sanitize
// 为安全字符集。令牌经 http_config.authorization（type: Bearer）承载，不落 URL query（H-1）。
func buildReceiverSnippetYAML(name, rawURL, credentials string) string {
	var b strings.Builder
	b.WriteString("  - name: " + name + "\n")
	b.WriteString("    webhook_configs:\n")
	b.WriteString("      - url: '" + escapeSingleQuotes(rawURL) + "'\n")
	b.WriteString("        send_resolved: true\n")
	b.WriteString("        http_config:\n")
	b.WriteString("          authorization:\n")
	b.WriteString("            type: Bearer\n")
	b.WriteString("            credentials: '" + escapeSingleQuotes(credentials) + "'\n")
	return b.String()
}

// escapeSingleQuotes 转义 YAML 单引号字符串中的内部单引号（'' 表示一个 '）。
func escapeSingleQuotes(s string) string {
	return strings.ReplaceAll(s, "'", "''")
}

// ReceiverSnippetHandler 处理 GET /api/v2/platform/alertmanager/notify-channels/{id}/receiver-snippet：
// 按渠道 ID 生成可直接粘贴的 receiver YAML 片段（内嵌真实 channel ID 与桥令牌）。
// 只读生成：不落库、不下发任何请求；目标地址恒由服务端解析，不接受调用方传入。
func ReceiverSnippetHandler(db *gorm.DB, cfg ReceiverSnippetConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := parseID(c)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		ch, err := GetChannel(db, id)
		if err != nil {
			respondChannelError(c, err)
			return
		}
		snippet, err := BuildReceiverSnippet(ch, c.Query("receiver_name"), cfg)
		if err != nil {
			respondChannelError(c, err)
			return
		}
		response.OK(c, snippet)
	}
}
