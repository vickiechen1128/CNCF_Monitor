package repository

import (
	"context"
	"errors"
	"fmt"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m06/domain"
)

// CloudDictRepository persists deployment-level cloud dictionary entries (D37).
type CloudDictRepository interface {
	// Get returns the entry (including disabled ones); found=false when absent.
	Get(ctx context.Context, code string) (*domain.CloudDict, bool, error)
	// Create inserts a new entry (enabled by default).
	Create(ctx context.Context, entry domain.CloudDict) (*domain.CloudDict, error)
	// Disable flips enabled to false; the code and attributes stay untouched.
	Disable(ctx context.Context, code string) (*domain.CloudDict, error)
	// CountNetworkDomains counts non-deleted domains referencing the cloud code.
	CountNetworkDomains(ctx context.Context, code string) (int64, error)
}

// GORMCloudDictRepository is the GORM-backed implementation.
type GORMCloudDictRepository struct {
	db *gorm.DB
}

// NewGORMCloudDictRepository constructs the repository.
func NewGORMCloudDictRepository(db *gorm.DB) *GORMCloudDictRepository {
	return &GORMCloudDictRepository{db: db}
}

func cloudDictFromModel(row *models.CloudDict) *domain.CloudDict {
	return &domain.CloudDict{
		Code:        row.CloudCode,
		Name:        row.CloudName,
		Type:        string(row.CloudType),
		Carrier:     string(row.Carrier),
		Description: row.Description,
		Enabled:     row.Enabled,
	}
}

// Get loads one entry by cloud code.
func (r *GORMCloudDictRepository) Get(ctx context.Context, code string) (*domain.CloudDict, bool, error) {
	var row models.CloudDict
	err := r.db.WithContext(ctx).Where("cloud_code = ?", code).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get cloud dict %q: %w", code, err)
	}
	return cloudDictFromModel(&row), true, nil
}

// Create inserts a new cloud dictionary entry.
func (r *GORMCloudDictRepository) Create(ctx context.Context, entry domain.CloudDict) (*domain.CloudDict, error) {
	row := models.CloudDict{
		CloudCode:   entry.Code,
		CloudName:   entry.Name,
		CloudType:   models.CloudType(entry.Type),
		Carrier:     models.CloudCarrier(entry.Carrier),
		Description: entry.Description,
		Enabled:     true,
	}
	if err := r.db.WithContext(ctx).Create(&row).Error; err != nil {
		// The service pre-checks the code, but a concurrent registration can
		// still race the unique index; map it to 409 instead of 500.
		if isUniqueViolation(err) {
			return nil, &domain.CloudDictExistsError{Code: entry.Code}
		}
		return nil, fmt.Errorf("create cloud dict %q: %w", entry.Code, err)
	}
	return cloudDictFromModel(&row), nil
}

// Disable flips the enabled flag of an existing entry.
func (r *GORMCloudDictRepository) Disable(ctx context.Context, code string) (*domain.CloudDict, error) {
	var row models.CloudDict
	if err := r.db.WithContext(ctx).Where("cloud_code = ?", code).First(&row).Error; err != nil {
		return nil, fmt.Errorf("load cloud dict %q: %w", code, err)
	}
	if err := r.db.WithContext(ctx).Model(&row).Update("enabled", false).Error; err != nil {
		return nil, fmt.Errorf("disable cloud dict %q: %w", code, err)
	}
	row.Enabled = false
	return cloudDictFromModel(&row), nil
}

// CountNetworkDomains counts non-deleted network domains referencing the code.
func (r *GORMCloudDictRepository) CountNetworkDomains(ctx context.Context, code string) (int64, error) {
	var count int64
	if err := r.db.WithContext(ctx).Model(&models.NetworkDomain{}).
		Where("cloud_code = ?", code).Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count network domains for cloud %q: %w", code, err)
	}
	return count, nil
}
