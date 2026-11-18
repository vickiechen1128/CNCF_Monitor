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

	// 00005 M09 edge-platform tables. Config snapshots were merged into the
	// single config_snapshots table by 0016 (the three legacy tables are gone).
	for _, table := range []string{
		"network_domain_access", "edge_agents", "edge_heartbeats",
		"edge_target_snapshots", "config_snapshots",
	} {
		requireTableCount(t, sqlDB, table, 1)
	}

	// 00006 M01 strategy tables.
	m01Tables := []string{
		"m01_exporter_templates", "m01_ci_type_exporter_mappings",
		"m01_scrape_jobs", "m01_monitoring_rules", "m01_metric_library",
		"m01_business_metrics", "m01_installations", "m01_probe_modules",
	}
	for _, table := range m01Tables {
		requireTableCount(t, sqlDB, table, 1)
	}
	// 00012 adds the job-group intent table on top of the M01 strategy tables.
	requireTableCount(t, sqlDB, "m01_job_groups", 1)

	requireTableCount(t, sqlDB, "m07_label_templates", 1)
	for _, table := range []string{
		"m08_notify_templates", "m08_notify_channels", "config_snapshots",
		"m08_reload_logs", "m08_alert_events", "m08_inhibition_rules", "m08_silence_audits",
	} {
		requireTableCount(t, sqlDB, table, 1)
	}

	// 00010 M05 dashboard panel registry.
	requireTableCount(t, sqlDB, "m05_dashboard_panels", 1)

	// Up is idempotent: a second run must not fail or duplicate rows.
	require.NoError(t, MigrateV3("sqlite", dsn), "second apply should be a no-op")
	require.NoError(t, MigrateV3Status("sqlite", dsn), "status should be readable")

	// Skip migrations newer than 0012 (0014 legacy column drop, 0015 optional
	// FKs): they are unrelated to the table chains asserted below.
	rollbackV3To(t, dsn, 12)
	requireTableCount(t, sqlDB, "network_domains", 1)

	// 00012 is the latest; one Down drops the M01 job groups table and restores
	// the global job-name index, while the scrape jobs table itself stays.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M01 job groups migration")
	requireTableCount(t, sqlDB, "m01_job_groups", 0)
	requireTableCount(t, sqlDB, "m01_scrape_jobs", 1)
	// 00011 is now the latest; one Down drops the M07 dictionary lifecycle.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 dictionary lifecycle migration")
	requireTableCount(t, sqlDB, "m07_dictionary_audit_logs", 0)
	// 00010 is now the latest; one Down drops the M05 dashboard panel registry only.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M05 dashboard migration")
	requireTableCount(t, sqlDB, "m05_dashboard_panels", 0)
	// config_snapshots (0016) survives every earlier rollback: its Down is a no-op.
	requireTableCount(t, sqlDB, "config_snapshots", 1)

	// 00009 is now the latest; one Down drops the M08 alerting tables.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M08 alerting migration")
	requireTableCount(t, sqlDB, "config_snapshots", 1)

	// 00008 is now the latest; one Down drops the center rules snapshot table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 center rules migration")
	requireTableCount(t, sqlDB, "config_snapshots", 1)
	requireTableCount(t, sqlDB, "m07_label_templates", 1)

	// 00007 is now the latest; one Down drops the M07 label template table but
	// keeps every M00/M06/M07/M09/M01 table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 label templates migration")
	requireTableCount(t, sqlDB, "m07_label_templates", 0)
	for _, table := range m01Tables {
		requireTableCount(t, sqlDB, table, 1)
	}

	// 00006 is now the latest; one Down drops the M01 strategy tables but keeps
	// every M00/M06/M07/M09 table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M01 strategy migration")
	for _, table := range m01Tables {
		requireTableCount(t, sqlDB, table, 0)
	}
	requireTableCount(t, sqlDB, "network_domain_access", 1)
	requireTableCount(t, sqlDB, "resources", 1)

	// 00005 is now the latest; one Down drops the M09 edge-platform tables but
	// keeps every M00/M06/M07 table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 edge platform migration")
	for _, table := range []string{
		"network_domain_access", "edge_agents", "edge_heartbeats",
		"edge_target_snapshots",
	} {
		requireTableCount(t, sqlDB, table, 0)
	}
	// The merged snapshot table is owned by 0016, not 00005, and its Down is a
	// no-op, so it remains after rolling back the M09 edge-platform migration.
	requireTableCount(t, sqlDB, "config_snapshots", 1)
	requireTableCount(t, sqlDB, "import_records", 1)
	requireTableCount(t, sqlDB, "resources", 1)
	requireTableCount(t, sqlDB, "network_domains", 1)

	// 00004 is now the latest; one Down restores the old network-domain
	// constraint shape but keeps every table.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M06 domain administration migration")
	requireTableCount(t, sqlDB, "import_records", 1)
	requireTableCount(t, sqlDB, "resources", 1)
	requireTableCount(t, sqlDB, "network_domains", 1)

	// 00003 is now the latest; one Down drops import_records only.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback import records migration")
	requireTableCount(t, sqlDB, "import_records", 0)
	requireTableCount(t, sqlDB, "resources", 1)

	// 00002 is now the latest; one Down drops the resource schema.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback resource schema")
	requireTableCount(t, sqlDB, "resources", 0)
	requireTableCount(t, sqlDB, "schema_meta", 1)

	// 00001 is now the latest; one Down removes the baseline marker.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback baseline migration")
	requireTableCount(t, sqlDB, "schema_meta", 0)
	requireTableCount(t, sqlDB, "tenants", 1)

	// 00000 is now the latest; one Down removes the platform core schema.
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback platform core migration")
	requireTableCount(t, sqlDB, "tenants", 0)
	requireTableCount(t, sqlDB, "network_domains", 0)
	requireTableCount(t, sqlDB, "users", 0)
}

