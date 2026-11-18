package storagelog

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateRetentionTime(t *testing.T) {
	valid := []string{"15d", "1h30m", "30m", "360h", "1w", "1y2w3d", "500ms"}
	for _, s := range valid {
		assert.NoError(t, ValidateRetentionTime(s), "输入 %q 应合法", s)
	}
	invalid := []string{"", "15", "15x", "abc", "-1d", "15d ", "d15", "15D"}
	for _, s := range invalid {
		assert.Error(t, ValidateRetentionTime(s), "输入 %q 应非法", s)
	}
}

func TestValidateRetentionSize(t *testing.T) {
	valid := []string{"2GB", "10GiB", "512MB", "0B", "1TB", "1024KiB"}
	for _, s := range valid {
		assert.NoError(t, ValidateRetentionSize(s), "输入 %q 应合法", s)
	}
	invalid := []string{"", "2G", "GB", "2kB", "2 gb", "-1GB", "2.5GB"}
	for _, s := range invalid {
		assert.Error(t, ValidateRetentionSize(s), "输入 %q 应非法", s)
	}
}

func TestValuesEqual_Normalized(t *testing.T) {
	// 归一化核心场景：用户输入 2GB 与运行时 flags 的 2GiB 同值不同串，
	// 不得误报「待重启」。
	assert.True(t, valuesEqual(
		RetentionValues{Time: "15d", Size: "2GB"},
		RetentionValues{Time: "15d", Size: "2GiB"},
	))
	// 360h 与 15d 时长等价。
	assert.True(t, valuesEqual(
		RetentionValues{Time: "360h", Size: "10GB"},
		RetentionValues{Time: "15d", Size: "10GiB"},
	))
	// 真实差异必须识别。
	assert.False(t, valuesEqual(
		RetentionValues{Time: "15d", Size: "10GB"},
		RetentionValues{Time: "30d", Size: "10GB"},
	))
	assert.False(t, valuesEqual(
		RetentionValues{Time: "15d", Size: "10GB"},
		RetentionValues{Time: "15d", Size: "20GB"},
	))
}

func TestValuesEqual_ParseFailureFallsBackToString(t *testing.T) {
	// 任一侧解析失败时回退字符串比较，保证不误判为「已生效」。
	assert.False(t, valuesEqual(
		RetentionValues{Time: "15d", Size: "10GB"},
		RetentionValues{Time: "15d", Size: "unknown"},
	))
	assert.True(t, valuesEqual(
		RetentionValues{Time: "unknown", Size: "unknown"},
		RetentionValues{Time: "unknown", Size: "unknown"},
	))
}

func TestReadWriteRetentionPolicy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "prom-retention.env")

	// 文件不存在时 found=false（desired 回落运行时值路径）。
	_, found, err := readRetentionPolicy(path)
	require.NoError(t, err)
	assert.False(t, found)

	want := RetentionValues{Time: "30d", Size: "20GB"}
	require.NoError(t, writeRetentionPolicy(path, want))

	got, found, err := readRetentionPolicy(path)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, want, got)

	// 文件头注释标明写入方与生效方式。
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(data), "重启 Prometheus 后生效")

	// 覆盖写：第二次写入覆盖首次值。
	require.NoError(t, writeRetentionPolicy(path, RetentionValues{Time: "7d", Size: "5GB"}))
	got, found, err = readRetentionPolicy(path)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, RetentionValues{Time: "7d", Size: "5GB"}, got)
}

func TestReadRetentionPolicy_SkipsComments(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prom-retention.env")
	content := "# 注释行\n\nPROM_RETENTION_TIME=15d\n# PROM_RETENTION_TIME=99d\nPROM_RETENTION_SIZE=2GB\n无等号行\n"
	require.NoError(t, os.WriteFile(path, []byte(content), 0o644))

	vals, found, err := readRetentionPolicy(path)
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, RetentionValues{Time: "15d", Size: "2GB"}, vals)
}

func TestDiskUsage(t *testing.T) {
	total, used, free, err := diskUsage(t.TempDir())
	require.NoError(t, err)
	assert.Greater(t, total, uint64(0))
	assert.LessOrEqual(t, used+free, total+1<<20) // 权限保留块导致 used+free ≤ total
}

func TestDetectLogRotation_SummaryAlwaysPresent(t *testing.T) {
	info := detectLogRotation()
	assert.Contains(t, []string{"logrotate", "journald", "none"}, info.Mechanism)
	assert.NotEmpty(t, info.Summary)
}
