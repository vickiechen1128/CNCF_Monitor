// Package configcenter implements Module_09 网域与边缘配置中心（Phase 4，MVP）：
// 网域监控纳管（domain）、配置生成（generator）、配置草稿（draft）、配置下发与历史
// （deployment）。本包仅负责将各子包 API 统一挂载到 /api/v2/platform/*。
// 参见 docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md
//   §3 核心功能 / §6 接口设计 / §9 验收标准。
package configcenter

import (
	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/configcenter/deployment"
	"github.com/metriccenter/metriccenter/platform/configcenter/domain"
	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
	"gorm.io/gorm"
)

// RegisterRoutes 将 Module_09 全部管理端点注册到 /api/v2/platform 子组。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	domain.RegisterRoutes(platform, db)
	draft.RegisterRoutes(platform, db)
	deployment.RegisterRoutes(platform, db)
}