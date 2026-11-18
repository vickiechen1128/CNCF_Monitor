package m05

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/modules/m05/dto"
	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
)

// newTestDB builds an isolated in-memory v3 database.
//
// `file:name?mode=memory&cache=shared` shares one database between connections
// of the same process, so every test uses a unique name derived from t.Name()
// (without it the suites would leak rows into each other). A keeper *sql.DB is
// opened before migrating because a shared-cache in-memory database is dropped
// as soon as its last connection closes.
func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	name := strings.NewReplacer("/", "_", " ", "_").Replace(t.Name())
	dsn := fmt.Sprintf("file:m05_%s?mode=memory&cache=shared", name)

	keeper, err := sql.Open("sqlite3", dsn+"&_foreign_keys=on")
	require.NoError(t, err)
	// database/sql connects lazily: ping so the shared in-memory database exists
	// before the migration runner opens (and later closes) its own pool.
	require.NoError(t, keeper.Ping())
	t.Cleanup(func() { _ = keeper.Close() })

	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn+"&_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	t.Cleanup(func() {
		sqlDB, err := gormDB.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return gormDB
}

// seedUsersAndSessions creates one admin and one read-only user with live
// sessions, so the real AuthMiddleware / RequireAdmin chain can be exercised.
func seedUsersAndSessions(t *testing.T, gormDB *gorm.DB) (adminToken, viewerToken string) {
	t.Helper()
	require.NoError(t, gormDB.Create(&models.User{
		ID: "user-admin", TenantID: models.PlatformAdminTenantID, Username: "admin",
		PasswordHash: "x", DisplayName: "管理员", Role: models.UserRoleAdmin, Status: models.UserStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.User{
		ID: "user-viewer", TenantID: models.PlatformAdminTenantID, Username: "viewer",
		PasswordHash: "x", DisplayName: "只读用户", Role: models.UserRoleUser, Status: models.UserStatusActive,
	}).Error)

	expires := time.Now().Add(time.Hour)
	require.NoError(t, gormDB.Create(&models.Session{
		ID: "sess-admin", Token: "token-admin", UserID: "user-admin", ExpiresAt: expires,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Session{
		ID: "sess-viewer", Token: "token-viewer", UserID: "user-viewer", ExpiresAt: expires,
	}).Error)
	return "token-admin", "token-viewer"
}

// newTestRouter mounts the M05 module behind the real auth gate.
func newTestRouter(t *testing.T, gormDB *gorm.DB, opts Options) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	module, err := NewModule(gormDB, opts)
	require.NoError(t, err)

	router := gin.New()
	router.Use(auth.AuthMiddleware(auth.NewService(auth.NewRepository(gormDB))))
	require.NoError(t, module.RegisterRoutes(router.Group("/api/v3/platform")))
	return router
}

func doJSON(t *testing.T, router http.Handler, method, path, token, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return rec.Code, out
}

// doSummary decodes the summary envelope into the shared dto.Summary type.
func doSummary(t *testing.T, router http.Handler, token string) (int, dto.Summary) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v3/platform/dashboard/summary", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	var envelope struct {
		Status string            `json:"status"`
		Data   dto.Summary `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope), rec.Body.String())
	return rec.Code, envelope.Data
}

// seedReferenceData inserts the M00/M06 rows the summary and panel tests need.
func seedReferenceData(t *testing.T, gormDB *gorm.DB) {
	t.Helper()
	for _, stmt := range []string{
		`INSERT INTO tenants(id, name, status, is_platform_admin)
			VALUES ('platform_admin', '平台默认租户', 'active', TRUE)`,
		`INSERT INTO network_domains(id, name, domain_type, tenant_id, status, cloud_code)
			VALUES ('dom-1', '生产采集域', 'edge', 'platform_admin', 'enabled', 'PUB-TX')`,
		`INSERT INTO network_domains(id, name, domain_type, tenant_id, status)
			VALUES ('dom-2', '未登记云域', 'edge', 'platform_admin', 'enabled')`,
		// V3-only: monitored state lives in the M09 access record, not on the
		// network_domains row. Only dom-1 is onboarded/monitored.
		`INSERT INTO network_domain_access(domain_id, token_hash, registration_status)
			VALUES ('dom-1', 'seed-hash', 'monitored')`,
		`INSERT INTO cloud_dicts(cloud_code, cloud_name, cloud_type, carrier, enabled)
			VALUES ('PUB-TX', '腾讯云', 'PUB', 'TX', TRUE)`,
		`INSERT INTO application_dicts(app_code, app_name, status)
			VALUES ('order', '订单服务', 'enabled')`,
		`INSERT INTO application_dicts(app_code, app_name, status)
			VALUES ('cache', '缓存服务', 'enabled')`,
		`INSERT INTO application_dicts(app_code, app_name, status)
			VALUES ('snmp', 'SNMP 采集', 'enabled')`,
		`INSERT INTO application_dicts(app_code, app_name, status)
			VALUES ('iface', '接口服务', 'enabled')`,
		`INSERT INTO business_domains(code, name, enabled) VALUES ('payment', '支付业务', TRUE)`,
		`INSERT INTO platform_dicts(platform_code, platform_name, enabled)
			VALUES ('ecommerce', '电商平台', TRUE)`,
		`INSERT INTO app_platform_rels(id, app_code, platform_code, is_primary)
			VALUES ('rel-1', 'order', 'ecommerce', 1)`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
}

// insertResource inserts a shared resource row plus its category extension row.
func insertResource(t *testing.T, gormDB *gorm.DB, id, category, domainID, appCode, bizCode, platformCode, subtype string) {
	t.Helper()
	require.NoError(t, gormDB.Exec(`INSERT INTO resources(
		resource_id, resource_category, tenant_id, network_domain_id, biz_code, app_code,
		platform_code, env, status, source_type, dedup_key
	) VALUES (?, ?, 'platform_admin', ?, ?, ?, ?, 'PRD', 'online', 'manual', ?)`,
		id, category, domainID, nullIfEmpty(bizCode), nullIfEmpty(appCode), nullIfEmpty(platformCode), id,
	).Error)

	switch category {
	case "host":
		require.NoError(t, gormDB.Exec(`INSERT INTO host_resources(resource_id, hostname, instance_ip, os_type)
			VALUES (?, ?, ?, ?)`, id, id, "10.0.0.1", subtype).Error)
	case "database":
		require.NoError(t, gormDB.Exec(`INSERT INTO database_resources(resource_id, database_type, instance_ip, port)
			VALUES (?, ?, '10.0.0.2', 3306)`, id, subtype).Error)
	case "middleware":
		require.NoError(t, gormDB.Exec(`INSERT INTO middleware_resources(resource_id, middleware_type, instance_ip, port)
			VALUES (?, ?, '10.0.0.3', 6379)`, id, subtype).Error)
	case "generic_target":
		require.NoError(t, gormDB.Exec(`INSERT INTO generic_target_resources(
			resource_id, target_name, instance_ip, port, exporter_type)
			VALUES (?, ?, '10.0.0.4', 9100, ?)`, id, id, subtype).Error)
	case "application":
		require.NoError(t, gormDB.Exec(`INSERT INTO application_resources(resource_id, service_name, health_check_url)
			VALUES (?, ?, ?)`, id, id, "https://"+id+".example.com/health").Error)
	case "interface_service":
		require.NoError(t, gormDB.Exec(`INSERT INTO interface_service_resources(resource_id, api_name, api_url)
			VALUES (?, ?, ?)`, id, "接口"+id, "https://"+id+".example.com/api").Error)
	}
}

// insertJob inserts one m01_scrape_jobs row.
func insertJob(t *testing.T, gormDB *gorm.DB, id, jobType, domainID, selectedJSON string, enabled bool, draftStatus string) {
	t.Helper()
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs(
		id, job_name, job_type, resource_category, network_domain_id,
		selected_instance_ids, enabled, draft_status
	) VALUES (?, ?, ?, 'host', ?, ?, ?, ?)`,
		id, id, jobType, domainID, selectedJSON, enabled, draftStatus,
	).Error)
}

func nullIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// TestRoutesRequireAuthenticationAndAdmin proves the 401 / 403 split: reads are
// authenticated-only, panel mutations are admin-only.
func TestRoutesRequireAuthenticationAndAdmin(t *testing.T) {
	gormDB := newTestDB(t)
	adminToken, viewerToken := seedUsersAndSessions(t, gormDB)
	router := newTestRouter(t, gormDB, Options{})

	for _, path := range []string{
		"/api/v3/platform/dashboard/summary",
		"/api/v3/platform/dashboard/panels",
		"/api/v3/platform/dashboard/panels/1",
	} {
		code, out := doJSON(t, router, http.MethodGet, path, "", "")
		assert.Equal(t, http.StatusUnauthorized, code, path)
		assert.Equal(t, "unauthorized", out["errorType"], path)
	}

	// Authenticated normal user: reads pass, writes are forbidden.
	code, _ := doSummary(t, router, viewerToken)
	assert.Equal(t, http.StatusOK, code)
	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/dashboard/panels", viewerToken, "")
	assert.Equal(t, http.StatusOK, code)
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/dashboard/panels", viewerToken,
		`{"name":"只读用户面板","url":"http://grafana.example.com/d/ro"}`)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])

	// Admin can write.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/dashboard/panels", adminToken,
		`{"name":"节点监控大屏","url":"http://grafana.example.com/d/node"}`)
	require.Equal(t, http.StatusOK, code, out)
}

