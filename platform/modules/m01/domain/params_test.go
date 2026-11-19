package domain

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidDuration(t *testing.T) {
	cases := []struct {
		value string
		want  bool
	}{
		{"15s", true},
		{"1m", true},
		{"500ms", true},
		{"2h", true},
		{"1d", true},
		{"1w", true},
		{"1y", true},
		{"180", false},
		{"", false},
		{"s", false},
		{"15 s", false},
		{"-15s", false},
		{"1.5s", false},
	}
	for _, tc := range cases {
		t.Run(tc.value, func(t *testing.T) {
			assert.Equal(t, tc.want, ValidDuration(tc.value))
		})
	}
}

func TestParseDurationSeconds(t *testing.T) {
	cases := []struct {
		value string
		want  int64
		ok    bool
	}{
		{"15s", 15, true},
		{"1m", 60, true},
		{"500ms", 0, true},
		{"2h", 7200, true},
		{"1d", 86400, true},
		{"bad", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.value, func(t *testing.T) {
			got, ok := ParseDurationSeconds(tc.value)
			assert.Equal(t, tc.ok, ok)
			if tc.ok {
				assert.Equal(t, tc.want, got)
			}
		})
	}
}

func TestValidateScrapeTiming(t *testing.T) {
	require.NoError(t, ValidateScrapeTiming("15s", "10s"))
	require.NoError(t, ValidateScrapeTiming("", ""))
	require.NoError(t, ValidateScrapeTiming("15s", ""))

	assert.Error(t, ValidateScrapeTiming("180", "10s"))
	assert.Error(t, ValidateScrapeTiming("10s", "10s"), "timeout must be shorter")
	assert.Error(t, ValidateScrapeTiming("10s", "15s"))
}

func TestValidateMetricsPathAndPort(t *testing.T) {
	require.NoError(t, ValidateMetricsPath("/metrics"))
	require.NoError(t, ValidateMetricsPath(""))
	assert.Error(t, ValidateMetricsPath("metrics"))

	require.NoError(t, ValidatePort(0))
	require.NoError(t, ValidatePort(9100))
	assert.Error(t, ValidatePort(-1))
	assert.Error(t, ValidatePort(70000))
}

func TestMonitorTypeHelpers(t *testing.T) {
	assert.True(t, ValidMonitorType("host_linux"))
	assert.True(t, ValidMonitorType("host_npu"))
	assert.False(t, ValidMonitorType("unknown"))
	assert.False(t, ValidMonitorType(""))

	assert.True(t, ExporterSupportsMonitorType("host_linux", nil), "empty supported list means any")
	assert.True(t, ExporterSupportsMonitorType("host_linux", []string{"host_linux", "host_windows"}))
	assert.False(t, ExporterSupportsMonitorType("mysql", []string{"host_linux"}))
}
