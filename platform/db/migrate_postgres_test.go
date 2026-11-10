package db

import (
	"database/sql"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3Postgres runs the v3 migration lifecycle against a disposable
// PostgreSQL database. Set METRIC_CENTER_TEST_POSTGRES_DSN to enable it, e.g.:
//
//	METRIC_CENTER_TEST_POSTGRES_DSN='postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable' \
//	  go test ./platform/db -run TestMigrateV3Postgres
//
// The target database must be disposable: the test applies and rolls back the
// v3 schema.
func TestMigrateV3Postgres(t *testing.T) {
	dsn := os.Getenv("METRIC_CENTER_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("METRIC_CENTER_TEST_POSTGRES_DSN not set; skipping PostgreSQL migration test")
	}

	require.NoError(t, MigrateV3("postgres", dsn))
	require.NoError(t, MigrateV3Status("postgres", dsn))

	sqlDB, err := openMigrationDB("postgres", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	requirePostgresTable(t, sqlDB, "resources", true)
	requirePostgresTable(t, sqlDB, "host_resources", true)

	require.NoError(t, MigrateV3Down("postgres", dsn))
	requirePostgresTable(t, sqlDB, "resources", false)

	require.NoError(t, MigrateV3Down("postgres", dsn))
	requirePostgresTable(t, sqlDB, "schema_meta", false)
}

func requirePostgresTable(t *testing.T, sqlDB *sql.DB, table string, want bool) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM information_schema.tables
		 WHERE table_schema = 'public' AND table_name = $1`, table,
	).Scan(&count))
	if want {
		require.Equal(t, 1, count, "table %s should exist", table)
	} else {
		require.Equal(t, 0, count, "table %s should not exist", table)
	}
}
