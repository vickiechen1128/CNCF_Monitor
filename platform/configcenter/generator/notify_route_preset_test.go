package generator

import (
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// emptyRouteAlertmanagerYML 是一份「空配置域」基线：根兜底 + 节奏字段，**无任何子路由**
// （即 #31 骨架布缆后的典型形态），是预置示例唯一允许注入的形态。
// receivers 段已含平台物化名 notify-3（种子跑在 receivers 物化之后，见 draft 侧接线）。
const emptyRouteAlertmanagerYML = `global:
  resolve_timeout: 5m
route:
  receiver: user-default
  group_by: ['alertname']
  group_wait: 30s
receivers:
  - name: user-default
  - name: notify-3
`

// managedPresetInput 是托管模式下的常规入参：默认接收人 = notify-3（平台物化名）。
func managedPresetInput() RoutePresetInput {
	return RoutePresetInput{
		Mode:                  models.RouteModeManaged,
		DefaultReceiver:       "notify-3",
		PlatformReceiverNames: []string{"notify-3"},
	}
}

// TestSeedManagedRoutePreset_ManagedInjectsCompleteExample 覆盖验收：托管模式 + 空配置域
// → 注入完整示例（根 route 节奏 + 3 条带 matchers 的分流 + 1 条 inhibit 示例）。
func TestSeedManagedRoutePreset_ManagedInjectsCompleteExample(t *testing.T) {
	out, diags, err := SeedManagedRoutePreset(emptyRouteAlertmanagerYML, managedPresetInput())
	require.NoError(t, err)
	require.Empty(t, diags, "成功注入不应有诊断")
	assert.NotEqual(t, emptyRouteAlertmanagerYML, out, "托管模式 + 空配置域应注入示例")

	// 根 route：默认接收人 + 分组键 + 三段节奏齐全。
	root := parsePresetRoot(t, out)
	assert.Equal(t, "notify-3", root.Receiver, "根兜底指向默认接收人（随后由骨架收敛亦为该值）")
	assert.Equal(t, []string{"alertname", "instance"}, root.GroupBy)
	assert.Equal(t, "30s", root.GroupWait)
	assert.Equal(t, "5m", root.GroupInterval)
	assert.Equal(t, "4h", root.RepeatInterval)

	// 3 条示例分流，matchers 为 AM 字符串简写、receiver 真实存在。
	routes := root.Routes
	require.Len(t, routes, 3, "预置示例含 3 条示例分流")
	assert.Equal(t, []string{`severity="critical"`}, routes[0].Matchers)
	assert.Equal(t, "15s", routes[0].GroupWait, "critical 抢时间")
	assert.Equal(t, []string{`severity="warning"`}, routes[1].Matchers)
	assert.Equal(t, "12h", routes[1].RepeatInterval, "warning 不抢时间")
	assert.Equal(t, []string{`team=~"sre|ops"`}, routes[2].Matchers)
	assert.True(t, routes[2].Continue, "值班团队示例演示 continue 语义")

	// 分流显示名以注释落盘（前台路由页可见，用户知道是平台注入的示例）。
	for _, name := range []string{
		"# 路由名称: " + presetRootName,
		"# 路由名称: " + presetCriticalName,
		"# 路由名称: " + presetWarningName,
		"# 路由名称: " + presetTeamName,
	} {
		assert.Contains(t, out, name)
	}

	// 1 条 inhibit 示例：critical 抑制 warning，equal 为标准等价键写法。
	var doc struct {
		InhibitRules []struct {
			SourceMatchers []string `yaml:"source_matchers"`
			TargetMatchers []string `yaml:"target_matchers"`
			Equal          []string `yaml:"equal"`
		} `yaml:"inhibit_rules"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(out), &doc))
	require.Len(t, doc.InhibitRules, 1, "预置示例含 1 条抑制示例")
	assert.Equal(t, []string{`severity="critical"`}, doc.InhibitRules[0].SourceMatchers)
	assert.Equal(t, []string{`severity="warning"`}, doc.InhibitRules[0].TargetMatchers)
	assert.Equal(t, []string{"alertname", "instance"}, doc.InhibitRules[0].Equal)

	// 其余顶层段（global）逐字保留。
	assert.Contains(t, out, "resolve_timeout: 5m")
}

// TestSeedManagedRoutePreset_NoDanglingReceiver 覆盖红线 3：示例内每个 receiver 都必须真实
// 已声明（种子结构上只从 declared 集合里挑），绝不产生悬空引用。
func TestSeedManagedRoutePreset_NoDanglingReceiver(t *testing.T) {
	base := emptyRouteAlertmanagerYML + "  - name: notify-9\n"
	out, diags, err := SeedManagedRoutePreset(base, RoutePresetInput{
		Mode:            models.RouteModeManaged,
		DefaultReceiver: "notify-does-not-exist", // 悬空目标：不得被写进产物
	})
	require.NoError(t, err)
	require.Empty(t, diags)

	declared := map[string]bool{}
	for _, n := range declaredReceiverNames(mustParseRoot(t, out)) {
		declared[n] = true
	}
	for _, name := range referencedReceiverNames(t, out) {
		assert.True(t, declared[name],
			"示例引用的 receiver %q 必须在 receivers 段真实声明（否则 amtool 判 failed）", name)
	}
	// 悬空的 DefaultReceiver 未被采纳，回落到文件内真实声明的名字。
	assert.NotContains(t, out, "notify-does-not-exist")
	assert.Contains(t, out, "receiver: 'user-default'")
}

// TestSeedManagedRoutePreset_SecondaryReceiverPrefersPlatformSlot 覆盖「双接收人分流」示例：
// 存在两个平台槽位时，值班团队子路由改指第二个平台名（真实演示不同分流走不同接收人）。
func TestSeedManagedRoutePreset_SecondaryReceiverPrefersPlatformSlot(t *testing.T) {
	base := emptyRouteAlertmanagerYML + "  - name: notify-3\n  - name: notify-7\n  - name: aaa-user\n"
	out, diags, err := SeedManagedRoutePreset(base, RoutePresetInput{
		Mode:                  models.RouteModeManaged,
		DefaultReceiver:       "notify-3",
		PlatformReceiverNames: []string{"notify-3", "notify-7"},
	})
	require.NoError(t, err)
	require.Empty(t, diags)

	routes := parsePresetRoot(t, out).Routes
	require.Len(t, routes, 3)
	assert.Equal(t, "notify-3", routes[0].Receiver)
	assert.Equal(t, "notify-3", routes[1].Receiver)
	assert.Equal(t, "notify-7", routes[2].Receiver, "值班团队子路由指向第二个平台槽位（而非字典序更小的用户自有名）")
}

// TestSeedManagedRoutePreset_HandwrittenModeByteIdentical 覆盖红线 1（手写 = 永久逃生舱）：
// 手写模式（以及零值 ""）必须字节级原样返回、零诊断——**存量默认零影响**。
func TestSeedManagedRoutePreset_HandwrittenModeByteIdentical(t *testing.T) {
	for _, mode := range []models.RouteMode{models.RouteModeHandwritten, ""} {
		out, diags, err := SeedManagedRoutePreset(emptyRouteAlertmanagerYML, RoutePresetInput{
			Mode: mode, DefaultReceiver: "notify-3", PlatformReceiverNames: []string{"notify-3"},
		})
		require.NoError(t, err, "手写模式不得返回 error")
		assert.Equal(t, emptyRouteAlertmanagerYML, out, "手写模式（mode=%q）字节级不变", mode)
		assert.Empty(t, diags, "手写模式不应产生任何诊断")
	}
}

// TestSeedManagedRoutePreset_NoClobberWhenRouteHasChildren 覆盖红线 2：托管模式下用户已手写
// 具体分流（routes 非空）时，**绝不覆盖**既有配置（段级单一作者 + 模式开关互斥）。
func TestSeedManagedRoutePreset_NoClobberWhenRouteHasChildren(t *testing.T) {
	base := `route:
  receiver: user-default
  group_wait: 30s
  routes:
    - receiver: team-a
      matchers:
        - severity="critical"
receivers:
  - name: user-default
  - name: team-a
`
	out, diags, err := SeedManagedRoutePreset(base, managedPresetInput())
	require.NoError(t, err)
	assert.Equal(t, base, out, "已有子路由时字节级不变")
	require.Len(t, diags, 1)
	assert.Equal(t, PresetSkipRouteNotSeedable, diags[0].Code)
	assert.Contains(t, diags[0].Message, "1 条子路由", "诊断须说明因何判定为用户手改")

	// 用户既有分流逐字保留。
	assert.Contains(t, out, "receiver: team-a")
	assert.Contains(t, out, `severity="critical"`)
	assert.NotContains(t, out, presetCriticalName, "不得注入示例覆盖用户分流")
}

// TestSeedManagedRoutePreset_NoClobberOnRootMatchersOrContinue 覆盖红线 2 的另两类手改痕迹：
// 根 matchers 非空、根 continue=true —— 均视为用户手改、跳过 + 诊断。
func TestSeedManagedRoutePreset_NoClobberOnRootMatchersOrContinue(t *testing.T) {
	cases := []struct {
		name    string
		base    string
		wantMsg string
	}{
		{
			name:    "根 matchers 非空",
			base:    "route:\n  receiver: user-default\n  matchers:\n    - team=\"sre\"\nreceivers:\n  - name: user-default\n",
			wantMsg: "matchers",
		},
		{
			name:    "根 continue=true",
			base:    "route:\n  receiver: user-default\n  continue: true\nreceivers:\n  - name: user-default\n",
			wantMsg: "continue",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, diags, err := SeedManagedRoutePreset(tc.base, managedPresetInput())
			require.NoError(t, err)
			assert.Equal(t, tc.base, out, "已有手改痕迹时字节级不变")
			require.Len(t, diags, 1)
			assert.Equal(t, PresetSkipRouteNotSeedable, diags[0].Code)
			assert.Contains(t, diags[0].Message, tc.wantMsg)
		})
	}
}

// TestSeedManagedRoutePreset_EmptySequencesAreNotUserEdits 反向对照：`routes: []` /
// `matchers: []`（空序列）等价于「没写」，不算用户手改，仍应注入。
func TestSeedManagedRoutePreset_EmptySequencesAreNotUserEdits(t *testing.T) {
	base := "route:\n  receiver: user-default\n  routes: []\n  matchers: []\nreceivers:\n  - name: user-default\n"
	out, diags, err := SeedManagedRoutePreset(base, managedPresetInput())
	require.NoError(t, err)
	require.Empty(t, diags)
	assert.Len(t, parsePresetRoot(t, out).Routes, 3, "空序列不算手改痕迹，仍注入示例")
}

// TestSeedManagedRoutePreset_Idempotent 覆盖幂等：连跑两次输出字节一致（checksum 可复现）。
// 第二次运行命中「已有子路由」门禁原样返回。
func TestSeedManagedRoutePreset_Idempotent(t *testing.T) {
	first, diags, err := SeedManagedRoutePreset(emptyRouteAlertmanagerYML, managedPresetInput())
	require.NoError(t, err)
	require.Empty(t, diags)

	second, _, err := SeedManagedRoutePreset(first, managedPresetInput())
	require.NoError(t, err)
	assert.Equal(t, first, second, "第二次注入应字节一致")

	third, _, err := SeedManagedRoutePreset(second, managedPresetInput())
	require.NoError(t, err)
	assert.Equal(t, first, third, "第三次仍字节一致")
}

// TestSeedManagedRoutePreset_KeepsExistingInhibitRules 覆盖 inhibit_rules 段级所有权
// （平台 + 用户可追加）：用户已有抑制规则时平台**不追加、不改写**。
func TestSeedManagedRoutePreset_KeepsExistingInhibitRules(t *testing.T) {
	base := emptyRouteAlertmanagerYML + `inhibit_rules:
  - source_matchers:
      - severity="critical"
    target_matchers:
      - severity="warning"
    equal: ['instance']
`
	out, diags, err := SeedManagedRoutePreset(base, managedPresetInput())
	require.NoError(t, err)
	require.Empty(t, diags)

	var doc struct {
		InhibitRules []struct {
			Equal []string `yaml:"equal"`
		} `yaml:"inhibit_rules"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(out), &doc))
	require.Len(t, doc.InhibitRules, 1, "已有抑制规则时不得追加示例")
	assert.Equal(t, []string{"instance"}, doc.InhibitRules[0].Equal, "用户既有抑制规则逐字保留")
}

