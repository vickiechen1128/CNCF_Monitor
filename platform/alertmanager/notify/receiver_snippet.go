package notify

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrReceiverNameInvalid 接收人名称覆盖值非法（sanitize 后为空，无法作为 AM receiver 名）。
var ErrReceiverNameInvalid = errors.New("接收人名称非法（仅允许字母/数字，请提供可用的接收人名）")

// receiverSnippetTokenPlaceholder 是桥令牌未配置时片段与 URL 中的醒目占位符
// （保证片段可被用户直接粘贴，但明确提示先配置令牌，而非伪造一个必失败的真令牌）。
const receiverSnippetTokenPlaceholder = "<未配置桥令牌>"

// receiverNamePattern 匹配非 [a-z0-9] 连续片段，用于归一为单个 '-'。
var receiverNamePattern = regexp.MustCompile(`[^a-z0-9]+`)

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
	// URL 是桥地址：必带真实数字 channel ID + 令牌（未配置令牌时为占位符）。
	URL string `json:"url"`
	// Snippet 是可直接粘进 alertmanager.yml receivers: 段的 YAML 片段。
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

// sanitizeReceiverName 由渠道名生成合法 AM receiver 名：转小写、非 [a-z0-9] 字符归一
// 为 '-'、压缩连续 '-'、去首尾 '-'；结果可为空（调用方负责回落 notify-<id> 或报错）。
func sanitizeReceiverName(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	s = receiverNamePattern.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

// BuildReceiverSnippet 由渠道生成接收人配置片段（纯计算、无副作用、不下发请求）：
// receiver 名由渠道名 sanitize（可用 nameOverride 覆盖，二者均做同样 sanitize + 非空校验）；
// 桥 URL 携带真实数字 channel ID 与令牌（令牌未配置时用占位符）；片段为可直接粘进
// alertmanager.yml receivers: 段的 YAML（含 webhook_configs / send_resolved: true）。
// 目标地址恒由服务端按 channel ID 拼装，绝不接受调用方传入（SSRF 硬约束）。
func BuildReceiverSnippet(ch *models.NotifyChannel, nameOverride string, cfg ReceiverSnippetConfig) (ReceiverSnippet, error) {
	if cfg.BridgeURL == "" {
		return ReceiverSnippet{}, errors.New("服务端监听地址未配置，无法生成桥地址")
	}
	name := sanitizeReceiverName(ch.Name)
	if strings.TrimSpace(nameOverride) != "" {
		name = sanitizeReceiverName(nameOverride)
		if name == "" {
			return ReceiverSnippet{}, ErrReceiverNameInvalid
		}
	}
	if name == "" {
		name = "notify-" + strconv.FormatUint(uint64(ch.ID), 10)
	}
	rawURL := buildBridgeURL(cfg.BridgeURL, ch.ID, cfg.BridgeToken)
	return ReceiverSnippet{
		ReceiverName:    name,
		URL:             rawURL,
		Snippet:         buildReceiverSnippetYAML(name, rawURL),
		TokenConfigured: cfg.BridgeToken != "",
	}, nil
}

// buildBridgeURL 拼桥地址：参数名（channel / token）与语义必须与 bridge.go 的
// c.Query 解析口径严格一致；channel 用真实数字 ID。令牌未配置时用醒目占位符（保持
// 可读，不做百分号转义），已配置时按查询参数转义。
func buildBridgeURL(baseURL string, channelID uint, token string) string {
	tokenValue := token
	if tokenValue == "" {
		tokenValue = receiverSnippetTokenPlaceholder
	} else {
		tokenValue = url.QueryEscape(tokenValue)
	}
	return strings.TrimRight(baseURL, "/") + "/api/v1/webhooks/notify?channel=" +
		strconv.FormatUint(uint64(channelID), 10) + "&token=" + tokenValue
}

// buildReceiverSnippetYAML 生成可粘进 receivers: 段的 YAML 片段（列表项相对 receivers:
// 缩进 2 空格）；url 以单引号包裹并转义内部单引号，receiver 名已 sanitize 为安全字符集。
func buildReceiverSnippetYAML(name, rawURL string) string {
	escaped := strings.ReplaceAll(rawURL, "'", "''")
	var b strings.Builder
	b.WriteString("  - name: " + name + "\n")
	b.WriteString("    webhook_configs:\n")
	b.WriteString("      - url: '" + escaped + "'\n")
	b.WriteString("        send_resolved: true\n")
	return b.String()
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
