package dashboard

import (
	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/dashboard/panelmount"
	"gorm.io/gorm"
)

// RegisterPanelRoutes mounts read routes for authenticated users and create for admins.
func RegisterPanelRoutes(platform, admin *gin.RouterGroup, db *gorm.DB) {
	h := panelmount.NewHandler(panelmount.NewService(panelmount.NewRepository(db)))
	platform.GET("/dashboard/panels", h.List)
	platform.GET("/dashboard/panels/:id", h.Get)
	admin.POST("/dashboard/panels", h.Create)
	admin.PUT("/dashboard/panels/:id", h.Update)
}
