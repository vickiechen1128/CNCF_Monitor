package scrapejob

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// BatchSubmitReadyRequest 是批量将 ScrapeJob 从 draft 提交为 ready 的请求体。
// 按决策 D28-3，MVP 只保留 draft→ready 单向，不再提供 ready→draft 用户主动回退。
type BatchSubmitReadyRequest struct {
	IDs []uint `json:"ids" binding:"required,min=1"`
}

// BatchSubmitReady 批量将 draft 态采集 Job 提交为 ready。
// 约束：
//   - ID 必须全部存在且未被软删；
//   - 所有目标 Job 当前必须为 draft_status=draft；
//   - 每条 Job 执行完整校验（网域已纳管非冻结、必填项、实例同域、认证 TLS 等），
//     任一失败则整体失败（all-or-nothing）；
//   - 成功后将 draft_status 置为 ready、change_status 置为 pending（等待 M09 变更单）。
func BatchSubmitReady(db *gorm.DB, ids []uint) ([]models.ScrapeJob, error) {
	if len(ids) == 0 {
		return nil, fmt.Errorf("ids 不能为空")
	}

	var jobs []models.ScrapeJob
	if err := db.Where("id IN ?", ids).Find(&jobs).Error; err != nil {
		return nil, fmt.Errorf("query scrape jobs: %w", err)
	}
	if len(jobs) != len(ids) {
		return nil, fmt.Errorf("部分采集 Job 不存在")
	}

	for i := range jobs {
		j := &jobs[i]
		if j.DraftStatus != "draft" {
			return nil, fmt.Errorf("采集 Job %q 当前不是草稿态，无法批量提交生效", j.JobName)
		}
		// F-28：草稿允许采集参数留空；提交生效前按层叠默认链（映射→模板→
		// 全局兜底）解析留空字段为生效快照，随状态翻转一并落库。
		resolveJobScrapeParams(db, j)
		// 完整校验：提交生效意味着进入 M09 配置生成候选集。
		if err := validateJobRequest(db, j); err != nil {
			return nil, fmt.Errorf("采集 Job %q 校验未通过：%w", j.JobName, err)
		}
		if err := exporterExists(db, j.ExporterTemplateID); err != nil {
			return nil, fmt.Errorf("采集 Job %q 校验未通过：%w", j.JobName, err)
		}
	}

	// 全部校验通过后逐条落库（含解析后的生效参数快照），保持 all-or-nothing。
	for i := range jobs {
		jobs[i].DraftStatus = "ready"
		jobs[i].ChangeStatus = models.ChangeStatusPending
		if err := db.Save(&jobs[i]).Error; err != nil {
			return nil, fmt.Errorf("submit scrape job %q ready: %w", jobs[i].JobName, err)
		}
	}

	// 返回更新后的完整对象（顺序与请求 ids 一致）。
	updated := make([]models.ScrapeJob, len(jobs))
	copy(updated, jobs)
	return updated, nil
}

// BatchUpdateDraftStatusHandler 处理 POST /api/v2/platform/scrape-jobs/batch-draft-status。
// 按 D28-3 该端点语义收窄为「批量提交生效」，不再接受 draft_status 参数。
func BatchUpdateDraftStatusHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req BatchSubmitReadyRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid batch submit-ready payload: %w", err))
			return
		}

		jobs, err := BatchSubmitReady(db, req.IDs)
		if err != nil {
			response.BadRequest(c, err)
			return
		}
		response.OK(c, gin.H{"jobs": jobs})
	}
}

// BatchDeleteScrapeJobs 批量删除（软删）采集 Job。
// 返回被删除的 ID 列表。当前未暴露为独立 HTTP 端点，保留给未来扩展。
func BatchDeleteScrapeJobs(_ *gorm.DB, _ []uint) ([]uint, error) {
	return nil, fmt.Errorf("not implemented")
}
