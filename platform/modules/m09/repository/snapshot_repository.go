package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
)

// snapshotScopeDomain is the scope tag for network-domain config snapshots in
// the unified config_snapshots table (0016). The service-facing ConfigSnapshot
// DTO still exposes NetworkDomainID; scope_key carries the domain id in SQL.
const snapshotScopeDomain = "domain"

// configSnapshotRecord maps the domain-scoped rows of config_snapshots (0016).
type configSnapshotRecord struct {
	ID                int64     `gorm:"column:id;primaryKey"`
	Scope             string    `gorm:"column:scope"`
	ScopeKey          string    `gorm:"column:scope_key"`
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

// TableName returns the unified config snapshot table.
func (configSnapshotRecord) TableName() string { return "config_snapshots" }

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
	// PruneSnapshots keeps the current snapshot plus at most one successful
	// snapshot per natural day for the last keepDays days.
	PruneSnapshots(ctx context.Context, domainID string, keepDays int, loc *time.Location) ([]string, error)
}

// InsertSnapshot stores a non-current snapshot without changing the active
// version. Production syncs no longer persist failed attempts; this remains for
// history/import tests and backfill tooling.
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
			Where("scope = ? AND scope_key = ? AND is_current = ?", snapshotScopeDomain, rec.NetworkDomainID, true).
			Update("is_current", false).Error; err != nil {
			return fmt.Errorf("demote current snapshot %q: %w", rec.NetworkDomainID, err)
		}
		if err := tx.Model(&configSnapshotRecord{}).
			Where("id = ? AND scope = ? AND scope_key = ?", row.ID, snapshotScopeDomain, rec.NetworkDomainID).
			Update("is_current", true).Error; err != nil {
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
		Where("scope = ? AND scope_key = ? AND is_current = ? AND validation_status = ?",
			snapshotScopeDomain, domainID, true, "passed").
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
		Where("id = ? AND scope = ? AND scope_key = ?", id, snapshotScopeDomain, domainID).First(&row).Error
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
		Where("scope = ? AND scope_key = ?", snapshotScopeDomain, domainID).
		Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list config snapshots %q: %w", domainID, err)
	}
	items := make([]ConfigSnapshot, 0, len(rows))
	for i := range rows {
		items = append(items, *toConfigSnapshot(&rows[i]))
	}
	return items, nil
}

// AlertmanagerVersionPrefix marks the M08 alertmanager.yml history snapshots
// (D31). They live in config_snapshots under the 'domain' scope next to the
// scrape config snapshots but are closed out under their own retention window,
// so frequently saving alerting config cannot evict the config history
// operators need.
const AlertmanagerVersionPrefix = "am-"

// isAlertmanagerSnapshot reports whether the row is an alertmanager history
// snapshot (legacy rows are recognised by the version prefix).
func isAlertmanagerSnapshot(version string) bool {
	return strings.HasPrefix(version, AlertmanagerVersionPrefix)
}

// PruneSnapshots keeps the current snapshot plus at most one successful
// snapshot per natural day for the last keepDays days. Failed rows and
// intra-day duplicates are removed; removed versions are returned so callers
// can delete their content files.
func (r *GORMRepository) PruneSnapshots(ctx context.Context, domainID string, keepDays int, loc *time.Location) ([]string, error) {
	var rows []configSnapshotRecord
	if err := r.db.WithContext(ctx).
		Where("scope = ? AND scope_key = ?", snapshotScopeDomain, domainID).
		Order("created_at DESC, id DESC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("load config snapshots for prune %q: %w", domainID, err)
	}
	candidates := make([]snapshotPruneCandidate, 0, len(rows))
	for _, row := range rows {
		family := "config"
		if isAlertmanagerSnapshot(row.Version) {
			family = "alertmanager"
		}
		candidates = append(candidates, snapshotPruneCandidate{
			ID:               row.ID,
			Version:          row.Version,
			Family:           family,
			ValidationStatus: row.ValidationStatus,
			CreatedAt:        row.CreatedAt,
			IsCurrent:        row.IsCurrent,
		})
	}
	ids, removed := planDailySnapshotPrune(candidates, keepDays, loc, time.Now())
	if len(ids) == 0 {
		return removed, nil
	}
	if err := r.db.WithContext(ctx).
		Where("scope = ? AND scope_key = ? AND id IN ?", snapshotScopeDomain, domainID, ids).
		Delete(&configSnapshotRecord{}).Error; err != nil {
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
		Scope:             snapshotScopeDomain,
		ScopeKey:          rec.NetworkDomainID,
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
		NetworkDomainID:   row.ScopeKey,
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
