package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newStaticTestDir 构造最小前端产物目录，模拟 ui-custom/web/dist 的结构。
func newStaticTestDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "index.html"), []byte("<!doctype html><html>SPA</html>"), 0o644))
	require.NoError(t, os.MkdirAll(filepath.Join(root, "assets"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "assets", "app.js"), []byte("console.log(1)"), 0o644))
	return root
}

// newSPAEngine 构造一个挂了静态兜底的 engine，并预置一条 /api 路由用于验证
// API 优先级高于静态兜底（模拟 setupRouter 的真实装配顺序）。
func newSPAEngine(t *testing.T, dir string) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v1/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	require.NoError(t, registerSPA(r, dir))
	return r
}

func serve(t *testing.T, r *gin.Engine, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestRegisterSPA_ServesIndexAndAssets(t *testing.T) {
	r := newSPAEngine(t, newStaticTestDir(t))

	// 根路径返回 index.html
	w := serve(t, r, "/")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "SPA")

	// 真实存在的静态资源直接返回文件内容
	w = serve(t, r, "/assets/app.js")
	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "console.log(1)", w.Body.String())
}

func TestRegisterSPA_HistoryFallback(t *testing.T) {
	r := newSPAEngine(t, newStaticTestDir(t))

	// 前端 history 子路由（浏览器刷新/直接输入）必须 fallback 到 index.html，
	// 否则刷新子路由会得到 404——这是 python http.server 托管时的已知缺陷。
	for _, path := range []string{"/resources", "/resources/1/labels", "/login?redirect=%2Fresources"} {
		w := serve(t, r, path)
		require.Equal(t, http.StatusOK, w.Code, "path %s should fall back to index.html", path)
		assert.Contains(t, w.Body.String(), "SPA", "path %s should serve index.html", path)
	}
}

func TestRegisterSPA_APIRoutesTakePrecedence(t *testing.T) {
	r := newSPAEngine(t, newStaticTestDir(t))

	// 已注册的 /api/* 路由正常命中，不被静态兜底吞掉
	w := serve(t, r, "/api/v1/health")
	require.Equal(t, http.StatusOK, w.Code)
	assert.JSONEq(t, `{"status":"ok"}`, w.Body.String())
}

func TestRegisterSPA_UnknownAPIReturns404NotHTML(t *testing.T) {
	r := newSPAEngine(t, newStaticTestDir(t))

	// 未注册的 /api/* 必须返回 404 JSON。若伪装成 200 + index.html，前端按 JSON
	// 解析会失败，且 200 状态码会掩盖「接口不存在/路径写错」的真实问题。
	for _, path := range []string{"/api/v9/unknown", "/api", "/api/"} {
		w := serve(t, r, path)
		require.Equal(t, http.StatusNotFound, w.Code, "path %s should be 404", path)
		assert.Contains(t, w.Header().Get("Content-Type"), "application/json", "path %s should return JSON", path)
		assert.NotContains(t, w.Body.String(), "SPA", "path %s must not return index.html", path)
	}
}

func TestRegisterSPA_PathTraversalBlocked(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "web")
	require.NoError(t, os.MkdirAll(filepath.Join(root, "assets"), 0o755))
	require.NoError(t, os.WriteFile(filepath.Join(root, "index.html"), []byte("SPA"), 0o644))
	// 根目录之外的敏感文件，尝试用 ../ 穿越读取
	require.NoError(t, os.WriteFile(filepath.Join(base, "secret.txt"), []byte("TOP SECRET"), 0o644))

	r := newSPAEngine(t, root)
	w := serve(t, r, "/../secret.txt")
	assert.NotContains(t, w.Body.String(), "TOP SECRET")
}

func TestRegisterSPA_InvalidDir(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// 目录不存在
	require.Error(t, registerSPA(gin.New(), filepath.Join(t.TempDir(), "missing")))

	// 路径存在但是文件，不是目录
	f := filepath.Join(t.TempDir(), "afile")
	require.NoError(t, os.WriteFile(f, []byte("x"), 0o644))
	require.Error(t, registerSPA(gin.New(), f))

	// 目录存在但缺 index.html
	require.Error(t, registerSPA(gin.New(), t.TempDir()))
}
