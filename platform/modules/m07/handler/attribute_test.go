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
	) VALUES ('host-attr','attr-01','10.9.9.9','Ubuntu',TRUE,FALSE)`).Error)

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

// TestCIModelBuiltinAndCustomFields covers the CI model page contract
// (SRS Module_07 v2.2 §5.8 FR-30~FR-34): built-in fields are read-only,
// custom fields appear with group/order, and removal follows the reference rule.
func TestCIModelBuiltinAndCustomFields(t *testing.T) {
	router, gormDB := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/ci-models", "")
	require.Equal(t, http.StatusOK, code, out)
	list := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, list, 6)

	host := ciModelOf(t, list, "host")
	builtin := host["builtin_fields"].([]any)
	keys := make(map[string]bool, len(builtin))
	for _, item := range builtin {
		field := item.(map[string]any)
		keys[field["key"].(string)] = true
		assert.True(t, field["immutable"].(bool), "builtin field %v must be immutable", field["key"])
	}
	for _, key := range []string{
		"instance_name", "instance_ip", "os_type", "network_domain_id", "biz_code", "app_code",
		"platform_code", "cluster", "env", "status", "scrape_port", "has_npu", "has_gpu",
		"owner", "activated_at",
	} {
		assert.True(t, keys[key], "host builtin field %q missing", key)
	}

	// 未知类别被拒绝。
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/ci-models/unknown", "")
	assert.Equal(t, http.StatusBadRequest, code, out)

	// 自定义字段登记后进入模型。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/attribute-definitions", `{
		"attribute_key":"rack_position",
		"display_name":"机柜位置",
		"value_type":"text",
		"resource_category":"host",
		"display_group":"profile",
		"display_order":2
	}`)
	require.Equal(t, http.StatusOK, code, out)
	defID := out["data"].(map[string]any)["id"].(string)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/ci-models/host", "")
	require.Equal(t, http.StatusOK, code, out)
	model := out["data"].(map[string]any)
	custom := model["custom_fields"].([]any)
	require.Len(t, custom, 1)
	field := custom[0].(map[string]any)
	assert.Equal(t, "rack_position", field["attribute_key"])
	assert.Equal(t, "profile", field["display_group"])
	assert.Equal(t, "画像信息", field["display_group_label"])
	assert.EqualValues(t, 2, field["display_order"])
	assert.Equal(t, "active", field["status"])

	// 零引用：移除即删除。
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/attribute-definitions/"+defID, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "deleted", out["data"].(map[string]any)["mode"])

	// 有引用：移除即移出模型，值保留，且不再出现在模型里。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/attribute-definitions", `{
		"attribute_key":"rack_position",
		"display_name":"机柜位置",
		"value_type":"text",
		"resource_category":"host"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	defID = out["data"].(map[string]any)["id"].(string)

	require.NoError(t, gormDB.Exec(`INSERT INTO resources(
		resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key
	) VALUES ('host-ci-model','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.9.9.8')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources(
		resource_id,hostname,instance_ip,os_type,has_npu,has_gpu
	) VALUES ('host-ci-model','cm-01','10.9.9.8','Ubuntu',FALSE,FALSE)`).Error)

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/resources/host-ci-model/attributes", `{
		"attributes":[{"key":"rack_position","value":"B-12"}]
	}`)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/attribute-definitions/"+defID, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "removed", out["data"].(map[string]any)["mode"])
	assert.EqualValues(t, 1, out["data"].(map[string]any)["usage_count"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/ci-models/host", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Empty(t, out["data"].(map[string]any)["custom_fields"].([]any))

	// 已移出字段不可再填值，历史值仍在。
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/resources/host-ci-model/attributes", `{
		"attributes":[{"key":"rack_position","value":"B-13"}]
	}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/resources/host-ci-model/attributes", "")
	require.Equal(t, http.StatusOK, code, out)
	stored := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, stored, 1)
	assert.Equal(t, "B-12", stored[0].(map[string]any)["value"])

	// 重新登记同名 key：恢复为在模型中，历史值自动可用。
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/attribute-definitions", `{
		"attribute_key":"rack_position",
		"display_name":"机柜位置（恢复）",
		"value_type":"text",
		"resource_category":"host"
	}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, defID, out["data"].(map[string]any)["id"])
	assert.Equal(t, "active", out["data"].(map[string]any)["status"])
}

func ciModelOf(t *testing.T, list []any, category string) map[string]any {
	t.Helper()
	for _, item := range list {
		model := item.(map[string]any)
		if model["resource_category"] == category {
			return model
		}
	}
	require.FailNow(t, "ci model not found", category)
	return nil
}
