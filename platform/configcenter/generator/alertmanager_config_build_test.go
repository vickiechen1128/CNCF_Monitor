package generator

import (
	"fmt"
	"strings"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

func chWithID(id uint, name string) models.NotifyChannel {
	return models.NotifyChannel{
		BaseModel: models.BaseModel{ID: id},
		Name:      name,
		Type:      models.NotifyChannelTypeFeishu,
	}
}

// buildTree 构造「根 default + 若干一级子路由」的编辑态路由树。
func buildTree(receivers ...string) []RouteEditNode {
	nodes := []RouteEditNode{{
		ID:       "root",
		Receiver: "default",
		GroupBy:  []string{"alertname"},
	}}
	for i, r := range receivers {
		nodes = append(nodes, RouteEditNode{
			ID:       fmt.Sprintf("root/%d", i),
			ParentID: "root",
			Name:     "分流-" + r,
			Receiver: r,
			Matchers: []RouteEditMatcher{{Name: "severity", Value: "critical", IsEqual: true}},
		})
	}
	return nodes
}

// routeSectionFor 用编辑态路由树生成 route 段（保存链路的输入）。
func routeSectionFor(t *testing.T, tree []RouteEditNode) string {
	t.Helper()
	section, err := GenerateRouteSection(tree)
	require.NoError(t, err)
	return section
}

// setBridgeURL 设置生成器运行时入口地址（测试用，结束后复原）。
func setBridgeURL(t *testing.T, url string) {
	t.Helper()
	old := NotifyBridgeURL
	NotifyBridgeURL = url
	t.Cleanup(func() { NotifyBridgeURL = old })
}

// TestBuildAlertmanagerConfig_RebuildsWholeConfig 整份重建：global 固定、route 来自树、
// receivers 只有 default + 被引用渠道（未配置入口地址时只写 name）。
func TestBuildAlertmanagerConfig_RebuildsWholeConfig(t *testing.T) {
	setBridgeURL(t, "")
	out, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{
		RouteSection: routeSectionFor(t, buildTree("notify-1")),
		Channels:     []models.NotifyChannel{chWithID(1, "SRE"), chWithID(2, "未引用")},
	})
	require.NoError(t, err)

	assert.Contains(t, out, "global:\n  resolve_timeout: 5m")
	assert.Contains(t, out, "receiver: 'default'")
	assert.Contains(t, out, "name: default")
	assert.Contains(t, out, "name: notify-1")
	assert.NotContains(t, out, "name: notify-2", "未被路由引用的渠道不进入 receivers")
	assert.NotContains(t, out, "webhook_configs", "入口地址未配置时只写 name")
	assert.Contains(t, out, "# 路由名称: 分流-notify-1")

	// 产物须是合法 YAML，且顶层只有平台管理的三段。
	var doc map[string]interface{}
	require.NoError(t, yaml.Unmarshal([]byte(out), &doc))
	assert.Len(t, doc, 3)
	assert.Contains(t, doc, "global")
	assert.Contains(t, doc, "route")
	assert.Contains(t, doc, "receivers")
}

// TestBuildAlertmanagerConfig_WithBridgeURL 配置了平台入口地址时直接写完整 webhook 配置。
func TestBuildAlertmanagerConfig_WithBridgeURL(t *testing.T) {
	setBridgeURL(t, "http://127.0.0.1:8080")
	out, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{
		RouteSection: routeSectionFor(t, buildTree("notify-1")),
		Channels:     []models.NotifyChannel{chWithID(1, "SRE")},
	})
	require.NoError(t, err)
	assert.Contains(t, out, "webhook_configs")
	assert.Contains(t, out, "http://127.0.0.1:8080/api/v1/webhooks/notify?id=1")
	assert.Contains(t, out, "send_resolved: true")
	assert.Equal(t, 1, strings.Count(out, "name: notify-1"))
}

// TestBuildAlertmanagerConfig_RejectsInvalidRouteSection 空 / 畸形 route 段显式报错，
// 绝不产出半份配置。
func TestBuildAlertmanagerConfig_RejectsInvalidRouteSection(t *testing.T) {
	for _, section := range []string{"", "   \n", "receivers:\n  - name: x\n", "route: [broken\n"} {
		out, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{RouteSection: section})
		require.Errorf(t, err, "route 段 %q 须报错", section)
		assert.Empty(t, out)
	}
}

