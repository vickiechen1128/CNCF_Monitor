package db

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestMigrateV3M08Alerting validates the 00009 M08 alerting schema.
func TestMigrateV3M08Alerting(t *testing.T) {
	dsn := testPostgresDSN(t)
	require.NoError(t, MigrateV3("postgres", dsn))

	sqlDB := openTestSQL(t, dsn)
	var err error

	for _, table := range []string{
		"m08_notify_templates",
		"m08_notify_channels",
		"config_snapshots",
		"m08_reload_logs",
		"m08_alert_events",
		"m08_inhibition_rules",
		"m08_silence_audits",
	} {
		requireTableCount(t, sqlDB, table, 1)
	}

	// Templates are unique per (name, channel_type) among live rows.
	_, err = sqlDB.Exec(`INSERT INTO m08_notify_templates(id, name, channel_type, content)
		VALUES ('t1', '默认卡片', 'feishu', 'x')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m08_notify_templates(id, name, channel_type, content)
		VALUES ('t2', '默认卡片', 'feishu', 'y')`)
	require.Error(t, err, "duplicate template name per type must fail")

	// Channels require a known type; template FK is nullable for webhooks.
	_, err = sqlDB.Exec(`INSERT INTO m08_notify_channels(id, name, channel_type, webhook_url)
		VALUES ('c1', '飞书群', 'feishu', 'https://example.com/hook')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m08_notify_channels(id, name, channel_type, webhook_url)
		VALUES ('c2', '坏类型', 'sms', 'https://example.com/hook')`)
	require.Error(t, err, "unknown channel type must be rejected")

	// Exactly one current snapshot per (scope, scope_key) -- here alertmanager.
	insertAMSnapshot := `INSERT INTO config_snapshots(scope, scope_key, version, checksum, content, is_current)
		VALUES ('alertmanager', 'alertmanager', $1, $2, $3, $4)`
	_, err = sqlDB.Exec(insertAMSnapshot, "v1", "sum1", "route: {}", true)
	require.NoError(t, err)
	_, err = sqlDB.Exec(insertAMSnapshot, "v2", "sum2", "route: {}", true)
	require.Error(t, err, "second current snapshot must fail")

	// Occurrence key deduplicates alert events.
	_, err = sqlDB.Exec(`INSERT INTO m08_alert_events(occurrence_key, alert_name, status, starts_at)
		VALUES ('fp1|2026-11-16T00:00:00Z', 'HostDown', 'firing', CURRENT_TIMESTAMP)`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m08_alert_events(occurrence_key, alert_name, status, starts_at)
		VALUES ('fp1|2026-11-16T00:00:00Z', 'HostDown', 'firing', CURRENT_TIMESTAMP)`)
	require.Error(t, err, "duplicate occurrence key must fail")

	// Reload log trigger/status are constrained.
	_, err = sqlDB.Exec(`INSERT INTO m08_reload_logs(trigger, status) VALUES ('manual', 'succeeded')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m08_reload_logs(trigger, status) VALUES ('bogus', 'succeeded')`)
	require.Error(t, err, "unknown reload trigger must be rejected")

	// Inhibition rule names are unique among live rows.
	_, err = sqlDB.Exec(`INSERT INTO m08_inhibition_rules(id, name) VALUES ('r1', '网域离线抑制')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m08_inhibition_rules(id, name) VALUES ('r2', '网域离线抑制')`)
	require.Error(t, err, "duplicate inhibition rule name must fail")

	// Audit action/result are constrained and rejected attempts are accepted.
	_, err = sqlDB.Exec(`INSERT INTO m08_silence_audits(action, result, failure_reason)
		VALUES ('create', 'rejected', 'network domain not authorized')`)
	require.NoError(t, err)
	_, err = sqlDB.Exec(`INSERT INTO m08_silence_audits(action, result) VALUES ('update', 'success')`)
	require.Error(t, err, "unknown audit action must be rejected")

	// Down: skip migrations newer than 0012 (0014 legacy column drop is an
	// intentional no-op, 0015 M01 nullable FKs), then drops 00010 (M05
	// dashboard) then 00009; earlier v3 tables stay.
	rollbackV3To(t, dsn, 12)
	require.NoError(t, MigrateV3Down("postgres", dsn), "rollback M01 job groups migration")
	require.NoError(t, MigrateV3Down("postgres", dsn), "rollback M07 dictionary lifecycle migration")
	require.NoError(t, MigrateV3Down("postgres", dsn), "rollback M05 dashboard migration")
	require.NoError(t, MigrateV3Down("postgres", dsn), "rollback M08 alerting migration")
	requireTableCount(t, sqlDB, "m05_dashboard_panels", 0)
	// The merged table survives the 0009 rollback (0016 Down is a no-op).
	requireTableCount(t, sqlDB, "config_snapshots", 1)
	requireTableCount(t, sqlDB, "m08_alert_events", 0)
	requireTableCount(t, sqlDB, "m07_label_templates", 1)
}
