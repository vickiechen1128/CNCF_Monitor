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
		var dup int64
		if err := db.Model(&models.ScrapeJob{}).Where("job_name = ?", req.JobName).Count(&dup).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("check duplicate scrape job: %w", err))
			return
		}
		if dup > 0 {
			response.Conflict(c, fmt.Errorf("采集 Job %q 已存在", req.JobName))
			return
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
			DraftStatus:           "ready",
			ChangeStatus:          models.ChangeStatusPending,
		}

		// 先继承默认映射作为快照预填（standard 且缺省采集参数时）。
		inheritDefaultsFromMapping(db, job)
		if err := validateJobRequest(db, job); err != nil {
			response.BadRequest(c, err)
			return
		}
		if err := exporterExists(db, job.ExporterTemplateID); err != nil {
			response.BadRequest(c, err)
			return
		}

		if err := db.Create(job).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("create scrape job %q: %w", req.JobName, err))
			return
		}
		response.OK(c, job)
	}
}