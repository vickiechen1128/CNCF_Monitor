package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func normalizeResourcePayload(t *testing.T, data map[string]any) map[string]any {
	t.Helper()
	out := make(map[string]any, len(data))
	for key, value := range data {
		out[key] = value
	}
	out["resource_id"] = "<resource_id>"
	out["created_at"] = "<time>"
	out["updated_at"] = "<time>"
	return out
}

func TestV3GoldenResource(t *testing.T) {
	router, _ := newTestRouter(t)
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/resources", `{
		"resource_category":"host",
		"network_domain_id":"default",
		"env":"PRD",
		"attributes":{"hostname":"web-01","instance_ip":"10.0.0.1","os_type":"linux"}
	}`)
	require.Equal(t, http.StatusOK, code, out)
	data := normalizeResourcePayload(t, out["data"].(map[string]any))

	expected := map[string]any{
		"resource_id":       "<resource_id>",
		"resource_category": "host",
		"tenant_id":         "platform_admin",
		"network_domain_id": "default",
		"env":               "PRD",
		"status":            "online",
		"source_type":       "manual",
		"scrape_port":       float64(0),
		"dedup_key":         "host|default|10.0.0.1",
		"attributes": map[string]any{
			"hostname":    "web-01",
			"instance_ip": "10.0.0.1",
			"os_type":     "linux",
		},
		"created_at": "<time>",
		"updated_at": "<time>",
	}
	assert.Equal(t, expected, data)
}

func TestV3GoldenList(t *testing.T) {
	router, _ := newTestRouter(t)
	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/resources?resource_category=host", "")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, float64(1), data["page"])
	assert.Equal(t, float64(20), data["page_size"])
	assert.Equal(t, float64(0), data["total"])
	assert.Equal(t, []any{}, data["list"])
}

func TestV3GoldenError(t *testing.T) {
	router, _ := newTestRouter(t)
	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/resources", "")
	require.Equal(t, http.StatusBadRequest, code, out)
	assert.Equal(t, "error", out["status"])
	assert.Equal(t, "bad_request", out["errorType"])

	raw, err := json.Marshal(out)
	require.NoError(t, err)
	assert.Contains(t, string(raw), "resource_category")
}
