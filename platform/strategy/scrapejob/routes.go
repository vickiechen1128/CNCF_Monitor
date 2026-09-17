// routes.go 收口 Module_01 ScrapeJob（采集 Job）的全部 HTTP 路由：列表 / CRUD /
// 实例选择 / 安装确认 / preview-targets，统一挂在 /api/v2/platform/scrape-jobs* 下，
// 响应统一 {status, data|errorType, error}。
package scrapejob

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// RegisterRoutes mounts all Module_01 scrape-job endpoints under an
// `/api/v2/platform` sub-group (the caller passes the platform group).
//
// 路由一览（均以 /api/v2/platform 为前缀）：
//
//   - GET/POST/DELETE     /scrape-jobs （GET 支持 label_template_id 反查）
//   - PUT/DELETE          /scrape-jobs/:id
//   - GET                 /scrape-jobs/instance-candidates（实例候选）
//   - GET/POST/DELETE     /scrape-jobs/:id/instances[/:resource_id/confirm]
//   - POST                /scrape-jobs/:id/preview-targets
func RegisterRoutes(platform *gin.RouterGroup, db *gorm.DB) {
	jobs := platform.Group("/scrape-jobs")
	{
		jobs.GET("", ListScrapeJobs(db))
		jobs.POST("", CreateScrapeJob(db))
		jobs.GET("/instance-candidates", ListInstanceCandidates(db))
		jobs.GET("/:id/instances", ListJobInstances(db))
		jobs.POST("/:id/instances/:resource_id/confirm", ConfirmInstallation(db))
		jobs.DELETE("/:id/instances/:resource_id/confirm", CancelInstallation(db))
		jobs.POST("/:id/preview-targets", PreviewTargets(db))
		jobs.POST("/batch-draft-status", BatchUpdateDraftStatusHandler(db))
		jobs.PUT("/:id", UpdateScrapeJob(db))
		jobs.DELETE("/:id", DeleteScrapeJob(db))
	}
}