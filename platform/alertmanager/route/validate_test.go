package route

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
)

// healthyRouteYAML 是一份健康的 route 段：根兜底带节奏，两条一级子路由（第二条带一条
// 子路由 + continue），子路由名称以注释落盘，matchers 走字符串简写（与线上现网同构）。
//
// 注：根路由未带名称注释——T08-12 解析器不读取顶层 `route:` 键上方的注释（yaml.v3 把
// 它挂在键节点上，见 parse.go routeNameFromComments），根名称由导入侧显式命名后再
// 往返（生成器的注释落点可被解析器还原）。
const healthyRouteYAML = `route:
    receiver: 'default'
    group_by: ['instance', 'alertname']
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
    routes:
        # 路由名称: 主机宕机专用
        - matchers:
              - alertname=~"HostDown|NodeExporterDown"
          receiver: 'feishu'
          group_wait: 15s
          group_interval: 10s
          repeat_interval: 10s
        # 路由名称: P0 严重告警
        - matchers:
              - severity="critical"
          receiver: 'feishu'
          group_wait: 15s
          group_interval: 3m
          repeat_interval: 1h
          routes:
              # 路由名称: 非 SRE
              - matchers:
                    - team!="sre"
                receiver: 'wechat'
                continue: true
`

// TestValidateRouteTree_HealthyTreeNoIssues 覆盖健康路由树：无阻断、无警告
// （5m/4h、10s/10s、3m/1h 三处节奏均为整除关系）。
func TestValidateRouteTree_HealthyTreeNoIssues(t *testing.T) {
	nodes, err := ParseRouteTree(healthyRouteYAML)
	require.NoError(t, err)
	require.Len(t, nodes, 4)

	issues := ValidateRouteTree(ToEditNodes(nodes))
	assert.Empty(t, issues, "健康路由树不应产生任何结论")
	assert.False(t, HasBlockingIssue(issues))
}

// TestValidateRouteTree_RootReceiverRequired 覆盖 AM 权威校验：根 route 必须指定兜底
// receiver（子路由可留空继承，故只有根缺 receiver 才算阻断）。
func TestValidateRouteTree_RootReceiverRequired(t *testing.T) {
	nodes, err := ParseRouteTree("route:\n    routes:\n        - receiver: a\n")
	require.NoError(t, err)

	issues := ValidateRouteTree(ToEditNodes(nodes))
	require.Len(t, issues, 1)
	assert.Equal(t, RouteIssueLevelError, issues[0].Level)
	assert.Equal(t, RouteIssueCodeRootReceiverRequired, issues[0].Code)
	assert.True(t, HasBlockingIssue(issues), "根兜底缺失须阻断保存")
}

// TestValidateRouteTree_RootMatchersForbidden 覆盖 AM 权威校验：根 route 不得带 matchers
// （root route must not have any matchers）。
func TestValidateRouteTree_RootMatchersForbidden(t *testing.T) {
	nodes, err := ParseRouteTree("route:\n    receiver: default\n    matchers:\n        - severity=\"critical\"\n")
	require.NoError(t, err)

	issues := ValidateRouteTree(ToEditNodes(nodes))
	require.Len(t, issues, 1)
	assert.Equal(t, RouteIssueLevelError, issues[0].Level)
	assert.Equal(t, RouteIssueCodeRootMatchersForbidden, issues[0].Code)
}

// TestValidateRouteTree_MatcherIssues 覆盖 matcher 体检：标签名为空 / 正则值非法 → 阻断级。
func TestValidateRouteTree_MatcherIssues(t *testing.T) {
	nodes, err := ParseRouteTree("" +
		"route:\n" +
		"    receiver: default\n" +
		"    routes:\n" +
		"        - receiver: a\n" +
		"          matchers:\n" +
		"              - value: orphan\n" +
		"              - name: alertname\n" +
		"                value: \"HostDown|Node(Exporter\"\n" +
		"                isRegex: true\n")
	require.NoError(t, err)

	issues := ValidateRouteTree(ToEditNodes(nodes))
	codes := issueCodes(issues)
	assert.Contains(t, codes, RouteIssueCodeMatcherNameEmpty, "标签名为空须报错")
	assert.Contains(t, codes, RouteIssueCodeMatcherRegexInvalid, "正则值非法须报错")
	assert.True(t, HasBlockingIssue(issues))
}

