package ciexporter

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateCITypeExporterMappingRequest 是创建默认采集配置的请求体
// （api-contract-snapshot §4）：monitor_type / exporter_template_id 必填；
// is_default 每类型至多一个；label_template_id 可空。
type CreateCITypeExporterMappingRequest struct {
	MonitorType        string `json:"monitor_type"`
	ExporterTemplateID string `json:"exporter_template_id"`
	IsDefault          bool   `json:"is_default"`
	DefaultPort        int    `json:"default_port"`
	MetricsPath        string `json:"metrics_path"`
	Scheme             string `json:"scheme"`
	ScrapeInterval     string `json:"scrape_interval"`
	ScrapeTimeout      string `json:"scrape_timeout"`
	LabelTemplateID    string `json:"label_template_id"`
}

// CreateCITypeExporterMapping 是 POST /api/v2/platform/ci-exporter-mappings 的
// handler：校验 exporter 存在、每 monitor_type 至多一个 is_default（重复
// bad_request）、label_template_id 存在性（可空）。创建非内置配置（决策：登记
// 非内置，预置映射由 seed 维护）。
func CreateCITypeExporterMapping(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateCITypeExporterMappingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid ci-exporter mapping payload: %w", err))
			return
		}
		if err := validateMappingReq(req, db); err != nil {
			response.BadRequest(c, err)
			return
		}

		m := &models.CITypeExporterMapping{
			MonitorType:        req.MonitorType,
			ExporterTemplateID: req.ExporterTemplateID,
			IsDefault:          req.IsDefault,
			DefaultPort:        req.DefaultPort,
			MetricsPath:        req.MetricsPath,
			Scheme:             req.Scheme,
			ScrapeInterval:     req.ScrapeInterval,
			ScrapeTimeout:      req.ScrapeTimeout,
			LabelTemplateID:    req.LabelTemplateID,
			IsBuiltin:          false,
		}
		if err := db.Create(m).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("create ci-exporter mapping: %w", err))
			return
		}
		response.OK(c, m)
	}
}

// validateMappingReq 校验创建请求：monitor_type 必填、exporter 存在、
// label_template_id 存在（可空）、每 monitor_type 至多一个 is_default。
func validateMappingReq(req CreateCITypeExporterMappingRequest, db *gorm.DB) error {
	if strings.TrimSpace(req.MonitorType) == "" {
		return fmt.Errorf("monitor_type 不能为空")
	}
	if strings.TrimSpace(req.ExporterTemplateID) == "" {
		return fmt.Errorf("exporter_template_id 不能为空")
	}
	if !models.ValidMonitorType(req.MonitorType) {
		return fmt.Errorf("monitor_type %q 非法的监控对象类型", req.MonitorType)
	}
	// exporter 存在。
	exporterID, err := strconv.ParseUint(req.ExporterTemplateID, 10, 64)
	if err != nil || exporterID == 0 {
		return fmt.Errorf("exporter_template_id %q 非法", req.ExporterTemplateID)
	}
	var tmpl models.ExporterTemplate
	if err := db.First(&tmpl, exporterID).Error; err != nil {
		return fmt.Errorf("exporter_template_id %d 不存在", exporterID)
	}
	// label_template_id 存在（可空）。
	if req.LabelTemplateID != "" {
		var lt models.LabelTemplate
		if err := db.First(&lt, "id = ?", req.LabelTemplateID).Error; err != nil {
			return fmt.Errorf("label_template_id %q 不存在", req.LabelTemplateID)
		}
	}
	// 每 monitor_type 至多一个 is_default。
	if err := ensureSingleDefault(db, req.MonitorType, req.IsDefault, 0); err != nil {
		return err
	}
	return nil
}

// ensureSingleDefault 保证 monitor_type 下 is_default 至多一个：当 wantDefault
// 为 true 时，若该类型已存在其他 is_default=true 记录（除 excludeID 外）则报错。
func ensureSingleDefault(db *gorm.DB, monitorType string, wantDefault bool, excludeID uint) error {
	if !wantDefault {
		return nil
	}
	var count int64
	q := db.Model(&models.CITypeExporterMapping{}).
		Where("monitor_type = ? AND is_default = ? AND id <> ?", monitorType, true, excludeID)
	if err := q.Count(&count).Error; err != nil {
		return fmt.Errorf("count default mappings: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("monitor_type %q 已存在默认采集配置，每类型仅允许一个 is_default=true", monitorType)
	}
	return nil
}