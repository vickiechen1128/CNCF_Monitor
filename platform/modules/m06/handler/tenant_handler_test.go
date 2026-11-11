package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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
	"github.com/metriccenter/metriccenter/platform/modules/m06/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m06/service"
)

func newTenantTestRouter(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m06_tenant.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		IsPlatformAdmin: true, Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", NetworkDomainIDs: []string{"mc-demo"},
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-b", Name: "租户 B", Status: models.TenantStatusSuspended,
	}).Error)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	svc := service.NewTenantService(repository.NewGORMRepository(gormDB))
	RegisterRoutes(router.Group("/api/v3/platform"), NewTenantHandler(svc))
	return router, gormDB
}

func adminUser() *models.User {
	return &models.User{Role: models.UserRoleAdmin, Status: models.UserStatusActive}
}

func doRequest(t *testing.T, router *gin.Engine, method, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return rec.Code, out
}

func TestTenantListAndGet(t *testing.T) {
	router, _ := newTenantTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/tenants?status=active&page=1&page_size=1", "")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 2, data["total"])
	assert.EqualValues(t, 1, data["page"])
	assert.EqualValues(t, 1, data["page_size"])
	assert.Len(t, data["list"], 1)

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/tenants?keyword=tenant-a", "")
	require.Equal(t, http.StatusOK, code)
	data = out["data"].(map[string]any)
	list := data["list"].([]any)
	require.Len(t, list, 1)
	tenant := list[0].(map[string]any)
	assert.Equal(t, "tenant-a", tenant["id"])
	assert.Equal(t, []any{"mc-demo"}, tenant["network_domain_ids"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/tenants/tenant-a", "")
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, "tenant-a", out["data"].(map[string]any)["id"])

	code, out = doRequest(t, router, http.MethodGet, "/api/v3/platform/tenants/missing", "")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestTenantUpdateOnlyMutableFields(t *testing.T) {
	router, gormDB := newTenantTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPut, "/api/v3/platform/tenants/tenant-a",
		`{"name":"  租户 A2  ","multi_site_enabled":true}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, "租户 A2", data["name"])
	assert.Equal(t, true, data["multi_site_enabled"])

	var persisted models.Tenant
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&persisted).Error)
	assert.Equal(t, "租户 A2", persisted.Name)
	assert.True(t, persisted.MultiSiteEnabled)

	for _, body := range []string{
		`{}`,
		`{"network_domain_ids":["other"]}`,
		`{"is_platform_admin":true}`,
		`{"status":"disabled"}`,
		`{"name":"   "}`,
	} {
		code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/tenants/tenant-a", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/tenants/missing", `{"name":"x"}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestTenantLifecycleEndpointsForbidden(t *testing.T) {
	router, _ := newTenantTestRouter(t, adminUser())

	code, out := doRequest(t, router, http.MethodPost, "/api/v3/platform/tenants", `{}`)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])

	code, out = doRequest(t, router, http.MethodPatch, "/api/v3/platform/tenants/tenant-a/status", `{"status":"disabled"}`)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])
}

func TestTenantAdminGateRejectsUsers(t *testing.T) {
	router, _ := newTenantTestRouter(t, &models.User{Role: models.UserRoleUser, Status: models.UserStatusActive})

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/tenants", "")
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])
}
