// Package blackboxmodule 提供 Module_01 拨测模块管理及自注册路由。
package blackboxmodule

import (
	"log"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes 挂载 /api/v2/platform/blackbox-modules 路由并初始化模块数据。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	repo := NewRepository(db)
	if err := repo.Migrate(); err != nil {
		log.Printf("WARN: initialize blackbox modules: %v", err)
	}
	svc := NewService(repo)
	group := platform.Group("/blackbox-modules")
	group.GET("", listModules(svc))
	group.POST("", createModule(svc))
	group.PUT("/:id", updateModule(svc))
	group.DELETE("/:id", deleteModule(svc))
}
