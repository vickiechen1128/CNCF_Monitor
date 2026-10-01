package generator

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// sampleAlertmanagerYML 是一份典型手写 alertmanager.yml：根兜底 receiver = user-default，
// 带完整节奏字段与一条带 matchers 的具体分流（骨架绝不可触碰的部分）。
const sampleAlertmanagerYML = `global:
  resolve_timeout: 5m
# 用户手写注释：根兜底
route:
  receiver: user-default
  group_by: ['alertname', 'instance']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: team-a
      matchers:
        - severity="critical"
      continue: true
receivers:
  - name: user-default
  - name: team-a
  - name: notify-3
`

// TestMaterializeRootRouteReceiverDisabledByteIdentical 覆盖决策 113 红线：
// 开关关闭 / 目标为空 → 产物字节级不变（存量零影响）。
func TestMaterializeRootRouteReceiverDisabledByteIdentical(t *testing.T) {
	out, diags, err := MaterializeRootRouteReceiver(sampleAlertmanagerYML, RootRouteInput{
		Enabled:         false,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Equal(t, sampleAlertmanagerYML, out, "开关关闭时字节级不变")
	assert.Empty(t, diags)

	out, diags, err = MaterializeRootRouteReceiver(sampleAlertmanagerYML, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "",
	})
	require.NoError(t, err)
	assert.Equal(t, sampleAlertmanagerYML, out, "目标为空时字节级不变")
	assert.Empty(t, diags)
}

// TestMaterializeRootRouteReceiverReplacesOnlyRootReceiver 覆盖「只原地替换根 route.receiver
// 单键」：节奏字段 / continue / routes[] / matchers 逐字保留（决策 113 第 4 条红线）。
func TestMaterializeRootRouteReceiverReplacesOnlyRootReceiver(t *testing.T) {
	out, diags, err := MaterializeRootRouteReceiver(sampleAlertmanagerYML, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Empty(t, diags)

	assert.Contains(t, out, "receiver: notify-3", "根兜底被替换为平台默认接收人")
	assert.NotContains(t, out, "receiver: user-default", "旧根兜底值被替换")

	// 节奏字段逐字保留。
	for _, want := range []string{
		"group_by: ['alertname', 'instance']",
		"group_wait: 30s",
		"group_interval: 5m",
		"repeat_interval: 4h",
		"continue: true",
		"# 用户手写注释：根兜底",
	} {
		assert.Contains(t, out, want, "应逐字保留 %q", want)
	}

	// 用户具体分流（routes[]）逐字保留：骨架不写进用户手改的具体分流。
	assert.Contains(t, out, `severity="critical"`)
	assert.Contains(t, out, "receiver: team-a")
	parsed := parseRouteTree(t, out)
	require.Len(t, parsed, 1, "用户具体分流不被骨架增删")
	assert.Equal(t, "team-a", parsed[0].Receiver)
	require.Len(t, parsed[0].Matchers, 1)
	assert.Equal(t, `severity="critical"`, parsed[0].Matchers[0])

	// 根 route 不得因骨架新增 matchers（红线）。
	root := parseRootRoute(t, out)
	assert.Equal(t, []string{"alertname", "instance"}, root.GroupBy)
}

// TestMaterializeRootRouteReceiverIdempotent 覆盖幂等：连跑两次输出字节一致
// （checksum 可复现）。
func TestMaterializeRootRouteReceiverIdempotent(t *testing.T) {
	in := RootRouteInput{Enabled: true, DefaultReceiver: "notify-3"}

	first, diags, err := MaterializeRootRouteReceiver(sampleAlertmanagerYML, in)
	require.NoError(t, err)
	assert.Empty(t, diags)

	second, diags, err := MaterializeRootRouteReceiver(first, in)
	require.NoError(t, err)
	assert.Empty(t, diags)
	assert.Equal(t, first, second, "第二次物化应字节一致")

	// 已指向目标值时原样返回（不重排、不改样式）。
	third, _, err := MaterializeRootRouteReceiver(first, in)
	require.NoError(t, err)
	assert.Equal(t, first, third)
}

// TestMaterializeRootRouteReceiverSkipsUnknownReceiver 覆盖 dangling 防护：
// 目标不在文件 receivers（也不在本次平台物化名集合）→ 跳过 + 诊断。
func TestMaterializeRootRouteReceiverSkipsUnknownReceiver(t *testing.T) {
	out, diags, err := MaterializeRootRouteReceiver(sampleAlertmanagerYML, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-999",
	})
	require.NoError(t, err, "跳过不得返回 error")
	assert.Equal(t, sampleAlertmanagerYML, out, "跳过时字节级不变")
	require.Len(t, diags, 1)
	assert.Equal(t, RootRouteSkipUnknownReceiver, diags[0].Code)
}

// TestMaterializeRootRouteReceiverAcceptsPlatformMaterializedName 覆盖「文件 receivers ∪
// 本次物化平台名」判据：平台 receiver 已由 MaterializeNotifyReceivers 物化时，即便名字
// 尚未写入文件 receivers 段也可被接受。
func TestMaterializeRootRouteReceiverAcceptsPlatformMaterializedName(t *testing.T) {
	base := "route:\n  receiver: user-default\nreceivers:\n  - name: user-default\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:               true,
		DefaultReceiver:       "notify-3",
		PlatformReceiverNames: []string{"notify-3"},
	})
	require.NoError(t, err)
	assert.Empty(t, diags)
	assert.Contains(t, out, "receiver: notify-3")
}