// TestMigrateV3DropsLegacyDomainColumns locks the V3-only contract: migration
// 0014 removes the 11 legacy onboarding columns from network_domains so the
// authoritative state can only live in network_domain_access (M09).
func TestMigrateV3DropsLegacyDomainColumns(t *testing.T) {
	dsn := filepath.Join(t.TempDir(), "metric_center_v3_drop_legacy.db")
	require.NoError(t, MigrateV3("sqlite", dsn))

	sqlDB, err := sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	defer sqlDB.Close()

	for _, column := range []string{
		"channel", "token", "agent_type", "center_endpoint", "remote_write_url",
		"max_disk_usage_per_url", "monitored_status", "last_heartbeat",
		"agent_version", "is_monitored", "registration_status",
	} {
		var count int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM pragma_table_info('network_domains') WHERE name = ?`, column,
		).Scan(&count))
		assert.Zero(t, count, "legacy column network_domains.%s must be dropped", column)
	}

	// The administrative columns must survive.
	for _, column := range []string{
		"id", "name", "description", "domain_type", "zone_type", "cloud_code",
		"tenant_id", "authorized_tenant_ids", "ip_c_id_rs", "status",
		"created_at", "updated_at", "deleted_at",
	} {
		var count int
		require.NoError(t, sqlDB.QueryRow(
			`SELECT count(*) FROM pragma_table_info('network_domains') WHERE name = ?`, column,
		).Scan(&count))
		assert.Equal(t, 1, count, "administrative column network_domains.%s must remain", column)
	}

	// Runtime state is owned by the M09 access table.
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM pragma_table_info('network_domain_access') WHERE name = 'registration_status'`,
	).Scan(&count))
	assert.Equal(t, 1, count, "network_domain_access.registration_status must exist")
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
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status) VALUES ('mc-demo','演示采集域','edge','platform_admin','enabled')`,
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

	// Build a pre-M06 (00000..00003) v3 schema by applying only those Up
	// sections. 0014 drops the legacy columns irreversibly, so rolling back a
	// fully migrated DB can no longer recreate the pre-00004 state this test
	// exercises. Applying the raw Up sections keeps 00004's transformation
	// covered without depending on that removed schema.
	migrations, err := loadV3Migrations("sqlite")
	require.NoError(t, err)
	var up00004, down00004 string
	for _, m := range migrations {
		switch m.version {
		case 4:
			up00004, down00004 = m.up, m.down
		case 1, 2, 3:
			// applied in the loop below
		}
	}
	require.NotEmpty(t, up00004, "00004 Up section must exist")

	migDB, err := openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	for _, m := range migrations {
		if m.version > 3 {
			continue
		}
		_, err := migDB.Exec(m.up)
		require.NoError(t, err, "apply migration %d", m.version)
	}
	require.NoError(t, migDB.Close())

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

	// Apply 00004 directly to the pre-M06 schema.
	migDB, err = openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	_, err = migDB.Exec(up00004)
	require.NoError(t, err)
	require.NoError(t, migDB.Close())

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
	assert.Equal(t, 1, resourceCount, "existing resources must survive the M06 cleanup")

	rows, err := sqlDB.Query(`PRAGMA foreign_key_check`)
	require.NoError(t, err)
	assert.False(t, rows.Next(), "M06 cleanup must not leave dangling foreign keys")
	require.NoError(t, rows.Err())
	require.NoError(t, rows.Close())

	// management is no longer an accepted domain_type.
	_, err = sqlDB.Exec(`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		VALUES ('legacy-mgmt','旧管理域','management','platform_admin','enabled')`)
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

	// 00004's Down restores the historical constraint so legacy rows can be
	// written again during a rollback window.
	require.NoError(t, sqlDB.Close())
	migDB, err = openMigrationDB("sqlite", dsn)
	require.NoError(t, err)
	_, err = migDB.Exec(down00004)
	require.NoError(t, err)
	require.NoError(t, migDB.Close())

	sqlDB, err = sql.Open("sqlite3", sqliteDSNWithForeignKeys(dsn))
	require.NoError(t, err)
	defer sqlDB.Close()
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
			id,name,domain_type,tenant_id,authorized_tenant_ids,status
		) VALUES (
			'dom-edge','演示采集域','edge','platform_admin','["platform_admin"]','enabled'
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

	// --- config_snapshots (domain scope): partial unique is_current + unique
	// (scope, scope_key, version). scope_key holds the network domain id. ---
	insertSnapshot := `INSERT INTO config_snapshots(
			scope, scope_key, version, checksum, content_type, validation_status, validation_cause, is_current
		) VALUES ('domain', ?, ?, ?, ?, ?, ?, ?)`
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
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		 VALUES ('dom-edge-2','采集域二','edge','platform_admin','enabled')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge-2", "v2", "c2", "full", "passed", "none", 0)
	require.NoError(t, err, "same version across domains is allowed")
	// The same version is also allowed in a different scope (center/alertmanager).
	_, err = sqlDB.Exec(`INSERT INTO config_snapshots(scope, scope_key, version, checksum, is_current)
		VALUES ('center', 'center', 'v1', 'c-center', FALSE)`)
	require.NoError(t, err, "same version across scopes is allowed")

	// Invalid validation_cause rejected by CHECK.
	_, err = sqlDB.Exec(insertSnapshot, "dom-edge-2", "v3", "c3", "full", "passed", "bogus", 0)
	require.Error(t, err, "invalid validation_cause must fail")

	// --- FK cascade: deleting the domain removes all M09 child rows ---
	// network_domain_access uses domain_id as its FK column (1:1 PK); the other
	// three tables use network_domain_id. config_snapshots is no longer an M09
	// child table (0016 merged it with a free-form scope_key), so it is not
	// cascade-deleted here; the onboarding service clears domain rows on retire.
	cascadeCases := []struct{ table, col string }{
		{"network_domain_access", "domain_id"},
		{"edge_agents", "network_domain_id"},
		{"edge_heartbeats", "network_domain_id"},
		{"edge_target_snapshots", "network_domain_id"},
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

	// --- Down: skip migrations newer than 0012 (0014 legacy column drop is an
	// intentional no-op, 0015 M01 nullable FKs), then roll back 00012 (M01 job
	// groups), 00010 (M05 dashboard), 00009 (M08 alerting), 00008 (center
	// rules), 00007 (M07 label templates), 00006 (M01) and 00005 only; M06
	// administrative data stays ---
	rollbackV3To(t, dsn, 12)
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M01 job groups migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 dictionary lifecycle migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M05 dashboard migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M08 alerting migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 center rules migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M07 label templates migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M01 strategy migration")
	require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback M09 edge platform migration")
	for _, table := range []string{
		"network_domain_access", "edge_agents", "edge_heartbeats",
		"edge_target_snapshots",
	} {
		requireTableCount(t, sqlDB, table, 0)
	}
	requireTableCount(t, sqlDB, "config_snapshots", 1)
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

// rollbackV3To rolls back the newest applied migrations until `target` is the
// latest applied version (or the DB has no applied migrations). The fixed-step
// rollback chains in the tests below assume 00012 is the newest migration; new
// migrations (0014 legacy column drop, 0015 optional FKs, ...) are dialect-
// specific and may be added independently, so skip them by version target
// instead of counting steps.
func rollbackV3To(t *testing.T, dsn string, target int64) {
	t.Helper()
	for {
		statuses, err := V3MigrationStatus("sqlite", dsn)
		require.NoError(t, err)
		newest := int64(-1)
		for _, s := range statuses {
			if s.Applied && s.Version > newest {
				newest = s.Version
			}
		}
		if newest <= target {
			return
		}
		require.NoError(t, MigrateV3Down("sqlite", dsn), "rollback to version %d", target)
	}
}
