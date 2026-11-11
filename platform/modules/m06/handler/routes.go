package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// RegisterRoutes mounts the M06 v3 administrative routes.
//
// Every route is behind RequireAdmin: the global AuthMiddleware establishes the
// user context, and RequireAdmin rejects anonymous (401 from AuthMiddleware) and
// non-admin (403) callers.
func RegisterRoutes(platform *gin.RouterGroup, tenants *TenantHandler) {
	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	admin.GET("/tenants", tenants.List)
	admin.GET("/tenants/:id", tenants.Get)
	admin.PUT("/tenants/:id", tenants.Update)
	admin.POST("/tenants", tenants.Create)
	admin.PATCH("/tenants/:id/status", tenants.ChangeStatus)
}
