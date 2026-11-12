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

	// 00005 M09 edge-platform tables.
	for _, table := range []string{
		"network_domain_access", "edge_agents", "edge_heartbeats",
		"edge_target_snapshots", "domain_config_snapshots",
	} {
		requireTableCount(t, sqlDB, table, 1)
	}

	// Up is idempotent: a second run must not fail or duplicate rows.
	require.NoError(t, MigrateV3("sqlite", dsn), "second apply should be a no-op")
	require.NoError(t, MigrateV3Status("sqlite", dsn), "status should be readable")

	// 00005 is the latest; one Down drops the M09 edge-platform tables but
	// keeps every M00/M06/M07 table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 edge platform migration")
	for _, table := range []string{
		"network_domain_access", "edge_agents", "edge_heartbeats",
		"edge_target_snapshots", "domain_config_snapshots",
	} {
		requireTableCount(t, sqlDB, table, 0)
	}
	requireTableCount(t, sqlDB, "import_records", 1)
	requireTableCount(t, sqlDB, "resources", 1)
	requireTableCount(t, sqlDB, "network_domains", 1)

	// 00004 is now the latest; one Down restores the old network-domain
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
	// again during a rollback window. 00005 is the latest migration, so the
	// first Down drops the M09 edge-platform tables; the second rolls back
	// 00004 and restores the old network_domains CHECK.
	require.NoError(t, sqlDB.Close())
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 edge platform migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M06 domain administration migration")

	sqlDB, err = sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status)
		VALUES ('legacy-mgmt-2','旧管理域','management','platform_admin','local','enabled')`)
	require.NoError(t, err, "Down must restore the historical management/edge CHECK")
}

func TestMigrateV3M09EdgePlatform(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_m09_edge.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	defer sqlDB.Close()

	// Seed the reference rows owned by M00/M06 (created by 00000 / 00004).
	const seedDomain = `INSERT INTO network_domains(
			id,name,domain_type,tenant_id,authorized_tenant_ids,channel,status
		) VALUES (
			'dom-edge','演示采集域','edge','platform_admin','["platform_admin"]','agent_pull','enabled'
		)`
	_, err = sqlDB.Exec(seedDomain)
	require.NoError(t, err)

	// --- network_domain_access: 1:1 FK cascade + PK uniqueness ---
	_, err = sqlDB.Exec(
		`INSERT INTO network_domain_access(domain_id, token_hash, registration_status)
		 VALUES ('missing-domain','h','created')`)
	require.Error(t, err, "FK to non-existent network_domain must fail")

	_, err = sqlDB.Exec(
		`INSERT INTO network_domain_access(domain_id, token_hash, registration_status, token_masked)
		 VALUES ('dom-edge','deadbeef','monitored','ab****89')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(
		`INSERT INTO network_domain_access(domain_id, token_hash, registration_status)
		 VALUES ('dom-edge','other','created')`)
	require.Error(t, err, "duplicate domain_id (1:1) must fail")

	// --- edge_agents: partial unique (domain, hostname) WHERE deleted_at IS NULL ---
	insertAgent := `INSERT INTO edge_agents(network_domain_id, hostname, status) VALUES (?,?,?)`
	_, err = sqlDB.Exec(insertAgent, "dom-edge", "node-1", "online")
	require.NoError(t, err)
	_, err = sqlDB.Exec(insertAgent, "dom-edge", "node-1", "offline")
	require.Error(t, err, "duplicate active hostname in domain must fail")

	// Invalid status rejected by CHECK.
	_, err = sqlDB.Exec(insertAgent, "dom-edge", "node-x", "bogus")
	require.Error(t, err, "invalid agent status must fail")

	// Soft-deleting frees the hostname for re-registration.
	_, err = sqlDB.Exec(`UPDATE edge_agents SET deleted_at = '2026-01-01 00:00:00' WHERE hostname = 'node-1'`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(insertAgent, "dom-edge", "node-1", "online")
	require.NoError(t, err, "hostname reusable after soft-delete")

	// --- edge_heartbeats: FK on network_domain_id ---
	_, err = sqlDB.Exec(
		`INSERT INTO edge_heartbeats(network_domain_id, edge_agent_id, timestamp)
		 VALUES ('missing-domain', 1, '2026-01-01 00:00:00')`)
	require.Error(t, err, "heartbeat FK to non-existent domain must fail")
	_, err = sqlDB.Exec(
		`INSERT INTO edge_heartbeats(network_domain_id, edge_agent_id, hostname, timestamp)
		 VALUES ('dom-edge', 1, 'node-1', '2026-01-01 00:00:00')`)
	require.NoError(t, err)

	// --- edge_target_snapshots: unique cover (domain, job, instance) ---
	insertTarget := `INSERT INTO edge_target_snapshots(
			network_domain_id, edge_agent_id, job, instance, health, last_report_at
		) VALUES (?,?,?,?,?,?)`
	_, err = sqlDB.Exec(insertTarget, "dom-edge", 1, "node", "10.0.0.1:9100", "up", "2026-01-01 00:00:00")
	require.NoError(t, err)
	_, err = sqlDB.Exec(insertTarget, "dom-edge", 1, "node", "10.0.0.1:9100", "down", "2026-01-01 00:00:01")
	require.Error(t, err, "duplicate target cover key must fail")

	// --- domain_config_snapshots: partial unique is_current + unique (domain, version) ---
	insertSnapshot := `INSERT INTO domain_config_snapshots(
			network_domain_id, version, checksum, content_type, validation_status, validation_cause, is_current
		) VALUES (?,?,?,?,?,?,?)`
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge", "v1", "c1", "full", "passed", "none", 1)
	require.NoError(t, err)
	// A second is_current in the same domain is rejected by the partial unique index.
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge", "v2", "c2", "full", "passed", "none", 1)
	require.Error(t, err, "only one is_current per domain")
	// Non-current rows are allowed.
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge", "v2", "c2", "full", "passed", "none", 0)
	require.NoError(t, err)
	// Duplicate version in the same domain is rejected.
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge", "v2", "c3", "full", "passed", "none", 0)
	require.Error(t, err, "duplicate version in domain must fail")
	// Same version in a different domain is allowed (seeded second domain below).
	_, err = sqlDB.Exec(
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,channel,status)
		 VALUES ('dom-edge-2','采集域二','edge','platform_admin','agent_pull','enabled')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge-2", "v2", "c2", "full", "passed", "none", 0)
	require.NoError(t, err, "same version across domains is allowed")

	// Invalid validation_cause rejected by CHECK.
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge-2", "v3", "c3", "full", "passed", "bogus", 0)
	require.Error(t, err, "invalid validation_cause must fail")

	// --- FK cascade: deleting the domain removes all M09 child rows ---
	// network_domain_access uses domain_id as its FK column (1:1 PK); the other
	// four tables use network_domain_id.
	cascadeCases := []struct{ table, col string }{
		{"network_domain_access", "domain_id"},
		{"edge_agents", "network_domain_id"},
		{"edge_heartbeats", "network_domain_id"},
		{"edge_target_snapshots", "network_domain_id"},
		{"domain_config_snapshots", "network_domain_id"},
	}
	for _, c := range cascadeCases {
		var n int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM `+c.table+` WHERE `+c.col+` = 'dom-edge'`,
		).Scan(&n), c.table)
		assert.Greater(t, n, 0, "precondition: %s has rows for dom-edge", c.table)
	}
	_, err = sqlDB.Exec(`DELETE FROM network_domains WHERE id = 'dom-edge'`)
	require.NoError(t, err)
	for _, c := range cascadeCases {
		var n int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM `+c.table+` WHERE `+c.col+` = 'dom-edge'`,
		).Scan(&n), c.table)
		assert.Equal(t, 0, n, "%s should cascade-delete with network_domains", c.table)
	}

	rows, err := sqlDB.Query(`PRAGMA foreign_key_check`)
	require.NoError(t, err)
	assert.False(t, rows.Next(), "00005 must not leave dangling foreign keys")
	require.NoError(t, rows.Err())
	require.NoError(t, rows.Close())

	// --- Down: roll back 00005 only; M06 administrative data stays ---
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 edge platform migration")
	for _, table := range []string{
		"network_domain_access", "edge_agents", "edge_heartbeats",
		"edge_target_snapshots", "domain_config_snapshots",
	} {
		requireTableCount(t, sqlDB, table, 0)
	}
	requireTableCount(t, sqlDB, "network_domains", 1)
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
