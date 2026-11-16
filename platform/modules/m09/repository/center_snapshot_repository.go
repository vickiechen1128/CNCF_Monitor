package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// CenterConfigSnapshot is one platform-global rules snapshot (D35).
type CenterConfigSnapshot struct {
	ID                int64
	Version           string
	Checksum          string
	ValidationStatus  string
	ValidationCause   string
	ValidationDetails string
	IsCurrent         bool
	CreatedAt         time.Time
}

// CenterSnapshotRepository persists center rules snapshots.
type CenterSnapshotRepository interface {
	Insert(ctx context.Context, rec CenterConfigSnapshot) (int64, error)
	InsertAndActivate(ctx context.Context, rec CenterConfigSnapshot) (int64, error)
	CurrentPassed(ctx context.Context) (*CenterConfigSnapshot, error)
	List(ctx context.Context, limit int) ([]CenterConfigSnapshot, error)
}

type centerSnapshotRecord struct {
	ID                int64     `gorm:"column:id;primaryKey"`
	Version           string    `gorm:"column:version;not null"`
	Checksum          string    `gorm:"column:checksum;not null"`
	ValidationStatus  string    `gorm:"column:validation_status;not null"`
	ValidationCause   string    `gorm:"column:validation_cause;not null"`
	ValidationDetails *string   `gorm:"column:validation_details"`
	IsCurrent         bool      `gorm:"column:is_current;not null"`
	CreatedAt         time.Time `gorm:"column:created_at"`
}

func (centerSnapshotRecord) TableName() string { return "center_config_snapshots" }

// GORMCenterSnapshotRepository is the GORM-backed implementation.
type GORMCenterSnapshotRepository struct {
	db *gorm.DB
}

// NewCenterSnapshotRepository constructs the repository.
func NewCenterSnapshotRepository(db *gorm.DB) *GORMCenterSnapshotRepository {
	return &GORMCenterSnapshotRepository{db: db}
}

// Insert stores a failed snapshot without touching the current version.
func (r *GORMCenterSnapshotRepository) Insert(ctx context.Context, rec CenterConfigSnapshot) (int64, error) {
	row := centerSnapshotFromDomain(rec)
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return 0, fmt.Errorf("insert center snapshot %q: %w", rec.Version, err)
	}
	return row.ID, nil
}

// InsertAndActivate stores a passed snapshot and atomically makes it current.
func (r *GORMCenterSnapshotRepository) InsertAndActivate(ctx context.Context, rec CenterConfigSnapshot) (int64, error) {
	var id int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := centerSnapshotFromDomain(rec)
		if err := tx.Create(&row).Error; err != nil {
			return fmt.Errorf("insert center snapshot %q: %w", rec.Version, err)
		}
		if err := tx.Model(&centerSnapshotRecord{}).
			Where("is_current = ?", true).Update("is_current", false).Error; err != nil {
			return fmt.Errorf("demote current center snapshot: %w", err)
		}
		if err := tx.Model(&centerSnapshotRecord{}).
			Where("id = ?", row.ID).Update("is_current", true).Error; err != nil {
			return fmt.Errorf("activate center snapshot %d: %w", row.ID, err)
		}
		id = row.ID
		return nil
	})
	if err != nil {
		return 0, err
	}
	return id, nil
}

// CurrentPassed returns the current passed snapshot, or nil.
func (r *GORMCenterSnapshotRepository) CurrentPassed(ctx context.Context) (*CenterConfigSnapshot, error) {
	var row centerSnapshotRecord
	err := r.db.WithContext(ctx).
		Where("is_current = ? AND validation_status = ?", true, "passed").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get current center snapshot: %w", err)
	}
	return centerSnapshotToDomain(&row), nil
}

// List returns snapshots newest first.
func (r *GORMCenterSnapshotRepository) List(ctx context.Context, limit int) ([]CenterConfigSnapshot, error) {
	if limit <= 0 {
		limit = 20
	}
	var rows []centerSnapshotRecord
	if err := r.db.WithContext(ctx).Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list center snapshots: %w", err)
	}
	out := make([]CenterConfigSnapshot, 0, len(rows))
	for i := range rows {
		out = append(out, *centerSnapshotToDomain(&rows[i]))
	}
	return out, nil
}

func centerSnapshotFromDomain(rec CenterConfigSnapshot) centerSnapshotRecord {
	var details *string
	if rec.ValidationDetails != "" {
		d := rec.ValidationDetails
		details = &d
	}
	return centerSnapshotRecord{
		ID:                rec.ID,
		Version:           rec.Version,
		Checksum:          rec.Checksum,
		ValidationStatus:  rec.ValidationStatus,
		ValidationCause:   rec.ValidationCause,
		ValidationDetails: details,
		IsCurrent:         rec.IsCurrent,
		CreatedAt:         rec.CreatedAt,
	}
}

func centerSnapshotToDomain(row *centerSnapshotRecord) *CenterConfigSnapshot {
	details := ""
	if row.ValidationDetails != nil {
		details = *row.ValidationDetails
	}
	return &CenterConfigSnapshot{
		ID:                row.ID,
		Version:           row.Version,
		Checksum:          row.Checksum,
		ValidationStatus:  row.ValidationStatus,
		ValidationCause:   row.ValidationCause,
		ValidationDetails: details,
		IsCurrent:         row.IsCurrent,
		CreatedAt:         row.CreatedAt,
	}
}
