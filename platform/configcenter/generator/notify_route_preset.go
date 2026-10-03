// 本文件实现 M08 dev-feedback #33「最小运行骨架 → 完整预置示例」的生成器侧纯函数：
// 在**平台管理模式**（RouteModeManaged）下、且当前 alertmanager.yml 的 route 段尚**无任何
// 具体分流**（空配置域 / 全新挂载）时，注入一份含 matchers / 分流示例 / 抑制示例的**完整预置
// 示例**，作为托管模式的派生基线（设计提案 alert-config-three-layer-model.md §5 方案 A / §7）。
//
// 与决策 113「最小运行骨架自动布缆」严格分工、互不越界：
//   - #31 骨架（notify_route_skeleton.go）：只原地替换根 route.receiver **单键**，管「兜底是谁」；
//   - #33 预置（本文件）：管「完整示例长什么样」，只在托管模式 + 无既有分流时**一次性**注入。
//
// 四条不可越的红线：
//  1. **托管模式门禁**：仅 RouteModeManaged 注入。手写模式（默认 / 零值）返回 baseYAML
//     **字节级不变、零诊断、零副作用**——手写是永久逃生舱（PRD §11.6），平台绝不触碰。
//  2. **不覆盖既有配置**：base 的 route 已有子路由（routes: 非空）/ 根 matchers /
//     continue=true 等**用户手改痕迹**时一律跳过 + 诊断，绝不 clobber（段级单一作者 + 模式开关
//     互斥，PRD §4.1.1）。种子只服务「空配置域」，不是覆盖器。
//  3. **零悬空引用**：种子内所有 route.receiver 必须落在「文件 receivers ∪ 本次平台物化名」
//     可达集合内，否则跳过 + 诊断（amtool 会因悬空 receiver 判整单 failed）。matcher 一律
//     走既有 RouteEditNode → matcherShorthand 通道（AM 字符串简写），杜绝 `="x"` 空 matcher 名。
//  4. **异常一律降级为「跳过 + 诊断」**，不返回 error（不得让挂载路径因示例而失败）；唯一
//     返回 error 的是序列化失败这一不可预期场景，由调用方（draft.seedManagedRoutePreset）再降级。
//
// 幂等：注入后 route 已有子路由，二次运行命中红线 2 原样返回 ⇒ 连跑两次输出字节一致
// （checksum 可复现，与 #31 骨架同口径）。
//
// YAML 处理沿用本目录既有范式（notify_receivers.go / notify_route_generate.go）：yaml.Node
// 原地改写，保注释、保手写节点样式、保幂等；不引入新 YAML 库。
package generator

import (
	"fmt"
	"sort"
	"strings"

	"github.com/metriccenter/metriccenter/platform/models"
	"gopkg.in/yaml.v3"
)

// 预置示例落盘的段键名与节点 ID 前缀（route 段键名复用 notify_route_generate.go 的
// routeSectionKey，保证与解析器 / 生成器严格同源）。
const (
	// inhibitRulesSectionKey 是 alertmanager.yml 顶层 inhibit_rules 段键名。
	inhibitRulesSectionKey = "inhibit_rules"
	// presetRouteIDPrefix 是预置示例节点的 ID 前缀（ID 不落盘，仅用于构造编辑态树）。
	presetRouteIDPrefix = "preset"
)

// 预置示例的根 / 子路由显示名（以 `# 路由名称: xxx` 注释落盘，前台路由页据此显示）。
// 「预置示例-」前缀让用户一眼识别「这是平台注入的示例，可改可删」，避免误认成自己写的。
const (
	presetRootName     = "预置示例-根路由"
	presetCriticalName = "预置示例-严重告警"
	presetWarningName  = "预置示例-一般告警"
	presetTeamName     = "预置示例-值班团队"
)

// 预置示例的节奏参数（AM 语义下的建议值，示例可改）：
//   - 根：30s 首发等待 / 5m 分组间隔 / 4h 重复通知；
//   - critical：抢时间（15s / 3m / 1h）；warning：不抢（30s / 10m / 12h）。
//
// 分流示例的价值正在于「不同严重级用不同节奏」，故两组取值刻意不同。
const (
	presetRootGroupWait      = "30s"
	presetRootGroupInterval  = "5m"
	presetRootRepeatInterval = "4h"

	presetCriticalGroupWait      = "15s"
	presetCriticalGroupInterval  = "3m"
	presetCriticalRepeatInterval = "1h"

	presetWarningGroupWait      = "30s"
	presetWarningGroupInterval  = "10m"
	presetWarningRepeatInterval = "12h"
)

