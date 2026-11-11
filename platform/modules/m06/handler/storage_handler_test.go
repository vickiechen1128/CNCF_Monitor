package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/models"
	m06storage "github.com/metriccenter/metriccenter/platform/modules/m06/storage"
)

func newStorageTestRouter(t *testing.T, user *models.User, envFile string, promURL *url.URL) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, user)
		c.Next()
	})
	RegisterRoutes(router.Group("/api/v3/platform"), Handlers{
		Storage: NewStorageHandler(m06storage.NewService(m06storage.Options{EnvFile: envFile, PromURL: promURL})),
	})
	return router
}

func mockStorageProm(t *testing.T) *url.URL {
	t.Helper()
	tsdbPath := t.TempDir()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/status/flags" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]string{
				"storage.tsdb.retention.time": "15d",
				"storage.tsdb.retention.size": "2GiB",
				"storage.tsdb.path":           tsdbPath,
			},
		})
	}))
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	return u
}

func TestStorageOverviewAndRetentionUpdate(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	router := newStorageTestRouter(t, adminUser(), envFile, mockStorageProm(t))

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	retention := data["retention"].(map[string]any)
	assert.Equal(t, "runtime_default", retention["source"])
	assert.Equal(t, false, retention["env_file_exists"])
	assert.Equal(t, true, retention["runtime_available"])
	assert.Contains(t, data, "disks")
	assert.Contains(t, data, "log_rotation")

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/storage-logs/retention",
		`{"time":"30d","size":"20GB"}`)
	require.Equal(t, http.StatusOK, code, out)
	data = out["data"].(map[string]any)
	retention = data["retention"].(map[string]any)
	assert.Equal(t, "env_file", retention["source"])
	assert.Equal(t, true, retention["env_file_exists"])
	assert.Equal(t, true, retention["pending_restart"])
	assert.Equal(t, "30d", retention["desired"].(map[string]any)["time"])

	for _, body := range []string{
		`{"time":"15","size":"10GB"}`,
		`{"time":"15d","size":"10G"}`,
		`{"time":"","size":"10GB"}`,
		`{"time":"15d","size":""}`,
		`{"time":"15d","size":"10GB","other":true}`,
		`not-json`,
	} {
		code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/storage-logs/retention", body)
		assert.Equal(t, http.StatusBadRequest, code, body)
		assert.Equal(t, "bad_request", out["errorType"], body)
	}
}

func TestStorageUnconfiguredEnvReturnsActionable503(t *testing.T) {
	router := newStorageTestRouter(t, adminUser(), "", nil)

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, code, out, "reads degrade instead of failing")
	retention := out["data"].(map[string]any)["retention"].(map[string]any)
	assert.Equal(t, false, retention["env_file_exists"])
	assert.Equal(t, false, retention["runtime_available"])

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/storage-logs/retention",
		`{"time":"15d","size":"10GB"}`)
	assert.Equal(t, http.StatusServiceUnavailable, code)
	assert.Equal(t, "unavailable", out["errorType"])
	assert.Contains(t, out["error"].(string), "未配置")
}

func TestStorageRequiresAdmin(t *testing.T) {
	viewer := &models.User{Role: models.UserRoleUser, Status: models.UserStatusActive}
	router := newStorageTestRouter(t, viewer, filepath.Join(t.TempDir(), "prom-retention.env"), nil)

	code, out := doRequest(t, router, http.MethodGet, "/api/v3/platform/storage-logs", "")
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])

	code, out = doRequest(t, router, http.MethodPut, "/api/v3/platform/storage-logs/retention",
		`{"time":"15d","size":"10GB"}`)
	assert.Equal(t, http.StatusForbidden, code)
	assert.Equal(t, "forbidden", out["errorType"])
}
