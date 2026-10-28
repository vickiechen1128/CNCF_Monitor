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
//
// 派生基线 = 上一**已确认** ConfigVersion 的产物快照（service.go lastConfirmedVersion），
// 而非「本次生成前的即时状态」—— 故 targets 快照 diff 同时覆盖新增与收缩。
func buildChangeItems(jobs []models.ScrapeJob, rules []models.MonitoringRule, artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	if base == nil {
		items := buildInitialChangeItems(jobs, rules)
		items = append(items, diffBlackboxItems(artifacts, nil)...)
		items = append(items, diffAlertmanagerItems(artifacts, nil)...)
		items = append(items, diffPromAlertingItems(artifacts, nil)...)
		for i := range items {
			items[i].ID = fmt.Sprintf("ci-%d", i+1)
		}
		return items
	}
	items := make([]models.ConfigChangeItem, 0)
	items = append(items, diffJobItems(jobs, artifacts, base)...)
	items = append(items, diffTargetItems(jobs, artifacts, base)...)
	items = append(items, diffRuleItems(artifacts.RulesYML, base.RulesYml)...)
	items = append(items, diffBlackboxItems(artifacts, base)...)
	items = append(items, diffAlertmanagerItems(artifacts, base)...)
	items = append(items, diffPromAlertingItems(artifacts, base)...)
	for i := range items {
		items[i].ID = fmt.Sprintf("ci-%d", i+1)
	}
	return items
}

