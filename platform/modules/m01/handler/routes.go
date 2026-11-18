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
func RegisterRoutes(platform *gin.RouterGroup, exporters *ExporterTemplateHandler, mappings *MappingHandler, jobs *JobHandler, rules *RuleHandler, metrics *MetricHandler, business *BusinessMetricHandler, probes *ProbeModuleHandler, jobGroups *JobGroupHandler) {
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
		// 组合筛选（SRS JG v1.1 §5.3）：静态路由必须排在 :id 之前。
		jobGroup.GET("/instance-candidates/filter-schema", jobs.CandidateFilterSchema)
		jobGroup.POST("/instance-candidates/query", jobs.QueryCandidates)
		jobGroup.POST("/instance-candidates/query/ids", jobs.QueryCandidateIDs)
		jobGroup.GET("/:id", jobs.Get)
		jobGroup.PUT("/:id", jobs.Update)
		jobGroup.DELETE("/:id", jobs.Delete)
		jobGroup.GET("/:id/instances", jobs.Instances)
		jobGroup.POST("/:id/instances/:resource_id/confirm", jobs.ConfirmInstallation)
		jobGroup.DELETE("/:id/instances/:resource_id/confirm", jobs.DeleteInstallation)
		jobGroup.POST("/:id/preview-targets", jobs.Preview)
	}

	// Job groups (SRS JG v1.0): one monitoring intent fanned out to one child
	// job per network domain. Dispatch stays per-domain, M09 is unchanged.
	jobGroupGroup := platform.Group("/job-groups")
	{
		jobGroupGroup.GET("", jobGroups.List)
		jobGroupGroup.POST("", jobGroups.Create)
		// 静态路由必须在 :id 之前：存量单域任务编辑为跨域时晋升为任务
		jobGroupGroup.POST("/from-job", jobGroups.Adopt)
		jobGroupGroup.GET("/:id", jobGroups.Get)
		jobGroupGroup.PUT("/:id", jobGroups.Update)
		jobGroupGroup.DELETE("/:id", jobGroups.Delete)
	}

	metricGroup := platform.Group("/metric-library")
	{
		metricGroup.GET("", metrics.List)
		metricGroup.POST("", metrics.Create)
		metricGroup.GET("/:id", metrics.Get)
		metricGroup.PUT("/:id", metrics.Update)
		metricGroup.DELETE("/:id", metrics.Delete)
	}

	businessGroup := platform.Group("/business-metrics")
	{
		businessGroup.GET("", business.List)
		businessGroup.POST("", business.Create)
		businessGroup.GET("/:id", business.Get)
		businessGroup.PUT("/:id", business.Update)
		businessGroup.DELETE("/:id", business.Delete)
	}

	// Probe modules are platform-seeded and read-only in v2.0; they are still
	// exposed so the blackbox Job form can list available module names.
	probeGroup := platform.Group("/blackbox-modules")
	{
		probeGroup.GET("", probes.List)
		probeGroup.GET("/:id", probes.Get)
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
