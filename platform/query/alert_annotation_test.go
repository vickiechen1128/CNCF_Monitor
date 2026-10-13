package query

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestRenderAnnotationLabels 覆盖本次缺陷的核心语义：$labels 按本次渲染的标签取值，
// 且缺失键渲染为空串（与 Prometheus 一致），**绝不是模板原文**。
func TestRenderAnnotationLabels(t *testing.T) {
	labels := map[string]string{"instance": "10.10.1.4", "job": "bx-nginx-02", "severity": "critical"}

	cases := []struct {
		name string
		tmpl string
		want string
	}{
		{"点号取值", "业务拨测失败：{{ $labels.instance }}", "业务拨测失败：10.10.1.4"},
		{"index 取值", "目标 {{ index $labels \"job\" }}", "目标 bx-nginx-02"},
		{"多标签混排", "{{ $labels.job }} / {{ $labels.severity }}", "bx-nginx-02 / critical"},
		{"缺失键渲染为空", "实例[{{ $labels.no_such }}]结束", "实例[]结束"},
		{"纯静态文本原样返回", "CPU 使用率过高", "CPU 使用率过高"},
		{"value 取样本值", "当前值 {{ $value }}", "当前值 1"},
		{"字符串函数", "{{ $labels.job | toUpper }}", "BX-NGINX-02"},
		{"humanize 函数", "{{ humanize 1500 }}", "1.5k"},
		{"humanizeDuration 函数", "{{ humanizeDuration 5400 }}", "1h 30m"},
		{"humanizePercentage 函数", "{{ humanizePercentage 0.9234 }}", "92.34%"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := RenderAnnotation(tc.tmpl, labels, "1")
			require.NoError(t, err)
			assert.Equal(t, tc.want, got)
		})
	}
}

// TestRenderAnnotationNoLeakOnMissingLabel 防回归：标签缺失时输出里绝不能出现 "{{"。
func TestRenderAnnotationNoLeakOnMissingLabel(t *testing.T) {
	got, err := RenderAnnotation("失败：{{ $labels.instance }}", map[string]string{}, "1")
	require.NoError(t, err)
	assert.Equal(t, "失败：", got)
	assert.NotContains(t, got, "{{")
}

// TestRenderAnnotationFailure 覆盖渲染失败路径：解析错误 / 不支持的函数都返回 error，
// 由调用方降级为空摘要（renderHistorySummary 的语义）。
func TestRenderAnnotationFailure(t *testing.T) {
	labels := map[string]string{"instance": "10.0.0.1"}

	_, err := RenderAnnotation("坏语法 {{ $labels.instance", labels, "1")
	assert.Error(t, err, "模板语法非法应报错")

	_, err = RenderAnnotation("不支持的函数 {{ noSuchFunc 1 }}", labels, "1")
	assert.Error(t, err, "未知函数应报错")

	_, err = RenderAnnotation("子字段不存在 {{ $labels.instance.deeper }}", labels, "1")
	assert.Error(t, err, "对字符串取子字段应报错")
}

// TestRenderAnnotationEmptyTemplate 空模板返回空串且无错误（规则没写 summary 的常见情形）。
func TestRenderAnnotationEmptyTemplate(t *testing.T) {
	got, err := RenderAnnotation("   ", map[string]string{"a": "b"}, "1")
	require.NoError(t, err)
	assert.Equal(t, "", got)
}

// TestRenderHistorySummaryDegradesToEmpty 锁定降级语义：渲染失败必须返回空串，
// 不得回退模板原文（回退即缺陷复发）。
func TestRenderHistorySummaryDegradesToEmpty(t *testing.T) {
	labels := map[string]string{"instance": "10.0.0.1", "alertname": "X"}
	domain := "default"

	assert.Equal(t, "实例 10.0.0.1", renderHistorySummary("实例 {{ $labels.instance }}", labels, domain))
	assert.Equal(t, "", renderHistorySummary("坏语法 {{ $labels.instance", labels, domain))
	assert.Equal(t, "", renderHistorySummary("", labels, domain))
}

// TestRenderHistorySummaryInjectsNetworkDomain 覆盖网域补键：中心 ALERTS 序列不含
// external_labels，故渲染时补平台归一的 network_domain，避免模板里该变量恒空。
func TestRenderHistorySummaryInjectsNetworkDomain(t *testing.T) {
	labels := map[string]string{"instance": "10.0.0.1"}
	assert.Equal(t, "default", renderHistorySummary("{{ $labels.network_domain }}", labels, "default"))

	// 序列已自带同键时不覆盖。
	withKey := map[string]string{"instance": "10.0.0.1", "network_domain": "dmz"}
	assert.Equal(t, "dmz", renderHistorySummary("{{ $labels.network_domain }}", withKey, "default"))
}