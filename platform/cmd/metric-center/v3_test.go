package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
	m06 "github.com/metriccenter/metriccenter/platform/modules/m06"
	"github.com/metriccenter/metriccenter/platform/modules/m06/references"
)

// businessDomainsTestPath points at the shared seed template consumed by v3
// seed tests. It lives in platform/config (a shared config tree, not legacy).
const businessDomainsTestPath = "../../config/business_domains.yaml"

func TestSetupV3RouterMountsSystemM06M07(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_router.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	hash, err := bcrypt.GenerateFromPassword([]byte("viewer123"), bcrypt.DefaultCost)
	require.NoError(t, err)
	require.NoError(t, gormDB.Create(&models.User{
		ID: "user-viewer", TenantID: models.PlatformAdminTenantID, Username: "viewer",
		PasswordHash: string(hash), DisplayName: "只读用户",
		Role: models.UserRoleUser, Status: models.UserStatusActive,
	}).Error)

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router(context.Background(), "", m06.Options{})
	require.NoError(t, err)

	cases := []struct {
		path string
		want int
	}{
		{"/api/v3/platform/health", http.StatusOK},
		{"/api/v3/platform/ready", http.StatusOK},
		{"/api/v3/platform/meta", http.StatusOK},
		// Business routes stay behind the global auth gate.
		{"/api/v3/platform/resources", http.StatusUnauthorized},
		// M01 configurable monitor type registry (SRS Module_01 v1.3 §5.6).
		{"/api/v3/platform/monitor-types", http.StatusUnauthorized},
		{"/api/v3/platform/monitor-types/scope-fields", http.StatusUnauthorized},
		// M07 generic capability attributes (SRS Module_07 v2.1 §5.8).
		{"/api/v3/platform/attribute-definitions", http.StatusUnauthorized},
		{"/api/v3/platform/tenants", http.StatusUnauthorized},
		{"/api/v3/platform/network-domains", http.StatusUnauthorized},
		// M09 platform routes are behind the same global user-auth gate.
		{"/api/v3/platform/edge-agents", http.StatusUnauthorized},
		// M05 dashboard reads are authenticated (writes are admin-only).
		{"/api/v3/platform/dashboard/summary", http.StatusUnauthorized},
		{"/api/v3/platform/dashboard/panels", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		assert.Equal(t, tc.want, rec.Code, tc.path)
		assert.NotEmpty(t, rec.Header().Get("X-Request-ID"), "request id header on %s", tc.path)
	}

	anonRec := httptest.NewRecorder()
	router.ServeHTTP(anonRec, httptest.NewRequest(http.MethodPost, "/api/v3/platform/network-domains",
		strings.NewReader(`{"name":"x"}`)))
	assert.Equal(t, http.StatusUnauthorized, anonRec.Code, "mutations are behind the global auth gate")

	metaRec := httptest.NewRecorder()
	router.ServeHTTP(metaRec, httptest.NewRequest(http.MethodGet, "/api/v3/platform/meta", nil))
	var meta struct {
		Data struct {
			Modules []string `json:"modules"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(metaRec.Body.Bytes(), &meta))
	assert.Equal(t, []string{"system", "m06", "m07", "m01", "m09", "m08", "m05", "auth"}, meta.Data.Modules)

	// M09 edge protocol is token-only: the global user-auth gate is bypassed
	// for /api/v3/edge/*, so this 401 comes from EdgeTokenMiddleware.
	edgeRec := httptest.NewRecorder()
	router.ServeHTTP(edgeRec, httptest.NewRequest(http.MethodPost, "/api/v3/edge/heartbeat", nil))
	assert.Equal(t, http.StatusUnauthorized, edgeRec.Code, "edge heartbeat without token must be 401")

	// Login is anonymous on the v3 prefix, and its token unlocks M07 routes.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/auth/login",
		strings.NewReader(`{"username":"admin","password":"admin123"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &login))
	require.NotEmpty(t, login.Data.Token)

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/resources?resource_category=host", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/tenants", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/network-domains", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// M05 dashboard summary is readable by any authenticated user on the v3 line
	// (it replaces /api/v2/platform/dashboard/summary for the v3-only frontend).
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/dashboard/summary", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/dashboard/panels", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// M01 boots the configurable monitor type registry: the built-in types are
	// ensured on bootstrap and listed through the API (SRS Module_01 v1.3 §5.6).
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/monitor-types", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var monitorTypes struct {
		Data struct {
			List []struct {
				Code             string `json:"code"`
				ResourceCategory string `json:"resource_category"`
				IsBuiltin        bool   `json:"is_builtin"`
			} `json:"list"`
			Total int `json:"total"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &monitorTypes))
	assert.NotEmpty(t, monitorTypes.Data.List, "built-in monitor types must be seeded on bootstrap")
	codes := make([]string, 0, len(monitorTypes.Data.List))
	for _, item := range monitorTypes.Data.List {
		codes = append(codes, item.Code)
		assert.True(t, item.IsBuiltin, "seeded types are built in: %s", item.Code)
	}
	assert.Contains(t, codes, "host_linux")
	assert.Contains(t, codes, "host_npu")

	// M07 exposes the generic capability dictionary (empty until a key is
	// registered, which must not require a schema change).
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/attribute-definitions", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// A normal user is authenticated but forbidden from the admin surface.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v3/platform/auth/login",
		strings.NewReader(`{"username":"viewer","password":"viewer123"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &login))

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/tenants", nil)
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())

	// Panel mutations are admin-only: an authenticated non-admin gets 403.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "/api/v3/platform/dashboard/panels",
		strings.NewReader(`{"name":"只读用户面板","url":"http://grafana.example.com/d/ro"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+login.Data.Token)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code, rec.Body.String())
}

func v3LoginToken(t *testing.T, router http.Handler, username, password string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/auth/login",
		strings.NewReader(`{"username":"`+username+`","password":"`+password+`"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &login))
	require.NotEmpty(t, login.Data.Token)
	return login.Data.Token
}

func TestV3UserDisableInvalidatesSession(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_user_session.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router(context.Background(), "", m06.Options{})
	require.NoError(t, err)

	adminToken := v3LoginToken(t, router, "admin", "admin123")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/users",
		strings.NewReader(`{"username":"ops01","display_name":"运维一号","password":"secret123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var created struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	require.NotEmpty(t, created.Data.ID)

	opsToken := v3LoginToken(t, router, "ops01", "secret123")
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/resources?resource_category=host", nil)
	req.Header.Set("Authorization", "Bearer "+opsToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPatch, "/api/v3/platform/users/"+created.Data.ID+"/status",
		strings.NewReader(`{"status":"disabled"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/resources?resource_category=host", nil)
	req.Header.Set("Authorization", "Bearer "+opsToken)
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code, "disabling a user must invalidate existing sessions")
}

func TestV3StorageRoutesUseInjectedOptions(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_storage.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	router, err := setupV3Router(context.Background(), "", m06.Options{EnvFile: envFile})
	require.NoError(t, err)
	adminToken := v3LoginToken(t, router, "admin", "admin123")

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v3/platform/storage-logs", nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPut, "/api/v3/platform/storage-logs/retention",
		strings.NewReader(`{"time":"30d","size":"20GB"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+adminToken)
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	content, err := os.ReadFile(envFile)
	require.NoError(t, err)
	assert.Contains(t, string(content), "PROM_RETENTION_TIME=30d")
}

type fakeMonitoringRetirer struct {
	retired []string
}

func (f *fakeMonitoringRetirer) Available() bool { return true }

func (f *fakeMonitoringRetirer) Impact(context.Context, string) (references.MonitoringImpact, error) {
	return references.MonitoringImpact{}, nil
}

func (f *fakeMonitoringRetirer) RetireDomain(_ context.Context, domainID string) error {
	f.retired = append(f.retired, domainID)
	return nil
}

func doV3JSON(t *testing.T, router http.Handler, method, path, token, body string) (int, map[string]any) {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
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

func TestV3M06EndToEndDomainLifecycle(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_m06_e2e.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", Status: models.TenantStatusActive,
	}).Error)

	retirer := &fakeMonitoringRetirer{}
	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router(context.Background(), "", m06.Options{Monitoring: retirer})
	require.NoError(t, err)
	adminToken := v3LoginToken(t, router, "admin", "admin123")

	code, out := doV3JSON(t, router, http.MethodPost, "/api/v3/platform/network-domains", adminToken,
		`{"name":"端到端采集域","description":"e2e","cloud_code":"PUB-TX","domain_code":"e2e","authorized_tenant_ids":["platform_admin","tenant-a"]}`)
	require.Equal(t, http.StatusOK, code, out)
	domainID := out["data"].(map[string]any)["id"].(string)
	assert.Equal(t, "mc-e2e", domainID)

	var tenantA models.Tenant
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenantA).Error)
	assert.Equal(t, []string{"mc-e2e"}, tenantA.NetworkDomainIDs)

	// V3-only: runtime identity lives in network_domain_access (M09), not in a
	// legacy column on network_domains. Seed an access row so the M09 onboarding
	// view has the domain's monitored state.
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domain_access
		(domain_id, token_hash, registration_status) VALUES (?, 'agent-secret-hash', 'monitored')`,
		domainID).Error)

	code, out = doV3JSON(t, router, http.MethodPost, "/api/v3/platform/resources", adminToken,
		`{"resource_category":"host","network_domain_id":"mc-e2e","env":"PRD","attributes":{"hostname":"web-e2e","instance_ip":"10.0.0.10","os_type":"linux"}}`)
	require.Equal(t, http.StatusOK, code, out)
	resourceID := out["data"].(map[string]any)["resource_id"].(string)

	code, out = doV3JSON(t, router, http.MethodDelete, "/api/v3/platform/network-domains/"+domainID, adminToken, "")
	require.Equal(t, http.StatusConflict, code, out)
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doV3JSON(t, router, http.MethodPatch, "/api/v3/platform/network-domains/"+domainID+"/status", adminToken,
		`{"status":"disabled"}`)
	require.Equal(t, http.StatusOK, code, out)
	impact := out["data"].(map[string]any)["impact"].(map[string]any)
	assert.EqualValues(t, 1, impact["resource_count"])

	code, out = doV3JSON(t, router, http.MethodPost, "/api/v3/platform/resources", adminToken,
		`{"resource_category":"host","network_domain_id":"mc-e2e","env":"PRD","attributes":{"hostname":"web-e2e-2","instance_ip":"10.0.0.11","os_type":"linux"}}`)
	assert.Equal(t, http.StatusBadRequest, code, out)
	assert.Equal(t, "bad_request", out["errorType"])

	code, out = doV3JSON(t, router, http.MethodDelete, "/api/v3/platform/resources/"+resourceID, adminToken, "")
	require.Equal(t, http.StatusOK, code, out)

	code, out = doV3JSON(t, router, http.MethodDelete, "/api/v3/platform/network-domains/"+domainID, adminToken, "")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, true, data["deleted"])
	assert.EqualValues(t, 0, data["cascade_impact"].(map[string]any)["resource_count"])
	assert.Equal(t, []string{domainID}, retirer.retired)

	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenantA).Error)
	assert.Empty(t, tenantA.NetworkDomainIDs, "domain deletion must clear tenant authorizations")

	var deleted models.NetworkDomain
	require.NoError(t, gormDB.Unscoped().Where("id = ?", domainID).First(&deleted).Error)
	assert.True(t, deleted.DeletedAt.Valid)
	// Legacy onboarding state (token / registration_status) was dropped from
	// network_domains in V3-only; M09 owns it in network_domain_access.

	var orphanResources int64
	require.NoError(t, gormDB.Raw(`SELECT count(*) FROM resources r
		LEFT JOIN network_domains d ON d.id = r.network_domain_id AND d.deleted_at IS NULL
		WHERE r.deleted_at IS NULL AND d.id IS NULL`).Scan(&orphanResources).Error)
	assert.Zero(t, orphanResources)
}

