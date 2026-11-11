package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// Handlers groups the M06 v3 HTTP handlers mounted by RegisterRoutes.
type Handlers struct {
	Tenants   *TenantHandler
	Domains   *NetworkDomainHandler
	Users     *UserHandler
	LoginLogs *LoginLogHandler
	Storage   *StorageHandler
}

// RegisterRoutes mounts the M06 v3 administrative routes.
//
// Network-domain reads are available to any authenticated user; every mutation
// (plus tenant/user/login-log administration) is behind RequireAdmin. The
// global AuthMiddleware establishes the user context, so anonymous callers get
// 401 before this group and non-admin callers get 403 here.
func RegisterRoutes(platform *gin.RouterGroup, h Handlers) {
	platform.GET("/network-domains", h.Domains.List)
	platform.GET("/network-domains/:id", h.Domains.Get)
	platform.GET("/network-domains/:id/impact", h.Domains.Impact)

	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	admin.GET("/tenants", h.Tenants.List)
	admin.GET("/tenants/:id", h.Tenants.Get)
	admin.PUT("/tenants/:id", h.Tenants.Update)
	admin.POST("/tenants", h.Tenants.Create)
	admin.PATCH("/tenants/:id/status", h.Tenants.ChangeStatus)

	admin.POST("/network-domains", h.Domains.Create)
	admin.PUT("/network-domains/:id", h.Domains.Update)
	admin.PATCH("/network-domains/:id/status", h.Domains.UpdateStatus)
	admin.DELETE("/network-domains/:id", h.Domains.Delete)

	admin.GET("/users", h.Users.List)
	admin.POST("/users", h.Users.Create)
	admin.PUT("/users/:id", h.Users.Update)
	admin.PATCH("/users/:id/status", h.Users.UpdateStatus)
	admin.PUT("/users/:id/password", h.Users.ResetPassword)
	admin.DELETE("/users/:id", h.Users.Delete)

	admin.GET("/login-logs", h.LoginLogs.List)

	admin.GET("/storage-logs", h.Storage.GetOverview)
	admin.PUT("/storage-logs/retention", h.Storage.UpdateRetention)
}
