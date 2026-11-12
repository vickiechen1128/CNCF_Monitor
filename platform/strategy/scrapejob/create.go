package scrapejob

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateScrapeJobRequest 是创建采集 Job 的请求体（api-contract-snapshot §5）。
type CreateScrapeJobRequest struct {
	JobName               string                       `json:"job_name"`
	JobType               models.JobType               `json:"job_type"`
	MonitorType           string                       `json:"monitor_type"`
	ExporterTemplateID    string                       `json:"exporter_template_id"`
	NetworkDomainID       string                       `json:"network_domain_id"`
	InstanceSelectionMode models.InstanceSelectionMode `json:"instance_selection_mode"`
	SelectedInstanceIDs   []string                     `json:"selected_instance_ids"`
	ScrapeInterval        string                       `json:"scrape_interval"`
	ScrapeTimeout         string                       `json:"scrape_timeout"`
	MetricsPath           string                       `json:"metrics_path"`
	Scheme                string                       `json:"scheme"`
	AuthType              models.AuthType              `json:"auth_type"`
	Username              string                       `json:"username"`
	Password              string                       `json:"password"`
	Token                 string                       `json:"token"`
	TLSSkipVerify         bool                         `json:"tls_skip_verify"`
	CAFile                string                       `json:"ca_file"`
	LabelTemplateID       string                       `json:"label_template_id"`
	BlackboxModule        string                       `json:"blackbox_module"`
	BlackboxTargets       []models.BlackboxTarget      `json:"blackbox_targets"`
	// ResourceType（拨测目标资源类别）仅 blackbox 使用，且只能是接口服务 / 应用服务；
	// TargetField（探测地址字段）已不再由调用方决定 —— 保留 JSON 字段以兼容旧客户端，
	// 但落库前会被 validateJobRequest 按 ResourceType 推导覆盖。
	ResourceType     models.ResourceType      `json:"resource_type"`
	TargetField      string                   `json:"target_field"`
	MappingOverrides []models.MappingOverride `json:"mapping_overrides"`
	Enabled          bool                     `json:"enabled"`
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
		// 保存入口统一校验 job_name：targets 文件名直接使用 job_name，
		// 故只拦截「无法作为文件名」的字符（中文、字母、数字等均允许）。
		if err := models.ValidateJobName(req.JobName); err != nil {
			response.BadRequest(c, err)
			return
		}
		// job_name 唯一（大小写不敏感：Windows 文件系统下 Host/host 会落到同一个
		// targets 文件）。同名软删残留由 resolveJobNameConflict 物理清理后释放唯一索引。
		taken, err := resolveJobNameConflict(db, req.JobName, 0)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if taken {
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
			ResourceType:          req.ResourceType,
			TargetField:           req.TargetField,
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
			MappingOverrides:      req.MappingOverrides,
			Enabled:               req.Enabled,
			DraftStatus:           draftStatus,
			ChangeStatus:          models.ChangeStatusPending,
		}

		if draftStatus == "draft" {
			// 保存草稿：仅基础校验（字段类型 / 名称唯一性），不参与 M09 配置生成。
			// 草稿不走 resolveJobScrapeParams，故此处单独归一采集路径，避免带空格的
			// 路径先落库、再由批量提交生效（batch.BatchSubmitReady）时才被动纠正。
			normalizeScrapePath(job)
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
	if err := models.ValidateJobName(job.JobName); err != nil {
		return err
	}
	if job.JobType != models.JobTypeStandard && job.JobType != models.JobTypeBlackbox {
		return fmt.Errorf("job_type 非法，可选 standard/blackbox")
	}
	return nil
}
