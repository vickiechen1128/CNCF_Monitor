package draft

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// buildChangeItems 基于「上一生效版本产物 vs 本次草稿产物」的 diff 生成结构化变更清单
// （PRD §3.4：变更类型 新增/修改/移除，按产物差异派生；契约 §8：删除目标 / 告警规则
// 变更 = high，新增采集 Job / 目标 = low）。
//
// base 为 nil（网域首次生成版本）时无对比基线，当前参与生成的 jobs/rules 全部记为新增。
// 禁用/删除一个已生效 Job 会从草稿产物中摘除，此处以「移除」变更项如实呈现，
// 不再出现「产物变了但清单为空 → 本次无配置变更」的误导。
func buildChangeItems(jobs []models.ScrapeJob, rules []models.MonitoringRule, artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	if base == nil {
		items := buildInitialChangeItems(jobs, rules)
		items = append(items, diffAlertmanagerItems(artifacts, nil)...)
		for i := range items {
			items[i].ID = fmt.Sprintf("ci-%d", i+1)
		}
		return items
	}
	items := make([]models.ConfigChangeItem, 0)
	items = append(items, diffJobItems(jobs, artifacts, base)...)
	items = append(items, diffRuleItems(artifacts.RulesYML, base.RulesYml)...)
	items = append(items, diffAlertmanagerItems(artifacts, base)...)
	for i := range items {
		items[i].ID = fmt.Sprintf("ci-%d", i+1)
	}
	return items
}

// diffAlertmanagerItems 对比新旧 alertmanager.yml 内容，产出告警收敛配置变更项
// （决策 60：仅管理域 default scope 产生该产物）。base 为 nil（网域首次生成版本）时
// 以空为基线：有告警配置即记新增；内容变化记变更；配置被移除记删除。告警通知配置
// 变更影响收敛链路，一律 high（契约 §8；决策 44-3 抑制逻辑不受影响：此处仅在内容
// 实质变化时产出项，产物不变仍返回空避免噪声变更单）。
func diffAlertmanagerItems(artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	newAM := artifacts.AlertmanagerYML
	baseAM := ""
	if base != nil {
		baseAM = base.AlertmanagerYml
	}
	if newAM == baseAM {
		return nil
	}
	typ, verb := models.ChangeItemTypeAdd, "新增告警收敛配置"
	if baseAM != "" && strings.TrimSpace(newAM) != "" {
		typ, verb = models.ChangeItemTypeUpdate, "变更告警收敛配置"
	} else if baseAM != "" {
		typ, verb = models.ChangeItemTypeDelete, "移除告警收敛配置"
	}
	return []models.ConfigChangeItem{{
		Type:          string(typ),
		Target:        string(models.ChangeItemTargetAlertmanagerCfg),
		Description:   verb + " alertmanager.yml",
		AffectedFiles: []string{string(models.AffectedFileAlertmanager)},
		// review-fix F5：修正为 RiskHigh。告警收敛配置变更影响收敛链路（契约 §8 /
		// PRD §3.4 高/低危分级），此前写死 RiskLow 与函数注释「一律 high」矛盾。
		Risk: string(models.RiskHigh),
	}}
}

// buildInitialChangeItems 无历史版本时的初始变更清单：当前参与生成的 jobs/rules 全部
// 记为新增（规则沿用原口径：Job = low，规则 = high）。
func buildInitialChangeItems(jobs []models.ScrapeJob, rules []models.MonitoringRule) []models.ConfigChangeItem {
	items := make([]models.ConfigChangeItem, 0, len(jobs)+len(rules))
	for i, job := range jobs {
		items = append(items, models.ConfigChangeItem{
			ID:            fmt.Sprintf("ci-%d", i+1),
			Type:          string(models.ChangeItemTypeAdd),
			Target:        string(models.ChangeItemTargetScrapeJob),
			Description:   "新增采集 Job " + job.JobName,
			AffectedFiles: jobAffectedFiles(job.JobType == models.JobTypeBlackbox),
			Risk:          string(models.RiskLow),
		})
	}
	for i, r := range rules {
		items = append(items, models.ConfigChangeItem{
			ID:            fmt.Sprintf("ci-job-%d", i+1),
			Type:          string(models.ChangeItemTypeAdd),
			Target:        string(models.ChangeItemTargetMonitoringRule),
			Description:   "新增告警/记录规则 " + jobNameOr(r.Name, fmt.Sprintf("rule-%d", i+1)),
			AffectedFiles: []string{string(models.AffectedFileRules)},
			Risk:          string(models.RiskHigh),
		})
	}
	return items
}

