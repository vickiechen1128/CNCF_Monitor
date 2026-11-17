package repository

import (
	"context"
	"fmt"
	"strconv"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// ReloadLogFilter filters reload-log listings.
type ReloadLogFilter struct {
	Page     int
	PageSize int
}

// ReloadLogRepository persists reload attempts (append-only, FR-07).
type ReloadLogRepository interface {
	Insert(ctx context.Context, log *domain.ReloadLog) error
	List(ctx context.Context, filter ReloadLogFilter) ([]*domain.ReloadLog, int64, error)
}

// GORMReloadLogRepository is the GORM-backed implementation.
type GORMReloadLogRepository struct{ db *gorm.DB }

// NewReloadLogRepository constructs the repository.
func NewReloadLogRepository(db *gorm.DB) *GORMReloadLogRepository {
	return &GORMReloadLogRepository{db: db}
}

// Insert appends one reload attempt.
func (r *GORMReloadLogRepository) Insert(ctx context.Context, log *domain.ReloadLog) error {
	rec := &reloadLogRecord{
		SnapshotID: log.SnapshotID, ConfigVersion: log.ConfigVersion, Checksum: log.Checksum,
		Trigger: string(log.Trigger), Status: string(log.Status), Operator: log.Operator,
		Error: log.Error, DurationMS: log.DurationMS, StartedAt: log.StartedAt,
		FinishedAt: log.FinishedAt,
	}
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return fmt.Errorf("insert reload log: %w", err)
	}
	log.ID = rec.ID
	log.CreatedAt = rec.CreatedAt
	return nil
}

// List returns a page of reload logs, newest first.
func (r *GORMReloadLogRepository) List(ctx context.Context, filter ReloadLogFilter) ([]*domain.ReloadLog, int64, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	var total int64
	if err := r.db.WithContext(ctx).Model(&reloadLogRecord{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []reloadLogRecord
	if err := paginate(r.db.WithContext(ctx).Order("id DESC"), page, pageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.ReloadLog, 0, len(recs))
	for i := range recs {
		rec := recs[i]
		out = append(out, &domain.ReloadLog{
			ID: rec.ID, SnapshotID: rec.SnapshotID, ConfigVersion: rec.ConfigVersion,
			Checksum: rec.Checksum, Trigger: domain.ReloadTrigger(rec.Trigger),
			Status: domain.ReloadStatus(rec.Status), Operator: rec.Operator, Error: rec.Error,
			DurationMS: rec.DurationMS, StartedAt: rec.StartedAt, FinishedAt: rec.FinishedAt,
			CreatedAt: rec.CreatedAt,
		})
	}
	return out, total, nil
}

func idString(id int64) string { return strconv.FormatInt(id, 10) }
