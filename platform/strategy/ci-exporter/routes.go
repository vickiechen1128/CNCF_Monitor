// routes.go 收口 Module_01 CITypeExporterMapping（默认采集配置）的全部 HTTP
// 路由：列表 / CRUD，统一挂在 /api/v2/platform/ci-exporter-mappings* 下，
// 响应统一 {status, data|errorType, error}。
package ciexporter

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module_01 ci-exporter-mapping endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST          /ci-exporter-mappings
//   - PUT/DELETE        /ci-exporter-mappings/:id
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	mappings := platform.Group("/ci-exporter-mappings")
	{
		mappings.GET("", ListCITypeExporterMappings(db))
		mappings.POST("", CreateCITypeExporterMapping(db))
		mappings.PUT("/:id", UpdateCITypeExporterMapping(db))
		mappings.DELETE("/:id", DeleteCITypeExporterMapping(db))
	}
}