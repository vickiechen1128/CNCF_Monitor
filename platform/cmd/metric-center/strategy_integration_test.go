// Module_01 端到端集成测试（T01-09 验收）：验证 strategy 收口路由在真实 seed +
// memory DB 下全链路可用——exporter/mapping/ScrapeJob/确认/预览/规则/指标库。
package main

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestEndToEndStrategyScrapeJob 覆盖采集器→默认采集配置→采集 Job→实例确认→
// 预览全链路（T01-09 验收要点）。
func TestEndToEndStrategyScrapeJob(t *testing.T) {
	r, db := buildIntegrationEngine(t)
	_ = db
	c := &apiClient{t: t, r: r}

	// 1. 内置 exporter 只读：修改内置 node-exporter → forbidden。
	exporterURL := "/api/v2/platform/exporter-templates"
	code, out := c.json("GET", exporterURL+"?monitor_type=host_linux", "")
	require.Equal(t, http.StatusOK, code)
	var nodeExporterID float64
	for _, it := range listItems(out) {
		m := it.(map[string]interface{})
		if m["name"] == "node-exporter" {
			nodeExporterID = m["id"].(float64)
		}
	}
	require.NotZero(t, nodeExporterID, "seed 应预置 node-exporter 采集器")
	path := fmt.Sprintf("%s/%.0f", exporterURL, nodeExporterID)
	code, _ = c.json("PUT", path, `{"default_port":9101}`)
	require.Equal(t, http.StatusForbidden, code, "内置采集器只读")

	// 2. 默认采集配置继承：创建 host_linux Job 应继承 mapping 快照（interval/timeout/scheme）。
	code, out = c.json("GET", "/api/v2/platform/ci-exporter-mappings?monitor_type=host_linux&is_default=true", "")
	require.Equal(t, http.StatusOK, code)
	require.NotZero(t, len(listItems(out)), "host_linux 应有默认采集配置")

	// 准备一台同网域 host 作为候选实例。
	code, out = c.json("POST", "/api/v2/platform/resources", mustJSON(t, resourcePayload("host", map[string]interface{}{
		"instance_name": "web-01", "instance_ip": "10.0.0.10",
	})))
	require.Equal(t, http.StatusOK, code, "创建 host 应成功：%v", out)
	hostID := out["data"].(map[string]interface{})["resource_id"].(string)

	// 3. 创建一个 standard 采集 Job（利用默认映射继承）。
	jobBody := fmt.Sprintf(`{"job_name":"e2e-node","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["%s"],"enabled":true}`, hostID)
	code, out = c.json("POST", "/api/v2/platform/scrape-jobs", jobBody)
	require.Equal(t, http.StatusOK, code, "创建采集 Job 应成功：%v", out)
	data := out["data"].(map[string]interface{})
	assert.Equal(t, "ready", data["draft_status"])
	assert.Equal(t, "pending", data["change_status"])
	assert.NotEmpty(t, data["scrape_interval"], "应从默认映射继承 scrape_interval")
	jobID := data["id"].(float64)
	jobPath := fmt.Sprintf("/api/v2/platform/scrape-jobs/%.0f", jobID)

	// 4. 候选实例：同网域 host 应返回、offline 置灰。
	code, out = c.json("GET", "/api/v2/platform/scrape-jobs/instance-candidates?monitor_type=host_linux&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, float64(1), out["data"].(map[string]interface{})["total"], "同网域应有 1 个候选 host")

	// 5. 安装确认 → 实例列表反映 confirmed。
	code, out = c.json("POST", jobPath+"/instances/"+hostID+"/confirm", `{"confirmed_by":"platform_admin"}`)
	require.Equal(t, http.StatusOK, code, "安装确认应成功：%v", out)

	code, out = c.json("GET", jobPath+"/instances", "")
	require.Equal(t, http.StatusOK, code)
	items := out["data"].(map[string]interface{})["items"].([]interface{})
	require.Len(t, items, 1)
	assert.Equal(t, "confirmed", items[0].(map[string]interface{})["status"])

	// 6. preview-targets：standard → 实例地址。
	code, out = c.json("POST", jobPath+"/preview-targets", "")
	require.Equal(t, http.StatusOK, code)
	targets := out["data"].(map[string]interface{})["targets"].([]interface{})
	require.Len(t, targets, 1)
	assert.Equal(t, "10.0.0.10", targets[0].(map[string]interface{})["address"])

	// 7. 冻结域拒绝创建（status=disabled，非冻结为 enabled）。
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "frozen", Name: "冻结域", DomainType: models.DomainTypeEdge, Channel: models.ChannelTypeLocal,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusDisabled, IsMonitored: true,
	}).Error)
	code, _ = c.json("POST", "/api/v2/platform/scrape-jobs",
		`{"job_name":"e2e-bad","job_type":"standard","monitor_type":"host_linux","network_domain_id":"frozen"}`)
	require.Equal(t, http.StatusBadRequest, code, "冻结域创建 Job 应被拒")
}

