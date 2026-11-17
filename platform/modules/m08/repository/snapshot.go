package repository

import (
	"context"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// SnapshotRepository persists generated alertmanager.yml versions. Exactly one
// row is current; older rows are read-only history (NFR-04).
type SnapshotRepository interface {
	CreateCurrent(ctx context.Context, snapshot *domain.Snapshot, keep int) error
	Current(ctx context.Context) (*domain.Snapshot, error)
	Get(ctx context.Context, id int64) (*domain.Snapshot, error)
	List(ctx context.Context, page, pageSize int) ([]*domain.Snapshot, int64, error)
}

// GORMSnapshotRepository is the GORM-backed implementation.
type GORMSnapshotRepository struct{ db *gorm.DB }

// NewSnapshotRepository constructs the repository.
func NewSnapshotRepository(db *gorm.DB) *GORMSnapshotRepository {
	return &GORMSnapshotRepository{db: db}
}

// CreateCurrent inserts a new snapshot and atomically makes it the current one,
// then prunes history beyond `keep` rows. The previous current row is never
// modified beyond losing the flag.
func (r *GORMSnapshotRepository) CreateCurrent(ctx context.Context, snapshot *domain.Snapshot, keep int) error {
	if keep <= 0 {
		keep = 20
	}
	rec := &snapshotRecord{
		Version: snapshot.Version, Checksum: snapshot.Checksum, Content: snapshot.Content,
		RouteTree: snapshot.RouteTree, IsCurrent: true, GeneratedBy: snapshot.GeneratedBy,
		GeneratedAt: snapshot.GeneratedAt,
	}
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&snapshotRecord{}).Where("is_current = ?", true).
			Update("is_current", false).Error; err != nil {
			return err
		}
		if err := tx.Create(rec).Error; err != nil {
			return mapWriteError(err, "config_snapshot", "version", snapshot.Version)
		}
		snapshot.ID = rec.ID
		snapshot.CreatedAt = rec.CreatedAt
		snapshot.IsCurrent = true
		return tx.Exec(`DELETE FROM m08_config_snapshots
			WHERE is_current = ? AND id NOT IN (
				SELECT id FROM m08_config_snapshots ORDER BY id DESC LIMIT ?
			)`, false, keep).Error
	})
}

// Current returns the current snapshot.
func (r *GORMSnapshotRepository) Current(ctx context.Context) (*domain.Snapshot, error) {
	var rec snapshotRecord
	if err := r.db.WithContext(ctx).Where("is_current = ?", true).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("config snapshot", "current")
		}
		return nil, err
	}
	return snapshotToDomain(&rec), nil
}

// Get loads one snapshot by id.
func (r *GORMSnapshotRepository) Get(ctx context.Context, id int64) (*domain.Snapshot, error) {
	var rec snapshotRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("config snapshot", idString(id))
		}
		return nil, err
	}
	return snapshotToDomain(&rec), nil
}

// List returns a page of snapshots, newest first (content included).
func (r *GORMSnapshotRepository) List(ctx context.Context, page, pageSize int) ([]*domain.Snapshot, int64, error) {
	page, pageSize = normalizePage(page, pageSize)
	var total int64
	if err := r.db.WithContext(ctx).Model(&snapshotRecord{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []snapshotRecord
	if err := paginate(r.db.WithContext(ctx).Order("id DESC"), page, pageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Snapshot, 0, len(recs))
	for i := range recs {
		out = append(out, snapshotToDomain(&recs[i]))
	}
	return out, total, nil
}

func snapshotToDomain(rec *snapshotRecord) *domain.Snapshot {
	return &domain.Snapshot{
		ID: rec.ID, Version: rec.Version, Checksum: rec.Checksum, Content: rec.Content,
		RouteTree: rec.RouteTree, IsCurrent: rec.IsCurrent, GeneratedBy: rec.GeneratedBy,
		GeneratedAt: rec.GeneratedAt, CreatedAt: rec.CreatedAt,
	}
}
