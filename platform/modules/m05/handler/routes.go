// Package handler adapts the M05 v3 dashboard services to HTTP.
//
// Routes (all under /api/v3/platform):
//
//	GET  /dashboard/summary      authenticated  homepage aggregate
//	GET  /dashboard/panels       authenticated  mounted panel list (paged)
//	GET  /dashboard/panels/:id   authenticated  mounted panel detail
//	POST /dashboard/panels       admin          mount a panel
//	PUT  /dashboard/panels/:id   admin          edit name / url
package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// Handlers groups the M05 HTTP handlers mounted by RegisterRoutes.
type Handlers struct {
	Summary *SummaryHandler
	Panels  *PanelHandler
}

// RegisterRoutes mounts the M05 v3 dashboard API.
//
// Reads are open to any authenticated user; writes sit in an admin sub-group so
// the global AuthMiddleware answers 401 for anonymous callers and
// auth.RequireAdmin answers 403 for authenticated non-admins (same shape as
// M06's administrative group).
func RegisterRoutes(platform *gin.RouterGroup, h Handlers) {
	platform.GET("/dashboard/summary", h.Summary.Get)
	platform.GET("/dashboard/panels", h.Panels.List)
	platform.GET("/dashboard/panels/:id", h.Panels.Get)

	admin := platform.Group("")
	admin.Use(auth.RequireAdmin())
	admin.POST("/dashboard/panels", h.Panels.Create)
	admin.PUT("/dashboard/panels/:id", h.Panels.Update)
}
