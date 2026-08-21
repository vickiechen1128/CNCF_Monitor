package networkdomain

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts the Module 06 network-domain administrative endpoints
// under an `/api/v2/platform` sub-group (the caller passes the platform group).
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	platform.GET("/zone-types", ListZoneTypes(db))
	platform.GET("/network-domains", ListNetworkDomains(db))
	platform.POST("/network-domains", CreateNetworkDomain(db))
	platform.GET("/network-domains/:id", GetNetworkDomain(db))
	platform.PUT("/network-domains/:id", UpdateNetworkDomain(db))
	platform.PATCH("/network-domains/:id/status", UpdateDomainStatus(db))
	platform.DELETE("/network-domains/:id", DeleteNetworkDomain(db))
}
