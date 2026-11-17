package db

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3M09CenterRules validates the 00008 center rules snapshot schema.
func TestMigrateV3M09CenterRules(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_center_rules.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	requireTableCount(t, sqlDB, "center_config_snapshots", 1)

	_, err = sqlDB.Exec(`INSERT INTO center_config_snapshots(
		version, checksum, validation_status, is_current
	) VALUES ('v1','checksum-1','passed',TRUE)`)
	require.NoError(t, err)

	// Version is globally unique.
	_, err = sqlDB.Exec(`INSERT INTO center_config_snapshots(
		version, checksum, validation_status
	) VALUES ('v1','checksum-2','failed')`)
	require.Error(t, err, "duplicate center snapshot version must fail")

	// One current snapshot at a time.
	_, err = sqlDB.Exec(`INSERT INTO center_config_snapshots(
		version, checksum, validation_status, is_current
	) VALUES ('v2','checksum-2','passed',TRUE)`)
	require.Error(t, err, "second current center snapshot must fail")

	// Down drops 00010 (M05 dashboard), 00009 then 00008; M01/M07/M09 tables
	// stay.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M05 dashboard migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M08 alerting migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 center rules migration")
	requireTableCount(t, sqlDB, "center_config_snapshots", 0)
	requireTableCount(t, sqlDB, "m07_label_templates", 1)
	requireTableCount(t, sqlDB, "m01_scrape_jobs", 1)
	requireTableCount(t, sqlDB, "domain_config_snapshots", 1)
}
