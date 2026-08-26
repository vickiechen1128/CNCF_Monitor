package scrapejob

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateScrapeJobRequest 是创建采集 Job 的请求体（api-contract-snapshot §5）。
type CreateScrapeJobRequest struct {
	JobName                string                    `json:"job_name"`
	JobType                models.JobType            `json:"job_type"`
	MonitorType            string                    `json:"monitor_type"`
	ExporterTemplateID     string                    `json:"exporter_template_id"`
	NetworkDomainID        string                    `json:"network_domain_id"`
	InstanceSelectionMode  models.InstanceSelectionMode `json:"instance_selection_mode"`
	SelectedInstanceIDs    []string                  `json:"selected_instance_ids"`
	ScrapeInterval         string                    `json:"scrape_interval"`
	ScrapeTimeout          string                    `json:"scrape_timeout"`
	MetricsPath            string                    `json:"metrics_path"`
	Scheme                 string                    `json:"scheme"`
	AuthType               models.AuthType           `json:"auth_type"`
	Username               string                    `json:"username"`
	Password               string                    `json:"password"`
	Token                  string                    `json:"token"`
	TLSSkipVerify          bool                      `json:"tls_skip_verify"`
	CAFile                 string                    `json:"ca_file"`
	LabelTemplateID        string                    `json:"label_template_id"`
	BlackboxModule         string                    `json:"blackbox_module"`
	BlackboxTargets        []models.BlackboxTarget   `json:"blackbox_targets"`
	Enabled                bool                      `json:"enabled"`
	// DraftStatus = "draft" 时仅做基础校验并保存为草稿（MVP 方案 C，决策 D28-2）；
	// 空或其他值按 "ready" 处理，执行完整校验并进入 M09 变更管线。
	DraftStatus string `json:"draft_status"`
}

// CreateScrapeJob 是 POST /api/v2/platform/scrape-jobs 的 handler：校验后创建，
// draft_status 默认 ready、change_status 默认 pending（M09 回写）。
func CreateScrapeJob(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateScrapeJobRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid scrape job payload: %w", err))
			return
		}
		if strings.TrimSpace(req.JobName) == "" {
			response.BadRequest(c, fmt.Errorf("job_name 不能为空"))
			return
		}
		// job_name 唯一（模型唯一索引兜底，提前查询给友好错误）。
		// 软删兼容：delete.go 使用软删，job_name 唯一索引仍被已软删行占用。
		// 用 Unscoped 连软删行一起查——GORM 默认作用域（deleted_at IS NULL）会
		// 看不见软删行，导致同名重建时 INSERT 命中 DB 唯一约束而抛 internal error。
		// 仅软删残留时先物理清理旧行释放索引，再允许用户重建同名 Job。
		var existing models.ScrapeJob
		if err := db.Unscoped().Where("job_name = ?", req.JobName).First(&existing).Error; err != nil {
			if err != gorm.ErrRecordNotFound {
				response.InternalServerError(c, fmt.Errorf("check duplicate scrape job: %w", err))
				return
			}
		} else if existing.DeletedAt.Valid {
			if err := db.Unscoped().Delete(&existing).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("purge soft-deleted scrape job %q: %w", req.JobName, err))
				return
			}
		} else {
			response.Conflict(c, fmt.Errorf("采集 Job %q 已存在", req.JobName))
			return
		}

		draftStatus := "ready"
		if req.DraftStatus == "draft" {
			draftStatus = "draft"
		}
		if req.AuthType == "" {
			req.AuthType = models.AuthTypeNone
		}
		if req.InstanceSelectionMode == "" {
			req.InstanceSelectionMode = models.InstanceSelectionManual
		}

		job := &models.ScrapeJob{
			JobName:               req.JobName,
			JobType:               req.JobType,
			MonitorType:           req.MonitorType,
			ExporterTemplateID:    req.ExporterTemplateID,
			NetworkDomainID:       req.NetworkDomainID,
			InstanceSelectionMode: req.InstanceSelectionMode,
			SelectedInstanceIDs:   req.SelectedInstanceIDs,
			ScrapeInterval:        req.ScrapeInterval,
			ScrapeTimeout:         req.ScrapeTimeout,
			MetricsPath:           req.MetricsPath,
			Scheme:                req.Scheme,
			AuthType:              req.AuthType,
			Username:              req.Username,
			Password:              req.Password,
			Token:                 req.Token,
			TLSSkipVerify:         req.TLSSkipVerify,
			CAFile:                req.CAFile,
			LabelTemplateID:       req.LabelTemplateID,
			BlackboxModule:        req.BlackboxModule,
			BlackboxTargets:       req.BlackboxTargets,
			Enabled:               req.Enabled,
			DraftStatus:           draftStatus,
			ChangeStatus:          models.ChangeStatusPending,
		}

		if draftStatus == "draft" {
			// 保存草稿：仅基础校验（字段类型 / 名称唯一性），不参与 M09 配置生成。
			job.ChangeStatus = models.ChangeStatusNone
			if err := validateBasicJobRequest(job); err != nil {
				response.BadRequest(c, err)
				return
			}
		} else {
			// 提交生效：完整校验并进入 M09 变更管线。采集参数留空字段先按
			// 层叠默认链（映射→模板→全局兜底，F-28）解析为生效快照。
			resolveJobScrapeParams(db, job)
			if err := validateJobRequest(db, job); err != nil {
				response.BadRequest(c, err)
				return
			}
			if err := exporterExists(db, job.ExporterTemplateID); err != nil {
				response.BadRequest(c, err)
				return
			}
		}

		if err := db.Create(job).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("create scrape job %q: %w", req.JobName, err))
			return
		}
		response.OK(c, job)
	}
}

// validateBasicJobRequest 对草稿态 ScrapeJob 做最小校验：job_name 与 job_type 合法、名称唯一。
func validateBasicJobRequest(job *models.ScrapeJob) error {
	if strings.TrimSpace(job.JobName) == "" {
		return fmt.Errorf("job_name 不能为空")
	}
	if job.JobType != models.JobTypeStandard && job.JobType != models.JobTypeBlackbox {
		return fmt.Errorf("job_type 非法，可选 standard/blackbox")
	}
	return nil
}