// routes.go 收口 Module 07 监控对象管理的全部 HTTP 路由（T07-18）：
// 五类资源 CRUD、Excel 模板下载 / 导入、资源标签、导入记录与业务分组字典，
// 统一挂在 /api/v2/platform/* 下，响应统一 {status, data|errorType|error}
// （03_API_Standard §3）。
package resource

import (
	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module 07 resource-facing endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST        /resources
//   - PUT/DELETE      /resources/:resource_id
//   - GET             /resources/:resource_id/template（Excel 模板下载）
//   - POST            /resources/:resource_id/import（Excel 导入）
//   - GET/POST        /resources/:resource_id/labels
//   - PUT/DELETE      /resources/:resource_id/labels/:label_id
//   - GET/POST       /business-domains（业务分组字典：只读列表 + 登记，决策 48）
//   - PUT            /business-domains/:code（业务分组受限编辑；无 DELETE，决策 48）
//   - GET             /imports
//   - GET             /imports/:import_id
//
// Gin 通配符约束：同一 HTTP 方法树中，同一路径层级只允许同名参数。模板下载 /
// 导入 handler 读取 c.Param("type")，资源 CRUD / 标签 handler 读取
// c.Param("resource_id")——二者路径层级相同，无法同时注册 :type 与 :resource_id
// （注册即 panic，见 route_probe_test.go），故统一以 :resource_id 注册，并用
// withTypeParam 为 template/import 转译出 :type。对外 URL 形态（如
// /resources/host/template）与契约完全一致，仅内部参数名不同。
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB, bizStore *BusinessDomainStore) {
	resources := platform.Group("/resources")
	{
		resources.GET("", ListResources(db))
		resources.POST("", CreateResource(db, bizStore))
		resources.PUT("/:resource_id", UpdateResource(db, bizStore))
		resources.DELETE("/:resource_id", DeleteResource(db))
		resources.GET("/:resource_id/template", withTypeParam(DownloadTemplate(bizStore, listDomainOptions(db))))
		resources.POST("/:resource_id/import", withTypeParam(ImportResources(db, bizStore)))

		resourceLabels := resources.Group("/:resource_id/labels")
		{
			resourceLabels.GET("", GetResourceLabels(db))
			resourceLabels.POST("", CreateResourceLabel(db))
			resourceLabels.PUT("/:label_id", UpdateResourceLabel(db))
			resourceLabels.DELETE("/:label_id", DeleteResourceLabel(db))
		}
	}

	platform.GET("/business-domains", ListBusinessDomains(bizStore))
	// 业务分组字典写路由（决策 48）：登记 + 受限编辑；无 DELETE（停用不删除）。
	platform.POST("/business-domains", CreateBusinessDomain(bizStore))
	platform.PUT("/business-domains/:code", UpdateBusinessDomain(bizStore))
	// 操作系统内置字典（只读，供 M07 采集入口/资源表单下拉；位于 platform 层，
	// 避免与 /resources/:resource_id 通配符冲突，见 RegisterRoutes 注释）。
	platform.GET("/os-options", ListOSOptions())

	imports := platform.Group("/imports")
	{
		imports.GET("", ListImports(db))
		imports.GET("/:import_id", GetImportRecord(db))
	}
}

// withTypeParam 把 :resource_id 位置参数转译为 template/import handler 期望读取
// 的 :type（Gin 同一路径层级仅允许同名通配符，见 RegisterRoutes 注释）。通过
// gin.Context.AddParam 追加参数，不改动任何 handler 逻辑。
func withTypeParam(h gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.AddParam("type", c.Param("resource_id"))
		h(c)
	}
}

// listDomainOptions 构造「取值说明」sheet 的网域清单查询：实时读取 M06 行政记录
// （NetworkDomain 表，含 default 预置管理网域），供模板下载注入。
func listDomainOptions(db *gorm.DB) func() ([]DomainOption, error) {
	return func() ([]DomainOption, error) {
		var domains []models.NetworkDomain
		if err := db.Find(&domains).Error; err != nil {
			return nil, err
		}
		opts := make([]DomainOption, 0, len(domains))
		for _, d := range domains {
			opts = append(opts, DomainOption{ID: d.ID, Name: d.Name})
		}
		return opts, nil
	}
}
