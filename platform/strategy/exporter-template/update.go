package exportertemplate

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// UpdateExporterTemplateRequest 是更新采集器模板的请求体：内部模板可改，
// 内置（is_builtin=true，source=official|third_party）只读。
type UpdateExporterTemplateRequest struct {
	Name                  *string                `json:"name"`
	Version               *string                `json:"version"`
	DefaultPort           *int                   `json:"default_port"`
	MetricsPath           *string                `json:"metrics_path"`
	Scheme                *string                `json:"scheme"`
	SupportedMonitorTypes []string               `json:"supported_monitor_types"`
	OS                    *string                `json:"os"`
	Arch                  *string                `json:"arch"`
	DownloadURL           *string                `json:"download_url"`
	Homepage              *string                `json:"homepage"`
	InstallGuide          *string                `json:"install_guide"`
	Source                *models.ExporterSource `json:"source"`
}

// UpdateExporterTemplate 是 PUT /api/v2/platform/exporter-templates/:id 的
// handler：内部模板可改字段；内置（is_builtin）只读返回 forbidden；未命中 not_found
// （api-contract-snapshot §3 §10）。
func UpdateExporterTemplate(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var req UpdateExporterTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid exporter template payload: %w", err))
			return
		}

		var tmpl models.ExporterTemplate
		if err := db.First(&tmpl, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("exporter template %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get exporter template %d: %w", id, err))
			return
		}
		if tmpl.IsBuiltin {
			response.Forbidden(c, fmt.Sprintf("内置采集器模板 %q 只读，禁止修改", tmpl.Name))
			return
		}

		if req.Name != nil {
			var dup int64
			if err := db.Model(&models.ExporterTemplate{}).
				Where("name = ? AND id <> ?", *req.Name, tmpl.ID).
				Count(&dup).Error; err != nil {
				response.InternalServerError(c, fmt.Errorf("check duplicate exporter template: %w", err))
				return
			}
			if dup > 0 {
				response.Conflict(c, fmt.Errorf("采集器 %q 已存在", *req.Name))
				return
			}
			tmpl.Name = *req.Name
		}
		if req.Version != nil {
			tmpl.Version = *req.Version
		}
		if req.DefaultPort != nil {
			tmpl.DefaultPort = *req.DefaultPort
		}
		if req.MetricsPath != nil {
			tmpl.MetricsPath = *req.MetricsPath
		}
		if req.Scheme != nil {
			tmpl.Scheme = *req.Scheme
		}
		if req.SupportedMonitorTypes != nil {
			tmpl.SupportedMonitorTypes = req.SupportedMonitorTypes
		}
		if req.OS != nil {
			tmpl.OS = *req.OS
		}
		if req.Arch != nil {
			tmpl.Arch = *req.Arch
		}
		if req.DownloadURL != nil {
			if err := validateHTTPURL("download_url", *req.DownloadURL); err != nil {
				response.BadRequest(c, err)
				return
			}
			tmpl.DownloadURL = *req.DownloadURL
		}
		if req.Homepage != nil {
			if err := validateHTTPURL("homepage", *req.Homepage); err != nil {
				response.BadRequest(c, err)
				return
			}
			tmpl.Homepage = *req.Homepage
		}
		if req.InstallGuide != nil {
			tmpl.InstallGuide = *req.InstallGuide
		}
		if req.Source != nil {
			tmpl.Source = *req.Source
		}

		if err := db.Save(&tmpl).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("update exporter template %d: %w", id, err))
			return
		}
		response.OK(c, tmpl)
	}
}

// parseTemplateID 解析路径参数 id 为正整数；非法/缺省返回 false。
func parseTemplateID(c *gin.Context) (uint, bool) {
	raw := c.Param("id")
	v, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || v == 0 {
		return 0, false
	}
	return uint(v), true
}
