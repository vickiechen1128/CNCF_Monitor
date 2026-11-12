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
	m09refs "github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func newOnboardingRouter(t *testing.T, user *models.User) *gin.Engine {
	t.Helper()
	router, _ := newOnboardingRouterWithDB(t, user)
	return router
}

func newOnboardingRouterWithDB(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m09_handler.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		NetworkDomainIDs: []string{"mc-a", "mc-b"}, IsPlatformAdmin: true,
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", NetworkDomainIDs: []string{"mc-a"},
		Status: models.TenantStatusActive,
	}).Error)
	for _, id := range []string{"mc-a", "mc-b"} {
		require.NoError(t, gormDB.Create(&models.NetworkDomain{
			ID: id, Name: "域 " + id, DomainType: models.DomainTypeEdge,
			ZoneType: "beijing", CloudCode: "aliyun",
			TenantID:            models.PlatformAdminTenantID,
			AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
			Channel:             models.ChannelTypeAgentPull,
			Status:              models.DomainStatusEnabled,
		}).Error)
	}

	repo := repository.NewGORMRepository(gormDB)
	svc := service.NewOnboardingService(repo, repo)
	syncSvc := service.NewConfigSyncService(repo, m09refs.NewGORMSourceReader(gormDB),
		storage.NewContentStore(t.TempDir()), nil)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterPlatformRoutes(router.Group("/api/v3/platform"), Handlers{
		Onboarding: NewOnboardingHandler(svc),
		Snapshots:  NewSnapshotHandler(svc, syncSvc),
	})
	return router, gormDB
}

func doJSON(t *testing.T, router *gin.Engine, method, path string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(""))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return rec.Code, out
}

func adminUser() *models.User {
	return &models.User{ID: "u-admin", TenantID: models.PlatformAdminTenantID, Role: models.UserRoleAdmin, Status: models.UserStatusActive}
}

func viewerUser() *models.User {
	return &models.User{ID: "u-viewer", TenantID: "tenant-a", Role: models.UserRoleUser, Status: models.UserStatusActive}
}

func TestOnboardingMonitorResetUnmonitor(t *testing.T) {
	router := newOnboardingRouter(t, adminUser())
	base := "/api/v3/platform/network-domains/mc-a"

	code, out := doJSON(t, router, http.MethodPost, base+"/monitor")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	plain := data["token"].(string)
	assert.NotEmpty(t, plain)
	assert.Equal(t, "monitored", data["registration_status"])
	assert.NotEmpty(t, data["token_masked"])
	assert.NotContains(t, data["token_masked"], plain)
	assert.NotEmpty(t, data["install_guide"].(map[string]any)["steps"])

	// Detail never exposes the plaintext token.
	code, out = doJSON(t, router, http.MethodGet, base)
	require.Equal(t, http.StatusOK, code, out)
	detail := out["data"].(map[string]any)
	assert.Equal(t, "monitored", detail["registration_status"])
	assert.NotContains(t, detail, "token")

	// Duplicate monitor is a conflict.
	code, out = doJSON(t, router, http.MethodPost, base+"/monitor")
	assert.Equal(t, http.StatusConflict, code)
	assert.Equal(t, "conflict", out["errorType"])

	// Reset issues a different token.
	code, out = doJSON(t, router, http.MethodPost, base+"/token/reset")
	require.Equal(t, http.StatusOK, code, out)
	reset := out["data"].(map[string]any)
	assert.NotEqual(t, plain, reset["token"])

	// Unmonitor returns the domain to created.
	code, out = doJSON(t, router, http.MethodDelete, base+"/monitor")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "created", out["data"].(map[string]any)["registration_status"])
}

func TestOnboardingListEnvelopeAndValidation(t *testing.T) {
	router := newOnboardingRouter(t, adminUser())

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains?page=1&page_size=10")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 2, data["total"])
	assert.EqualValues(t, 1, data["page"])
	assert.EqualValues(t, 10, data["page_size"])
	require.Len(t, data["list"], 2)
	first := data["list"].([]any)[0].(map[string]any)
	assert.Equal(t, "created", first["registration_status"])
	assert.NotContains(t, first, "token")

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains?registration_status=bogus")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains/missing")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestOnboardingAdminViewExposesAdministrativeFields(t *testing.T) {
	router, gormDB := newOnboardingRouterWithDB(t, adminUser())
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-disabled", Name: "停用域", Description: "停用域说明",
		DomainType: models.DomainTypeEdge, ZoneType: "beijing", CloudCode: "aliyun",
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID, "tenant-a"},
		Channel:             models.ChannelTypeAgentPull,
		Status:              models.DomainStatusDisabled,
	}).Error)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains?view=admin")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 3, data["total"])
	var disabled map[string]any
	for _, raw := range data["list"].([]any) {
		item := raw.(map[string]any)
		if item["network_domain_id"] == "mc-disabled" {
			disabled = item
		}
	}
	require.NotNil(t, disabled, "admin view includes disabled domains")
	assert.Equal(t, "disabled", disabled["status"])
	assert.Equal(t, "edge", disabled["domain_type"])
	assert.Equal(t, "采集节点域", disabled["domain_type_label"])
	assert.Equal(t, "停用域说明", disabled["description"])
	assert.Equal(t, models.PlatformAdminTenantID, disabled["tenant_id"])
	assert.Equal(t, []any{models.PlatformAdminTenantID, "tenant-a"}, disabled["authorized_tenant_ids"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains?status=disabled")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	// The default view stays on the onboarding scope.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 2, out["data"].(map[string]any)["total"])

	for _, query := range []string{
		"view=bogus",
		"view=onboarding&status=disabled",
		"status=bogus",
	} {
		code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains?"+query)
		assert.Equal(t, http.StatusBadRequest, code, query)
		assert.Equal(t, "bad_request", out["errorType"], query)
	}
}

func TestOnboardingAdminViewRequiresAdmin(t *testing.T) {
	router := newOnboardingRouter(t, viewerUser())
	for _, query := range []string{"view=admin", "status=disabled"} {
		code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains?"+query)
		assert.Equal(t, http.StatusForbidden, code, query)
		assert.Equal(t, "forbidden", out["errorType"], query)
	}
}

func TestOnboardingNonEdgeScopeAndAdminGate(t *testing.T) {
	router := newOnboardingRouter(t, viewerUser())

	// A tenant user sees only authorized domains.
	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 1, data["total"])
	assert.Equal(t, "mc-a", data["list"].([]any)[0].(map[string]any)["network_domain_id"])

	// Unauthorized domain is 404 (not 403), avoiding existence disclosure.
	code, _ = doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains/mc-b")
	assert.Equal(t, http.StatusNotFound, code)

	// Mutations require admin.
	for _, tc := range []struct {
		method string
		path   string
	}{
		{http.MethodPost, "/api/v3/platform/network-domains/mc-a/monitor"},
		{http.MethodPost, "/api/v3/platform/network-domains/mc-a/token/reset"},
		{http.MethodDelete, "/api/v3/platform/network-domains/mc-a/monitor"},
	} {
		code, out = doJSON(t, router, tc.method, tc.path)
		assert.Equal(t, http.StatusForbidden, code, "%s %s", tc.method, tc.path)
		assert.Equal(t, "forbidden", out["errorType"])
	}
}
