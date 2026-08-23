package ciexporter

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// UpdateCITypeExporterMappingRequest 是更新默认采集配置的请求体：可改参数
// （api-contract-snapshot §4）。
type UpdateCITypeExporterMappingRequest struct {
	MonitorType        *string `json:"monitor_type"`
	ExporterTemplateID *string `json:"exporter_template_id"`
	IsDefault          *bool   `json:"is_default"`
	DefaultPort        *int    `json:"default_port"`
	MetricsPath        *string `json:"metrics_path"`
	Scheme             *string `json:"scheme"`
	ScrapeInterval     *string `json:"scrape_interval"`
	ScrapeTimeout      *string `json:"scrape_timeout"`
	LabelTemplateID    *string `json:"label_template_id"`
}

// UpdateCITypeExporterMapping 是 PUT /api/v2/platform/ci-exporter-mappings/:id
// 的 handler：可改参数；is_default 保持每类型唯一（bad_request）；未命中 not_found。
func UpdateCITypeExporterMapping(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseMappingID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("id 非法"))
			return
		}
		var req UpdateCITypeExporterMappingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid ci-exporter mapping payload: %w", err))
			return
		}

		var m models.CITypeExporterMapping
		if err := db.First(&m, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("ci-exporter mapping %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get ci-exporter mapping %d: %w", id, err))
			return
		}

		// 记录最终生效的 monitor_type / is_default 用于后续唯一性校验。
		monitorType := m.MonitorType
		isDefault := m.IsDefault

		if req.MonitorType != nil {
			if !models.ValidMonitorType(*req.MonitorType) {
				response.BadRequest(c, fmt.Errorf("monitor_type %q 非法的监控对象类型", *req.MonitorType))
				return
			}
			monitorType = *req.MonitorType
			m.MonitorType = *req.MonitorType
		}
		if req.IsDefault != nil {
			isDefault = *req.IsDefault
			m.IsDefault = *req.IsDefault
		}
		if req.ExporterTemplateID != nil {
			if err := verifyExporter(db, *req.ExporterTemplateID); err != nil {
				response.BadRequest(c, err)
				return
			}
			m.ExporterTemplateID = *req.ExporterTemplateID
		}
		if req.DefaultPort != nil {
			m.DefaultPort = *req.DefaultPort
		}
		if req.MetricsPath != nil {
			m.MetricsPath = *req.MetricsPath
		}
		if req.Scheme != nil {
			m.Scheme = *req.Scheme
		}
		if req.ScrapeInterval != nil {
			m.ScrapeInterval = *req.ScrapeInterval
		}
		if req.ScrapeTimeout != nil {
			m.ScrapeTimeout = *req.ScrapeTimeout
		}
		if req.LabelTemplateID != nil {
			if *req.LabelTemplateID != "" {
				var lt models.LabelTemplate
				if err := db.First(&lt, "id = ?", *req.LabelTemplateID).Error; err != nil {
					response.BadRequest(c, fmt.Errorf("label_template_id %q 不存在", *req.LabelTemplateID))
					return
				}
			}
			m.LabelTemplateID = *req.LabelTemplateID
		}

		// is_default 每 monitor_type 唯一。
		if err := ensureSingleDefault(db, monitorType, isDefault, id); err != nil {
			response.BadRequest(c, err)
			return
		}

		if err := db.Save(&m).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("update ci-exporter mapping %d: %w", id, err))
			return
		}
		response.OK(c, m)
	}
}

// verifyExporter 校验 exporter_template_id 对应采集器存在。
func verifyExporter(db *gorm.DB, id string) error {
	v, err := strconv.ParseUint(id, 10, 64)
	if err != nil || v == 0 {
		return fmt.Errorf("exporter_template_id %q 非法", id)
	}
	var tmpl models.ExporterTemplate
	if err := db.First(&tmpl, v).Error; err != nil {
		return fmt.Errorf("exporter_template_id %s 不存在", id)
	}
	return nil
}

// parseMappingID 解析路径参数 id 为正整数；非法/缺省返回 false。
func parseMappingID(c *gin.Context) (uint, bool) {
	raw := c.Param("id")
	v, err := strconv.ParseUint(raw, 10, 64)
	if err != nil || v == 0 {
		return 0, false
	}
	return uint(v), true
}