package scrapejob

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

func openTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:scrapejob_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.NetworkDomain{},
		&models.CITypeExporterMapping{},
		&models.ExporterTemplate{},
		&models.ScrapeJob{},
		&models.LabelTemplate{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.InterfaceService{},
		&models.ExporterInstallationConfirmation{},
	))
	return db
}

func newGin() *gin.Engine {
	gin.SetMode(gin.TestMode)
	return gin.New()
}

func mountRoutes(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	r := newGin()
	RegisterRoutes(r.Group("/api/v2/platform"), db)
	return r
}

func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var buf *bytes.Buffer
	if body == "" {
		buf = bytes.NewBuffer(nil)
	} else {
		buf = bytes.NewBufferString(body)
	}
	req := httptest.NewRequest(method, path, buf)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// seedEnabledDomain seeds a monitored+enabled domain.
func seedEnabledDomain(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          id,
		Name:        "域-" + id,
		DomainType:  models.DomainTypeEdge,
		Channel:     models.ChannelTypeLocal,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		IsMonitored: true,
	}).Error)
}

// seedFrozenDomain seeds a frozen (disabled) domain.
func seedFrozenDomain(t *testing.T, db *gorm.DB, id string) {
	t.Helper()
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          id,
		Name:        "冻结域",
		DomainType:  models.DomainTypeEdge,
		Channel:     models.ChannelTypeLocal,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusDisabled,
		IsMonitored: true,
	}).Error)
}

func seedExporter(t *testing.T, db *gorm.DB, name string) string {
	t.Helper()
	e := &models.ExporterTemplate{Name: name, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceOfficial, IsBuiltin: true}
	require.NoError(t, db.Create(e).Error)
	return strconv.FormatUint(uint64(e.ID), 10)
}

// seedExporterWithTypes登记带 supported_monitor_types 声明的采集器（对齐内置模板语义）。
func seedExporterWithTypes(t *testing.T, db *gorm.DB, name string, types []string) string {
	t.Helper()
	e := &models.ExporterTemplate{
		Name: name, MetricsPath: "/metrics", Scheme: "http", Source: models.ExporterSourceOfficial,
		IsBuiltin: true, SupportedMonitorTypes: types,
	}
	require.NoError(t, db.Create(e).Error)
	return strconv.FormatUint(uint64(e.ID), 10)
}

func seedHost(t *testing.T, db *gorm.DB, resourceID, domainID, ip, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID: resourceID, ServerID: resourceID, ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID: domainID, BizCode: "infra", SourceType: models.SourceTypeManual,
		InstanceName: "host-" + resourceID, Status: status, Region: "cn", ZoneEnv: "dev",
		InstanceSpec: "2c4g", Image: "linux", VPC: "vpc", SecurityGroup: "sg", PrivateIP: ip,
	}).Error)
}

// seedInterfaceService 落一条「接口服务」资源（拨测资源模式的候选源）。
func seedInterfaceService(t *testing.T, db *gorm.DB, resourceID, domainID, apiName, apiURL, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.InterfaceService{
		ResourceBase: models.ResourceBase{
			ResourceID: resourceID, ResourceCategory: models.ResourceCategoryInterfaceService,
			NetworkDomainID: domainID, BizCode: "infra", Env: "prod", Status: status,
			SourceType: models.SourceTypeManual,
		},
		APIName: apiName, APIURL: apiURL, ResourceType: models.ResourceTypeInterfaceService,
	}).Error)
}

func seedDatabase(t *testing.T, db *gorm.DB, resourceID, domainID, ip, dbType, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: resourceID, ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: domainID, BizCode: "infra", Env: "prod", Status: status, SourceType: models.SourceTypeManual,
		},
		DatabaseType: dbType, InstanceIP: ip, ResourceType: models.ResourceTypeDatabase,
	}).Error)
}

func TestCreateScrapeJobStandardInheritsDefaults(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	hostID := seedExporter(t, db, "node-exporter")
	// host_linux 默认映射：interval/timeout/metrics/scheme。
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: hostID, IsDefault: true, DefaultPort: 9100,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "30s", ScrapeTimeout: "20s",
	}).Error)
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

	body := `{"job_name":"node-prod","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["host-1"],"enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Status string           `json:"status"`
		Data   models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "success", out.Status)
	assert.Equal(t, "30s", out.Data.ScrapeInterval, "继承映射快照")
	assert.Equal(t, "20s", out.Data.ScrapeTimeout)
	assert.Equal(t, "/metrics", out.Data.MetricsPath)
	assert.Equal(t, "http", out.Data.Scheme)
	assert.Equal(t, string(models.InstanceSelectionManual), string(out.Data.InstanceSelectionMode), "instance_selection_mode 默认 manual")
	assert.Equal(t, "ready", out.Data.DraftStatus)
	assert.Equal(t, string(models.ChangeStatusPending), string(out.Data.ChangeStatus), "创建后 change_status=pending")
}

// F-28：无默认映射时，留空采集参数按全局兜底常量解析（15s/10s//metrics/http）。
func TestCreateScrapeJobGlobalDefaultFallback(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

	body := `{"job_name":"sparse-job","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["host-1"],"enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, models.DefaultScrapeInterval, out.Data.ScrapeInterval)
	assert.Equal(t, models.DefaultScrapeTimeout, out.Data.ScrapeTimeout)
	assert.Equal(t, models.DefaultMetricsPath, out.Data.MetricsPath)
	assert.Equal(t, models.DefaultScheme, out.Data.Scheme)
}