// TestSummaryEmptyDatabase asserts the empty-library payload shape.
func TestSummaryEmptyDatabase(t *testing.T) {
	gormDB := newTestDB(t)
	adminToken, _ := seedUsersAndSessions(t, gormDB)
	router := newTestRouter(t, gormDB, Options{})

	code, summary := doSummary(t, router, adminToken)
	require.Equal(t, http.StatusOK, code)

	assert.Equal(t, 0, summary.ResourceCount)
	assert.Equal(t, 0, summary.MonitoredCount)
	assert.Equal(t, 0, summary.ScrapeJobCount)
	assert.Equal(t, 0, summary.ScrapeJobEnabledCount)
	assert.Equal(t, 0, summary.DomainCount)
	require.Len(t, summary.ByCategory, 6)
	for _, category := range summary.ByCategory {
		assert.NotNil(t, category.BySubtype, "by_subtype must be [] not null")
	}
	assert.NotNil(t, summary.ByApp)
	assert.NotNil(t, summary.ProbeTargets)
	assert.NotNil(t, summary.ByPlatformApp)
	assert.NotNil(t, summary.ByCloud)
	assert.Nil(t, summary.CollectionHealth, "no PromURL injected: field omitted")
}

// TestSummaryAggregatesCoversResourcesJobsAndDictionaries is the end-to-end
// aggregate test over the real v3 schema.
func TestSummaryAggregatesCoversResourcesJobsAndDictionaries(t *testing.T) {
	gormDB := newTestDB(t)
	adminToken, _ := seedUsersAndSessions(t, gormDB)
	seedReferenceData(t, gormDB)

	insertResource(t, gormDB, "host-1", "host", "dom-1", "order", "payment", "ecommerce", "linux")
	insertResource(t, gormDB, "host-2", "host", "dom-2", "", "", "", "windows")
	insertResource(t, gormDB, "db-1", "database", "dom-1", "order", "payment", "", "mysql")
	insertResource(t, gormDB, "mw-1", "middleware", "dom-1", "cache", "", "", "redis")
	insertResource(t, gormDB, "gt-1", "generic_target", "dom-1", "snmp", "", "", "snmp")
	insertResource(t, gormDB, "app-1", "application", "dom-1", "order", "", "ecommerce", "")
	insertResource(t, gormDB, "if-1", "interface_service", "dom-1", "iface", "", "", "")
	insertResource(t, gormDB, "host-del", "host", "dom-1", "", "", "", "linux")
	require.NoError(t, gormDB.Exec(
		`UPDATE resources SET deleted_at = CURRENT_TIMESTAMP WHERE resource_id = 'host-del'`).Error)

	// Effective job set: ready+enabled only. job-disabled / job-draft must not
	// contribute to the monitored set, and the deleted host must be dropped.
	insertJob(t, gormDB, "job-std", "standard", "dom-1", `["host-1","db-1","host-del"]`, true, "ready")
	insertJob(t, gormDB, "job-bb", "blackbox", "dom-1", `["if-1","app-1"]`, true, "ready")
	insertJob(t, gormDB, "job-disabled", "standard", "dom-1", `["mw-1"]`, false, "ready")
	insertJob(t, gormDB, "job-draft", "standard", "dom-1", `["gt-1"]`, true, "draft")

	router := newTestRouter(t, gormDB, Options{})
	code, summary := doSummary(t, router, adminToken)
	require.Equal(t, http.StatusOK, code)

	assert.Equal(t, 7, summary.ResourceCount)
	assert.Equal(t, 4, summary.MonitoredCount)
	assert.Equal(t, 4, summary.ScrapeJobCount)
	assert.Equal(t, 3, summary.ScrapeJobEnabledCount)
	assert.Equal(t, 1, summary.DomainCount, "only dom-1 has a monitored network_domain_access record")

	// by_category: fixed six, subtypes only for the four subtype categories.
	byCategory := make(map[string]dto.CategorySummary, len(summary.ByCategory))
	for _, category := range summary.ByCategory {
		byCategory[category.ResourceCategory] = category
	}
	host := byCategory["host"]
	assert.Equal(t, 2, host.ResourceCount, "soft-deleted host is excluded")
	assert.Equal(t, 1, host.MonitoredCount)
	require.Len(t, host.BySubtype, 2)
	assert.Equal(t, "linux", host.BySubtype[0].Subtype)
	assert.Equal(t, 1, host.BySubtype[0].ResourceCount)
	assert.Equal(t, 1, host.BySubtype[0].MonitoredCount)
	assert.Equal(t, "windows", host.BySubtype[1].Subtype)
	assert.Equal(t, 0, host.BySubtype[1].MonitoredCount)
	assert.Equal(t, 1, byCategory["database"].ResourceCount)
	assert.Equal(t, 1, byCategory["database"].MonitoredCount)
	assert.Equal(t, "mysql", byCategory["database"].BySubtype[0].Subtype)
	assert.Equal(t, "redis", byCategory["middleware"].BySubtype[0].Subtype)
	assert.Equal(t, "snmp", byCategory["generic_target"].BySubtype[0].Subtype)
	assert.Empty(t, byCategory["application"].BySubtype)
	assert.Empty(t, byCategory["interface_service"].BySubtype)

	// by_app: dictionary name + majority biz attribution; unclassified bucket.
	byApp := make(map[string]dto.AppSummary, len(summary.ByApp))
	for _, app := range summary.ByApp {
		byApp[app.AppCode] = app
	}
	order := byApp["order"]
	assert.Equal(t, "订单服务", order.AppName)
	assert.Equal(t, "payment", order.BizCode)
	assert.Equal(t, "支付业务", order.BizName)
	assert.Equal(t, 3, order.ResourceCount)
	assert.Equal(t, 3, order.MonitoredCount)
	assert.Equal(t, "缓存服务", byApp["cache"].AppName)
	assert.Equal(t, "", byApp["cache"].BizCode, "unclassified business keeps both biz fields empty")
	assert.Equal(t, 1, summary.UnclassifiedResourceCount)
	assert.Equal(t, 0, summary.UnclassifiedMonitoredCount)

	// by_cloud: host only, derived from the network domain; 未指定云 last.
	require.Len(t, summary.ByCloud, 2)
	assert.Equal(t, "PUB-TX", summary.ByCloud[0].CloudCode)
	assert.Equal(t, "腾讯云", summary.ByCloud[0].CloudName)
	assert.Equal(t, 1, summary.ByCloud[0].ResourceCount)
	assert.Equal(t, 1, summary.ByCloud[0].MonitoredCount)
	assert.Equal(t, 100, summary.ByCloud[0].CoverageRate)
	assert.Equal(t, "", summary.ByCloud[1].CloudCode)
	assert.Equal(t, "未指定云", summary.ByCloud[1].CloudName)
	assert.Equal(t, 1, summary.ByCloud[1].ResourceCount)
	assert.Equal(t, 0, summary.ByCloud[1].CoverageRate)

	// by_platform_app: host only; 未指定平台 last.
	require.Len(t, summary.ByPlatformApp, 2)
	assert.Equal(t, "ecommerce", summary.ByPlatformApp[0].PlatformCode)
	assert.Equal(t, "电商平台", summary.ByPlatformApp[0].PlatformName)
	assert.Equal(t, 1, summary.ByPlatformApp[0].HostCount)
	assert.Equal(t, "未指定平台", summary.ByPlatformApp[1].PlatformName)

	// probe_targets: blackbox targets only, status unknown, last_probe_at nil.
	assert.Equal(t, 2, summary.ProbeTargetCount)
	assert.Equal(t, 0, summary.ProbeTargetAbnormalCount)
	byTarget := make(map[string]dto.ProbeTargetItem, len(summary.ProbeTargets))
	for _, target := range summary.ProbeTargets {
		byTarget[target.URL] = target
	}
	iface := byTarget["https://if-1.example.com/api"]
	assert.Equal(t, "interface_service", iface.ResourceCategory)
	assert.Equal(t, "接口if-1", iface.ServiceName)
	assert.Equal(t, "", iface.PlatformNames)
	assert.Equal(t, "生产采集域", iface.NetworkDomainName)
	assert.Equal(t, "", iface.Status)
	assert.Nil(t, iface.LastProbeAt)

	app := byTarget["https://app-1.example.com/health"]
	assert.Equal(t, "application", app.ResourceCategory)
	assert.Equal(t, "订单服务", app.ServiceName)
	assert.Equal(t, "电商平台", app.PlatformNames)
	assert.Equal(t, "", app.Status)
	assert.Nil(t, app.LastProbeAt)
}

