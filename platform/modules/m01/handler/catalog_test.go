package handler

import (
	"net/http"
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

func TestProbeModuleGuards(t *testing.T) {
	router, gormDB := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/blackbox-modules",
		`{"name":"http_custom","content":"http_custom:\n  prober: http\n"}`)
	require.Equal(t, http.StatusOK, code, out)
	module := out["data"].(map[string]any)
	id := module["id"].(string)
	assert.Equal(t, false, module["is_builtin"])

	// Root key must equal the module name.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/blackbox-modules",
		`{"name":"bad","content":"other:\n  prober: http\n"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Duplicate name conflicts.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/blackbox-modules",
		`{"name":"http_custom","content":"http_custom:\n  prober: http\n"}`)
	assert.Equal(t, http.StatusConflict, code, out)

	// Built-in modules only allow enable/disable.
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_probe_modules(id,name,content,is_builtin)
		VALUES ('probe-http','http_2xx','http_2xx: {}',TRUE)`).Error)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/blackbox-modules/probe-http",
		`{"name":"http_2xx","content":"http_2xx:\n  prober: http\n"}`)
	assert.Equal(t, http.StatusForbidden, code, out)
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/blackbox-modules/probe-http",
		`{"name":"http_2xx","content":"http_2xx: {}","enabled":false}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["enabled"])

	// Referenced modules cannot be deleted.
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs(
		id,job_name,job_type,resource_category,network_domain_id,blackbox_module
	) VALUES ('job-1','probe-job','blackbox','interface_service','mc-demo','http_custom')`).Error)
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/blackbox-modules/"+id, "")
	assert.Equal(t, http.StatusConflict, code, out)
}
