package handler

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 对象优先动线的端到端契约：一次提交跨两个网域的实例 → 1 个组 + 每域 1 条子
// Job；列表、编辑（某域实例清零）、删除、重名冲突都在 HTTP 层验证。
func TestJobGroupLifecycle(t *testing.T) {
	router, gormDB := newTestRouter(t)

	for _, stmt := range []string{
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-other','第二采集域','edge','platform_admin','enabled')`,
		`INSERT INTO network_domain_access(domain_id,token_hash,registration_status)
			VALUES ('mc-other','hash2','monitored')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-a1','host','platform_admin','mc-demo','PRD','online','manual',0,'host|mc-demo|10.1.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-a1','web-a1','10.1.0.1','linux')`,
		`INSERT INTO resources(resource_id,resource_category,tenant_id,network_domain_id,env,status,source_type,scrape_port,dedup_key)
			VALUES ('res-b1','host','platform_admin','mc-other','PRD','online','manual',0,'host|mc-other|10.2.0.1')`,
		`INSERT INTO host_resources(resource_id,hostname,instance_ip,os_type)
			VALUES ('res-b1','web-b1','10.2.0.1','linux')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	createBody := `{
		"name":"主机基础采集",
		"job_name":"host-base",
		"job_type":"standard",
		"resource_category":"host",
		"monitor_type":"host_linux",
		"selected_instance_ids":["res-a1","res-b1"]
	}`
	code, out := doJSON(t, router, http.MethodPost, "/api/v3/platform/job-groups", createBody)
	require.Equal(t, http.StatusOK, code, out)
	group := out["data"].(map[string]any)
	groupID := group["id"].(string)
	assert.Equal(t, "主机基础采集", group["name"])
	assert.Equal(t, "host-base", group["job_name"])
	assert.Equal(t, "15s", group["scrape_interval"])
	assert.Equal(t, "enabled", group["status"])

	domains := group["domains"].([]any)
	require.Len(t, domains, 2, "one child job per network domain")
	seen := map[string]bool{}
	for _, item := range domains {
		child := item.(map[string]any)
		domainID := child["network_domain_id"].(string)
		seen[domainID] = true
		assert.Equal(t, "host-base", child["job_name"], "children share one job_name across domains")
		assert.EqualValues(t, 1, child["instance_count"])
		assert.Equal(t, "pending", child["sync_status"])
	}
	assert.True(t, seen["mc-demo"] && seen["mc-other"])
	// 子任务内嵌完整 Job 投影（合并任务表复用同一套列，避免 N+1）
	for _, item := range domains {
		child := item.(map[string]any)
		job := child["job"].(map[string]any)
		assert.Equal(t, "host-base", job["job_name"])
		assert.Equal(t, child["network_domain_id"], job["network_domain_id"])
		assert.Contains(t, job, "exporter_template_name")
		assert.NotNil(t, job["selected_instance_count"])
	}

	sync := group["sync"].(map[string]any)
	assert.Equal(t, "pending", sync["status"])
	assert.EqualValues(t, 2, sync["total"])

	// Job 列表 / 详情必须暴露 job_group_id + job_group_name（合并任务列表的前置）
	childID := domains[0].(map[string]any)["job_id"].(string)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs/"+childID, "")
	require.Equal(t, http.StatusOK, code, out)
	childJob := out["data"].(map[string]any)
	assert.Equal(t, groupID, childJob["job_group_id"])
	assert.Equal(t, "主机基础采集", childJob["job_group_name"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs?keyword=host-base", "")
	require.Equal(t, http.StatusOK, code, out)
	for _, item := range out["data"].(map[string]any)["list"].([]any) {
		row := item.(map[string]any)
		assert.Equal(t, groupID, row["job_group_id"])
		assert.Equal(t, "主机基础采集", row["job_group_name"])
	}

	// 未分组过滤：新建一条单域 Job 后，ungrouped=true 只返回它
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/scrape-jobs", `{
		"job_name":"standalone-host",
		"job_type":"standard",
		"resource_category":"host",
		"monitor_type":"host_linux",
		"network_domain_id":"mc-demo",
		"selected_instance_ids":["res-a1"]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs?ungrouped=true", "")
	require.Equal(t, http.StatusOK, code, out)
	ungroupedList := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, ungroupedList, 1)
	assert.Equal(t, "standalone-host", ungroupedList[0].(map[string]any)["job_name"])
	assert.Nil(t, ungroupedList[0].(map[string]any)["job_group_id"])

	// 分组口径显式化：grouped=true 只返回任务内的域级执行行
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs?grouped=true", "")
	require.Equal(t, http.StatusOK, code, out)
	groupedList := out["data"].(map[string]any)["list"].([]any)
	require.NotEmpty(t, groupedList)
	for _, item := range groupedList {
		assert.NotNil(t, item.(map[string]any)["job_group_id"])
	}

	// 列表：一次查询返回组 + 派生状态
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/job-groups?keyword=主机", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])
	require.Len(t, listData["list"].([]any), 1)

	// 编辑：mc-other 实例清零 → 该域子 Job 删除；参数扇出 30s
	updateBody := `{
		"name":"主机基础采集",
		"job_name":"host-base",
		"job_type":"standard",
		"resource_category":"host",
		"monitor_type":"host_linux",
		"scrape_interval":"30s",
		"selected_instance_ids":["res-a1"]
	}`
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/job-groups/"+groupID, updateBody)
	require.Equal(t, http.StatusOK, code, out)
	updated := out["data"].(map[string]any)
	assert.Equal(t, "30s", updated["scrape_interval"])
	require.Len(t, updated["domains"].([]any), 1)
	assert.Equal(t, "mc-demo", updated["domains"].([]any)[0].(map[string]any)["network_domain_id"])
	child := updated["domains"].([]any)[0].(map[string]any)
	assert.EqualValues(t, 1, child["instance_count"])
	assert.Equal(t, "host-base", child["job_name"])
	var childCount int64
	require.NoError(t, gormDB.Table("m01_scrape_jobs").
		Where("job_group_id = ? AND deleted_at IS NULL", groupID).Count(&childCount).Error)
	assert.Equal(t, int64(1), childCount)

	// 单域任务 → 跨域晋升：原任务行复用为所属域子任务，另一域新建子任务
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/scrape-jobs?ungrouped=true", "")
	require.Equal(t, http.StatusOK, code, out)
	standaloneID := out["data"].(map[string]any)["list"].([]any)[0].(map[string]any)["id"].(string)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/job-groups/from-job", `{
		"job_id":"`+standaloneID+`",
		"name":"晋升后的任务",
		"job_name":"promoted-host",
		"job_type":"standard",
		"resource_category":"host",
		"monitor_type":"host_linux",
		"selected_instance_ids":["res-a1","res-b1"]
	}`)
	require.Equal(t, http.StatusOK, code, out)
	promoted := out["data"].(map[string]any)
	require.Len(t, promoted["domains"].([]any), 2)
	// 原 Job 行被复用（id 不变、已挂到新任务）
	var promotedChild struct {
		ID         string `gorm:"column:id"`
		JobGroupID string `gorm:"column:job_group_id"`
	}
	require.NoError(t, gormDB.Table("m01_scrape_jobs").
		Select("id, job_group_id").
		Where("id = ?", standaloneID).Scan(&promotedChild).Error)
	assert.Equal(t, promoted["id"], promotedChild.JobGroupID)
	// 重复晋升 → 400
	code, _ = doJSON(t, router, http.MethodPost, "/api/v3/platform/job-groups/from-job",
		`{"job_id":"`+standaloneID+`","name":"再次晋升","job_name":"promoted-2","monitor_type":"host_linux","selected_instance_ids":["res-a1"]}`)
	assert.Equal(t, http.StatusBadRequest, code)

	// 组名全局唯一 → 409
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/job-groups", createBody)
	require.Equal(t, http.StatusConflict, code, out)

	// 删除组 → 组 404、子 Job 一并软删
	code, out = doJSON(t, router, http.MethodDelete, "/api/v3/platform/job-groups/"+groupID, "")
	require.Equal(t, http.StatusOK, code, out)
	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/job-groups/"+groupID, "")
	require.Equal(t, http.StatusNotFound, code)
	require.NoError(t, gormDB.Table("m01_scrape_jobs").
		Where("job_group_id = ? AND deleted_at IS NULL", groupID).Count(&childCount).Error)
	assert.Equal(t, int64(0), childCount)
}
