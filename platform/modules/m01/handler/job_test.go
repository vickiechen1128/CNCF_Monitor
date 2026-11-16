package handler

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJobCRUDCandidatesPreview(t *testing.T) {
	router, gormDB := newTestRouter(t)

	for _, stmt := range []string{
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-host-1','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.0.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-host-1','web-01','10.0.0.1','linux')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	code, out := doJSON(t, router, http.MethodGet,
		"/api/v3/platform/scrape-jobs/instance-candidates?monitor_type=host_linux&network_domain_id=mc-demo", "")
	require.Equal(t, http.StatusOK, code, out)
	candidates := out["data"].(map[string]any)
	assert.EqualValues(t, 1, candidates["total"])
	candidate := candidates["list"].([]any)[0].(map[string]any)
	assert.Equal(t, "res-host-1", candidate["resource_id"])
	assert.Equal(t, true, candidate["selectable"])
	assert.Equal(t, "10.0.0.1:9100", candidate["target_address"])

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"host-prod",
		"job_type":"standard",
		"resource_category":"host",
		"monitor_type":"host_linux",
		"network_domain_id":"mc-demo",
		"selected_instance_ids":["res-host-1"]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	job := out["data"].(map[string]any)
	jobID := job["id"].(string)
	assert.Equal(t, "pending", job["sync"].(map[string]any)["status"])
	assert.EqualValues(t, 1, job["selected_instance_count"])
	assert.Equal(t, "15s", job["scrape_interval"])
	assert.Equal(t, "10s", job["scrape_timeout"])
	assert.Equal(t, "/metrics", job["metrics_path"])
	assert.Equal(t, "http", job["scheme"])
	assert.Equal(t, "", job["target_field"])
	assert.Empty(t, job["mapping_overrides"].([]any))
	assert.Equal(t, "mc-demo", job["network_domain_id"])
	assert.Equal(t, "演示采集域", job["network_domain_name"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs/"+jobID+"/instances", "")
	require.Equal(t, http.StatusOK, code, out)
	instances := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, instances, 1)
	assert.Equal(t, "10.0.0.1:9100", instances[0].(map[string]any)["target_address"])
	assert.Nil(t, instances[0].(map[string]any)["installation"])

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs/"+jobID+"/instances/res-host-1/confirm",
		`{"actual_port":9100,"confirmed_by":"ops","notes":"installed"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "confirmed", out["data"].(map[string]any)["installation"].(map[string]any)["status"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs/"+jobID+"/instances", "")
	require.Equal(t, http.StatusOK, code, out)
	instances = out["data"].(map[string]any)["list"].([]any)
	require.NotNil(t, instances[0].(map[string]any)["installation"])

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs/"+jobID+"/preview-targets", "")
	require.Equal(t, http.StatusOK, code, out)
	preview := out["data"].(map[string]any)
	assert.Equal(t, "host-prod", preview["job_name"])
	targets := preview["targets"].([]any)
	require.Len(t, targets, 1)
	assert.Equal(t, []any{"10.0.0.1:9100"}, targets[0].(map[string]any)["targets"])
	assert.Empty(t, preview["skipped"].([]any))

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/scrape-jobs/"+jobID, `{
		"job_name":"host-prod-2",
		"resource_category":"host",
		"monitor_type":"host_linux",
		"network_domain_id":"mc-demo",
		"selected_instance_ids":["res-host-1"],
		"scrape_interval":"30s",
		"enabled":false
	}`)
	require.Equal(t, http.StatusOK, code, out)
	updated := out["data"].(map[string]any)
	assert.Equal(t, "host-prod-2", updated["job_name"])
	assert.Equal(t, "30s", updated["scrape_interval"])
	assert.Equal(t, false, updated["enabled"])
	assert.Equal(t, "draft", updated["sync"].(map[string]any)["status"])

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/scrape-jobs/"+jobID, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs/"+jobID, "")
	assert.Equal(t, http.StatusNotFound, code, out)
}

func TestJobValidatesOfflineAndDomain(t *testing.T) {
	router, gormDB := newTestRouter(t)

	for _, stmt := range []string{
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-off','host','platform_admin','mc-demo','PRD','offline','manual',0,'host|mc-demo|10.0.0.9')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-off','web-off','10.0.0.9','linux')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status)
			VALUES ('dom-no-access','未纳管域','edge','platform_admin','agent_pull','enabled')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	code, out := doJSON(t, router, http.MethodGet,
		"/api/v3/platform/scrape-jobs/instance-candidates?monitor_type=host_linux&network_domain_id=mc-demo", "")
	require.Equal(t, http.StatusOK, code, out)
	candidate := out["data"].(map[string]any)["list"].([]any)[0].(map[string]any)
	assert.Equal(t, false, candidate["selectable"])
	assert.Equal(t, "实例已离线", candidate["disabled_reason"])

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"offline-job",
		"monitor_type":"host_linux",
		"network_domain_id":"mc-demo",
		"selected_instance_ids":["res-off"]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"unmonitored-job",
		"monitor_type":"host_linux",
		"network_domain_id":"dom-no-access",
		"selected_instance_ids":[]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
}

func TestBlackboxJobDerivesTargetField(t *testing.T) {
	router, gormDB := newTestRouter(t)

	for _, stmt := range []string{
		`INSERT INTO m01_probe_modules(id,name,content,enabled)
			VALUES ('probe-http','http_2xx','http_2xx: {}',TRUE)`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('svc-1','interface_service','platform_admin','mc-demo','PRD','online','manual',0,'interface_service|mc-demo|api-1')`,
		`INSERT INTO interface_service_resources(resource_id,api_name,api_url)
			VALUES ('svc-1','order-api','http://10.0.0.20:8080/health')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"api-probe",
		"job_type":"blackbox",
		"resource_category":"interface_service",
		"network_domain_id":"mc-demo",
		"blackbox_module":"http_2xx",
		"selected_instance_ids":["svc-1"]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	job := out["data"].(map[string]any)
	assert.Equal(t, "blackbox", job["job_type"])
	assert.Equal(t, "api_url", job["target_field"])
	assert.Equal(t, "", job["monitor_type"])

	jobID := job["id"].(string)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs/"+jobID+"/preview-targets", "")
	require.Equal(t, http.StatusOK, code, out)
	targets := out["data"].(map[string]any)["targets"].([]any)
	require.Len(t, targets, 1)
	assert.Equal(t, []any{"http://10.0.0.20:8080/health"}, targets[0].(map[string]any)["targets"])

	// Contract-deleted field must be rejected by strict JSON.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"api-probe-2",
		"job_type":"blackbox",
		"resource_category":"interface_service",
		"network_domain_id":"mc-demo",
		"blackbox_module":"http_2xx",
		"selected_instance_ids":["svc-1"],
		"blackbox_targets":[{"target":"http://x"}]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Blackbox jobs only accept probe categories.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"bad-probe",
		"job_type":"blackbox",
		"resource_category":"host",
		"network_domain_id":"mc-demo",
		"blackbox_module":"http_2xx",
		"selected_instance_ids":["svc-1"]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
}

func TestJobRejectsInvalidPayloads(t *testing.T) {
	router, _ := newTestRouter(t)

	// Unknown field → 400 (strict JSON).
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs",
		`{"job_name":"x","blackbox_targets":[{"target":"a"}]}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Invalid job name.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs",
		`{"job_name":"bad name","monitor_type":"host_linux","network_domain_id":"mc-demo"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// category/monitor_type mismatch.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs",
		`{"job_name":"mismatch","resource_category":"database","monitor_type":"host_linux","network_domain_id":"mc-demo"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Missing monitor_type for a standard job.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs",
		`{"job_name":"no-type","network_domain_id":"mc-demo"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
}

func TestJobListFilters(t *testing.T) {
	router, gormDB := newTestRouter(t)
	require.NoError(t, gormDB.Exec(`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
		VALUES ('res-1','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.0.0.1')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
		VALUES ('res-1','web-01','10.0.0.1','linux')`).Error)
	body := fmt.Sprintf(`{"job_name":"list-job","monitor_type":"host_linux","network_domain_id":"mc-demo","selected_instance_ids":["res-1"]}`)
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs?network_domain_id=mc-demo&job_type=standard", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])
	assert.EqualValues(t, 20, out["data"].(map[string]any)["page_size"])
}
