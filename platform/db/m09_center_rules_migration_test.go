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

	requireTableCount(t, sqlDB, "config_snapshots", 1)

	insertCenterSnapshot := `INSERT INTO config_snapshots(
		scope, scope_key, version, checksum, validation_status, is_current
	) VALUES ('center', 'center', ?, ?, ?, ?)`
	_, err = sqlDB.Exec(insertCenterSnapshot, "v1", "checksum-1", "passed", true)
	require.NoError(t, err)

	// Version is globally unique (one scope_key for all center snapshots).
	_, err = sqlDB.Exec(insertCenterSnapshot, "v1", "checksum-2", "failed", false)
	require.Error(t, err, "duplicate center snapshot version must fail")

	// One current snapshot at a time.
	_, err = sqlDB.Exec(insertCenterSnapshot, "v2", "checksum-2", "passed", true)
	require.Error(t, err, "second current center snapshot must fail")

	// A domain-scoped row may reuse the same version (scope is part of the key).
	_, err = sqlDB.Exec(`INSERT INTO config_snapshots(
		scope, scope_key, version, checksum, validation_status
	) VALUES ('domain', 'dom-a', 'v1', 'checksum-domain', 'passed')`)
	require.NoError(t, err, "same version across scopes is allowed")

	// Down: skip migrations newer than 0012 (0014 legacy column drop is an
	// intentional no-op, 0015 M01 nullable FKs), then drops 00010 (M05
	// dashboard), 00009 then 00008; M01/M07/M09 tables stay.
	rollbackV3To(t, dsn, 12)
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M01 job groups migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 dictionary lifecycle migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M05 dashboard migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M08 alerting migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 center rules migration")
	// The merged table survives the 0008 rollback (0016 Down is a no-op).
	requireTableCount(t, sqlDB, "config_snapshots", 1)
	requireTableCount(t, sqlDB, "m07_label_templates", 1)
	requireTableCount(t, sqlDB, "m01_scrape_jobs", 1)
}
