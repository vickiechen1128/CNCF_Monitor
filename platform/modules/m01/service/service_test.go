package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

func TestNormalizeExporterDefaults(t *testing.T) {
	template := &domain.ExporterTemplate{Name: "  custom  "}
	normalizeExporter(template)
	assert.Equal(t, "custom", template.Name)
	assert.Equal(t, domain.DefaultMetricsPath, template.MetricsPath)
	assert.Equal(t, domain.SchemeHTTP, template.Scheme)
	assert.Equal(t, "any", template.OS)
	assert.Equal(t, "any", template.Arch)
	assert.Equal(t, domain.ExporterThirdParty, template.Source)
}

func TestValidateExporter(t *testing.T) {
	valid := &domain.ExporterTemplate{
		Name:                  "node-exporter",
		MetricsPath:           "/metrics",
		Scheme:                domain.SchemeHTTP,
		OS:                    "linux",
		Arch:                  "amd64",
		Source:                domain.ExporterOfficial,
		SupportedMonitorTypes: []string{"host_linux"},
	}
	require.NoError(t, validateExporter(valid))

	cases := []struct {
		name   string
		mutate func(*domain.ExporterTemplate)
	}{
		{"empty name", func(e *domain.ExporterTemplate) { e.Name = "" }},
		{"long name", func(e *domain.ExporterTemplate) { e.Name = string(make([]byte, 101)) }},
		{"bad port", func(e *domain.ExporterTemplate) { e.DefaultPort = 70000 }},
		{"bad path", func(e *domain.ExporterTemplate) { e.MetricsPath = "metrics" }},
		{"bad scheme", func(e *domain.ExporterTemplate) { e.Scheme = "ftp" }},
		{"bad os", func(e *domain.ExporterTemplate) { e.OS = "solaris" }},
		{"bad arch", func(e *domain.ExporterTemplate) { e.Arch = "mips" }},
		{"bad source", func(e *domain.ExporterTemplate) { e.Source = "vendor" }},
		{"unknown monitor type", func(e *domain.ExporterTemplate) { e.SupportedMonitorTypes = []string{"unknown"} }},
		{"bad url", func(e *domain.ExporterTemplate) { e.Homepage = "ftp://example.com" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			copy := *valid
			tc.mutate(&copy)
			assert.Error(t, validateExporter(&copy))
		})
	}
}

func TestNoopLabelTemplateResolver(t *testing.T) {
	ref, found, err := NoopLabelTemplateResolver{}.Resolve(nil, "lt-1")
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, "lt-1", ref.ID)
	assert.Empty(t, ref.Name)
}
