package references

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	platformdb "github.com/metriccenter/metriccenter/platform/db"
)

func openReferencesDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m01_references.db")
	require.NoError(t, platformdb.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
			VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}
	return gormDB
}

func TestLabelTemplateReader(t *testing.T) {
	gormDB := openReferencesDB(t)
	reader := NewLabelTemplateReader(gormDB)
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(`INSERT INTO m07_label_templates(
		id,name,resource_category,is_default
	) VALUES ('lt-1','host-default','host',TRUE)`).Error)

	ref, found, err := reader.Resolve(ctx, "lt-1")
	require.NoError(t, err)
	require.True(t, found)
	assert.Equal(t, "host-default", ref.Name)
	assert.Equal(t, "host", ref.Category)
	assert.True(t, ref.IsDefault)

	_, found, err = reader.Resolve(ctx, "missing")
	require.NoError(t, err)
	assert.False(t, found)

	// Soft-deleted templates are not resolvable.
	require.NoError(t, gormDB.Exec(`UPDATE m07_label_templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'lt-1'`).Error)
	_, found, err = reader.Resolve(ctx, "lt-1")
	require.NoError(t, err)
	assert.False(t, found)
}

func TestLabelTemplateUsageChecker(t *testing.T) {
	gormDB := openReferencesDB(t)
	checker := NewLabelTemplateUsageChecker(gormDB)
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(`INSERT INTO m01_exporter_templates(id,name) VALUES ('exp-1','node-exporter')`).Error)
	// label_template_id is a real FK to m07_label_templates(id).
	for _, id := range []string{"lt-1", "lt-2"} {
		require.NoError(t, gormDB.Exec(
			`INSERT INTO m07_label_templates(id,name,resource_category) VALUES (?, ?, 'host')`, id, "label-"+id).Error)
	}
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_ci_type_exporter_mappings(
		id,monitor_type,exporter_template_id,label_template_id
	) VALUES ('map-1','host_linux','exp-1','lt-1')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs(
		id,job_name,resource_category,network_domain_id,label_template_id
	) VALUES ('job-1','node','host','mc-demo','lt-1')`).Error)
	require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs(
		id,job_name,resource_category,network_domain_id,label_template_id
	) VALUES ('job-2','node-2','host','mc-demo','lt-2')`).Error)

	count, err := checker.CountReferences(ctx, "lt-1")
	require.NoError(t, err)
	assert.Equal(t, int64(2), count, "one mapping + one job")

	count, err = checker.CountReferences(ctx, "lt-2")
	require.NoError(t, err)
	assert.Equal(t, int64(1), count)

	// Soft-deleted references no longer block deletion.
	require.NoError(t, gormDB.Exec(`UPDATE m01_scrape_jobs SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'job-2'`).Error)
	count, err = checker.CountReferences(ctx, "lt-2")
	require.NoError(t, err)
	assert.Equal(t, int64(0), count)
}
