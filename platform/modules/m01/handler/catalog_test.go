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
		"monitor_types":[{"monitor_type":"host_linux","source_exporter":"custom"}],
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
