package db

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigrateV3Lifecycle(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3.db")

	require.NoError(t, MigrateV3("sqlite", dsn), "apply v3 migrations")

	sqlDB, err := sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	defer sqlDB.Close()

	requireTableCount(t, sqlDB, "schema_meta", 1)
	// 00000 baseline: shared reference / identity tables.
	for _, table := range []string{
		"tenants", "network_domains", "zone_types", "business_domains",
		"application_dicts", "platform_dicts", "cloud_dicts",
		"users", "sessions", "login_logs",
	} {
		requireTableCount(t, sqlDB, table, 1)
	}
	requireTableCount(t, sqlDB, "resources", 1)
	requireTableCount(t, sqlDB, "host_resources", 1)
	requireTableCount(t, sqlDB, "import_records", 1)

	// Up is idempotent: a second run must not fail or duplicate rows.
	require.NoError(t, MigrateV3("sqlite", dsn), "second apply should be a no-op")
	require.NoError(t, MigrateV3Status("sqlite", dsn), "status should be readable")

	// 00004 is the latest migration; one Down restores the old network-domain
	// constraint shape but keeps every table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M06 domain administration migration")
	requireTableCount(t, sqlDB, "import_records", 1)
	requireTableCount(t, sqlDB, "resources", 1)
	requireTableCount(t, sqlDB, "network_domains", 1)

	// 00003 is now the latest; second Down drops import_records only.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback import records migration")
	requireTableCount(t, sqlDB, "import_records", 0)
	requireTableCount(t, sqlDB, "resources", 1)

	// 00002 is now the latest; third Down drops the resource schema.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback resource schema")
	requireTableCount(t, sqlDB, "resources", 0)
	requireTableCount(t, sqlDB, "schema_meta", 1)

	// 00001 is now the latest; fourth Down removes the baseline marker.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback baseline migration")
	requireTableCount(t, sqlDB, "schema_meta", 0)
	requireTableCount(t, sqlDB, "tenants", 1)

	// 00000 is now the latest; fifth Down removes the platform core schema.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback platform core migration")
	requireTableCount(t, sqlDB, "tenants", 0)
	requireTableCount(t, sqlDB, "network_domains", 0)
	requireTableCount(t, sqlDB, "users", 0)
}

func TestMigrateV3ForeignKeysEnabled(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_fk.db")

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	var enabled int
	require.NoError(t, sqlDB.QueryRow(`PRAGMA foreign_keys`).Scan(&enabled))
	require.Equal(t, 1, enabled, "foreign_keys must be enabled by the migration connection")
}

