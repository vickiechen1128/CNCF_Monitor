package handler

import (
	"context"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

type fakeMonitoring struct {
	available bool
	impact    references.MonitoringImpact
	retired   []string
	err       error
}

func (f *fakeMonitoring) Available() bool { return f.available }

func (f *fakeMonitoring) Impact(context.Context, string) (references.MonitoringImpact, error) {
	return f.impact, f.err
}

func (f *fakeMonitoring) RetireDomain(_ context.Context, domainID string) error {
	if f.err != nil {
		return f.err
	}
	f.retired = append(f.retired, domainID)
	return nil
}

func newNetworkDomainTestRouter(t *testing.T, user *models.User, monitoring references.MonitoringRetirer) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m06_domain.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		NetworkDomainIDs: []string{"mc-existing", "mc-empty"},
		IsPlatformAdmin:  true, Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", NetworkDomainIDs: []string{"mc-empty"},
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-b", Name: "租户 B", Status: models.TenantStatusSuspended,
	}).Error)

	require.NoError(t, gormDB.Create(&models.CloudDict{
		CloudCode: "aliyun", CloudName: "阿里云",
		CloudType: models.CloudTypePublic, Carrier: models.CloudCarrierTencent, Enabled: true,
	}).Error)
	require.NoError(t, gormDB.Create(&models.CloudDict{
		CloudCode: "disabled-cloud", CloudName: "停用云",
		CloudType: models.CloudTypePublic, Carrier: models.CloudCarrierTencent, Enabled: false,
	}).Error)
	require.NoError(t, gormDB.Create(&models.ZoneType{
		Code: "beijing", DisplayName: "北京分区", Enabled: true,
	}).Error)

	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-existing", Name: "已有采集域", Description: "含资源",
		DomainType: models.DomainTypeEdge, ZoneType: "beijing", CloudCode: "aliyun",
		TenantID: models.PlatformAdminTenantID, AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Channel: models.ChannelTypeAgentPull, Status: models.DomainStatusEnabled,
	}).Error)
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-empty", Name: "空采集域", Description: "可删除",
		DomainType: models.DomainTypeEdge, ZoneType: "beijing", CloudCode: "aliyun",
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID, "tenant-a"},
		Channel:             models.ChannelTypeAgentPull, Token: "secret-token",
		Status: models.DomainStatusEnabled,
	}).Error)

	require.NoError(t, gormDB.Exec(`INSERT INTO resources
		(resource_id, resource_category, tenant_id, network_domain_id, env, status, source_type, dedup_key)
		VALUES ('res-host-1','host','platform_admin','mc-existing','PRD','online','manual','host|mc-existing|10.0.0.1')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
		(resource_id, hostname, instance_ip, os_type) VALUES ('res-host-1','web-01','10.0.0.1','linux')`).Error)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	domainSvc := service.NewNetworkDomainService(
		repository.NewGORMNetworkDomainRepository(gormDB),
		repository.NewGORMDictionaryRepository(gormDB),
		references.NewGORMM07Reader(gormDB),
		monitoring,
	)
	tenantSvc := service.NewTenantService(repository.NewGORMRepository(gormDB))
	RegisterRoutes(router.Group("/api/v3/platform"), NewTenantHandler(tenantSvc), NewNetworkDomainHandler(domainSvc))
	return router, gormDB
}