// F-28：映射稀疏留空时，metrics_path/scheme 继续回落到采集器模板默认值。
func TestCreateScrapeJobTemplateFallback(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	tmplID := seedExporter(t, db, "node-exporter") // 模板自带 /metrics + http
	// 稀疏映射：仅覆盖间隔/超时，路径与协议留空（=继承采集器模板）。
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: tmplID, IsDefault: true, DefaultPort: 9100,
		ScrapeInterval: "30s", ScrapeTimeout: "20s",
	}).Error)
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

	body := `{"job_name":"tpl-fallback","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["host-1"],"enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "30s", out.Data.ScrapeInterval, "映射层覆盖")
	assert.Equal(t, "20s", out.Data.ScrapeTimeout)
	assert.Equal(t, "/metrics", out.Data.MetricsPath, "映射留空 → 回落采集器模板")
	assert.Equal(t, "http", out.Data.Scheme)
}

// F-28：更新时清空某参数字段 = 恢复继承，保存时重新解析为映射快照。
func TestUpdateScrapeJobClearFieldReInherits(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	tmplID := seedExporter(t, db, "node-exporter")
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "host_linux", ExporterTemplateID: tmplID, IsDefault: true, DefaultPort: 9100,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "30s", ScrapeTimeout: "20s",
	}).Error)
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "60s", ScrapeTimeout: "10s", MetricsPath: "/custom", Scheme: "https",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	// 清空 scrape_interval 与 metrics_path → 恢复继承映射默认值。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"scrape_interval":"","metrics_path":""}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "30s", out.Data.ScrapeInterval, "清空后回落映射默认")
	assert.Equal(t, "/metrics", out.Data.MetricsPath)
	assert.Equal(t, "10s", out.Data.ScrapeTimeout, "未清空字段保持用户值")
	assert.Equal(t, "https", out.Data.Scheme)
}

// 采集地址职责拆分（M07 台账 endpoint:port + M01 采集 Job metrics_path）：
// application_http 的 metrics_path 必须显式填写——应用指标端点没有通用默认值，
// 留空继承 /metrics 会静默抓不到样本。
func TestCreateScrapeJobApplicationRequiresMetricsPath(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "app-1", NetworkDomainID: "default", Status: "online",
		ServiceName: "pay-service", Endpoint: "10.0.1.4", Port: 8081, Protocol: "http",
		HealthCheckURL: "http://10.0.1.4:8081/actuator/health",
	}).Error)

	t.Run("留空 metrics_path 被拦", func(t *testing.T) {
		body := `{"job_name":"app-prod","job_type":"standard","monitor_type":"application_http","network_domain_id":"default","selected_instance_ids":["app-1"],"enabled":true}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "metrics_path")
	})

	t.Run("显式填写 metrics_path 通过（scheme 仍走全局兜底）", func(t *testing.T) {
		body := `{"job_name":"app-prod-ok","job_type":"standard","monitor_type":"application_http","network_domain_id":"default","selected_instance_ids":["app-1"],"metrics_path":"/actuator/prometheus","enabled":true}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusOK, w.Code, "应创建成功：%s", w.Body.String())
		var out struct {
			Data models.ScrapeJob `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		assert.Equal(t, "/actuator/prometheus", out.Data.MetricsPath)
		assert.Equal(t, models.DefaultScheme, out.Data.Scheme)
	})
}

// application 的实例候选与目标预览展示采集地址 `endpoint:port`（与 M09 生成器
// targets 拼接口径一致），而非 health_check_url（后者仅是应用实际 URL）。
func TestApplicationAddressDisplayUsesEndpointPort(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "app-1", NetworkDomainID: "default", Status: "online",
		ServiceName: "pay-service", Endpoint: "10.0.1.4", Port: 8081,
		HealthCheckURL: "http://10.0.1.4:8081/actuator/health",
	}).Error)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?monitor_type=application_http&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, w.Code)
	var cand struct {
		Data struct {
			List []InstanceCandidate `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &cand))
	require.Len(t, cand.Data.List, 1)
	assert.Equal(t, "app-1", cand.Data.List[0].ResourceID)
	assert.Equal(t, "10.0.1.4:8081", cand.Data.List[0].InstanceIP)

	job := &models.ScrapeJob{
		JobName: "app-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeApplication,
		MonitorType: "application_http", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"app-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/actuator/prometheus", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)

	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(job.ID), 10)+"/preview-targets", "")
	require.Equal(t, http.StatusOK, w.Code)
	var prev struct {
		Data struct {
			Targets []previewTarget `json:"targets"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &prev))
	require.Len(t, prev.Data.Targets, 1)
	assert.Equal(t, "10.0.1.4:8081", prev.Data.Targets[0].Address)
}

func TestCreateScrapeJobRejectsFrozenAndUnmonitoredDomain(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedFrozenDomain(t, db, "frozen")

	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"j1","job_type":"standard","monitor_type":"mysql","network_domain_id":"frozen","scrape_interval":"15s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 未纳管（is_monitored=false）。
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "unmon", Name: "未纳管", DomainType: models.DomainTypeEdge, Channel: models.ChannelTypeLocal,
		TenantID: models.PlatformAdminTenantID, Status: models.DomainStatusEnabled, IsMonitored: false,
	}).Error)
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"j2","job_type":"standard","monitor_type":"mysql","network_domain_id":"unmon","scrape_interval":"15s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

