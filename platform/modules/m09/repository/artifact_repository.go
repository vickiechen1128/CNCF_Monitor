package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
)

// ArtifactType is the config-artifact family stored in the unified
// config_snapshots table (0016). The DB column is `scope`.
type ArtifactType string

const (
	// ArtifactTypeDomain is a per-network-domain scrape config package.
	ArtifactTypeDomain ArtifactType = "domain"
	// ArtifactTypeCenter is the platform-global rules artifact evaluated by the
	// center Prometheus (D35).
	ArtifactTypeCenter ArtifactType = "center"
	// ArtifactTypeAlertmanager is the M08-owned alertmanager.yml history.
	ArtifactTypeAlertmanager ArtifactType = "alertmanager"
	// ArtifactTypeCenterKey is the fixed scope_key for center artifacts.
	ArtifactTypeCenterKey = "center"
)

// Artifact is one row of config_snapshots across all scopes. Content is the
// inline payload for alertmanager rows; domain/center rows keep their payload
// in the content store.
type Artifact struct {
	ID                int64
	Scope             ArtifactType
	ScopeKey          string
	Version           string
	Checksum          string
	Content           string
	ValidationStatus  string
	ValidationCause   string
	ValidationDetails string
	IsCurrent         bool
	GeneratedBy       string
	GeneratedAt       *time.Time
	CreatedAt         time.Time
}

// ArtifactFilter narrows the unified artifact list.
type ArtifactFilter struct {
	Type             ArtifactType
	ScopeKey         string
	ValidationStatus string
	// RestrictDomains applies the caller's authorized domain set to domain rows.
	// Platform-scope rows are always visible.
	RestrictDomains bool
	AllowedDomains  []string
	Limit           int
}

const (
	defaultArtifactLimit = 100
	maxArtifactLimit     = 500
)

// artifactRecord maps the union of config_snapshots columns used by all scopes.
type artifactRecord struct {
	ID                int64      `gorm:"column:id;primaryKey"`
	Scope             string     `gorm:"column:scope"`
	ScopeKey          string     `gorm:"column:scope_key"`
	Version           string     `gorm:"column:version"`
	Checksum          string     `gorm:"column:checksum"`
	Content           string     `gorm:"column:content"`
	ValidationStatus  string     `gorm:"column:validation_status"`
	ValidationCause   string     `gorm:"column:validation_cause"`
	ValidationDetails *string    `gorm:"column:validation_details"`
	IsCurrent         bool       `gorm:"column:is_current"`
	GeneratedBy       string     `gorm:"column:generated_by"`
	GeneratedAt       *time.Time `gorm:"column:generated_at"`
	CreatedAt         time.Time  `gorm:"column:created_at"`
}

// TableName pins the unified v3 table.
func (artifactRecord) TableName() string { return "config_snapshots" }

func toArtifact(rec *artifactRecord) Artifact {
	details := ""
	if rec.ValidationDetails != nil {
		details = *rec.ValidationDetails
	}
	return Artifact{
		ID:                rec.ID,
		Scope:             ArtifactType(rec.Scope),
		ScopeKey:          rec.ScopeKey,
		Version:           rec.Version,
		Checksum:          rec.Checksum,
		Content:           rec.Content,
		ValidationStatus:  rec.ValidationStatus,
		ValidationCause:   rec.ValidationCause,
		ValidationDetails: details,
		IsCurrent:         rec.IsCurrent,
		GeneratedBy:       rec.GeneratedBy,
		GeneratedAt:       rec.GeneratedAt,
		CreatedAt:         rec.CreatedAt,
	}
}

// ListArtifacts returns the unified history newest first. Platform scopes
// (center / alertmanager) are always included; domain rows honor the caller's
// authorized domain set when RestrictDomains is set.
func (r *GORMRepository) ListArtifacts(ctx context.Context, filter ArtifactFilter) ([]Artifact, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = defaultArtifactLimit
	}
	if limit > maxArtifactLimit {
		limit = maxArtifactLimit
	}
	query := r.db.WithContext(ctx).Model(&artifactRecord{})
	if filter.Type != "" {
		query = query.Where("scope = ?", string(filter.Type))
	}
	if filter.ScopeKey != "" {
		query = query.Where("scope_key = ?", filter.ScopeKey)
	}
	if filter.ValidationStatus != "" {
		query = query.Where("validation_status = ?", filter.ValidationStatus)
	}
	if filter.RestrictDomains {
		if len(filter.AllowedDomains) == 0 {
			query = query.Where("scope <> ?", string(ArtifactTypeDomain))
		} else {
			query = query.Where("(scope <> ? OR scope_key IN ?)",
				string(ArtifactTypeDomain), filter.AllowedDomains)
		}
	}
	var recs []artifactRecord
	if err := query.Order("created_at DESC, id DESC").Limit(limit).Find(&recs).Error; err != nil {
		return nil, fmt.Errorf("list config artifacts: %w", err)
	}
	out := make([]Artifact, 0, len(recs))
	for i := range recs {
		out = append(out, toArtifact(&recs[i]))
	}
	return out, nil
}

// GetArtifact loads one artifact by its globally unique config_snapshots id.
func (r *GORMRepository) GetArtifact(ctx context.Context, id int64) (*Artifact, error) {
	var rec artifactRecord
	err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get config artifact %d: %w", id, err)
	}
	artifact := toArtifact(&rec)
	return &artifact, nil
}

// CurrentArtifact returns the current row of one platform scope (center or
// alertmanager). Domain rows use CurrentPassed instead.
func (r *GORMRepository) CurrentArtifact(ctx context.Context, typ ArtifactType, onlyPassed bool) (*Artifact, error) {
	query := r.db.WithContext(ctx).
		Where("scope = ? AND is_current = ?", string(typ), true)
	if onlyPassed {
		query = query.Where("validation_status = ?", "passed")
	}
	var rec artifactRecord
	err := query.First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get current %s artifact: %w", typ, err)
	}
	artifact := toArtifact(&rec)
	return &artifact, nil
}