// TestEndToEndStrategyRuleAndMetricLibrary 覆盖规则挂载（YAML 透传 + validate-yaml）
// 与技术指标库（内置只读 + 用户扩展）的端到端验收（T01-09）。
func TestEndToEndStrategyRuleAndMetricLibrary(t *testing.T) {
	r, _ := buildIntegrationEngine(t)
	c := &apiClient{t: t, r: r}

	// 1. 技术指标库：seed 内置 application_http 拨测三件套存在。
	code, out := c.json("GET", "/api/v2/platform/metric-library?monitor_type=application_http", "")
	require.Equal(t, http.StatusOK, code)
	foundSuccess := false
	for _, it := range listItems(out) {
		if it.(map[string]interface{})["metric_name"] == "probe_success" {
			foundSuccess = true
		}
	}
	assert.True(t, foundSuccess, "application_http 应含拨测指标 probe_success")

	// 内置 host_linux 指标禁改 forbidden。
	var cpuMetricID float64
	code, out = c.json("GET", "/api/v2/platform/metric-library?monitor_type=host_linux&keyword=cpu", "")
	require.Equal(t, http.StatusOK, code)
	for _, it := range listItems(out) {
		if it.(map[string]interface{})["metric_name"] == "node_cpu_usage" {
			cpuMetricID = it.(map[string]interface{})["id"].(float64)
		}
	}
	require.NotZero(t, cpuMetricID, "seed 应预置 node_cpu_usage 内置指标")
	code, _ = c.json("PUT", fmt.Sprintf("/api/v2/platform/metric-library/%.0f", cpuMetricID), `{"enabled":false}`)
	require.Equal(t, http.StatusForbidden, code, "内置指标只读")

	// 用户扩展创建（is_builtin=false）。
	code, out = c.json("POST", "/api/v2/platform/metric-library",
		`{"metric_name":"e2e_custom","metric_type":"gauge","monitor_types":[{"monitor_type":"mysql"}],"enabled":true}`)
	require.Equal(t, http.StatusOK, code, "用户扩展指标应成功：%v", out)
	assert.Equal(t, false, out["data"].(map[string]interface{})["is_builtin"])

	// 重复（同 metric_name + monitor_type）→ bad_request。
	code, _ = c.json("POST", "/api/v2/platform/metric-library",
		`{"metric_name":"e2e_custom","metric_type":"gauge","monitor_types":[{"monitor_type":"mysql"}]}`)
	require.Equal(t, http.StatusBadRequest, code)

	// 2. 规则挂载：创建 + YAML 校验 + 非法拦截 + validate-yaml。
	ruleBody := `{"content_mode":"yaml_passthrough","rule_content":"groups:\n- name: high-cpu\n  rules:\n  - alert: HighCPU\n    expr: cpu > 0.9\n","name":"e2e-cpu","enabled":true}`
	code, out = c.json("POST", "/api/v2/platform/monitoring-rules", ruleBody)
	require.Equal(t, http.StatusOK, code, "创建规则应成功：%v", out)
	ruleID := out["data"].(map[string]interface{})["id"].(float64)
	assert.Equal(t, "central", out["data"].(map[string]interface{})["scope"])
	assert.Equal(t, "pending", out["data"].(map[string]interface{})["change_status"])

	// 非法 YAML 拦截。
	code, _ = c.json("POST", "/api/v2/platform/monitoring-rules", `{"rule_content":"name: x"}`)
	require.Equal(t, http.StatusBadRequest, code)

	// validate-yaml 合法 / 非法。
	rulePath := fmt.Sprintf("/api/v2/platform/monitoring-rules/%.0f", ruleID)
	code, out = c.json("POST", rulePath+"/validate-yaml", `{"rule_content":"groups:\n- name: g\n"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, true, out["data"].(map[string]interface{})["valid"])

	code, out = c.json("POST", rulePath+"/validate-yaml", `{"rule_content":"not: [valid"}`)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, false, out["data"].(map[string]interface{})["valid"])
	assert.NotEmpty(t, out["data"].(map[string]interface{})["error"])

	// 删除规则返回 {id}。
	code, out = c.json("DELETE", rulePath, "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, ruleID, out["data"].(map[string]interface{})["id"].(float64))
}