func TestCreateScrapeJobAuthValidation(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")

	// basic 缺 password → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"basic-bad","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_interval":"15s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http","auth_type":"basic","username":"u"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// bearer 缺 token → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bearer-bad","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_interval":"15s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http","auth_type":"bearer"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// basic 合法（password/token 仅存储、不回显明文）。
	url := "/api/v2/platform/scrape-jobs"
	w = perform(t, r, http.MethodPost, url,
		`{"job_name":"basic-ok","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_interval":"15s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http","auth_type":"basic","username":"u","password":"secret"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "basic-ok", out.Data.JobName)
	// 决策31：创建响应不回显 password/token 明文。
	assert.NotContains(t, w.Body.String(), "secret", "创建响应不得回显 password 明文")
	assert.NotContains(t, string(w.Body.Bytes()), "\"password\"", "创建响应不得含 password 字段键")
	assert.NotContains(t, string(w.Body.Bytes()), "\"token\"", "创建响应不得含 token 字段键")

	// 重新从 DB 读取：password 已落库（仅存储，不回显明文由只读响应控制）。
	var persisted models.ScrapeJob
	require.NoError(t, db.Where("job_name = ?", "basic-ok").First(&persisted).Error)
	assert.Equal(t, "secret", persisted.Password)
}

func TestCreateScrapeJobBlackbox(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedInterfaceService(t, db, "is-1", "default", "订单查询", "https://api.example.com/health?token=x", "online")

	// blackbox 缺 module → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-bad","job_type":"blackbox","network_domain_id":"default"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "blackbox_module")

	// blackbox 有 module 但缺 resource_type → bad_request（类别不预设，须用户选择）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-nocat","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "resource_type")

	// 有类别但未选实例 → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-noselect","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "selected_instance_ids")

	// 有实例但 target_field 为空 → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-nofield","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service","selected_instance_ids":["is-1"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "target_field")

	// target_field 不在该类别字段集内 → bad_request 并指出字段名。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-badfield","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service","target_field":"not_a_field","selected_instance_ids":["is-1"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "not_a_field")

	// 手填 blackbox_targets 一律拒绝（彻底禁用手填模式）。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-handfill","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service","target_field":"api_url","selected_instance_ids":["is-1"],"blackbox_targets":[{"target":"api.example.com","protocol":"http"}]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "不再支持手填 blackbox_targets")

	// blackbox 合法：选类别 + 字段 + 实例；monitor_type/exporter 置空；ResourceType 保留用户所选。
	body := `{"job_name":"bb-ok","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service","target_field":"api_url","selected_instance_ids":["is-1"]}`
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "http_2xx", out.Data.BlackboxModule)
	assert.Empty(t, out.Data.BlackboxTargets, "手填字段不落库")
	assert.Equal(t, []string{"is-1"}, out.Data.SelectedInstanceIDs)
	assert.Equal(t, models.ResourceTypeInterfaceService, out.Data.ResourceType)
	assert.Equal(t, "api_url", out.Data.TargetField)
	assert.Empty(t, out.Data.MonitorType, "blackbox 任务 monitor_type 置空")
	assert.Empty(t, out.Data.ExporterTemplateID, "blackbox 任务 exporter 置空")
}

// TestCreateScrapeJobBlackboxRejectsWrongCategoryInstance：resource_type 指定类别与所选
// 实例实际类别不符 → 400。此处 resource_type=interface_service，但实例是 host。
func TestCreateScrapeJobBlackboxRejectsWrongCategoryInstance(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-host","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service","target_field":"api_url","selected_instance_ids":["host-1"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "不属于资源类别")
}

// TestCreateScrapeJobBlackboxNonInterfaceServiceCategory：核心判据——拨测不再与
// interface_service 耦合：选 database 类别实例 + target_field=instance_ip → 创建成功。
func TestCreateScrapeJobBlackboxNonInterfaceServiceCategory(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedDatabase(t, db, "db-1", "default", "10.0.2.7", "mysql", "online")

	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-db","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"database","target_field":"instance_ip","selected_instance_ids":["db-1"]}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, models.ResourceTypeDatabase, out.Data.ResourceType)
	assert.Equal(t, "instance_ip", out.Data.TargetField)
}

// TestCreateScrapeJobBlackboxCrossDomainRejected：跨网域接口服务 → 400。
func TestCreateScrapeJobBlackboxCrossDomainRejected(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedEnabledDomain(t, db, "other")
	seedInterfaceService(t, db, "is-other", "other", "外部接口", "https://other.example.com/health", "online")

	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-cross","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","resource_type":"interface_service","target_field":"api_url","selected_instance_ids":["is-other"]}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "网域")
}

func TestListScrapeJobsFiltersAndLabelTemplateReverseLookup(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")

	// 创建一个 ready 任务。
	require.NoError(t, db.Create(&models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}).Error)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs?monitor_type=host_linux&enabled=true", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []models.ScrapeJob `json:"list"`
			Total int64              `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, string(models.ChangeStatusPending), string(out.Data.List[0].ChangeStatus), "item 含 change_status")

	// label_template_id 反查：模板不存在 not_found。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs?label_template_id=999", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestUpdateScrapeJobJobTypeSwitch(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedInterfaceService(t, db, "is-1", "default", "订单查询", "https://api.example.com/health", "online")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	// standard → blackbox：缺 blackbox 必填字段 → bad_request。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"job_type":"blackbox"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// standard → blackbox（选类别 + 字段 + 实例）：monitor_type/exporter 清空、job_type 切换、
	// ResourceType 保留用户所选类别。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID,
		`{"job_type":"blackbox","blackbox_module":"http_2xx","resource_type":"interface_service","target_field":"api_url","selected_instance_ids":["is-1"]}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			JobType        models.JobType     `json:"job_type"`
			ResourceType   models.ResourceType `json:"resource_type"`
			MonitorType    string             `json:"monitor_type"`
			BlackboxModule string             `json:"blackbox_module"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, string(models.JobTypeBlackbox), string(out.Data.JobType))
	assert.Equal(t, models.ResourceTypeInterfaceService, out.Data.ResourceType)
	assert.Empty(t, out.Data.MonitorType, "切到 blackbox 后 monitor_type 清空")
	assert.Equal(t, "http_2xx", out.Data.BlackboxModule)

	// blackbox → standard：缺 monitor_type → bad_request。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"job_type":"standard"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// blackbox → standard（带 monitor_type 与采集参数）成功。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID,
		`{"job_type":"standard","monitor_type":"mysql","scrape_interval":"15s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http"}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, string(models.JobTypeStandard), string(out.Data.JobType))
	assert.Equal(t, "mysql", out.Data.MonitorType)
}

func TestUpdateAndDeleteScrapeJob(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)

	// 更新采集间隔。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(job.ID), 10), `{"scrape_interval":"60s"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			ScrapeInterval string `json:"scrape_interval"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "60s", out.Data.ScrapeInterval)

	// 删除 → 列表为空。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(job.ID), 10), "")
	require.Equal(t, http.StatusOK, w.Code)
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	var list struct {
		Data struct {
			Total int64 `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	assert.Equal(t, int64(0), list.Data.Total, "软删后不进入列表")

	// 未命中 not_found。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/scrape-jobs/999999", "")
	require.Equal(t, http.StatusNotFound, w.Code)
}

// 回归：软删后重建同名 Job 应成功，而不是命中 DB 唯一索引抛 internal error
// （create.go 用 Unscoped 查找软删残留并在重建前物理清理）。
func TestCreateScrapeJobRecreateAfterSoftDelete(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")

	// 先创建一个草稿 Job（change_status=none，可删除）。
	body := `{"job_name":"recreate-me","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","draft_status":"draft","enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var created struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	jobID := strconv.FormatUint(uint64(created.Data.ID), 10)

	// 软删该 Job。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/scrape-jobs/"+jobID, "")
	require.Equal(t, http.StatusOK, w.Code)

	// 重建同名 Job：应 200 成功，而不是 500 internal error。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code, "软删后重建同名 Job 应成功（避免 uniqueIndex 冲突 500）")

	// 活跃同名仍应冲突。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusConflict, w.Code)
}

// F-03：mapping_overrides 持久化——创建时透传落库，GET 列表可读回；
// 更新时修改 mapping_overrides 后读回为新值。
func TestScrapeJobMappingOverridesRoundTrip(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")

	// 创建（草稿路径，仅基础校验）带 mapping_overrides。
	body := `{"job_name":"ov-job","job_type":"standard","network_domain_id":"default","draft_status":"draft","enabled":true,"mapping_overrides":[{"field":"scrape_interval","value":"30s"},{"field":"scheme","value":"https"}]}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var created struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	require.Len(t, created.Data.MappingOverrides, 2)
	assert.Equal(t, models.MappingOverride{Field: "scrape_interval", Value: "30s"}, created.Data.MappingOverrides[0])

	// GET 列表读回持久化值。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs?keyword=ov-job", "")
	require.Equal(t, http.StatusOK, w.Code)
	var list struct {
		Data struct {
			List []models.ScrapeJob `json:"list"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	require.Len(t, list.Data.List, 1)
	require.Len(t, list.Data.List[0].MappingOverrides, 2)
	assert.Equal(t, "https", list.Data.List[0].MappingOverrides[1].Value)

	// 更新 mapping_overrides → 读回为新值（PUT 走完整校验链路，种子用 change_status=none 的
	// 完整合法 Job，避免草稿 Job 参数不全被校验拦截）。
	job := &models.ScrapeJob{
		JobName: "ov-job-2", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)
	w = perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"mapping_overrides":[{"field":"metrics_path","value":"/custom"}]}`)
	require.Equal(t, http.StatusOK, w.Code)
	var updated struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &updated))
	require.Len(t, updated.Data.MappingOverrides, 1)
	assert.Equal(t, models.MappingOverride{Field: "metrics_path", Value: "/custom"}, updated.Data.MappingOverrides[0])

	var reloaded models.ScrapeJob
	require.NoError(t, db.First(&reloaded, job.ID).Error)
	require.Len(t, reloaded.MappingOverrides, 1)
	assert.Equal(t, "metrics_path", reloaded.MappingOverrides[0].Field)
}

