package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMonitorTypeCRUDViaAPI covers the configurable registry endpoints
// (SRS Module_01 v1.3 §5.6): creating a type needs no code change, and illegal
// rule fields are rejected before anything is stored.
func TestMonitorTypeCRUDViaAPI(t *testing.T) {
	router, _ := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/monitor-types/scope-fields", "")
	require.Equal(t, http.StatusOK, code, out)
	list := out["data"].(map[string]any)["list"].([]any)
	require.NotEmpty(t, list)

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitor-types", `{
		"code":"host_dpu",
		"name":"DPU 主机",
		"resource_category":"host",
		"rules":[{"field":"has_gpu","operator":"eq","values":["true"]}]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	created := out["data"].(map[string]any)
	assert.Equal(t, "host_dpu", created["code"])
	assert.Equal(t, false, created["is_builtin"])
	rules := created["rules"].([]any)
	require.Len(t, rules, 1)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/monitor-types", "")
	require.Equal(t, http.StatusOK, code, out)
	found := false
	for _, item := range out["data"].(map[string]any)["list"].([]any) {
		if item.(map[string]any)["code"] == "host_dpu" {
			found = true
		}
	}
	assert.True(t, found, "newly created type must be listed immediately")

	// An illegal field (SQL fragment instead of a whitelisted key) is refused.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitor-types", `{
		"code":"host_bad",
		"name":"坏类型",
		"resource_category":"host",
		"rules":[{"field":"1=1 OR r.status","operator":"eq","values":["online"]}]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// A type with no rule cannot be created.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitor-types", `{
		"code":"host_empty","name":"空规则","resource_category":"host","rules":[]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Built-in types may not be deleted.
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/monitor-types/host_linux", "")
	assert.Equal(t, http.StatusNotFound, code, out,
		"host_linux is not seeded in this fixture, so a delete is a 404, not a silent success")

	// A user type can be deleted once it is unreferenced.
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/monitor-types/host_dpu", "")
	require.Equal(t, http.StatusOK, code, out)
}
