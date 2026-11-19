package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// attributeDefinitionRecord maps m07_attribute_definitions.
type attributeDefinitionRecord struct {
	ID               string         `gorm:"column:id;primaryKey"`
	AttributeKey     string         `gorm:"column:attribute_key;not null"`
	DisplayName      string         `gorm:"column:display_name;not null"`
	ValueType        string         `gorm:"column:value_type;not null"`
	ResourceCategory string         `gorm:"column:resource_category;not null"`
	EnumOptions      []string       `gorm:"column:enum_options;serializer:json;not null"`
	Required         bool           `gorm:"column:required;not null"`
	Enabled          bool           `gorm:"column:enabled;not null"`
	Description      string         `gorm:"column:description;not null"`
	CreatedAt        time.Time      `gorm:"column:created_at"`
	UpdatedAt        time.Time      `gorm:"column:updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (attributeDefinitionRecord) TableName() string { return "m07_attribute_definitions" }

func (r attributeDefinitionRecord) toDomain() *domain.AttributeDefinition {
	return &domain.AttributeDefinition{
		ID:               r.ID,
		Key:              r.AttributeKey,
		DisplayName:      r.DisplayName,
		ValueType:        domain.AttributeValueType(r.ValueType),
		ResourceCategory: domain.Category(r.ResourceCategory),
		EnumOptions:      nonNilStrings(r.EnumOptions),
		Required:         r.Required,
		Enabled:          r.Enabled,
		Description:      r.Description,
		CreatedAt:        r.CreatedAt,
		UpdatedAt:        r.UpdatedAt,
	}
}

func attributeDefinitionFromDomain(def *domain.AttributeDefinition) attributeDefinitionRecord {
	return attributeDefinitionRecord{
		ID:               def.ID,
		AttributeKey:     def.Key,
		DisplayName:      def.DisplayName,
		ValueType:        string(def.ValueType),
		ResourceCategory: string(def.ResourceCategory),
		EnumOptions:      nonNilStrings(def.EnumOptions),
		Required:         def.Required,
		Enabled:          def.Enabled,
		Description:      def.Description,
	}
}

// resourceAttributeRecord maps m07_resource_attributes.
type resourceAttributeRecord struct {
	ID           string         `gorm:"column:id;primaryKey"`
	ResourceID   string         `gorm:"column:resource_id;not null"`
	AttributeKey string         `gorm:"column:attribute_key;not null"`
	Value        string         `gorm:"column:value;not null"`
	CreatedAt    time.Time      `gorm:"column:created_at"`
	UpdatedAt    time.Time      `gorm:"column:updated_at"`
	DeletedAt    gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (resourceAttributeRecord) TableName() string { return "m07_resource_attributes" }

func (r resourceAttributeRecord) toDomain() *domain.ResourceAttribute {
	return &domain.ResourceAttribute{
		ID:         r.ID,
		ResourceID: r.ResourceID,
		Key:        r.AttributeKey,
		Value:      r.Value,
		CreatedAt:  r.CreatedAt,
		UpdatedAt:  r.UpdatedAt,
	}
}

// AttributeDefinitionRepository persists the long-tail capability dictionary.
type AttributeDefinitionRepository interface {
	List(ctx context.Context, category domain.Category) ([]*domain.AttributeDefinition, error)
	Get(ctx context.Context, id string) (*domain.AttributeDefinition, error)
	FindByKey(ctx context.Context, category domain.Category, key string) (*domain.AttributeDefinition, bool, error)
	Create(ctx context.Context, def *domain.AttributeDefinition) error
	Update(ctx context.Context, def *domain.AttributeDefinition) error
	SoftDelete(ctx context.Context, id string) error
	CountResourceValues(ctx context.Context, key string) (int64, error)
}

// GORMAttributeDefinitionRepository is the GORM-backed implementation.
type GORMAttributeDefinitionRepository struct {
	db *gorm.DB
}

// NewAttributeDefinitionRepository constructs the repository.
func NewAttributeDefinitionRepository(db *gorm.DB) *GORMAttributeDefinitionRepository {
	return &GORMAttributeDefinitionRepository{db: db}
}

// List returns the definitions of one category (empty means all).
func (r *GORMAttributeDefinitionRepository) List(ctx context.Context, category domain.Category) ([]*domain.AttributeDefinition, error) {
	query := r.db.WithContext(ctx).Model(&attributeDefinitionRecord{})
	if category != "" {
		query = query.Where("resource_category = ?", string(category))
	}
	var recs []attributeDefinitionRecord
	if err := query.Order("resource_category ASC, attribute_key ASC").Find(&recs).Error; err != nil {
		return nil, fmt.Errorf("list attribute definitions: %w", err)
	}
	out := make([]*domain.AttributeDefinition, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// Get loads one definition by id.
func (r *GORMAttributeDefinitionRepository) Get(ctx context.Context, id string) (*domain.AttributeDefinition, error) {
	var rec attributeDefinitionRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, &domain.NotFoundError{ResourceID: id}
		}
		return nil, fmt.Errorf("get attribute definition %q: %w", id, err)
	}
	return rec.toDomain(), nil
}

// FindByKey looks a definition up by its natural key within a category.
func (r *GORMAttributeDefinitionRepository) FindByKey(ctx context.Context, category domain.Category, key string) (*domain.AttributeDefinition, bool, error) {
	var rec attributeDefinitionRecord
	err := r.db.WithContext(ctx).
		Where("resource_category = ? AND attribute_key = ?", string(category), key).
		First(&rec).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("find attribute definition %q: %w", key, err)
	}
	return rec.toDomain(), true, nil
}

// Create inserts a definition.
func (r *GORMAttributeDefinitionRepository) Create(ctx context.Context, def *domain.AttributeDefinition) error {
	rec := attributeDefinitionFromDomain(def)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapAttributeWriteError(err)
	}
	def.CreatedAt, def.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Update replaces the mutable definition fields.
func (r *GORMAttributeDefinitionRepository) Update(ctx context.Context, def *domain.AttributeDefinition) error {
	rec := attributeDefinitionFromDomain(def)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&attributeDefinitionRecord{}).
		Where("id = ?", def.ID).
		Updates(map[string]any{
			"display_name": rec.DisplayName,
			"value_type":   rec.ValueType,
			"enum_options": rec.EnumOptions,
			"required":     rec.Required,
			"enabled":      rec.Enabled,
			"description":  rec.Description,
			"updated_at":   rec.UpdatedAt,
		})
	if res.Error != nil {
		return mapAttributeWriteError(res.Error)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, def.ID); err != nil {
			return err
		}
	}
	return nil
}

// SoftDelete marks a definition as deleted.
func (r *GORMAttributeDefinitionRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&attributeDefinitionRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return &domain.NotFoundError{ResourceID: id}
	}
	return nil
}

// CountResourceValues counts resource rows that still carry the attribute.
func (r *GORMAttributeDefinitionRepository) CountResourceValues(ctx context.Context, key string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&resourceAttributeRecord{}).
		Where("attribute_key = ?", key).Count(&count).Error
	if err != nil {
		return 0, fmt.Errorf("count resource attribute values: %w", err)
	}
	return count, nil
}

// ResourceAttributeRepository persists per-resource capability values.
type ResourceAttributeRepository interface {
	ListByResource(ctx context.Context, resourceID string) ([]*domain.ResourceAttribute, error)
	Replace(ctx context.Context, resourceID string, attrs []*domain.ResourceAttribute) error
}

// GORMResourceAttributeRepository is the GORM-backed implementation.
type GORMResourceAttributeRepository struct {
	db *gorm.DB
}

// NewResourceAttributeRepository constructs the repository.
func NewResourceAttributeRepository(db *gorm.DB) *GORMResourceAttributeRepository {
	return &GORMResourceAttributeRepository{db: db}
}

// ListByResource returns every capability value of one resource.
func (r *GORMResourceAttributeRepository) ListByResource(ctx context.Context, resourceID string) ([]*domain.ResourceAttribute, error) {
	var recs []resourceAttributeRecord
	if err := r.db.WithContext(ctx).
		Where("resource_id = ?", resourceID).
		Order("attribute_key ASC").
		Find(&recs).Error; err != nil {
		return nil, fmt.Errorf("list resource attributes: %w", err)
	}
	out := make([]*domain.ResourceAttribute, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// Replace swaps the whole attribute set of one resource in one transaction.
func (r *GORMResourceAttributeRepository) Replace(ctx context.Context, resourceID string, attrs []*domain.ResourceAttribute) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Unscoped().Where("resource_id = ?", resourceID).
			Delete(&resourceAttributeRecord{}).Error; err != nil {
			return fmt.Errorf("clear resource attributes: %w", err)
		}
		for _, attr := range attrs {
			rec := resourceAttributeRecord{
				ID:           attr.ID,
				ResourceID:   resourceID,
				AttributeKey: attr.Key,
				Value:        attr.Value,
			}
			if rec.ID == "" {
				id, err := domain.NewResourceID()
				if err != nil {
					return err
				}
				rec.ID = id
			}
			if err := tx.Create(&rec).Error; err != nil {
				return mapAttributeWriteError(err)
			}
		}
		return nil
	})
}

func mapAttributeWriteError(err error) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "23505") {
		return &domain.ConflictError{DedupKey: "attribute"}
	}
	return err
}

// nonNilStrings returns a JSON-friendly slice (never nil) so serialized
// columns stay '[]' instead of 'null'.
func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	out := make([]string, len(values))
	copy(out, values)
	return out
}
