package route

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestParseRouteTree_MatchersBothForms 覆盖 matchers 双形态归一：新式映射
// `[{name,value,isRegex}]` 与字符串简写 `severity="critical"`，含取反/正则操作符。
func TestParseRouteTree_MatchersBothForms(t *testing.T) {
	yaml := `
route:
  receiver: root
  matchers:
    - severity="critical"
    - name: team
      value: sre
      isRegex: true
    - severity!="info"
  routes:
    - receiver: child
      matchers:
        - name: instance
          value: "10.0.0.1:9100"
`
	nodes, err := ParseRouteTree(yaml)
	require.NoError(t, err)
	require.Len(t, nodes, 2)

	root := nodes[0]
	require.Len(t, root.Matchers, 3)
	assert.Equal(t, RouteMatcher{Name: "severity", Value: "critical", IsEqual: true, IsRegex: false}, root.Matchers[0], "字符串简写 = 归一")
	assert.Equal(t, RouteMatcher{Name: "team", Value: "sre", IsEqual: true, IsRegex: true}, root.Matchers[1], "新式映射 isRegex")
	assert.Equal(t, RouteMatcher{Name: "severity", Value: "info", IsEqual: false, IsRegex: false}, root.Matchers[2], "字符串简写 != 归一（取反）")

	child := nodes[1]
	require.Len(t, child.Matchers, 1)
	assert.Equal(t, RouteMatcher{Name: "instance", Value: "10.0.0.1:9100", IsEqual: true, IsRegex: false}, child.Matchers[0])
}

// TestParseRouteTree_RegexShorthand：`=~` 简写归一为 is_regex=true。
func TestParseRouteTree_RegexShorthand(t *testing.T) {
	nodes, err := ParseRouteTree("route:\n  receiver: r\n  matchers:\n    - alertname=~\"HostDown|CPU\"\n")
	require.NoError(t, err)
	require.Len(t, nodes[0].Matchers, 1)
	assert.Equal(t, RouteMatcher{Name: "alertname", Value: "HostDown|CPU", IsEqual: true, IsRegex: true}, nodes[0].Matchers[0])
}

// TestParseRouteTree_HierarchyOrderAndRootLocked 覆盖层级（嵌套位置 → parent_id）、
// 数组位置（order）、稳定 ID 与前序扁平顺序，以及根路由置顶 + locked。
func TestParseRouteTree_HierarchyOrderAndRootLocked(t *testing.T) {
	yaml := `
route:
  receiver: root-recv
  routes:
    - receiver: a
      routes:
        - receiver: a1
        - receiver: a2
    - receiver: b
`
	nodes, err := ParseRouteTree(yaml)
	require.NoError(t, err)
	require.Len(t, nodes, 5)

	// 前序扁平：根置顶，父先于子。
	got := make([]string, 0, len(nodes))
	for _, n := range nodes {
		got = append(got, n.ID)
	}
	assert.Equal(t, []string{"root", "root/0", "root/0/0", "root/0/1", "root/1"}, got)

	assert.True(t, nodes[0].Locked, "根路由 locked=true")
	assert.Equal(t, "", nodes[0].ParentID)
	assert.Equal(t, 0, nodes[0].Order)

	assert.False(t, nodes[1].Locked, "非根路由不锁定")
	assert.Equal(t, "root", nodes[1].ParentID)
	assert.Equal(t, 0, nodes[1].Order)
	assert.Equal(t, "a", nodes[1].Receiver)

	assert.Equal(t, "root/0", nodes[2].ParentID)
	assert.Equal(t, 0, nodes[2].Order)
	assert.Equal(t, "a1", nodes[2].Receiver)

	assert.Equal(t, "root/0", nodes[3].ParentID)
	assert.Equal(t, 1, nodes[3].Order, "同级数组位置 → order")
	assert.Equal(t, "a2", nodes[3].Receiver)

	assert.Equal(t, "root", nodes[4].ParentID)
	assert.Equal(t, 1, nodes[4].Order)
	assert.Equal(t, "b", nodes[4].Receiver)
}

// TestParseRouteTree_NameFromComment 覆盖 name 从 `# 路由名称: xxx` 注释还原（节点上方 / 首个键上方）。
func TestParseRouteTree_NameFromComment(t *testing.T) {
	yaml := `
route:
  # 路由名称: 根兜底
  receiver: root-recv
  routes:
    # 路由名称: 主机宕机专用
    - receiver: a
    - receiver: b
`
	nodes, err := ParseRouteTree(yaml)
	require.NoError(t, err)
	require.Len(t, nodes, 3)
	assert.Equal(t, "根兜底", nodes[0].Name)
	assert.Equal(t, "主机宕机专用", nodes[1].Name)
	assert.Equal(t, "", nodes[2].Name, "无注释回落空串，不造值")
}

// TestParseRouteTree_GroupByDurationsContinue 覆盖 group_by / 三个时间字段 / continue。
func TestParseRouteTree_GroupByDurationsContinue(t *testing.T) {
	yaml := `
route:
  receiver: r
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  continue: false
  routes:
    - receiver: c
      continue: true
`
	nodes, err := ParseRouteTree(yaml)
	require.NoError(t, err)
	root := nodes[0]
	assert.Equal(t, []string{"alertname", "severity"}, root.GroupBy)
	assert.Equal(t, "30s", root.GroupWait)
	assert.Equal(t, "5m", root.GroupInterval)
	assert.Equal(t, "4h", root.RepeatInterval)
	assert.False(t, root.Continue)
	assert.True(t, nodes[1].Continue)
	assert.Empty(t, nodes[1].GroupBy, "缺省 group_by 回落空切片，非 null")
}

// TestParseRouteTree_EmptyContent：空配置返回空序列（前端空态），不报错。
func TestParseRouteTree_EmptyContent(t *testing.T) {
	for _, in := range []string{"", "   \n"} {
		nodes, err := ParseRouteTree(in)
		require.NoError(t, err)
		assert.Empty(t, nodes)
	}
}

// TestParseRouteTree_Errors 覆盖解析失败 / 非常规结构 → error（handler 据此降级）。
func TestParseRouteTree_Errors(t *testing.T) {
	cases := map[string]string{
		"yaml 非法":       "route: [unclosed",
		"顶层非映射":         "- a\n- b\n",
		"缺少 route 段":    "global:\n  resolve_timeout: 5m\n",
		"route 非映射":     "route: notamapping\n",
		"routes 非列表":    "route:\n  receiver: a\n  routes: notalist\n",
		"子路由非映射":        "route:\n  routes:\n    - notamapping\n",
		"group_by 元素非标量": "route:\n  group_by:\n    - {a: 1}\n",
		"matchers 元素非常规": "route:\n  matchers:\n    - [a, b]\n",
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := ParseRouteTree(in)
			assert.Error(t, err)
		})
	}
}