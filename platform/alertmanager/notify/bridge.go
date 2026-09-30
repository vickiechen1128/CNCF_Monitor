package notify

import (
	"crypto/subtle"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 桥端点错误（handler 映射为统一 errorType）。
var (
	// ErrBridgeUnauthorized 内网调用令牌缺失或非法。
	ErrBridgeUnauthorized = errors.New("内网调用令牌缺失或非法")
	// ErrBridgeTargetURLRejected 请求方传入了目标地址参数（SSRF 硬约束：一律拒绝）。
	ErrBridgeTargetURLRejected = errors.New("本端点不接受请求方传入的目标地址，请使用平台内已登记的 channel ID")
	// ErrBridgeChannelInvalid channel 参数非法（非平台内已登记的渠道 ID）。
	ErrBridgeChannelInvalid = errors.New("channel 参数非法（须为平台内已登记的渠道 ID，不接受目标地址）")
	// ErrBridgeTemplateInvalid template 参数非法（非平台内已登记的模板 ID）。
	ErrBridgeTemplateInvalid = errors.New("template 参数非法（须为平台内已登记的模板 ID）")
	// ErrBridgeChannelDisabled 通知渠道已禁用。
	ErrBridgeChannelDisabled = errors.New("通知渠道已禁用")
	// ErrBridgeTemplateMismatch 模板适用渠道类型与渠道类型不一致。
	ErrBridgeTemplateMismatch = errors.New("模板适用渠道类型与渠道类型不一致")
)

// BridgeConfig 是通知渲染桥运行配置。
type BridgeConfig struct {
	// Token 是内网调用令牌；为空表示未启用（桥端点一律 401）。
	Token string
	// Location 是渲染显示时区；nil → DefaultRenderLocation（东八区固定偏移）。
	Location *time.Location
}

// forbiddenTargetParams 是桥端点显式拒绝的「请求方自带上游目标地址」查询参数
// （SSRF 硬约束：目标只能由服务端按 channel ID 从 DB 解析）。含用户自建脚本的
// ?fsurl= 形态，给出明确拒绝而非静默忽略。
var forbiddenTargetParams = []string{"url", "target", "webhook_url", "fsurl", "to", "dst", "endpoint"}

// bridgeLogf 是结构化发送日志钩子（默认写日志；测试可替换以断言）。仅记录渠道 /
// 模板 / 状态 / 结果与错误，绝不记录 webhook 明文地址或 secret。
var bridgeLogf = func(format string, args ...interface{}) { log.Printf(format, args...) }

// BridgeHandler 处理 POST /api/v1/webhooks/notify：AM 投递 → 按模板渲染 → 转投
// 平台内已登记的渠道。端点不属平台用户认证态（调用方为中心 Alertmanager），
// 由内网调用令牌鉴权。SSRF 硬约束：目标地址只由服务端从 DB 解析，绝不接受
// 请求方传入；幂等——无状态渲染转发，不落告警业务表，仅记结构化发送日志。
//
// 令牌传输面（H-1）：令牌经 `Authorization: Bearer <token>` 请求头承载，**不经 URL
// query**——gin 全局 Logger 会把 RawQuery 明文落访问日志，令牌入 query 即等于外泄。
// AM 侧由 `webhook_configs.http_config.authorization` 注入。
func BridgeHandler(db *gorm.DB, cfg BridgeConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 鉴权：内网调用令牌（Authorization 头）。未配置 / 缺失 / 不匹配 → 401。
		if !bridgeTokenValid(cfg.Token, bearerToken(c.Request)) {
			bridgeLogf("[notify-bridge] reject: unauthorized remote=%s", c.ClientIP())
			response.Unauthorized(c, ErrBridgeUnauthorized.Error())
			return
		}
		// SSRF 硬约束 1：拒绝任何请求方传入的目标地址参数。
		for _, p := range forbiddenTargetParams {
			if c.Query(p) != "" {
				bridgeLogf("[notify-bridge] reject: request-supplied target url param=%q", p)
				response.BadRequest(c, ErrBridgeTargetURLRejected)
				return
			}
		}
		// SSRF 硬约束 2：channel 必须是平台内已登记的 ID（不接受地址）。
		channelID, err := parseUintQuery(c.Query("channel"))
		if err != nil {
			response.BadRequest(c, ErrBridgeChannelInvalid)
			return
		}
		ch, err := GetChannel(db, channelID)
		if err != nil {
			if errors.Is(err, ErrChannelNotFound) {
				response.NotFound(c, err.Error())
			} else {
				response.InternalServerError(c, err)
			}
			return
		}
		if !ch.Enabled {
			response.BadRequest(c, ErrBridgeChannelDisabled)
			return
		}
		// 模板：显式 template ID（须同渠道类型），省略则用该渠道类型的内置默认模板。
		tpl, err := resolveBridgeTemplate(db, ch, c.Query("template"))
		if err != nil {
			respondBridgeTemplateError(c, err)
			return
		}
		// 载荷解码（AM 原生 webhook JSON）。
		raw, err := io.ReadAll(c.Request.Body)
		if err != nil {
			response.BadRequest(c, fmt.Errorf("读取请求体失败: %w", err))
			return
		}
		payload, err := decodeWebhook(raw)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		// 网域归一（M08 §10.2 与前端告警列表口径一致）：把写入侧 network_domain_id
		// 经 ResolveNetworkDomain 归一为消费侧 network_domain 并回写进标签，使飞书卡片
		// 「网域」字段显示与前端列表一致（不再读不存在的 zone）。
		for i := range payload.Alerts {
			payload.Alerts[i].Labels = models.EnsureNetworkDomain(
				payload.Alerts[i].Labels,
				models.ResolveNetworkDomain(payload.Alerts[i].Labels),
			)
		}
		// 渲染（时间按渲染时区本地化）。
		body, err := Render(tpl.Content, payload, cfg.Location)
		if err != nil {
			bridgeLogf("[notify-bridge] render failed channel=%d template=%d err=%v", ch.ID, tpl.ID, err)
			response.BadRequest(c, err)
			return
		}
		// 出站转投：目标来自 DB（ch.WebhookURL），非请求方。
		status, err := sendOutbound(c.Request.Context(), ch.WebhookURL, body)
		if err != nil {
			bridgeLogf("[notify-bridge] send failed channel=%d type=%s template=%d alerts=%d http_status=%d err=%v",
				ch.ID, ch.Type, tpl.ID, len(payload.Alerts), status, err)
			// 返回非 2xx，令 AM 视为投递失败并重试，避免静默丢失。
			response.BadGateway(c, err, "通知渠道发送失败，请检查渠道机器人地址与平台出站网络")
			return
		}
		bridgeLogf("[notify-bridge] send ok channel=%d type=%s template=%d status=%s alerts=%d",
			ch.ID, ch.Type, tpl.ID, payload.Status, len(payload.Alerts))
		response.OK(c, gin.H{
			"success":     1,
			"fail":        0,
			"channel":     strconv.FormatUint(uint64(ch.ID), 10),
			"template":    strconv.FormatUint(uint64(tpl.ID), 10),
			"alert_count": len(payload.Alerts),
		})
	}
}

