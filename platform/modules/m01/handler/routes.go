package handler

import (
	"github.com/gin-gonic/gin"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
)

// RegisterRoutes mounts the M01 v3 API under the given platform group
// (expected prefix: /api/v3/platform).
//
// Implemented:
//
//	/collection-templates      (B2, FR-01/FR-03/FR-21)
//	/candidate-fields          (B2, FR-22)
//
// Pending: /monitoring-rules (B5), /metric-library, /business-metrics and
// /blackbox-modules (B6).
func RegisterRoutes(platform *gin.RouterGroup, exporters *ExporterTemplateHandler, templates *CollectionTemplateHandler, jobs *JobHandler, rules *RuleHandler, metrics *MetricHandler, business *BusinessMetricHandler, probes *ProbeModuleHandler, jobGroups *JobGroupHandler) {
	// 采集模板（SRS Module_01 v1.5 §5.1/§5.6）：模板 = 采集实现 + 参数 + 标签模板。
	// 读接口对所有登录用户开放；写接口对登录用户开放，内置模板的管理员限制由
	// service 层按 is_builtin 判定（FR-29），因为同一路由同时承载两类资源。
	templateGroup := platform.Group("/collection-templates")
	{
		templateGroup.GET("", templates.List)
		templateGroup.GET("/:code", templates.Get)
		templateGroup.GET("/:code/impact", templates.Impact)
		templateGroup.POST("", templates.Create)
		templateGroup.PUT("/:code", templates.Update)
		templateGroup.DELETE("/:code", templates.Delete)
	}
	// 选择器字段字典：内置字段（M01）+ 自定义字段（M07，只读）。
	platform.GET("/candidate-fields", templates.CandidateFields)

	exporterGroup := platform.Group("/exporter-templates")
	{
		exporterGroup.GET("", exporters.List)
		exporterGroup.POST("", exporters.Create)
		exporterGroup.GET("/:id", exporters.Get)
		exporterGroup.PUT("/:id", exporters.Update)
		exporterGroup.DELETE("/:id", exporters.Delete)
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
		// 启用 / 停用整组任务（含各域子任务），不需要重提整张表单
		jobGroupGroup.PUT("/:id/status", jobGroups.SetStatus)
		jobGroupGroup.DELETE("/:id", jobGroups.Delete)
	}

	// 技术指标库：读取对所有登录用户开放；新增/编辑/删除仅管理员。
	metricGroup := platform.Group("/metric-library")
	{
		metricGroup.GET("", metrics.List)
		metricGroup.GET("/:id", metrics.Get)
	}
	metricAdmin := platform.Group("/metric-library")
	metricAdmin.Use(auth.RequireAdmin())
	{
		metricAdmin.POST("", metrics.Create)
		metricAdmin.PUT("/:id", metrics.Update)
		metricAdmin.DELETE("/:id", metrics.Delete)
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
