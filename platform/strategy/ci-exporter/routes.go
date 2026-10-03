// routes.go 收口 Module_01 CITypeExporterMapping（默认采集配置）的全部 HTTP
// 路由：列表 / CRUD，统一挂在 /api/v2/platform/ci-exporter-mappings* 下，
// 响应统一 {status, data|errorType, error}。列表另含 label_template_id 反查模式
// （供 Module_07 标签模板删除的引用保护，PRD §6.6.3.1 决策 119）。
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
//     GET 另支持反查模式 ?label_template_id={template_id}：返回引用该标签模板的
//     映射行，响应 {list, total}（不分页），模板不存在返 not_found。供 Module_07
//     标签模板删除的引用保护只读反查（PRD §6.6.3.1 决策 119），与
//     GET /scrape-jobs?label_template_id= 对称。
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