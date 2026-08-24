package domain

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// RegisterRoutes 将 Module_09 网域监控纳管端点挂到 /api/v2/platform 子组：
//   - POST   /network-domains/:id/monitor     纳管
//   - PUT    /network-domains/:id/monitor     更新纳管参数（含 unmonitor）
//   - POST   /network-domains/:id/reset-token 重置 agent_pull token
//
// GET /network-domains 列表主实现见 Module_06（networkdomain 包）；本模块仅
// 依赖模型 AfterFind 使列表自动携带 token_masked / is_monitored（契约 §6.1）。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	platform.POST("/network-domains/:id/monitor", MonitorDomainHandler(db))
	platform.PUT("/network-domains/:id/monitor", UpdateDomainMonitoringHandler(db))
	platform.POST("/network-domains/:id/reset-token", ResetTokenHandler(db))
}

// MonitorDomainHandler 处理 POST /api/v2/platform/network-domains/:id/monitor。
func MonitorDomainHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var p MonitorParams
		if err := c.ShouldBindJSON(&p); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		outcome, err := MonitorDomain(db, c.Param("id"), p)
		if err != nil {
			respondDomainError(c, err)
			return
		}
		response.OK(c, gin.H{
			"domain":       outcome.Domain,
			"token":        outcome.Token,
			"token_masked": models.TokenMasked(outcome.Token),
		})
	}
}

// UpdateDomainMonitoringHandler 处理 PUT /api/v2/platform/network-domains/:id/monitor。
func UpdateDomainMonitoringHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var p UpdateParams
		if err := c.ShouldBindJSON(&p); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		dom, err := UpdateDomainMonitoring(db, c.Param("id"), p)
		if err != nil {
			respondDomainError(c, err)
			return
		}
		response.OK(c, dom)
	}
}

// ResetTokenHandler 处理 POST /api/v2/platform/network-domains/:id/reset-token。
func ResetTokenHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		res, err := ResetDomainToken(db, c.Param("id"))
		if err != nil {
			respondDomainError(c, err)
			return
		}
		response.OK(c, res)
	}
}

// respondDomainError 将服务层 sentinel 错误映射为统一响应（not_found / bad_request）。
func respondDomainError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrAlreadyMonitored),
		errors.Is(err, ErrNotMonitored),
		errors.Is(err, ErrInvalidAgentType),
		errors.Is(err, ErrResetNotAgentPull),
		errors.Is(err, ErrResetRequiresMonitored):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}