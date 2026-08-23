// routes.go 收口 Module 07 标签模板管理的全部 HTTP 路由（T07-18）：
// LabelTemplate 列表 / CRUD / 克隆、mappings CRUD 与关联实例查询，统一挂在
// /api/v2/platform/label-templates* 下，响应统一 {status, data|errorType|error}。
package label

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module 07 label-template endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST            /label-templates
//   - PUT/DELETE          /label-templates/:template_id
//   - POST                /label-templates/:template_id/clone（克隆）
//   - POST/PUT/DELETE     /label-templates/:template_id/mappings[/:mapping_id]
//   - GET                 /label-templates/:template_id/resources（关联实例）
//
// 同一路径层级统一使用 :template_id / :mapping_id 参数名，满足 Gin 通配符约束。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	labelTemplates := platform.Group("/label-templates")
	{
		labelTemplates.GET("", ListLabelTemplates(db))
		labelTemplates.POST("", CreateLabelTemplate(db))
		labelTemplates.PUT("/:template_id", UpdateLabelTemplate(db))
		labelTemplates.DELETE("/:template_id", DeleteLabelTemplate(db))
		labelTemplates.POST("/:template_id/clone", CloneLabelTemplate(db))

		mappings := labelTemplates.Group("/:template_id/mappings")
		{
			mappings.POST("", CreateLabelMapping(db))
			mappings.PUT("/:mapping_id", UpdateLabelMapping(db))
			mappings.DELETE("/:mapping_id", DeleteLabelMapping(db))
		}

		labelTemplates.GET("/:template_id/resources", ListTemplateResources(db))
	}
}