// diffBlackboxItems 对比完整 blackbox.yml，确保仅模块定义变化也形成变更单。
func diffBlackboxItems(artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	newConfig := artifacts.BlackboxYML
	baseConfig := ""
	if base != nil {
		baseConfig = base.BlackboxYml
	}
	if newConfig == baseConfig {
		return nil
	}
	typ, verb := models.ChangeItemTypeAdd, "新增"
	if baseConfig != "" && newConfig != "" {
		typ, verb = models.ChangeItemTypeUpdate, "变更"
	} else if baseConfig != "" {
		typ, verb = models.ChangeItemTypeDelete, "移除"
	}
	return []models.ConfigChangeItem{{
		Type:          string(typ),
		Target:        string(models.ChangeItemTargetProbeTarget),
		Description:   verb + "拨测模块配置 blackbox.yml",
		AffectedFiles: []string{string(models.AffectedFileBlackbox)},
		Risk:          string(models.RiskHigh),
	}}
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

// snapshotAlerting 从 prometheus.yml 文本提取 alerting 段（规范化序列化，键序无关）。
// 缺失或解析失败返回空串（解析失败退化为「无 alerting」，与 snapshotScrapeConfigs
// 的容错口径一致）。
func snapshotAlerting(promYML string) string {
	var f map[string]interface{}
	if err := yaml.Unmarshal([]byte(promYML), &f); err != nil {
		return ""
	}
	al, ok := f["alerting"]
	if !ok {
		return ""
	}
	return normalizeYAML(al)
}

// diffPromAlertingItems 对比新旧 prometheus.yml 的 alerting 段，产出「告警投递配置」
// 变更项（决策 68-2 补丁）。alerting 段由生成器注入（centerEvaluator 判定），不属于
// M01/M08 源数据 —— 若不参与 diff，「仅 alerting 变化」的场景（生成器升级首次注入、
// AM 地址参数变化、edge→local 通道切换）会被决策 44-3 的 ErrNoChanges 抑制，
// 新产物永远无法通过 M09 流程重新下发。影响投递链路，一律 high。
func diffPromAlertingItems(artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	newAL := snapshotAlerting(artifacts.PrometheusYML)
	baseAL := ""
	if base != nil {
		baseAL = snapshotAlerting(base.PrometheusYml)
	}
	if newAL == baseAL {
		return nil
	}
	typ, verb := models.ChangeItemTypeAdd, "新增"
	if baseAL != "" && newAL != "" {
		typ, verb = models.ChangeItemTypeUpdate, "变更"
	} else if baseAL != "" {
		typ, verb = models.ChangeItemTypeDelete, "移除"
	}
	return []models.ConfigChangeItem{{
		Type:          string(typ),
		Target:        string(models.ChangeItemTargetPromAlerting),
		Description:   verb + " Prometheus 告警投递配置（alerting 段）",
		AffectedFiles: []string{string(models.AffectedFilePrometheus)},
		Risk:          string(models.RiskHigh),
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

// targetSnapshotEntry 是 target 快照解析出的一条采集目标（file_sd 目标组内的一台实例）。
// 一个目标组可能含多个地址，但生成器当前恒为「每实例一组、单地址」，故按地址摊平。
type targetSnapshotEntry struct {
	address string
	// resource_id 标签值：target 的稳定身份键（决策 47-3 system 层强制注入），
	// 既用于新旧条目配对（见 diffTargetEntries），也用于与 skipped 归因对齐（仅文案）。
	resourceID string
}

// diffTargetItems 对比新旧产物中**同一个 Job** 的 targets 快照，产出 target 级
// 新增 / 变更 / 移除变更项（补齐变更清单只到 Job 级的缺口：用户软删主机导致采集
// target 收缩时，变更单此前完全看不出「删了机器」）。
//
// 为什么用「新旧产物快照 diff」而不是直接用 ResolveJobTargets 的 skipped 归因：
//   - 覆盖增删两侧。skipped 只在「本次未进产物」时非空，天然看不到新增；而基线是
//     上一**已确认**版本产物（service.go lastConfirmedVersion），并非本次生成前的
//     即时状态，故两侧都能 diff 出来。
//   - 不引入恒有变更。skipped 是本次生成的即时事实，只要网域里存在一台长期 offline
//     的实例，**每次**生成都会非空；若直接据此派生变更项，会让「源数据无变化」也
//     恒有变更项，把决策 44-3 的空跑抑制（ErrNoChanges）彻底废掉。快照 diff 只在
//     产物真的变了时产出项，ErrNoChanges 语义不受影响。
//   - skipped 仍然有用，但只作为**文案归因**（说明移除原因），不作为变更事实来源。
//
// 粒度：逐 target 一条变更项，description 形如「移除采集目标 10.0.0.5:9100（采集 Job
// job1；资源已删除）」。这样摘要里的「移除采集目标 3 个」是**真实台数**而非 Job 数，
// 且用户能直接看到删掉的是哪几台机器——这正是本项修复要补的缺口。
//
// risk：移除记 high。理由是与既有 Job 级「移除采集 Job（监控断点风险）」同级——
// 少一个 target 就是少一台实例的监控覆盖，与少一个 Job 同属监控断点（契约 §8
// 「删除目标 = high」）。新增记 low，同 Job 级新增口径。
func diffTargetItems(jobs []models.ScrapeJob, artifacts *generator.ConfigArtifacts, base *models.ConfigVersion) []models.ConfigChangeItem {
	baseTargets := map[string]string{}
	if base.TargetsFiles != "" {
		// 解析失败按无历史 targets 处理（与 diffJobItems 同口径，退化为全量新增）。
		_ = json.Unmarshal([]byte(base.TargetsFiles), &baseTargets)
	}

	items := make([]models.ConfigChangeItem, 0)
	for _, job := range jobs {
		name := job.JobName
		fname := generator.NormalizeJobFilename(name)
		baseRaw, existed := baseTargets[fname]
		if !existed {
			// 基线无该 Job 的 targets → 新增 Job，其 target 全量新增已由 diffJobItems
			// 的「新增采集 Job」表达，此处不重复派生（否则新增 Job 会双份计账）。
			continue
		}
		newRaw, inNew := artifacts.TargetsFiles[fname]
		if !inNew {
			// 基线有、本次产物已无（Job 被禁用/删除）→ 其 targets 整体移除已由
			// diffJobItems 的「移除采集 Job」表达，同样不重复派生。
			continue
		}

		baseEntries, bErr := parseTargetSnapshot(baseRaw)
		newEntries, nErr := parseTargetSnapshot(newRaw)
		if bErr != nil || nErr != nil {
			// 任一侧解析失败：退化为「不派生 target 级项」（Job 级 update 已覆盖
			// 「该 Job 产物有变化」这一事实），不因解析失败伪造增删计数。
			continue
		}

		added, removed, changed := diffTargetEntries(baseEntries, newEntries)
		items = append(items, targetItemsFor("移除", name, removed, baseEntries, artifacts, models.ChangeItemTypeDelete, models.RiskHigh)...)
		items = append(items, targetItemsFor("新增", name, added, newEntries, artifacts, models.ChangeItemTypeAdd, models.RiskLow)...)
		items = append(items, targetItemsFor("变更", name, changed, newEntries, artifacts, models.ChangeItemTypeUpdate, models.RiskLow)...)
	}
	return items
}

// targetItemsFor 把一组地址差异展开为逐 target 变更项，并按地址归因（移除场景）
// 补充 skipped 说明。地址排序保证变更项顺序稳定。
func targetItemsFor(verb, jobName string, addrs []string, entries []targetSnapshotEntry, artifacts *generator.ConfigArtifacts, typ models.ChangeItemType, risk models.Risk) []models.ConfigChangeItem {
	if len(addrs) == 0 {
		return nil
	}
	// 地址 → resource_id：用于与 skipped 归因对齐（仅文案，不参与变更事实判定）。
	ridByAddr := make(map[string]string, len(entries))
	for _, e := range entries {
		if e.resourceID != "" {
			ridByAddr[e.address] = e.resourceID
		}
	}
	// resource_id → 归因短语：本次生成侧已把「未进产物」的实例归因写入 TargetDiagnostics。
	reasonByRID := map[string]string{}
	for _, td := range artifacts.TargetDiagnostics {
		for _, s := range td.Skipped {
			if s.ResourceID != "" && s.Reason != "" {
				if _, ok := reasonByRID[s.ResourceID]; !ok {
					reasonByRID[s.ResourceID] = skipReasonText(s.Reason)
				}
			}
		}
	}

	sorted := append([]string(nil), addrs...)
	sort.Strings(sorted)
	items := make([]models.ConfigChangeItem, 0, len(sorted))
	for _, addr := range sorted {
		desc := fmt.Sprintf("%s采集目标 %s（采集 Job %s", verb, addr, jobName)
		if reason := reasonByRID[ridByAddr[addr]]; reason != "" {
			desc += "；" + reason
		}
		desc += "）"
		items = append(items, models.ConfigChangeItem{
			Type:          string(typ),
			Target:        string(models.ChangeItemTargetTargetInstance),
			Description:   desc,
			AffectedFiles: []string{string(models.AffectedFileTargets)},
			Risk:          string(risk),
		})
	}
	return items
}

// skipReasonText 把生成侧 skip reason 归因译为变更单文案。
func skipReasonText(reason string) string {
	switch reason {
	case generator.SkipReasonResourceNotFound:
		return "资源已删除"
	case generator.SkipReasonOffline:
		return "资源已下线"
	case generator.SkipReasonAddressEmpty:
		return "采集地址为空"
	default:
		return ""
	}
}

// diffTargetEntries 对比同一 Job 的新旧 target 条目集合，返回（新增地址, 移除地址,
// 换 IP 地址）。
//
// 配对键取 resource_id（决策 47-3：resource_id 是 coverage 三态判定回连资源用的
// 稳定身份键，由 system 层强制注入）——**刻意不用「全部 labels 的指纹」**：标签模板
// 一改就会让每台实例的指纹全变，若拿指纹配对，一次纯标签变更会被误报成「N 个移除
// （high，监控断点）+ N 个新增」，是比原缺陷更糟的假高危。
// 无 resource_id（blackbox 目标 labels 为空）时退化为按地址配对，此时换 IP 会记成
// 一删一增——可接受，blackbox 目标本无实例身份标签。
func diffTargetEntries(base, cur []targetSnapshotEntry) (added, removed, changed []string) {
	baseByID := make(map[string]string, len(base))
	baseAddrs := make(map[string]struct{}, len(base))
	for _, e := range base {
		if e.resourceID != "" {
			baseByID[e.resourceID] = e.address
		}
		baseAddrs[e.address] = struct{}{}
	}
	curByID := make(map[string]string, len(cur))
	curAddrs := make(map[string]struct{}, len(cur))
	for _, e := range cur {
		if e.resourceID != "" {
			curByID[e.resourceID] = e.address
		}
		curAddrs[e.address] = struct{}{}
	}

	// 本次出现的地址：已在基线按同一 resource_id 出现过 = 同一台实例，仅地址变了。
	for _, e := range cur {
		if e.resourceID != "" {
			if old, ok := baseByID[e.resourceID]; ok {
				if old != e.address {
					changed = append(changed, e.address)
				}
				continue
			}
		} else if _, existed := baseAddrs[e.address]; existed {
			// 无身份标签时按地址配对：地址相同即同一 target，无变化。
			continue
		}
		added = append(added, e.address)
	}
	// 基线有、本次没有的地址即移除（被软删 / 下线 / 地址变空）。
	for _, e := range base {
		if e.resourceID != "" {
			if _, still := curByID[e.resourceID]; still {
				continue
			}
		} else if _, still := curAddrs[e.address]; still {
			continue
		}
		removed = append(removed, e.address)
	}
	return added, removed, changed
}

// parseTargetSnapshot 解析 targets/<job>.json 快照为 target 条目列表。内容非法时返回
// 错误，由调用方退化为不派生 target 级项（不伪造增删）。
func parseTargetSnapshot(content string) ([]targetSnapshotEntry, error) {
	if strings.TrimSpace(content) == "" {
		return nil, nil
	}
	var groups []generator.TargetGroup
	if err := json.Unmarshal([]byte(content), &groups); err != nil {
		return nil, fmt.Errorf("parse targets snapshot: %w", err)
	}
	out := make([]targetSnapshotEntry, 0, len(groups))
	for _, g := range groups {
		for _, addr := range g.Targets {
			if addr == "" {
				continue
			}
			out = append(out, targetSnapshotEntry{
				address:    addr,
				resourceID: g.Labels["resource_id"],
			})
		}
	}
	return out, nil
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