// RoutePresetInput 是预置示例种子化的入参。
type RoutePresetInput struct {
	// Mode 是 route 段作者模式（T08-F12 模式开关）。**仅** RouteModeManaged 注入；
	// RouteModeHandwritten（含零值 ""，LoadRouteSetting 已归一）原样返回 baseYAML。
	Mode models.RouteMode
	// DefaultReceiver 是管理域单例设定解析出的默认接收人 AM receiver 名
	//（AlertmanagerRouteSetting.EffectiveDefaultReceiver；未设定接管时调用方可回落为
	// 「已启用渠道第一个」，亦可为空）。为空时本函数回落为「base 根 route 既有 receiver
	// → 文件 receivers 首个声明」，三者皆不可得则跳过（避免写出悬空 receiver）。
	DefaultReceiver string
	// PlatformReceiverNames 是本次物化（MaterializeNotifyReceivers）平台生成的 receiver 名
	// 集合。与文件既有 receivers 名并集构成「可达 receiver 集合」，用于阻断 dangling receiver。
	PlatformReceiverNames []string
}

// 预置种子化的跳过归因码。全部为「跳过 + 诊断」，不构成 error。
const (
	// PresetSkipInvalidYAML YAML 非法（无法解析为节点树）。
	PresetSkipInvalidYAML = "skipped_invalid_yaml"
	// PresetSkipMalformedDocument 顶层不是映射（不是合法的 alertmanager 配置形态）。
	PresetSkipMalformedDocument = "skipped_malformed_document"
	// PresetSkipNoRoute 文件无 route 节点。
	PresetSkipNoRoute = "skipped_no_route"
	// PresetSkipRouteNotMapping route 节点不是映射。
	PresetSkipRouteNotMapping = "skipped_route_not_mapping"
	// PresetSkipRouteNotSeedable route 段已有用户手改痕迹（子路由 / 根 matchers /
	// continue=true 等），预置种子不得覆盖既有配置。
	PresetSkipRouteNotSeedable = "skipped_route_not_seedable"
	// PresetSkipNoReceiver 无可达 receiver（default / 根 route 既有 / 文件声明皆不可得），
	// 注入将产生悬空 receiver，故跳过。
	PresetSkipNoReceiver = "skipped_no_receiver"
	// PresetSkipBuildSeedFailed 构造 / 生成示例 route 段失败（不可预期）。
	PresetSkipBuildSeedFailed = "skipped_build_seed_failed"
	// PresetSkipMarshalFailed 序列化失败（唯一返回 error 的场景，调用方再降级为跳过）。
	PresetSkipMarshalFailed = "skipped_marshal_failed"
	// PresetSkipLoadSettingFailed 读取管理域单例设定失败（draft 侧降级归因）。
	PresetSkipLoadSettingFailed = "skipped_load_setting_failed"
	// PresetSkipLoadChannelsFailed 读取已启用通知渠道失败（draft 侧降级归因）。
	PresetSkipLoadChannelsFailed = "skipped_load_channels_failed"
)