// TestValidateRouteTree_InvalidDurationIsError 覆盖时长口径：非 AM 时长一律阻断级
// （与「不整除只警告」区分开）。
func TestValidateRouteTree_InvalidDurationIsError(t *testing.T) {
	nodes, err := ParseRouteTree("" +
		"route:\n" +
		"    receiver: default\n" +
		"    group_wait: 30\n" +
		"    routes:\n" +
		"        - receiver: a\n" +
		"          group_interval: 一会儿\n")
	require.NoError(t, err)

	issues := ValidateRouteTree(ToEditNodes(nodes))
	require.Len(t, issues, 2, "两处非法时长各一条结论")
	for _, it := range issues {
		assert.Equal(t, RouteIssueLevelError, it.Level)
		assert.Equal(t, RouteIssueCodeDurationInvalid, it.Code)
	}
	assert.Equal(t, "group_wait", issues[0].Field)
	assert.Equal(t, "group_interval", issues[1].Field)
}

// TestValidateRouteTree_RepeatIntervalNotMultipleIsWarningOnly 覆盖验收 6：
// group_interval 不整除 repeat_interval 时**不阻断**（与 AM 向上取整行为一致），仅给
// 警告级提示。
func TestValidateRouteTree_RepeatIntervalNotMultipleIsWarningOnly(t *testing.T) {
	nodes, err := ParseRouteTree("" +
		"route:\n" +
		"    receiver: default\n" +
		"    routes:\n" +
		"        - receiver: a\n" +
		"          group_interval: 3m\n" +
		"          repeat_interval: 10s\n")
	require.NoError(t, err)

	issues := ValidateRouteTree(ToEditNodes(nodes))
	require.Len(t, issues, 1)
	assert.Equal(t, RouteIssueLevelWarning, issues[0].Level, "不整除只给警告，不阻断")
	assert.Equal(t, RouteIssueCodeRepeatNotMultiple, issues[0].Code)
	assert.False(t, HasBlockingIssue(issues), "警告级结论不得阻断保存")
	assert.Contains(t, issues[0].Message, "向上取整")
}

// TestValidateRouteTree_EmptyTreeNoIssues 覆盖空树（无生效配置）：不产出结论。
func TestValidateRouteTree_EmptyTreeNoIssues(t *testing.T) {
	nodes, err := ParseRouteTree("")
	require.NoError(t, err)
	assert.Empty(t, ValidateRouteTree(ToEditNodes(nodes)))
}

// TestParseRouteDuration 覆盖 AM 时长解析：ms/s/m/h/d/w/y 及组合，非法值返回 false。
func TestParseRouteDuration(t *testing.T) {
	cases := []struct {
		in    string
		want  int64
		valid bool
	}{
		{"30s", 30_000, true},
		{"5m", 300_000, true},
		{"4h", 14_400_000, true},
		{"1d", 86_400_000, true},
		{"1w", 604_800_000, true},
		{"1y", 31_536_000_000, true},
		{"1h30m", 5_400_000, true},
		{"1500ms", 1_500, true},
		{"0", 0, true},
		{"", 0, false},
		{"30", 0, false},
		{"一会儿", 0, false},
		{"3m 10s", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got, ok := ParseRouteDuration(tc.in)
			assert.Equal(t, tc.valid, ok, "解析合法性不符: %q", tc.in)
			if tc.valid {
				assert.Equal(t, tc.want, got, "毫秒数不符: %q", tc.in)
			}
		})
	}
}

// TestGenerateRouteSection_RoundTripParseGenParse 覆盖验收 4 的往返无损：
// parse(x) → 编辑态 → GenerateRouteSection → parse 的结果与 parse(x) **结构等价**
// （含层级 / 顺序 / matchers 双形态归一 / 节奏 / continue / name 注释还原）。
func TestGenerateRouteSection_RoundTripParseGenParse(t *testing.T) {
	first, err := ParseRouteTree(healthyRouteYAML)
	require.NoError(t, err)

	edit := ToEditNodes(first)
	edit[0].Name = "根兜底" // 导入侧为根显式命名

	generated, err := generator.GenerateRouteSection(edit)
	require.NoError(t, err)

	second, err := ParseRouteTree(generated)
	require.NoError(t, err)

	want := append([]RouteNode{}, first...)
	want[0].Name = "根兜底"
	assert.Equal(t, want, second, "parse(gen(parse(x))) 须与 parse(x) 结构等价")

	// name 经注释往返还原（根与子路由均不得丢失）。
	assert.Equal(t, "根兜底", second[0].Name)
	assert.Equal(t, "主机宕机专用", second[1].Name)
	assert.Equal(t, "非 SRE", second[3].Name)

	// 再生成一次须幂等（同一份编辑态树的产物字节一致）。
	again, err := generator.GenerateRouteSection(ToEditNodes(second))
	require.NoError(t, err)
	assert.Equal(t, generated, again, "同一编辑态树的生成产物须幂等")
}

