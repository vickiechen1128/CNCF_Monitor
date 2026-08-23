package rule

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/strategy/common"
	"gorm.io/gorm"
)

// ListMonitoringRules 返回分页、可筛选的规则挂载列表。
//
// Query: rule_type / enabled / keyword / page / page_size（默认 20，上限 100）。
// 响应 data：`{list, total, page, page_size}`。item 含 content_mode / rule_content /
// name / enabled / change_status / draft_status。软删不进入列表，空结果返回空 list。
func ListMonitoringRules(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := common.ParsePageParams(c.Request.URL.Query())

		q := db.Model(&models.MonitoringRule{})
		if rt := c.Query("rule_type"); rt != "" {
			q = q.Where("rule_type = ?", rt)
		}
		if raw := c.Query("enabled"); raw != "" && (raw == "true" || raw == "1") {
			q = q.Where("enabled = ?", true)
		} else if raw != "" && (raw == "false" || raw == "0") {
			q = q.Where("enabled = ?", false)
		}
		if kw := c.Query("keyword"); kw != "" {
			q = q.Where("name LIKE ?", "%"+strings.TrimSpace(kw)+"%")
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count monitoring rules: %w", err))
			return
		}

		var rules []models.MonitoringRule
		if err := q.Order("created_at desc").
			Offset((p.Page - 1) * p.PageSize).
			Limit(p.PageSize).
			Find(&rules).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list monitoring rules: %w", err))
			return
		}

		list := make([]models.MonitoringRule, 0, len(rules))
		list = append(list, rules...)
		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      p.Page,
			"page_size": p.PageSize,
		})
	}
}