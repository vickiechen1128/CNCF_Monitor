package handler

import "github.com/gin-gonic/gin"

// RegisterRoutes mounts the M01 v3 API under the given platform group
// (expected prefix: /api/v3/platform).
//
// Implemented:
//
//	/exporter-templates        (B2, FR-02)
//	/ci-exporter-mappings      (B2, FR-01/FR-03)
//
// Pending: /scrape-jobs (B3), /monitoring-rules (B5), /metric-library,
// /business-metrics and /blackbox-modules (B6).
func RegisterRoutes(platform *gin.RouterGroup, exporters *ExporterTemplateHandler, mappings *MappingHandler) {
	exporterGroup := platform.Group("/exporter-templates")
	{
		exporterGroup.GET("", exporters.List)
		exporterGroup.POST("", exporters.Create)
		exporterGroup.GET("/:id", exporters.Get)
		exporterGroup.PUT("/:id", exporters.Update)
		exporterGroup.DELETE("/:id", exporters.Delete)
	}

	mappingGroup := platform.Group("/ci-exporter-mappings")
	{
		mappingGroup.GET("", mappings.List)
		mappingGroup.POST("", mappings.Create)
		mappingGroup.PUT("/:id", mappings.Update)
		mappingGroup.PUT("/:id/label-template", mappings.SetLabelTemplate)
		mappingGroup.DELETE("/:id", mappings.Delete)
	}
}
