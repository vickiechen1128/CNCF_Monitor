package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

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
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
	"github.com/metriccenter/metriccenter/platform/modules/m09/storage"
)

type stubSource struct{}

func (stubSource) BuildSource(_ context.Context, domainID string) (configgen.Source, error) {
	return configgen.Source{
		NetworkDomainID: domainID,
		Jobs: []configgen.Job{{
			Name:    "node",
			Targets: []configgen.Target{{Instance: "10.0.0.1:9100"}},
		}},
	}, nil
}

func (stubSource) Fingerprint(_ context.Context, _ string) (time.Time, error) {
	return time.Time{}, nil
}

func (stubSource) EdgeDomainIDs(_ context.Context) ([]string, error) { return nil, nil }

type stubValidator struct {
	result configgen.ValidationResult
}

func (s stubValidator) Validate(_ context.Context, _ *configgen.Artifacts) configgen.ValidationResult {
	return s.result
}

func newSnapshotTestStack(t *testing.T, user *models.User) (*gin.Engine, *service.ConfigSyncService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m09_snapshot.db")
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
	onboarding := service.NewOnboardingService(repo, repo)
	syncSvc := service.NewConfigSyncService(repo, stubSource{},
		storage.NewContentStore(t.TempDir()),
		stubValidator{result: configgen.ValidationResult{Status: "passed", Cause: "none", Details: "[]"}})
	_, err = syncSvc.SyncDomain(context.Background(), "mc-a")
	require.NoError(t, err)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterPlatformRoutes(router.Group("/api/v3/platform"), Handlers{
		Onboarding: NewOnboardingHandler(onboarding),
		Snapshots:  NewSnapshotHandler(onboarding, syncSvc),
	})
	return router, syncSvc
}

func TestConfigSnapshotReadEndpoints(t *testing.T) {
	router, _ := newSnapshotTestStack(t, adminUser())

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/network-domains/mc-a/config-snapshots")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 1, data["total"])
	snapshot := data["list"].([]any)[0].(map[string]any)
	assert.Equal(t, true, snapshot["is_current"])
	assert.Equal(t, "passed", snapshot["validation_status"])
	id := int64(snapshot["id"].(float64))

	code, out = doJSON(t, router, http.MethodGet,
		"/api/v3/platform/network-domains/mc-a/config-snapshots/"+itoa(id))
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, true, out["data"].(map[string]any)["is_current"])

	// Content is returned raw (admin only).
	req := httptest.NewRequest(http.MethodGet,
		"/api/v3/platform/network-domains/mc-a/config-snapshots/"+itoa(id)+"/content", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), "network_domain_id: mc-a")
	assert.Contains(t, rec.Header().Get("Content-Disposition"), ".json")

	code, out = doJSON(t, router, http.MethodGet,
		"/api/v3/platform/network-domains/mc-a/config-snapshots/99999")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestConfigSnapshotContentRequiresAdminAndScope(t *testing.T) {
	viewerRouter, _ := newSnapshotTestStack(t, viewerUser())
	code, out := doJSON(t, viewerRouter, http.MethodGet, "/api/v3/platform/network-domains/mc-a/config-snapshots")
	require.Equal(t, http.StatusOK, code, out)
	id := int64(out["data"].(map[string]any)["list"].([]any)[0].(map[string]any)["id"].(float64))

	// Viewers can list/detail but not download content (admin).
	code, out = doJSON(t, viewerRouter, http.MethodGet,
		"/api/v3/platform/network-domains/mc-a/config-snapshots/"+itoa(id)+"/content")
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])

	// Unauthorized domain is 404 (tenant-a only owns mc-a).
	code, _ = doJSON(t, viewerRouter, http.MethodGet, "/api/v3/platform/network-domains/mc-b/config-snapshots")
	assert.Equal(t, http.StatusNotFound, code)
}

func TestNoConfirmationOrRollbackRoutes(t *testing.T) {
	router, _ := newSnapshotTestStack(t, adminUser())
	for _, route := range router.Routes() {
		path := strings.ToLower(route.Path)
		for _, forbidden := range []string{"confirm", "rollback", "restore", "revalidate", "discard", "deployments"} {
			assert.NotContains(t, path, forbidden, "route %s %s must not exist", route.Method, route.Path)
		}
	}
}

func TestEdgeConfigPullETagAndMissing(t *testing.T) {
	_, syncSvc := newSnapshotTestStack(t, adminUser())
	h := &EdgeHandler{sync: syncSvc}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/api/v3/edge/config", func(c *gin.Context) {
		c.Set(ContextNetworkDomainKey, "mc-a")
		c.Next()
	}, h.Config)
	router.GET("/api/v3/edge/config-empty", func(c *gin.Context) {
		c.Set(ContextNetworkDomainKey, "mc-b")
		c.Next()
	}, h.Config)

	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v3/edge/config", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	etag := rec.Header().Get("ETag")
	require.NotEmpty(t, etag)
	assert.Equal(t, "application/zip", rec.Header().Get("Content-Type"))

	// The body is a zip package containing prometheus.yml + metadata.json.
	reader, err := zip.NewReader(bytes.NewReader(rec.Body.Bytes()), int64(rec.Body.Len()))
	require.NoError(t, err)
	var prometheus string
	hasMetadata := false
	for _, entry := range reader.File {
		if entry.Name == "metadata.json" {
			hasMetadata = true
		}
		if entry.Name != "prometheus.yml" {
			continue
		}
		handle, err := entry.Open()
		require.NoError(t, err)
		raw, err := io.ReadAll(handle)
		require.NoError(t, err)
		_ = handle.Close()
		prometheus = string(raw)
	}
	assert.True(t, hasMetadata)
	assert.Contains(t, prometheus, "network_domain_id: mc-a")

	req := httptest.NewRequest(http.MethodGet, "/api/v3/edge/config", nil)
	req.Header.Set("If-None-Match", etag)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotModified, rec.Code)

	// A domain without a published snapshot returns 404 with an actionable message.
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v3/edge/config-empty", nil))
	require.Equal(t, http.StatusNotFound, rec.Code)
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Equal(t, "not_found", out["errorType"])
}
