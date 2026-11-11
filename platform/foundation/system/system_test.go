package system

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/db"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func newTestRouter(t *testing.T) (*gin.Engine, *Module) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dsn := filepath.Join(t.TempDir(), "system.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	m := NewModule(gormDB, Options{
		Driver:  "sqlite",
		Modules: func() []string { return []string{"system", "m07"} },
	})
	router := gin.New()
	group := router.Group("/api/v3/platform")
	require.NoError(t, m.RegisterRoutes(group))
	return router, m
}

func getJSON(t *testing.T, router *gin.Engine, path string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return rec.Code, out
}

func TestHealth(t *testing.T) {
	router, _ := newTestRouter(t)
	status, out := getJSON(t, router, "/api/v3/platform/health")
	assert.Equal(t, http.StatusOK, status)
	assert.Equal(t, "success", out["status"])
	data := out["data"].(map[string]any)
	assert.Equal(t, "ok", data["status"])
}

func TestReadyWithMigratedDatabase(t *testing.T) {
	router, _ := newTestRouter(t)
	status, out := getJSON(t, router, "/api/v3/platform/ready")
	assert.Equal(t, http.StatusOK, status)
	data := out["data"].(map[string]any)
	assert.Equal(t, "ready", data["status"])
	assert.Equal(t, "sqlite", data["driver"])
	assert.NotZero(t, data["schema_version"])
}

func TestReadyWithoutDatabase(t *testing.T) {
	gin.SetMode(gin.TestMode)
	m := NewModule(nil, Options{})
	router := gin.New()
	require.NoError(t, m.RegisterRoutes(router.Group("/api/v3/platform")))

	status, out := getJSON(t, router, "/api/v3/platform/ready")
	assert.Equal(t, http.StatusServiceUnavailable, status)
	assert.Equal(t, "unavailable", out["errorType"])
}

func TestMeta(t *testing.T) {
	router, _ := newTestRouter(t)
	status, out := getJSON(t, router, "/api/v3/platform/meta")
	assert.Equal(t, http.StatusOK, status)
	data := out["data"].(map[string]any)
	assert.Equal(t, "v3", data["api"])
	assert.Equal(t, "sqlite", data["driver"])
	assert.Equal(t, []any{"system", "m07"}, data["modules"])
	assert.NotEmpty(t, data["version"])
}

func TestNewModuleDefaults(t *testing.T) {
	m := NewModule(nil, Options{})
	assert.Equal(t, "system", m.Name())
	assert.Empty(t, m.modules())
}