func TestNetworkDomainCreateAndList(t *testing.T) {
	router, gormDB := newNetworkDomainTestRouter(t, adminUser(), references.NoopMonitoring{})

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/network-domains",
		`{"name":"演示采集域","description":"测试","cloud_code":"aliyun","zone_type":"beijing","domain_code":"demo","authorized_tenant_ids":["platform_admin","tenant-a"]}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "mc-demo", data["id"])
	assert.Equal(t, "演示采集域", data["name"])
	assert.Equal(t, "edge", data["domain_type"])
	assert.Equal(t, "采集节点域", data["domain_type_label"])
	assert.Equal(t, "aliyun", data["cloud_code"])
	assert.Equal(t, "beijing", data["zone_type"])
	assert.Equal(t, models.PlatformAdminTenantID, data["tenant_id"])
	assert.Equal(t, "enabled", data["status"])
	assert.Equal(t, []any{"platform_admin", "tenant-a"}, data["authorized_tenant_ids"])
	assert.NotContains(t, data, "token")
	assert.NotContains(t, data, "channel")
	assert.NotContains(t, data, "agent_type")

	var tenantA models.Tenant
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenantA).Error)
	assert.Equal(t, []string{"mc-demo", "mc-empty"}, tenantA.NetworkDomainIDs)

	// Generated domain_code when omitted.
	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/network-domains",
		`{"name":"随机域","cloud_code":"aliyun","zone_type":"beijing"}`)
	require.Equal(t, http.StatusOK, code, out)
	generated := out["data"].(map[string]any)["id"].(string)
	assert.Regexp(t, regexp.MustCompile(`^mc-[0-9a-f]{8}$`), generated)
	generatedData := out["data"].(map[string]any)
	assert.Equal(t, []any{"platform_admin"}, generatedData["authorized_tenant_ids"],
		"omitted authorizations default to the registering tenant")

	// Name uniqueness is case-insensitive.
	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/network-domains",
		`{"name":"演示采集域","cloud_code":"aliyun","zone_type":"beijing","domain_code":"other"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	// Reusing an id is a conflict (including ids that only differ by name).
	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/network-domains",
		`{"name":"另一个采集域","cloud_code":"aliyun","zone_type":"beijing","domain_code":"demo"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	invalidBodies := []string{
		`{"name":"","cloud_code":"aliyun","zone_type":"beijing"}`,
		`{"name":"缺云","zone_type":"beijing"}`,
		`{"name":"缺分区","cloud_code":"aliyun"}`,
		`{"name":"坏云","cloud_code":"nope","zone_type":"beijing"}`,
		`{"name":"坏分区","cloud_code":"aliyun","zone_type":"nope"}`,
		`{"name":"停用租户","cloud_code":"aliyun","zone_type":"beijing","authorized_tenant_ids":["tenant-b"]}`,
		`{"name":"管理域","cloud_code":"aliyun","zone_type":"beijing","domain_type":"management"}`,
		`{"name":"采集集合域","cloud_code":"aliyun","zone_type":"beijing","domain_type":"collection"}`,
		`{"name":"坏编码","cloud_code":"aliyun","zone_type":"beijing","domain_code":"Bad_Code"}`,
		`{"name":"保留编码","cloud_code":"aliyun","zone_type":"beijing","domain_code":"default"}`,
		`{"name":"客户端归属","cloud_code":"aliyun","zone_type":"beijing","tenant_id":"tenant-a"}`,
		`{"name":"超长描述","cloud_code":"aliyun","zone_type":"beijing","description":"` + strings.Repeat("x", 501) + `"}`,
	}
	for _, body := range invalidBodies {
		code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/network-domains", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out = doRequest(t, router, http.MethodGet,
		"/api/v3/platform/network-domains?status=enabled&keyword=演示&cloud_code=aliyun&zone_type=beijing&page=1&page_size=1", "")
	require.Equal(t, http.StatusOK, code, out)
	listData := out["data"].(map[string]any)
	assert.EqualValues(t, 1, listData["total"])
	assert.EqualValues(t, 1, listData["page"])
	assert.EqualValues(t, 1, listData["page_size"])
	require.Len(t, listData["list"], 1)
	assert.Equal(t, "mc-demo", listData["list"].([]any)[0].(map[string]any)["id"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains?status=bogus", "")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains/mc-demo", "")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "mc-demo", out["data"].(map[string]any)["id"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains/missing", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains/mc-existing/impact", "")
	require.Equal(t, http.StatusOK, code, out)
	impact := out["data"].(map[string]any)
	assert.EqualValues(t, 1, impact["resource_count"])
	assert.Equal(t, false, impact["monitoring_available"])
	assert.Equal(t, false, impact["has_online_agents"])
	assert.EqualValues(t, 0, impact["managed_edge_agent_count"])
	samples := impact["sample_resources"].([]any)
	require.Len(t, samples, 1)
	assert.Equal(t, "res-host-1", samples[0].(map[string]any)["resource_id"])
	assert.Equal(t, "web-01", samples[0].(map[string]any)["name"])
}

func TestNetworkDomainUpdate(t *testing.T) {
	router, gormDB := newNetworkDomainTestRouter(t, adminUser(), references.NoopMonitoring{})

	code, out := doRequest(t, router, http.MethodPut, "/api/v3/platform/network-domains/mc-existing",
		`{"name":"  重命名域  ","description":"已更新","zone_type":"beijing","authorized_tenant_ids":["platform_admin","tenant-a"]}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "重命名域", data["name"])
	assert.Equal(t, "已更新", data["description"])
	assert.Equal(t, []any{"platform_admin", "tenant-a"}, data["authorized_tenant_ids"])

	var tenantA models.Tenant
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenantA).Error)
	assert.Equal(t, []string{"mc-empty", "mc-existing"}, tenantA.NetworkDomainIDs,
		"adding an authorization must rebuild the tenant cache in the same transaction")

	for _, body := range []string{
		`{}`,
		`{"name":"  "}`,
		`{"cloud_code":"other"}`,
		`{"tenant_id":"tenant-a"}`,
		`{"domain_type":"edge"}`,
		`{"id":"mc-x"}`,
		`{"status":"disabled"}`,
		`{"zone_type":"nope"}`,
		`{"authorized_tenant_ids":["tenant-b"]}`,
	} {
		code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/network-domains/mc-existing", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/network-domains/mc-existing",
		`{"name":"空采集域"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/network-domains/missing", `{"name":"x"}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestNetworkDomainStatus(t *testing.T) {
	router, gormDB := newNetworkDomainTestRouter(t, adminUser(), &fakeMonitoring{
		available: true,
		impact:    references.MonitoringImpact{ManagedEdgeAgentCount: 3, HasOnlineAgents: true},
	})

	for _, body := range []string{`{}`, `{"status":""}`, `{"status":"management"}`, `{"status":"bogus"}`, `{"other":"enabled"}`} {
		code, out := doRequest(t, router, http.MethodPatch, "/api/v3/platform/network-domains/mc-existing/status", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out := doRequest(t, router, http.MethodPatch, "/api/v3/platform/network-domains/mc-existing/status",
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "mc-existing", data["id"])
	assert.Equal(t, "disabled", data["status"])
	impact := data["impact"].(map[string]any)
	assert.EqualValues(t, 1, impact["resource_count"])
	assert.EqualValues(t, 3, impact["managed_edge_agent_count"])
	assert.Equal(t, true, impact["has_online_agents"])
	assert.Equal(t, true, impact["monitoring_available"])

	var persisted models.NetworkDomain
	require.NoError(t, gormDB.Where("id = ?", "mc-existing").First(&persisted).Error)
	assert.Equal(t, models.DomainStatusDisabled, persisted.Status)

	// Disabling again stays idempotent and returns the impact.
	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/network-domains/mc-existing/status",
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.NotNil(t, out["data"].(map[string]any)["impact"])

	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/network-domains/mc-existing/status",
		`{"status":"enabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "enabled", out["data"].(map[string]any)["status"])
	assert.NotContains(t, out["data"].(map[string]any), "impact")

	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/network-domains/missing/status",
		`{"status":"disabled"}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestNetworkDomainDelete(t *testing.T) {
	monitoring := &fakeMonitoring{available: true}
	router, gormDB := newNetworkDomainTestRouter(t, adminUser(), monitoring)

	code, out := doRequest(t, router, http.MethodDelete, "/api/v3/platform/network-domains/mc-existing", "")
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])
	assert.Contains(t, out["error"].(string), "1 resource")
	assert.Empty(t, monitoring.retired, "a referenced domain must not be retired")

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/network-domains/mc-empty", "")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "mc-empty", data["id"])
	assert.Equal(t, true, data["deleted"])
	assert.EqualValues(t, 0, data["impact"].(map[string]any)["resource_count"])
	assert.EqualValues(t, 0, data["cascade_impact"].(map[string]any)["resource_count"])
	assert.Equal(t, []string{"mc-empty"}, monitoring.retired)

	var tenantA models.Tenant
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenantA).Error)
	assert.Empty(t, tenantA.NetworkDomainIDs, "deleting a domain must clear tenant authorizations")

	var deleted models.NetworkDomain
	require.NoError(t, gormDB.Unscoped().Where("id = ?", "mc-empty").First(&deleted).Error)
	assert.True(t, deleted.DeletedAt.Valid)
	assert.Empty(t, deleted.Token)
	assert.Equal(t, models.RegistrationStatusRetired, deleted.RegistrationStatus)

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/network-domains/mc-empty", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])

	// A soft-deleted id cannot be re-registered.
	code, out = doRequest(t, router, http.MethodPost, "/api/v3/platform/network-domains",
		`{"name":"重登记空域","cloud_code":"aliyun","zone_type":"beijing","domain_code":"empty"}`)
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doRequest(t, router, http.MethodDelete, "/api/v3/platform/network-domains/missing", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestNetworkDomainReadsAllowUsersButMutationsRequireAdmin(t *testing.T) {
	viewer := &models.User{Role: models.UserRoleUser, Status: models.UserStatusActive}
	router, _ := newNetworkDomainTestRouter(t, viewer, references.NoopMonitoring{})

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains", "")
	require.Equal(t, http.StatusOK, code, out)

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains/mc-existing/impact", "")
	require.Equal(t, http.StatusOK, code, out)

	mutations := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodPost, "/api/v3/platform/network-domains", `{"name":"x","cloud_code":"aliyun","zone_type":"beijing"}`},
		{http.MethodPut, "/api/v3/platform/network-domains/mc-existing", `{"name":"x"}`},
		{http.MethodPatch, "/api/v3/platform/network-domains/mc-existing/status", `{"status":"disabled"}`},
		{http.MethodDelete, "/api/v3/platform/network-domains/mc-empty", ""},
	}
	for _, tc := range mutations {
		code, out = doRequest(t, router, tc.method, tc.path, tc.body)
		assert.Equal(t, http.StatusForbidden, code, "%s %s", tc.method, tc.path)
		assert.Equal(t, "forbidden", out["errorType"], "%s %s", tc.method, tc.path)
	}
}

func TestNetworkDomainErrorEnvelope(t *testing.T) {
	router, _ := newNetworkDomainTestRouter(t, adminUser(), references.NoopMonitoring{})

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/network-domains/missing/impact", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "error", out["status"])
	assert.Equal(t, "not_found", out["errorType"])
	assert.NotEmpty(t, out["error"])
}
