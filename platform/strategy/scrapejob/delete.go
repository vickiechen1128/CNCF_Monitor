package scrapejob

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DeleteScrapeJob 是 DELETE /api/v2/platform/scrape-jobs/:id 的 handler：软删采集
// Job（api-contract-snapshot §5）。成功返回 `{id}`；未命中 not_found。
func DeleteScrapeJob(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var job models.ScrapeJob
		if err := db.First(&job, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("scrape job %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get scrape job %d: %w", id, err))
			return
		}

		// 决策 44-1：change_status=pending 的 job 已挂起变更单，禁止删除，避免变更单成为幽灵单。
		if job.ChangeStatus == models.ChangeStatusPending {
			response.Conflict(c, fmt.Errorf("采集 Job %q 存在待确认变更单，禁止删除；请先前往配置变更确认页处理", job.JobName))
			return
		}

		if err := db.Delete(&job).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("delete scrape job %d: %w", id, err))
			return
		}
		response.OK(c, gin.H{"id": id})
	}
}