package metriclibrary

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CreateMetricLibraryRequest 是用户扩展指标库条目的请求体（api-contract-snapshot
// §8）：metric_name/metric_type/monitor_types 必填；is_builtin 强制 false（内置只读）。
type CreateMetricLibraryRequest struct {
	MetricName         string                     `json:"metric_name"`
	MetricType         string                     `json:"metric_type"`
	Help               string                     `json:"help"`
	Unit               string                     `json:"unit"`
	Labels             []string                   `json:"labels"`
	MonitorTypes       []models.ExporterMetricAnchor `json:"monitor_types"`
	Category           string                     `json:"category"`
	ExporterTemplateID string                     `json:"exporter_template_id"`
	Enabled            bool                       `json:"enabled"`
}

// CreateMetricLibrary 是 POST /api/v2/platform/metric-library 的 handler：用户扩展
// （is_builtin=false）。metric_name+monitor_types 判重；monitor_type∈ValidMonitorTypes；
// 内置拒绝写。
func CreateMetricLibrary(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req CreateMetricLibraryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid metric library payload: %w", err))
			return
		}
		if err := validateCreate(req, db); err != nil {
			response.BadRequest(c, err)
			return
		}

		metrics := &models.ExporterMetricLibrary{
			MetricName:         req.MetricName,
			MetricType:         models.MetricType(req.MetricType),
			Help:               req.Help,
			Unit:               req.Unit,
			Labels:             req.Labels,
			MonitorTypes:       req.MonitorTypes,
			Category:           req.Category,
			ExporterTemplateID: req.ExporterTemplateID,
			IsBuiltin:          false,
			Enabled:            req.Enabled,
		}
		if err := db.Create(metrics).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("create metric library: %w", err))
			return
		}
		response.OK(c, metrics)
	}
}

// validateCreate 校验创建请求：metric_name/metric_type/monitor_types 必填、
// metric_type∈ValidMetricTypes、monitor_type∈ValidMonitorTypes、metric_name+
// monitor_types 判重（同 monitor_type+source 组合，供同名不同义区分）。
func validateCreate(req CreateMetricLibraryRequest, db *gorm.DB) error {
	if strings.TrimSpace(req.MetricName) == "" {
		return fmt.Errorf("metric_name 不能为空")
	}
	if !models.ValidMetricType(req.MetricType) {
		return fmt.Errorf("metric_type %q 非法", req.MetricType)
	}
	if len(req.MonitorTypes) == 0 {
		return fmt.Errorf("monitor_types 不能为空")
	}
	for _, a := range req.MonitorTypes {
		if !models.ValidMonitorType(strings.TrimSpace(a.MonitorType)) {
			return fmt.Errorf("monitor_type %q 非法", a.MonitorType)
		}
	}
	// metric_name + monitor_types（monitor_type 锚点）判重：同 metric_name 且
	// monitor_type 出现时即算重复（MV 同名不同义由 source 区分，简化判重以 metric_name+
	// 任一 monitor_type 命中为准）。
	var count int64
	if err := db.Model(&models.ExporterMetricLibrary{}).
		Where("metric_name = ? AND monitor_types LIKE ?", req.MetricName, "%\"monitor_type\":\""+req.MonitorTypes[0].MonitorType+"\"%").
		Count(&count).Error; err != nil {
		return fmt.Errorf("count metric library duplicate: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("metric_name %q 在 monitor_type %q 下已存在", req.MetricName, req.MonitorTypes[0].MonitorType)
	}
	return nil
}

// UpdateMetricLibrary 是 PUT /api/v2/platform/metric-library/:metric_id 的 handler：
// 仅可改 is_builtin=false 项的 enabled/help/unit/monitor_types/category；内置 forbidden；
// not_found。
func UpdateMetricLibrary(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := c.Param("metric_id")
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || id == 0 {
			response.BadRequest(c, fmt.Errorf("metric_id 非法"))
			return
		}
		var metric models.ExporterMetricLibrary
		if err := db.First(&metric, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("metric library %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get metric library %d: %w", id, err))
			return
		}
		if metric.IsBuiltin {
			response.Forbidden(c, "内置指标只读，不可修改")
			return
		}
		var req struct {
			Enabled      *bool                            `json:"enabled"`
			Help         *string                          `json:"help"`
			Unit         *string                          `json:"unit"`
			MonitorTypes []models.ExporterMetricAnchor    `json:"monitor_types"`
			Category     *string                          `json:"category"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			response.BadRequest(c, fmt.Errorf("invalid metric library payload: %w", err))
			return
		}
		if req.Enabled != nil {
			metric.Enabled = *req.Enabled
		}
		if req.Help != nil {
			metric.Help = *req.Help
		}
		if req.Unit != nil {
			metric.Unit = *req.Unit
		}
		if req.MonitorTypes != nil {
			for _, a := range req.MonitorTypes {
				if !models.ValidMonitorType(strings.TrimSpace(a.MonitorType)) {
					response.BadRequest(c, fmt.Errorf("monitor_type %q 非法", a.MonitorType))
					return
				}
			}
			metric.MonitorTypes = req.MonitorTypes
		}
		if req.Category != nil {
			metric.Category = *req.Category
		}
		if err := db.Save(metric).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("update metric library %d: %w", id, err))
			return
		}
		response.OK(c, metric)
	}
}