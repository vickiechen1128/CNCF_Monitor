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
// Pending: /monitoring-rules (B5), /metric-library, /business-metrics and
// /blackbox-modules (B6).
func RegisterRoutes(platform *gin.RouterGroup, exporters *ExporterTemplateHandler, mappings *MappingHandler, jobs *JobHandler, rules *RuleHandler) {
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

	jobGroup := platform.Group("/scrape-jobs")
	{
		jobGroup.GET("", jobs.List)
		jobGroup.POST("", jobs.Create)
		// Static routes must be registered before the :id parameter route.
		jobGroup.GET("/instance-candidates", jobs.Candidates)
		jobGroup.GET("/:id", jobs.Get)
		jobGroup.PUT("/:id", jobs.Update)
		jobGroup.DELETE("/:id", jobs.Delete)
		jobGroup.GET("/:id/instances", jobs.Instances)
		jobGroup.POST("/:id/instances/:resource_id/confirm", jobs.ConfirmInstallation)
		jobGroup.DELETE("/:id/instances/:resource_id/confirm", jobs.DeleteInstallation)
		jobGroup.POST("/:id/preview-targets", jobs.Preview)
	}

	ruleGroup := platform.Group("/monitoring-rules")
	{
		ruleGroup.GET("", rules.List)
		ruleGroup.POST("", rules.Create)
		// Static route before :id.
		ruleGroup.POST("/validate", rules.Validate)
		ruleGroup.GET("/:id", rules.Get)
		ruleGroup.PUT("/:id", rules.Update)
		ruleGroup.DELETE("/:id", rules.Delete)
	}
}