// RegisterBridgeRoutes 挂载平台内置渲染桥 POST /api/v1/webhooks/notify 到 v1 组。
// 该端点不属平台用户认证态（调用方为中心 Alertmanager），由 BridgeHandler 自校验
// 内网调用令牌；装配方须把 "/api/v1/webhooks/" 加入 auth.PublicPathPrefixes 以豁免
// 全局用户认证（main.setupRouter 已接线）。
func RegisterBridgeRoutes(v1 *gin.RouterGroup, db *gorm.DB, cfg BridgeConfig) {
	v1.POST("/webhooks/notify", BridgeHandler(db, cfg))
}

// bridgeTokenValid 常量时间比较内网调用令牌，避免时序侧信道；任一侧为空视为非法。
func bridgeTokenValid(expected, got string) bool {
	if expected == "" || got == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(got)) == 1
}

// bearerToken 从 Authorization 请求头解析 `Bearer <token>`（H-1）。缺失 / 非 Bearer
// 前缀 / 空令牌均返回空串（由 bridgeTokenValid 判为未授权）。前缀按 RFC 6750 大小写不敏感。
func bearerToken(r *http.Request) string {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || !strings.EqualFold(h[:len(prefix)], prefix) {
		return ""
	}
	return strings.TrimSpace(h[len(prefix):])
}

// parseUintQuery 解析查询参数为无符号 ID；非法或 0 返回错误。
func parseUintQuery(s string) (uint, error) {
	n, err := strconv.ParseUint(s, 10, 32)
	if err != nil || n == 0 {
		return 0, fmt.Errorf("非法 ID: %q", s)
	}
	return uint(n), nil
}

// resolveBridgeTemplate 解析渲染模板，优先级（设计提案 notify-template-channel-binding.md §5.2）：
//  1. 显式 `?template=`（须与渠道类型一致，非法/不符仍报错——这是调用方显式指定，不静默降级）；
//  2. 渠道绑定 `default_template_id`（渠道 ↔ 模板一等绑定，dev-feedback #30）；
//  3. 该渠道类型的内置默认模板（零配置 Happy Path）。
//
// 第 2 级**优雅回落**：绑定模板被删 / 类型不符 / 脏数据时记 warning 并回落内置默认，**不返回错误**
// ——绑定是「便利覆盖」，其失效不应让该渠道的告警整体投递失败（AM 会无限重试 400）。
func resolveBridgeTemplate(db *gorm.DB, ch *models.NotifyChannel, rawID string) (*models.NotifyTemplate, error) {
	if rawID != "" {
		tplID, err := parseUintQuery(rawID)
		if err != nil {
			return nil, ErrBridgeTemplateInvalid
		}
		tpl, err := GetTemplate(db, tplID)
		if err != nil {
			return nil, err
		}
		if tpl.ChannelType != ch.Type {
			return nil, ErrBridgeTemplateMismatch
		}
		return tpl, nil
	}
	if ch.DefaultTemplateID != nil && *ch.DefaultTemplateID != 0 {
		tpl, err := GetTemplate(db, *ch.DefaultTemplateID)
		if err == nil && tpl.ChannelType == ch.Type {
			return tpl, nil
		}
		bridgeLogf("[notify-bridge] channel=%d bound template=%d invalid, fallback to builtin: %v",
			ch.ID, *ch.DefaultTemplateID, err)
	}
	return BuiltinTemplateForType(db, string(ch.Type))
}

// respondBridgeTemplateError 将模板解析错误映射为统一响应。
func respondBridgeTemplateError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrTemplateNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrBridgeTemplateInvalid), errors.Is(err, ErrBridgeTemplateMismatch),
		errors.Is(err, ErrTemplateBuiltinMissing):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}