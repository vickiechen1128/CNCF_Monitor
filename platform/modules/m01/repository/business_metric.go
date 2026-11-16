package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// BusinessMetricFilter filters business metric listings.
type BusinessMetricFilter struct {
	BusinessDomain string
	Status         domain.BusinessMetricStatus
	Owner          string
	Keyword        string
	Page           int
	PageSize       int
}

// BusinessMetricRepository persists the business metric catalogue.
type BusinessMetricRepository interface {
	Create(ctx context.Context, metric *domain.BusinessMetric) error
	Get(ctx context.Context, id string) (*domain.BusinessMetric, error)
	GetByName(ctx context.Context, name string) (*domain.BusinessMetric, bool, error)
	List(ctx context.Context, filter BusinessMetricFilter) ([]*domain.BusinessMetric, int64, error)
	Update(ctx context.Context, metric *domain.BusinessMetric) error
	SoftDelete(ctx context.Context, id string) error
}

// GORMBusinessMetricRepository is the GORM-backed implementation.
type GORMBusinessMetricRepository struct {
	db *gorm.DB
}

// NewBusinessMetricRepository constructs the repository.
func NewBusinessMetricRepository(db *gorm.DB) *GORMBusinessMetricRepository {
	return &GORMBusinessMetricRepository{db: db}
}

// Create inserts a business metric.
func (r *GORMBusinessMetricRepository) Create(ctx context.Context, metric *domain.BusinessMetric) error {
	if metric.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		metric.ID = id
	}
	rec := businessMetricFromDomain(metric)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "business_metric", "metric_name", metric.MetricName)
	}
	metric.CreatedAt, metric.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one business metric by id.
func (r *GORMBusinessMetricRepository) Get(ctx context.Context, id string) (*domain.BusinessMetric, error) {
	var rec businessMetricRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("business_metric", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// GetByName looks up a business metric by its unique metric name.
func (r *GORMBusinessMetricRepository) GetByName(ctx context.Context, name string) (*domain.BusinessMetric, bool, error) {
	var rec businessMetricRecord
	err := r.db.WithContext(ctx).Where("metric_name = ?", name).First(&rec).Error
	if isNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return rec.toDomain(), true, nil
}

// List returns a page of business metrics.
func (r *GORMBusinessMetricRepository) List(ctx context.Context, filter BusinessMetricFilter) ([]*domain.BusinessMetric, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&businessMetricRecord{})
		if filter.BusinessDomain != "" {
			q = q.Where("business_domain = ?", filter.BusinessDomain)
		}
		if filter.Status != "" {
			q = q.Where("status = ?", string(filter.Status))
		}
		if filter.Owner != "" {
			q = q.Where("owner = ?", filter.Owner)
		}
		return keywordFilter(q, "metric_name", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []businessMetricRecord
	if err := paginate(build().Order("updated_at DESC, id ASC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.BusinessMetric, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable business metric fields.
func (r *GORMBusinessMetricRepository) Update(ctx context.Context, metric *domain.BusinessMetric) error {
	rec := businessMetricFromDomain(metric)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "business_metric", "metric_name", metric.MetricName)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, metric.ID); err != nil {
			return err
		}
	}
	metric.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a business metric as deleted.
func (r *GORMBusinessMetricRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&businessMetricRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("business_metric", id)
	}
	return nil
}