// TestSeedManagedRoutePreset_SkipsDegradesWithoutError 覆盖护栏：YAML 非法 / 顶层非映射 /
// 无 route / route 非映射 一律**跳过 + 诊断、不返回 error**（不得让挂载路径因示例而失败）。
func TestSeedManagedRoutePreset_SkipsDegradesWithoutError(t *testing.T) {
	cases := []struct {
		name     string
		base     string
		wantCode string
	}{
		{"YAML 非法", "route: [unclosed\n", PresetSkipInvalidYAML},
		{"顶层非映射", "- not-a-mapping\n", PresetSkipMalformedDocument},
		{"无 route 节点", "receivers:\n  - name: notify-3\n", PresetSkipNoRoute},
		{"route 非映射", "route: []\nreceivers:\n  - name: notify-3\n", PresetSkipRouteNotMapping},
		{"无可引用 receiver", "route:\n  receiver: ghost\n", PresetSkipNoReceiver},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, diags, err := SeedManagedRoutePreset(tc.base, managedPresetInput())
			require.NoError(t, err, "跳过不得返回 error")
			assert.Equal(t, tc.base, out, "跳过时字节级不变")
			require.Len(t, diags, 1)
			assert.Equal(t, tc.wantCode, diags[0].Code)
			assert.NotEmpty(t, diags[0].Message, "诊断须可读")
		})
	}
}

