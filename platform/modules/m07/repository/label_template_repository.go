package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// LabelTemplateFilter filters label template listings.
type LabelTemplateFilter struct {
	ResourceCategory domain.Category
	IsDefault        *bool
	Keyword          string
	Page             int
	PageSize         int
}

// LabelTemplateRepository persists v3 label templates.
type LabelTemplateRepository interface {
	Create(ctx context.Context, template *domain.LabelTemplate) error
	Get(ctx context.Context, id string) (*domain.LabelTemplate, error)
	List(ctx context.Context, filter LabelTemplateFilter) ([]*domain.LabelTemplate, int64, error)
	Update(ctx context.Context, template *domain.LabelTemplate) error
	SoftDelete(ctx context.Context, id string) error
	ClearDefault(ctx context.Context, category domain.Category, excludeID string) error
}

type labelTemplateRecord struct {
	ID               string                `gorm:"column:id;primaryKey"`
	Name             string                `gorm:"column:name;not null"`
	ResourceCategory string                `gorm:"column:resource_category;not null"`
	IsDefault        bool                  `gorm:"column:is_default;not null"`
	Mappings         []domain.LabelMapping `gorm:"column:mappings;serializer:json;not null"`
	CreatedAt        time.Time             `gorm:"column:created_at"`
	UpdatedAt        time.Time             `gorm:"column:updated_at"`
	DeletedAt        gorm.DeletedAt        `gorm:"column:deleted_at;index"`
}

func (labelTemplateRecord) TableName() string { return "m07_label_templates" }

func (r labelTemplateRecord) toDomain() *domain.LabelTemplate {
	mappings := r.Mappings
	if mappings == nil {
		mappings = []domain.LabelMapping{}
	}
	return &domain.LabelTemplate{
		ID:               r.ID,
		Name:             r.Name,
		ResourceCategory: domain.Category(r.ResourceCategory),
		IsDefault:        r.IsDefault,
		Mappings:         mappings,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
}

func labelTemplateFromDomain(t *domain.LabelTemplate) labelTemplateRecord {
	mappings := t.Mappings
	if mappings == nil {
		mappings = []domain.LabelMapping{}
	}
	return labelTemplateRecord{
		ID:               t.ID,
		Name:             t.Name,
		ResourceCategory: string(t.ResourceCategory),
		IsDefault:        t.IsDefault,
		Mappings:         mappings,
		CreatedAt:        t.CreatedAt,
		UpdatedAt:        t.UpdatedAt,
	}
}

// GORMLabelTemplateRepository is the GORM-backed implementation.
type GORMLabelTemplateRepository struct {
	db *gorm.DB
}

// NewLabelTemplateRepository constructs the repository.
func NewLabelTemplateRepository(db *gorm.DB) *GORMLabelTemplateRepository {
	return &GORMLabelTemplateRepository{db: db}
}

// Create inserts a label template.
func (r *GORMLabelTemplateRepository) Create(ctx context.Context, template *domain.LabelTemplate) error {
	if template.ID == "" {
		id, err := domain.NewResourceID()
		if err != nil {
			return err
		}
		template.ID = id
	}
	rec := labelTemplateFromDomain(template)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return labelTemplateWriteError(err, template.Name, string(template.ResourceCategory))
	}
	template.CreatedAt, template.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one label template by id.
func (r *GORMLabelTemplateRepository) Get(ctx context.Context, id string) (*domain.LabelTemplate, error) {
	var rec labelTemplateRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, &domain.LabelTemplateNotFoundError{ID: id}
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of label templates.
func (r *GORMLabelTemplateRepository) List(ctx context.Context, filter LabelTemplateFilter) ([]*domain.LabelTemplate, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&labelTemplateRecord{})
		if filter.ResourceCategory != "" {
			q = q.Where("resource_category = ?", string(filter.ResourceCategory))
		}
		if filter.IsDefault != nil {
			q = q.Where("is_default = ?", *filter.IsDefault)
		}
		if filter.Keyword != "" {
			q = q.Where("name LIKE ?", "%"+filter.Keyword+"%")
		}
		return q
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	var recs []labelTemplateRecord
	if err := build().
		Order("is_default DESC, resource_category ASC, name ASC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.LabelTemplate, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable label template fields.
func (r *GORMLabelTemplateRepository) Update(ctx context.Context, template *domain.LabelTemplate) error {
	rec := labelTemplateFromDomain(template)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return labelTemplateWriteError(res.Error, template.Name, string(template.ResourceCategory))
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, template.ID); err != nil {
			return err
		}
	}
	template.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a label template as deleted.
func (r *GORMLabelTemplateRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&labelTemplateRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return &domain.LabelTemplateNotFoundError{ID: id}
	}
	return nil
}

// ClearDefault clears the default flag of the other templates in one category.
func (r *GORMLabelTemplateRepository) ClearDefault(ctx context.Context, category domain.Category, excludeID string) error {
	q := r.db.WithContext(ctx).Model(&labelTemplateRecord{}).
		Where("resource_category = ? AND is_default = ?", string(category), true)
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	return q.Update("is_default", false).Error
}

func labelTemplateWriteError(err error, name, category string) error {
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "duplicate key value violates unique constraint") {
		return &domain.LabelTemplateConflictError{
			Message: "label template conflict: name " + name + " already exists for category " + category,
		}
	}
	return err
}
