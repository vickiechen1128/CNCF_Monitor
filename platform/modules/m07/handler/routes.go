package handler

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the M07 v3 HTTP API under the given platform group
// (expected prefix: /api/v3/platform).
func RegisterRoutes(platform *gin.RouterGroup, resources *ResourceHandler, dictionaries *DictionaryHandler, labels *LabelHandler, imports *ImportHandler) {
	resourceGroup := platform.Group("/resources")
	{
		resourceGroup.GET("", resources.List)
		resourceGroup.POST("", resources.Create)
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

	platform.GET("/business-domains", dictionaries.ListBusinessDomains)
	platform.POST("/business-domains", dictionaries.CreateBusinessDomain)
	platform.PUT("/business-domains/:code", dictionaries.UpdateBusinessDomain)
	platform.GET("/application-dict", dictionaries.ListApplications)
	platform.POST("/application-dict", dictionaries.CreateApplication)
	platform.PUT("/application-dict/:app_code", dictionaries.UpdateApplication)
	platform.GET("/platform-dict", dictionaries.ListPlatforms)
	platform.POST("/platform-dict", dictionaries.CreatePlatform)
	platform.PUT("/platform-dict/:platform_code", dictionaries.UpdatePlatform)
	platform.GET("/cloud-dict", dictionaries.ListClouds)
	platform.GET("/zone-types", dictionaries.ListZoneTypes)
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