// 决策 44-1：change_status=pending 的 job 已挂起待确认变更单，编辑/删除均拒绝（409）。
func TestUpdateDeletePendingJobRejected(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	job := &models.ScrapeJob{
		JobName: "node-pending", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	// 编辑 → 409 conflict，且字段未被修改。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"scrape_interval":"60s"}`)
	require.Equal(t, http.StatusConflict, w.Code)
	var reloaded models.ScrapeJob
	require.NoError(t, db.First(&reloaded, job.ID).Error)
	assert.Equal(t, "15s", reloaded.ScrapeInterval, "pending job 不得被修改")

	// 删除 → 409 conflict，且记录仍在。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/scrape-jobs/"+jobID, "")
	require.Equal(t, http.StatusConflict, w.Code)
	require.NoError(t, db.First(&reloaded, job.ID).Error)
}

func TestInstanceCandidatesHostOfflineGrey(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-online", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-offline", "default", "10.0.1.2", "offline")
	// 另一网域主机应被排除（同网域收敛）。
	seedEnabledDomain(t, db, "other")
	seedHost(t, db, "host-other", "other", "10.0.2.1", "online")

	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?monitor_type=host_linux&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []InstanceCandidate `json:"list"`
			Total int64               `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(2), out.Data.Total, "仅同网域候选")
	for _, it := range out.Data.List {
		if it.ResourceID == "host-offline" {
			assert.True(t, it.Disabled, "offline 置灰 disabled=true")
		}
		if it.ResourceID == "host-online" {
			assert.False(t, it.Disabled)
		}
	}
}

func TestInstanceCandidatesDatabaseSubtypeFilter(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedDatabase(t, db, "db-mysql", "default", "10.0.1.5", "mysql", "online")
	seedDatabase(t, db, "db-redis", "default", "10.0.1.6", "redis", "online")

	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?monitor_type=mysql&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []InstanceCandidate `json:"list"`
			Total int64               `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(1), out.Data.Total, "mysql 子类型过滤")
	assert.Equal(t, "db-mysql", out.Data.List[0].ResourceID)
}

// TestInstanceCandidatesInterfaceServiceByCategory：拨测资源模式候选——以
// resource_category=interface_service 直查（不依赖 monitor_type）；展示名 = api_name、
// 地址 = api_url；keyword 命中 api_name 或 api_url。
func TestInstanceCandidatesInterfaceServiceByCategory(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedInterfaceService(t, db, "is-1", "default", "订单查询", "https://api.example.com/order/health", "online")
	seedInterfaceService(t, db, "is-2", "default", "支付回调", "https://pay.example.com/callback", "online")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online") // 不应出现在接口服务候选里

	var out struct {
		Data struct {
			List  []InstanceCandidate `json:"list"`
			Total int64               `json:"total"`
		} `json:"data"`
	}

	// 全量：仅 2 条接口服务。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?resource_category=interface_service&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, int64(2), out.Data.Total)
	byID := map[string]InstanceCandidate{}
	for _, c := range out.Data.List {
		byID[c.ResourceID] = c
	}
	assert.Equal(t, "订单查询", byID["is-1"].InstanceName, "展示名取 api_name")
	assert.Equal(t, "https://api.example.com/order/health", byID["is-1"].InstanceIP, "地址取 api_url")

	// keyword 命中 api_name。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?resource_category=interface_service&network_domain_id=default&keyword=支付", "")
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "is-2", out.Data.List[0].ResourceID)

	// keyword 命中 api_url。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?resource_category=interface_service&network_domain_id=default&keyword=order/health", "")
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "is-1", out.Data.List[0].ResourceID)
}

