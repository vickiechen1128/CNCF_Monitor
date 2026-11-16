package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// ExporterTemplateFilter filters exporter pool listings.
type ExporterTemplateFilter struct {
	Source    domain.ExporterSource
	OS        string
	Arch      string
	IsBuiltin *bool
	Keyword   string
	Page      int
	PageSize  int
}

// ExporterTemplateRepository persists the exporter pool.
type ExporterTemplateRepository interface {
	Create(ctx context.Context, template *domain.ExporterTemplate) error
	Get(ctx context.Context, id string) (*domain.ExporterTemplate, error)
	GetByName(ctx context.Context, name string) (*domain.ExporterTemplate, error)
	List(ctx context.Context, filter ExporterTemplateFilter) ([]*domain.ExporterTemplate, int64, error)
	Update(ctx context.Context, template *domain.ExporterTemplate) error
	SoftDelete(ctx context.Context, id string) error
}

// GORMExporterTemplateRepository is the GORM-backed implementation.
type GORMExporterTemplateRepository struct {
	db *gorm.DB
}

// NewExporterTemplateRepository constructs the repository.
func NewExporterTemplateRepository(db *gorm.DB) *GORMExporterTemplateRepository {
	return &GORMExporterTemplateRepository{db: db}
}

// Create inserts an exporter template.
func (r *GORMExporterTemplateRepository) Create(ctx context.Context, template *domain.ExporterTemplate) error {
	if template.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		template.ID = id
	}
	rec := exporterTemplateFromDomain(template)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "exporter_template", "name", template.Name)
	}
	template.CreatedAt, template.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one exporter template by id.
func (r *GORMExporterTemplateRepository) Get(ctx context.Context, id string) (*domain.ExporterTemplate, error) {
	var rec exporterTemplateRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("exporter_template", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// GetByName loads one exporter template by unique name.
func (r *GORMExporterTemplateRepository) GetByName(ctx context.Context, name string) (*domain.ExporterTemplate, error) {
	var rec exporterTemplateRecord
	if err := r.db.WithContext(ctx).Where("name = ?", name).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("exporter_template", name)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of exporter templates.
func (r *GORMExporterTemplateRepository) List(ctx context.Context, filter ExporterTemplateFilter) ([]*domain.ExporterTemplate, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&exporterTemplateRecord{})
		if filter.Source != "" {
			q = q.Where("source = ?", string(filter.Source))
		}
		if filter.OS != "" {
			q = q.Where("os = ?", filter.OS)
		}
		if filter.Arch != "" {
			q = q.Where("arch = ?", filter.Arch)
		}
		if filter.IsBuiltin != nil {
			q = q.Where("is_builtin = ?", *filter.IsBuiltin)
		}
		return keywordFilter(q, "name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []exporterTemplateRecord
	if err := paginate(build().Order("updated_at DESC, id ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.ExporterTemplate, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable exporter template fields.
func (r *GORMExporterTemplateRepository) Update(ctx context.Context, template *domain.ExporterTemplate) error {
	rec := exporterTemplateFromDomain(template)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "exporter_template", "name", template.Name)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, template.ID); err != nil {
			return err
		}
	}
	template.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks an exporter template as deleted.
func (r *GORMExporterTemplateRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&exporterTemplateRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("exporter_template", id)
	}
	return nil
}
