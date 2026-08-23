package resource

import (
	"fmt"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
)

// Rule 是可配置状态映射规则，对应 PRD §5.5.2 的 status_mapping.rules 条目。
//
//   - SourceStatus：来源状态候选值，多个候选用 `|` 分隔（MVP 精确匹配，不区分大小写）；
//   - ResourceCategory：为空表示通用规则（适用于所有资源类型）；
//   - Priority：同 scope（类型精确/通用）冲突时，数值大的优先；
//   - Enabled：false 时跳过该规则（内置规则禁删但可禁用，§5.5.3）。
type Rule struct {
	SourceStatus     string                  // 来源值，`|` 分隔多个候选
	TargetStatus     models.ResourceStatus   // 目标状态 online/offline/maintenance
	ResourceCategory models.ResourceCategory // 空 = 通用规则
	Priority         int                     // 数值大的优先
	Enabled          bool                    // false 时跳过
}

// MapStatus 将外部数据源（Excel/CMDB）的状态值映射为 Resource.status 枚举。
// 纯函数，不依赖外部状态，供 Excel 导入层（T07-09）逐行调用。
//
// 优先级（PRD §5.5.4）：
//  1. resource_category 精确匹配的规则；
//  2. 通用规则（resource_category 为空）；
//  3. default_target（默认 offline）兜底。
//
// 同一 scope 内按 priority 倒序取最高者；extraRules 置于内置默认规则之前，
// 同 scope 同 priority 时 extraRules 优先（§5.5.2「扩展或覆盖默认」）。
// 匹配不区分大小写（§5.5.2 case_sensitive 默认 false，MVP 固定）。
//
// 映射结果目标不在枚举（online/offline/maintenance）时返回错误（§5.5.4 第 4 条，
// 导入层应计入 failed 并跳过该行）。
func MapStatus(source string, category models.ResourceCategory, extraRules []Rule) (models.ResourceStatus, error) {
	// 规则集 = 扩展规则（优先） + 内置默认规则（§5.5.1）。
	rules := append(append([]Rule{}, extraRules...), defaultRules()...)

	source = strings.TrimSpace(source)
	var best *Rule
	for i := range rules {
		r := &rules[i]
		if !r.Enabled || !ruleAppliesToCategory(r, category) || !ruleMatches(r, source) {
			continue
		}
		if best == nil || betterRule(r, best) {
			best = r
		}
	}

	if best == nil {
		// 无命中：default_target 兜底（默认 offline，§5.5.4 第 3 条）。
		return models.ResourceStatusOffline, nil
	}
	if !validStatus(best.TargetStatus) {
		return "", fmt.Errorf("status mapping: target status %q is invalid (want online/offline/maintenance)", best.TargetStatus)
	}
	return best.TargetStatus, nil
}

// ruleMatches 判断 rule 的候选值中是否有与 source 精确匹配（不区分大小写）的项。
func ruleMatches(r *Rule, source string) bool {
	for _, cand := range strings.Split(r.SourceStatus, "|") {
		if cand = strings.TrimSpace(cand); cand != "" && strings.EqualFold(cand, source) {
			return true
		}
	}
	return false
}

// ruleAppliesToCategory 判断规则是否适用于给定资源类型：通用规则（category 为空）
// 适用于所有类型；非空规则仅适用于同类型（精确匹配，§5.5.4 第 1 条）。
func ruleAppliesToCategory(r *Rule, category models.ResourceCategory) bool {
	return r.ResourceCategory == "" || r.ResourceCategory == category
}

// betterRule 判断 new 是否严格优于 old：先比较 scope（类型精确 > 通用），
// 再比较 priority（数值大优先）；同 scope 同 priority 时保留先出现的规则
// （extraRules 在默认之前，从而可覆盖默认）。
func betterRule(new, old *Rule) bool {
	newExact := new.ResourceCategory != ""
	oldExact := old.ResourceCategory != ""
	if newExact != oldExact {
		return newExact // 第 1 条：类型精确匹配 > 通用
	}
	if new.Priority != old.Priority {
		return new.Priority > old.Priority // 第 2 条：数值大的优先
	}
	return false // 平手：保留先出现者
}

// defaultRules 将内置默认映射（models.DefaultStatusMappings，§5.5.1）转为 Rule。
func defaultRules() []Rule {
	builtin := models.DefaultStatusMappings()
	rules := make([]Rule, 0, len(builtin))
	for _, m := range builtin {
		cat := models.ResourceCategory("")
		if m.ResourceCategory != nil {
			cat = *m.ResourceCategory
		}
		rules = append(rules, Rule{
			SourceStatus:     m.SourceStatus,
			TargetStatus:     m.TargetStatus,
			ResourceCategory: cat,
			Priority:         m.Priority,
			Enabled:          m.Enabled,
		})
	}
	return rules
}

// validStatus 判断目标状态是否为 Resource.status 合法枚举值。
func validStatus(s models.ResourceStatus) bool {
	switch s {
	case models.ResourceStatusOnline, models.ResourceStatusOffline, models.ResourceStatusMaintenance:
		return true
	}
	return false
}
