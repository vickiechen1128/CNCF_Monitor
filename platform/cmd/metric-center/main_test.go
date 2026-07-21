package main

import (
	"encoding/json"
	"flag"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/api/response"
	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func parseTestURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}

func TestHealthEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter(parseTestURL(t, "http://localhost:9090"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/api/v1/health", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, response.StatusSuccess, body.Status)

	data, ok := body.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "ok", data["status"])
	assert.Equal(t, "metric-center", data["service"])
}

func TestHealthDBEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, db.Init())

	r := setupRouter(parseTestURL(t, "http://localhost:9090"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/api/v1/health/db", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, response.StatusSuccess, body.Status)

	data, ok := body.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "connected", data["db_status"])
}

func TestStatusEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter(parseTestURL(t, "http://localhost:9090"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/api/v1/status", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, response.StatusSuccess, body.Status)

	data, ok := body.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, "0.1.0-mvp", data["version"])
	assert.Equal(t, "mvp", data["mode"])
}

func TestConfigPreviewEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter(parseTestURL(t, "http://localhost:9090"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/api/v2/platform/config/preview", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, response.StatusSuccess, body.Status)

	data, ok := body.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Contains(t, data["prometheus_yml"], "TODO")
}

func TestConfigApplyEndpoint(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter(parseTestURL(t, "http://localhost:9090"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodPost, "/api/v2/platform/config/apply", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var body response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, response.StatusSuccess, body.Status)

	data, ok := body.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, true, data["ok"])
}

func TestLegacyConfigRoutesAreRemoved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := setupRouter(parseTestURL(t, "http://localhost:9090"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/api/v1/config/preview", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestMainFlags(t *testing.T) {
	oldArgs := os.Args
	oldCommandLine := flag.CommandLine
	t.Cleanup(func() {
		os.Args = oldArgs
		flag.CommandLine = oldCommandLine
	})

	// Test default values.
	flag.CommandLine = flag.NewFlagSet("metric-center", flag.ContinueOnError)
	listenAddr := flag.String("listen-address", ":8080", "MetricCenter HTTP 监听地址")
	prometheusURL := flag.String("prometheus.url", "http://localhost:9090", "Prometheus 查询地址")
	os.Args = []string{"metric-center"}
	require.NoError(t, flag.CommandLine.Parse(os.Args[1:]))
	assert.Equal(t, ":8080", *listenAddr)
	assert.Equal(t, "http://localhost:9090", *prometheusURL)

	// Test custom values.
	flag.CommandLine = flag.NewFlagSet("metric-center", flag.ContinueOnError)
	listenAddr = flag.String("listen-address", ":8080", "MetricCenter HTTP 监听地址")
	prometheusURL = flag.String("prometheus.url", "http://localhost:9090", "Prometheus 查询地址")
	os.Args = []string{"metric-center", "-listen-address", ":9090", "-prometheus.url", "http://prom:9090"}
	require.NoError(t, flag.CommandLine.Parse(os.Args[1:]))
	assert.Equal(t, ":9090", *listenAddr)
	assert.Equal(t, "http://prom:9090", *prometheusURL)
}

func TestParseURL(t *testing.T) {
	u, err := parseURL("http://localhost:9090")
	require.NoError(t, err)
	assert.Equal(t, "http://localhost:9090", u.String())

	_, err = parseURL("://invalid-url")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse url")

	_, err = parseURL("ftp://localhost:9090")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "scheme")

	_, err = parseURL("http://")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "host")
}

func TestPrometheusProxyRoutes(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var receivedPath string
	mockProm := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer mockProm.Close()

	r := setupRouter(parseTestURL(t, mockProm.URL))

	tests := []struct {
		name     string
		path     string
		expected string
	}{
		{"query", "/api/v1/query?query=up", "/api/v1/query"},
		{"query_range", "/api/v1/query_range?query=up&start=0&end=1&step=1", "/api/v1/query_range"},
		{"labels", "/api/v1/labels?start=0&end=1", "/api/v1/labels"},
		{"label_values", "/api/v1/label/__name__/values?start=0&end=1", "/api/v1/label/__name__/values"},
		{"series", "/api/v1/series?match[]=up", "/api/v1/series"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			receivedPath = ""
			w := httptest.NewRecorder()
			req, err := http.NewRequest(http.MethodGet, tt.path, nil)
			require.NoError(t, err)
			r.ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, tt.expected, receivedPath)
		})
	}
}

func TestPrometheusProxyErrorHandling(t *testing.T) {
	gin.SetMode(gin.TestMode)
	// 使用一个不可达的端口，确保后端不可用，触发 ErrorHandler。
	r := setupRouter(parseTestURL(t, "http://127.0.0.1:1"))

	w := httptest.NewRecorder()
	req, err := http.NewRequest(http.MethodGet, "/api/v1/label/__name__/values", nil)
	require.NoError(t, err)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadGateway, w.Code)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))

	var body response.Response
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, response.StatusError, body.Status)
	assert.Equal(t, response.ErrorTypeInternal, body.ErrorType)
	assert.NotEmpty(t, body.Error)
}