// diffJobItems 对比新旧产物的 scrape_config 与 targets 文件内容，产出 Job 级
// 新增 / 变更 / 移除变更项；生效版本中存在但本次产物已摘除的 Job 记为「移除」（监控
// 断点，高风险）。
func diffJobItems(jobs []models.ScrapeJob, artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	baseConfigs := snapshotScrapeConfigs(base.PrometheusYml)
	newConfigs := snapshotScrapeConfigs(artifacts.PrometheusYML)
	baseTargets := map[string]string{}
	if base.TargetsFiles != "" {
		// 解析失败按无历史 targets 处理（diff 退化为全量新增/变更，不阻断主流程）。
		_ = json.Unmarshal([]byte(base.TargetsFiles), &baseTargets)
	}

	items := make([]models.ConfigChangeItem, 0)
	for _, job := range jobs {
		name := job.JobName
		fname := generator.NormalizeJobFilename(name)
		baseCfg, existed := baseConfigs[name]
		switch {
		case !existed:
			items = append(items, models.ConfigChangeItem{
				Type:          string(models.ChangeItemTypeAdd),
				Target:        string(models.ChangeItemTargetScrapeJob),
				Description:   "新增采集 Job " + name,
				AffectedFiles: jobAffectedFiles(job.JobType == models.JobTypeBlackbox),
				Risk:          string(models.RiskLow),
			})
		case baseCfg != newConfigs[name] || baseTargets[fname] != artifacts.TargetsFiles[fname]:
			items = append(items, models.ConfigChangeItem{
				Type:          string(models.ChangeItemTypeUpdate),
				Target:        string(models.ChangeItemTargetScrapeJob),
				Description:   "变更采集 Job " + name,
				AffectedFiles: jobAffectedFiles(job.JobType == models.JobTypeBlackbox),
				Risk:          string(models.RiskLow),
			})
		}
	}

	removedFiles := []string{string(models.AffectedFilePrometheus), string(models.AffectedFileTargets)}
	if base.BlackboxYml != "" {
		removedFiles = append(removedFiles, string(models.AffectedFileBlackbox))
	}
	for _, name := range sortedKeys(baseConfigs) {
		if _, ok := newConfigs[name]; ok {
			continue
		}
		items = append(items, models.ConfigChangeItem{
			Type:          string(models.ChangeItemTypeDelete),
			Target:        string(models.ChangeItemTargetScrapeJob),
			Description:   "移除采集 Job " + name + "（监控断点风险）",
			AffectedFiles: removedFiles,
			Risk:          string(models.RiskHigh),
		})
	}
	return items
}