// TestInstanceCandidatesCategoryAndMonitorTypePrecedence：monitor_type 与
// resource_category 二选一——都空 400；都给时 resource_category 优先。
func TestInstanceCandidatesCategoryAndMonitorTypePrecedence(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedInterfaceService(t, db, "is-1", "default", "订单查询", "https://api.example.com/health", "online")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

	// 都空 → 400。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?network_domain_id=default", "")
	require.Equal(t, http.StatusBadRequest, w.Code)

	// 都给 → resource_category 优先（返回接口服务，而非 host）。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?monitor_type=host_linux&resource_category=interface_service&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			List  []InstanceCandidate `json:"list"`
			Total int64               `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "is-1", out.Data.List[0].ResourceID)

	// 老路径 monitor_type 回归不变。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/instance-candidates?monitor_type=host_linux&network_domain_id=default", "")
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Equal(t, int64(1), out.Data.Total)
	assert.Equal(t, "host-1", out.Data.List[0].ResourceID)
}

func TestConfirmAndCancelInstallation(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"host-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	// 确认安装。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+jobID+"/instances/host-1/confirm", `{"confirmed_by":"platform_admin"}`)
	require.Equal(t, http.StatusOK, w.Code)

	// 实例列表反映 confirmed。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/"+jobID+"/instances", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			Items []jobInstanceItem `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "confirmed", out.Data.Items[0].Status)

	// review-fix C：confirmed_by 不再信任客户端传参（伪鉴权移除）——请求体携带伪造
	// confirmed_by 会被忽略，操作人从认证上下文当前用户派生；本测试无认证用户，回落 "unknown"。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+jobID+"/instances/host-1/confirm", `{"confirmed_by":"evil"}`)
	require.Equal(t, http.StatusOK, w.Code)
	var cfm struct {
		Data struct {
			ConfirmedBy string `json:"confirmed_by"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &cfm))
	assert.NotEqual(t, "evil", cfm.Data.ConfirmedBy, "客户端伪造 confirmed_by 须被忽略")
	assert.Equal(t, "unknown", cfm.Data.ConfirmedBy, "无认证用户时回落 unknown")

	// 取消确认。
	w = perform(t, r, http.MethodDelete, "/api/v2/platform/scrape-jobs/"+jobID+"/instances/host-1/confirm", "")
	require.Equal(t, http.StatusOK, w.Code)

	// 取消后状态回 unconfirmed。
	w = perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/"+jobID+"/instances", "")
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "unconfirmed", out.Data.Items[0].Status)
}

func TestConfirmInstallationNotInSetRejected(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"host-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)

	// host-2 不在选中集 → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(job.ID), 10)+"/instances/host-2/confirm", `{"confirmed_by":"platform_admin"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
}

// TestListInstancesShowsUnconfirmedWithoutGate（决策 47-1：安装确认拆闸门）：
// 未做任何确认登记的已选实例仍出现在实例列表中（状态 unconfirmed）——确认是可选登记、
// 非生成闸门，未确认实例不被排除。
func TestListInstancesShowsUnconfirmedWithoutGate(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"host-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	// 未确认登记 → 实例仍在列表，状态为 unconfirmed（决策 47-1：不阻断实例展示）。
	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/"+jobID+"/instances", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			Items []jobInstanceItem `json:"items"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "host-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "host-host-1", out.Data.Items[0].InstanceName)
	assert.Equal(t, "10.0.1.1", out.Data.Items[0].InstanceIP)
	assert.Equal(t, "unconfirmed", out.Data.Items[0].Status)
}

// instancesEnvelope 镜像 GET /scrape-jobs/:id/instances 的 data 信封。
// missing_count 为契约增量字段（失效引用数）。
type instancesEnvelope struct {
	Data struct {
		Items        []jobInstanceItem `json:"items"`
		Total        int               `json:"total"`
		MissingCount int               `json:"missing_count"`
	} `json:"data"`
}

// listInstances 请求实例列表并解码信封。
func listInstances(t *testing.T, r *gin.Engine, jobID string) instancesEnvelope {
	t.Helper()
	w := perform(t, r, http.MethodGet, "/api/v2/platform/scrape-jobs/"+jobID+"/instances", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out instancesEnvelope
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return out
}

// newInstanceListJob 建一个手工勾选 host-1/host-2 的标准采集 Job。
func newInstanceListJob(t *testing.T, db *gorm.DB, selected []string) *models.ScrapeJob {
	t.Helper()
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: selected, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	return job
}

// TestListInstancesSkipsSoftDeletedResources（分母口径修复）：
// 资源被 M07 软删后 selected_instance_ids 无人回收，ListJobInstances 不得再把这些
// 失效引用当正常实例返回（否则前端详情页出现无实例名/IP 的空白行，且
// 「在线 x / 总数 y」的分母虚高、与 up 指标聚合的分子不同源、永不收敛）。
// 断言：失效引用不出现在 items、total 只计有效实例、missing_count 暴露失效数。
func TestListInstancesSkipsSoftDeletedResources(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	seedHost(t, db, "host-3", "default", "10.0.1.3", "online")
	job := newInstanceListJob(t, db, []string{"host-1", "host-2", "host-3"})

	// M07 软删 host-2（DeletedAt 置位，selected_instance_ids 仍保留该引用）。
	require.NoError(t, db.Where("resource_id = ?", "host-2").Delete(&models.Host{}).Error)

	out := listInstances(t, r, strconv.FormatUint(uint64(job.ID), 10))

	// 失效引用不进 items：只剩两台真实存在的机器。
	require.Len(t, out.Data.Items, 2)
	assert.Equal(t, 2, out.Data.Total, "total 收敛为有效实例数，与前端 up 分子同源")
	ids := []string{out.Data.Items[0].ResourceID, out.Data.Items[1].ResourceID}
	assert.ElementsMatch(t, []string{"host-1", "host-3"}, ids)
	// 不返回空名/空 IP 的空白行。
	for _, it := range out.Data.Items {
		assert.NotEmpty(t, it.InstanceName, "实例 %s 不得返回空实例名", it.ResourceID)
		assert.NotEmpty(t, it.InstanceIP, "实例 %s 不得返回空 IP", it.ResourceID)
	}
	assert.Equal(t, 1, out.Data.MissingCount, "失效引用数须对外可见（M01 F-39）")
}

// TestListInstancesKeepsValidInstancesWhenOthersDeleted（正常实例不受影响）：
// 部分实例被软删时，仍存在的实例的元信息与安装状态口径不变（不被误过滤、
// 不被降级为 unconfirmed）。
func TestListInstancesKeepsValidInstancesWhenOthersDeleted(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	job := newInstanceListJob(t, db, []string{"host-1", "host-2"})
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	// host-1 已确认安装；随后 host-2 被软删。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+jobID+"/instances/host-1/confirm", `{"confirmed_by":"platform_admin"}`)
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, db.Where("resource_id = ?", "host-2").Delete(&models.Host{}).Error)

	out := listInstances(t, r, jobID)

	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, "host-1", out.Data.Items[0].ResourceID)
	assert.Equal(t, "host-host-1", out.Data.Items[0].InstanceName)
	assert.Equal(t, "10.0.1.1", out.Data.Items[0].InstanceIP)
	assert.Equal(t, "confirmed", out.Data.Items[0].Status, "存活实例的安装状态口径不受软删影响")
	assert.Equal(t, 1, out.Data.Total)
	assert.Equal(t, 1, out.Data.MissingCount)
}

// TestListInstancesAllSelectedDeleted（全部实例失效的边界）：
// 所有已选实例都被软删时 items 为空、total=0，但 missing_count 保留失效数，
// 便于前端区分「Job 没配实例」与「配的实例全被删了」。
func TestListInstancesAllSelectedDeleted(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	job := newInstanceListJob(t, db, []string{"host-1", "host-2"})

	require.NoError(t, db.Where("resource_id = ?", "host-1").Delete(&models.Host{}).Error)
	require.NoError(t, db.Where("resource_id = ?", "host-2").Delete(&models.Host{}).Error)

	out := listInstances(t, r, strconv.FormatUint(uint64(job.ID), 10))

	assert.Empty(t, out.Data.Items)
	assert.Equal(t, 0, out.Data.Total)
	assert.Equal(t, 2, out.Data.MissingCount)
}

// TestListInstancesMissingCountZeroWhenAllValid（无契约回归）：
// 全部实例有效时 missing_count 为 0（新增字段不污染既有正常路径）。
func TestListInstancesMissingCountZeroWhenAllValid(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	job := newInstanceListJob(t, db, []string{"host-1"})

	out := listInstances(t, r, strconv.FormatUint(uint64(job.ID), 10))

	require.Len(t, out.Data.Items, 1)
	assert.Equal(t, 1, out.Data.Total)
	assert.Equal(t, 0, out.Data.MissingCount)
}

