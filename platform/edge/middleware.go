// Package edge 实现 Module_11 中心侧 edge 协议：Agent 心跳上报（POST /edge/heartbeat）
// 与配置包拉取（GET /edge/config）。
//
// 鉴权（D1）：edge 协议 outbound-only，Agent 非平台用户，故本包不走全局平台用户
// auth，而是用独立 edge-token 中间件校验「network_domain_id + Bearer token」是否
// 与 NetworkDomain.token 匹配。local 通道网域在 demo 期只读展示、不走 edge 协议，
// 中间件直接拒绝。
// 参见 docs/02-product-requirements/Modules/Module_11_Edge_Access_and_Agent_Delivery.md
//
//	§6.1 接口可达性与地址约束 / §6.2 心跳与配置检查 / §6.3 配置包拉取。
package edge

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"

	"gorm.io/gorm"
)

// ContextDomainKey 是 gin context 中存放已鉴权 *models.NetworkDomain 的键。
const ContextDomainKey = "edgeDomain"

// bearerToken 从 Authorization 头解析 "Bearer <token>"。
func bearerToken(c *gin.Context) string {
	h := c.GetHeader("Authorization")
	if h == "" {
		return ""
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

// domainIDFromRequest 解析请求中携带的网域标识：GET /edge/config 用 query
// `network_domain`；POST /edge/heartbeat 用请求体 `network_domain_id`。读请求体
// 时先整体读出再恢复，保证后续 handler 仍可 ShouldBindJSON。
func domainIDFromRequest(c *gin.Context) string {
	if id := c.Query("network_domain"); id != "" {
		return id
	}
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return ""
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(raw))
	var body struct {
		NetworkDomainID string `json:"network_domain_id"`
	}
	_ = json.Unmarshal(raw, &body)
	return body.NetworkDomainID
}

// EdgeTokenMiddleware 校验 edge 请求的网络域身份：network_domain_id + Bearer token
// 必须匹配 NetworkDomain.token；local 通道网域拒走 edge 协议。
//
//   - 缺失 network_domain_id 或 token、网域不存在、token 不匹配 → 401（UNAUTHORIZED）
//   - channel == local → 409（语义不适用，见 PRD §9.2）
func EdgeTokenMiddleware(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := bearerToken(c)
		domainID := domainIDFromRequest(c)
		if domainID == "" || token == "" {
			response.Unauthorized(c, "edge identity (network_domain_id and Bearer token) required")
			c.Abort()
			return
		}

		var dom models.NetworkDomain
		err := db.Where("id = ?", domainID).First(&dom).Error
		if err != nil {
			response.Unauthorized(c, "unknown network domain")
			c.Abort()
			return
		}
		if !tokenMatches(dom.Token, token) {
			response.Unauthorized(c, "invalid edge token")
			c.Abort()
			return
		}
		if dom.Channel == models.ChannelTypeLocal {
			response.Conflict(c, errors.New("local channel domain does not use the edge protocol"))
			c.Abort()
			return
		}

		c.Set(ContextDomainKey, &dom)
		c.Next()
	}
}

// tokenMatches 常量时间比较 token，避免时序侧信道。
func tokenMatches(expect, got string) bool {
	if len(expect) != len(got) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expect), []byte(got)) == 1
}
