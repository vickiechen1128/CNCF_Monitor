// Package exportertemplate implements Module_01 ExporterTemplate（采集器模板）API：
// 列表筛选、登记（source=internal）、编辑与软删，内置模板只读保护
// （PRD §5.2 / §6.1 / §6.2，api-contract-snapshot §3）。本文件提供列表接口
// GET /api/v2/platform/exporter-templates。
package exportertemplate

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/common"
	"gorm.io/gorm"
)

// ListExporterTemplates 返回分页、可筛选的采集器模板列表。
//
// Query: monitor_type / source(optional)/ page / page_size（默认 20，上限 100）。
// 响应 data：`{list, total, page, page_size}`。软删模板不进入列表，空结果返回空 list。
func ListExporterTemplates(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := common.ParsePageParams(c.Request.URL.Query())

		// monitor_type 命中 supported_monitor_types（serializer:json 数组）中的元素。
		// SQLite 下用 LIKE 兜底；GORM serializer:json 在 JSON1 上可支持 json_each，
		// 这里以可移植的 LIKE 子串匹配实现住宅筛选。
		q := db.Model(&models.ExporterTemplate{})
		if mt := c.Query("monitor_type"); mt != "" {
			q = q.Where("supported_monitor_types LIKE ?", "%"+mt+"%")
		}
		if src := c.Query("source"); src != "" {
			q = q.Where("source = ?", src)
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count exporter templates: %w", err))
			return
		}

		var templates []models.ExporterTemplate
		if err := q.Order("created_at desc").
			Offset((p.Page - 1) * p.PageSize).
			Limit(p.PageSize).
			Find(&templates).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list exporter templates: %w", err))
			return
		}

		list := make([]models.ExporterTemplate, 0, len(templates))
		list = append(list, templates...)

		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}