package scrapejob

import (
	"fmt"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// jobInstanceItem 是 Job 实例列表项：已选实例 + 安装状态（unconfirmed/confirmed）。
type jobInstanceItem struct {
	ResourceID string `json:"resource_id"`
	// 未找到该实例的确认记录时 status 为 unconfirmed（默认）。
	Status string `json:"status"`
}

// ListJobInstances 是 GET /api/v2/platform/scrape-jobs/:id/instances 的 handler：
// 返回该 Job 已选实例 + 安装状态。Job 未命中 not_found（api-contract-snapshot §6）。
func ListJobInstances(db *gorm.DB) gin.HandlerFunc {
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

		// 查询该 Job 的安装确认记录映射（resource_id → status）。
		var confs []models.ExporterInstallationConfirmation
		if err := db.Where("scrape_job_id = ?", id).Find(&confs).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list installation confirmations: %w", err))
			return
		}
		statusByResource := make(map[string]string, len(confs))
		for _, cnf := range confs {
			statusByResource[cnf.ResourceID] = string(cnf.Status)
		}

		items := make([]jobInstanceItem, 0, len(job.SelectedInstanceIDs))
		for _, rid := range job.SelectedInstanceIDs {
			st, ok := statusByResource[rid]
			if !ok {
				st = string(models.InstallationStatusUnconfirmed)
			}
			items = append(items, jobInstanceItem{ResourceID: rid, Status: st})
		}
		response.OK(c, gin.H{"items": items, "total": len(items)})
	}
}

// confirmRequest 是安装确认的请求体（confirmed_by 必填固定 platform_admin，MVP 无鉴权）。
type confirmRequest struct {
	ConfirmedBy string `json:"confirmed_by"`
	ActualPort  int    `json:"actual_port"`
	Notes       string `json:"notes"`
}

// ConfirmInstallation 是 POST /api/v2/platform/scrape-jobs/:id/instances/:resource_id/
// confirm 的 handler：确认资源安装 Exporter，落 ExporterInstallationConfirmation
// （status=confirmed）。校验资源在 Job selected_instance_ids 且同域（bad_request）；
// Job 未命中 not_found（api-contract-snapshot §6）。
func ConfirmInstallation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		resourceID := c.Param("resource_id")
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}
		var req confirmRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid confirmation payload: %w", err))
			return
		}
		if req.ConfirmedBy != "platform_admin" {
			response.BadRequest(c, fmt.Errorf("confirmed_by 固定为 platform_admin（MVP 无鉴权）"))
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

		// 资源须在选中集。
		inSet := false
		for _, rid := range job.SelectedInstanceIDs {
			if rid == resourceID {
				inSet = true
				break
			}
		}
		if !inSet {
			response.BadRequest(c, fmt.Errorf("实例 %q 不在该采集 Job 的已选实例集中", resourceID))
			return
		}
		// 资源须与 Job 同域。
		okDomain, err := resourceInDomain(db, resourceID, job.NetworkDomainID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !okDomain {
			response.BadRequest(c, fmt.Errorf("实例 %q 不属于网域 %q", resourceID, job.NetworkDomainID))
			return
		}

		now := time.Now()
		conf := &models.ExporterInstallationConfirmation{
			ResourceID:         resourceID,
			ScrapeJobID:        id,
			ExporterTemplateID: job.ExporterTemplateID,
			Status:             models.InstallationStatusConfirmed,
			ConfirmedBy:        req.ConfirmedBy,
			ConfirmedAt:        &now,
			Notes:              req.Notes,
			ActualPort:         req.ActualPort,
		}
		// PK=(resource_id, scrape_job_id)：upsert（重复确认幂等更新）。
		if err := db.Save(conf).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("save installation confirmation: %w", err))
			return
		}
		response.OK(c, conf)
	}
}

// CancelInstallation 是 DELETE /api/v2/platform/scrape-jobs/:id/instances/:resource_id/
// confirm 的 handler：删除确认记录。返回 `{resource_id, job_id}`；未命中 not_found
// （api-contract-snapshot §6）。
func CancelInstallation(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		resourceID := c.Param("resource_id")
		del := db.Where("resource_id = ? AND scrape_job_id = ?", resourceID, id).
			Delete(&models.ExporterInstallationConfirmation{})
		if del.Error == gorm.ErrRecordNotFound {
			response.NotFound(c, fmt.Sprintf("installation confirmation %s/%d not found", resourceID, id))
			return
		}
		if del.Error != nil {
			response.InternalServerError(c, fmt.Errorf("delete installation confirmation: %w", del.Error))
			return
		}
		if del.RowsAffected == 0 {
			response.NotFound(c, fmt.Sprintf("installation confirmation %s/%d not found", resourceID, id))
			return
		}
		response.OK(c, gin.H{"resource_id": resourceID, "job_id": id})
	}
}