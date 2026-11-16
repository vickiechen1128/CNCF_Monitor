package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// ProbeModuleFilter filters blackbox probe module listings.
type ProbeModuleFilter struct {
	Enabled  *bool
	Keyword  string
	Page     int
	PageSize int
}

// ProbeModuleRepository persists blackbox probe modules.
type ProbeModuleRepository interface {
	Create(ctx context.Context, module *domain.ProbeModule) error
	Get(ctx context.Context, id string) (*domain.ProbeModule, error)
	GetByName(ctx context.Context, name string) (*domain.ProbeModule, error)
	List(ctx context.Context, filter ProbeModuleFilter) ([]*domain.ProbeModule, int64, error)
	Update(ctx context.Context, module *domain.ProbeModule) error
	SoftDelete(ctx context.Context, id string) error
}

// GORMProbeModuleRepository is the GORM-backed implementation.
type GORMProbeModuleRepository struct {
	db *gorm.DB
}

// NewProbeModuleRepository constructs the repository.
func NewProbeModuleRepository(db *gorm.DB) *GORMProbeModuleRepository {
	return &GORMProbeModuleRepository{db: db}
}

// Create inserts a probe module.
func (r *GORMProbeModuleRepository) Create(ctx context.Context, module *domain.ProbeModule) error {
	if module.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		module.ID = id
	}
	rec := probeModuleFromDomain(module)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "probe_module", "name", module.Name)
	}
	module.CreatedAt, module.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one probe module by id.
func (r *GORMProbeModuleRepository) Get(ctx context.Context, id string) (*domain.ProbeModule, error) {
	var rec probeModuleRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("probe_module", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// GetByName loads one probe module by unique name.
func (r *GORMProbeModuleRepository) GetByName(ctx context.Context, name string) (*domain.ProbeModule, error) {
	var rec probeModuleRecord
	if err := r.db.WithContext(ctx).Where("name = ?", name).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("probe_module", name)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of probe modules.
func (r *GORMProbeModuleRepository) List(ctx context.Context, filter ProbeModuleFilter) ([]*domain.ProbeModule, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&probeModuleRecord{})
		if filter.Enabled != nil {
			q = q.Where("enabled = ?", *filter.Enabled)
		}
		return keywordFilter(q, "name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []probeModuleRecord
	if err := paginate(build().Order("is_builtin DESC, name ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.ProbeModule, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable probe module fields.
func (r *GORMProbeModuleRepository) Update(ctx context.Context, module *domain.ProbeModule) error {
	rec := probeModuleFromDomain(module)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at", "is_builtin").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "probe_module", "name", module.Name)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, module.ID); err != nil {
			return err
		}
	}
	module.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a probe module as deleted.
func (r *GORMProbeModuleRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&probeModuleRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("probe_module", id)
	}
	return nil
}
