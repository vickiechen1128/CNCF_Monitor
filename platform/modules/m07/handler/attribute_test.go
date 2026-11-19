package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAttributeDefinitionAndResourceValues covers the generic capability
// attribute endpoints (SRS Module_07 v2.1 §5.8 FR-31): registering a key needs
// no schema change, and values are constrained by the dictionary.
func TestAttributeDefinitionAndResourceValues(t *testing.T) {
	router, gormDB := newTestRouter(t)

	require.NoError(t, gormDB.Exec(`INSERT INTO resources(
		resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key
	) VALUES ('host-attr','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.9.9.9')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources(
		resource_id,hostname,instance_ip,os_type,has_npu,has_gpu
	) VALUES ('host-attr','attr-01','10.9.9.9','Ubuntu',1,0)`).Error)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/attribute-definitions", `{
		"attribute_key":"dpu_model",
		"display_name":"DPU 型号",
		"value_type":"text",
		"resource_category":"host"
	}`)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/attribute-definitions?resource_category=host", "")
	require.Equal(t, http.StatusOK, code, out)
	list := out["data"].(map[string]any)["list"].([]any)
	require.NotEmpty(t, list)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/resources/host-attr/attributes", `{
		"attributes":[{"key":"dpu_model","value":"BlueField-3"}]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	stored := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, stored, 1)
	assert.Equal(t, "BlueField-3", stored[0].(map[string]any)["value"])

	// Unregistered keys are rejected: the attribute space stays controlled.
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/resources/host-attr/attributes", `{
		"attributes":[{"key":"unknown","value":"x"}]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources/host-attr/attributes", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Len(t, out["data"].(map[string]any)["list"].([]any), 1)
}