func TestPreviewTargetsStandardAndBlackbox(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")

	// standard → 已选实例地址。
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	std := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"host-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(std).Error)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(std.ID), 10)+"/preview-targets", "")
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			Targets []previewTarget `json:"targets"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "10.0.1.1", out.Data.Targets[0].Address)

	// blackbox → 资源模式：目标是所选实例在 target_field 上的值（此处 api_url）。
	seedInterfaceService(t, db, "is-1", "default", "订单查询", "https://api.example.com/health?token=x", "online")
	bb := &models.ScrapeJob{
		JobName: "bb-prod", JobType: models.JobTypeBlackbox, ResourceType: models.ResourceTypeInterfaceService,
		TargetField: "api_url",
		NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual, AuthType: models.AuthTypeNone,
		BlackboxModule: "http_2xx", SelectedInstanceIDs: []string{"is-1"},
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(bb).Error)
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(bb.ID), 10)+"/preview-targets", "")
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "https://api.example.com/health?token=x", out.Data.Targets[0].Address)
	assert.Equal(t, "https", out.Data.Targets[0].Protocol, "协议由 api_url scheme 推导")
	assert.Equal(t, 0, out.Data.Targets[0].Port, "拨测无端口解析概念")
}

// 采集路径 metrics_path 归一（TrimSpace）：路径会被拼进 vmagent 抓取 URL 原样发往
// 被采集端，首尾空白会生成 " http://ip:8081/actuator/prometheus" 这样的非法请求 →
// 被采集应用 404 → 中心 Prometheus up=0 且无业务样本，而用户在界面上看不出差别。
// 因此保存链路必须 trim 后落库；trim 后为空仍按"留空"处理，不得破坏 F-28 层叠默认。
func TestScrapeJobMetricsPathTrimmedOnSave(t *testing.T) {
	t.Run("创建：前导空格被trim 后落库", func(t *testing.T) {
		db := openTestDB(t)
		r := mountRoutes(t, db)
		seedEnabledDomain(t, db, "default")
		require.NoError(t, db.Create(&models.Application{
			ResourceID: "app-1", NetworkDomainID: "default", Status: "online",
			ServiceName: "pay-service", Endpoint: "10.0.1.4", Port: 8081, Protocol: "http",
		}).Error)

		// 复现线上脏数据：采集路径开头多一个空格。
		body := `{"job_name":"test-app-01","job_type":"standard","monitor_type":"application_http","network_domain_id":"default","selected_instance_ids":["app-1"],"metrics_path":" /actuator/prometheus","enabled":true}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var out struct {
			Data models.ScrapeJob `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		assert.Equal(t, "/actuator/prometheus", out.Data.MetricsPath, "接口返回即应为trim 后值")
		// 落库复核：不能只在响应层trim。
		var stored models.ScrapeJob
		require.NoError(t, db.First(&stored, out.Data.ID).Error)
		assert.Equal(t, "/actuator/prometheus", stored.MetricsPath, "数据库中应为trim 后值")
		assert.NotContains(t, stored.MetricsPath, " ", "不应残留任何空白")
	})

	t.Run("创建：纯空白被 application_http 校验拦为 bad_request", func(t *testing.T) {
		db := openTestDB(t)
		r := mountRoutes(t, db)
		seedEnabledDomain(t, db, "default")
		require.NoError(t, db.Create(&models.Application{
			ResourceID: "app-1", NetworkDomainID: "default", Status: "online",
			ServiceName: "pay-service", Endpoint: "10.0.1.4", Port: 8081, Protocol: "http",
		}).Error)

		body := `{"job_name":"app-blank","job_type":"standard","monitor_type":"application_http","network_domain_id":"default","selected_instance_ids":["app-1"],"metrics_path":"   ","enabled":true}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusBadRequest, w.Code, "纯空白应报错而非存空串：%s", w.Body.String())
		// 报错信息须明确指向 metrics_path，避免"含糊"的内部错误。
		assert.Contains(t, w.Body.String(), "metrics_path")
		assert.Contains(t, w.Body.String(), "必须填写采集路径")
		// 不得落库。
		var count int64
		require.NoError(t, db.Model(&models.ScrapeJob{}).Where("job_name = ?", "app-blank").Count(&count).Error)
		assert.Equal(t, int64(0), count, "校验失败不应落库")
	})

	t.Run("创建：留空仍走层叠默认（trim 不改变F-28 语义）", func(t *testing.T) {
		db := openTestDB(t)
		r := mountRoutes(t, db)
		seedEnabledDomain(t, db, "default")
		tmplID := seedExporter(t, db, "node-exporter")
		require.NoError(t, db.Create(&models.CITypeExporterMapping{
			MonitorType: "host_linux", ExporterTemplateID: tmplID, IsDefault: true, DefaultPort: 9100,
			MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "30s", ScrapeTimeout: "20s",
		}).Error)
		seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

		// 完全留空 → 继承映射默认metrics_path。
		body := `{"job_name":"inherit-ok","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["host-1"],"enabled":true}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var out struct {
			Data models.ScrapeJob `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		assert.Equal(t, "/metrics", out.Data.MetricsPath, "留空仍继承映射默认")

		// 纯空白归一后 ≡ 留空 → 同样应继承映射默认，而非被当作显式值。
		body2 := `{"job_name":"inherit-blank","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["host-1"],"metrics_path":"  ","enabled":true}`
		w2 := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body2)
		require.Equal(t, http.StatusOK, w2.Code, w2.Body.String())
		var out2 struct {
			Data models.ScrapeJob `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &out2))
		assert.Equal(t, "/metrics", out2.Data.MetricsPath, "纯空白归一后应等同留空并继承默认")
	})

	t.Run("更新：首随空格均被trim 后落库", func(t *testing.T) {
		db := openTestDB(t)
		r := mountRoutes(t, db)
		seedEnabledDomain(t, db, "default")
		tmplID := seedExporter(t, db, "node-exporter")
		require.NoError(t, db.Create(&models.CITypeExporterMapping{
			MonitorType: "host_linux", ExporterTemplateID: tmplID, IsDefault: true, DefaultPort: 9100,
			MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "30s", ScrapeTimeout: "20s",
		}).Error)
		job := &models.ScrapeJob{
			JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
			MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
			ScrapeInterval: "30s", ScrapeTimeout: "20s", MetricsPath: "/metrics", Scheme: "http",
			AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone, Enabled: true,
		}
		require.NoError(t, db.Create(job).Error)
		jobID := strconv.FormatUint(uint64(job.ID), 10)

		w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"metrics_path":"  /custom-metrics  "}`)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var out struct {
			Data models.ScrapeJob `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
		assert.Equal(t, "/custom-metrics", out.Data.MetricsPath)
		var stored models.ScrapeJob
		require.NoError(t, db.First(&stored, job.ID).Error)
		assert.Equal(t, "/custom-metrics", stored.MetricsPath, "数据库中应为trim 后值")

		// 更新传纯空白 → 归一为空 = 恢复继承（沿用 F-28「清空即继承」语义）。
		w2 := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"metrics_path":"   "}`)
		require.Equal(t, http.StatusOK, w2.Code, w2.Body.String())
		var out2 struct {
			Data models.ScrapeJob `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &out2))
		assert.Equal(t, "/metrics", out2.Data.MetricsPath, "纯空白更新应等同清空并恢复继承")
	})

	t.Run("草稿：创建时即归一，不留待提交生效才纠正", func(t *testing.T) {
		db := openTestDB(t)
		r := mountRoutes(t, db)
		seedEnabledDomain(t, db, "default")
		seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

		body := `{"job_name":"draft-blank","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["host-1"],"metrics_path":" /metrics ","draft_status":"draft"}`
		w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		var stored models.ScrapeJob
		require.NoError(t, db.Where("job_name = ?", "draft-blank").First(&stored).Error)
		assert.Equal(t, "/metrics", stored.MetricsPath, "草稿路径也应trim 后落库")
	})
}

