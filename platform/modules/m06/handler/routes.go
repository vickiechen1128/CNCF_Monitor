package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// RegisterRoutes mounts the M06 v3 administrative routes.
//
// Network-domain reads are available to any authenticated user; every mutation
// (plus the tenant surface) is behind RequireAdmin. The global AuthMiddleware
// establishes the user context, so anonymous callers get 401 before this group
// and non-admin callers get 403 here.
func RegisterRoutes(platform *gin.RouterGroup, tenants *TenantHandler, domains *NetworkDomainHandler) {
	platform.GET("/network-domains", domains.List)
	platform.GET("/network-domains/:id", domains.Get)
	platform.GET("/network-domains/:id/impact", domains.Impact)

	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	admin.GET("/tenants", tenants.List)
	admin.GET("/tenants/:id", tenants.Get)
	admin.PUT("/tenants/:id", tenants.Update)
	admin.POST("/tenants", tenants.Create)
	admin.PATCH("/tenants/:id/status", tenants.ChangeStatus)

	admin.POST("/network-domains", domains.Create)
	admin.PUT("/network-domains/:id", domains.Update)
	admin.PATCH("/network-domains/:id/status", domains.UpdateStatus)
	admin.DELETE("/network-domains/:id", domains.Delete)
}
