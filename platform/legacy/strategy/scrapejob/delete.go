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

		// 软删 Job + 清理该 Job 的边缘 target 快照（M09 监控目标状态数据源）：Job 删除
		// 后配置需重新生成/下发才生效，期间 agent 仍可能按旧配置上报；先清一次保证
		// 页面立即消失，agent 后续若仍上报会重新写入，待新配置生效后自然收敛。
		// 同一事务保证「Job 已删但快照清理失败」不会出现。
		if err := db.Transaction(func(tx *gorm.DB) error {
			if err := tx.Delete(&job).Error; err != nil {
				return fmt.Errorf("delete scrape job %d: %w", id, err)
			}
			if err := tx.Unscoped().
				Where("network_domain_id = ? AND job = ?", job.NetworkDomainID, job.JobName).
				Delete(&models.EdgeTargetSnapshot{}).Error; err != nil {
				return fmt.Errorf("clear target snapshots for job %q: %w", job.JobName, err)
			}
			return nil
		}); err != nil {
			response.InternalServerError(c, err)
			return
		}
		response.OK(c, gin.H{"id": id})
	}
}
