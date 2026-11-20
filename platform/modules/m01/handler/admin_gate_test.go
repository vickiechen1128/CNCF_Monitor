package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 采集模板与指标库是策略基线：读接口对所有登录用户开放；指标库写接口仅管理员；
// 内置采集模板的写操作仅平台管理员（FR-29），用户自建模板不受限。
// 这些用例锁定 403/200 的边界，避免后续把守卫误删回全局认证。

const metricCreatePayload = `{
	"metric_name":"gate_demo_total","metric_type":"counter",
	"collection_templates":[{"template_code":"host_linux","source_exporter":"gate-exporter"}]
}`

func TestCollectionTemplateWritesRespectBuiltinGuard(t *testing.T) {
	router, gormDB := newTestRouterAs(t, testRegularUser())

	var exporterID string
	require.NoError(t, gormDB.Table("m01_exporter_templates").
		Select("id").Where("name = ?", "node-exporter").Scan(&exporterID).Error)
	require.NotEmpty(t, exporterID)

	// Reads are open to every authenticated user.
	code, _ := doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates", "")
	assert.Equal(t, http.StatusOK, code, "普通用户可以查看采集模板目录")
	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/collection-templates/host_linux/impact", "")
	assert.Equal(t, http.StatusOK, code, "普通用户可以查看影响面")

	// User-owned templates need no administrator.
	createBody := "{\"code\":\"host_gate_demo\",\"name\":\"权限校验主机\",\"resource_category\":\"host\"," +
		"\"exporter_template_id\":\"" + exporterID + "\",\"metrics_path\":\"/metrics\",\"scheme\":\"http\"}"
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/collection-templates", createBody)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["is_builtin"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/collection-templates/host_gate_demo",
		"{\"name\":\"权限校验主机 v2\",\"resource_category\":\"host\","+
			"\"exporter_template_id\":\""+exporterID+"\",\"metrics_path\":\"/metrics\",\"scheme\":\"http\"}")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/collection-templates/host_gate_demo", "")
	require.Equal(t, http.StatusOK, code, out)

	// Built-in templates are platform-administrator only.
	builtinEdit := "{\"name\":\"改名\",\"resource_category\":\"host\"," +
		"\"exporter_template_id\":\"" + exporterID + "\",\"metrics_path\":\"/metrics\",\"scheme\":\"http\"}"
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/collection-templates/host_linux", builtinEdit)
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能编辑内置采集模板")
	assert.Equal(t, "forbidden", out["errorType"])

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/collection-templates/host_linux", "")
	assert.Equal(t, http.StatusForbidden, code, "内置采集模板不能删除")

	// Anonymous contexts fail closed for the built-in writes too.
	anonymous, _ := newTestRouterAs(t, nil)
	code, _ = doJSON(t, anonymous, http.MethodPut, "/api/v3/platform/collection-templates/host_linux", builtinEdit)
	assert.Equal(t, http.StatusForbidden, code)

	// A platform administrator may edit the built-in template.
	adminRouter, adminDB := newTestRouter(t)
	var adminExporterID string
	require.NoError(t, adminDB.Table("m01_exporter_templates").
		Select("id").Where("name = ?", "node-exporter").Scan(&adminExporterID).Error)
	require.NotEmpty(t, adminExporterID)

	adminEdit := "{\"name\":\"改名\",\"resource_category\":\"host\"," +
		"\"exporter_template_id\":\"" + adminExporterID + "\",\"metrics_path\":\"/metrics\",\"scheme\":\"http\"}"
	code, out = doJSON(t, adminRouter, http.MethodPut, "/api/v3/platform/collection-templates/host_linux", adminEdit)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, true, out["data"].(map[string]any)["is_builtin"])
	assert.Equal(t, "改名", out["data"].(map[string]any)["name"])
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

	// 同一指标名 + 相同采集模板锚点重复登记 → 409。
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", metricCreatePayload)
	assert.Equal(t, http.StatusConflict, code, out)

	// 同名但不同锚点允许：多对多锚点下同一指标可服务多个采集模板。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", `{
		"metric_name":"gate_demo_total","metric_type":"counter",
		"collection_templates":[{"template_code":"mysql","source_exporter":"gate-exporter"}]
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
