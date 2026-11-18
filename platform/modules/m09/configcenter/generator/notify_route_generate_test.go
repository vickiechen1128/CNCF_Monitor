package generator

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// ptrBool 构造 bool 指针（编辑态 *bool 字段测试用）。
func ptrBool(b bool) *bool { return &b }

// sampleRouteEditTree 构造一份编辑态路由树（顺序 = 界面顺序）：
//   - root：根兜底（带分组键与节奏）
//   - root/0：主机宕机专用（正则 matcher）
//   - root/1：P0 严重告警；其下 root/1/0：非 SRE（取反 matcher + continue=true）
func sampleRouteEditTree() []RouteEditNode {
	return []RouteEditNode{
		{
			ID: "root", ParentID: "", Name: "根路由", Receiver: "default",
			GroupBy:   []string{"instance", "alertname"},
			GroupWait: "30s", GroupInterval: "5m", RepeatInterval: "4h", Enabled: ptrBool(true),
		},
		{
			ID: "root/0", ParentID: "root", Name: "主机宕机专用", Receiver: "feishu",
			Matchers:  []RouteEditMatcher{{Name: "alertname", Value: "HostDown|NodeExporterDown", IsEqual: true, IsRegex: true}},
			GroupWait: "15s", GroupInterval: "10s", RepeatInterval: "10s", Enabled: ptrBool(true),
		},
		{
			ID: "root/1", ParentID: "root", Name: "P0 严重告警", Receiver: "feishu",
			Matchers:  []RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}},
			GroupWait: "15s", GroupInterval: "3m", RepeatInterval: "1h", Enabled: ptrBool(true),
		},
		{
			ID: "root/1/0", ParentID: "root/1", Name: "非 SRE", Receiver: "wechat",
			Matchers: []RouteEditMatcher{{Name: "team", Value: "sre", IsEqual: false}},
			Continue: true,
			Enabled:  ptrBool(true),
		},
	}
}

