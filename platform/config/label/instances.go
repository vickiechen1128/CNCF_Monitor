// 本文件提供 LabelTemplate 关联实例查询接口
// （GET /api/v2/platform/label-templates/:template_id/resources）：按模板的
// resource_category 隐式关联到对应资源表，分页返回该类型下全部资源（未软删），
// 用于标签模板页「关联实例 N 个」展开（Module_07 §3.2 / §6.3 / §6.6.3）。
package label

import (
	"fmt"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// defaultInstancePageSize 关联实例列表默认每页条数（Module_07 §11.1：关联实例
// Table 分页 pageSize=10，避免大列表长页滚动）。上限复用 maxPageSize（100）。
const defaultInstancePageSize = 10

// templateInstanceItem 是关联实例列表 item（Module_07 §6.3 / §6.6.3）：
// resource_id + 展示名 + status。展示名按类型取对应字段（PRD §5 展示口径）——
// host=instance_name、application=service_name、database/middleware=instance_ip、
// generic_target=target_name，统一暴露为 instance_name 字段。
type templateInstanceItem struct {
	ResourceID   string `json:"resource_id"`
	InstanceName string `json:"instance_name"`
	Status       string `json:"status"`
}

// ListTemplateResources 是 GET /api/v2/platform/label-templates/:template_id/resources
// 的 handler：按模板 resource_category 路由到对应资源表查询（隐式关联——该类型下
// 全部资源自动适用，Module_07 §3.2），支持 keyword（展示名模糊）/ status（等值）
// 服务端筛选（PRD §11.1，K-2 闭环）与 page/page_size（默认 10，上限 100）。
// 响应 data：`{items:[{resource_id, instance_name, status}], total, page, page_size}`。
// 模板不存在/已软删返回 not_found；该类型无资源返回空 list。
func ListTemplateResources(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, ok := parseTemplateID(c)
		if !ok {
			response.BadRequest(c, fmt.Errorf("template_id 非法"))
			return
		}

		var tmpl models.LabelTemplate
		if err := db.First(&tmpl, id).Error; err != nil {
			if err == gorm.ErrRecordNotFound {
				response.NotFound(c, fmt.Sprintf("label template %d not found", id))
				return
			}
			response.InternalServerError(c, fmt.Errorf("get label template %d: %w", id, err))
			return
		}

		page := parseIntDefault(c.Query("page"), 1, 1)
		pageSize := parseIntDefault(c.Query("page_size"), defaultInstancePageSize, 1)
		if pageSize > maxPageSize {
			pageSize = maxPageSize
		}

		items, total, err := listCategoryInstances(db, tmpl.ResourceCategory, page, pageSize,
			strings.TrimSpace(c.Query("keyword")), strings.TrimSpace(c.Query("status")))
		if err != nil {
			response.InternalServerError(c, fmt.Errorf("list template resources: %w", err))
			return
		}

		response.OK(c, gin.H{
			"items":     items,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})
	}
}

// listCategoryInstances 按 resource_category 路由到对应资源表（复用 T07-14
// countCategoryResources 的「按 category 路由」写法，但直接读各模型字段、不依赖
// platform/config/resource），按 keyword/status 服务端筛选（PRD §11.1，K-2），
// 分页返回现存（未软删）资源。五类资源均嵌入 BaseModel（gorm.DeletedAt），GORM
// 自动追加 deleted_at IS NULL。keyword 按类型匹配展示名列（host=instance_name、
// database/middleware=instance_ip、application=service_name、generic_target=
// target_name）；status 等值匹配 status 列。未知类型返回空 list 且不报错。
func listCategoryInstances(db *gorm.DB, cat models.ResourceCategory, page, pageSize int, keyword, status string) ([]templateInstanceItem, int64, error) {
	switch cat {
	case models.ResourceCategoryHost:
		return queryInstances(db, &[]models.Host{}, page, pageSize, keyword, status,
			"instance_name", func(h *models.Host) string { return h.InstanceName })
	case models.ResourceCategoryDatabase:
		return queryInstances(db, &[]models.Database{}, page, pageSize, keyword, status,
			"instance_ip", func(d *models.Database) string { return d.InstanceIP })
	case models.ResourceCategoryMiddleware:
		return queryInstances(db, &[]models.Middleware{}, page, pageSize, keyword, status,
			"instance_ip", func(m *models.Middleware) string { return m.InstanceIP })
	case models.ResourceCategoryApplication:
		return queryInstances(db, &[]models.Application{}, page, pageSize, keyword, status,
			"service_name", func(a *models.Application) string { return a.ServiceName })
	case models.ResourceCategoryGenericTarget:
		return queryInstances(db, &[]models.GenericTarget{}, page, pageSize, keyword, status,
			"target_name", func(g *models.GenericTarget) string { return g.TargetName })
	default:
		return []templateInstanceItem{}, 0, nil
	}
}

// queryInstances 在 rows（对应资源模型切片）上按 keyword/status 筛选并分页查询
// 现存资源，映射为关联实例 item：resource_id/status 经 models.Resource 接口读取
// （五类资源均以指针接收器实现该接口，故 `&(*rows)[i]` 的断言安全），展示名由
// name 提取器按类型取对应字段。keywordCol 是该类型 keyword 匹配的列名（展示名
// 列）。items 始终为非 nil 切片，保证空结果序列化为 [] 而非 null。
func queryInstances[T any](db *gorm.DB, rows *[]T, page, pageSize int, keyword, status, keywordCol string, name func(*T) string) ([]templateInstanceItem, int64, error) {
	q := db.Model(rows)
	if keyword != "" {
		q = q.Where(keywordCol+" LIKE ?", "%"+keyword+"%")
	}
	if status != "" {
		q = q.Where("status = ?", status)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := q.
		Order("created_at desc").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(rows).Error; err != nil {
		return nil, 0, err
	}

	items := make([]templateInstanceItem, 0, len(*rows))
	for i := range *rows {
		res := any(&(*rows)[i]).(models.Resource)
		items = append(items, templateInstanceItem{
			ResourceID:   res.GetResourceID(),
			InstanceName: name(&(*rows)[i]),
			Status:       res.GetStatus(),
		})
	}
	return items, total, nil
}
