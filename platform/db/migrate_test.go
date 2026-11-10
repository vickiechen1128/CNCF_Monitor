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

	sqlDB, err := sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	defer sqlDB.Close()

	requireTableCount(t, sqlDB, "schema_meta", 1)
	requireTableCount(t, sqlDB, "resources", 1)
	requireTableCount(t, sqlDB, "host_resources", 1)

	// Up is idempotent: a second run must not fail or duplicate rows.
	require.NoError(t, MigrateV3(dsn), "second apply should be a no-op")
	require.NoError(t, MigrateV3Status(dsn), "status should be readable")

	// 00002 is the latest migration; one Down drops the resource schema.
	require.NoError(t, MigrateV3Down(dsn), "rollback latest migration")
	requireTableCount(t, sqlDB, "resources", 0)
	requireTableCount(t, sqlDB, "schema_meta", 1)

	// 00001 is now the latest; second Down removes the baseline marker.
	require.NoError(t, MigrateV3Down(dsn), "rollback baseline migration")
	requireTableCount(t, sqlDB, "schema_meta", 0)
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

func TestMigrateV3ResourceConstraints(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_constraints.db")
	require.NoError(t, MigrateV3(dsn))

	sqlDB, err := openSQLiteForMigration(dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	// Reference tables are owned by M00/M06; create minimal stubs for this test.
	for _, stmt := range []string{
		`CREATE TABLE tenants (id TEXT PRIMARY KEY)`,
		`CREATE TABLE network_domains (id TEXT PRIMARY KEY)`,
		`CREATE TABLE business_domains (code TEXT PRIMARY KEY)`,
		`CREATE TABLE application_dicts (app_code TEXT PRIMARY KEY)`,
		`CREATE TABLE platform_dicts (platform_code TEXT PRIMARY KEY)`,
		`INSERT INTO tenants(id) VALUES ('platform_admin')`,
		`INSERT INTO network_domains(id) VALUES ('default')`,
		`INSERT INTO business_domains(code) VALUES ('payment')`,
		`INSERT INTO application_dicts(app_code) VALUES ('order-service')`,
		`INSERT INTO platform_dicts(platform_code) VALUES ('ecommerce')`,
	} {
		_, err := sqlDB.Exec(stmt)
		require.NoError(t, err, stmt)
	}

	const insertResource = `
		INSERT INTO resources(
			resource_id, resource_category, tenant_id, network_domain_id,
			biz_code, app_code, platform_code, env, cluster, owner, status,
			source_type, scrape_port, dedup_key
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
	_, err = sqlDB.Exec(insertResource,
		"res-1", "host", "platform_admin", "default", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"host|default|10.0.0.1",
	)
	require.NoError(t, err)

	// Duplicate dedup_key in the same category must be rejected by the DB.
	_, err = sqlDB.Exec(insertResource,
		"res-2", "host", "platform_admin", "default", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"host|default|10.0.0.1",
	)
	require.Error(t, err, "duplicate dedup_key must fail")

	// Invalid category is rejected by CHECK.
	_, err = sqlDB.Exec(insertResource,
		"res-3", "unknown", "platform_admin", "default", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"unknown|default|x",
	)
	require.Error(t, err, "invalid resource_category must fail")

	// Missing network domain is rejected by FK.
	_, err = sqlDB.Exec(insertResource,
		"res-4", "host", "platform_admin", "missing-domain", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"host|missing-domain|10.0.0.2",
	)
	require.Error(t, err, "missing network_domain must fail")

	// 1:1 extension row and cascade delete.
	_, err = sqlDB.Exec(
		`INSERT INTO host_resources(resource_id, hostname, instance_ip, os_type)
		 VALUES ('res-1', 'web-01', '10.0.0.1', 'linux')`,
	)
	require.NoError(t, err)

	_, err = sqlDB.Exec(`DELETE FROM resources WHERE resource_id = 'res-1'`)
	require.NoError(t, err)
	var hostCount int
	require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM host_resources WHERE resource_id = 'res-1'`).Scan(&hostCount))
	require.Equal(t, 0, hostCount, "extension row should cascade-delete")
}

func requireTableCount(t *testing.T, sqlDB *sql.DB, table string, want int) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
	).Scan(&count))
	require.Equal(t, want, count, "table %s", table)
}
