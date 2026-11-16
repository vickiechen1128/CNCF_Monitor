package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLabelTemplateCRUD(t *testing.T) {
	router, _ := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/label-templates", `{
		"name":"host-default",
		"resource_category":"host",
		"is_default":true,
		"mappings":[
			{"source_field":"instance_ip:port","source_type":"composite","target_label":"instance","enabled":true},
			{"source_field":"resource_id","source_type":"resource_field","target_label":"resource_id","enabled":true}
		]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	id := data["id"].(string)
	assert.Equal(t, "host", data["resource_category"])
	assert.Equal(t, true, data["is_default"])
	assert.Len(t, data["mappings"].([]any), 2)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/label-templates?resource_category=host", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])

	// Duplicate name in the same category conflicts.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/label-templates",
		`{"name":"host-default","resource_category":"host"}`)
	assert.Equal(t, http.StatusConflict, code, out)

	// Invalid mapping target label is rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/label-templates",
		`{"name":"bad","resource_category":"host","mappings":[{"source_field":"x","source_type":"resource_field","target_label":"bad-label","enabled":true}]}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// A second default in the same category demotes the first.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/label-templates",
		`{"name":"host-default-2","resource_category":"host","is_default":true}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/label-templates?resource_category=host&is_default=true", "")
	require.Equal(t, http.StatusOK, code, out)
	defaults := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, defaults, 1)
	assert.Equal(t, "host-default-2", defaults[0].(map[string]any)["name"])

	// Category is immutable on update.
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/label-templates/"+id, `{
		"name":"host-default","resource_category":"database"
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/label-templates/"+id, `{
		"name":"host-default-renamed","mappings":[]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "host-default-renamed", out["data"].(map[string]any)["name"])

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/label-templates/"+id, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/label-templates/"+id, "")
	assert.Equal(t, http.StatusNotFound, code, out)
}