// RoutePresetDiagnostic 是预置种子化的跳过 / 异常归因（非产物内容，不参与 Checksum）。
type RoutePresetDiagnostic struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// SeedManagedRoutePreset 在**托管模式**下为「尚无具体分流」的 alertmanager.yml 注入一份完整
// 预置示例（根 route + 3 条带 matchers 的示例分流 + 1 条 inhibit 示例），补齐 dev-feedback #33
// 的「标准 alertmanager 配置文件模板库」缺口（决策 113 只落地了根兜底单键骨架）。
//
// 门禁与降级（详见本文件头部红线）：
//   - in.Mode != RouteModeManaged → **字节级原样返回**，无诊断、零副作用（手写 = 永久逃生舱）；
//   - 解析 / 结构异常 → baseYAML + 诊断，**不返回 error**；
//   - route 已有用户手改痕迹 → baseYAML + 诊断（不 clobber）；
//   - 无可达 receiver → baseYAML + 诊断（零悬空引用）；
//   - 注入成功 → 返回新内容与 nil 诊断（调用方按「内容是否变化」判定是否记变更项）。
//
// 幂等：注入后二次运行命中「已有子路由」门禁原样返回 ⇒ 连跑两次字节一致。
func SeedManagedRoutePreset(baseYAML string, in RoutePresetInput) (string, []RoutePresetDiagnostic, error) {
	// 红线 1：手写模式（默认 / 零值）零触碰。手写是永久逃生舱，平台不得写入任何字节。
	if in.Mode != models.RouteModeManaged {
		return baseYAML, nil, nil
	}
	// 无 alertmanager.yml 产物（无告警配置留痕 / 非管理域）不是异常，不注入也不出诊断——
	// 与 MaterializeNotifyReceivers 的空产物早退同口径，避免给「本就无配置」平白记一条跳过归因。
	if strings.TrimSpace(baseYAML) == "" {
		return baseYAML, nil, nil
	}

	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(baseYAML), &doc); err != nil {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipInvalidYAML,
			Message: fmt.Sprintf("alertmanager.yml 解析失败，跳过预置示例注入: %v", err),
		}}, nil
	}
	if doc.Kind != yaml.DocumentNode || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipMalformedDocument,
			Message: "alertmanager.yml 顶层不是映射，跳过预置示例注入",
		}}, nil
	}
	root := doc.Content[0]

	ri := mappingValueIndex(root, routeSectionKey)
	if ri < 0 {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipNoRoute,
			Message: "alertmanager.yml 无 route 节点，跳过预置示例注入",
		}}, nil
	}
	route := root.Content[ri]
	if route.Kind != yaml.MappingNode {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipRouteNotMapping,
			Message: "alertmanager.yml 的 route 段不是映射，跳过预置示例注入",
		}}, nil
	}

	// 红线 2：不覆盖既有配置。route 已有子路由 / 根 matchers / continue=true 即视为用户手改。
	if reason, hasEdits := routeHasUserEdits(route); hasEdits {
		return baseYAML, []RoutePresetDiagnostic{{
			Code: PresetSkipRouteNotSeedable,
			Message: "alertmanager.yml 的 route 段已有用户分流配置（" + reason +
				"），预置示例不覆盖既有配置；如需恢复示例请先清空 route 段的分流定义",
		}}, nil
	}

	// 红线 3：零悬空引用。预置种子跑在 receivers 物化**之后**，此时文件 receivers 段即
	// 「真实存在的 receiver」的权威来源；解析不出可用 receiver 则跳过，绝不写出悬空引用。
	declared := declaredReceiverNames(root)
	receiver := resolvePresetReceiver(root, route, declared, in.DefaultReceiver)
	if receiver == "" {
		return baseYAML, []RoutePresetDiagnostic{{
			Code: PresetSkipNoReceiver,
			Message: "文件 receivers 段没有可用于预置示例的 receiver（默认接收人 / 根 route 既有 receiver " +
				"均不在其中），跳过注入以避免悬空引用；请先配置通知渠道或手写 receivers",
		}}, nil
	}

	// 构造示例树 → 生成 route 段（复用既有生成通道，matchers 落 AM 字符串简写、name 落注释）。
	section, err := GenerateRouteSection(routePresetTree(receiver, secondaryPresetReceiver(receiver, declared, in.PlatformReceiverNames)))
	if err != nil {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipBuildSeedFailed,
			Message: fmt.Sprintf("构造预置示例 route 段失败，跳过注入: %v", err),
		}}, err
	}
	seedNode, err := routeSectionNode(section)
	if err != nil {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipBuildSeedFailed,
			Message: fmt.Sprintf("解析预置示例 route 段失败，跳过注入: %v", err),
		}}, err
	}
	// 兜底自检：示例内每个 receiver 都必须真实已声明、每个 matcher 都必须有非空名字。
	// 正常构造路径恒满足，此处是「绝不产出 amtool 拒绝的配置」的最后一道闸。
	declaredSet := make(map[string]bool, len(declared))
	for _, n := range declared {
		declaredSet[n] = true
	}
	if bad := invalidPresetReference(seedNode, declaredSet); bad != "" {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipNoReceiver,
			Message: "预置示例自检未通过（" + bad + "），跳过注入以避免生成 amtool 拒绝的配置",
		}}, nil
	}

	root.Content[ri] = seedNode
	appendPresetInhibitRule(root)

	out, err := yaml.Marshal(&doc)
	if err != nil {
		return baseYAML, []RoutePresetDiagnostic{{
			Code:    PresetSkipMarshalFailed,
			Message: fmt.Sprintf("注入预置示例后序列化失败: %v", err),
		}}, fmt.Errorf("marshal preset-seeded alertmanager.yml: %w", err)
	}
	return string(out), nil, nil
}

