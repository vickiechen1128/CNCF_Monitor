package handler

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the M07 v3 HTTP API under the given platform group
// (expected prefix: /api/v3/platform).
func RegisterRoutes(platform *gin.RouterGroup, resources *ResourceHandler, dictionaries *DictionaryHandler, labels *LabelHandler) {
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
	platform.GET("/application-dict", dictionaries.ListApplications)
	platform.GET("/platform-dict", dictionaries.ListPlatforms)
	platform.GET("/cloud-dict", dictionaries.ListClouds)
	platform.GET("/zone-types", dictionaries.ListZoneTypes)
	platform.GET("/os-options", dictionaries.ListOSOptions)
	platform.GET("/app-platform-rel", dictionaries.ListAppPlatformRels)
	platform.POST("/app-platform-rel", dictionaries.CreateAppPlatformRel)
	platform.PUT("/app-platform-rel/:rel_id", dictionaries.UpdateAppPlatformRel)
	platform.DELETE("/app-platform-rel/:rel_id", dictionaries.DeleteAppPlatformRel)
}
