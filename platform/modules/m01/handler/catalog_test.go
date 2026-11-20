package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMetricLibraryCRUD(t *testing.T) {
	router, gormDB := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", `{
		"metric_name":"custom_metric_total","metric_type":"counter","category":"custom",
		"collection_templates":[{"template_code":"host_linux","source_exporter":"custom"}],
		"labels":["path"]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	metric := out["data"].(map[string]any)
	id := metric["id"].(string)
	assert.Equal(t, false, metric["is_builtin"])
	assert.Equal(t, true, metric["enabled"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/metric-library?category=custom", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/metric-library/"+id,
		`{"metric_name":"custom_metric_total","metric_type":"counter","enabled":false,"help":"updated"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["enabled"])

	// Built-in metrics are read-only.
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_metric_library(id,metric_name,metric_type,is_builtin)
		VALUES ('builtin-metric','node_cpu_usage','gauge',TRUE)`).Error)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/metric-library/builtin-metric",
		`{"metric_name":"node_cpu_usage","metric_type":"gauge","enabled":false}`)
	assert.Equal(t, http.StatusForbidden, code, out)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/metric-library/builtin-metric", "")
	assert.Equal(t, http.StatusForbidden, code, out)

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/metric-library/"+id, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/metric-library/"+id, "")
	assert.Equal(t, http.StatusNotFound, code, out)
}

func TestMetricLibraryListFilters(t *testing.T) {
	router, _ := newTestRouter(t)

	for _, payload := range []string{
		`{"metric_name":"node_cpu_usage","metric_type":"gauge","collection_templates":[{"template_code":"host_linux","source_exporter":"node-exporter"}]}`,
		`{"metric_name":"windows_cpu_usage","metric_type":"gauge","collection_templates":[{"template_code":"host_windows","source_exporter":"windows-exporter"}]}`,
		`{"metric_name":"mysql_connections","metric_type":"gauge","collection_templates":[{"template_code":"mysql","source_exporter":"mysqld-exporter"}]}`,
		`{"metric_name":"shared_requests_total","metric_type":"counter","collection_templates":[{"template_code":"host_linux","source_exporter":"node-exporter"},{"template_code":"application_http","source_exporter":"app-exporter"}]}`,
	} {
		code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/metric-library", payload)
		require.Equal(t, http.StatusOK, code, out)
	}

	cases := []struct {
		name  string
		query string
		total int64
	}{
		{"collection template", "?template_code=mysql", 1},
		{"collection template on multi-anchor metric", "?template_code=host_linux", 2},
		{"collection template and metric type", "?template_code=host_linux&metric_type=counter", 1},
		{"unknown collection template", "?template_code=does_not_exist", 0},
		{"metric type only", "?metric_type=gauge", 3},
		{"semantic category without matches", "?category=custom", 0},
		{"keyword", "?keyword=mysql", 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/metric-library"+tc.query, "")
			require.Equal(t, http.StatusOK, code, out)
			assert.EqualValues(t, tc.total, out["data"].(map[string]any)["total"])
		})
	}
}

func TestBusinessMetricLifecycle(t *testing.T) {
	router, _ := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/business-metrics", `{
		"metric_name":"order_count","metric_type":"counter","owner":"sre","business_domain":"payment",
		"description":"订单量"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	metric := out["data"].(map[string]any)
	id := metric["id"].(string)
	assert.Equal(t, "pending", metric["status"])

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/business-metrics", `{
		"metric_name":"order_count","metric_type":"counter","owner":"sre"
	}`)
	assert.Equal(t, http.StatusConflict, code, out)

	// Skipping a state is rejected.
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-metrics/"+id,
		`{"metric_name":"order_count","metric_type":"counter","owner":"sre","status":"online"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/business-metrics/"+id,
		`{"metric_name":"order_count","metric_type":"counter","owner":"sre","status":"instrumented"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "instrumented", out["data"].(map[string]any)["status"])

	// Non-pending metrics cannot be deleted.
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/business-metrics/"+id, "")
	assert.Equal(t, http.StatusForbidden, code, out)
}

func TestProbeModulesReadOnly(t *testing.T) {
	router, gormDB := newTestRouter(t)

	require.NoError(t, gormDB.Exec(`INSERT INTO m01_probe_modules(id,name,content,is_builtin,enabled)
		VALUES ('probe-http','http_2xx','http_2xx: {}',TRUE,TRUE)`).Error)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/blackbox-modules", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	// v2.0 exposes probe modules read-only.
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v3/platform/blackbox-modules", nil))
	assert.Equal(t, http.StatusNotFound, rec.Code)
}