// 采集器联动校验：monitor_type 必须有可用采集器，否则保存时报错，而不是留到运行时
// 才暴露为中心 Prometheus up=0（用户在界面上看不出是配置问题）。
//
// 回归基线：平台内置 6 个采集器模板覆盖 host_linux/host_windows/mysql/redis/kafka/snmp，
// **没有 nginx 模板**，但此前 nginx + 空 exporter_template_id 能静默保存成功。
func TestCreateScrapeJobRejectsMonitorTypeWithoutCollector(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID: "nginx-1", NetworkDomainID: "default", Status: "online",
		MiddlewareType: "nginx", AppName: "nginx-edge", InstanceIP: "10.0.1.9", Port: 80,
	}).Error)

	// 复现线上脏数据 test-nginx-01：nginx + 空采集器模板 + 错误端口 6379。
	body := `{"job_name":"test-nginx-01","job_type":"standard","monitor_type":"nginx","network_domain_id":"default","selected_instance_ids":["nginx-1"],"enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusBadRequest, w.Code, "nginx 无可用采集器应在保存时被拦下")

	// 错误信息须可操作：说清「该类型无可用采集器」+ 当前可用类型 + 两条出路。
	body2 := w.Body.String()
	assert.Contains(t, body2, "nginx")
	assert.Contains(t, body2, "无可用采集器")
	assert.Contains(t, body2, "blackbox", "应引导改用拨测")
	assert.Contains(t, body2, "采集器模板", "应引导登记采集器模板")
	// 不得落库。
	var count int64
	require.NoError(t, db.Model(&models.ScrapeJob{}).Where("job_name = ?", "test-nginx-01").Count(&count).Error)
	assert.Equal(t, int64(0), count, "校验失败不应落库")
}

// 防误伤（最重要的一条）：application_http 走应用自带端点直采（如 springboot
// /actuator/prometheus），本就不需要 exporter，必须允许 exporter_template_id 为空。
// 这是既有设计（validate.go:71-77 注释：应用指标端点没有通用默认值）。
func TestCreateScrapeJobApplicationHTTPAllowsEmptyExporter(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	require.NoError(t, db.Create(&models.Application{
		ResourceID: "app-1", NetworkDomainID: "default", Status: "online",
		ServiceName: "pay-service", Endpoint: "10.0.1.4", Port: 8081, Protocol: "http",
	}).Error)

	// exporter_template_id 留空 + metrics_path 显式填写 → 创建成功。
	body := `{"job_name":"app-prod-ok","job_type":"standard","monitor_type":"application_http","network_domain_id":"default","selected_instance_ids":["app-1"],"metrics_path":"/actuator/prometheus","enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code, "application_http 直采不应被采集器校验误伤：%s", w.Body.String())
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "/actuator/prometheus", out.Data.MetricsPath)
	assert.Empty(t, out.Data.ExporterTemplateID, "直采场景本就无采集器")
}

// 显式选了采集器模板，但该模板声明的 supported_monitor_types 不含该 monitor_type
// → 类型与模板不匹配，保存时报错（与 ci-exporter 的 F-27 C 校验同口径）。
func TestCreateScrapeJobRejectsTemplateMonitorTypeMismatch(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	// node-exporter 只支持 host_linux/host_windows。
	tmplID := seedExporterWithTypes(t, db, "node-exporter", []string{"host_linux", "host_windows"})
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")

	// monitor_type=redis 却选node-exporter → 不匹配。
	body := fmt.Sprintf(`{"job_name":"redis-mismatch","job_type":"standard","monitor_type":"redis","exporter_template_id":"%s","network_domain_id":"default","enabled":true}`, tmplID)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), "supported_monitor_types")
	assert.Contains(t, w.Body.String(), "redis")

	var count int64
	require.NoError(t, db.Model(&models.ScrapeJob{}).Where("job_name = ?", "redis-mismatch").Count(&count).Error)
	assert.Equal(t, int64(0), count, "校验失败不应落库")
}

// 正常组合仍通过：mysql + mysqld-exporter（类型匹配）+ 留空走映射兜底（类型有内置采集器）。
func TestCreateScrapeJobAcceptsMatchingTemplateAndInheritedMapping(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	tmplID := seedExporterWithTypes(t, db, "mysqld-exporter", []string{"mysql"})
	require.NoError(t, db.Create(&models.CITypeExporterMapping{
		MonitorType: "mysql", ExporterTemplateID: tmplID, IsDefault: true, DefaultPort: 9104,
		MetricsPath: "/metrics", Scheme: "http", ScrapeInterval: "15s", ScrapeTimeout: "10s",
	}).Error)

	// 显式选模板 → 类型匹配，放行。
	body := fmt.Sprintf(`{"job_name":"mysql-explicit","job_type":"standard","monitor_type":"mysql","exporter_template_id":"%s","network_domain_id":"default","enabled":true}`, tmplID)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 留空 → 有 is_default 映射兜底 + 内置模板声明支持 mysql，放行。
	body2 := `{"job_name":"mysql-inherited","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","enabled":true}`
	w2 := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body2)
	require.Equal(t, http.StatusOK, w2.Code, w2.Body.String())
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &out))
	assert.Equal(t, "15s", out.Data.ScrapeInterval, "留空仍继承映射默认")
}

// 用户自行登记了支持 nginx 的采集器模板后，nginx 即变为「有可用采集器」→ 放行。
// 这条保证新校验不是死路：平台不内置 nginx 采集器，但用户可自助补齐。
func TestCreateScrapeJobNginxAllowedAfterCollectorRegistered(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	tmplID := seedExporterWithTypes(t, db, "nginx-exporter", []string{"nginx"})
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID: "nginx-1", NetworkDomainID: "default", Status: "online",
		MiddlewareType: "nginx", AppName: "nginx-edge", InstanceIP: "10.0.1.9", Port: 80,
	}).Error)

	body := fmt.Sprintf(`{"job_name":"nginx-registered","job_type":"standard","monitor_type":"nginx","exporter_template_id":"%s","network_domain_id":"default","selected_instance_ids":["nginx-1"],"enabled":true}`, tmplID)
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// 登记后 nginx 也走「留空 = 继承 / 走全局兜底」的统一语义，不因nginx 而特殊化
	// （与 host_linux/mysql 留空即放行保持一致）。
	body2 := `{"job_name":"nginx-unselected","job_type":"standard","monitor_type":"nginx","network_domain_id":"default","selected_instance_ids":["nginx-1"],"enabled":true}`
	w2 := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body2)
	require.Equal(t, http.StatusOK, w2.Code, w2.Body.String())
}

