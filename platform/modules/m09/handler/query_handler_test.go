package handler

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
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
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

func newQueryRouter(t *testing.T, user *models.User, promURL string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m09_query.db")
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
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-a", Name: "域 mc-a", DomainType: models.DomainTypeEdge,
		ZoneType: "beijing", CloudCode: "aliyun", TenantID: models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Channel:             models.ChannelTypeAgentPull, Status: models.DomainStatusEnabled,
	}).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO edge_target_snapshots
		(network_domain_id, job, instance, resource_id, health, last_report_at)
		VALUES ('mc-a','node','10.0.0.1:9100','r-1','up',?)`, time.Now().UTC()).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO resources
		(resource_id, resource_category, tenant_id, network_domain_id, env, status, source_type, scrape_port, dedup_key)
		VALUES ('r-1','host',?,'mc-a','PRD','online','manual',9100,'host|mc-a|r-1')`,
		models.PlatformAdminTenantID).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
		(resource_id, hostname, instance_ip, os_type) VALUES ('r-1','web-01','10.0.0.1','linux')`).Error)

	repo := repository.NewGORMRepository(gormDB)
	svc := service.NewQueryService(parseTestURL(t, promURL), repo, repo)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterQueryRoutes(router.Group("/api/v1"), NewQueryHandler(svc))
	return router
}

func parseTestURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	if raw == "" {
		return nil
	}
	parsed, err := url.Parse(raw)
	require.NoError(t, err)
	return parsed
}

func TestQueryTargetsAndCoverageRoutes(t *testing.T) {
	router := newQueryRouter(t, viewerUser(), "")

	code, out := doJSON(t, router, http.MethodGet, "/api/v1/targets")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 1, data["total"])
	target := data["list"].([]any)[0].(map[string]any)
	assert.Equal(t, "node", target["job"])
	assert.Equal(t, "10.0.0.1:9100", target["instance"])
	assert.Equal(t, "mc-a", target["network_domain"])
	assert.Equal(t, "r-1", target["instance_name"])
	assert.Equal(t, "up", target["health"])
	assert.Equal(t, "edge", target["source"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v1/health/coverage")
	require.Equal(t, http.StatusOK, code, out)
	coverage := out["data"].(map[string]any)
	assert.EqualValues(t, 1, coverage["collecting"])
	assert.EqualValues(t, 0, coverage["deployed_not_collected"])
	assert.EqualValues(t, 0, coverage["not_monitored"])
}

func TestQueryProxyMetaEnvelopeAndBadGateway(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	router := newQueryRouter(t, viewerUser(), upstream.URL)

	code, out := doJSON(t, router, http.MethodGet, "/api/v1/query?query=up")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, "success", out["status"])
	assert.Contains(t, out, "data")
	meta := out["meta"].(map[string]any)
	assert.Equal(t, "prometheus", meta["data_source"])
	assert.Equal(t, []any{"mc-a"}, meta["network_domains"])
	upstream.Close()

	// A closed upstream yields 502 bad_gateway.
	code, out = doJSON(t, router, http.MethodGet, "/api/v1/query?query=up")
	assert.Equal(t, http.StatusBadGateway, code)
	assert.Equal(t, "bad_gateway", out["errorType"])
}
