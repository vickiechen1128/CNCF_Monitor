package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// MetricFilter filters technical metric listings.
type MetricFilter struct {
	MetricType domain.MetricType
	Category   string
	Enabled    *bool
	Keyword    string
	Page       int
	PageSize   int
}

// MetricRepository persists the technical metric catalogue.
type MetricRepository interface {
	Create(ctx context.Context, metric *domain.Metric) error
	Get(ctx context.Context, id string) (*domain.Metric, error)
	GetBuiltinByName(ctx context.Context, name string) (*domain.Metric, bool, error)
	List(ctx context.Context, filter MetricFilter) ([]*domain.Metric, int64, error)
	Update(ctx context.Context, metric *domain.Metric) error
	SoftDelete(ctx context.Context, id string) error
}

// GORMMetricRepository is the GORM-backed implementation.
type GORMMetricRepository struct {
	db *gorm.DB
}

// NewMetricRepository constructs the repository.
func NewMetricRepository(db *gorm.DB) *GORMMetricRepository {
	return &GORMMetricRepository{db: db}
}

// Create inserts a technical metric.
func (r *GORMMetricRepository) Create(ctx context.Context, metric *domain.Metric) error {
	if metric.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		metric.ID = id
	}
	rec := metricFromDomain(metric)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "metric", "metric_name", metric.MetricName)
	}
	metric.CreatedAt, metric.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one technical metric by id.
func (r *GORMMetricRepository) Get(ctx context.Context, id string) (*domain.Metric, error) {
	var rec metricRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("metric", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// GetBuiltinByName looks up a built-in metric by name (seed idempotency).
func (r *GORMMetricRepository) GetBuiltinByName(ctx context.Context, name string) (*domain.Metric, bool, error) {
	var rec metricRecord
	err := r.db.WithContext(ctx).
		Where("metric_name = ? AND is_builtin = ?", name, true).
		First(&rec).Error
	if isNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return rec.toDomain(), true, nil
}

// List returns a page of technical metrics.
func (r *GORMMetricRepository) List(ctx context.Context, filter MetricFilter) ([]*domain.Metric, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&metricRecord{})
		if filter.MetricType != "" {
			q = q.Where("metric_type = ?", string(filter.MetricType))
		}
		if filter.Category != "" {
			q = q.Where("category = ?", filter.Category)
		}
		if filter.Enabled != nil {
			q = q.Where("enabled = ?", *filter.Enabled)
		}
		return keywordFilter(q, "metric_name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []metricRecord
	if err := paginate(build().Order("is_builtin DESC, metric_name ASC, id ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Metric, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable technical metric fields (never is_builtin).
func (r *GORMMetricRepository) Update(ctx context.Context, metric *domain.Metric) error {
	rec := metricFromDomain(metric)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at", "is_builtin").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "metric", "metric_name", metric.MetricName)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, metric.ID); err != nil {
			return err
		}
	}
	metric.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a technical metric as deleted.
func (r *GORMMetricRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&metricRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("metric", id)
	}
	return nil
}
