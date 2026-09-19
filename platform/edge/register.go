package edge

import (
	"github.com/gin-gonic/gin"

	"gorm.io/gorm"
)

// RegisterRoutes 将 Module_11 edge 协议路由挂载到给定分组。调用方把该分组落在
// /api/v2/platform/edge（并由 main.go 在全局用户 auth 中对该前缀豁免，D1）。
// 本分组统一应用 EdgeTokenMiddleware 鉴权。
func RegisterRoutes(group *gin.RouterGroup, db *gorm.DB) {
	group.Use(EdgeTokenMiddleware(db))

	hb := NewHeartbeatService(db)
	group.POST("/heartbeat", HeartbeatHandler(hb))

	cfg := NewConfigService(db)
	group.GET("/config", ConfigHandler(cfg))
}
