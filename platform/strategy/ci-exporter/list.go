// Package ciexporter implements Module_01 CITypeExporterMapping（默认采集配置 /
// CI 类型采集映射）API：列表、CRUD 与 is_default 每类型唯一约束
// （PRD §5.1 / §6.2.1，api-contract-snapshot §4）。本文件提供列表接口
// GET /api/v2/platform/ci-exporter-mappings。
package ciexporter

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/common"
	"gorm.io/gorm"
)

// mappingListItem 是列表响应 item：完整 CITypeExporterMapping 追加
// has_label_template（需补配标签模板）与 is_referenced（被任一 ScrapeJob 引用，
// 供「未被引用」标记），并只读透传 ExporterTemplate.install_guide。
type mappingListItem struct {
	models.CITypeExporterMapping
	HasLabelTemplate bool   `json:"has_label_template"` // label_template_id 非空
	IsReferenced     bool   `json:"is_referenced"`      // 被 ScrapeJob 引用 → 未被引用标记
	InstallGuide     string `json:"install_guide"`      // 只读透传自 ExporterTemplate
}

// ListCITypeExporterMappings 返回分页、可筛选的默认采集配置列表。
//
// Query: monitor_type / is_default / page / page_size（默认 20，上限 100）。
// 响应 data：`{list, total, page, page_size}`。软删不进入列表，空结果返回空 list。
func ListCITypeExporterMappings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := common.ParsePageParams(c.Request.URL.Query())

		q := db.Model(&models.CITypeExporterMapping{})
		if mt := c.Query("monitor_type"); mt != "" {
			q = q.Where("monitor_type = ?", mt)
		}
		if raw := c.Query("is_default"); raw != "" && (raw == "true" || raw == "1") {
			q = q.Where("is_default = ?", true)
		} else if raw != "" && (raw == "false" || raw == "0") {
			q = q.Where("is_default = ?", false)
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count ci-exporter mappings: %w", err))
			return
		}

		var mappings []models.CITypeExporterMapping
		if err := q.Order("created_at desc").
			Offset((p.Page - 1) * p.PageSize).
			Limit(p.PageSize).
			Find(&mappings).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list ci-exporter mappings: %w", err))
			return
		}

		list := make([]mappingListItem, 0, len(mappings))
		for _, m := range mappings {
			item := mappingListItem{
				CITypeExporterMapping: m,
				HasLabelTemplate:      m.LabelTemplateID != "",
				IsReferenced:          mappingReferenced(db, m), //nolint:contextcheck // db 查询
			}
			tmpl, err := findExporterTemplate(db, m.ExporterTemplateID)
			if err == nil {
				item.InstallGuide = tmpl.InstallGuide
			}
			list = append(list, item)
		}

		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}

// mappingReferenced 报告映射 m 是否被任一活跃 ScrapeJob 引用（同 monitor_type +
// exporter_template_id 组合），供「未被引用」标记（api-contract-snapshot §4）。
func mappingReferenced(db *gorm.DB, m models.CITypeExporterMapping) bool {
	var count int64
	if err := db.Model(&models.ScrapeJob{}).
		Where("monitor_type = ? AND exporter_template_id = ?", m.MonitorType, m.ExporterTemplateID).
		Count(&count).Error; err != nil {
		return false
	}
	return count > 0
}

// findExporterTemplate 按 ExporterTemplateID（存 ID 字符串）读取采集器模板；
// 未命中返回错误（install_guide 透传忽略）。
func findExporterTemplate(db *gorm.DB, id string) (*models.ExporterTemplate, error) {
	var tmpl models.ExporterTemplate
	if err := db.First(&tmpl, id).Error; err != nil {
		return nil, err
	}
	return &tmpl, nil
}