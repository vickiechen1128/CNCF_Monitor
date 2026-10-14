package scrapejob

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/metriccenter/metriccenter/platform/configcenter/portchain"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// T01-P4：instances 按实例返回 {port, port_source}，instance/mapping 两级来源
// （与 preview-targets 同源——共用 resolveInstanceScrapePort → portchain.Resolve）。
func TestListInstancesPortSourceInstanceAndMapping(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedDefaultHostMapping(t, db, "host_linux", 9100)
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	setHostScrapePort(t, db, "host-1", 19100)
	job := seedStandardJob(t, db, "node-prod", models.ResourceTypeHost, "host_linux", "",
		[]string{"host-1", "host-2"})

	out := listInstances(t, r, jobIDString(job))

	require.Len(t, out.Data.Items, 2)
	assert.Equal(t, 19100, out.Data.Items[0].Port, "实例级覆盖优先")
	assert.Equal(t, portchain.SourceInstance, out.Data.Items[0].PortSource)
	assert.Equal(t, 9100, out.Data.Items[1].Port, "留空回落类型映射默认")
	assert.Equal(t, portchain.SourceMapping, out.Data.Items[1].PortSource)
}

// T01-P4：template 来源——无默认映射的 monitor_type 回落采集器模板 default_port。
func TestListInstancesPortSourceTemplate(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	tmplID := seedPortExporter(t, db, "windows-exporter", 9182)
	seedHost(t, db, "host-3", "default", "10.0.1.3", "online")
	job := seedStandardJob(t, db, "win-node", models.ResourceTypeHost, "host_windows", tmplID,
		[]string{"host-3"})

	out := listInstances(t, r, jobIDString(job))

	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, 9182, out.Data.Items[0].Port)
	assert.Equal(t, portchain.SourceTemplate, out.Data.Items[0].PortSource)
}

// T01-P4：unresolved 失败态——四级全缺返回 (0, unresolved)；host 无业务 port 层，
// 永不产生 business 来源（拍板 Q1 硬约束）。
func TestListInstancesPortSourceUnresolvedHostNeverBusiness(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-4", "default", "10.0.1.4", "online")
	job := seedStandardJob(t, db, "bsd-node", models.ResourceTypeHost, "host_solaris", "",
		[]string{"host-4"})

	out := listInstances(t, r, jobIDString(job))

	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, 0, out.Data.Items[0].Port)
	assert.Equal(t, portchain.SourceUnresolved, out.Data.Items[0].PortSource)
	assert.NotEqual(t, portchain.SourceBusiness, out.Data.Items[0].PortSource,
		"host 永不产生 business 来源（拍板 Q1）")
}

// T01-P4 + 决策 D-4 + 拍板 Q1：business 来源仅 database/middleware 可产生——
// middleware 业务 port 兜底时后端返回 HTTP 200 且 status=success、无 errorType，
// 警示由前端展示，不阻断实例列表。
func TestListInstancesPortSourceBusinessMiddlewareNotBlocked(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID: "mw-1", ResourceType: models.ResourceTypeMiddleware,
		ResourceCategory: models.ResourceCategoryMiddleware, NetworkDomainID: "default",
		BizCode: "infra", SourceType: models.SourceTypeManual, AppName: "kafka-1",
		Env: "prod", Cluster: "kafka", Owner: "ops", Status: "online",
		MiddlewareType: "kafka", InstanceIP: "10.0.3.1", Port: 6379,
	}).Error)
	// 无映射、无模板 → 四级仅剩业务 port 兜底。
	job := seedStandardJob(t, db, "kafka-prod", models.ResourceTypeMiddleware, "middleware_kafka", "",
		[]string{"mw-1"})

	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/"+jobIDString(job)+"/instances", "")
	require.Equal(t, http.StatusOK, w.Code, "business 来源不得阻断请求（D-4）")
	var out struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
		Data      struct {
			Items []jobInstanceItem `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status, "business 来源不返回 error（D-4）")
	assert.Empty(t, out.ErrorType)
	assert.Empty(t, out.Error)
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, 6379, out.Data.Items[0].Port)
	assert.Equal(t, portchain.SourceBusiness, out.Data.Items[0].PortSource)
}
