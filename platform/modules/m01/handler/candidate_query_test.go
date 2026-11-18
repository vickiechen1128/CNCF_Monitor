package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 组合筛选（SRS JG v1.1 §5.3）：条件可自由组合（AND），响应带分域计数，
// 非法字段/操作符/枚举值返回 400，全选返回带截断标记的 id 列表。
func TestCandidateQueryWithComposableFilters(t *testing.T) {
	router, gormDB := newTestRouter(t)

	for _, stmt := range []string{
		`INSERT INTO business_domains(code,name,enabled) VALUES ('biz-a','业务A',TRUE)`,
		`INSERT INTO application_dicts(app_code,app_name,status) VALUES ('app-a','应用A','enabled')`,
		`INSERT INTO application_dicts(app_code,app_name,status) VALUES ('app-b','应用B','enabled')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-other','第二采集域','edge','platform_admin','enabled')`,
		`INSERT INTO network_domain_access(domain_id,token_hash,registration_status)
			VALUES ('mc-other','hash2','monitored')`,
		// mc-demo: 2 台 online（app-a / app-b）+ 1 台 offline + 1 台 maintenance
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,biz_code,app_code,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-a1','host','platform_admin','mc-demo','biz-a','app-a','PRD','online','manual',0,'host|mc-demo|10.1.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-a1','web-a1','10.1.0.1','linux')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,biz_code,app_code,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-a2','host','platform_admin','mc-demo','biz-a','app-b','PRD','online','manual',0,'host|mc-demo|10.1.0.2')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-a2','web-a2','10.1.0.2','linux')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,biz_code,app_code,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-a3','host','platform_admin','mc-demo','biz-a','app-a','PRD','offline','manual',0,'host|mc-demo|10.1.0.3')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-a3','web-a3','10.1.0.3','linux')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,biz_code,app_code,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-a4','host','platform_admin','mc-demo','biz-a','app-a','PRD','maintenance','manual',0,'host|mc-demo|10.1.0.4')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-a4','web-a4','10.1.0.4','linux')`,
		// mc-other: 1 台 online（app-a）
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,biz_code,app_code,env,status,source_type,scrape_port,dedup_key)
			VALUES ('r-b1','host','platform_admin','mc-other','biz-a','app-a','UAT','online','manual',0,'host|mc-other|10.2.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('r-b1','web-b1','10.2.0.1','linux')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	// schema：字段清单由服务端下发
	code, out := doJSON(t, router, http.MethodGet,
		"/api/v3/platform/scrape-jobs/instance-candidates/filter-schema", "")
	require.Equal(t, http.StatusOK, code, out)
	fields := out["data"].(map[string]any)["fields"].([]any)
	keys := make([]string, 0, len(fields))
	for _, item := range fields {
		keys = append(keys, item.(map[string]any)["key"].(string))
	}
	assert.Contains(t, keys, "network_domain_id")
	assert.Contains(t, keys, "status")
	assert.Contains(t, keys, "app_code")
	assert.Contains(t, keys, "env")

	// 组合筛选：状态=运行中 AND 应用=app-a AND 网域∈{mc-demo,mc-other}
	code, out = doJSON(t, router, http.MethodPost,
		"/api/v3/platform/scrape-jobs/instance-candidates/query", `{
		"monitor_type":"host_linux",
		"filters":[
			{"field":"status","op":"in","values":["online"]},
			{"field":"network_domain_id","op":"in","values":["mc-demo","mc-other"]},
			{"field":"app_code","op":"in","values":["app-a"]}
		],
		"page":1,"page_size":20
	}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 2, data["total"], "r-a1 + r-b1")
	ids := make([]string, 0, 2)
	for _, item := range data["list"].([]any) {
		ids = append(ids, item.(map[string]any)["resource_id"].(string))
	}
	assert.ElementsMatch(t, []string{"r-a1", "r-b1"}, ids)
	domains := data["domains"].([]any)
	require.Len(t, domains, 2, "per-domain counts feed the save-time preview")
	assert.EqualValues(t, 1, domains[0].(map[string]any)["count"])
	assert.Equal(t, "演示采集域", domains[0].(map[string]any)["network_domain_name"])

	// 未显式筛状态时默认排除「维护中」
	code, out = doJSON(t, router, http.MethodPost,
		"/api/v3/platform/scrape-jobs/instance-candidates/query", `{"monitor_type":"host_linux"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 4, out["data"].(map[string]any)["total"],
		"r-a1 + r-a2 + r-a3(offline) + r-b1, maintenance excluded by default")

	// 全选：同一条件解析为 id 列表
	code, out = doJSON(t, router, http.MethodPost,
		"/api/v3/platform/scrape-jobs/instance-candidates/query/ids", `{
		"monitor_type":"host_linux",
		"filters":[{"field":"status","op":"in","values":["online"]}]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	idsData := out["data"].(map[string]any)
	assert.ElementsMatch(t, []string{"r-a1", "r-a2", "r-b1"}, idsData["ids"].([]any))
	assert.Equal(t, false, idsData["truncated"])
	assert.EqualValues(t, 2000, idsData["max_ids"])
}

// 非法条件必须 400 并点名字段（fail-closed），不得静默忽略。
func TestCandidateQueryRejectsInvalidFilters(t *testing.T) {
	router, _ := newTestRouter(t)

	cases := []struct {
		name string
		body string
	}{
		{"unknown field", `{"monitor_type":"host_linux","filters":[{"field":"password","op":"in","values":["x"]}]}`},
		{"unsupported op", `{"monitor_type":"host_linux","filters":[{"field":"network_domain_id","op":"contains","values":["mc-demo"]}]}`},
		{"empty values", `{"monitor_type":"host_linux","filters":[{"field":"status","op":"in","values":[]}]}`},
		{"invalid status", `{"monitor_type":"host_linux","filters":[{"field":"status","op":"in","values":["bogus"]}]}`},
		{"invalid env", `{"monitor_type":"host_linux","filters":[{"field":"env","op":"in","values":["DEV"]}]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, out := doJSON(t, router, http.MethodPost,
				"/api/v3/platform/scrape-jobs/instance-candidates/query", tc.body)
			assert.Equal(t, http.StatusBadRequest, code, out)
		})
	}
}
