// Package networkdomain implements Module_06 网域登记与管理。
// 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md
package networkdomain

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterReadRoutes mounts the read-only Module 06 network-domain endpoints
// (zone-types / list / detail) under an `/api/v2/platform` sub-group. These are
// consumed by M07 普通用户（仅全局认证，不授权）。
func RegisterReadRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	platform.GET("/zone-types", ListZoneTypes(db))
	platform.GET("/network-domains", ListNetworkDomains(db))
	platform.GET("/network-domains/:id", GetNetworkDomain(db))
}

// RegisterWriteRoutes mounts the administrative Module 06 network-domain write
// endpoints under an admin sub-group（由调用方挂 auth.RequireAdmin()，与 users/tenants
// 对齐，HIGH-1）。GET 读接口不在此，保持仅认证（M07 普通用户消费）。
func RegisterWriteRoutes(admin *gin.RouterGroup, db *gorm.DB) {
	admin.POST("/network-domains", CreateNetworkDomain(db))
	admin.PUT("/network-domains/:id", UpdateNetworkDomain(db))
	admin.PATCH("/network-domains/:id/status", UpdateDomainStatus(db))
	admin.DELETE("/network-domains/:id", DeleteNetworkDomain(db))
}
