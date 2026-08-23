// label_read.go 提供资源标签读取接口（GET /api/v2/platform/resources/:resource_id/labels，
// T07-11）：system 标签按该资源类型默认模板实时计算（不落库，§5.3 生成时机）+ user
// 标签从 ResourceLabel 表读取（source=user），合并后按来源优先级排序展示（system 在前、
// user 在后、cmdb 为 v0.4+ 预留占位），供资源详情标签管理联动呈现（§6.2/§6.6.2/§5.3）。
package resource

import (
	"fmt"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/config/label"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// labelItem 是标签读取接口的 item 契约：{id, key, value, source, source_map?}。
//
//   - id：库内标签（user / cmdb）为 ResourceLabel 真实主键，供编辑/删除定位；
//     system 标签实时计算、不落库，id 恒为 0（§5.3）；
//   - source_map：仅 system 标签携带（如 app_name→app），供前端标注「来自 XX 模板 ·
//     来源字段→目标标签」（§5.3 联动呈现），user / cmdb 无此字段。
type labelItem struct {
	ID        uint   `json:"id"`
	Key       string `json:"key"`
	Value     string `json:"value"`
	Source    string `json:"source"`
	SourceMap string `json:"source_map,omitempty"`
}

// labelSourcePriority 定义标签来源的展示排序（§6.6.2）：system 在前、user 在后、
// cmdb 为 v0.4+ 预留占位（最后）。注意该排序仅用于「展示顺序」，与 §8.2 的
// 「冲突覆盖优先级」（cmdb > user > system，system 不可被覆盖）是两回事。
var labelSourcePriority = map[models.LabelSource]int{
	models.LabelSourceSystem: 0,
	models.LabelSourceUser:   1,
	models.LabelSourceCMDB:   2,
}

// GetResourceLabels 是 GET /api/v2/platform/resources/:resource_id/labels 的读取 handler。
//
// 流程（§6.6.2 契约）：
//  1. 按 resource_id 定位资源（复用 T07-06 findResourceByID，跨五类表，GORM 排除软删）；
//     不存在/已软删 → not_found；
//  2. system 标签：取该资源类型的默认模板（T07-13 label.GetApplicableTemplate）实时
//     计算（label.ComputeSystemLabels，不落库）；无默认模板时 system 为空、不报错
//     （「适用模板」空态由 T07-13 查询层呈现，此处不因模板缺失阻断 user 标签展示）；
//  3. user 标签：从 ResourceLabel 表读取该资源的库内标签（source=user 落库；cmdb
//     为 v0.4+ 预留占位，若 Module_04 未来写入则自然落位）；
//  4. 合并去重 + 排序：system 与 user 同 key 时不重复展示，以 user 为准（§5.3 冲突
//     优先级：user 优先于 system 展示；user 不可覆盖 system 由写端 T07-12 拦截）；
//     按 labelSourcePriority 稳定排序输出 {items, total}。
//
// 本文件只实现 handler，不注册路由（路由收口见 T07-18）。
func GetResourceLabels(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		resourceID := strings.TrimSpace(c.Param("resource_id"))
		if resourceID == "" {
			response.BadRequest(c, fmt.Errorf("resource_id 必填"))
			return
		}

		category, model, found, err := findResourceByID(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}
		if !found {
			response.NotFound(c, fmt.Sprintf("资源 %s 不存在或已删除", resourceID))
			return
		}

		var system []labelItem
		if res, ok := model.(models.Resource); ok {
			system = computeSystemLabels(db, category, res)
		}

		stored, err := readStoredLabels(db, resourceID)
		if err != nil {
			response.InternalServerError(c, err)
			return
		}

		items := mergeLabels(system, stored)
		response.OK(c, gin.H{
			"items": items,
			"total": len(items),
		})
	}
}

// computeSystemLabels 按资源类型的默认模板实时计算 system 标签（不落库，§5.3）。
// 无默认模板时返回 nil（system 为空，不阻断 user 标签展示）。
func computeSystemLabels(db *gorm.DB, category models.ResourceCategory, res models.Resource) []labelItem {
	template, err := label.GetApplicableTemplate(db, category)
	if err != nil {
		return nil
	}
	computed := label.ComputeSystemLabels(template, res)
	items := make([]labelItem, 0, len(computed))
	for _, s := range computed {
		items = append(items, labelItem{
			Key:       s.Key,
			Value:     s.Value,
			Source:    string(models.LabelSourceSystem),
			SourceMap: s.SourceMap,
			// ID 留零：system 实时计算不落库，无真实库内主键（§5.3）。
		})
	}
	return items
}

// readStoredLabels 从 ResourceLabel 表读取该资源的库内标签（source=user 落库；cmdb
// 为 v0.4+ 预留占位，若未来由 Module_04 写入则一并读取）。已软删由 GORM 自动排除。
func readStoredLabels(db *gorm.DB, resourceID string) ([]labelItem, error) {
	var rows []models.ResourceLabel
	if err := db.Where("resource_id = ?", resourceID).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("读取资源 %s 标签失败：%w", resourceID, err)
	}
	items := make([]labelItem, 0, len(rows))
	for i := range rows {
		items = append(items, labelItem{
			ID:     rows[i].ID,
			Key:    rows[i].Key,
			Value:  rows[i].Value,
			Source: string(rows[i].Source),
		})
	}
	return items, nil
}

// mergeLabels 合并 system 与库内标签并按来源优先级展示：
//
//   - 同 key 冲突以 user 为准（§5.3：system 仅作为生成基线，同 key 时 user 覆盖 system
//     展示，不重复展示）；user 不可覆盖 system 由写端 T07-12 拦截，此处仅处理展示层；
//   - 稳定排序：system 在前、user 在后、cmdb 最后（v0.4+ 预留占位，§6.6.2）。
func mergeLabels(system, stored []labelItem) []labelItem {
	// 收集 user 已占用 key：同 key 时丢弃对应的 system 项。
	userKeys := make(map[string]bool, len(stored))
	for _, it := range stored {
		if it.Source == string(models.LabelSourceUser) {
			userKeys[it.Key] = true
		}
	}

	items := make([]labelItem, 0, len(system)+len(stored))
	for _, it := range system {
		if userKeys[it.Key] {
			continue
		}
		items = append(items, it)
	}
	items = append(items, stored...)

	sort.SliceStable(items, func(i, j int) bool {
		return labelSourcePriority[models.LabelSource(items[i].Source)] <
			labelSourcePriority[models.LabelSource(items[j].Source)]
	})
	return items
}