// TestMaterializeRootRouteReceiverNoRouteSkips 覆盖 PRD §9.2「无 route 时不生成 dangling」：
// 文件无 route 节点 → 跳过 + 诊断，不返回 error。
func TestMaterializeRootRouteReceiverNoRouteSkips(t *testing.T) {
	base := "receivers:\n  - name: notify-3\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Equal(t, base, out)
	require.Len(t, diags, 1)
	assert.Equal(t, RootRouteSkipNoRoute, diags[0].Code)
}

// TestMaterializeRootRouteReceiverInvalidYAMLSkips 覆盖「YAML 非法 → 跳过 + 诊断、不返回 error」。
func TestMaterializeRootRouteReceiverInvalidYAMLSkips(t *testing.T) {
	base := "route: [unclosed\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err, "YAML 非法不得返回 error")
	assert.Equal(t, base, out)
	require.Len(t, diags, 1)
	assert.Equal(t, RootRouteSkipInvalidYAML, diags[0].Code)
}

// TestMaterializeRootRouteReceiverMalformedDocSkips 覆盖顶层非映射 → 跳过 + 诊断。
func TestMaterializeRootRouteReceiverMalformedDocSkips(t *testing.T) {
	base := "- not-a-mapping\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Equal(t, base, out)
	require.Len(t, diags, 1)
	assert.Equal(t, RootRouteSkipMalformedDocument, diags[0].Code)
}

// TestMaterializeRootRouteReceiverRouteNotMappingSkips 覆盖 route 非映射 → 跳过 + 诊断。
func TestMaterializeRootRouteReceiverRouteNotMappingSkips(t *testing.T) {
	base := "route: []\nreceivers:\n  - name: notify-3\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Equal(t, base, out)
	require.Len(t, diags, 1)
	assert.Equal(t, RootRouteSkipRouteNotMapping, diags[0].Code)
}

// TestMaterializeRootRouteReceiverNoRootReceiverSkips 覆盖根 route 无 receiver 键 →
// 跳过 + 诊断（不代为新增键，保持「只替换」最小写入面）。
func TestMaterializeRootRouteReceiverNoRootReceiverSkips(t *testing.T) {
	base := "route:\n  group_by: ['alertname']\nreceivers:\n  - name: notify-3\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Equal(t, base, out)
	require.Len(t, diags, 1)
	assert.Equal(t, RootRouteSkipNoRootReceiver, diags[0].Code)
}

// TestMaterializeRootRouteReceiverAlreadyTargetKeepsRoutes 覆盖「用户 routes[] 优先于骨架
// 回落」：根兜底已指向平台默认接收人时，具体分流与顺序不受影响。
func TestMaterializeRootRouteReceiverAlreadyTargetKeepsRoutes(t *testing.T) {
	base := "route:\n  receiver: notify-3\n  routes:\n    - receiver: team-a\n      matchers:\n        - severity=\"critical\"\nreceivers:\n  - name: notify-3\n  - name: team-a\n"
	out, diags, err := MaterializeRootRouteReceiver(base, RootRouteInput{
		Enabled:         true,
		DefaultReceiver: "notify-3",
	})
	require.NoError(t, err)
	assert.Empty(t, diags)
	assert.Equal(t, base, out, "已指向目标值时原样返回")
	routes := parseRouteTree(t, out)
	require.Len(t, routes, 1)
	assert.Equal(t, "team-a", routes[0].Receiver)
}

// --- 测试辅助 ---

// routeNodeView 是输出 YAML 中 route 节点的解析视图（仅取本测试关心的字段）。
type routeNodeView struct {
	Receiver string          `yaml:"receiver"`
	GroupBy  []string        `yaml:"group_by"`
	Matchers []string        `yaml:"matchers"`
	Routes   []routeNodeView `yaml:"routes"`
}

// parseRootRoute 解析输出 YAML 的根 route 节点视图。
func parseRootRoute(t *testing.T, yml string) routeNodeView {
	t.Helper()
	var doc struct {
		Route routeNodeView `yaml:"route"`
	}
	require.NoError(t, yaml.Unmarshal([]byte(yml), &doc))
	return doc.Route
}

// parseRouteTree 解析输出 YAML 根 route 下的具体分流列表。
func parseRouteTree(t *testing.T, yml string) []routeNodeView {
	t.Helper()
	return parseRootRoute(t, yml).Routes
}