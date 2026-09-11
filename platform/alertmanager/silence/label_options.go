package silence

import (
	"fmt"
	"sort"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// 决策 71：静默 matcher 可匹配标签 = AM 收到告警时携带的标签全集（四层并集）。
// 本文件聚合四层键集供创建静默表单做分组联想：
//  1. target_system（固定）：resource_id（决策 47-3 system 强制）/ instance（采集地址，决策 70）/ job；
//  2. template（动态）：被 enabled + draft_status=ready 的 ScrapeJob 实际引用的标签模板中
//     enabled mappings 的 target_label（模板解析同生成器 LoadTemplateForJob：显式挂载 → 类别默认模板；
//     注意「不是所有已生效模板的集合」——未被生效 Job 引用/未下发模板的键不可匹配）；
//  3. rule（动态）：alertname（自动附加）∪ enabled + ready + scope central/both 规则的
//     severity 与自定义 labels 键（同生成器 LoadRules 口径）；
//  4. external（固定）：network_domain_id / zone_type（发往 AM 出口附加的 external_labels，
//     M09 决策 19 键名；AM 静默可按网域匹配，但该层在 Prom /api/v1/alerts 中不可见）。
//
// 例外：blackbox Job 目标层 labels 为空（targets.go），拨测类告警仅规则层 + external 可匹配。

// 分组来源枚举（契约 §4 LabelOptionGroup.source）。
const (
	LabelSourceTargetSystem = "target_system"
	LabelSourceTemplate     = "template"
	LabelSourceRule         = "rule"
	LabelSourceExternal     = "external"
)

// LabelOption 是单个可匹配键（含用户向描述）。
type LabelOption struct {
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// LabelOptionGroup 是一个来源分组的可匹配键集（契约 §4 LabelOptionGroup）。
type LabelOptionGroup struct {
	Source string        `json:"source"`
	Label  string        `json:"label"`
	Items  []LabelOption `json:"items"`
}

// BuildLabelOptionGroups 聚合四层并集。单层查询失败不阻断其余层（best-effort：
// 联想框属软引导，DB 局部故障时降级返回可得分组而非整体报错）。
func BuildLabelOptionGroups(db *gorm.DB) []LabelOptionGroup {
	return []LabelOptionGroup{
		targetSystemGroup(),
		templateGroup(db),
		ruleGroup(db),
		externalGroup(),
	}
}

// targetSystemGroup 固定清单：系统强制与采集机制层标签。
func targetSystemGroup() LabelOptionGroup {
	return LabelOptionGroup{
		Source: LabelSourceTargetSystem,
		Label:  "系统与采集标签",
		Items: []LabelOption{
			{Name: "resource_id", Description: "资源唯一 ID；实例级静默推荐用此键（UUID 稳定，不随 IP/端口变化，可用「按实例选择」自动生成）"},
			{Name: "instance", Description: "采集地址 ip:exporter端口（非业务端口，决策 70）；不建议手填，请用「按实例选择」"},
			{Name: "job", Description: "采集任务名（Prometheus 自动附加）"},
		},
	}
}

// templateGroup 动态聚合：ready Job 实际引用模板的 enabled mappings 键。
func templateGroup(db *gorm.DB) LabelOptionGroup {
	group := LabelOptionGroup{Source: LabelSourceTemplate, Label: "标签模板产出", Items: []LabelOption{}}
	var jobs []models.ScrapeJob
	if err := db.Where("enabled = ? AND draft_status = ?", true, "ready").Find(&jobs).Error; err != nil {
		return group
	}
	// 收集生效 Job 的模板解析结果（显式挂载 → 类别默认模板，去重）。
	tmplIDs := make(map[string]bool)
	categories := make(map[models.ResourceCategory]bool)
	for _, job := range jobs {
		if job.LabelTemplateID != "" {
			tmplIDs[job.LabelTemplateID] = true
		} else {
			categories[models.ResourceCategory(job.ResourceType)] = true
		}
	}
	for category := range categories {
		var tmpl models.LabelTemplate
		if err := db.Where("resource_category = ? AND is_default = ?", category, true).First(&tmpl).Error; err == nil {
			tmplIDs[fmt.Sprintf("%d", tmpl.ID)] = true
		}
	}
	if len(tmplIDs) == 0 {
		return group
	}
	ids := make([]string, 0, len(tmplIDs))
	for id := range tmplIDs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	var templates []models.LabelTemplate
	if err := db.Where("id IN ?", ids).Find(&templates).Error; err != nil {
		return group
	}
	// 展开启用映射：同名 target_label 聚合来源模板描述（跨模板/跨网域去重）。
	descByLabel := make(map[string]string)
	labels := make([]string, 0)
	for _, tmpl := range templates {
		for _, m := range tmpl.Mappings {
			if !m.Enabled || m.TargetLabel == "" {
				continue
			}
			if _, seen := descByLabel[m.TargetLabel]; !seen {
				labels = append(labels, m.TargetLabel)
				descByLabel[m.TargetLabel] = fmt.Sprintf("由标签模板「%s」产出（%s → %s）", tmpl.Name, m.SourceField, m.TargetLabel)
			}
		}
	}
	sort.Strings(labels)
	for _, name := range labels {
		group.Items = append(group.Items, LabelOption{Name: name, Description: descByLabel[name]})
	}
	return group
}

// ruleGroup 动态聚合：生效规则的 alertname / severity / 自定义 labels 键。
func ruleGroup(db *gorm.DB) LabelOptionGroup {
	group := LabelOptionGroup{
		Source: LabelSourceRule,
		Label:  "规则标签",
		Items: []LabelOption{
			{Name: "alertname", Description: "告警规则名（规则求值自动附加）"},
		},
	}
	var rules []models.MonitoringRule
	if err := db.Where("enabled = ? AND draft_status = ? AND scope IN ?", true, "ready",
		[]string{string(models.ScopeTypeCentral), string(models.ScopeTypeBoth)}).Find(&rules).Error; err != nil {
		return group
	}
	hasSeverity := false
	descByLabel := make(map[string]string)
	labels := make([]string, 0)
	for _, rule := range rules {
		for key := range rule.Labels {
			if key == "" || key == "alertname" {
				continue
			}
			if key == "severity" {
				hasSeverity = true
				continue
			}
			if _, seen := descByLabel[key]; !seen {
				labels = append(labels, key)
				descByLabel[key] = fmt.Sprintf("自定义于规则「%s」", rule.Name)
			}
		}
	}
	sort.Strings(labels)
	if hasSeverity {
		group.Items = append(group.Items, LabelOption{Name: "severity", Description: "告警级别（如 critical / warning，规则定义）"})
	}
	for _, name := range labels {
		group.Items = append(group.Items, LabelOption{Name: name, Description: descByLabel[name]})
	}
	return group
}

// externalGroup 固定清单：发往 AM 出口附加的 external_labels（M09 决策 19 键名）。
func externalGroup() LabelOptionGroup {
	return LabelOptionGroup{
		Source: LabelSourceExternal,
		Label:  "网域标识",
		Items: []LabelOption{
			{Name: "network_domain_id", Description: "网域 ID（external_labels，AM 收到的告警携带；Prometheus 告警查询中不可见）"},
			{Name: "zone_type", Description: "网域类型（center / edge）"},
		},
	}
}

// LabelOptionsHandler 处理 GET /api/v2/platform/alertmanager/silences/label-options
// （契约 §4 / 决策 71：只读聚合，仅认证；单层 DB 故障降级返回可得分组）。
func LabelOptionsHandler(db *gorm.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		if db == nil {
			response.InternalServerError(c, fmt.Errorf("label options requires database connection"))
			return
		}
		response.OK(c, gin.H{"groups": BuildLabelOptionGroups(db)})
	}
}
