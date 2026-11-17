package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// TemplateFilter filters notification template listings.
type TemplateFilter struct {
	ChannelType string
	Keyword     string
	Builtin     *bool
	Page        int
	PageSize    int
}

// TemplateRepository persists notification templates.
type TemplateRepository interface {
	Create(ctx context.Context, template *domain.Template) error
	Get(ctx context.Context, id string) (*domain.Template, error)
	List(ctx context.Context, filter TemplateFilter) ([]*domain.Template, int64, error)
	Update(ctx context.Context, template *domain.Template) error
	SoftDelete(ctx context.Context, id string) error
	ListAll(ctx context.Context) ([]*domain.Template, error)
}

// GORMTemplateRepository is the GORM-backed implementation.
type GORMTemplateRepository struct{ db *gorm.DB }

// NewTemplateRepository constructs the repository.
func NewTemplateRepository(db *gorm.DB) *GORMTemplateRepository { return &GORMTemplateRepository{db: db} }

// Create inserts a template.
func (r *GORMTemplateRepository) Create(ctx context.Context, template *domain.Template) error {
	if template.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		template.ID = id
	}
	rec := templateFromDomain(template)
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return mapWriteError(err, "notify_template", "name", template.Name)
	}
	template.CreatedAt, template.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one template.
func (r *GORMTemplateRepository) Get(ctx context.Context, id string) (*domain.Template, error) {
	var rec templateRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("notify template", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of templates.
func (r *GORMTemplateRepository) List(ctx context.Context, filter TemplateFilter) ([]*domain.Template, int64, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&templateRecord{})
		if filter.ChannelType != "" {
			q = q.Where("channel_type = ?", filter.ChannelType)
		}
		if filter.Builtin != nil {
			q = q.Where("builtin = ?", *filter.Builtin)
		}
		return keywordLike(q, filter.Keyword, "name")
	}
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []templateRecord
	if err := paginate(build().Order("builtin DESC, updated_at DESC, id ASC"), page, pageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Template, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, total, nil
}

// Update replaces mutable template fields.
func (r *GORMTemplateRepository) Update(ctx context.Context, template *domain.Template) error {
	res := r.db.WithContext(ctx).Model(&templateRecord{}).
		Where("id = ?", template.ID).
		Updates(map[string]any{
			"name": template.Name, "content": template.Content,
			"channel_type": string(template.ChannelType), "updated_at": time.Now().UTC(),
		})
	if res.Error != nil {
		return mapWriteError(res.Error, "notify_template", "name", template.Name)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, template.ID); err != nil {
			return err
		}
	}
	return nil
}

// ListAll returns every live template (used by seeding and lookups).
func (r *GORMTemplateRepository) ListAll(ctx context.Context) ([]*domain.Template, error) {
	var recs []templateRecord
	if err := r.db.WithContext(ctx).Order("builtin DESC, name ASC").Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Template, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// SoftDelete marks a template as deleted.
func (r *GORMTemplateRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&templateRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("notify template", id)
	}
	return nil
}