// TestGenerateRouteSection_RoundTripPreservesInterfaceOrder 覆盖验收 3（顺序即优先级）：
// 编辑态调序后生成物的 routes[] 顺序随之变化，且可回读为同一顺序。
func TestGenerateRouteSection_RoundTripPreservesInterfaceOrder(t *testing.T) {
	first, err := ParseRouteTree(healthyRouteYAML)
	require.NoError(t, err)

	edit := ToEditNodes(first)
	// 界面上把「P0 严重告警」（含子树）上移到首位：调数组顺序即可。
	edit[1], edit[2] = edit[2], edit[1]

	generated, err := generator.GenerateRouteSection(edit)
	require.NoError(t, err)
	second, err := ParseRouteTree(generated)
	require.NoError(t, err)

	// 前序扁平化：调序后为 根 → P0 严重告警 → 其子「非 SRE」→ 主机宕机专用。
	require.Len(t, second, 4)
	assert.Equal(t, "P0 严重告警", second[1].Name, "routes[] 顺序须等于界面顺序")
	assert.Equal(t, "非 SRE", second[2].Name)
	assert.Equal(t, "主机宕机专用", second[3].Name)
}

// TestMergeRouteSection_KeepsUserSectionsFromRoundTrip 覆盖验收 3 的整份视角：生成物
// 原地替换回手写 base 后，route 段被平台重建，用户手写的 receivers / inhibit_rules /
// templates / mute_time_intervals 逐字保留（提案 §4.4「双作者不打架」的后端部分）。
func TestMergeRouteSection_KeepsUserSectionsFromRoundTrip(t *testing.T) {
	base := "global:\n    resolve_timeout: 5m\n" + healthyRouteYAML +
		"receivers:\n    - name: default\n    - name: feishu\n    - name: wechat\n" +
		"mute_time_intervals:\n    - name: 夜间\n"

	first, err := ParseRouteTree(base)
	require.NoError(t, err)
	generated, err := generator.GenerateRouteSection(ToEditNodes(first))
	require.NoError(t, err)

	merged, err := generator.MergeRouteSection(base, generated)
	require.NoError(t, err)

	assert.Contains(t, merged, "global:\n    resolve_timeout: 5m\n")
	assert.Contains(t, merged, "receivers:\n    - name: default\n    - name: feishu\n    - name: wechat\n")
	assert.Contains(t, merged, "mute_time_intervals:\n    - name: 夜间\n")

	// 合并产物仍可被解析器回读，且与原路由树结构等价。
	after, err := ParseRouteTree(merged)
	require.NoError(t, err)
	assert.Equal(t, first, after, "合并后的 route 段须与原树结构等价")
	assert.Empty(t, ValidateRouteTree(ToEditNodes(after)))
}