// TestSummaryCollectionHealthInjected proves Options.UpHealthQuerier wiring and
// the degrade path.
func TestSummaryCollectionHealthInjected(t *testing.T) {
	gormDB := newTestDB(t)
	adminToken, _ := seedUsersAndSessions(t, gormDB)
	seedReferenceData(t, gormDB)
	insertResource(t, gormDB, "host-1", "host", "dom-1", "", "", "", "linux")
	insertResource(t, gormDB, "host-2", "host", "dom-1", "", "", "", "linux")
	insertJob(t, gormDB, "job-1", "standard", "dom-1", `["host-1","host-2"]`, true, "ready")

	index := domain.NewUpHealthIndex(map[string]bool{"host-1": true}, map[string]bool{"host-2": true})
	router := newTestRouter(t, gormDB, Options{UpHealthQuerier: fixedQuerier{index: index}})

	code, summary := doSummary(t, router, adminToken)
	require.Equal(t, http.StatusOK, code)
	require.NotNil(t, summary.CollectionHealth)
	assert.Equal(t, 2, summary.CollectionHealth.DispatchedCount)
	assert.Equal(t, 1, summary.CollectionHealth.CollectingCount)
	assert.Equal(t, 0, summary.CollectionHealth.PartialCollectingCount)
	assert.Equal(t, 1, summary.CollectionHealth.DownCount)
}

