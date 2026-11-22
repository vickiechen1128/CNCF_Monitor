package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m01/references"
	"github.com/metriccenter/metriccenter/platform/modules/m01/repository"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
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
		Name:        "node-exporter",
		MetricsPath: "/metrics",
		Scheme:      domain.SchemeHTTP,
		OS:          "linux",
		Arch:        "amd64",
		Source:      domain.ExporterOfficial,
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

// newServiceDB opens an isolated v3 database for the service tests.
func newServiceDB(t *testing.T, _ string) *gorm.DB {
	t.Helper()
	return testdb.Open(t)
}

// seedNodeTemplate writes the exporter + host_linux recipe a standard job needs:
// a job inherits the exporter from an enabled, bound collection template.
func seedNodeTemplate(t *testing.T, gormDB *gorm.DB) (*domain.ExporterTemplate, *domain.CollectionTemplate) {
	t.Helper()
	ctx := context.Background()
	exporters := repository.NewExporterTemplateRepository(gormDB)
	exporter := &domain.ExporterTemplate{
		Name: "node-exporter", DefaultPort: 9100, MetricsPath: "/metrics",
		Scheme: domain.SchemeHTTP, OS: "any", Arch: "any", Source: domain.ExporterThirdParty,
	}
	require.NoError(t, exporters.Create(ctx, exporter))

	template := &domain.CollectionTemplate{
		Code: "host_linux", Name: "Linux 主机采集", ResourceCategory: domain.CategoryHost,
		ExporterTemplateID: exporter.ID, DefaultPort: 9100, MetricsPath: "/metrics",
		Scheme: domain.SchemeHTTP, ScrapeInterval: "15s", ScrapeTimeout: "10s",
		DefaultSelector: domain.Selector{Logic: domain.RuleLogicAll, Filters: []domain.ScopeFilter{
			{Field: "os_family", Operator: domain.RuleOpEq, Values: []string{"linux"}},
		}},
		Enabled: true, IsBuiltin: true,
	}
	require.NoError(t, repository.NewCollectionTemplateRepository(gormDB).Create(ctx, template))
	return exporter, template
}

// newTemplateService wires a CollectionTemplateService on top of the given DB.
func newTemplateService(gormDB *gorm.DB) *CollectionTemplateService {
	return NewCollectionTemplateService(
		repository.NewCollectionTemplateRepository(gormDB),
		repository.NewExporterTemplateRepository(gormDB),
		references.NewLabelTemplateReader(gormDB),
	)
}
