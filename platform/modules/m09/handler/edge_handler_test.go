package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
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

func newEdgeRouter(t *testing.T, user *models.User) (*gin.Engine, *service.OnboardingService) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "m09_edge.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: models.PlatformAdminTenantID, Name: "平台默认租户",
		NetworkDomainIDs: []string{"mc-a"}, IsPlatformAdmin: true,
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.Tenant{
		ID: "tenant-a", Name: "租户 A", NetworkDomainIDs: []string{"mc-a"},
		Status: models.TenantStatusActive,
	}).Error)
	require.NoError(t, gormDB.Create(&models.NetworkDomain{
		ID: "mc-a", Name: "域 mc-a", DomainType: models.DomainTypeEdge,
		ZoneType: "beijing", CloudCode: "aliyun",
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Channel:             models.ChannelTypeAgentPull,
		Status:              models.DomainStatusEnabled,
	}).Error)

	repo := repository.NewGORMRepository(gormDB)
	onboarding := service.NewOnboardingService(repo, repo)
	edge := service.NewEdgeService(repo, repo)
	validator := service.NewTokenValidator(repo)
	syncSvc := service.NewConfigSyncService(repo, m09refs.NewGORMSourceReader(gormDB),
		storage.NewContentStore(t.TempDir()), nil)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterPlatformRoutes(router.Group("/api/v3/platform"), Handlers{
		Onboarding: NewOnboardingHandler(onboarding),
		Agents:     NewAgentHandler(edge),
		Snapshots:  NewSnapshotHandler(onboarding, syncSvc),
		EdgeAuth:   validator,
	})
	RegisterEdgeRoutes(router.Group("/api/v3/edge"), Handlers{
		Edge:     NewEdgeHandler(edge, syncSvc),
		EdgeAuth: validator,
	})
	return router, onboarding
}

func doEdgeJSON(t *testing.T, router *gin.Engine, method, path, body string, token string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
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

func TestEdgeHeartbeatRequiresValidToken(t *testing.T) {
	router, _ := newEdgeRouter(t, adminUser())
	body := `{"protocol_version":"v1","hostname":"node-1"}`

	code, out := doEdgeJSON(t, router, http.MethodPost, "/api/v3/edge/heartbeat", body, "")
	assert.Equal(t, http.StatusUnauthorized, code)
	assert.Equal(t, "unauthorized", out["errorType"])

	code, out = doEdgeJSON(t, router, http.MethodPost, "/api/v3/edge/heartbeat", body, "mctok_v1_deadbeef")
	assert.Equal(t, http.StatusUnauthorized, code)
	assert.Equal(t, "unauthorized", out["errorType"])
}

func TestEdgeHeartbeatAndAgentCommands(t *testing.T) {
	router, onboarding := newEdgeRouter(t, adminUser())
	token, err := onboarding.Monitor(t.Context(), adminActor(), "mc-a", service.Endpoint{})
	require.NoError(t, err)

	body := `{
		"protocol_version":"v1",
		"agent_type":"vmagent",
		"version":"v1.0.0",
		"config_version":"20261111-0a1b",
		"hostname":"edge-node-01",
		"ip":"10.0.0.5",
		"components":[{"type":"collector","name":"vmagent","status":"running","version":"vmagent-1.101"}],
		"targets_collected":true,
		"targets":[{"job":"node-exporter","instance":"10.0.0.5:9100","health":"up"}]
	}`
	code, out := doEdgeJSON(t, router, http.MethodPost, "/api/v3/edge/heartbeat", body, token.TokenPlain)
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.Equal(t, false, data["config_changed"])
	assert.NotEmpty(t, data["server_time"])

	// The agent is now listed for the onboarding domain.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-agents")
	require.Equal(t, http.StatusOK, code, out)
	agents := out["data"].(map[string]any)
	assert.EqualValues(t, 1, agents["total"])
	agent := agents["list"].([]any)[0].(map[string]any)
	assert.Equal(t, "edge-node-01", agent["hostname"])
	assert.Equal(t, "online", agent["status"])
	id := int64(agent["id"].(float64))

	// Restart increments the command sequence.
	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/edge-agents/"+itoa(id)+"/restart")
	require.Equal(t, http.StatusOK, code, out)
	assert.EqualValues(t, 1, out["data"].(map[string]any)["vm_agent_restart_seq"])

	// Strict JSON rejects unknown fields.
	code, out = doEdgeJSON(t, router, http.MethodPost, "/api/v3/edge/heartbeat",
		`{"protocol_version":"v1","hostname":"node-1","unexpected":true}`, token.TokenPlain)
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "bad_request", out["errorType"])
}

func TestEdgeAgentCommandsRequireAdmin(t *testing.T) {
	router, onboarding := newEdgeRouter(t, viewerUser())
	token, err := onboarding.Monitor(t.Context(), adminActor(), "mc-a", service.Endpoint{})
	require.NoError(t, err)
	code, _ := doEdgeJSON(t, router, http.MethodPost, "/api/v3/edge/heartbeat",
		`{"protocol_version":"v1","hostname":"node-1"}`, token.TokenPlain)
	require.Equal(t, http.StatusOK, code)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-agents")
	require.Equal(t, http.StatusOK, code, out)
	id := int64(out["data"].(map[string]any)["list"].([]any)[0].(map[string]any)["id"].(float64))

	code, out = doJSON(t, router, http.MethodPut, "/api/v3/platform/edge-agents/"+itoa(id)+"/flush-backlog")
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])
}

func adminActor() service.Actor {
	return service.Actor{TenantID: models.PlatformAdminTenantID, IsPlatformAdmin: true}
}

func itoa(id int64) string { return strconv.FormatInt(id, 10) }
