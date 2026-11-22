package db

import (
	"database/sql"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// migrateV3UpTo applies embedded v3 migrations up to (and including) target.
// It mirrors MigrateV3's bookkeeping so tests can seed a pre-0016 schema and
// then let the normal MigrateV3 runner apply just the config_snapshots merge.
func migrateV3UpTo(t *testing.T, driver, dsn string, target int64) {
	t.Helper()
	sqlDB, err := openMigrationDB(driver, dsn)
	require.NoError(t, err)
	defer sqlDB.Close()
	require.NoError(t, ensureMigrationTable(sqlDB, driver))
	migrations, err := loadV3Migrations(driver)
	require.NoError(t, err)
	for _, m := range migrations {
		if m.version > target {
			continue
		}
		tx, err := sqlDB.Begin()
		require.NoError(t, err)
		_, err = tx.Exec(m.up)
		require.NoError(t, err, "apply migration %d", m.version)
		_, err = tx.Exec(fmt.Sprintf(
			`INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (%d, %s, %s, %s)`,
			m.version, sqlLiteral(m.name), sqlLiteral(m.checksum),
			sqlLiteral(time.Now().UTC().Format(time.RFC3339Nano)),
		))
		require.NoError(t, err)
		require.NoError(t, tx.Commit())
	}
}

// seedPreMergeSnapshots inserts one current + one 'am-' history row into the
// domain table, one row into the center table and one into the m08 table.
func seedPreMergeSnapshots(t *testing.T, exec func(string, ...any) error) {
	t.Helper()

	require.NoError(t, exec(
		`INSERT INTO network_domains(id,name,domain_type,tenant_id,status)
		 VALUES ('dom-a','域A','edge','platform_admin','enabled')`))
	// Domain rows: current scrape config + an alertmanager history row (D31 'am-').
	require.NoError(t, exec(
		`INSERT INTO domain_config_snapshots(
		network_domain_id, version, checksum, content_type, validation_status,
		validation_cause, validation_details, is_current, generated_by, created_at)
		VALUES ('dom-a','v1','c1','full','passed','none','{"k":1}'::jsonb,TRUE,NULL,'2026-01-01 00:00:00')`))
	require.NoError(t, exec(
		`INSERT INTO domain_config_snapshots(
		network_domain_id, version, checksum, content_type, validation_status,
		validation_cause, validation_details, is_current, generated_by, created_at)
		VALUES ('dom-a','am-h1','cam','full','passed','none','{}'::jsonb,FALSE,'m08','2026-01-02 00:00:00')`))
	// Center row (validation_details TEXT).
	require.NoError(t, exec(`INSERT INTO center_config_snapshots(
		version, checksum, validation_status, validation_cause, is_current, created_at)
		VALUES ('center-v1','cc1','passed','none',TRUE,'2026-01-03 00:00:00')`))
	// M08 row with content + route_tree + generated_at.
	require.NoError(t, exec(`INSERT INTO m08_config_snapshots(
		version, checksum, content, route_tree, is_current, generated_by, generated_at, created_at)
		VALUES ('am-v1','ca1','route: {}','[{"id":"root"}]'::jsonb,TRUE,'m08','2026-01-04 00:00:00','2026-01-04 00:00:00')`))
}

func requireLegacyTableGone(t *testing.T, sqlDB *sql.DB, table string) {
	t.Helper()
	var count int
	require.NoError(t, sqlDB.QueryRow(
		`SELECT count(*) FROM information_schema.tables
		 WHERE table_schema = current_schema() AND table_name = $1`, table,
	).Scan(&count))
	require.Zero(t, count, "legacy table %s must be dropped", table)
}

func verifyMergedSnapshots(t *testing.T, sqlDB *sql.DB) {
	t.Helper()
	var total int
	require.NoError(t, sqlDB.QueryRow(`SELECT count(*) FROM config_snapshots`).Scan(&total))
	assert.Equal(t, 4, total, "2 domain + 1 center + 1 alertmanager rows")

	var scope, scopeKey, version, checksum, content, contentType, routeTree string
	var validationDetails *string
	var isCurrent bool
	var generatedBy string
	err := sqlDB.QueryRow(`SELECT scope, scope_key, version, checksum, content, content_type,
		CAST(route_tree AS TEXT), CAST(validation_details AS TEXT), is_current, generated_by
		FROM config_snapshots WHERE scope = 'domain' AND version = 'v1'`).
		Scan(&scope, &scopeKey, &version, &checksum, &content, &contentType,
			&routeTree, &validationDetails, &isCurrent, &generatedBy)
	require.NoError(t, err)
	assert.Equal(t, "domain", scope)
	assert.Equal(t, "dom-a", scopeKey, "domain scope_key carries network_domain_id")
	assert.Equal(t, "c1", checksum)
	assert.Equal(t, "", content, "domain rows have no content payload")
	assert.Equal(t, "full", contentType)
	assert.JSONEq(t, `[]`, routeTree)
	require.NotNil(t, validationDetails)
	assert.JSONEq(t, `{"k":1}`, *validationDetails)
	assert.True(t, isCurrent, "is_current is preserved")
	assert.Equal(t, "", generatedBy, "NULL generated_by becomes ''")

	// 'am-' history stays in domain scope (D31 semantics preserved by the merge).
	err = sqlDB.QueryRow(`SELECT scope_key, version, is_current, generated_by
		FROM config_snapshots WHERE scope = 'domain' AND version = 'am-h1'`).
		Scan(&scopeKey, &version, &isCurrent, &generatedBy)
	require.NoError(t, err)
	assert.Equal(t, "dom-a", scopeKey)
	assert.False(t, isCurrent)
	assert.Equal(t, "m08", generatedBy)

	err = sqlDB.QueryRow(`SELECT scope_key, version, checksum, content, CAST(route_tree AS TEXT), is_current
		FROM config_snapshots WHERE scope = 'center'`).
		Scan(&scopeKey, &version, &checksum, &content, &routeTree, &isCurrent)
	require.NoError(t, err)
	assert.Equal(t, "center", scopeKey)
	assert.Equal(t, "center-v1", version)
	assert.Equal(t, "cc1", checksum)
	assert.Equal(t, "", content)
	assert.JSONEq(t, `[]`, routeTree)
	assert.True(t, isCurrent)

	var generatedAt *time.Time
	err = sqlDB.QueryRow(`SELECT scope_key, version, content, CAST(route_tree AS TEXT), is_current,
		generated_by, generated_at FROM config_snapshots WHERE scope = 'alertmanager'`).
		Scan(&scopeKey, &version, &content, &routeTree, &isCurrent, &generatedBy, &generatedAt)
	require.NoError(t, err)
	assert.Equal(t, "alertmanager", scopeKey)
	assert.Equal(t, "am-v1", version)
	assert.Equal(t, "route: {}", content)
	assert.JSONEq(t, `[{"id":"root"}]`, routeTree)
	assert.True(t, isCurrent)
	assert.Equal(t, "m08", generatedBy)
	require.NotNil(t, generatedAt)

	// Uniqueness is keyed by (scope, scope_key, version), not a single column.
	_, err = sqlDB.Exec(`INSERT INTO config_snapshots(scope, scope_key, version, checksum)
		VALUES ('domain','dom-a','v1','dup')`)
	require.Error(t, err, "duplicate (scope, scope_key, version) must fail")
	_, err = sqlDB.Exec(`INSERT INTO config_snapshots(scope, scope_key, version, checksum)
		VALUES ('center','center','v1','other')`)
	require.NoError(t, err, "same version in a different scope is allowed")

	// One current row per (scope, scope_key).
	_, err = sqlDB.Exec(`INSERT INTO config_snapshots(scope, scope_key, version, checksum, is_current)
		VALUES ('domain','dom-a','v2','c2',TRUE)`)
	require.Error(t, err, "second current row in the same scope must fail")

	// Legacy tables are gone; m08_reload_logs.snapshot_id is no longer an FK.
	for _, table := range []string{"domain_config_snapshots", "center_config_snapshots", "m08_config_snapshots"} {
		requireLegacyTableGone(t, sqlDB, table)
	}
	_, err = sqlDB.Exec(`INSERT INTO m08_reload_logs(snapshot_id, trigger, status)
		VALUES (9999, 'manual', 'succeeded')`)
	require.NoError(t, err, "snapshot_id no longer references the dropped table")
}

func TestConfigSnapshotsMergeBackfill(t *testing.T) {
	dsn := testPostgresDSN(t)
	migrateV3UpTo(t, "postgres", dsn, 15)

	sqlDB := openTestSQL(t, dsn)
	seedPreMergeSnapshots(t, func(q string, args ...any) error {
		_, e := sqlDB.Exec(q, args...)
		return e
	})

	require.NoError(t, MigrateV3("postgres", dsn), "apply 0016 merge")
	verifyMergedSnapshots(t, sqlDB)
}
