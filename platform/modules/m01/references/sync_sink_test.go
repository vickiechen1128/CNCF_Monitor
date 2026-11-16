package references

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSyncSinkRecordsDomainOutcomes(t *testing.T) {
	gormDB := openReferencesDB(t)
	sink := NewSyncSink(gormDB)
	ctx := context.Background()

	for _, stmt := range []string{
		`INSERT INTO m01_scrape_jobs(id,job_name,resource_category,network_domain_id,sync_status,updated_at)
			VALUES ('job-1','node','host','mc-demo','pending','2026-01-01 00:00:00')`,
		`INSERT INTO m01_scrape_jobs(id,job_name,resource_category,network_domain_id,sync_status,updated_at)
			VALUES ('job-2','node-2','host','mc-demo','pending','2026-07-01 00:00:00')`,
		`INSERT INTO m01_scrape_jobs(id,job_name,resource_category,network_domain_id,sync_status,updated_at)
			VALUES ('job-3','node-3','host','mc-demo','pending','2026-01-01 00:00:00')`,
	} {
		require.NoError(t, gormDB.Exec(stmt).Error, stmt)
	}

	generatedAt := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	require.NoError(t, sink.RecordDomainSync(ctx, "mc-demo", "v1", generatedAt, map[string]string{
		"node":   "",
		"node-2": "",
		"node-3": "no resolvable targets",
	}))

	read := func(id string) (string, string, string, *time.Time) {
		var row struct {
			Status  string     `gorm:"column:sync_status"`
			Version string     `gorm:"column:sync_version"`
			Error   string     `gorm:"column:sync_error"`
			Synced  *time.Time `gorm:"column:synced_at"`
		}
		require.NoError(t, gormDB.Table("m01_scrape_jobs").
			Select("sync_status, sync_version, sync_error, synced_at").
			Where("id = ?", id).Scan(&row).Error)
		return row.Status, row.Version, row.Error, row.Synced
	}

	status, version, errMsg, syncedAt := read("job-1")
	assert.Equal(t, "synced", status)
	assert.Equal(t, "v1", version)
	assert.Empty(t, errMsg)
	require.NotNil(t, syncedAt)

	// Edited after generatedAt: the newer pending state is preserved.
	status, version, _, syncedAt = read("job-2")
	assert.Equal(t, "pending", status)
	assert.Empty(t, version)
	assert.Nil(t, syncedAt)

	status, version, errMsg, syncedAt = read("job-3")
	assert.Equal(t, "failed", status)
	assert.Empty(t, version)
	assert.Equal(t, "no resolvable targets", errMsg)
	assert.Nil(t, syncedAt)
}

func TestSyncSinkRecordsRuleOutcomes(t *testing.T) {
	gormDB := openReferencesDB(t)
	sink := NewSyncSink(gormDB)
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(`INSERT INTO m01_monitoring_rules(id,name,sync_status,updated_at)
		VALUES ('rule-1','host-down','pending','2026-01-01 00:00:00')`).Error)

	generatedAt := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	require.NoError(t, sink.RecordRuleSync(ctx, "v2", generatedAt, map[string]string{"rule-1": ""}))

	var row struct {
		Status  string     `gorm:"column:sync_status"`
		Version string     `gorm:"column:sync_version"`
		Synced  *time.Time `gorm:"column:synced_at"`
	}
	require.NoError(t, gormDB.Table("m01_monitoring_rules").
		Select("sync_status, sync_version, synced_at").
		Where("id = ?", "rule-1").Scan(&row).Error)
	assert.Equal(t, "synced", row.Status)
	assert.Equal(t, "v2", row.Version)
	assert.NotNil(t, row.Synced)
}
