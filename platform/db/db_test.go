package db

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInitWithEnvDSN(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())
	require.NotNil(t, DB)

	assert.NoError(t, Health())
}

func TestAutoMigrate(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())

	assert.NoError(t, AutoMigrate())
}

func TestInitDefaultPath(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "metric_center.db")
	t.Setenv("METRIC_CENTER_DB_DSN", dbPath)

	require.NoError(t, Init())
	require.NotNil(t, DB)
	assert.NoError(t, Health())

	_, err := os.Stat(dbPath)
	assert.NoError(t, err)
}

func TestAuthTablesMigrated(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())
	require.NotNil(t, DB)

	// tu-01: users / sessions / login_logs must be created by AutoMigrate.
	wantTables := []string{"users", "sessions", "login_logs"}
	for _, table := range wantTables {
		var cnt int64
		err := DB.Raw("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&cnt).Error
		require.NoError(t, err, "query table %q", table)
		assert.Equal(t, int64(1), cnt, "table %q should exist", table)
	}

	// Round-trip: create a user, unique username constraint must reject duplicates.
	u := models.User{
		ID:           "u-test-1",
		TenantID:     models.PlatformAdminTenantID,
		Username:     "tu01_test_user",
		PasswordHash: "hash-placeholder",
		DisplayName:  "测试用户",
		Status:       models.UserStatusActive,
	}
	require.NoError(t, DB.Create(&u).Error)

	dup := u
	dup.ID = "u-test-2"
	assert.Error(t, DB.Create(&dup).Error, "duplicate username must be rejected")

	var got models.User
	require.NoError(t, DB.Where("username = ?", "tu01_test_user").First(&got).Error)
	assert.Equal(t, "u-test-1", got.ID)
	assert.Equal(t, "测试用户", got.DisplayName)
}

func TestHealthWithoutInit(t *testing.T) {
	// Ensure Health returns an error when DB has not been initialized.
	DB = nil
	assert.Error(t, Health())
}

// TestAlertEventMigrationBackfillsTimesAndKey 存量历史告警迁移：
// 时间刷成 UTC+8、resolved 回填 closed_at=ends_at、有指纹行补 occurrence_key，
// 并确保 occurrence 唯一索引存在。
func TestAlertEventMigrationBackfillsTimesAndKey(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file:alert_event_migration?mode=memory&cache=shared")
	require.NoError(t, Init())

	startsAt := time.Date(2026, 10, 25, 8, 0, 0, 0, time.UTC)
	endsAt := time.Date(2026, 10, 25, 9, 0, 0, 0, time.UTC)
	ev := models.AlertEvent{
		Fingerprint: "fp-migrate",
		AlertName:   "InstanceDown",
		Status:      models.AlertEventStatusResolved,
		StartsAt:    &startsAt,
		EndsAt:      &endsAt,
		Labels:      `{"alertname":"InstanceDown"}`,
	}
	require.NoError(t, DB.Create(&ev).Error)
	require.NoError(t, migrateAlertEvents())
	require.NoError(t, ensureAlertEventOccurrenceIndex())

	var got models.AlertEvent
	require.NoError(t, DB.First(&got, ev.ID).Error)
	assert.NotEmpty(t, got.OccurrenceKey)
	require.NotNil(t, got.ClosedAt)
	assert.True(t, got.ClosedAt.Equal(endsAt))
	_, offset := got.StartsAt.Zone()
	assert.Equal(t, 8*3600, offset, "存量 starts_at 刷成 UTC+8")

	var cnt int64
	require.NoError(t, DB.Raw(`SELECT count(*) FROM sqlite_master
		WHERE type='index' AND name='uq_alert_events_occurrence_key'`).Scan(&cnt).Error)
	assert.EqualValues(t, 1, cnt)
}

func TestSharedTablesCreatedAndHealthOK(t *testing.T) {
	t.Setenv("METRIC_CENTER_DB_DSN", "file::memory:?cache=shared")
	require.NoError(t, Init())
	require.NotNil(t, DB)
	require.NoError(t, AutoMigrate())

	// Health reports connected on a normal connection.
	assert.NoError(t, Health())

	// Verify the Phase 0 shared tables are present in the schema.
	wantTables := []string{
		"tenants", "network_domains", "zone_types", "resource_status_mappings",
		"hosts", "databases", "middlewares", "applications", "generic_targets",
		"resource_labels", "label_templates", "ci_type_exporter_mappings",
		"exporter_templates", "scrape_jobs", "monitoring_rules",
		"config_drafts", "config_versions", "config_deployments",
		"edge_agents", "business_metrics", "blackbox_probe_configs",
	}
	for _, table := range wantTables {
		var cnt int64
		err := DB.Raw("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&cnt).Error
		require.NoError(t, err, "query table %q", table)
		assert.Equal(t, int64(1), cnt, "table %q should exist", table)
	}
}