// routeHasUserEdits 判定 route 段是否已有用户手改痕迹（决定能否注入预置种子）。
// 返回 (原因, true) = 有痕迹；("", false) = 空配置域（可安全种子化）。
//
// 判据只看「语义上必然是用户写的分流意图」的三类键，避免把平台自己写的兜底 receiver
// / 节奏字段误判为用户配置：
//   - routes 非空序列：已有子路由（最常见的手改形态）；
//   - 根 matchers 非空序列：根路由自带分流条件；
//   - continue=true：显式的「继续匹配后续兄弟路由」语义。
//
// `routes: []`（空序列）/ `matchers: []`（空序列）不算痕迹（等价于没写）。
func routeHasUserEdits(route *yaml.Node) (string, bool) {
	if v, ok := nonEmptySequenceKey(route, "routes"); ok {
		return fmt.Sprintf("根 route 已有 %d 条子路由 routes", v), true
	}
	if v, ok := nonEmptySequenceKey(route, "matchers"); ok {
		return fmt.Sprintf("根 route 已有 %d 条 matchers", v), true
	}
	if ci := mappingValueIndex(route, "continue"); ci >= 0 && route.Content[ci].Value == "true" {
		return "根 route 已显式设置 continue: true", true
	}
	return "", false
}

// nonEmptySequenceKey 读取映射节点中 key 对应的非空序列长度；不存在 / 非序列 / 空序列返回 (0,false)。
func nonEmptySequenceKey(m *yaml.Node, key string) (int, bool) {
	vi := mappingValueIndex(m, key)
	if vi < 0 {
		return 0, false
	}
	seq := m.Content[vi]
	if seq.Kind != yaml.SequenceNode || len(seq.Content) == 0 {
		return 0, false
	}
	return len(seq.Content), true
}

// declaredReceiverNames 按**文件声明顺序**返回 alertmanager.yml receivers 段的全部 receiver
// 名（去重）。这是「真实存在的 receiver」的权威来源——预置种子只在这些名字里挑，
// 从而**结构性地**杜绝悬空 receiver（amtool 会因悬空引用判整单 failed）。
//
// 与 notify_route_skeleton.go 的 knownReceiverNames（文件 ∪ 本次平台物化名）的差别：
// 骨架的写入面只有根 route.receiver 单键、且平台物化在同一次生成内必然先于它落盘，故可放宽
// 到「本次将物化的名字」；而种子是**结构性写入**（一次写多条子路由的 receiver），宁可收紧到
// 「文件里已经真的声明了」——平台物化若因桥地址未配置而未落盘，种子宁可不注入，也不写悬空名。
func declaredReceiverNames(root *yaml.Node) []string {
	idx := mappingValueIndex(root, "receivers")
	if idx < 0 {
		return nil
	}
	seq := root.Content[idx]
	if seq.Kind != yaml.SequenceNode {
		return nil
	}
	names := make([]string, 0, len(seq.Content))
	seen := make(map[string]bool, len(seq.Content))
	for _, item := range seq.Content {
		if item.Kind != yaml.MappingNode {
			continue
		}
		ni := mappingValueIndex(item, "name")
		if ni < 0 {
			continue
		}
		name := item.Content[ni].Value
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		names = append(names, name)
	}
	return names
}