// TestSeedManagedRoutePreset_DeclaredReceiverNames 覆盖 declaredReceiverNames：按声明顺序去重、
// 忽略非映射项 / 无名项 / 非序列段。
func TestSeedManagedRoutePreset_DeclaredReceiverNames(t *testing.T) {
	root := mustParseRoot(t, `receivers:
  - name: b
  - not-a-mapping
  - name: a
  - name: b
  - webhook_configs: []
`)
	assert.Equal(t, []string{"b", "a"}, declaredReceiverNames(root), "按声明顺序去重")

	assert.Nil(t, declaredReceiverNames(mustParseRoot(t, "global: {}\n")), "无 receivers 段")
	assert.Nil(t, declaredReceiverNames(mustParseRoot(t, "receivers: {}\n")), "receivers 非序列")
}

// TestSeedManagedRoutePreset_AmtoolValid 覆盖验收「种子产物须过 amtool check-config」：
// 本机存在 amtool 时用**真实二进制**校验整份产物（PATH 优先，其次 upstream 开发布局）；
// 缺失时跳过，绝不因外部二进制缺失而假失败。
//
// 这条是红线 3 / 4 的端到端证明：注入后的完整 alertmanager.yml（含 matchers 简写、
// 抑制示例、多层嵌套 routes）必须被 amtool 接受，且**不产生悬空 receiver**。
func TestSeedManagedRoutePreset_AmtoolValid(t *testing.T) {
	amtool := locateAmtool(t)
	stubChecker(t, func(content string) error {
		return runAmtoolCheckConfig(t, amtool, content)
	})

	// 双接收人场景（最复杂：根 + 3 子路由引用两个不同 receiver + 抑制示例）。
	// 基线已含 notify-3，这里只补第二个平台槽位 notify-7（不得重复声明 notify-3：
	// amtool 会判 "notification config name is not unique"）。
	base := emptyRouteAlertmanagerYML + "  - name: notify-7\n"
	out, diags, err := SeedManagedRoutePreset(base, RoutePresetInput{
		Mode:                  models.RouteModeManaged,
		DefaultReceiver:       "notify-3",
		PlatformReceiverNames: []string{"notify-3", "notify-7"},
	})
	require.NoError(t, err)
	require.Empty(t, diags)

	// 校验器签名与 ValidateRouteSectionWithAmtool 同口径（整份配置交 amtool check-config）。
	require.NoError(t, RouteAmtoolChecker(out), "预置示例产物须过 amtool check-config")

	// 反面用例：根 route 无 receiver → amtool 判定失败（证明校验真的在跑，而非恒真）。
	require.Error(t, RouteAmtoolChecker("route:\n  group_by: [alertname]\nreceivers: []\n"),
		"无根兜底 receiver 的配置须被 amtool 拒绝")
}

