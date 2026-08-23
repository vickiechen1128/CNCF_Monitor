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
	Name                  string              `json:"name"`
	Version               string              `json:"version"`
	DefaultPort           int                 `json:"default_port"`
	MetricsPath           string              `json:"metrics_path"`
	Scheme                string              `json:"scheme"`
	SupportedMonitorTypes []string            `json:"supported_monitor_types"`
	OS                    string              `json:"os"`
	Arch                  string              `json:"arch"`
	DownloadURL           string              `json:"download_url"`
	Homepage              string              `json:"homepage"`
	InstallGuide          string              `json:"install_guide"`
	Source                models.ExporterSource `json:"source"`
	IsBuiltin             *bool               `json:"is_builtin"`
}

// CreateExporterTemplate 是 POST /api/v2/platform/exporter-templates 的 handler：
// 登记自建采集器（source=internal），登记即入池。
//
// 校验（api-contract-snapshot §10）：name/metrics_path/scheme 必填；source=internal
// 追加 default_port 必填；source=official|third_party 为平台预置只读，拒绝登记
// （bad_request）；is_builtin 强制 false 且显式传 true 拒绝（bad_request）。
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

		// name 唯一（GORM 唯一索引兜底，查询提前校验给友好错误）。
		var dup int64
		if err := db.Model(&models.ExporterTemplate{}).Where("name = ?", req.Name).Count(&dup).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("check duplicate exporter template: %w", err))
			return
		}
		if dup > 0 {
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

// validateCreateExporterTemplate 校验登记请求：source 必填且为 internal
// （official/third_party 平台预置只读）；name/metrics_path/scheme 必填；
// source=internal 追加 default_port 必填；is_builtin 显式 true 拒绝。
func validateCreateExporterTemplate(req *CreateExporterTemplateRequest) error {
	if strings.TrimSpace(req.Name) == "" {
		return fmt.Errorf("name 不能为空")
	}
	// 用户登记仅允许 internal（official/third_party 平台预置只读）。
	if req.Source != models.ExporterSourceInternal {
		return fmt.Errorf("source 必须为 internal（official/third_party 为平台预置只读）")
	}
	if req.DefaultPort <= 0 {
		return fmt.Errorf("source=internal 时 default_port 必填且大于 0")
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
	return nil
}