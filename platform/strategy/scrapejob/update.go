package scrapejob

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// UpdateScrapeJobRequest 是更新采集 Job 的请求体：均允许改（api-contract-snapshot
// §5）。password/token 更新时仅存储、不回显明文。
type UpdateScrapeJobRequest struct {
	JobName               *string                  `json:"job_name"`
	MonitorType           *string                  `json:"monitor_type"`
	ExporterTemplateID    *string                  `json:"exporter_template_id"`
	NetworkDomainID       *string                  `json:"network_domain_id"`
	SelectedInstanceIDs   []string                 `json:"selected_instance_ids"`
	ScrapeInterval        *string                  `json:"scrape_interval"`
	ScrapeTimeout         *string                  `json:"scrape_timeout"`
	MetricsPath           *string                  `json:"metrics_path"`
	Scheme                *string                  `json:"scheme"`
	AuthType              *models.AuthType         `json:"auth_type"`
	Username              *string                  `json:"username"`
	Password              *string                  `json:"password"`
	Token                 *string                  `json:"token"`
	TLSSkipVerify         *bool                    `json:"tls_skip_verify"`
	CAFile                *string                  `json:"ca_file"`
	LabelTemplateID       *string                  `json:"label_template_id"`
	BlackboxModule        *string                  `json:"blackbox_module"`
	BlackboxTargets       []models.BlackboxTarget  `json:"blackbox_targets"`
	Enabled               *bool                    `json:"enabled"`
}

// UpdateScrapeJob 是 PUT /api/v2/platform/scrape-jobs/:id 的 handler：可改字段，
// 网域/冻结/认证/blackbox 校验同 POST；未命中 not_found（api-contract-snapshot §5）。
func UpdateScrapeJob(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseJobID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var req UpdateScrapeJobRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid scrape job payload: %w", err))
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

		applyJobUpdate(&job, req)
		if err := validateJobRequest(db, &job); err != nil {
			response.BadRequest(c, err)
			return
		}
		if err := exporterExists(db, job.ExporterTemplateID); err != nil {
			response.BadRequest(c, err)
			return
		}

		if err := db.Save(&job).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("update scrape job %d: %w", id, err))
			return
		}
		response.OK(c, job)
	}
}

// applyJobUpdate 将请求体可改字段应用到既有 Job（浅层复制更新）。
func applyJobUpdate(job *models.ScrapeJob, req UpdateScrapeJobRequest) {
	if req.JobName != nil {
		job.JobName = *req.JobName
	}
	if req.MonitorType != nil {
		job.MonitorType = *req.MonitorType
	}
	if req.ExporterTemplateID != nil {
		job.ExporterTemplateID = *req.ExporterTemplateID
	}
	if req.NetworkDomainID != nil {
		job.NetworkDomainID = *req.NetworkDomainID
	}
	if req.SelectedInstanceIDs != nil {
		job.SelectedInstanceIDs = req.SelectedInstanceIDs
	}
	if req.ScrapeInterval != nil {
		job.ScrapeInterval = *req.ScrapeInterval
	}
	if req.ScrapeTimeout != nil {
		job.ScrapeTimeout = *req.ScrapeTimeout
	}
	if req.MetricsPath != nil {
		job.MetricsPath = *req.MetricsPath
	}
	if req.Scheme != nil {
		job.Scheme = *req.Scheme
	}
	if req.AuthType != nil {
		job.AuthType = *req.AuthType
	}
	if req.Username != nil {
		job.Username = *req.Username
	}
	if req.Password != nil {
		job.Password = *req.Password
	}
	if req.Token != nil {
		job.Token = *req.Token
	}
	if req.TLSSkipVerify != nil {
		job.TLSSkipVerify = *req.TLSSkipVerify
	}
	if req.CAFile != nil {
		job.CAFile = *req.CAFile
	}
	if req.LabelTemplateID != nil {
		job.LabelTemplateID = *req.LabelTemplateID
	}
	if req.BlackboxModule != nil {
		job.BlackboxModule = *req.BlackboxModule
	}
	if req.BlackboxTargets != nil {
		job.BlackboxTargets = req.BlackboxTargets
	}
	if req.Enabled != nil {
		job.Enabled = *req.Enabled
	}
}

// parseJobID 解析路径参数 id 为正整数；非法/缺省返回 false。
func parseJobID(c *gin.Context) (uint, bool) {
	raw := c.Param("id")
	v, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || v == 0 {
		return 0, false
	}
	return uint(v), true
}