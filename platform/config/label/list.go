// Package label implements Module 07 标签模板管理：LabelTemplate 列表、CRUD、
// mappings 与关联实例查询。本文件提供 LabelTemplate 列表接口
// （GET /api/v2/platform/label-templates）。
package label

import (
	"fmt"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

const (
	// defaultPageSize 列表默认每页条数（MVP 分页从简，PRD §3.2）。
	defaultPageSize = 50
	// maxPageSize 每页条数上限（03_API_Standard §7.2）。
	maxPageSize = 100
)

// templateListItem 是列表响应 item：完整 LabelTemplate（含 serializer:json
// 解码后的完整 mappings）追加 instance_count——模板 resource_category 下现存
// 资源数（Module_07 §3.2「关联实例 N 个」；T07-17 的 count 同源）。
type templateListItem struct {
	models.LabelTemplate
	InstanceCount int64 `json:"instance_count"`
}

// ListLabelTemplates 返回分页、可筛选的标签模板列表。
//
// Query: resource_category / is_default / keyword(名称模糊) / page / page_size
// （默认 50，上限 100）。响应 data：`{list, total, page, page_size}`，每条 item
// 含完整 mappings 与 instance_count。软删模板不进入列表；空结果返回空 list。
func ListLabelTemplates(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		page := parseIntDefault(c.Query("page"), 1, 1)
		pageSize := parseIntDefault(c.Query("page_size"), defaultPageSize, 1)
		if pageSize > maxPageSize {
			pageSize = maxPageSize
		}

		q := db.Model(&models.LabelTemplate{})

		if cat := c.Query("resource_category"); cat != "" {
			q = q.Where("resource_category = ?", cat)
		}
		if raw := c.Query("is_default"); raw != "" {
			// 仅接受可解析的布尔值（true/false/1/0 等）；非法值忽略该筛选。
			if v, err := strconv.ParseBool(raw); err == nil {
				q = q.Where("is_default = ?", v)
			}
		}
		if kw := c.Query("keyword"); kw != "" {
			q = q.Where("name LIKE ?", "%"+kw+"%")
		}

		var total int64
		if err := q.Count(&total).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("count label templates: %w", err))
			return
		}

		var templates []models.LabelTemplate
		if err := q.Order("created_at desc").
			Offset((page - 1) * pageSize).
			Limit(pageSize).
			Find(&templates).Error; err != nil {
			response.InternalServerError(c, fmt.Errorf("list label templates: %w", err))
			return
		}

		counts, err := categoryResourceCounts(db, templates)
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("count resources by category: %w", err))
			return
		}

		list := make([]templateListItem, 0, len(templates))
		for _, t := range templates {
			list = append(list, templateListItem{
				LabelTemplate: t,
				InstanceCount: counts[t.ResourceCategory],
			})
		}

		response.OK(c, gin.H{
			"list":      list,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})
	}
}

// categoryResourceCounts 统计 templates 中各 resource_category 下的现存资源数
// （软删自动排除），用于计算 instance_count。每个去重 category 至多发一次 count 查询。
func categoryResourceCounts(db *gorm.DB, templates []models.LabelTemplate) (map[models.ResourceCategory]int64, error) {
	counts := make(map[models.ResourceCategory]int64)
	seen := make(map[models.ResourceCategory]struct{})
	for _, t := range templates {
		if _, ok := seen[t.ResourceCategory]; ok {
			continue
		}
		seen[t.ResourceCategory] = struct{}{}
		n, err := countCategoryResources(db, t.ResourceCategory)
		if err != nil {
			return nil, err
		}
		counts[t.ResourceCategory] = n
	}
	return counts, nil
}

// countCategoryResources 按 resource_category 路由到对应资源表并统计现存行数。
// 五类资源均嵌入 BaseModel（gorm.DeletedAt），GORM 自动追加 deleted_at IS NULL，
// 软删资源不计入。未知类型返回 0 且不报错。
func countCategoryResources(db *gorm.DB, cat models.ResourceCategory) (int64, error) {
	var target interface{}
	switch cat {
	case models.ResourceCategoryHost:
		target = &models.Host{}
	case models.ResourceCategoryDatabase:
		target = &models.Database{}
	case models.ResourceCategoryMiddleware:
		target = &models.Middleware{}
	case models.ResourceCategoryApplication:
		target = &models.Application{}
	case models.ResourceCategoryGenericTarget:
		target = &models.GenericTarget{}
	default:
		return 0, nil
	}
	var n int64
	if err := db.Model(target).Count(&n).Error; err != nil {
		return 0, err
	}
	return n, nil
}

// parseIntDefault 解析整数查询参数，缺省/非法/小于 min 时回退默认值。
func parseIntDefault(raw string, def, min int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < min {
		return def
	}
	return v
}