// TestParseRoute_PreservesUnmodeledRouteKeys 覆盖 B1：route 级未建模键（旧式 match / match_re /
// 路由级 mute_time_intervals）解析时被捕获进 Raw，且经 parse→编辑态→生成往返**原样存活**，
// 绝不静默丢弃（手写配置 import→save 无损，越过 T08-12 边界）。
func TestParseRoute_PreservesUnmodeledRouteKeys(t *testing.T) {
	yaml := `route:
    receiver: default
    match:
        severity: critical
    mute_time_intervals:
        - 夜间免打扰
    routes:
        - receiver: a
          match_re:
            team: sre
`
	nodes, err := ParseRouteTree(yaml)
	require.NoError(t, err)
	require.Len(t, nodes, 2)

	assert.Contains(t, nodes[0].Raw, "match:", "根路由未建模键须被捕获而非丢弃")
	assert.Contains(t, nodes[0].Raw, "mute_time_intervals:")
	assert.Contains(t, nodes[1].Raw, "match_re:", "子路由未建模键也须捕获")

	// 往返：parse → 编辑态 → 生成，未建模键须原样存活于产物。
	gen, err := generator.GenerateRouteSection(ToEditNodes(nodes))
	require.NoError(t, err)
	assert.Contains(t, gen, "match:", "未建模键须经 parse→generate 存活")
	assert.Contains(t, gen, "severity: critical")
	assert.Contains(t, gen, "mute_time_intervals:")
	assert.Contains(t, gen, "夜间免打扰")
	assert.Contains(t, gen, "match_re:", "子路由未建模键也须存活")

	// 二次解析仍捕获，证明无损。
	again, err := ParseRouteTree(gen)
	require.NoError(t, err)
	require.Len(t, again, 2)
	assert.Contains(t, again[0].Raw, "match:")
	assert.Contains(t, again[1].Raw, "match_re:")
}

// TestValidateRouteTree_SkipsDisabledSubtree 覆盖 H2：校验接收保存链真实持有的
// []generator.RouteEditNode；被 *false 禁用的节点及其子树不会被生成器产出，故跳过校验，
// 避免对落盘内容误报阻断。
func TestValidateRouteTree_SkipsDisabledSubtree(t *testing.T) {
	nodes := []generator.RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: boolPtr(true)},
		{ID: "root/0", ParentID: "root", Receiver: "a", Enabled: boolPtr(false),
			Matchers: []generator.RouteEditMatcher{{Name: "", Value: "x"}}},
	}
	issues := ValidateRouteTree(nodes)
	assert.Empty(t, issues, "禁用节点及其子树不产出，不应被校验误报")
}

// TestValidateRouteTree_EditNodeThenGenerateAmtoolOK 覆盖 H2：保存链真实持有的 []RouteEditNode
// 经 ValidateRouteTree 校验（无阻断）→ GenerateRouteSection → ValidateRouteSectionWithAmtool
// 闭环通过，证明校验类型已对齐保存链、不会产出 amtool 拒绝内容。
func TestValidateRouteTree_EditNodeThenGenerateAmtoolOK(t *testing.T) {
	nodes := []generator.RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: boolPtr(true)},
		{ID: "root/0", ParentID: "root", Receiver: "a", Enabled: boolPtr(true),
			Matchers: []generator.RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}}},
	}
	require.Empty(t, ValidateRouteTree(nodes), "合法编辑态校验须无阻断")

	gen, err := generator.GenerateRouteSection(nodes)
	require.NoError(t, err)

	var submitted string
	old := generator.RouteAmtoolChecker
	generator.RouteAmtoolChecker = func(content string) error { submitted = content; return nil }
	t.Cleanup(func() { generator.RouteAmtoolChecker = old })

	require.NoError(t, generator.ValidateRouteSectionWithAmtool(gen))
	assert.Contains(t, submitted, "receiver: 'default'")
}

// TestValidateRouteTree_EditNodeEmptyNameMatcherBlocked 覆盖 H2：保存链持有的编辑态 matcher
// 标签名为空时，生成器会渲染成 amtool 拒绝的 `="x"` 字面量——校验须在此类输入上阻断，
// 证明 ValidateRouteTree 已对齐保存链实际类型（不再对 []RouteNode 误判）。
func TestValidateRouteTree_EditNodeEmptyNameMatcherBlocked(t *testing.T) {
	nodes := []generator.RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: boolPtr(true)},
		{ID: "root/0", ParentID: "root", Receiver: "a", Enabled: boolPtr(true),
			Matchers: []generator.RouteEditMatcher{{Name: "", Value: "x", IsEqual: true}}},
	}
	issues := ValidateRouteTree(nodes)
	require.Len(t, issues, 1)
	assert.Equal(t, RouteIssueCodeMatcherNameEmpty, issues[0].Code)
	assert.True(t, HasBlockingIssue(issues))
}

// issueCodes 提取结论码，便于断言。
func issueCodes(issues []RouteIssue) []string {
	codes := make([]string, 0, len(issues))
	for _, it := range issues {
		codes = append(codes, it.Code)
	}
	return codes
}
