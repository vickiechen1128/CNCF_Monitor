package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

const customFieldCreatePayload = `{
	"attribute_key":"rack_position",
	"display_name":"机柜位置",
	"value_type":"text",
	"resource_category":"host",
	"display_group":"profile"
}`

// TestCustomFieldDefinitionWritesRequireAdmin locks the authorization boundary
// of the CI model administration (SRS Module_07 v2.4 §4.1 角色表 + §5.8 FR-32):
// reading the model stays open to every authenticated user, custom field
// definition writes are platform-administrator only, and editing a resource's
// custom field VALUES remains a normal resource write.
func TestCustomFieldDefinitionWritesRequireAdmin(t *testing.T) {
	viewer, viewerDB := newTestRouterAs(t, testRegularUser())

	// Reads feed the resource form and the M01 field dictionary: every logged-in
	// user needs them.
	for _, path := range []string{
		"/api/v3/platform/ci-models",
		"/api/v3/platform/ci-models/host",
		"/api/v3/platform/attribute-definitions",
	} {
		code, out := doJSON(t, viewer, http.MethodGet, path, "")
		assert.Equal(t, http.StatusOK, code, "%s: %v", path, out)
	}

	// Definition writes are administrator-only.
	code, out := doJSON(t, viewer, http.MethodPost, "/api/v3/platform/attribute-definitions", customFieldCreatePayload)
	assert.Equal(t, http.StatusForbidden, code, out)
	assert.Equal(t, "forbidden", out["errorType"])

	code, _ = doJSON(t, viewer, http.MethodPut, "/api/v3/platform/attribute-definitions/def-1",
		`{"attribute_key":"rack_position","display_name":"改名","value_type":"text","resource_category":"host"}`)
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能编辑自定义字段定义")

	code, _ = doJSON(t, viewer, http.MethodDelete, "/api/v3/platform/attribute-definitions/def-1", "")
	assert.Equal(t, http.StatusForbidden, code, "普通用户不能移除自定义字段定义")

	// Filling a registered custom field is a resource edit, not CI model
	// administration: a non-admin keeps the ability to maintain resource facts.
	seedCustomFieldValueTarget(t, viewerDB)
	code, out = doJSON(t, viewer, http.MethodPut, "/api/v3/platform/resources/host-admin-gate/attributes",
		`{"attributes":[{"key":"rack_position","value":"B-12"}]}`)
	require.Equal(t, http.StatusOK, code, out)

	// Anonymous context (production AuthMiddleware answers 401 first) still
	// fails closed at the admin gate.
	anonymous, _ := newTestRouterAs(t, nil)
	code, _ = doJSON(t, anonymous, http.MethodPost, "/api/v3/platform/attribute-definitions", customFieldCreatePayload)
	assert.Equal(t, http.StatusForbidden, code)

	// The platform administrator manages the custom field dictionary end to end.
	adminRouter, _ := newTestRouter(t)
	code, out = doJSON(t, adminRouter, http.MethodPost, "/api/v3/platform/attribute-definitions", customFieldCreatePayload)
	require.Equal(t, http.StatusOK, code, out)
	defID := out["data"].(map[string]any)["id"].(string)

	code, out = doJSON(t, adminRouter, http.MethodPut, "/api/v3/platform/attribute-definitions/"+defID,
		`{"attribute_key":"rack_position","display_name":"机柜位置 v2","value_type":"text","resource_category":"host","display_group":"profile"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "机柜位置 v2", out["data"].(map[string]any)["display_name"])

	code, out = doJSON(t, adminRouter, http.MethodDelete, "/api/v3/platform/attribute-definitions/"+defID, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "deleted", out["data"].(map[string]any)["mode"])
}

// TestBuiltinFieldsAreImmutableByAnyRole locks SRS v2.4 FR-30 / NFR-24: built-in
// fields are defined by platform code and have no write path at all, not even
// for an administrator. A custom registration colliding with a built-in key is
// rejected with an actionable message instead of creating a shadow field.
func TestBuiltinFieldsAreImmutableByAnyRole(t *testing.T) {
	router, _ := newTestRouter(t) // admin: the strongest principal

	for _, payload := range []string{
		`{"attribute_key":"has_gpu","display_name":"GPU 芯片","value_type":"boolean","resource_category":"host"}`,
		`{"attribute_key":"owner","display_name":"负责人","value_type":"text","resource_category":"host"}`,
		`{"attribute_key":"status","display_name":"运行状态","value_type":"enum","enum_options":["online"],"resource_category":"host"}`,
	} {
		code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/attribute-definitions", payload)
		assert.Equal(t, http.StatusBadRequest, code, "%s: %v", payload, out)
		assert.Contains(t, out["error"], "平台内置字段")
	}

	// Addressing a built-in field through the custom-field routes also fails
	// with an actionable 400 rather than a generic 404.
	code, out := doJSON(t, router, http.MethodPut, "/api/v3/platform/attribute-definitions/has_gpu",
		`{"attribute_key":"has_gpu","display_name":"GPU","value_type":"boolean","resource_category":"host"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
	assert.Contains(t, out["error"], "平台内置字段")

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/attribute-definitions/has_gpu", "")
	assert.Equal(t, http.StatusBadRequest, code, out)
	assert.Contains(t, out["error"], "平台内置字段")

	// The built-in list remains complete and read-only.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/ci-models/host", "")
	require.Equal(t, http.StatusOK, code, out)
	model := out["data"].(map[string]any)
	assert.Empty(t, model["custom_fields"])

	keys := make(map[string]bool)
	for _, item := range model["builtin_fields"].([]any) {
		field := item.(map[string]any)
		keys[field["key"].(string)] = true
		assert.Equal(t, true, field["immutable"])
	}
	for _, key := range []string{"has_gpu", "owner", "status"} {
		assert.True(t, keys[key], "host builtin field %q missing", key)
	}
}

// seedCustomFieldValueTarget seeds one custom field definition plus one host so
// a non-admin can exercise the resource-level attribute-value endpoint.
func seedCustomFieldValueTarget(t *testing.T, gormDB *gorm.DB) {
	t.Helper()
	require.NoError(t, gormDB.Exec(`INSERT INTO m07_attribute_definitions(
		id, attribute_key, display_name, value_type, resource_category, enum_options,
		required, enabled, status, display_group, display_order, description
	) VALUES ('def-rack','rack_position','机柜位置','text','host','[]',
		FALSE,TRUE,'active','profile',0,'')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO resources(
		resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key
	) VALUES ('host-admin-gate','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.10.10.10')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources(
		resource_id,hostname,instance_ip,os_type,has_npu,has_gpu
	) VALUES ('host-admin-gate','gate-01','10.10.10.10','Ubuntu',FALSE,FALSE)`).Error)
}
