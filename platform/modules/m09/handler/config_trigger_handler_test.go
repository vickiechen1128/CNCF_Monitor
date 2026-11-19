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
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/references"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

func newConfigTriggerRouter(t *testing.T, user *models.User) *gin.Engine {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m09_config_trigger.db")
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
		require.NoError(t, gormDB.Exec(`INSERT INTO network_domains
			(id, name, domain_type, zone_type, cloud_code, tenant_id, authorized_tenant_ids, status)
			VALUES (?, ?, 'edge', 'beijing', 'aliyun', 'platform_admin', ?, 'enabled')`,
			id, "域 "+id, `["platform_admin"]`).Error)
	}

	repo := repository.NewGORMRepository(gormDB)
	onboarding := service.NewOnboardingService(repo, repo)
	validator := stubValidator{result: configgen.ValidationResult{Status: "passed", Cause: "none", Details: "[]"}}
	syncSvc := service.NewConfigSyncService(repo, stubSource{},
		storage.NewContentStore(t.TempDir()), validator)
	centerSvc := service.NewCenterRulesService(
		repository.NewCenterSnapshotRepository(gormDB),
		references.NewCenterRuleSource(gormDB),
		nil,
		t.TempDir(),
		nil,
	)
	centerSvc.SetValidator(validator)
	triggerSvc := service.NewConfigTriggerService(syncSvc, centerSvc, onboarding)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterPlatformRoutes(router.Group("/api/v3/platform"), Handlers{
		Onboarding: NewOnboardingHandler(onboarding),
		Trigger:    NewConfigTriggerHandler(triggerSvc),
	})
	return router
}

func doTriggerJSON(t *testing.T, router *gin.Engine, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v3/platform/config-sync/trigger", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return rec.Code, out
}

func TestConfigTriggerEndpointWaitsAndReturnsResult(t *testing.T) {
	router := newConfigTriggerRouter(t, adminUser())

	code, out := doTriggerJSON(t, router, `{"scope":"domain","network_domain_ids":["mc-a"],"wait":true}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, true, data["accepted"])
	assert.Equal(t, true, data["completed"])
	domains := data["domains"].([]any)
	require.Len(t, domains, 1)
	domain := domains[0].(map[string]any)
	assert.Equal(t, "mc-a", domain["network_domain_id"])
	assert.Equal(t, "passed", domain["validation_status"])
}

func TestConfigTriggerEndpointRejectsInvalidInput(t *testing.T) {
	router := newConfigTriggerRouter(t, adminUser())

	code, out := doTriggerJSON(t, router, `{"scope":"bogus"}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])

	code, out = doTriggerJSON(t, router, `{"scope":"domain","network_domain_ids":[]}`)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])
}

func TestConfigTriggerEndpointHonorsDomainAuthorization(t *testing.T) {
	router := newConfigTriggerRouter(t, viewerUser())

	code, out := doTriggerJSON(t, router, `{"scope":"domain","network_domain_ids":["mc-a"]}`)
	require.Equal(t, http.StatusOK, code, out)

	code, out = doTriggerJSON(t, router, `{"scope":"domain","network_domain_ids":["mc-b"]}`)
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])

	code, out = doTriggerJSON(t, router, `{"scope":"center"}`)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])
}

func TestConfigTriggerEndpointAsyncIsAccepted(t *testing.T) {
	router := newConfigTriggerRouter(t, adminUser())

	code, out := doTriggerJSON(t, router, `{"scope":"domain","network_domain_ids":["mc-a"]}`)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, true, data["accepted"])
	assert.Equal(t, false, data["completed"])
}