// TestExtractRouteSection_OnlyRouteKept 从存量配置提取 route 段：
// global / receivers / inhibit_rules 等一律丢弃，交给唯一生成规则重建。
func TestExtractRouteSection_OnlyRouteKept(t *testing.T) {
	base := `global:
  resolve_timeout: 30s
route:
  receiver: default
  routes:
    - receiver: notify-1
      matchers:
        - severity="critical"
receivers:
  - name: default
    webhook_configs:
      - url: 'https://example.com/default'
  - name: old-deleted-receiver
inhibit_rules:
  - source_matchers: ['severity="critical"']
`
	section, err := ExtractRouteSection(base)
	require.NoError(t, err)
	assert.Contains(t, section, "route:")
	assert.Contains(t, section, "receiver: default")
	assert.NotContains(t, section, "global:")
	assert.NotContains(t, section, "inhibit_rules")
	assert.NotContains(t, section, "old-deleted-receiver")
}

// TestExtractRouteSection_RejectsMissingRoute 无 route / 非法 YAML 显式报错。
func TestExtractRouteSection_RejectsMissingRoute(t *testing.T) {
	for _, base := range []string{"", "   \n", "global:\n  resolve_timeout: 5m\n", "route: [broken\n"} {
		section, err := ExtractRouteSection(base)
		require.Errorf(t, err, "配置 %q 须报错", base)
		assert.Empty(t, section)
	}
}

// TestRebuildFromLegacyConfig_DropsHandwrittenReceivers M09 重算路径的全链路：
// 存量配置（手写 receiver + 非空 default）→ Extract → Build → 只剩平台产物。
func TestRebuildFromLegacyConfig_DropsHandwrittenReceivers(t *testing.T) {
	setBridgeURL(t, "http://127.0.0.1:8080")
	legacy := `global:
  resolve_timeout: 30s
route:
  receiver: notify-7
  routes:
    - receiver: notify-7
      matchers:
        - severity="critical"
receivers:
  - name: default
    webhook_configs:
      - url: 'https://example.com/default'
  - name: notify-7
    webhook_configs:
      - url: 'https://handwritten.example/hook'
  - name: old-deleted-receiver
    webhook_configs:
      - url: 'http://127.0.0.1:9999/old-feishu?fsurl=...'
`
	section, err := ExtractRouteSection(legacy)
	require.NoError(t, err)
	out, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{
		RouteSection: section,
		Channels:     []models.NotifyChannel{chWithID(7, "SRE")},
	})
	require.NoError(t, err)

	assert.Contains(t, out, "global:\n  resolve_timeout: 5m")
	assert.NotContains(t, out, "resolve_timeout: 30s")
	assert.Contains(t, out, "http://127.0.0.1:8080/api/v1/webhooks/notify?id=7")
	assert.NotContains(t, out, "handwritten.example")
	assert.NotContains(t, out, "old-deleted-receiver", "旧手写 receiver 须被丢弃")
	assert.NotContains(t, out, "example.com/default", "旧 default 配置须被丢弃")
	assert.Equal(t, 1, strings.Count(out, "name: default"))
}

// TestBuildAlertmanagerConfig_IdempotentThroughExtract 生成 → 提取 route → 再生成，
// 结果须字节一致：M09 每次重算都从存量产物提取 route，若往返改变格式会造成
// checksum 抖动、反复产生变更单。
func TestBuildAlertmanagerConfig_IdempotentThroughExtract(t *testing.T) {
	setBridgeURL(t, "http://127.0.0.1:8080")
	channels := []models.NotifyChannel{chWithID(1, "SRE")}
	first, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{
		RouteSection: routeSectionFor(t, buildTree("notify-1")),
		Channels:     channels,
	})
	require.NoError(t, err)

	section, err := ExtractRouteSection(first)
	require.NoError(t, err)
	second, err := BuildAlertmanagerConfig(AlertmanagerConfigInput{
		RouteSection: section,
		Channels:     channels,
	})
	require.NoError(t, err)
	assert.Equal(t, first, second)
}