// TestV3CloudDictMaintenanceEndToEnd covers D37 across the real v3 router:
// M07 serves the read list, M06 owns create/disable, and normal users stay
// read-only. It also proves the M06 write routes do not duplicate the M07 GET
// route (Gin would panic at setup time).
func TestV3CloudDictMaintenanceEndToEnd(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "v3_cloud_dict_e2e.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomainsTestPath))

	hash, err := bcrypt.GenerateFromPassword([]byte("viewer123"), bcrypt.DefaultCost)
	require.NoError(t, err)
	require.NoError(t, gormDB.Create(&models.User{
		ID: "user-cloud-viewer", TenantID: models.PlatformAdminTenantID, Username: "cloud-viewer",
		PasswordHash: string(hash), DisplayName: "云字典只读用户",
		Role: models.UserRoleUser, Status: models.UserStatusActive,
	}).Error)

	prev := db.DB
	db.DB = gormDB
	t.Cleanup(func() { db.DB = prev })

	router, err := setupV3Router(context.Background(), "", m06.Options{})
	require.NoError(t, err)
	adminToken := v3LoginToken(t, router, "admin", "admin123")

	code, out := doV3JSON(t, router, http.MethodGet, "/api/v3/platform/cloud-dict", adminToken, "")
	require.Equal(t, http.StatusOK, code, out)
	list := out["data"].(map[string]any)["list"].([]any)
	require.NotEmpty(t, list)

	code, out = doV3JSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict", adminToken,
		`{"cloud_code":"IND-CM","cloud_name":"行业云（移动）","cloud_type":"IND","carrier":"CM","description":"e2e"}`)
	require.Equal(t, http.StatusOK, code, out)
	created := out["data"].(map[string]any)
	assert.Equal(t, "IND-CM", created["cloud_code"])
	assert.Equal(t, true, created["enabled"], "new entries are enabled by default")

	code, out = doV3JSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict", adminToken,
		`{"cloud_code":"IND-CM","cloud_name":"重复","cloud_type":"IND","carrier":"CM"}`)
	require.Equal(t, http.StatusConflict, code, out)
	assert.Equal(t, "conflict", out["errorType"])

	code, out = doV3JSON(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/IND-CM", adminToken,
		`{"enabled":true}`)
	require.Equal(t, http.StatusBadRequest, code, out)

	code, out = doV3JSON(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/IND-CM", adminToken,
		`{"enabled":false}`)
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, false, out["data"].(map[string]any)["enabled"])

	// A cloud referenced by a live network domain cannot be disabled.
	code, out = doV3JSON(t, router, http.MethodPost, "/api/v3/platform/network-domains", adminToken,
		`{"name":"云字典引用域","cloud_code":"GM-CU","domain_code":"dict-e2e"}`)
	require.Equal(t, http.StatusOK, code, out)
	code, out = doV3JSON(t, router, http.MethodPut, "/api/v3/platform/cloud-dict/GM-CU", adminToken,
		`{"enabled":false}`)
	require.Equal(t, http.StatusConflict, code, out)
	assert.Equal(t, "conflict", out["errorType"])

	// Normal users can read the dictionary but cannot maintain it.
	viewerToken := v3LoginToken(t, router, "cloud-viewer", "viewer123")
	code, out = doV3JSON(t, router, http.MethodGet, "/api/v3/platform/cloud-dict", viewerToken, "")
	require.Equal(t, http.StatusOK, code, out)
	code, out = doV3JSON(t, router, http.MethodPost, "/api/v3/platform/cloud-dict", viewerToken,
		`{"cloud_code":"PRI-TX","cloud_name":"私有云","cloud_type":"PRI","carrier":"TX"}`)
	require.Equal(t, http.StatusForbidden, code, out)
	assert.Equal(t, "forbidden", out["errorType"])
}
