package storage

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mockPromFlags(t *testing.T, retentionTime, retentionSize, tsdbPath string) *url.URL {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/status/flags" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "success",
			"data": map[string]string{
				"storage.tsdb.retention.time": retentionTime,
				"storage.tsdb.retention.size": retentionSize,
				"storage.tsdb.path":           tsdbPath,
			},
		})
	}))
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	return u
}

func TestValidateRetention(t *testing.T) {
	validTimes := []string{"15d", "1h30m", "30m", "1y", "500ms"}
	for _, value := range validTimes {
		assert.NoError(t, ValidateRetentionTime(value), value)
	}
	invalidTimes := []string{"", "15", "15D", "1d2x", "-1d"}
	for _, value := range invalidTimes {
		assert.Error(t, ValidateRetentionTime(value), value)
	}

	validSizes := []string{"10GB", "2GiB", "1TB", "512MB", "1B"}
	for _, value := range validSizes {
		assert.NoError(t, ValidateRetentionSize(value), value)
	}
	invalidSizes := []string{"", "10", "10G", "10gb", "-1GB"}
	for _, value := range invalidSizes {
		assert.Error(t, ValidateRetentionSize(value), value)
	}
}

func TestWriteRetentionPolicyAtomic(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "prom-retention.env")
	require.NoError(t, writeRetentionPolicy(path, RetentionValues{Time: "30d", Size: "20GB"}))

	values, found, err := readRetentionPolicy(path)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, RetentionValues{Time: "30d", Size: "20GB"}, values)

	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(content), "PROM_RETENTION_TIME=30d")
	assert.Contains(t, string(content), "PROM_RETENTION_SIZE=20GB")

	entries, err := os.ReadDir(filepath.Dir(path))
	require.NoError(t, err)
	assert.Len(t, entries, 1, "no temp file should remain after rename")
}

func TestOverviewRuntimeDefaultAndDisk(t *testing.T) {
	tsdbPath := t.TempDir()
	svc := NewService(Options{
		EnvFile: filepath.Join(t.TempDir(), "prom-retention.env"),
		PromURL: mockPromFlags(t, "15d", "2GiB", tsdbPath),
	})

	overview, err := svc.Overview(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "runtime_default", overview.Retention.Source)
	assert.False(t, overview.Retention.EnvFileExists)
	assert.True(t, overview.Retention.RuntimeAvailable)
	assert.False(t, overview.Retention.PendingRestart)
	require.NotNil(t, overview.Retention.Desired)
	require.NotNil(t, overview.Retention.Runtime)
	assert.Equal(t, *overview.Retention.Desired, *overview.Retention.Runtime)

	require.NotEmpty(t, overview.Disks)
	assert.Equal(t, "TSDB 数据目录", overview.Disks[0].Label)
	assert.Equal(t, tsdbPath, overview.Disks[0].Path)
	assert.Empty(t, overview.Disks[0].Error)
	assert.Greater(t, overview.Disks[0].TotalBytes, uint64(0))
}

func TestOverviewPendingRestartNormalization(t *testing.T) {
	cases := []struct {
		name        string
		envTime     string
		envSize     string
		runtimeTime string
		runtimeSize string
		wantPending bool
	}{
		{"real diff", "30d", "20GB", "15d", "2GiB", true},
		{"unit equivalent", "15d", "2GB", "15d", "2GiB", false},
		{"duration equivalent", "360h", "2GB", "15d", "2GiB", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			envFile := filepath.Join(t.TempDir(), "prom-retention.env")
			require.NoError(t, writeRetentionPolicy(envFile, RetentionValues{Time: tc.envTime, Size: tc.envSize}))
			svc := NewService(Options{
				EnvFile: envFile,
				PromURL: mockPromFlags(t, tc.runtimeTime, tc.runtimeSize, t.TempDir()),
			})
			overview, err := svc.Overview(context.Background())
			require.NoError(t, err)
			assert.Equal(t, "env_file", overview.Retention.Source)
			assert.Equal(t, tc.wantPending, overview.Retention.PendingRestart)
		})
	}
}

func TestOverviewDegradesWhenPrometheusDown(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	require.NoError(t, writeRetentionPolicy(envFile, RetentionValues{Time: "30d", Size: "20GB"}))
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL, err := url.Parse(srv.URL)
	require.NoError(t, err)
	srv.Close()

	svc := NewService(Options{EnvFile: envFile, PromURL: deadURL})
	overview, err := svc.Overview(context.Background())
	require.NoError(t, err)
	assert.False(t, overview.Retention.RuntimeAvailable)
	assert.Nil(t, overview.Retention.Runtime)
	require.NotNil(t, overview.Retention.Desired)
	assert.Equal(t, "30d", overview.Retention.Desired.Time)
	assert.False(t, overview.Retention.PendingRestart)
	require.NotEmpty(t, overview.Disks)
	assert.Contains(t, overview.Disks[0].Error, "Prometheus 未运行")
}

func TestOverviewLogRootDiskRow(t *testing.T) {
	logDir := t.TempDir()
	t.Setenv("LOG_ROOT", logDir)
	svc := NewService(Options{
		EnvFile: filepath.Join(t.TempDir(), "prom-retention.env"),
		PromURL: mockPromFlags(t, "15d", "2GiB", t.TempDir()),
	})
	overview, err := svc.Overview(context.Background())
	require.NoError(t, err)

	var found bool
	for _, disk := range overview.Disks {
		if disk.Label == "日志目录" {
			found = true
			assert.Equal(t, logDir, disk.Path)
			assert.Greater(t, disk.TotalBytes, uint64(0))
		}
	}
	assert.True(t, found)
}

func TestUpdateRetentionWritesAndReportsPending(t *testing.T) {
	envFile := filepath.Join(t.TempDir(), "prom-retention.env")
	svc := NewService(Options{
		EnvFile: envFile,
		PromURL: mockPromFlags(t, "15d", "2GiB", t.TempDir()),
	})
	overview, err := svc.UpdateRetention(context.Background(), "30d", "20GB")
	require.NoError(t, err)
	assert.True(t, overview.Retention.EnvFileExists)
	assert.Equal(t, "env_file", overview.Retention.Source)
	assert.True(t, overview.Retention.PendingRestart)

	values, found, err := readRetentionPolicy(envFile)
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, RetentionValues{Time: "30d", Size: "20GB"}, values)
}

func TestUpdateRetentionRejectsInvalidAndUnconfigured(t *testing.T) {
	svc := NewService(Options{EnvFile: filepath.Join(t.TempDir(), "prom-retention.env")})
	_, err := svc.UpdateRetention(context.Background(), "15", "10GB")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "保留时长格式无效")

	_, err = svc.UpdateRetention(context.Background(), "15d", "10G")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "保留容量")

	_, err = svc.UpdateRetention(context.Background(), "", "10GB")
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "必填"))

	unconfigured := NewService(Options{})
	_, err = unconfigured.UpdateRetention(context.Background(), "15d", "10GB")
	require.ErrorIs(t, err, ErrEnvFileNotConfigured)
}
