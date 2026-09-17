package exportertemplate

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateExporterTemplateRequest 是登记采集器模板的请求体（source=internal）。
type CreateExporterTemplateRequest struct {
	Name                  string                `json:"name"`
	Version               string                `json:"version"`
	DefaultPort           int                   `json:"default_port"`
	MetricsPath           string                `json:"metrics_path"`
	Scheme                string                `json:"scheme"`
	SupportedMonitorTypes []string              `json:"supported_monitor_types"`
	OS                    string                `json:"os"`
	Arch                  string                `json:"arch"`
	DownloadURL           string                `json:"download_url"`
	Homepage              string                `json:"homepage"`
	InstallGuide          string                `json:"install_guide"`
	Description           string                `json:"description"`
	Source                models.ExporterSource `json:"source"`
	IsBuiltin             *bool                 `json:"is_builtin"`
}

// CreateExporterTemplate 是 POST /api/v2/platform/exporter-templates 的 handler：
// 登记采集器（source=official/third_party/internal 均可，登记即入池；用户登记的
// official/third_party 非平台预置，恒 is_builtin=false，与 seed 内置行仅靠 name 唯一区分）。
//
// 校验（api-contract-snapshot §10）：name/default_port/metrics_path/scheme 必填；
// source 为三枚举之一；与预置 seed 同名返回 409 conflict；is_builtin 强制 false
// 且显式传 true 拒绝（bad_request）。
func CreateExporterTemplate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateExporterTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid exporter template payload: %w", err))
			return
		}
		if err := validateCreateExporterTemplate(&req); err != nil {
			response.BadRequest(c, err)
			return
		}

		// name 唯一（GORM 唯一索引兜底，提前查询给友好错误）。
		// 软删兼容：delete.go 使用软删，name 唯一索引仍被已软删行占用。
		// 用 Unscoped 连软删行一起查——GORM 默认作用域（deleted_at IS NULL）会
		// 看不见软删行，导致同名重建时 INSERT 命中 DB 唯一约束而抛 internal error。
		// 仅软删残留时先物理清理旧行释放索引，再允许用户重建同名采集器。
		var existing models.ExporterTemplate
		if err := db.Unscoped().Where("name = ?", req.Name).First(&existing).Error; err != nil {
			if err != gorm.ErrRecordNotFound {
				response.InternalServerError(c, fmt.Errorf("check duplicate exporter template: %w", err))
				return
			}
		} else if existing.DeletedAt.Valid {
			if err := db.Unscoped().Delete(&existing).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("purge soft-deleted exporter template %q: %w", req.Name, err))
				return
			}
		} else {
			response.Conflict(c, fmt.Errorf("采集器 %q 已存在", req.Name))
			return
		}

		tmpl := &models.ExporterTemplate{
			Name:                  req.Name,
			Version:               req.Version,
			DefaultPort:           req.DefaultPort,
			MetricsPath:           req.MetricsPath,
			Scheme:                req.Scheme,
			SupportedMonitorTypes: req.SupportedMonitorTypes,
			OS:                    req.OS,
			Arch:                  req.Arch,
			DownloadURL:           req.DownloadURL,
			Homepage:              req.Homepage,
			InstallGuide:          req.InstallGuide,
			Description:           req.Description,
			Source:                req.Source,
			IsBuiltin:             false, // 登记恒非内置
		}
		if err := db.Create(tmpl).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("create exporter template %q: %w", req.Name, err))
			return
		}
		response.OK(c, tmpl)
	}
}

// validateCreateExporterTemplate 校验登记请求：source 为三枚举之一
// （official/third_party/internal，均允许用户登记；与 seed 同名由 name 唯一索引防重合）；
// name/default_port/metrics_path/scheme 必填；is_builtin 显式 true 拒绝。
func validateCreateExporterTemplate(req *CreateExporterTemplateRequest) error {
	if strings.TrimSpace(req.Name) == "" {
		return fmt.Errorf("name 不能为空")
	}
	// source 校验：仅接受三枚举，避免非法值入库。
	switch req.Source {
	case models.ExporterSourceOfficial, models.ExporterSourceThirdParty, models.ExporterSourceInternal:
	default:
		return fmt.Errorf("source 必须为 official/third_party/internal 之一")
	}
	if req.DefaultPort <= 0 {
		return fmt.Errorf("default_port 必填且大于 0")
	}
	if strings.TrimSpace(req.MetricsPath) == "" {
		return fmt.Errorf("metrics_path 不能为空")
	}
	if strings.TrimSpace(req.Scheme) == "" {
		return fmt.Errorf("scheme 不能为空")
	}
	if req.IsBuiltin != nil && *req.IsBuiltin {
		return fmt.Errorf("is_builtin 不可由用户写为 true（内置采集器只读）")
	}
	// download_url/homepage 非空时须具备合法 http/https scheme 与非空 host（security）。
	if err := validateHTTPURL("download_url", req.DownloadURL); err != nil {
		return err
	}
	if err := validateHTTPURL("homepage", req.Homepage); err != nil {
		return err
	}
	return nil
}