// wantSampleRouteSection 是 sampleRouteEditTree 的期望落盘形态（提案 §3.5 示例同构）：
// routes[] 顺序 = 界面顺序；name 以注释落盘；无编辑态字段。
const wantSampleRouteSection = `route:
    # 路由名称: 根路由
    receiver: 'default'
    group_by: [instance, alertname]
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

// TestGenerateRouteSection_ShapeAndInterfaceOrder 覆盖验收 1：routes[] 顺序 = 界面顺序，
// matchers 落字符串简写、continue 仅在 true 时输出、group_by 有值才输出。
func TestGenerateRouteSection_ShapeAndInterfaceOrder(t *testing.T) {
	got, err := GenerateRouteSection(sampleRouteEditTree())
	require.NoError(t, err)
	assert.Equal(t, wantSampleRouteSection, got, "落盘形态与界面顺序须逐字一致")

	// 顺序 = 界面顺序（先匹配先生效）：把两条一级子路由互换后，YAML 位置随之互换。
	tree := sampleRouteEditTree()
	tree[1], tree[2] = tree[2], tree[1]
	got, err = GenerateRouteSection(tree)
	require.NoError(t, err)
	assert.Less(t, strings.Index(got, "P0 严重告警"), strings.Index(got, "主机宕机专用"),
		"routes[] 顺序须等于界面顺序")
}

// TestGenerateRouteSection_MatcherShorthandForms 覆盖验收 1 的 matcher 四种操作符：
// `=` / `!=` / `=~` / `!~` 均落 AM 字符串简写（amtool check-config 只认简写，见实现注释）。
func TestGenerateRouteSection_MatcherShorthandForms(t *testing.T) {
	tree := []RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: ptrBool(true)},
		{
			ID: "root/0", ParentID: "root", Receiver: "feishu", Enabled: ptrBool(true),
			Matchers: []RouteEditMatcher{
				{Name: "severity", Value: "critical", IsEqual: true},
				{Name: "severity", Value: "info", IsEqual: false},
				{Name: "alertname", Value: "HostDown|CPU", IsEqual: true, IsRegex: true},
				{Name: "team", Value: "sre", IsEqual: false, IsRegex: true},
			},
		},
	}
	got, err := GenerateRouteSection(tree)
	require.NoError(t, err)
	for _, want := range []string{
		`- severity="critical"`,
		`- severity!="info"`,
		`- alertname=~"HostDown|CPU"`,
		`- team!~"sre"`,
	} {
		assert.Contains(t, got, want)
	}
	assert.NotContains(t, got, "isRegex", "正则/取反一律走简写操作符，不落新式映射键")
}

// TestGenerateRouteSection_ContinueOnlyWhenTrue 覆盖验收 1：continue 仅在 true 时输出。
func TestGenerateRouteSection_ContinueOnlyWhenTrue(t *testing.T) {
	tree := []RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: ptrBool(true)},
		{ID: "root/0", ParentID: "root", Receiver: "a", Enabled: ptrBool(true), Continue: false},
		{ID: "root/1", ParentID: "root", Receiver: "b", Enabled: ptrBool(true), Continue: true},
	}
	got, err := GenerateRouteSection(tree)
	require.NoError(t, err)
	assert.Equal(t, 1, strings.Count(got, "continue:"), "continue=false 的路由不输出该键")
	assert.Contains(t, got, "continue: true")
}

// TestGenerateRouteSection_GroupByOmittedWhenEmpty 覆盖验收 1：留空 group_by 不输出该键。
func TestGenerateRouteSection_GroupByOmittedWhenEmpty(t *testing.T) {
	for _, empty := range [][]string{nil, {}} {
		tree := []RouteEditNode{
			{ID: "root", Receiver: "default", GroupBy: empty, Enabled: ptrBool(true)},
			{ID: "root/0", ParentID: "root", Receiver: "a", GroupBy: []string{"alertname"}, Enabled: ptrBool(true)},
		}
		got, err := GenerateRouteSection(tree)
		require.NoError(t, err)
		assert.NotContains(t, got, "group_by: []", "空分组键不得落盘")
		assert.Contains(t, got, "group_by: [alertname]")
	}
}

// TestGenerateRouteSection_EditStateFieldsNeverPersisted 覆盖验收 2：id / parent_id /
// order / enabled 四个编辑态字段彻底不落盘；name 以注释形式落盘于节点上方。
func TestGenerateRouteSection_EditStateFieldsNeverPersisted(t *testing.T) {
	tree := sampleRouteEditTree()
	tree[1].Order = 7 // 即便上游填了 order，也不得落盘
	got, err := GenerateRouteSection(tree)
	require.NoError(t, err)

	keys := collectYAMLKeys(t, got)
	for _, forbidden := range []string{"id", "parent_id", "order", "enabled", "name", "raw_yaml"} {
		assert.NotContains(t, keys, forbidden, "编辑态字段 %q 不得落盘", forbidden)
	}
	for _, comment := range []string{
		"# 路由名称: 根路由",
		"# 路由名称: 主机宕机专用",
		"# 路由名称: P0 严重告警",
		"# 路由名称: 非 SRE",
	} {
		assert.Contains(t, got, comment, "name 以注释落盘于节点上方")
	}
}

// TestGenerateRouteSection_DisabledNodeDropsWholeSubtree 覆盖验收 2：enabled=false
// 的规则及其子树整条剔除。
func TestGenerateRouteSection_DisabledNodeDropsWholeSubtree(t *testing.T) {
	tree := sampleRouteEditTree()
	tree[2].Enabled = ptrBool(false) // P0 严重告警（含子路由「非 SRE」）
	got, err := GenerateRouteSection(tree)
	require.NoError(t, err)

	assert.Contains(t, got, "# 路由名称: 主机宕机专用", "启用的兄弟路由保留")
	assert.NotContains(t, got, "P0 严重告警", "enabled=false 整条剔除")
	assert.NotContains(t, got, "非 SRE", "enabled=false 的子树一并剔除")
	assert.NotContains(t, got, "wechat", "被剔除子树引用的接收人不应残留")
}

// TestGenerateRouteSection_NilEnabledTreatedAsEnabled 覆盖 H3：编辑态 Enabled 零值 nil
// = 未设定 = 启用（向后兼容导入侧无需显式置位），生成时整条保留，不误剔除。
func TestGenerateRouteSection_NilEnabledTreatedAsEnabled(t *testing.T) {
	tree := []RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: ptrBool(true)},
		{ID: "root/0", ParentID: "root", Receiver: "a"}, // Enabled 零值 nil
	}
	got, err := GenerateRouteSection(tree)
	require.NoError(t, err)
	assert.Contains(t, got, "receiver: 'a'", "nil Enabled 视为启用，节点仍落盘")
	assert.NotContains(t, got, "enabled", "编辑态字段不落盘")
}

// TestGenerateRouteSection_RawSubtreeWrittenBackVerbatim 覆盖验收 5：平台未建模键
// （此处为 match / mute_time_intervals）所在子树标 raw 后原样回写，绝不静默丢弃。
func TestGenerateRouteSection_RawSubtreeWrittenBackVerbatim(t *testing.T) {
	tree := []RouteEditNode{
		{ID: "root", Receiver: "default", Enabled: ptrBool(true)},
		{ID: "root/0", ParentID: "root", Receiver: "a", Enabled: ptrBool(true)},
		{
			ID: "root/1", ParentID: "root", Name: "不可表达路由", Enabled: ptrBool(true),
			RawYAML: "" +
				"match:\n" +
				"    severity: critical\n" +
				"receiver: raw-recv\n" +
				"mute_time_intervals:\n" +
				"    - 夜间免打扰\n",
		},
		{
			ID: "root/2", ParentID: "root", Enabled: ptrBool(true),
			RawYAML: "" +
				"receiver: raw-2\n" +
				"group_by:\n" +
				"    nested: 非标量分组键\n",
		},
	}
	got, err := GenerateRouteSection(tree)
	require.NoError(t, err)

	assert.Contains(t, got, "match:", "未建模的 match 键原样回写")
	assert.Contains(t, got, "severity: critical")
	assert.Contains(t, got, "receiver: raw-recv")
	assert.Contains(t, got, "mute_time_intervals:")
	assert.Contains(t, got, "夜间免打扰")
	assert.Contains(t, got, "nested: 非标量分组键", "非标量 group_by 原样回写")
}

// TestGenerateRouteSection_RejectsMalformedEditTree 覆盖「绝不静默丢弃」：畸形编辑态树
// 一律显式报错，不产出半截 route 段。
func TestGenerateRouteSection_RejectsMalformedEditTree(t *testing.T) {
	cases := []struct {
		name string
		tree []RouteEditNode
	}{
		{"空树", nil},
		{"无根节点", []RouteEditNode{{ID: "a", ParentID: "root", Enabled: ptrBool(true)}}},
		{"多根节点", []RouteEditNode{
			{ID: "root", Receiver: "d", Enabled: ptrBool(true)},
			{ID: "root2", Receiver: "d", Enabled: ptrBool(true)},
		}},
		{"重复 ID", []RouteEditNode{
			{ID: "root", Receiver: "d", Enabled: ptrBool(true)},
			{ID: "root/0", ParentID: "root", Receiver: "a", Enabled: ptrBool(true)},
			{ID: "root/0", ParentID: "root", Receiver: "b", Enabled: ptrBool(true)},
		}},
		{"孤立节点（父不存在）", []RouteEditNode{
			{ID: "root", Receiver: "d", Enabled: ptrBool(true)},
			{ID: "x/0", ParentID: "x", Receiver: "a", Enabled: ptrBool(true)},
		}},
		{"从根不可达（成环）", []RouteEditNode{
			{ID: "root", Receiver: "d", Enabled: ptrBool(true)},
			{ID: "x", ParentID: "y", Receiver: "a", Enabled: ptrBool(true)},
			{ID: "y", ParentID: "x", Receiver: "b", Enabled: ptrBool(true)},
		}},
		{"根节点未启用", []RouteEditNode{{ID: "root", Receiver: "d", Enabled: ptrBool(false)}}},
		{"raw 原文非法", []RouteEditNode{
			{ID: "root", Receiver: "d", Enabled: ptrBool(true)},
			{ID: "root/0", ParentID: "root", Enabled: ptrBool(true), RawYAML: "\tnot: [valid"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := GenerateRouteSection(tc.tree)
			require.Error(t, err, "畸形树必须显式报错")
			assert.Empty(t, got)
		})
	}
}

// collectYAMLKeys 收集 YAML 文档中所有映射键名（顺序遍历），用于断言落盘字段集合。
func collectYAMLKeys(t *testing.T, content string) []string {
	t.Helper()
	var doc yaml.Node
	require.NoError(t, yaml.Unmarshal([]byte(content), &doc))
	keys := []string{}
	var walk func(n *yaml.Node)
	walk = func(n *yaml.Node) {
		if n == nil {
			return
		}
		for i := 0; i+1 < len(n.Content); i += 2 {
			if n.Kind == yaml.MappingNode {
				keys = append(keys, n.Content[i].Value)
			}
			walk(n.Content[i+1])
		}
		if n.Kind != yaml.MappingNode {
			for _, c := range n.Content {
				walk(c)
			}
		}
	}
	walk(&doc)
	return keys
}
