// Package dictionary provides read-only access to M07 reference dictionaries.
package dictionary

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"gorm.io/gorm"
)

var (
	ErrAppPlatformRelExists   = errors.New("app-platform relation already exists")
	ErrAppPlatformRelNotFound = errors.New("app-platform relation not found")
	ErrPrimaryPlatformExists  = errors.New("primary platform already exists")
)

// BusinessDomain is a read-only business dictionary entry.
type BusinessDomain struct {
	Code    string
	Name    string
	Enabled bool
}

// Application is a read-only application dictionary entry.
type Application struct {
	AppCode string
	AppName string
	Status  string
}

// Platform is a read-only platform dictionary entry.
type Platform struct {
	PlatformCode string
	PlatformName string
	Enabled      bool
}

// Cloud is a read-only cloud dictionary entry.
type Cloud struct {
	CloudCode string
	CloudName string
	Enabled   bool
}

// ZoneType is a read-only zone type entry.
type ZoneType struct {
	Code        string
	DisplayName string
	Enabled     bool
}

// AppPlatformRel is an application↔platform relation.
type AppPlatformRel struct {
	RelID        string
	AppCode      string
	PlatformCode string
	IsPrimary    bool
}

// OSOption is a read-only OS dictionary entry.
type OSOption struct {
	Name   string
	Family string
}

// Repository exposes dictionary reads used by resource validation and API v3.
type Repository interface {
	BusinessDomainEnabled(ctx context.Context, code string) (bool, error)
	ApplicationEnabled(ctx context.Context, code string) (bool, error)
	PlatformEnabled(ctx context.Context, code string) (bool, error)
	NetworkDomainUsable(ctx context.Context, id string) (bool, error)
	PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error)
	PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error)

	ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error)
	ListApplications(ctx context.Context) ([]Application, error)
	ListPlatforms(ctx context.Context) ([]Platform, error)
	ListClouds(ctx context.Context) ([]Cloud, error)
	ListZoneTypes(ctx context.Context) ([]ZoneType, error)
	ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error)
	CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error)
	SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error)
	DeleteAppPlatformRel(ctx context.Context, relID string) error
	ListOSOptions(ctx context.Context) ([]OSOption, error)
	EnsureDeclarations(ctx context.Context, biz, app, platform []DeclaredEntry) error
}

// GORMRepository is the GORM-backed dictionary repository.
type GORMRepository struct {
	db *gorm.DB
}

// NewGORMRepository constructs a dictionary repository.
func NewGORMRepository(db *gorm.DB) *GORMRepository {
	return &GORMRepository{db: db}
}

func (r *GORMRepository) BusinessDomainEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&businessDomainRecord{}).
		Where("code = ? AND enabled = ?", code, true).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check business domain %q: %w", code, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) ApplicationEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&applicationDictRecord{}).
		Where("app_code = ? AND status = ?", code, "enabled").Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check application %q: %w", code, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) PlatformEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&platformDictRecord{}).
		Where("platform_code = ? AND enabled = ?", code, true).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check platform %q: %w", code, err)
	}
	return count > 0, nil
}

// NetworkDomainUsable reports whether the domain exists, is administratively
// enabled and is a collection-node domain (edge/collection). The v3.0 model
// no longer allows resources to be attached to a center-direct domain.
func (r *GORMRepository) NetworkDomainUsable(ctx context.Context, id string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&networkDomainRecord{}).
		Where("id = ? AND status = ? AND domain_type IN ?", id, "enabled", []string{"edge", "collection"}).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check network domain %q: %w", id, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) PlatformBelongsToApp(ctx context.Context, appCode, platformCode string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&appPlatformRelRecord{}).
		Where("app_code = ? AND platform_code = ?", appCode, platformCode).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check app-platform relation %q/%q: %w", appCode, platformCode, err)
	}
	return count > 0, nil
}

func (r *GORMRepository) PrimaryPlatformOfApp(ctx context.Context, appCode string) (string, bool, error) {
	var rel appPlatformRelRecord
	err := r.db.WithContext(ctx).
		Where("app_code = ? AND is_primary = ?", appCode, true).
		First(&rel).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("find primary platform for %q: %w", appCode, err)
	}
	return rel.PlatformCode, true, nil
}

func (r *GORMRepository) ListBusinessDomains(ctx context.Context) ([]BusinessDomain, error) {
	var rows []businessDomainRecord
	if err := r.db.WithContext(ctx).Order("code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list business domains: %w", err)
	}
	out := make([]BusinessDomain, 0, len(rows))
	for _, row := range rows {
		out = append(out, BusinessDomain{Code: row.Code, Name: row.Name, Enabled: row.Enabled})
	}
	return out, nil
}

func (r *GORMRepository) ListApplications(ctx context.Context) ([]Application, error) {
	var rows []applicationDictRecord
	if err := r.db.WithContext(ctx).Order("app_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list applications: %w", err)
	}
	out := make([]Application, 0, len(rows))
	for _, row := range rows {
		out = append(out, Application{AppCode: row.AppCode, AppName: row.AppName, Status: row.Status})
	}
	return out, nil
}

func (r *GORMRepository) ListPlatforms(ctx context.Context) ([]Platform, error) {
	var rows []platformDictRecord
	if err := r.db.WithContext(ctx).Order("platform_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list platforms: %w", err)
	}
	out := make([]Platform, 0, len(rows))
	for _, row := range rows {
		out = append(out, Platform{PlatformCode: row.PlatformCode, PlatformName: row.PlatformName, Enabled: row.Enabled})
	}
	return out, nil
}

