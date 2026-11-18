// Package metriclibrary implements Module_01 技术指标库（ExporterMetricLibrary
// §5.3）API：只读列表筛选 + 用户扩展创建 + 内置只读保护（api-contract-snapshot
// §8，PRD §6.2.3）。
package metriclibrary

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/common"
	"gorm.io/gorm"
)

// ListMetricLibrary 返回分页、可筛选的技术指标库列表。
//
// Query: monitor_type / metric_type / category / keyword / page / page_size
// （默认 20，上限 100）。monitor_type 通过 monitor_types 锚点 JSON 精确匹配。
// 响应 data：`{list, total, page, page_size}`。空结果返回空 list。
func ListMetricLibrary(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := common.ParsePageParams(c.Request.URL.Query())

		q := db.Model(&models.ExporterMetricLibrary{})
		if mt := c.Query("monitor_type"); mt != "" {
			// monitor_types 以 JSON 存储，锚点精确匹配改为 Like 精确锚点对象。
			q = q.Where("monitor_types LIKE ?", "%\"monitor_type\":\""+mt+"\"%")
		}
		if mtype := c.Query("metric_type"); mtype != "" {
			q = q.Where("metric_type = ?", mtype)
		}
		if cat := c.Query("category"); cat != "" {
			q = q.Where("category = ?", cat)
		}
		if kw := c.Query("keyword"); kw != "" {
			q = q.Where("metric_name LIKE ?", "%"+kw+"%")
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count metric library: %w", err))
			return
		}

		var metrics []models.ExporterMetricLibrary
		if err := q.Order("created_at desc").
			Offset((p.Page - 1) * p.PageSize).
			Limit(p.PageSize).
			Find(&metrics).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list metric library: %w", err))
			return
		}

		list := make([]models.ExporterMetricLibrary, 0, len(metrics))
		list = append(list, metrics...)
		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}