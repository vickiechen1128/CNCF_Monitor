package deployment

import (
	"errors"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// queryPage 解析 page/page_size，带默认与上限（与 draft 包口径一致，上限 100）。
func queryPage(c *gin.Context) (page, pageSize int) {
	page = 1
	pageSize = 20
	if v := c.Query("page"); v != "" {
		fmt.Sscanf(v, "%d", &page)
	}
	if v := c.Query("page_size"); v != "" {
		fmt.Sscanf(v, "%d", &pageSize)
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

// RegisterRoutes 将 Module_09 配置版本与下发记录端点挂到 /api/v2/platform 子组：
//   - GET  /config-versions                   配置版本列表（网域 + change_no + 分页）
//   - GET  /config-versions/:id               配置版本详情（供 diff）
//   - GET  /deployments                       下发记录列表（网域 + status + change_no + 分页）
//   - POST /deployments/:deployment_id/retry      重试（仅 local + 原记录 failed）
//   - POST /deployments/:config_version_id/rollback 回滚（目标版本存在且同网域 local）
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	platform.GET("/config-versions", ListVersionsHandler(db))
	platform.GET("/config-versions/:id", GetVersionHandler(db))
	platform.GET("/deployments", ListDeploymentsHandler(db))
	platform.POST("/deployments/:id/retry", RetryDeploymentHandler(db))
	platform.POST("/deployments/:id/rollback", RollbackDeploymentHandler(db))
}

// ListVersionsHandler 处理 GET /api/v2/platform/config-versions。
func ListVersionsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, pageSize := queryPage(c)
		items, total, err := ListVersions(db, c.Query("network_domain_id"), c.Query("change_no"), page, pageSize)
		if err != nil {
			respondDeploymentError(c, err)
			return
		}
		if items == nil {
			items = []models.ConfigVersion{}
		}
		response.OK(c, gin.H{"items": items, "total": total})
	}
}

// GetVersionHandler 处理 GET /api/v2/platform/config-versions/{id}。
func GetVersionHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		v, err := GetVersion(db, c.Param("id"))
		if err != nil {
			respondDeploymentError(c, err)
			return
		}
		response.OK(c, v)
	}
}

// ListDeploymentsHandler 处理 GET /api/v2/platform/deployments。
func ListDeploymentsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page, pageSize := queryPage(c)
		items, total, err := ListDeployments(db, c.Query("network_domain_id"), c.Query("status"), c.Query("change_no"), page, pageSize)
		if err != nil {
			respondDeploymentError(c, err)
			return
		}
		if items == nil {
			items = []models.ConfigDeployment{}
		}
		response.OK(c, gin.H{"items": items, "total": total})
	}
}

// RetryDeploymentHandler 处理 POST /api/v2/platform/deployments/{deployment_id}/retry。
func RetryDeploymentHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			TriggeredBy string `json:"triggered_by" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		dep, err := Retry(db, c.Param("id"), req.TriggeredBy, DefaultApplier)
		if err != nil {
			respondDeploymentError(c, err)
			return
		}
		response.OK(c, dep)
	}
}

// RollbackDeploymentHandler 处理 POST /api/v2/platform/deployments/{config_version_id}/rollback。
func RollbackDeploymentHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req struct {
			TriggeredBy string `json:"triggered_by" binding:"required"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("解析请求体失败: %w", err))
			return
		}
		dep, err := Rollback(db, c.Param("id"), req.TriggeredBy, DefaultApplier)
		if err != nil {
			respondDeploymentError(c, err)
			return
		}
		response.OK(c, dep)
	}
}

// respondDeploymentError 将服务层 sentinel 错误映射为统一响应。
func respondDeploymentError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrNotFound),
		errors.Is(err, ErrVersionNotFound),
		errors.Is(err, ErrDomainNotFound):
		response.NotFound(c, err.Error())
	case errors.Is(err, ErrDomainRequired),
		errors.Is(err, ErrNotLocal),
		errors.Is(err, ErrNotFailed):
		response.BadRequest(c, err)
	default:
		response.InternalServerError(c, err)
	}
}