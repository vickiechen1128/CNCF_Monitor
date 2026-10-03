package route

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/generator"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestToEditNodes_FromParse 覆盖 H1：解析态 → 编辑态，字段逐字段镜像，未建模键 Raw 透传，
// 导入场景全部节点 Enabled=*true（取代旧测试内 toEditNodes 的语义）。
func TestToEditNodes_FromParse(t *testing.T) {
	nodes, err := ParseRouteTree(healthyRouteYAML)
	require.NoError(t, err)
	require.NotEmpty(t, nodes)

	edit := ToEditNodes(nodes)
	require.Len(t, edit, len(nodes))
	for i := range edit {
		assert.Equal(t, nodes[i].ID, edit[i].ID)
		assert.Equal(t, nodes[i].Receiver, edit[i].Receiver)
		assert.Equal(t, toEditMatchers(nodes[i].Matchers), edit[i].Matchers)
		assert.Equal(t, nodes[i].Raw, edit[i].Raw, "未建模键 Raw 须透传")
		require.NotNil(t, edit[i].Enabled, "导入节点 Enabled 必须显式 *true")
		assert.True(t, *edit[i].Enabled, "导入节点默认启用，避免整树被剔除")
	}
}

// TestToRouteNodes_RoundTrip 覆盖 H1：编辑态 → 解析态 → 编辑态 往返稳定，且 *bool Enabled
// 在回解析态时正确丢弃（解析态不表达启用态）。
func TestToRouteNodes_RoundTrip(t *testing.T) {
	nodes, err := ParseRouteTree(healthyRouteYAML)
	require.NoError(t, err)

	edit := ToEditNodes(nodes)
	back := ToRouteNodes(edit)

	// 解析态字段应与原树等价（忽略 Raw 之外的启用态差异）。
	require.Len(t, back, len(nodes))
	for i := range back {
		assert.Equal(t, nodes[i].ID, back[i].ID)
		assert.Equal(t, nodes[i].Receiver, back[i].Receiver)
		assert.Equal(t, nodes[i].Matchers, back[i].Matchers)
		assert.Equal(t, nodes[i].Raw, back[i].Raw)
	}
}

// TestToEditNodes_PreservesUnmodeledKeys 覆盖 H1+B1 协同：带未建模键的解析态转编辑态后，
// 生成器仍能原样回写（验证转换器未吞掉 Raw）。
func TestToEditNodes_PreservesUnmodeledKeys(t *testing.T) {
	src := `route:
    receiver: default
    mute_time_intervals:
        - 夜间
    routes:
        - receiver: a
          match:
            severity: critical
`
	nodes, err := ParseRouteTree(src)
	require.NoError(t, err)
	require.NotEmpty(t, nodes[0].Raw)

	gen, err := generator.GenerateRouteSection(ToEditNodes(nodes))
	require.NoError(t, err)
	assert.Contains(t, gen, "mute_time_intervals:")
	assert.Contains(t, gen, "match:")
}

// toEditMatchers 把解析态 matcher 序列映射为编辑态 matcher 序列（仅供断言对照）。
func toEditMatchers(in []RouteMatcher) []generator.RouteEditMatcher {
	out := make([]generator.RouteEditMatcher, 0, len(in))
	for _, m := range in {
		out = append(out, generator.RouteEditMatcher{
			Name: m.Name, Value: m.Value, IsEqual: m.IsEqual, IsRegex: m.IsRegex,
		})
	}
	return out
}
