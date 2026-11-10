package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMigrateV3Lifecycle(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3.db")

	require.NoError(t, MigrateV3(dsn), "apply v3 migrations")

	sqlDB, err := sql.Open("sqlite3", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_meta'`,
	).Scan(&count))
	require.Equal(t, 1, count, "schema_meta should exist after Up")

	// Up is idempotent: a second run must not fail or duplicate rows.
	require.NoError(t, MigrateV3(dsn), "second apply should be a no-op")
	require.NoError(t, MigrateV3Status(dsn), "status should be readable")

	require.NoError(t, MigrateV3Down(dsn), "rollback one migration")
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_meta'`,
	).Scan(&count))
	require.Equal(t, 0, count, "schema_meta should be gone after Down")
}

func TestMigrateV3ForeignKeysEnabled(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_fk.db")

	sqlDB, err := openSQLiteForMigration(dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	var enabled int
	require.NoError(t, sqlDB.QueryRow(`PRAGMA foreign_keys`).Scan(&enabled))
	require.Equal(t, 1, enabled, "foreign_keys must be enabled by the migration connection")
}
