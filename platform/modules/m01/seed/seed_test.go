package seed

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"

	builtinseed "github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

func openSeedDB(t *testing.T) *gorm.DB {
	t.Helper()
	gormDB := testdb.Open(t)
	return gormDB
}

func countRows(t *testing.T, db *gorm.DB, table string) int64 {
	t.Helper()
	var count int64
	require.NoError(t, db.Table(table).Count(&count).Error)
	return count
}

func TestRunSeedsBuiltinsIdempotently(t *testing.T) {
	db := openSeedDB(t)

	require.NoError(t, Run(db))

	exporterCount := countRows(t, db, "m01_exporter_templates")
	assert.Equal(t, int64(len(models.BuiltinExporterTemplates())), exporterCount)
	assert.Equal(t, int64(len(domain.BuiltinCollectionTemplates())), countRows(t, db, "m01_collection_templates"))
	assert.Equal(t, int64(len(builtinseed.BuiltinMetricLibrary())), countRows(t, db, "m01_metric_library"))
	assert.Equal(t, int64(len(models.DefaultBlackboxModules())), countRows(t, db, "m01_probe_modules"))

	// Every seeded exporter is flagged built-in.
	var builtinExporters int64
	require.NoError(t, db.Table("m01_exporter_templates").Where("is_builtin = ?", true).Count(&builtinExporters).Error)
	assert.Equal(t, exporterCount, builtinExporters)

	// Every seeded template is built-in; the bound ones point at a real exporter
	// and are enabled, the unbound ones stay disabled until an admin binds one.
	var builtinTemplates int64
	require.NoError(t, db.Table("m01_collection_templates").Where("is_builtin = ?", true).Count(&builtinTemplates).Error)
	assert.Equal(t, int64(len(domain.BuiltinCollectionTemplates())), builtinTemplates)

	type templateRow struct {
		Code               string `gorm:"column:code"`
		ExporterTemplateID string `gorm:"column:exporter_template_id"`
		DefaultPort        int    `gorm:"column:default_port"`
		Enabled            bool   `gorm:"column:enabled"`
	}
	var rows []templateRow
	require.NoError(t, db.Table("m01_collection_templates").Order("code ASC").Find(&rows).Error)
	for _, row := range rows {
		if row.ExporterTemplateID == "" {
			assert.False(t, row.Enabled, "template %q has no exporter bound and must be disabled", row.Code)
			continue
		}
		assert.True(t, row.Enabled, "template %q is bound to an exporter and must be usable", row.Code)
		var exporterCount int64
		require.NoError(t, db.Table("m01_exporter_templates").
			Where("id = ?", row.ExporterTemplateID).Count(&exporterCount).Error)
		assert.Equal(t, int64(1), exporterCount, "template %q must reference a seeded exporter", row.Code)
	}

	// host_linux keeps the seeded OS selector so the wizard prefills correctly.
	var selector string
	require.NoError(t, db.Table("m01_collection_templates").
		Select("default_selector").Where("code = ?", domain.TemplateHostLinux).Scan(&selector).Error)
	assert.Contains(t, selector, "os_family")

	// A second run is a no-op: no duplicates, no errors.
	require.NoError(t, Run(db))
	assert.Equal(t, exporterCount, countRows(t, db, "m01_exporter_templates"))
	assert.Equal(t, int64(len(domain.BuiltinCollectionTemplates())), countRows(t, db, "m01_collection_templates"))
	assert.Equal(t, int64(len(builtinseed.BuiltinMetricLibrary())), countRows(t, db, "m01_metric_library"))
	assert.Equal(t, int64(len(models.DefaultBlackboxModules())), countRows(t, db, "m01_probe_modules"))
}

func TestRunRejectsNilDB(t *testing.T) {
	require.Error(t, Run(nil))
}

// The seed is create-only: a template the user edited, renamed or disabled must
// survive a restart untouched (NFR-11 idempotent seed).
func TestRunDoesNotClobberUserEditedTemplate(t *testing.T) {
	db := openSeedDB(t)

	// Pre-create a user-owned override of the built-in host_linux recipe.
	require.NoError(t, db.Exec(`INSERT INTO m01_collection_templates(
		code,name,resource_category,metrics_path,scheme,scrape_interval,scrape_timeout,
		default_selector,description,sort_order,enabled,is_builtin
	) VALUES ('host_linux','我的 Linux 采集','host','/custom-metrics','http','30s','10s',
		'{"logic":"all","filters":[]}','用户自定义',900,FALSE,FALSE)`).Error)

	require.NoError(t, Run(db))

	var row struct {
		Name        string `gorm:"column:name"`
		MetricsPath string `gorm:"column:metrics_path"`
		Enabled     bool   `gorm:"column:enabled"`
		IsBuiltin   bool   `gorm:"column:is_builtin"`
	}
	require.NoError(t, db.Table("m01_collection_templates").
		Select("name, metrics_path, enabled, is_builtin").
		Where("code = ?", domain.TemplateHostLinux).Scan(&row).Error)

	assert.Equal(t, "我的 Linux 采集", row.Name, "seed must not replace an existing template")
	assert.Equal(t, "/custom-metrics", row.MetricsPath)
	assert.False(t, row.Enabled, "seed must not re-enable a disabled template")
	assert.False(t, row.IsBuiltin, "seed must not flip the built-in flag of an existing row")

	// Only the missing built-ins were added.
	assert.Equal(t, int64(len(domain.BuiltinCollectionTemplates())), countRows(t, db, "m01_collection_templates"))
}

// A default template binding is data, so the seed must be the only writer: the
// shipped bindings are exactly the ones the module bootstrap expects.
func TestDefaultTemplatesBindExporterNames(t *testing.T) {
	known := map[string]bool{}
	for _, exporter := range models.BuiltinExporterTemplates() {
		known[exporter.Name] = true
	}

	unbound := map[string]bool{}
	templates := DefaultTemplates()
	require.Len(t, templates, len(domain.BuiltinCollectionTemplates()))

	for _, item := range templates {
		_, ok := domain.BuiltinCollectionTemplate(item.Code)
		require.True(t, ok, "seed code %q must exist in the domain catalogue", item.Code)
		require.NotEmpty(t, item.MetricsPath)
		require.NotEmpty(t, item.ScrapeInterval)
		require.NotEmpty(t, item.ScrapeTimeout)
		if item.Exporter == "" {
			assert.True(t, item.Unbound, "a binding without an exporter must be marked unbound")
			unbound[item.Code] = true
			continue
		}
		assert.True(t, known[item.Exporter], "exporter %q is not in the built-in pool", item.Exporter)
		assert.Greater(t, item.DefaultPort, 0, "a bound template needs a default port")
	}

	// The four recipes without a built-in implementation ship disabled (FR-21).
	assert.Equal(t, map[string]bool{
		"host_npu":         true,
		"elasticsearch":    true,
		"nginx":            true,
		"application_http": true,
	}, unbound)
}
