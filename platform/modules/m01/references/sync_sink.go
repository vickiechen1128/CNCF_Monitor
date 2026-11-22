package references

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// SyncSink writes M09 generation outcomes back into M01 source rows. It
// implements the M09 SyncResultSink port; M01 owns the sync_* columns (D-2).
type SyncSink struct {
	db *gorm.DB
}

// NewSyncSink constructs the sink.
func NewSyncSink(db *gorm.DB) *SyncSink {
	return &SyncSink{db: db}
}

// RecordDomainSync updates every job reported by M09. The outcome map is
// job_name → error message; an empty message means "synced".
//
// Rows edited after generatedAt are left untouched so a concurrent user edit
// keeps its newer `pending` state.
func (s *SyncSink) RecordDomainSync(ctx context.Context, domainID, version string, generatedAt time.Time, outcomes map[string]string) error {
	if len(outcomes) == 0 {
		return nil
	}
	// Load candidates once and compare timestamps in Go: SQLite stores local
	// time strings with an offset, so a SQL `updated_at <= ?` comparison is not
	// reliable across time zones / dialects.
	var rows []syncJobRecord
	if err := s.db.WithContext(ctx).
		Model(&syncJobRecord{}).
		Select("id, job_name, updated_at").
		Where("network_domain_id = ? AND deleted_at IS NULL", domainID).
		Find(&rows).Error; err != nil {
		return fmt.Errorf("load jobs for sync writeback: %w", err)
	}
	// 按「错误消息」分组批量更新：同一次同步里绝大多数 Job 共用同一条消息
	// （空消息 = 成功），原实现逐 Job UPDATE，域内 Job 一多就是 N 次写放大。
	grouped := make(map[string][]string, 2)
	for _, row := range rows {
		errMsg, ok := outcomes[row.JobName]
		if !ok {
			continue
		}
		if s.updatedAfter(row.UpdatedAt, generatedAt) {
			continue // a newer user edit keeps its pending state
		}
		grouped[errMsg] = append(grouped[errMsg], row.ID)
	}
	for errMsg, ids := range grouped {
		updates := map[string]any{
			"sync_status": statusFor(errMsg),
			"sync_error":  errMsg,
		}
		if errMsg == "" {
			updates["sync_version"] = version
			updates["synced_at"] = generatedAt
		}
		if err := s.db.WithContext(ctx).
			Model(&syncJobRecord{}).
			Where("id IN ?", ids).
			Updates(updates).Error; err != nil {
			return fmt.Errorf("record sync result for domain %q: %w", domainID, err)
		}
	}
	return nil
}

// RecordRuleSync updates rules reported by M09. The outcome map is rule id →
// error message; an empty message means "synced".
func (s *SyncSink) RecordRuleSync(ctx context.Context, version string, generatedAt time.Time, outcomes map[string]string) error {
	for ruleID, errMsg := range outcomes {
		var row syncRuleRecord
		if err := s.db.WithContext(ctx).Where("id = ? AND deleted_at IS NULL", ruleID).First(&row).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue
			}
			return fmt.Errorf("load rule %q for sync writeback: %w", ruleID, err)
		}
		if s.updatedAfter(row.UpdatedAt, generatedAt) {
			continue
		}
		updates := map[string]any{
			"sync_status": statusFor(errMsg),
			"sync_error":  errMsg,
		}
		if errMsg == "" {
			updates["sync_version"] = version
			updates["synced_at"] = generatedAt
		}
		if err := s.db.WithContext(ctx).
			Model(&syncRuleRecord{}).
			Where("id = ?", ruleID).
			Updates(updates).Error; err != nil {
			return fmt.Errorf("record sync result for rule %q: %w", ruleID, err)
		}
	}
	return nil
}

// updatedAfter reports whether the source row was edited after the M09
// generation snapshot started. Both sides are UTC now (GORM writes UTC and the
// schema uses timestamp without time zone), so a plain comparison is correct.
func (s *SyncSink) updatedAfter(rowTime, generatedAt time.Time) bool {
	return rowTime.After(generatedAt)
}

func statusFor(errMsg string) string {
	if errMsg == "" {
		return "synced"
	}
	return "failed"
}

type syncJobRecord struct {
	ID              string         `gorm:"column:id;primaryKey"`
	JobName         string         `gorm:"column:job_name"`
	NetworkDomainID string         `gorm:"column:network_domain_id"`
	SyncStatus      string         `gorm:"column:sync_status"`
	SyncVersion     string         `gorm:"column:sync_version"`
	SyncError       string         `gorm:"column:sync_error"`
	SyncedAt        *time.Time     `gorm:"column:synced_at"`
	UpdatedAt       time.Time      `gorm:"column:updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (syncJobRecord) TableName() string { return "m01_scrape_jobs" }

type syncRuleRecord struct {
	ID          string         `gorm:"column:id;primaryKey"`
	SyncStatus  string         `gorm:"column:sync_status"`
	SyncVersion string         `gorm:"column:sync_version"`
	SyncError   string         `gorm:"column:sync_error"`
	SyncedAt    *time.Time     `gorm:"column:synced_at"`
	UpdatedAt   time.Time      `gorm:"column:updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"column:deleted_at"`
}

func (syncRuleRecord) TableName() string { return "m01_monitoring_rules" }
