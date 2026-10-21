package scrapejob

import (
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/configcenter/portchain"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// previewEnvelope 镜像 POST /scrape-jobs/:id/preview-targets 的统一响应信封
// （含 status/errorType，供 D-4「business 来源不阻断」断言使用）。
type previewEnvelope struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Targets []previewTarget `json:"targets"`
	} `json:"data"`
}

// postPreviewTargets 请求目标预览并解码信封，返回信封与 HTTP 状态码。
func postPreviewTargets(t *testing.T, r *gin.Engine, jobID string) (previewEnvelope, int) {
	t.Helper()
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+jobID+"/preview-targets", "")
	var out previewEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return out, w.Code
}

// seedStandardJob 直接落库创建标准采集 Job（绕过创建接口的参数校验，聚焦
// preview/instances 端口回显行为），返回 Job 供取 ID。
func seedStandardJob(t *testing.T, db *gorm.DB, name string, resourceType models.ResourceType,
	monitorType, exporterTemplateID string, selected []string) *models.ScrapeJob {
	t.Helper()
	job := &models.ScrapeJob{
		JobName: name, JobType: models.JobTypeStandard, ResourceType: resourceType,
		MonitorType: monitorType, ExporterTemplateID: exporterTemplateID,
		NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: selected, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone,
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	return job
}

// jobIDString 取 Job 的路径参数形态 ID。
func jobIDString(job *models.ScrapeJob) string {
	return strconv.FormatUint(uint64(job.ID), 10)
}

// seedDefaultHostMapping 登记某 monitor_type 的默认类型映射（含类型默认端口）。
func seedDefaultHostMapping(t *testing.T, db *gorm.DB, monitorType string, defaultPort int) {
	t.Helper()
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: monitorType, ExporterTemplateID: "", IsDefault: true, DefaultPort: defaultPort,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "30s", ScrapeTimeout: "20s",
	}).Error)
}

// seedPortExporter 登记带默认端口的采集器模板，返回其 ID 字符串。
func seedPortExporter(t *testing.T, db *gorm.DB, name string, defaultPort int) string {
	t.Helper()
	e := &models.ExporterTemplate{
		Name: name, MetricsPath: "/metrics", Scheme: "http",
		Source: models.ExporterSourceOfficial, IsBuiltin: true, DefaultPort: defaultPort,
	}
	require.NoError(t, db.Create(e).Error)
	return strconv.FormatUint(uint64(e.ID), 10)
}

// setHostScrapePort 设置实例级采集端口覆盖（0 = 留空回落）。
func setHostScrapePort(t *testing.T, db *gorm.DB, resourceID string, port int) {
	t.Helper()
	require.NoError(t, db.Model(&models.Host{}).
		Where("resource_id = ?", resourceID).Update("scrape_port", port).Error)
}

// T01-P4：preview-targets 按实例返回 {port, port_source}，instance/mapping 两级来源。
// 同一 Job 下 host-1 填了实例级覆盖 → instance；host-2 留空 → 落类型映射默认 → mapping。
func TestPreviewTargetsPortSourceInstanceAndMapping(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedDefaultHostMapping(t, db, "host_linux", 9100)
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	setHostScrapePort(t, db, "host-1", 19100)
	job := seedStandardJob(t, db, "node-prod", models.ResourceTypeHost, "host_linux", "",
		[]string{"host-1", "host-2"})

	out, code := postPreviewTargets(t, r, jobIDString(job))

	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.Targets, 2)
	assert.Equal(t, "10.0.1.1", out.Data.Targets[0].Address)
	assert.Equal(t, 19100, out.Data.Targets[0].Port, "实例级覆盖优先")
	assert.Equal(t, portchain.SourceInstance, out.Data.Targets[0].PortSource)
	assert.Equal(t, 9100, out.Data.Targets[1].Port, "留空回落类型映射默认")
	assert.Equal(t, portchain.SourceMapping, out.Data.Targets[1].PortSource)
}