// resolvePresetReceiver 解析示例应引用的主 receiver 名。优先级（自上而下，全部须真实已声明）：
//  1. 入参 DefaultReceiver（管理域默认接收人；调用方可回落为「已启用渠道第一个」）；
//  2. base 根 route 既有 receiver 标量（用户自己写的兜底，予以尊重）；
//  3. 文件 receivers 段首个声明名。
//
// 三者皆不可得（或均未声明）时返回 ""，由调用方跳过——绝不写出悬空 receiver。
func resolvePresetReceiver(root, route *yaml.Node, declared []string, defaultReceiver string) string {
	declaredSet := make(map[string]bool, len(declared))
	for _, n := range declared {
		declaredSet[n] = true
	}
	if defaultReceiver != "" && declaredSet[defaultReceiver] {
		return defaultReceiver
	}
	if vi := mappingValueIndex(route, "receiver"); vi >= 0 {
		if name := route.Content[vi].Value; name != "" && declaredSet[name] {
			return name
		}
	}
	if len(declared) > 0 {
		return declared[0]
	}
	return ""
}

// secondaryPresetReceiver 解析「值班团队」子路由用的第二 receiver 名，用于让示例真实演示
// 「不同分流走不同接收人」。选取规则（确定性、可复现）：
//  1. 本次平台物化名中**已真实声明**的、字典序最小的非主名（平台槽位优先，语义最贴近「值班」）；
//  2. 否则取已声明名中字典序最小的非主名（用户自有 receiver）；
//  3. 都没有（只声明了一个 receiver）→ 返回主名（示例退化为单接收人，仍合法可用）。
func secondaryPresetReceiver(primary string, declared []string, platformNames []string) string {
	declaredSet := make(map[string]bool, len(declared))
	for _, n := range declared {
		declaredSet[n] = true
	}
	// 平台槽位优先（按传入顺序 = channels id 升序，稳定），但必须真实已声明。
	names := append([]string{}, platformNames...)
	sort.Strings(names)
	for _, n := range names {
		if n != primary && declaredSet[n] {
			return n
		}
	}
	rest := make([]string, 0, len(declared))
	for _, n := range declared {
		if n != primary {
			rest = append(rest, n)
		}
	}
	if len(rest) == 0 {
		return primary
	}
	sort.Strings(rest)
	return rest[0]
}

// routePresetTree 构造预置示例的编辑态路由树：根兜底 + 3 条带 matchers 的示例分流。
//
//	根       group_by=[alertname, instance] + 节奏（30s/5m/4h）
//	├ critical  severity="critical"          → receiver，节奏 15s/3m/1h（抢时间）
//	├ warning   severity="warning"           → receiver，节奏 30s/10m/12h（不抢）
//	└ team      team=~"sre|ops" + continue   → teamReceiver（演示 continue：命中后仍继续匹配兄弟路由）
//
// receiver / teamReceiver 均已由 resolvePresetReceiver / secondaryPresetReceiver 解析为
// **文件中真实已声明**的名字（单点收敛，天然零悬空）。
func routePresetTree(receiver, teamReceiver string) []RouteEditNode {
	rootID := presetRouteIDPrefix + "/root"
	return []RouteEditNode{
		{
			ID: rootID, Name: presetRootName, Receiver: receiver,
			GroupBy:   []string{"alertname", "instance"},
			GroupWait: presetRootGroupWait, GroupInterval: presetRootGroupInterval,
			RepeatInterval: presetRootRepeatInterval,
		},
		{
			ID: presetRouteIDPrefix + "/critical", ParentID: rootID,
			Name: presetCriticalName, Receiver: receiver,
			Matchers:  []RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}},
			GroupWait: presetCriticalGroupWait, GroupInterval: presetCriticalGroupInterval,
			RepeatInterval: presetCriticalRepeatInterval,
		},
		{
			ID: presetRouteIDPrefix + "/warning", ParentID: rootID,
			Name: presetWarningName, Receiver: receiver,
			Matchers:      []RouteEditMatcher{{Name: "severity", Value: "warning", IsEqual: true}},
			GroupWait:     presetWarningGroupWait,
			GroupInterval: presetWarningGroupInterval, RepeatInterval: presetWarningRepeatInterval,
		},
		{
			ID: presetRouteIDPrefix + "/team", ParentID: rootID,
			Name: presetTeamName, Receiver: teamReceiver,
			Matchers: []RouteEditMatcher{{Name: "team", Value: "sre|ops", IsEqual: true, IsRegex: true}},
			Continue: true,
		},
	}
}

