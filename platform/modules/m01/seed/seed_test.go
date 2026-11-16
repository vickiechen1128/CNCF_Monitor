package seed

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
	builtinseed "github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
)

func openSeedDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m01_seed.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
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
	assert.Equal(t, int64(len(DefaultMappings())), countRows(t, db, "m01_ci_type_exporter_mappings"))
	assert.Equal(t, int64(len(builtinseed.BuiltinMetricLibrary())), countRows(t, db, "m01_metric_library"))
	assert.Equal(t, int64(len(models.DefaultBlackboxModules())), countRows(t, db, "m01_probe_modules"))

	// Every seeded exporter is flagged built-in and has a default mapping.
	var builtinExporters int64
	require.NoError(t, db.Table("m01_exporter_templates").Where("is_builtin = ?", true).Count(&builtinExporters).Error)
	assert.Equal(t, exporterCount, builtinExporters)

	var defaults int64
	require.NoError(t, db.Table("m01_ci_type_exporter_mappings").Where("is_default = ?", true).Count(&defaults).Error)
	assert.Equal(t, int64(len(DefaultMappings())), defaults)

	// A second run is a no-op: no duplicates, no errors.
	require.NoError(t, Run(db))
	assert.Equal(t, exporterCount, countRows(t, db, "m01_exporter_templates"))
	assert.Equal(t, int64(len(DefaultMappings())), countRows(t, db, "m01_ci_type_exporter_mappings"))
	assert.Equal(t, int64(len(builtinseed.BuiltinMetricLibrary())), countRows(t, db, "m01_metric_library"))
	assert.Equal(t, int64(len(models.DefaultBlackboxModules())), countRows(t, db, "m01_probe_modules"))
}

func TestRunRejectsNilDB(t *testing.T) {
	require.Error(t, Run(nil))
}

func TestRunDoesNotClobberUserDefault(t *testing.T) {
	db := openSeedDB(t)

	// Pre-create a user default for host_linux that is not the built-in exporter.
	require.NoError(t, db.Exec(`INSERT INTO m01_exporter_templates(id,name) VALUES ('custom','my-node')`).Error)
	require.NoError(t, db.Exec(`INSERT INTO m01_ci_type_exporter_mappings(
		id,monitor_type,exporter_template_id,is_default
	) VALUES ('custom-map','host_linux','custom',TRUE)`).Error)

	require.NoError(t, Run(db))

	var exporterID string
	require.NoError(t, db.Table("m01_ci_type_exporter_mappings").
		Select("exporter_template_id").
		Where("monitor_type = ? AND is_default = ?", "host_linux", true).
		Scan(&exporterID).Error)
	assert.Equal(t, "custom", exporterID, "seed must not replace an existing default")
}
