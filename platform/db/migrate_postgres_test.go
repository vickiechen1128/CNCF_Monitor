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
// v3 schema. Rollback uses version targets instead of fixed step counts so the
// test stays correct as postgres-only migrations are added.
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

	requirePostgresTable(t, sqlDB, "tenants", true)
	requirePostgresTable(t, sqlDB, "network_domains", true)
	requirePostgresTable(t, sqlDB, "users", true)
	requirePostgresTable(t, sqlDB, "resources", true)
	requirePostgresTable(t, sqlDB, "host_resources", true)
	requirePostgresTable(t, sqlDB, "import_records", true)

	// 0013 is postgres-only (aligns domain_type CHECK); rolling back to 12
	// exercises its Down without disturbing earlier tables.
	require.NoError(t, MigrateV3DownTo("postgres", dsn, 12))
	requirePostgresTable(t, sqlDB, "m01_job_groups", true)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, 11))
	requirePostgresTable(t, sqlDB, "m01_job_groups", false)
	requirePostgresTable(t, sqlDB, "m01_scrape_jobs", true)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, 10))
	requirePostgresTable(t, sqlDB, "m07_dictionary_audit_logs", false)
	requirePostgresTable(t, sqlDB, "m05_dashboard_panels", true)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, 9))
	requirePostgresTable(t, sqlDB, "m05_dashboard_panels", false)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, 2))
	requirePostgresTable(t, sqlDB, "import_records", false)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, 1))
	requirePostgresTable(t, sqlDB, "resources", false)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, 0))
	requirePostgresTable(t, sqlDB, "schema_meta", false)
	requirePostgresTable(t, sqlDB, "tenants", true)

	require.NoError(t, MigrateV3DownTo("postgres", dsn, -1))
	requirePostgresTable(t, sqlDB, "tenants", false)
	requirePostgresTable(t, sqlDB, "network_domains", false)
	requirePostgresTable(t, sqlDB, "users", false)
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