// invalidPresetReference 自检示例节点：返回首个问题的描述，无问题返回 ""。
// 两类检查：
//   - route 引用的 receiver 不在可达集合（悬空引用，amtool 判 failed）；
//   - matchers 里出现空名字（会落成 `="x"` 这类 amtool 拒绝的简写）。
func invalidPresetReference(n *yaml.Node, known map[string]bool) string {
	if n == nil {
		return ""
	}
	if n.Kind == yaml.MappingNode {
		if vi := mappingValueIndex(n, "receiver"); vi >= 0 {
			if name := n.Content[vi].Value; name != "" && !known[name] {
				return fmt.Sprintf("receiver %q 不在可达集合内", name)
			}
		}
		if mi := mappingValueIndex(n, "matchers"); mi >= 0 && n.Content[mi].Kind == yaml.SequenceNode {
			for _, m := range n.Content[mi].Content {
				name, _, ok := splitMatcherShorthand(m.Value)
				if !ok || strings.TrimSpace(name) == "" {
					return fmt.Sprintf("matcher %q 缺少标签名", m.Value)
				}
			}
		}
	}
	for _, c := range n.Content {
		if bad := invalidPresetReference(c, known); bad != "" {
			return bad
		}
	}
	return ""
}

// splitMatcherShorthand 从 AM 字符串简写 `name<op>"value"` 中切出标签名（自检用）。
// 解析不了（无操作符 / 名字为空）时返回 ok=false。
func splitMatcherShorthand(s string) (name, value string, ok bool) {
	i := strings.IndexAny(s, "=!")
	if i <= 0 {
		return "", "", false
	}
	name = s[:i]
	value = strings.Trim(s[i:], `"'`)
	return name, value, true
}

// appendPresetInhibitRule 追加一条抑制示例（PRD §4.1.1：inhibit_rules = 平台 + 用户可追加）。
//
// 仅在 inhibit_rules **不存在或为空序列**时追加；用户已有抑制规则时**绝不改写、绝不追加**
// （段级所有权：用户可追加 ⇒ 平台不得替用户排序或覆盖）。
// 语义示例：同一实例的 critical 告警存在时，抑制同实例同 alertname 的 warning 告警
// （equal: [alertname, instance] 是 AM 的标准抑制等价键写法）。
func appendPresetInhibitRule(root *yaml.Node) {
	idx := mappingValueIndex(root, inhibitRulesSectionKey)
	if idx >= 0 {
		existing := root.Content[idx]
		if existing.Kind != yaml.SequenceNode || len(existing.Content) > 0 {
			return // 已有抑制规则（或形态异常）⇒ 平台不干预
		}
	}

	source := presetMatcherSequence(`severity="critical"`)
	target := presetMatcherSequence(`severity="warning"`)
	equal := &yaml.Node{Kind: yaml.SequenceNode, Style: yaml.FlowStyle}
	equal.Content = append(equal.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Value: "alertname"},
		&yaml.Node{Kind: yaml.ScalarNode, Value: "instance"},
	)

	item := &yaml.Node{Kind: yaml.MappingNode}
	item.HeadComment = "# 预置示例：同一实例的严重告警抑制一般告警（可改可删）"
	appendMapping(item, "source_matchers", source)
	appendMapping(item, "target_matchers", target)
	appendMapping(item, "equal", equal)

	seq := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	seq.Content = append(seq.Content, item)

	if idx >= 0 {
		root.Content[idx] = seq
		return
	}
	root.Content = append(root.Content,
		&yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: inhibitRulesSectionKey}, seq)
}

// presetMatcherSequence 构造只含一条 AM 字符串简写 matcher 的序列节点。
func presetMatcherSequence(shorthand string) *yaml.Node {
	seq := &yaml.Node{Kind: yaml.SequenceNode}
	seq.Content = append(seq.Content, &yaml.Node{Kind: yaml.ScalarNode, Value: shorthand})
	return seq
}
