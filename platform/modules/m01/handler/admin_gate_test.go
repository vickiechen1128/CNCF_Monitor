package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 监控对象类型与指标库是策略基线：读接口对所有登录用户开放，写接口仅管理员
// （决策：2026-11-19 用户裁定）。这两组用例锁定 403/200 的边界，避免后续把
// RequireAdmin 误删回全局认证。

const monitorTypeCreatePayload = `{
	"code":"host_gate_demo","name":"权限校验主机","resource_category":"host",
	"rule_logic":"all","enabled":true,
	"rules":[{"field":"os_family","operator":"eq","values":["linux"]}]
}`

const metricCreatePayload = `{
	"metric_name":"gate_demo_total","metric_type":"counter",
	"monitor_types":[{"monitor_type":"host_linux","source_exporter":"gate-exporter"}]
}`

func TestMonitorTypeWritesRequireAdmin(t *testing.T) {
	router, _ := newTestRouterAs(t, testRegularUser())

	code, _ := doJSON(t, router, http.MethodPost, "/api/v3/platform/monitor-types", monitorTypeCreatePayload)
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能新增监控对象类型")

	code, _ = doJSON(t, router, http.MethodPut, "/api/v3/platform/monitor-types/host_linux",
		`{"name":"改名","resource_category":"host","rule_logic":"all","rules":[{"field":"os_family","operator":"eq","values":["linux"]}]}`)
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能编辑监控对象类型")

	code, _ = doJSON(t, router, http.MethodDelete, "/api/v3/platform/monitor-types/host_linux", "")
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能删除监控对象类型")

	// 读接口不受影响：非管理员仍可查看类型目录与影响面。
	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/monitor-types", "")
	assert.Equal(t, http.StatusOK, code)

	adminRouter, _ := newTestRouter(t)
	code, out := doJSON(t, adminRouter, http.MethodPost, "/api/v3/platform/monitor-types", monitorTypeCreatePayload)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "host_gate_demo", out["data"].(map[string]any)["code"])
}

func TestMetricLibraryWritesRequireAdmin(t *testing.T) {
	router, _ := newTestRouterAs(t, testRegularUser())

	code, _ := doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能新增指标")

	code, _ = doJSON(t, router, http.MethodPut, "/api/v3/platform/metric-library/any-id",
		`{"metric_name":"gate_demo_total","metric_type":"counter"}`)
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能编辑指标")

	code, _ = doJSON(t, router, http.MethodDelete, "/api/v3/platform/metric-library/any-id", "")
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能删除指标")

	// 读接口不受影响。
	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/metric-library", "")
	assert.Equal(t, http.StatusOK, code)

	// 未认证上下文同样拒绝（生产环境由 AuthMiddleware 兜底 401，这里锁定 403）。
	anonymous, _ := newTestRouterAs(t, nil)
	code, _ = doJSON(t, anonymous, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	assert.Equal(t, http.StatusForbidden, code)

	adminRouter, _ := newTestRouter(t)
	code, out := doJSON(t, adminRouter, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["is_builtin"])
}

func TestMetricLibraryUserEntryValidation(t *testing.T) {
	router, _ := newTestRouter(t)

	// 同一指标名 + 相同监控对象类型锚点重复登记 → 409。
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	assert.Equal(t, http.StatusConflict, code, out)

	// 同名但不同锚点允许：多对多锚点下同一指标可服务多个监控对象类型。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", `{
		"metric_name":"gate_demo_total","metric_type":"counter",
		"monitor_types":[{"monitor_type":"mysql","source_exporter":"gate-exporter"}]
	}`)
	require.Equal(t, http.StatusOK, code, out)

	// Prometheus 命名规则：不能以数字开头、不能含连字符。
	for _, name := range []string{"1gate_total", "gate-demo_total", "gate demo"} {
		code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library",
			`{"metric_name":"`+name+`","metric_type":"counter"}`)
		assert.Equal(t, http.StatusBadRequest, code, out, name)
	}

	// 标签键同样按 Prometheus 规则校验。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", `{
		"metric_name":"gate_labels_total","metric_type":"counter","labels":["bad-label"]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
}
