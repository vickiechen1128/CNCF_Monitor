package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/gateway/auth"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

func newPackageRouter(t *testing.T, dir string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set(auth.ContextUserKey, adminUser())
		c.Next()
	})
	RegisterPlatformRoutes(router.Group("/api/v3/platform"), Handlers{
		Packages: NewPackageHandler(service.NewPackageService(dir)),
	})
	return router
}

func writePackage(t *testing.T, dir string) (string, string) {
	t.Helper()
	content := []byte("edge-package-content")
	file := "edge-sync-agent-v1.0.0-linux-amd64-20261112.tar.gz"
	require.NoError(t, os.WriteFile(filepath.Join(dir, file), content, 0o640))
	sum := sha256.Sum256(content)
	checksum := hex.EncodeToString(sum[:])
	manifest := fmt.Sprintf(`{
		"version": "v1.0.0",
		"file": %q,
		"size_bytes": %d,
		"sha256": %q,
		"components": [{"name":"edge-sync-agent","version":"v1.0.0"}]
	}`, file, len(content), checksum)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "release_meta.json"), []byte(manifest), 0o640))
	return file, checksum
}

func TestEdgePackagesEmptyDirectory(t *testing.T) {
	router := newPackageRouter(t, t.TempDir())

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-packages")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 0, data["total"])
	assert.Empty(t, data["list"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-packages/latest")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}

func TestEdgePackagesListLatestAndDownload(t *testing.T) {
	dir := t.TempDir()
	file, checksum := writePackage(t, dir)
	router := newPackageRouter(t, dir)

	code, out := doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-packages")
	require.Equal(t, http.StatusOK, code, out)
	data := out["data"].(map[string]any)
	assert.EqualValues(t, 1, data["total"])
	item := data["list"].([]any)[0].(map[string]any)
	assert.Equal(t, "v1.0.0", item["version"])
	assert.Equal(t, file, item["file"])
	assert.Equal(t, checksum, item["sha256"])
	assert.NotNil(t, item["released_at"])

	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-packages/latest")
	require.Equal(t, http.StatusOK, code, out)
	assert.Equal(t, file, out["data"].(map[string]any)["file"])

	// Download streams the tar.gz and exposes checksum headers.
	req := httptest.NewRequest(http.MethodGet, "/api/v3/platform/edge-packages/"+file, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "edge-package-content", rec.Body.String())
	assert.Equal(t, `"`+checksum+`"`, rec.Header().Get("ETag"))
	assert.Equal(t, checksum, rec.Header().Get("X-Checksum-Sha256"))

	// If-None-Match with the checksum yields 304.
	req = httptest.NewRequest(http.MethodGet, "/api/v3/platform/edge-packages/"+file, nil)
	req.Header.Set("If-None-Match", `"`+checksum+`"`)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotModified, rec.Code)

	// Unknown file → 404.
	code, out = doJSON(t, router, http.MethodGet, "/api/v3/platform/edge-packages/other.tar.gz")
	assert.Equal(t, http.StatusNotFound, code)
	assert.Equal(t, "not_found", out["errorType"])
}