// 更新链路同样受联动校验保护：把已有 job 改成无采集器可用的 monitor_type →拦下。
func TestUpdateScrapeJobRejectsMonitorTypeWithoutCollector(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval: "15s", ScrapeTimeout: "10s", MetricsPath: "/metrics", Scheme: "http",
		AuthType: models.AuthTypeNone, DraftStatus: "ready", ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	jobID := strconv.FormatUint(uint64(job.ID), 10)

	w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID, `{"monitor_type":"nginx"}`)
	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), "无可用采集器")

	// 原值未被改坏。
	var stored models.ScrapeJob
	require.NoError(t, db.First(&stored, job.ID).Error)
	assert.Equal(t, "host_linux", stored.MonitorType, "校验失败不应改库")
}

// 批量提交生效（draft → ready）同样走完整校验，含采集器联动。
func TestBatchSubmitReadyRejectsMonitorTypeWithoutCollector(t *testing.T) {
	db := newBatchTestDB(t)
	seedBatchDomain(t, db)
	j := seedBatchJob(t, db, "nginx-draft", "draft")
	require.NoError(t, db.Model(j).Update("monitor_type", "nginx").Error)

	_, err := BatchSubmitReady(db, []uint{j.ID})
	require.Error(t, err, "nginx 无可用采集器时不应提交生效")
	assert.Contains(t, err.Error(), "无可用采集器")

	var stored models.ScrapeJob
	require.NoError(t, db.First(&stored, j.ID).Error)
	assert.Equal(t, "draft", stored.DraftStatus, "校验失败不应翻转状态")
}

// 失效实例引用不再阻断编辑（根治死锁）：资源在 CMDB 被软删后 selected_instance_ids
// 无人回收，而实例选择器只列存活资源——用户看不到也无法取消勾选失效 ID，编辑任何
// 参数（如 scrape_interval）都会被域校验误拦。保存时应自动回收软删引用。
func TestUpdateScrapeJobReclaimsSoftDeletedInstanceRefs(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	seedHost(t, db, "host-2", "default", "10.0.1.2", "online")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"host-1", "host-2"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusNone, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	// CMDB 软删 host-2：实例选择器从此看不到它，用户无法在 UI 中取消勾选。
	require.NoError(t, db.Delete(&models.Host{}, "resource_id = ?", "host-2").Error)

	// 前端编辑动线原样回传旧 ID，改采集间隔应成功（而不是被失效引用拦下）。
	jobID := strconv.FormatUint(uint64(job.ID), 10)
	w := perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID,
		`{"scrape_interval":"60s","selected_instance_ids":["host-1","host-2"]}`)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var out struct {
		Data struct {
			ScrapeInterval      string   `json:"scrape_interval"`
			SelectedInstanceIDs []string `json:"selected_instance_ids"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "60s", out.Data.ScrapeInterval)
	assert.Equal(t, []string{"host-1"}, out.Data.SelectedInstanceIDs, "保存时应自动回收软删实例引用")

	// 库内同样已回收，后续保存不再带失效引用。
	var stored models.ScrapeJob
	require.NoError(t, db.First(&stored, job.ID).Error)
	assert.Equal(t, []string{"host-1"}, stored.SelectedInstanceIDs)
}

// 跨网域误选的报错带实例名与真实归属网域，不再只抛裸 UUID + 误导性文案
// （旧文案把「实例已删除」也报成「不属于网域」，用户不认识资源 ID）。
func TestCreateScrapeJobCrossDomainRejectionShowsInstanceName(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedEnabledDomain(t, db, "other")
	seedHost(t, db, "r-42", "other", "10.0.9.42", "online")

	body := `{"job_name":"node-prod","job_type":"standard","monitor_type":"host_linux","network_domain_id":"default","selected_instance_ids":["r-42"],"enabled":true}`
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), "host-r-42", "报错应带实例名而非裸 UUID")
	assert.Contains(t, w.Body.String(), "属于网域")
	assert.NotContains(t, w.Body.String(), "不属于网域", "误导性旧文案不应再出现")
}

// 安装确认遇失效引用：Unscoped 复查区分「已删除」与「跨网域」，报已删除 + 实例名。
func TestConfirmInstallationDeletedInstanceReportsDeleted(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")
	seedHost(t, db, "host-1", "default", "10.0.1.1", "online")
	job := &models.ScrapeJob{
		JobName: "node-prod", JobType: models.JobTypeStandard, ResourceType: models.ResourceTypeHost,
		MonitorType: "host_linux", NetworkDomainID: "default", InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs: []string{"host-1"}, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		MetricsPath: "/metrics", Scheme: "http", AuthType: models.AuthTypeNone, DraftStatus: "ready",
		ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(job).Error)
	require.NoError(t, db.Delete(&models.Host{}, "resource_id = ?", "host-1").Error)

	w := perform(t, r, http.MethodPost,
		"/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(job.ID), 10)+"/instances/host-1/confirm",
		`{"confirmed_by":"platform_admin"}`)
	require.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), "已被删除", "应报真实原因：实例已删除")
	assert.Contains(t, w.Body.String(), "host-host-1", "报错应带实例名")
	assert.NotContains(t, w.Body.String(), "不属于网域", "软删不应被误报为跨网域")
}

// TestCreateScrapeJobDurationValidation 覆盖 2026-10-12 诊断：裸数字时长（如 "180"）
// 会留到 promtool check config 才失败（not a valid duration string），必须在保存入口
// 拦为 bad_request；空串合法（F-28 留空=继承层叠默认）。
func TestCreateScrapeJobDurationValidation(t *testing.T) {
	db := openTestDB(t)
	r := mountRoutes(t, db)
	seedEnabledDomain(t, db, "default")

	// 裸数字 scrape_interval → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"dur-bad","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_interval":"180","metrics_path":"/metrics","scheme":"http"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "scrape_interval")

	// 缺单位 scrape_timeout → bad_request。
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"dur-bad2","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_timeout":"10","metrics_path":"/metrics","scheme":"http"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "scrape_timeout")

	// 合法带单位、留空（继承）均放行。
	for i, body := range []string{
		`{"job_name":"dur-ok","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_interval":"180s","scrape_timeout":"10s","metrics_path":"/metrics","scheme":"http"}`,
		`{"job_name":"dur-empty","job_type":"standard","monitor_type":"mysql","network_domain_id":"default","scrape_interval":"","scrape_timeout":"","metrics_path":"/metrics","scheme":"http"}`,
	} {
		w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
		require.Equal(t, http.StatusOK, w.Code, "case %d: %s", i, w.Body.String())
	}
}
