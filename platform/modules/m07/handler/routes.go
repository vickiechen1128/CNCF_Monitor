package handler

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the M07 v3 HTTP API under the given platform group
// (expected prefix: /api/v3/platform).
func RegisterRoutes(platform *gin.RouterGroup, resources *ResourceHandler, dictionaries *DictionaryHandler, labels *LabelHandler, imports *ImportHandler, labelTemplates *LabelTemplateHandler) {
	resourceGroup := platform.Group("/resources")
	{
		resourceGroup.GET("", resources.List)
		resourceGroup.POST("", resources.Create)
		// Static path must be registered before the :resource_id wildcard.
		resourceGroup.POST("/bulk-reassign", resources.BulkReassign)
		// 采集端口批量设置（实例级端口是 M01 解析链最高优先级）
		resourceGroup.POST("/bulk-scrape-port", resources.BulkSetScrapePort)
		resourceGroup.GET("/:resource_id", resources.Get)
		resourceGroup.PUT("/:resource_id", resources.Update)
		resourceGroup.DELETE("/:resource_id", resources.Delete)
		resourceGroup.GET("/:resource_id/referenced-by", resources.References)

		labelGroup := resourceGroup.Group("/:resource_id/labels")
		{
			labelGroup.GET("", labels.List)
			labelGroup.POST("", labels.Create)
			labelGroup.PUT("/:label_id", labels.Update)
			labelGroup.DELETE("/:label_id", labels.Delete)
		}
	}

	labelTemplateGroup := platform.Group("/label-templates")
	{
		labelTemplateGroup.GET("", labelTemplates.List)
		labelTemplateGroup.POST("", labelTemplates.Create)
		labelTemplateGroup.GET("/:id", labelTemplates.Get)
		labelTemplateGroup.PUT("/:id", labelTemplates.Update)
		labelTemplateGroup.DELETE("/:id", labelTemplates.Delete)
	}

	platform.GET("/business-domains", dictionaries.ListBusinessDomains)
	platform.POST("/business-domains", dictionaries.CreateBusinessDomain)
	platform.PUT("/business-domains/:code", dictionaries.UpdateBusinessDomain)
	platform.POST("/business-domains/:code/revoke", dictionaries.RevokeBusinessDomain)
	platform.POST("/business-domains/:code/merge", dictionaries.MergeBusinessDomain)
	platform.GET("/application-dict", dictionaries.ListApplications)
	platform.POST("/application-dict", dictionaries.CreateApplication)
	platform.PUT("/application-dict/:app_code", dictionaries.UpdateApplication)
	platform.POST("/application-dict/:app_code/revoke", dictionaries.RevokeApplication)
	platform.POST("/application-dict/:app_code/merge", dictionaries.MergeApplication)
	platform.GET("/platform-dict", dictionaries.ListPlatforms)
	platform.POST("/platform-dict", dictionaries.CreatePlatform)
	platform.PUT("/platform-dict/:platform_code", dictionaries.UpdatePlatform)
	platform.POST("/platform-dict/:platform_code/revoke", dictionaries.RevokePlatform)
	platform.POST("/platform-dict/:platform_code/merge", dictionaries.MergePlatform)
	platform.GET("/dictionary-audit-logs", dictionaries.ListDictionaryAuditLogs)
	platform.GET("/cloud-dict", dictionaries.ListClouds)
	platform.POST("/cloud-dict/:cloud_code/revoke", dictionaries.RevokeCloud)
	platform.POST("/cloud-dict/:cloud_code/merge", dictionaries.MergeCloud)
	platform.GET("/zone-types", dictionaries.ListZoneTypes)
	platform.POST("/zone-types/:code/revoke", dictionaries.RevokeZoneType)
	platform.POST("/zone-types/:code/merge", dictionaries.MergeZoneType)
	platform.GET("/os-options", dictionaries.ListOSOptions)
	platform.GET("/app-platform-rel", dictionaries.ListAppPlatformRels)
	platform.POST("/app-platform-rel", dictionaries.CreateAppPlatformRel)
	platform.PUT("/app-platform-rel/:rel_id", dictionaries.UpdateAppPlatformRel)
	platform.DELETE("/app-platform-rel/:rel_id", dictionaries.DeleteAppPlatformRel)

	platform.GET("/import-templates/:resource_category", imports.DownloadTemplate)
	platform.POST("/imports", imports.Import)
	platform.GET("/imports", imports.List)
	platform.GET("/imports/:import_id", imports.Get)
}
