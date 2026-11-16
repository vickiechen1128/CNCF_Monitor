package handler

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ruleBody(content string, extra map[string]any) string {
	payload := map[string]any{"rule_content": content}
	for key, value := range extra {
		payload[key] = value
	}
	raw, _ := json.Marshal(payload)
	return string(raw)
}

const validRuleYAML = `groups:
- name: host
  rules:
  - alert: HostDown
    expr: up == 0
    for: 5m
    labels:
      severity: critical
`

func TestRuleCRUDAndValidate(t *testing.T) {
	router, _ := newTestRouter(t)

	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules/validate",
		ruleBody(validRuleYAML, nil))
	require.Equal(t, http.StatusOK, code, out)
	result := out["data"].(map[string]any)
	assert.Equal(t, true, result["valid"])
	assert.EqualValues(t, 1, result["groups"])
	assert.EqualValues(t, 1, result["rules"])
	assert.Empty(t, result["job_ref"].([]any))
	promql := result["promql"].(map[string]any)
	assert.NotEmpty(t, promql["status"])

	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules", ruleBody(validRuleYAML, nil))
	require.Equal(t, http.StatusOK, code, out)
	rule := out["data"].(map[string]any)
	id := rule["id"].(string)
	assert.Equal(t, "host", rule["name"], "name defaults to the first group")
	assert.Equal(t, "central", rule["scope"])
	assert.Equal(t, "pending", rule["sync"].(map[string]any)["status"])
	assert.EqualValues(t, 1, rule["group_count"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/monitoring-rules", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	// Reusing a group name from another enabled+ready rule conflicts.
	other := `groups:
- name: host
  rules:
  - alert: HostDown2
    expr: up == 1
`
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules", ruleBody(other, nil))
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Duplicate group names inside one file are rejected.
	duplicate := `groups:
- name: host
  rules:
  - alert: A
    expr: up == 0
- name: host
  rules:
  - alert: B
    expr: up == 0
`
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules/validate",
		ruleBody(duplicate, nil))
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["valid"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/monitoring-rules/"+id,
		ruleBody(validRuleYAML, map[string]any{"name": "host-rules", "enabled": false}))
	require.Equal(t, http.StatusOK, code, out)
	updated := out["data"].(map[string]any)
	assert.Equal(t, "host-rules", updated["name"])
	assert.Equal(t, false, updated["enabled"])
	assert.Equal(t, "draft", updated["sync"].(map[string]any)["status"])

	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/monitoring-rules/"+id, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/monitoring-rules/"+id, "")
	assert.Equal(t, http.StatusNotFound, code, out)
}

func TestRuleJobRefGateAndEscapeHatch(t *testing.T) {
	router, _ := newTestRouter(t)

	livenessMissing := `groups:
- name: liveness
  rules:
  - alert: HostDown
    expr: up{job="ghost"} == 0
`
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules/validate",
		ruleBody(livenessMissing, nil))
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, true, data["valid"], "job_ref error is an overridable axis")
	issues := data["job_ref"].([]any)
	require.Len(t, issues, 1)
	assert.Equal(t, "error", issues[0].(map[string]any)["severity"])

	// Without the escape hatch the submit is blocked.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules", ruleBody(livenessMissing, nil))
	assert.Equal(t, http.StatusBadRequest, code, out)

	// With the escape hatch it is accepted and recorded.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules",
		ruleBody(livenessMissing, map[string]any{"ack_job_ref_errors": true, "ack_reason": "job 稍后补建"}))
	require.Equal(t, http.StatusOK, code, out)
	rule := out["data"].(map[string]any)
	assert.Equal(t, true, rule["ack_job_ref_errors"])
	assert.Equal(t, "job 稍后补建", rule["ack_reason"])

	// Non-liveness references only warn and do not block.
	warningMissing := `groups:
- name: traffic
  rules:
  - alert: NoTraffic
    expr: rate(http_requests_total{job="ghost"}[5m]) == 0
`
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules", ruleBody(warningMissing, nil))
	require.Equal(t, http.StatusOK, code, out)
}

func TestRuleRejectsInvalidContent(t *testing.T) {
	router, _ := newTestRouter(t)

	cases := []string{
		`groups: [`,
		`groups: []`,
		`groups:
- name: host
  rules:
  - expr: up == 0
`,
		`groups:
- name: host
  rules:
  - alert: A
    record: B
    expr: up == 0
`,
	}
	for _, content := range cases {
		code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules", ruleBody(content, nil))
		assert.Equal(t, http.StatusBadRequest, code, out, content)
	}

	// structured editing is deferred.
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules",
		`{"content_mode":"structured","rule_content":"groups: []"}`)
	assert.Equal(t, http.StatusBadRequest, code, out)

	// Unknown fields are rejected.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/monitoring-rules",
		`{"rule_content":"x","unexpected":true}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
}
