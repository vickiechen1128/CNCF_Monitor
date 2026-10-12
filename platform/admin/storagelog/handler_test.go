package storagelog

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestRouter 挂载存储与日志管理路由到 /api/v2/platform，镜像 main.go 的
// admin 组接线（测试内省略 RequireAdmin 门，鉴权由既有中间件测试覆盖）。
func newTestRouter(t *testing.T, envFile string, promURL *url.URL) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	platform := r.Group("/api/v2/platform")
	RegisterRoutes(platform, Options{EnvFile: envFile, PromURL: promURL})
	return r
}

// mockPromFlags 起一个模拟 Prometheus /api/v1/status/flags 的服务。
func mockPromFlags(t *testing.T, retentionTime, retentionSize, tsdbPath string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/status/flags" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data": map[string]string{
				"storage.tsdb.retention.time": retentionTime,
				"storage.tsdb.retention.size": retentionSize,
				"storage.tsdb.path":           tsdbPath,
			},
		})
	}))
	t.Cleanup(srv.Close)
	return srv
}

func mustParseURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	u, err := url.Parse(raw)
	require.NoError(t, err)
	return u
}

// perform 执行请求并返回 recorder。
func perform(t *testing.T, r *gin.Engine, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// decodeOK 解 success 信封并反序列化为 overviewResponse。
func decodeOK(t *testing.T, w *httptest.ResponseRecorder) *overviewResponse {
	t.Helper()
	var env struct {
		Status string          `json:"status"`
		Data   json.RawMessage `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env), "body: %s", w.Body.String())
	require.Equal(t, "success", env.Status, "body: %s", w.Body.String())
	var ov overviewResponse
	require.NoError(t, json.Unmarshal(env.Data, &ov))
	return &ov
}

func decodeError(t *testing.T, w *httptest.ResponseRecorder) (errorType, errMsg string) {
	t.Helper()
	var env struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
		Error     string `json:"error"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env), "body: %s", w.Body.String())
	require.Equal(t, "error", env.Status)
	return env.ErrorType, env.Error
}

