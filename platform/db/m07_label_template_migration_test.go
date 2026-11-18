package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3M07LabelTemplates validates the 00007 schema: table, unique
// name+category, single default per category and rollback.
func TestMigrateV3M07LabelTemplates(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_m07_label.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	requireTableCount(t, sqlDB, "m07_label_templates", 1)

	// Name + category uniqueness among live rows.
	_, err = sqlDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-1','host-default','host')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-2','host-default','host')`)
	require.Error(t, err, "duplicate name in the same category must fail")
	_, err = sqlDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-3','host-default','database')`)
	require.NoError(t, err, "the same name is allowed in another category")

	// Soft-deleted names can be reused.
	_, err = sqlDB.Exec(`UPDATE m07_label_templates SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'lt-1'`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-4','host-default','host')`)
	require.NoError(t, err, "soft-deleted name can be reused")

	// One default per category.
	_, err = sqlDB.Exec(`UPDATE m07_label_templates SET is_default = TRUE WHERE id = 'lt-4'`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category,is_default)
		VALUES ('lt-5','host-other','host',TRUE)`)
	require.Error(t, err, "second default in the same category must fail")

	// Category enum is enforced.
	_, err = sqlDB.Exec(`INSERT INTO m07_label_templates(id,name,resource_category)
		VALUES ('lt-6','bad','kubernetes')`)
	require.Error(t, err, "unknown category must be rejected")

	// Down: skip migrations newer than 0012 (0014 legacy column drop is an
	// intentional no-op, 0015 M01 nullable FKs), then drops 00010 (M05
	// dashboard), 00009 (M08 alerting), 00008 (center rules) then 00007;
	// M01/M09/M06 tables stay.
	rollbackV3To(t, dsn, 12)
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M01 job groups migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 dictionary lifecycle migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M05 dashboard migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M08 alerting migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 center rules migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 label templates migration")
	requireTableCount(t, sqlDB, "m07_label_templates", 0)
	requireTableCount(t, sqlDB, "m01_scrape_jobs", 1)
	requireTableCount(t, sqlDB, "config_snapshots", 1)
}