// diffRuleItems 对比新旧 rules.yml 的规则组（按 group name），产出规则级变更项，
// 规则变更一律 high（契约 §8）。任一侧解析失败（如多条透传规则拼接出重复顶层
// groups 键）时退化为整文件比较：内容不同则给出一条「变更」项，不产生误报移除。
func diffRuleItems(newRulesYML, baseRulesYML string) []models.ConfigChangeItem {
	files := []string{string(models.AffectedFileRules)}
	baseGroups, bErr := snapshotRuleGroups(baseRulesYML)
	newGroups, nErr := snapshotRuleGroups(newRulesYML)
	if bErr != nil || nErr != nil {
		if baseRulesYML == newRulesYML {
			return nil
		}
		return []models.ConfigChangeItem{{
			Type:          string(models.ChangeItemTypeUpdate),
			Target:        string(models.ChangeItemTargetMonitoringRule),
			Description:   "变更告警/记录规则",
			AffectedFiles: files,
			Risk:          string(models.RiskHigh),
		}}
	}

	items := make([]models.ConfigChangeItem, 0)
	for _, name := range sortedKeys(newGroups) {
		baseContent, ok := baseGroups[name]
		verb, typ := "新增", models.ChangeItemTypeAdd
		if ok {
			if baseContent == newGroups[name] {
				continue
			}
			verb, typ = "变更", models.ChangeItemTypeUpdate
		}
		items = append(items, models.ConfigChangeItem{
			Type:          string(typ),
			Target:        string(models.ChangeItemTargetMonitoringRule),
			Description:   verb + "告警/记录规则组 " + name,
			AffectedFiles: files,
			Risk:          string(models.RiskHigh),
		})
	}
	for _, name := range sortedKeys(baseGroups) {
		if _, ok := newGroups[name]; ok {
			continue
		}
		items = append(items, models.ConfigChangeItem{
			Type:          string(models.ChangeItemTypeDelete),
			Target:        string(models.ChangeItemTargetMonitoringRule),
			Description:   "移除告警/记录规则组 " + name,
			AffectedFiles: files,
			Risk:          string(models.RiskHigh),
		})
	}
	return items
}

// jobAffectedFiles 返回 Job 变更涉及的配置文件（blackbox job 额外涉及 blackbox.yml）。
func jobAffectedFiles(isBlackbox bool) []string {
	files := []string{string(models.AffectedFilePrometheus), string(models.AffectedFileTargets)}
	if isBlackbox {
		files = append(files, string(models.AffectedFileBlackbox))
	}
	return files
}

// snapshotScrapeConfigs 从 prometheus.yml 文本提取 job_name → 规范化 scrape_config
// 内容（重序列化后与键序无关，可等价比较）。解析失败返回空表，diff 退化为按全量
// 新增处理。
func snapshotScrapeConfigs(promYML string) map[string]string {
	out := map[string]string{}
	var cfg struct {
		ScrapeConfigs []map[string]interface{} `yaml:"scrape_configs"`
	}
	if err := yaml.Unmarshal([]byte(promYML), &cfg); err != nil {
		return out
	}
	for _, sc := range cfg.ScrapeConfigs {
		name, _ := sc["job_name"].(string)
		if name == "" {
			continue
		}
		out[name] = normalizeYAML(sc)
	}
	return out
}

// snapshotRuleGroups 从 rules.yml 文本提取规则组名 → 规范化组内容。空文本返回空表；
// YAML 非法或存在重复顶层键（多规则文件拼接）时返回错误，由调用方退化处理。
func snapshotRuleGroups(rulesYML string) (map[string]string, error) {
	out := map[string]string{}
	if strings.TrimSpace(rulesYML) == "" {
		return out, nil
	}
	var f map[string]interface{}
	if err := yaml.Unmarshal([]byte(rulesYML), &f); err != nil {
		return nil, fmt.Errorf("parse rules yml: %w", err)
	}
	groups, _ := f["groups"].([]interface{})
	for _, g := range groups {
		gm, ok := g.(map[string]interface{})
		if !ok {
			continue
		}
		name, _ := gm["name"].(string)
		if name == "" {
			continue
		}
		out[name] = normalizeYAML(gm)
	}
	return out, nil
}

// normalizeYAML 将解析后的 YAML 节点重新序列化，得到与键序无关的可比较内容。
func normalizeYAML(v interface{}) string {
	b, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

// sortedKeys 返回 map 键的排序副本，保证变更项顺序稳定。
func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