func TestGetOverview_RuntimeDefaultWhenEnvMissing(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	tsdbPath := t.TempDir()
	srv := mockPromFlags(t, "15d", "2GiB", tsdbPath)
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	w := perform(t, r, http.MethodGet, "/api/v2/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)

	require.NotNil(t, ov.Retention.Desired)
	assert.Equal(t, "runtime_default", ov.Retention.Source)
	assert.False(t, ov.Retention.EnvFileExists)
	assert.True(t, ov.Retention.RuntimeAvailable)
	assert.False(t, ov.Retention.PendingRestart)
	// env 缺失时期望值回落运行时值。
	require.NotNil(t, ov.Retention.Runtime)
	assert.Equal(t, *ov.Retention.Desired, *ov.Retention.Runtime)

	// TSDB 磁盘行来自运行时 flags 的 path。
	require.NotEmpty(t, ov.Disks)
	assert.Equal(t, "TSDB 数据目录", ov.Disks[0].Label)
	assert.Equal(t, tsdbPath, ov.Disks[0].Path)
	assert.Empty(t, ov.Disks[0].Error)
	assert.Greater(t, ov.Disks[0].TotalBytes, uint64(0))
}

func TestGetOverview_PendingRestartOnRealDiff(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	require.NoError(t, writeRetentionPolicy(envFile, RetentionValues{Time: "30d", Size: "20GB"}))
	srv := mockPromFlags(t, "15d", "2GiB", t.TempDir())
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	w := perform(t, r, http.MethodGet, "/api/v2/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)

	assert.Equal(t, "env_file", ov.Retention.Source)
	require.NotNil(t, ov.Retention.Desired)
	assert.Equal(t, "30d", ov.Retention.Desired.Time)
	assert.True(t, ov.Retention.EnvFileExists)
	assert.True(t, ov.Retention.PendingRestart, "30d/20GB vs 15d/2GiB 应判定待重启")
}

func TestGetOverview_NoFalsePendingOnUnitDifference(t *testing.T) {
	// 归一化：env 15d/2GB 与运行时 15d/2GiB 同值，不得误报待重启。
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	require.NoError(t, writeRetentionPolicy(envFile, RetentionValues{Time: "15d", Size: "2GB"}))
	srv := mockPromFlags(t, "15d", "2GiB", t.TempDir())
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	w := perform(t, r, http.MethodGet, "/api/v2/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)
	assert.False(t, ov.Retention.PendingRestart, "同值不同单位不应误报待重启")
}

func TestGetOverview_DegradesWhenPrometheusDown(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	require.NoError(t, writeRetentionPolicy(envFile, RetentionValues{Time: "30d", Size: "20GB"}))
	// 先起服务再关闭，得到确定不可达的地址。
	srv := mockPromFlags(t, "15d", "2GiB", t.TempDir())
	deadURL := srv.URL
	srv.Close()

	r := newTestRouter(t, envFile, mustParseURL(t, deadURL))
	w := perform(t, r, http.MethodGet, "/api/v2/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, w.Code, "Prometheus 不可用应降级 200，body: %s", w.Body.String())
	ov := decodeOK(t, w)

	assert.False(t, ov.Retention.RuntimeAvailable)
	require.Nil(t, ov.Retention.Runtime)
	require.NotNil(t, ov.Retention.Desired)
	assert.Equal(t, "30d", ov.Retention.Desired.Time)
	assert.Equal(t, "env_file", ov.Retention.Source)
	// 运行时不可取时不置 pending（无法比对）。
	assert.False(t, ov.Retention.PendingRestart)
	// TSDB 行给占位错误而非 500。
	require.NotEmpty(t, ov.Disks)
	assert.Contains(t, ov.Disks[0].Error, "Prometheus 未运行")
}

func TestGetOverview_LogRootDiskRow(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	srv := mockPromFlags(t, "15d", "2GiB", t.TempDir())
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	logDir := t.TempDir()
	t.Setenv("LOG_ROOT", logDir)

	w := perform(t, r, http.MethodGet, "/api/v2/platform/storage-logs", "")
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)

	var logRow *diskInfo
	for i := range ov.Disks {
		if ov.Disks[i].Label == "日志目录" {
			logRow = &ov.Disks[i]
		}
	}
	require.NotNil(t, logRow, "配置 LOG_ROOT 后应出现日志目录磁盘行")
	assert.Equal(t, logDir, logRow.Path)
	assert.Greater(t, logRow.TotalBytes, uint64(0))
}

func TestUpdateRetention_InvalidInputs(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	r := newTestRouter(t, envFile, nil)

	cases := []struct {
		name string
		body string
		want string
	}{
		{"非法时长", `{"time":"15","size":"10GB"}`, "保留时长格式无效"},
		{"非法容量", `{"time":"15d","size":"10G"}`, "保留容量"},
		{"缺时长", `{"time":"","size":"10GB"}`, "必填"},
		{"缺容量", `{"time":"15d","size":""}`, "必填"},
		{"非 JSON", `not-json`, "invalid request payload"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			w := perform(t, r, http.MethodPut, "/api/v2/platform/storage-logs/retention", tc.body)
			require.Equal(t, http.StatusBadRequest, w.Code, "body: %s", w.Body.String())
			errorType, msg := decodeError(t, w)
			assert.Equal(t, "bad_request", errorType)
			assert.Contains(t, msg, tc.want)
		})
	}

	// 校验失败不得落盘。
	_, err := os.Stat(envFile)
	assert.True(t, os.IsNotExist(err), "校验失败不应写 env 文件")
}

func TestUpdateRetention_WritesEnvAndReportsPending(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	srv := mockPromFlags(t, "15d", "2GiB", t.TempDir())
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	w := perform(t, r, http.MethodPut, "/api/v2/platform/storage-logs/retention",
		`{"time":"30d","size":"20GB"}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)

	// 落盘内容正确。
	vals, found, err := readRetentionPolicy(envFile)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, RetentionValues{Time: "30d", Size: "20GB"}, vals)

	// 回传最新比对状态：待重启 + env 来源。
	assert.True(t, ov.Retention.EnvFileExists)
	assert.Equal(t, "env_file", ov.Retention.Source)
	assert.True(t, ov.Retention.PendingRestart, "新值与运行时不同，应提示待重启")
}

func TestUpdateRetention_SameAsRuntimeNoPending(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	srv := mockPromFlags(t, "30d", "20GiB", t.TempDir())
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	// 保存与运行时同值（不同单位写法）的策略。
	w := perform(t, r, http.MethodPut, "/api/v2/platform/storage-logs/retention",
		`{"time":"30d","size":"20GB"}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)
	assert.False(t, ov.Retention.PendingRestart, "与运行时同值不应提示待重启")
}

func TestUpdateRetention_OverviewAlwaysPresent(t *testing.T) {
	// 保存成功后回传的 overview 仍含磁盘与日志轮转段，前端可直接整体刷新。
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	srv := mockPromFlags(t, "15d", "2GiB", t.TempDir())
	r := newTestRouter(t, envFile, mustParseURL(t, srv.URL))

	w := perform(t, r, http.MethodPut, "/api/v2/platform/storage-logs/retention",
		`{"time":"7d","size":"5GB"}`)
	require.Equal(t, http.StatusOK, w.Code, "body: %s", w.Body.String())
	ov := decodeOK(t, w)
	require.NotNil(t, ov.Retention.Desired)
	assert.Equal(t, "7d", ov.Retention.Desired.Time)
	assert.NotEmpty(t, ov.Disks)
	assert.NotEmpty(t, ov.LogRotation.Summary)
	assert.Contains(t, []string{"logrotate", "journald", "none"}, ov.LogRotation.Mechanism)
}
