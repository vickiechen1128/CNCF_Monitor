// routes.go 收口 Module_01 ExporterTemplate（采集器模板）的全部 HTTP 路由：
// 列表 / 登记 / 编辑 / 软删，统一挂在 /api/v2/platform/exporter-templates* 下，
// 响应统一 {status, data|errorType, error}。
package exportertemplate

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module_01 exporter-template endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST          /exporter-templates
//   - PUT/DELETE        /exporter-templates/:id
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	exporters := platform.Group("/exporter-templates")
	{
		exporters.GET("", ListExporterTemplates(db))
		exporters.POST("", CreateExporterTemplate(db))
		exporters.PUT("/:id", UpdateExporterTemplate(db))
		exporters.DELETE("/:id", DeleteExporterTemplate(db))
	}
}