// T01-P4：响应 JSON 字段契约（供前端 T01-P6/T01-P8 快照回写）：
// 每个 standard 目标携带 `port`（数值）与 `port_source`（字符串枚举）两个键。
func TestPreviewTargetsPortJSONContractKeys(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	job := seedStandardJob(t, db, "node-prod", models.ResourceTypeHost, "host_linux", "",
		[]string{"host-1"})

	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+jobIDString(job)+"/preview-targets", "")
	require.Equal(t, http.StatusOK, w.Code)
	var raw struct {
		Data struct {
			Targets []map[string]any `json:"targets"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &raw))
	require.Len(t, raw.Data.Targets, 1)
	_, hasPort := raw.Data.Targets[0]["port"]
	_, hasSource := raw.Data.Targets[0]["port_source"]
	assert.True(t, hasPort, "standard 目标必须携带 port 键")
	assert.True(t, hasSource, "standard 目标必须携带 port_source 键")
}

// T01-P4：template 来源——该 monitor_type 无默认映射时回落采集器模板 default_port。
func TestPreviewTargetsPortSourceTemplate(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	tmplID := seedPortExporter(t, db, "windows-exporter", 9182)
	seedHost(t, db, "host-3", "default", "10.0.1.3", "online")
	job := seedStandardJob(t, db, "win-node", models.ResourceTypeHost, "host_windows", tmplID,
		[]string{"host-3"})

	out, code := postPreviewTargets(t, r, jobIDString(job))

	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, 9182, out.Data.Targets[0].Port)
	assert.Equal(t, portchain.SourceTemplate, out.Data.Targets[0].PortSource)
}

// T01-P4：unresolved 失败态——四级全缺返回 (0, unresolved)，地址保持裸 IP，
// 前端按提案 §9 口径展示 "-"（不展示 0）；host 无业务 port 层，永不产生 business。
func TestPreviewTargetsPortSourceUnresolved(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-4", "default", "10.0.1.4", "online")
	job := seedStandardJob(t, db, "bsd-node", models.ResourceTypeHost, "host_solaris", "",
		[]string{"host-4"})

	out, code := postPreviewTargets(t, r, jobIDString(job))

	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "10.0.1.4", out.Data.Targets[0].Address, "裸 IP，不拼端口")
	assert.Equal(t, 0, out.Data.Targets[0].Port)
	assert.Equal(t, portchain.SourceUnresolved, out.Data.Targets[0].PortSource)
	assert.NotEqual(t, portchain.SourceBusiness, out.Data.Targets[0].PortSource,
		"host 永不产生 business 来源（拍板 Q1）")
}

// T01-P4 + 决策 D-4：business 来源（database 业务 port 兜底）只回显不阻断——
// 后端返回 HTTP 200 且 status=success、无 errorType/error，警示由前端展示。
func TestPreviewTargetsPortSourceBusinessNotBlocked(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: "db-1", ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: "default", BizCode: "infra", Env: "PRD", Status: "online",
			SourceType: models.SourceTypeManual,
		},
		DatabaseType: "mysql", InstanceIP: "10.0.2.1", Port: 3306,
		ResourceType: models.ResourceTypeDatabase,
	}).Error)
	// 该 monitor_type 无映射、Job 无模板 → 四级仅剩业务 port 兜底。
	job := seedStandardJob(t, db, "mysql-prod", models.ResourceTypeDatabase, "database_mysql", "",
		[]string{"db-1"})

	out, code := postPreviewTargets(t, r, jobIDString(job))

	require.Equal(t, http.StatusOK, code, "business 来源不得阻断请求（D-4）")
	assert.Equal(t, "success", out.Status, "business 来源不返回 error（D-4）")
	assert.Empty(t, out.ErrorType)
	assert.Empty(t, out.Error)
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, 3306, out.Data.Targets[0].Port)
	assert.Equal(t, portchain.SourceBusiness, out.Data.Targets[0].PortSource)
}

// T01-P4 + D3a：application 端口是资源自身属性，不进采集器映射链——即使其
// monitor_type 存在类型默认端口也不生效，按资源行 port 直用（来源 instance）。
func TestPreviewTargetsApplicationPortBypassesChain(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedDefaultHostMapping(t, db, "application_http", 9999)
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "app-1", NetworkDomainID: "default", Status: "online",
		ServiceName: "pay-service", Endpoint: "10.0.1.4", Port: 8081, Protocol: "http",
	}).Error)
	job := seedStandardJob(t, db, "app-http", models.ResourceTypeApplication, "application_http", "",
		[]string{"app-1"})

	out, code := postPreviewTargets(t, r, jobIDString(job))

	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "10.0.1.4:8081", out.Data.Targets[0].Address)
	assert.Equal(t, 8081, out.Data.Targets[0].Port, "资源自身端口直用（D3a）")
	assert.Equal(t, portchain.SourceInstance, out.Data.Targets[0].PortSource,
		"application 不进映射链，类型默认端口 9999 不得生效")
}

// T01-P4 + D3 矩阵：blackbox 资源模式无端口解析概念，port/port_source 保持零值
// （port=0、port_source=""）；目标地址 = 所选实例在 target_field 上的值。
func TestPreviewTargetsBlackboxNoPortChain(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedInterfaceService(t, db, "is-1", "default", "订单查询", "https://api.example.com/health?token=x", "online")
	bb := &models.ScrapeJob{
		JobName: "bb-prod", JobType: models.JobTypeBlackbox, ResourceType: models.ResourceTypeInterfaceService,
		TargetField: "api_url",
		NetworkDomainID: "default",
		InstanceSelectionMode: models.InstanceSelectionManual, AuthType: models.AuthTypeNone,
		BlackboxModule: "http_2xx", SelectedInstanceIDs: []string{"is-1"},
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(bb).Error)

	out, code := postPreviewTargets(t, r, jobIDString(bb))

	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "https://api.example.com/health?token=x", out.Data.Targets[0].Address, "target = api_url 字段值，逐字节原样")
	assert.Equal(t, 0, out.Data.Targets[0].Port)
	assert.Equal(t, "", out.Data.Targets[0].PortSource, "blackbox 不进端口解析链")
}

// TestPreviewTargetsBlackboxNonInterfaceService：拨测不再与 interface_service 耦合——
// 选 database 类别实例 + target_field=instance_ip → 预览地址等于该实例的 IP。
func TestPreviewTargetsBlackboxNonInterfaceService(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedDatabase(t, db, "db-1", "default", "10.0.2.7", "mysql", "online")
	bb := &models.ScrapeJob{
		JobName: "bb-db", JobType: models.JobTypeBlackbox, ResourceType: models.ResourceTypeDatabase,
		TargetField:            "instance_ip",
		NetworkDomainID:        "default",
		InstanceSelectionMode:  models.InstanceSelectionManual, AuthType: models.AuthTypeNone,
		BlackboxModule: "http_2xx", SelectedInstanceIDs: []string{"db-1"},
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(bb).Error)

	out, code := postPreviewTargets(t, r, jobIDString(bb))

	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "10.0.2.7", out.Data.Targets[0].Address, "target = 所选类别实例在 target_field 上的值")
	assert.Equal(t, "", out.Data.Targets[0].Protocol, "非 URL 字段无 scheme")
}
