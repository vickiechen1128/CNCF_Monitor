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

// The retired "monitor object type" registry was replaced by the collection
// template catalogue: a code is either a seeded template row or a user-defined
// one whose shape is checked by ValidateCollectionTemplateCode.
func TestCollectionTemplateCodeHelpers(t *testing.T) {
	for _, code := range []string{TemplateHostLinux, TemplateHostNPU, TemplateMySQL} {
		template, ok := BuiltinCollectionTemplate(code)
		require.True(t, ok, code)
		assert.Equal(t, code, template.Code)
		assert.True(t, template.IsBuiltin)
	}

	_, ok := BuiltinCollectionTemplate("unknown")
	assert.False(t, ok)
	_, ok = BuiltinCollectionTemplate("")
	assert.False(t, ok)

	// A user-defined template code only has to satisfy the immutable shape; the
	// catalogue itself is data, so an unknown code is a repository lookup miss.
	assert.NoError(t, ValidateCollectionTemplateCode("host_dpu"))
	assert.NoError(t, ValidateCollectionTemplateCode(" mysql "))
	assert.Error(t, ValidateCollectionTemplateCode(""))
	assert.Error(t, ValidateCollectionTemplateCode("Host_DPU"))
	assert.Error(t, ValidateCollectionTemplateCode("host-dpu"))
}
