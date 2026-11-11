package repository

import (
	"context"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// DictionaryRepository reads the reference data used by M06 validation.
type DictionaryRepository interface {
	CloudEnabled(ctx context.Context, code string) (bool, error)
	ZoneTypeExists(ctx context.Context, code string) (bool, error)
	TenantActive(ctx context.Context, id string) (bool, error)
}

// GORMDictionaryRepository is the GORM-backed dictionary reader.
type GORMDictionaryRepository struct {
	db *gorm.DB
}

// NewGORMDictionaryRepository constructs a dictionary repository.
func NewGORMDictionaryRepository(db *gorm.DB) *GORMDictionaryRepository {
	return &GORMDictionaryRepository{db: db}
}

// CloudEnabled reports whether the cloud dictionary entry exists and is enabled.
func (r *GORMDictionaryRepository) CloudEnabled(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.CloudDict{}).
		Where("cloud_code = ? AND enabled = ?", code, true).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check cloud %q: %w", code, err)
	}
	return count > 0, nil
}

// ZoneTypeExists reports whether the deployment-level zone type exists.
func (r *GORMDictionaryRepository) ZoneTypeExists(ctx context.Context, code string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.ZoneType{}).
		Where("code = ?", code).Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check zone type %q: %w", code, err)
	}
	return count > 0, nil
}

// TenantActive reports whether the tenant exists, is active and not deleted.
func (r *GORMDictionaryRepository) TenantActive(ctx context.Context, id string) (bool, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&models.Tenant{}).
		Where("id = ? AND status = ? AND deleted_at IS NULL", id, models.TenantStatusActive).
		Count(&count).Error
	if err != nil {
		return false, fmt.Errorf("check tenant %q: %w", id, err)
	}
	return count > 0, nil
}
