package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"gorm.io/gorm"
)

type resourceLabelRecord struct {
	ID         string         `gorm:"column:id;primaryKey"`
	ResourceID string         `gorm:"column:resource_id;not null"`
	Key        string         `gorm:"column:key;not null"`
	Value      string         `gorm:"column:value;not null"`
	Source     string         `gorm:"column:source;not null"`
	CreatedAt  time.Time      `gorm:"column:created_at"`
	UpdatedAt  time.Time      `gorm:"column:updated_at"`
	DeletedAt  gorm.DeletedAt `gorm:"column:deleted_at;index"`
}

func (resourceLabelRecord) TableName() string { return "resource_labels" }

// LabelRepository persists user/cmdb resource labels.
type LabelRepository interface {
	List(ctx context.Context, resourceID string) ([]domain.Label, error)
	Create(ctx context.Context, label *domain.Label) error
	Update(ctx context.Context, resourceID, labelID, value string) (*domain.Label, error)
	Delete(ctx context.Context, resourceID, labelID string) error
}

// GORMLabelRepository is the GORM-backed LabelRepository.
type GORMLabelRepository struct {
	db *gorm.DB
}

// NewGORMLabelRepository constructs a label repository.
func NewGORMLabelRepository(db *gorm.DB) *GORMLabelRepository {
	return &GORMLabelRepository{db: db}
}

func (r *GORMLabelRepository) List(ctx context.Context, resourceID string) ([]domain.Label, error) {
	var rows []resourceLabelRecord
	if err := r.db.WithContext(ctx).
		Where("resource_id = ?", resourceID).
		Order("source ASC, key ASC").
		Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("list labels for %s: %w", resourceID, err)
	}
	out := make([]domain.Label, 0, len(rows))
	for i := range rows {
		out = append(out, toDomainLabel(&rows[i]))
	}
	return out, nil
}

func (r *GORMLabelRepository) Create(ctx context.Context, label *domain.Label) error {
	if err := label.Validate(); err != nil {
		return err
	}
	if label.ID == "" {
		id, err := domain.NewResourceID()
		if err != nil {
			return err
		}
		label.ID = id
	}
	rec := &resourceLabelRecord{
		ID:         label.ID,
		ResourceID: label.ResourceID,
		Key:        label.Key,
		Value:      label.Value,
		Source:     string(label.Source),
	}
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return mapWriteError(err, label.Key)
	}
	label.CreatedAt = rec.CreatedAt
	label.UpdatedAt = rec.UpdatedAt
	return nil
}

func (r *GORMLabelRepository) Update(ctx context.Context, resourceID, labelID, value string) (*domain.Label, error) {
	if err := domain.ValidateLabelValue(value); err != nil {
		return nil, err
	}
	result := r.db.WithContext(ctx).Model(&resourceLabelRecord{}).
		Where("id = ? AND resource_id = ?", labelID, resourceID).
		Updates(map[string]any{"value": value, "updated_at": time.Now().UTC()})
	if result.Error != nil {
		return nil, fmt.Errorf("update label %s: %w", labelID, result.Error)
	}
	if result.RowsAffected == 0 {
		return nil, &domain.NotFoundError{ResourceID: labelID}
	}
	var rec resourceLabelRecord
	if err := r.db.WithContext(ctx).
		Where("id = ? AND resource_id = ?", labelID, resourceID).
		First(&rec).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, &domain.NotFoundError{ResourceID: labelID}
		}
		return nil, fmt.Errorf("reload label %s: %w", labelID, err)
	}
	label := toDomainLabel(&rec)
	return &label, nil
}

func (r *GORMLabelRepository) Delete(ctx context.Context, resourceID, labelID string) error {
	result := r.db.WithContext(ctx).
		Where("id = ? AND resource_id = ?", labelID, resourceID).
		Delete(&resourceLabelRecord{})
	if result.Error != nil {
		return fmt.Errorf("delete label %s: %w", labelID, result.Error)
	}
	if result.RowsAffected == 0 {
		return &domain.NotFoundError{ResourceID: labelID}
	}
	return nil
}

func toDomainLabel(rec *resourceLabelRecord) domain.Label {
	return domain.Label{
		ID:         rec.ID,
		ResourceID: rec.ResourceID,
		Key:        rec.Key,
		Value:      rec.Value,
		Source:     domain.LabelSource(rec.Source),
		CreatedAt:  rec.CreatedAt,
		UpdatedAt:  rec.UpdatedAt,
	}
}
