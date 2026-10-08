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
// Query: monitor_type / is_default / label_template_id / page / page_size
// （默认 20，上限 100）。响应 data：`{list, total, page, page_size}`。软删不进入
// 列表，空结果返回空 list。
//
// label_template_id 为反查模式（label_template_id 必填），语义与
// GET /scrape-jobs?label_template_id= 对称：供 Module_07 标签模板删除的引用保护
// 聚合只读反查（PRD §6.6.3.1 决策 119）。响应体退化为 `{list, total}`（不分页），
// 详见 listMappingsByLabelTemplate。
func ListCITypeExporterMappings(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// label_template_id 反查模式：返回引用该标签模板的 CI 类型映射行。
		if ltID := c.Query("label_template_id"); ltID != "" {
			listMappingsByLabelTemplate(c, db, ltID)
			return
		}

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

// listMappingsByLabelTemplate 返回引用指定标签模板的 CI 类型映射行列表
// （label_template_id 必填反查）。模板不存在返回 not_found
//（api-contract-snapshot §5，与 scrapejob.listJobsByLabelTemplate 同约定）。
//
// 引用口径（PRD §6.6.3.1 决策 119）：
//   - 软删行（deleted_at 非空）不计入引用，由 GORM 软删自动过滤，不手动加条件；
//   - 不按 is_default / is_builtin 过滤——内置与每类型默认映射同样是有效引用方，
//     过滤掉会让「模板无人引用」的结论失真。
//
// 刻意与 Job 侧对称：不加任何额外过滤条件，也不分页（引用清单需完整回传）。
func listMappingsByLabelTemplate(c *gin.Context, db *gorm.DB, labelTemplateID string) {
	var lt models.LabelTemplate
	if err := db.First(&lt, "id = ?", labelTemplateID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			response.NotFound(c, fmt.Sprintf("label template %s not found", labelTemplateID))
			return
		}
		response.InternalServerError(c, fmt.Errorf("get label template %s: %w", labelTemplateID, err))
		return
	}

	var mappings []models.CITypeExporterMapping
	if err := db.Where("label_template_id = ?", labelTemplateID).
		Order("created_at desc").Find(&mappings).Error; err != nil {
		response.InternalServerError(c, fmt.Errorf("list ci-exporter mappings by label template: %w", err))
		return
	}
	list := make([]models.CITypeExporterMapping, 0, len(mappings))
	list = append(list, mappings...)
	response.OK(c, gin.H{"list": list, "total": int64(len(mappings))})
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