// TestSeedManagedRoutePreset_MatchersAreAMStringShorthand 覆盖「绝不产出 amtool 拒绝的语法」：
// matchers 一律落 AM 字符串简写（amtool 0.34 只接受简写，映射形态会报
// `cannot unmarshal !!map into string`），且不存在空 matcher 名（`="x"`）。
func TestSeedManagedRoutePreset_MatchersAreAMStringShorthand(t *testing.T) {
	out, diags, err := SeedManagedRoutePreset(emptyRouteAlertmanagerYML, managedPresetInput())
	require.NoError(t, err)
	require.Empty(t, diags)

	// 简写形态：<标签名><操作符>"值"
	for _, m := range []string{`severity="critical"`, `severity="warning"`, `team=~"sre|ops"`} {
		assert.Contains(t, out, m)
	}
	assert.NotContains(t, out, `=""`, "不得出现空 matcher 值")

	// 结构级断言：每个 matchers 序列的元素都必须是标量（简写），不得是映射（新式写法）。
	for _, seq := range collectMatcherSequences(t, out) {
		require.NotEmpty(t, seq)
		for _, item := range seq {
			assert.Equal(t, yaml.ScalarNode, item.Kind,
				"matchers 元素必须是标量简写（amtool 只接受简写），实际值 %q", item.Value)
			name, _, ok := splitMatcherShorthand(item.Value)
			require.True(t, ok, "matcher %q 须为 name<op>value 简写", item.Value)
			assert.NotEmpty(t, strings.TrimSpace(name), "matcher 不得缺标签名（会落成 =\"x\"）")
		}
	}

	// 不得引入旧式 / 编辑态匹配键。
	for _, m := range collectYAMLKeys(t, out) {
		assert.NotContains(t, []string{"match", "match_re", "isRegex", "is_equal", "isRegex"}, m,
			"matchers 只走简写，不落编辑态/旧式匹配键")
	}
	// inhibit_rules 的 source/target matchers 同样落简写。
	assert.Contains(t, out, "source_matchers:")
	assert.NotContains(t, out, "source_match:\n", "旧式 match 键不新增")
}

