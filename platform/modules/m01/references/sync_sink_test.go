package references

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
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

// syncCountingLogger counts UPDATE statements on m01_scrape_jobs, so the batch
// writeback can be asserted without depending on exact SQL formatting.
type syncCountingLogger struct {
	mu      sync.Mutex
	updates int
}

func (l *syncCountingLogger) LogMode(logger.LogLevel) logger.Interface { return l }
func (l *syncCountingLogger) Info(context.Context, string, ...any)     {}
func (l *syncCountingLogger) Warn(context.Context, string, ...any)     {}
func (l *syncCountingLogger) Error(context.Context, string, ...any)    {}
func (l *syncCountingLogger) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	if !strings.Contains(sql, "m01_scrape_jobs") || !strings.Contains(sql, "UPDATE") {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.updates++
}

func (l *syncCountingLogger) updateCount() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.updates
}

// 一次同步回写 5 个 Job（3 成功 + 2 同一失败原因）：应只有 2 条 UPDATE
// （成功组 1 条 + 该错误消息 1 条），而不是逐 Job 的 5 条。
func TestSyncSinkBatchesUpdatesPerMessage(t *testing.T) {
	gormDB := openReferencesDB(t)
	counter := &syncCountingLogger{}
	sink := NewSyncSink(gormDB.Session(&gorm.Session{Logger: counter}))
	ctx := context.Background()

	specs := []struct{ id, name string }{
		{"job-1", "node-1"}, {"job-2", "node-2"}, {"job-3", "node-3"},
		{"job-4", "node-4"}, {"job-5", "node-5"},
	}
	for _, spec := range specs {
		require.NoError(t, gormDB.Exec(`INSERT INTO m01_scrape_jobs
			(id,job_name,resource_category,network_domain_id,sync_status,updated_at)
			VALUES (?,?,'host','mc-demo','pending','2026-01-01 00:00:00')`, spec.id, spec.name).Error)
	}

	generatedAt := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	require.NoError(t, sink.RecordDomainSync(ctx, "mc-demo", "v1", generatedAt, map[string]string{
		"node-1": "",
		"node-2": "",
		"node-3": "",
		"node-4": "no resolvable targets",
		"node-5": "no resolvable targets",
	}))
	assert.Equal(t, 2, counter.updateCount(), "one UPDATE per outcome group instead of one per job")
}

func TestPostgresUpdatedAfterUsesWallClock(t *testing.T) {
	// Postgres returns a server-local wall clock (16:08) with a UTC location,
	// while generatedAt is UTC (08:08). The job was edited at 15:18 local,
	// before the sync started, so it must be updated.
	row := time.Date(2026, 11, 18, 15, 18, 0, 0, time.UTC)
	generated := time.Date(2026, 11, 18, 8, 8, 0, 0, time.UTC)
	assert.False(t, postgresUpdatedAfter(row, generated))

	// A real edit after the sync start (17:00 local) keeps pending.
	newer := time.Date(2026, 11, 18, 17, 0, 0, 0, time.UTC)
	assert.True(t, postgresUpdatedAfter(newer, generated))
}