func TestMigrateV3ResourceConstraints(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_constraints.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	// Reference tables are owned by M00/M06 and created by 00000; seed the
	// rows required by the resource foreign keys.
	for _, stmt := range []string{
		`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`,
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status) VALUES ('mc-demo','演示采集域','edge','platform_admin','agent_pull','enabled')`,
		`INSERT INTO business_domains(code,name) VALUES ('payment','支付')`,
		`INSERT INTO application_dicts(app_code,app_name) VALUES ('order-service','订单服务')`,
		`INSERT INTO platform_dicts(platform_code,platform_name) VALUES ('ecommerce','电商平台')`,
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
		"res-1", "host", "platform_admin", "mc-demo", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"host|mc-demo|10.0.0.1",
	)
	require.NoError(t, err)

	// Duplicate dedup_key in the same category must be rejected by the DB.
	_, err = sqlDB.Exec(insertResource,
		"res-2", "host", "platform_admin", "mc-demo", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"host|mc-demo|10.0.0.1",
	)
	require.Error(t, err, "duplicate dedup_key must fail")

	// Invalid category is rejected by CHECK.
	_, err = sqlDB.Exec(insertResource,
		"res-3", "unknown", "platform_admin", "mc-demo", "payment", "order-service",
		"ecommerce", "PRD", "prod-a", "ops", "online", "manual", 0,
		"unknown|mc-demo|x",
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

func TestMigrateV3M06DomainAdministration(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_m06_domain.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	// Roll back only 00004 to simulate a pre-M06 v3 database.
	require.NoError(t, MigrateV3DownTo("sqlite", dsn, 3))

	sqlDB, err := sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO tenants(id,name,status) VALUES ('platform_admin','平台默认租户','active')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO business_domains(code,name) VALUES ('payment','支付')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO application_dicts(app_code,app_name) VALUES ('order-service','订单服务')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO platform_dicts(platform_code,platform_name) VALUES ('ecommerce','电商平台')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO network_domains(
			id,name,description,domain_type,zone_type,cloud_code,tenant_id,
			authorized_tenant_ids,channel,token,is_monitored,registration_status,status
		) VALUES (
			'default','中心直连域','v3 core seed：中心同机部署的默认管理域','management',
			'internet','PUB-TX','platform_admin','["platform_admin"]','local','tok',1,'monitored','enabled'
		)`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`
		INSERT INTO resources(
			resource_id, resource_category, tenant_id, network_domain_id,
			biz_code, app_code, platform_code, env, cluster, owner, status,
			source_type, scrape_port, dedup_key
		) VALUES (
			'res-1','host','platform_admin','default','payment','order-service',
			'ecommerce','PRD','prod-a','ops','online','manual',0,
			'host|default|10.0.0.1'
		)`)
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	require.NoError(t, MigrateV3("sqlite", dsn), "apply M06 domain administration migration")

	sqlDB, err = sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	defer sqlDB.Close()

	var domainType, channel, name, token, registrationStatus string
	var isMonitored bool
	require.NoError(t, sqlDB.QueryRow(`
		SELECT domain_type, channel, name, token, is_monitored, registration_status
		FROM network_domains WHERE id = 'default'
	`).Scan(&domainType, &channel, &name, &token, &isMonitored, &registrationStatus))
	assert.Equal(t, "edge", domainType)
	assert.Equal(t, "agent_pull", channel)
	assert.Equal(t, "默认采集域（历史迁移）", name)
	assert.Empty(t, token)
	assert.False(t, isMonitored)
	assert.Equal(t, "created", registrationStatus)

	var resourceCount int
	require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM resources WHERE resource_id = 'res-1'`).Scan(&resourceCount))
	assert.Equal(t, 1, resourceCount, "existing resources must survive the table rebuild")

	rows, err := sqlDB.Query(`PRAGMA foreign_key_check`)
	require.NoError(t, err)
	assert.False(t, rows.Next(), "network domain rebuild must not leave dangling foreign keys")
	require.NoError(t, rows.Err())
	require.NoError(t, rows.Close())

	// management is no longer an accepted domain_type.
	_, err = sqlDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status)
		VALUES ('legacy-mgmt','旧管理域','management','platform_admin','local','enabled')`)
	require.Error(t, err, "management domain_type must be rejected")

	// The old single-management index is gone; new indexes are present and the
	// management guard triggers are installed.
	for _, tc := range []struct {
		kind string
		name string
		want int
	}{
		{"index", "idx_network_domains_single_management", 0},
		{"index", "idx_network_domains_status", 1},
		{"index", "idx_network_domains_cloud_zone", 1},
		{"index", "idx_login_logs_username_created_at", 1},
		{"index", "idx_login_logs_success", 1},
		{"trigger", "trg_network_domains_no_management_insert", 1},
		{"trigger", "trg_network_domains_no_management_update", 1},
	} {
		var count int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM sqlite_master WHERE type=? AND name=?`, tc.kind, tc.name,
		).Scan(&count))
		assert.Equal(t, tc.want, count, tc.name)
	}

	// Down restores the historical constraint so legacy rows can be written
	// again during a rollback window.
	require.NoError(t, sqlDB.Close())
	require.NoError(t, MigrateV3Down("sqlite", dsn))

	sqlDB, err = sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status)
		VALUES ('legacy-mgmt-2','旧管理域','management','platform_admin','local','enabled')`)
	require.NoError(t, err, "Down must restore the historical management/edge CHECK")
}

func TestParseMigrationName(t *testing.T) {
	cases := []struct {
		filename string
		driver   string
		version  int64
		name     string
		ok       bool
		wantErr  bool
	}{
		{"00000_m00_platform_core.sqlite.sql", "sqlite", 0, "m00_platform_core", true, false},
		{"00000_m00_platform_core.postgres.sql", "postgres", 0, "m00_platform_core", true, false},
		{"00000_m00_platform_core.postgres.sql", "sqlite", 0, "", false, false},
		{"00001_schema_meta.sql", "postgres", 1, "schema_meta", true, false},
		{"00002_m07_resources.sql", "sqlite", 2, "m07_resources", true, false},
		{"schema_meta.sql", "sqlite", 0, "", false, true},
		{"x_schema.sql", "sqlite", 0, "", false, true},
		{"-1_bad.sql", "sqlite", 0, "", false, true},
		{"00003_.sql", "sqlite", 0, "", false, true},
	}
	for _, tc := range cases {
		version, name, ok, err := parseMigrationName(tc.filename, tc.driver)
		if tc.wantErr {
			assert.Error(t, err, tc.filename)
			continue
		}
		require.NoError(t, err, tc.filename)
		assert.Equal(t, tc.ok, ok, tc.filename)
		if tc.ok {
			assert.Equal(t, tc.version, version, tc.filename)
			assert.Equal(t, tc.name, name, tc.filename)
		}
	}
}

func TestSplitGooseSections(t *testing.T) {
	up, down := splitGooseSections("-- header\n-- +goose Up\nCREATE TABLE a (id INT);\n-- +goose Down\nDROP TABLE a;\n")
	assert.Equal(t, "CREATE TABLE a (id INT);", up)
	assert.Equal(t, "DROP TABLE a;", down)

	up, down = splitGooseSections("CREATE TABLE only_up (id INT);")
	assert.Equal(t, "CREATE TABLE only_up (id INT);", up)
	assert.Empty(t, down)
}

func requireTableCount(t *testing.T, sqlDB *sql.DB, table string, want int) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?`, table,
	).Scan(&count))
	require.Equal(t, want, count, "table %s", table)
}