// --- 测试辅助 ---

// presetRouteView 是预置示例产物的解析视图（比骨架测试的 routeNodeView 多节奏 / continue）。
type presetRouteView struct {
	Receiver       string            `yaml:"receiver"`
	GroupBy        []string          `yaml:"group_by"`
	GroupWait      string            `yaml:"group_wait"`
	GroupInterval  string            `yaml:"group_interval"`
	RepeatInterval string            `yaml:"repeat_interval"`
	Continue       bool              `yaml:"continue"`
	Matchers       []string          `yaml:"matchers"`
	Routes         []presetRouteView `yaml:"routes"`
}

// parsePresetRoot 解析产物 YAML 的根 route 节点视图。
func parsePresetRoot(t *testing.T, yml string) presetRouteView {
	t.Helper()
	var doc struct {
		Route presetRouteView `yaml:"route"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(yml), &doc))
	return doc.Route
}

// mustParseRoot 解析出 YAML 顶层映射节点（测试辅助，解析失败直接 fail）。
func mustParseRoot(t *testing.T, yml string) *yaml.Node {
	t.Helper()
	var doc yaml.Node
	require.NoError(t, yaml.Unmarshal([]byte(yml), &doc), "基线 YAML 须合法")
	require.NotEmpty(t, doc.Content)
	return doc.Content[0]
}

// referencedReceiverNames 收集产物中所有 route 节点引用的 receiver 名（去重）。
func referencedReceiverNames(t *testing.T, yml string) []string {
	t.Helper()
	var doc yaml.Node
	require.NoError(t, yaml.Unmarshal([]byte(yml), &doc))
	names := []string{}
	seen := map[string]bool{}
	var walk func(n *yaml.Node)
	walk = func(n *yaml.Node) {
		if n == nil {
			return
		}
		if n.Kind == yaml.MappingNode {
			if vi := mappingValueIndex(n, "receiver"); vi >= 0 {
				name := n.Content[vi].Value
				if name != "" && !seen[name] {
					seen[name] = true
					names = append(names, name)
				}
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(&doc)
	return names
}

// collectMatcherSequences 收集产物中所有 matchers / source_matchers / target_matchers 序列
// 的元素节点（用于断言「元素必须是标量简写」）。
func collectMatcherSequences(t *testing.T, yml string) [][]*yaml.Node {
	t.Helper()
	var doc yaml.Node
	require.NoError(t, yaml.Unmarshal([]byte(yml), &doc))
	seqs := [][]*yaml.Node{}
	var walk func(n *yaml.Node)
	walk = func(n *yaml.Node) {
		if n == nil {
			return
		}
		if n.Kind == yaml.MappingNode {
			for _, key := range []string{"matchers", "source_matchers", "target_matchers"} {
				if vi := mappingValueIndex(n, key); vi >= 0 && n.Content[vi].Kind == yaml.SequenceNode {
					seqs = append(seqs, n.Content[vi].Content)
				}
			}
		}
		for _, c := range n.Content {
			walk(c)
		}
	}
	walk(&doc)
	return seqs
}

// TestSeedManagedRoutePreset_EmptyBaseIsNoOp 边界：空产物（无告警配置留痕）不注入、不报错、
// 也不出诊断（与 MaterializeNotifyReceivers 的空产物早退同口径）。
func TestSeedManagedRoutePreset_EmptyBaseIsNoOp(t *testing.T) {
	for _, base := range []string{"", "   \n"} {
		out, diags, err := SeedManagedRoutePreset(base, managedPresetInput())
		require.NoError(t, err)
		assert.Equal(t, base, out)
		assert.Empty(t, diags)
	}
}

// TestSeedManagedRoutePreset_DiagnosticMessagesAreActionable 覆盖诊断可读性：每条诊断都须
// 说明「为什么跳过」+「怎么办」，避免用户只看到一个归因码。
func TestSeedManagedRoutePreset_DiagnosticMessagesAreActionable(t *testing.T) {
	out, diags, err := SeedManagedRoutePreset("route:\n  receiver: ghost\n", managedPresetInput())
	require.NoError(t, err)
	assert.Equal(t, "route:\n  receiver: ghost\n", out)
	require.Len(t, diags, 1)
	msg := diags[0].Message
	assert.True(t, strings.Contains(msg, "跳过"), "诊断须说明跳过：%s", msg)
	assert.True(t, strings.Contains(msg, "receiver"), "诊断须点名 receiver：%s", msg)
	assert.True(t, strings.Contains(msg, "请先"), "诊断须给出下一步动作：%s", msg)
}
