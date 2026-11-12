package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// configSnapshotRecord maps domain_config_snapshots (00005).
type configSnapshotRecord struct {
	ID                int64     `gorm:"column:id;primaryKey"`
	NetworkDomainID   string    `gorm:"column:network_domain_id"`
	Version           string    `gorm:"column:version"`
	Checksum          string    `gorm:"column:checksum"`
	ContentType       string    `gorm:"column:content_type"`
	ValidationStatus  string    `gorm:"column:validation_status"`
	ValidationCause   string    `gorm:"column:validation_cause"`
	ValidationDetails string    `gorm:"column:validation_details"`
	IsCurrent         bool      `gorm:"column:is_current"`
	GeneratedBy       string    `gorm:"column:generated_by"`
	CreatedAt         time.Time `gorm:"column:created_at"`
}

// TableName returns the config snapshot table.
func (configSnapshotRecord) TableName() string { return "domain_config_snapshots" }

// ConfigSnapshot is the service-facing snapshot metadata.
type ConfigSnapshot struct {
	ID                int64
	NetworkDomainID   string
	Version           string
	Checksum          string
	ContentType       string
	ValidationStatus  string
	ValidationCause   string
	ValidationDetails string
	IsCurrent         bool
	GeneratedBy       string
	CreatedAt         time.Time
}

// SnapshotRepository persists config snapshots and performs the atomic switch.
type SnapshotRepository interface {
	InsertSnapshot(ctx context.Context, rec ConfigSnapshot) (int64, error)
	InsertAndActivate(ctx context.Context, rec ConfigSnapshot) (int64, error)
	CurrentPassed(ctx context.Context, domainID string) (*ConfigSnapshot, error)
	GetSnapshot(ctx context.Context, domainID string, id int64) (*ConfigSnapshot, error)
	ListSnapshots(ctx context.Context, domainID string, limit int) ([]ConfigSnapshot, error)
	PruneSnapshots(ctx context.Context, domainID string, keep int) ([]string, error)
}

// InsertSnapshot stores a snapshot without changing the current version (used
// for failed validations).
func (r *GORMRepository) InsertSnapshot(ctx context.Context, rec ConfigSnapshot) (int64, error) {
	row := toSnapshotRecord(rec, false)
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		return 0, fmt.Errorf("insert config snapshot %q/%q: %w", rec.NetworkDomainID, rec.Version, err)
	}
	return row.ID, nil
}

// InsertAndActivate inserts a passed snapshot and atomically makes it current:
// the previous current row is demoted in the same transaction.
func (r *GORMRepository) InsertAndActivate(ctx context.Context, rec ConfigSnapshot) (int64, error) {
	var id int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		row := toSnapshotRecord(rec, false)
		if err := tx.Create(&row).Error; err != nil {
			return fmt.Errorf("insert config snapshot %q/%q: %w", rec.NetworkDomainID, rec.Version, err)
		}
		if err := tx.Model(&configSnapshotRecord{}).
			Where("network_domain_id = ? AND is_current = ?", rec.NetworkDomainID, true).
			Update("is_current", false).Error; err != nil {
			return fmt.Errorf("demote current snapshot %q: %w", rec.NetworkDomainID, err)
		}
		if err := tx.Model(&configSnapshotRecord{}).
			Where("id = ?", row.ID).Update("is_current", true).Error; err != nil {
			return fmt.Errorf("activate snapshot %d: %w", row.ID, err)
		}
		id = row.ID
		return nil
	})
	if err != nil {
		return 0, err
	}
	return id, nil
}

// CurrentPassed returns the current, validation-passed snapshot or nil.
func (r *GORMRepository) CurrentPassed(ctx context.Context, domainID string) (*ConfigSnapshot, error) {
	var row configSnapshotRecord
	err := r.db.WithContext(ctx).
		Where("network_domain_id = ? AND is_current = ? AND validation_status = ?", domainID, true, "passed").
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get current config snapshot %q: %w", domainID, err)
	}
	return toConfigSnapshot(&row), nil
}

// GetSnapshot returns one snapshot or nil when it does not belong to the domain.
func (r *GORMRepository) GetSnapshot(ctx context.Context, domainID string, id int64) (*ConfigSnapshot, error) {
	var row configSnapshotRecord
	err := r.db.WithContext(ctx).
		Where("id = ? AND network_domain_id = ?", id, domainID).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get config snapshot %d: %w", id, err)
	}
	return toConfigSnapshot(&row), nil
}

// ListSnapshots returns the domain's snapshots newest first.
func (r *GORMRepository) ListSnapshots(ctx context.Context, domainID string, limit int) ([]ConfigSnapshot, error) {
	if limit <= 0 {
		limit = 20
	}
	var rows []configSnapshotRecord
	if err := r.db.WithContext(ctx).
		Where("network_domain_id = ?", domainID).
		Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list config snapshots %q: %w", domainID, err)
	}
	items := make([]ConfigSnapshot, 0, len(rows))
	for i := range rows {
		items = append(items, *toConfigSnapshot(&rows[i]))
	}
	return items, nil
}

// PruneSnapshots keeps the newest `keep` snapshots plus the current one and
// deletes the rest, returning the removed versions for content cleanup.
func (r *GORMRepository) PruneSnapshots(ctx context.Context, domainID string, keep int) ([]string, error) {
	if keep < 1 {
		keep = 1
	}
	var rows []configSnapshotRecord
	if err := r.db.WithContext(ctx).
		Where("network_domain_id = ?", domainID).
		Order("created_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load config snapshots for prune %q: %w", domainID, err)
	}
	removed := make([]string, 0)
	ids := make([]int64, 0)
	for i, row := range rows {
		if i < keep || row.IsCurrent {
			continue
		}
		ids = append(ids, row.ID)
		removed = append(removed, row.Version)
	}
	if len(ids) == 0 {
		return removed, nil
	}
	if err := r.db.WithContext(ctx).Where("id IN ?", ids).Delete(&configSnapshotRecord{}).Error; err != nil {
		return nil, fmt.Errorf("prune config snapshots %q: %w", domainID, err)
	}
	return removed, nil
}

func toSnapshotRecord(rec ConfigSnapshot, current bool) configSnapshotRecord {
	contentType := rec.ContentType
	if contentType == "" {
		contentType = "full"
	}
	cause := rec.ValidationCause
	if cause == "" {
		cause = "none"
	}
	details := rec.ValidationDetails
	if details == "" {
		details = "{}"
	}
	created := rec.CreatedAt
	if created.IsZero() {
		created = time.Now().UTC()
	}
	return configSnapshotRecord{
		NetworkDomainID:   rec.NetworkDomainID,
		Version:           rec.Version,
		Checksum:          rec.Checksum,
		ContentType:       contentType,
		ValidationStatus:  rec.ValidationStatus,
		ValidationCause:   cause,
		ValidationDetails: details,
		IsCurrent:         current,
		GeneratedBy:       rec.GeneratedBy,
		CreatedAt:         created,
	}
}

func toConfigSnapshot(row *configSnapshotRecord) *ConfigSnapshot {
	return &ConfigSnapshot{
		ID:                row.ID,
		NetworkDomainID:   row.NetworkDomainID,
		Version:           row.Version,
		Checksum:          row.Checksum,
		ContentType:       row.ContentType,
		ValidationStatus:  row.ValidationStatus,
		ValidationCause:   row.ValidationCause,
		ValidationDetails: row.ValidationDetails,
		IsCurrent:         row.IsCurrent,
		GeneratedBy:       row.GeneratedBy,
		CreatedAt:         row.CreatedAt,
	}
}
