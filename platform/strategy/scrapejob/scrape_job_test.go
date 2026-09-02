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

func seedHost(t *testing.T, db *gorm.DB, resourceID, domainID, ip, status string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID: resourceID, ServerID: resourceID, ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID: domainID, BizCode: "infra", SourceType: models.SourceTypeManual,
		InstanceName: "host-" + resourceID, Status: status, Region: "cn", ZoneEnv: "dev",
		InstanceSpec: "2c4g", Image: "linux", VPC: "vpc", SecurityGroup: "sg", PrivateIP: ip,
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

	// blackbox 缺 module/targets → bad_request。
	w := perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs",
		`{"job_name":"bb-bad","job_type":"blackbox","network_domain_id":"default"}`)
	require.Equal(t, http.StatusBadRequest, w.Code)

	// blackbox 合法：monitor_type/exporter 置空。
	body := `{"job_name":"bb-ok","job_type":"blackbox","network_domain_id":"default","blackbox_module":"http_2xx","blackbox_targets":[{"target":"api.example.com","protocol":"http"}]}`
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs", body)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data models.ScrapeJob `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, "http_2xx", out.Data.BlackboxModule)
	assert.Len(t, out.Data.BlackboxTargets, 1)
	assert.Equal(t, models.BlackboxTargetProtocolHTTP, out.Data.BlackboxTargets[0].Protocol)
	assert.Empty(t, out.Data.MonitorType, "blackbox 任务 monitor_type 置空")
	assert.Empty(t, out.Data.ExporterTemplateID, "blackbox 任务 exporter 置空")
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

	// standard → blackbox（带拨测字段）：monitor_type/exporter 清空、job_type 切换。
	w = perform(t, r, http.MethodPut, "/api/v2/platform/scrape-jobs/"+jobID,
		`{"job_type":"blackbox","blackbox_module":"http_2xx","blackbox_targets":[{"target":"api.example.com","protocol":"http"}]}`)
	require.Equal(t, http.StatusOK, w.Code)
	var out struct {
		Data struct {
			JobType        models.JobType `json:"job_type"`
			MonitorType    string         `json:"monitor_type"`
			BlackboxModule string         `json:"blackbox_module"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	assert.Equal(t, string(models.JobTypeBlackbox), string(out.Data.JobType))
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
	assert.Equal(t, "unconfirmed", out.Data.Items[0].Status)
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

	// blackbox → targets。
	bb := &models.ScrapeJob{
		JobName: "bb-prod", JobType: models.JobTypeBlackbox, NetworkDomainID: "default",
		InstanceSelectionMode: models.InstanceSelectionManual, AuthType: models.AuthTypeNone,
		BlackboxModule: "http_2xx", BlackboxTargets: []models.BlackboxTarget{{Target: "api.example.com", Protocol: models.BlackboxTargetProtocolHTTP}},
		DraftStatus: "ready", ChangeStatus: models.ChangeStatusPending, Enabled: true,
	}
	require.NoError(t, db.Create(bb).Error)
	w = perform(t, r, http.MethodPost, "/api/v2/platform/scrape-jobs/"+strconv.FormatUint(uint64(bb.ID), 10)+"/preview-targets", "")
	require.Equal(t, http.StatusOK, w.Code)
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	require.Len(t, out.Data.Targets, 1)
	assert.Equal(t, "api.example.com", out.Data.Targets[0].Address)
	assert.Equal(t, "http", out.Data.Targets[0].Protocol)
}