// fixedQuerier is a domain.UpHealthQuerier returning a preset index / error.
type fixedQuerier struct {
	index *domain.UpHealthIndex
	err   error
}

func (q fixedQuerier) UpHealth(context.Context) (*domain.UpHealthIndex, error) {
	if q.err != nil {
		return nil, q.err
	}
	return q.index, nil
}

// TestPanelCRUD covers create / list / get / update, validation, conflicts and
// the paging envelope.
func TestPanelCRUD(t *testing.T) {
	gormDB := newTestDB(t)
	adminToken, viewerToken := seedUsersAndSessions(t, gormDB)
	router := newTestRouter(t, gormDB, Options{})

	// Empty list keeps the envelope shape and returns [].
	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/dashboard/panels", viewerToken, "")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]any)
	assert.Equal(t, []any{}, data["list"])
	assert.EqualValues(t, 0, data["total"])
	assert.EqualValues(t, 1, data["page"])
	assert.EqualValues(t, 20, data["page_size"])

	// Create.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/dashboard/panels", adminToken,
		`{"name":"节点监控大屏","url":"http://grafana.example.com/d/node"}`)
	require.Equal(t, http.StatusOK, code, out)
	created := out["data"].(map[string]any)
	assert.EqualValues(t, 1, created["id"])
	assert.Equal(t, "节点监控大屏", created["name"])
	assert.Equal(t, "http://grafana.example.com/d/node", created["url"])
	assert.NotEmpty(t, created["created_at"])
	assert.NotEmpty(t, created["updated_at"])
	createdAt := created["created_at"]

	panelID := created["id"].(float64)

	// Duplicate name is a 409.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/dashboard/panels", adminToken,
		`{"name":"节点监控大屏","url":"http://grafana.example.com/d/other"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	// Validation: empty name, bad scheme, non-Grafana path.
	for _, body := range []string{
		`{"name":"  ","url":"http://grafana.example.com/d/x"}`,
		`{"name":"x","url":""}`,
		`{"name":"x","url":"ftp://grafana.example.com/d/x"}`,
		`{"name":"x","url":"http://grafana.example.com/foo"}`,
	} {
		code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/dashboard/panels", adminToken, body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	// Read by id.
	code, out = doJSON(t, router, http.MethodGet,
		fmt.Sprintf("/api/v3/platform/dashboard/panels/%d", int(panelID)), viewerToken, "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "节点监控大屏", out["data"].(map[string]any)["name"])

	// Second panel, then rename the first: list is ordered by updated_at DESC.
	code, out = doJSON(t, router, http.MethodPost, "/api/v3/platform/dashboard/panels", adminToken,
		`{"name":"数据库监控大屏","url":"http://grafana.example.com/d/db"}`)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doJSON(t, router, http.MethodPut,
		fmt.Sprintf("/api/v3/platform/dashboard/panels/%d", int(panelID)), adminToken,
		`{"name":"节点监控大屏（改）","url":"http://grafana.example.com/d/node-v2"}`)
	require.Equal(t, http.StatusOK, code, out)
	updated := out["data"].(map[string]any)
	assert.Equal(t, "节点监控大屏（改）", updated["name"])
	assert.Equal(t, "http://grafana.example.com/d/node-v2", updated["url"])
	assert.Equal(t, createdAt, updated["created_at"], "created_at is immutable")

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dashboard/panels?page=1&page_size=20", viewerToken, "")
	require.Equal(t, http.StatusOK, code)
	list := out["data"].(map[string]any)["list"].([]any)
	require.Len(t, list, 2)
	assert.Equal(t, "节点监控大屏（改）", list[0].(map[string]any)["name"], "most recently updated first")
	assert.EqualValues(t, 2, out["data"].(map[string]any)["total"])

	// Renaming onto an existing name conflicts; unknown IDs are 404.
	code, out = doJSON(t, router, http.MethodPut,
		fmt.Sprintf("/api/v3/platform/dashboard/panels/%d", int(panelID)), adminToken,
		`{"name":"数据库监控大屏","url":"http://grafana.example.com/d/db"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/dashboard/panels/9999", adminToken,
		`{"name":"不存在","url":"http://grafana.example.com/d/none"}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dashboard/panels/9999", viewerToken, "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dashboard/panels/abc", viewerToken, "")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	// page_size is capped at 100 and defaults are applied.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/dashboard/panels?page_size=1000", viewerToken, "")
	require.Equal(t, http.StatusOK, code)
	assert.EqualValues(t, 100, out["data"].(map[string]any)["page_size"])
	assert.EqualValues(t, 1, out["data"].(map[string]any)["page"])
}
