package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/configgen"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

func newArtifactTestStack(t *testing.T, user *models.User) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	gormDB := testdb.Open(t)
	var err error

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		NetworkDomainIDs: []string{"mc-a"}, IsPlatformAdmin: true,
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", NetworkDomainIDs: []string{"mc-a"},
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains
		(id, name, domain_type, zone_type, cloud_code, tenant_id, authorized_tenant_ids, status)
		VALUES ('mc-a', '域 mc-a', 'edge', 'beijing', 'aliyun', 'platform_admin', '["platform_admin"]', 'enabled')`).Error)

	repo := repository.NewGORMRepository(gormDB)
	onboarding := service.NewOnboardingService(repo, repo)
	store := storage.NewContentStore(t.TempDir())
	syncSvc := service.NewConfigSyncService(repo, stubSource{}, store,
		stubValidator{result: configgen.ValidationResult{Status: "passed", Cause: "none", Details: "[]"}})
	_, err = syncSvc.SyncDomain(context.Background(), "mc-a")
	require.NoError(t, err)

	center := &configgen.Artifacts{
		Version: "20261117-cccc", Checksum: "sum-center",
		PrometheusYML: "global: {}\nrule_files:\n  - rules.yml\n",
		RulesYML:      "groups:\n  - name: center\n",
	}
	_, err = store.WriteArtifacts(repository.ArtifactTypeCenterKey, center.Version, center)
	require.NoError(t, err)
	require.NoError(t, gormDB.Exec(`INSERT INTO config_snapshots
		(scope, scope_key, version, checksum, content, validation_status, validation_cause, is_current, generated_by, created_at)
		VALUES ('center', 'center', ?, ?, '', 'passed', 'none', TRUE, 'system', ?)`,
		center.Version, center.Checksum, time.Now().UTC()).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO config_snapshots
		(scope, scope_key, version, checksum, content, validation_status, validation_cause, is_current, generated_by, created_at)
		VALUES ('alertmanager', 'alertmanager', 'am-20261117-dddd', 'sum-am', 'route:\n  receiver: web\n', 'passed', 'none', TRUE, 'admin', ?)`,
		time.Now().UTC()).Error)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterPlatformRoutes(router.Group("/api/v3/platform"), Handlers{
		Onboarding: NewOnboardingHandler(onboarding),
		Artifacts:  NewArtifactHandler(onboarding, service.NewArtifactService(repo, store)),
	})
	return router, gormDB
}

func TestConfigArtifactListAndExportEndpoints(t *testing.T) {
	router, gormDB := newArtifactTestStack(t, adminUser())

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/config-artifacts")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 3, data["total"])
	types := map[string]bool{}
	var domainID, centerID, amID int64
	for _, raw := range data["list"].([]any) {
		item := raw.(map[string]any)
		types[item["artifact_type"].(string)] = true
		switch item["artifact_type"] {
		case "domain":
			domainID = int64(item["id"].(float64))
		case "center":
			centerID = int64(item["id"].(float64))
		case "alertmanager":
			amID = int64(item["id"].(float64))
		}
	}
	assert.True(t, types["domain"])
	assert.True(t, types["center"])
	assert.True(t, types["alertmanager"])

	// Domain filter narrows to one artifact family.
	code, out = doJSON(t, router, http.MethodGet,
		"/api/v3/platform/config-artifacts?network_domain_id=mc-a")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["total"])

	// Detail + preview (admin).
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/config-artifacts/"+itoa(domainID))
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "domain", out["data"].(map[string]any)["artifact_type"])

	code, out = doJSON(t, router, http.MethodGet,
		"/api/v3/platform/config-artifacts/"+itoa(centerID)+"/content")
	require.Equal(t, http.StatusOK, code, out)
	files := out["data"].(map[string]any)["files"].([]any)
	require.NotEmpty(t, files)
	assert.Equal(t, "prometheus.yml", files[0].(map[string]any)["name"])

	// Domain export is a zip; center/alertmanager exports are YAML files.
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/v3/platform/config-artifacts/"+itoa(domainID)+"/export", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/zip", rec.Header().Get("Content-Type"))
	_, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	require.NoError(t, err)

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/v3/platform/config-artifacts/"+itoa(centerID)+"/export", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "yaml")
	assert.Contains(t, rec.Body.String(), "groups:")

	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/v3/platform/config-artifacts/"+itoa(amID)+"/export", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "yaml")
	assert.Contains(t, rec.Body.String(), "receiver: web")

	// Recovery bundle contains the four groups + manifest.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet,
		"/api/v3/platform/config-artifacts/recovery-bundle", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	reader, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	require.NoError(t, err)
	entries := map[string]bool{}
	for _, entry := range reader.File {
		entries[entry.Name] = true
	}
	assert.True(t, entries["prometheus.yml"])
	assert.True(t, entries["rules.yml"])
	assert.True(t, entries["alertmanager.yml"])
	assert.True(t, entries["manifest.json"])

	_ = gormDB
}

func TestConfigArtifactViewerCanListButNotReadContent(t *testing.T) {
	router, _ := newArtifactTestStack(t, viewerUser())

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/config-artifacts")
	require.Equal(t, http.StatusOK, code, out)
	var id int64
	for _, raw := range out["data"].(map[string]any)["list"].([]any) {
		item := raw.(map[string]any)
		id = int64(item["id"].(float64))
		break
	}

	code, out = doJSON(t, router, http.MethodGet,
		"/api/v3/platform/config-artifacts/"+itoa(id)+"/content")
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])

	code, _ = doJSON(t, router, http.MethodGet,
		"/api/v3/platform/config-artifacts/"+itoa(id)+"/export")
	assert.Equal(t, http.StatusForbidden, code)
}

func TestConfigArtifactInvalidFilter(t *testing.T) {
	router, _ := newArtifactTestStack(t, adminUser())
	code, out := doJSON(t, router, http.MethodGet,
		"/api/v3/platform/config-artifacts?artifact_type=nope")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])
}