func (r *GORMRepository) ListClouds(ctx context.Context) ([]Cloud, error) {
	var rows []cloudDictRecord
	if err := r.db.WithContext(ctx).Order("cloud_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list clouds: %w", err)
	}
	out := make([]Cloud, 0, len(rows))
	for _, row := range rows {
		out = append(out, Cloud{CloudCode: row.CloudCode, CloudName: row.CloudName, Enabled: row.Enabled})
	}
	return out, nil
}

func (r *GORMRepository) ListZoneTypes(ctx context.Context) ([]ZoneType, error) {
	var rows []zoneTypeRecord
	if err := r.db.WithContext(ctx).Order("code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list zone types: %w", err)
	}
	out := make([]ZoneType, 0, len(rows))
	for _, row := range rows {
		out = append(out, ZoneType{Code: row.Code, DisplayName: row.DisplayName, Enabled: row.Enabled})
	}
	return out, nil
}

func (r *GORMRepository) ListAppPlatformRels(ctx context.Context, appCode, platformCode string) ([]AppPlatformRel, error) {
	q := r.db.WithContext(ctx).Model(&appPlatformRelRecord{})
	if appCode != "" {
		q = q.Where("app_code = ?", appCode)
	}
	if platformCode != "" {
		q = q.Where("platform_code = ?", platformCode)
	}
	var rows []appPlatformRelRecord
	if err := q.Order("app_code ASC, platform_code ASC").Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list app-platform relations: %w", err)
	}
	out := make([]AppPlatformRel, 0, len(rows))
	for _, row := range rows {
		out = append(out, AppPlatformRel{
			RelID:        row.ID,
			AppCode:      row.AppCode,
			PlatformCode: row.PlatformCode,
			IsPrimary:    row.IsPrimary,
		})
	}
	return out, nil
}

func (r *GORMRepository) CreateAppPlatformRel(ctx context.Context, appCode, platformCode string, isPrimary bool) (*AppPlatformRel, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&appPlatformRelRecord{}).
		Where("app_code = ? AND platform_code = ?", appCode, platformCode).
		Count(&count).Error; err != nil {
		return nil, fmt.Errorf("check app-platform relation: %w", err)
	}
	if count > 0 {
		return nil, ErrAppPlatformRelExists
	}
	if isPrimary {
		if err := r.db.WithContext(ctx).Model(&appPlatformRelRecord{}).
			Where("app_code = ? AND is_primary = ?", appCode, true).
			Count(&count).Error; err != nil {
			return nil, fmt.Errorf("check primary platform: %w", err)
		}
		if count > 0 {
			return nil, ErrPrimaryPlatformExists
		}
	}

	id, err := domain.NewResourceID()
	if err != nil {
		return nil, err
	}
	rec := &appPlatformRelRecord{
		ID:           id,
		AppCode:      appCode,
		PlatformCode: platformCode,
		IsPrimary:    isPrimary,
		CreatedAt:    time.Now().UTC(),
		UpdatedAt:    time.Now().UTC(),
	}
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return nil, fmt.Errorf("create app-platform relation: %w", err)
	}
	return &AppPlatformRel{
		RelID: rec.ID, AppCode: rec.AppCode, PlatformCode: rec.PlatformCode, IsPrimary: rec.IsPrimary,
	}, nil
}

func (r *GORMRepository) SetPrimaryAppPlatformRel(ctx context.Context, relID string, isPrimary bool) (*AppPlatformRel, error) {
	var out *AppPlatformRel
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var rec appPlatformRelRecord
		if err := tx.Where("id = ?", relID).First(&rec).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAppPlatformRelNotFound
			}
			return fmt.Errorf("load app-platform relation: %w", err)
		}
		if isPrimary {
			if err := tx.Model(&appPlatformRelRecord{}).
				Where("app_code = ? AND is_primary = ?", rec.AppCode, true).
				Update("is_primary", false).Error; err != nil {
				return fmt.Errorf("clear primary platform: %w", err)
			}
		}
		if err := tx.Model(&rec).Updates(map[string]any{
			"is_primary": isPrimary,
			"updated_at": time.Now().UTC(),
		}).Error; err != nil {
			return fmt.Errorf("set primary platform: %w", err)
		}
		rec.IsPrimary = isPrimary
		out = &AppPlatformRel{
			RelID: rec.ID, AppCode: rec.AppCode, PlatformCode: rec.PlatformCode, IsPrimary: rec.IsPrimary,
		}
		return nil
	})
	return out, err
}

func (r *GORMRepository) DeleteAppPlatformRel(ctx context.Context, relID string) error {
	result := r.db.WithContext(ctx).Where("id = ?", relID).Delete(&appPlatformRelRecord{})
	if result.Error != nil {
		return fmt.Errorf("delete app-platform relation: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return ErrAppPlatformRelNotFound
	}
	return nil
}

func (r *GORMRepository) ListOSOptions(ctx context.Context) ([]OSOption, error) {
	options := models.ListOSOptions()
	out := make([]OSOption, 0, len(options))
	for _, option := range options {
		out = append(out, OSOption{Name: option.Name, Family: option.Family})
	}
	return out, nil
}
