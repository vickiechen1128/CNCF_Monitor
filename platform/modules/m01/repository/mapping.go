package repository

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// MappingFilter filters default collection mappings.
type MappingFilter struct {
	MonitorType string
	IsDefault   *bool
	Keyword     string
	Page        int
	PageSize    int
}

// MappingRepository persists monitor-type to exporter mappings.
type MappingRepository interface {
	Create(ctx context.Context, mapping *domain.Mapping) error
	Get(ctx context.Context, id string) (*domain.Mapping, error)
	List(ctx context.Context, filter MappingFilter) ([]*domain.Mapping, int64, error)
	Update(ctx context.Context, mapping *domain.Mapping) error
	SoftDelete(ctx context.Context, id string) error
	FindByMonitorTypeAndExporter(ctx context.Context, monitorType, exporterID string) (*domain.Mapping, bool, error)
	DefaultByMonitorType(ctx context.Context, monitorType string) (*domain.Mapping, bool, error)
	HasDefault(ctx context.Context, monitorType, excludeID string) (bool, error)
	CountByExporterTemplate(ctx context.Context, exporterID string) (int64, error)
	CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error)
}

// GORMMappingRepository is the GORM-backed implementation.
type GORMMappingRepository struct {
	db *gorm.DB
}

// NewMappingRepository constructs the repository.
func NewMappingRepository(db *gorm.DB) *GORMMappingRepository {
	return &GORMMappingRepository{db: db}
}

// Create inserts a mapping.
func (r *GORMMappingRepository) Create(ctx context.Context, mapping *domain.Mapping) error {
	if mapping.ID == "" {
		id, err := domain.NewID()
		if err != nil {
			return err
		}
		mapping.ID = id
	}
	rec := mappingFromDomain(mapping)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "ci_exporter_mapping", "monitor_type/exporter_template_id", mapping.MonitorType+"/"+mapping.ExporterTemplateID)
	}
	mapping.CreatedAt, mapping.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one mapping by id.
func (r *GORMMappingRepository) Get(ctx context.Context, id string) (*domain.Mapping, error) {
	var rec mappingRecord
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&rec).Error; err != nil {
		if isNotFound(err) {
			return nil, notFound("ci_exporter_mapping", id)
		}
		return nil, err
	}
	return rec.toDomain(), nil
}

// List returns a page of mappings.
func (r *GORMMappingRepository) List(ctx context.Context, filter MappingFilter) ([]*domain.Mapping, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&mappingRecord{})
		if filter.MonitorType != "" {
			q = q.Where("monitor_type = ?", filter.MonitorType)
		}
		if filter.IsDefault != nil {
			q = q.Where("is_default = ?", *filter.IsDefault)
		}
		return keywordFilter(q, "monitor_type", filter.Keyword)
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []mappingRecord
	if err := paginate(build().Order("monitor_type ASC, is_default DESC, updated_at DESC"), filter.Page, filter.PageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Mapping, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces mutable mapping fields. Callers are responsible for the
// "single default per monitor_type" invariant; the database enforces it as a
// partial unique index and surfaces a conflict here.
func (r *GORMMappingRepository) Update(ctx context.Context, mapping *domain.Mapping) error {
	rec := mappingFromDomain(mapping)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("id = ?", rec.ID).
		Select("*").
		Omit("id", "created_at", "deleted_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "ci_exporter_mapping", "monitor_type", mapping.MonitorType)
	}
	if res.RowsAffected == 0 {
		if _, err := r.Get(ctx, mapping.ID); err != nil {
			return err
		}
	}
	mapping.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a mapping as deleted.
func (r *GORMMappingRepository) SoftDelete(ctx context.Context, id string) error {
	res := r.db.WithContext(ctx).Delete(&mappingRecord{}, "id = ?", id)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("ci_exporter_mapping", id)
	}
	return nil
}

// FindByMonitorTypeAndExporter looks up the natural key of a mapping.
func (r *GORMMappingRepository) FindByMonitorTypeAndExporter(ctx context.Context, monitorType, exporterID string) (*domain.Mapping, bool, error) {
	var rec mappingRecord
	err := r.db.WithContext(ctx).
		Where("monitor_type = ? AND exporter_template_id = ?", monitorType, exporterID).
		First(&rec).Error
	if isNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return rec.toDomain(), true, nil
}

// DefaultByMonitorType returns the default mapping for a monitor type.
func (r *GORMMappingRepository) DefaultByMonitorType(ctx context.Context, monitorType string) (*domain.Mapping, bool, error) {
	var rec mappingRecord
	err := r.db.WithContext(ctx).
		Where("monitor_type = ? AND is_default = ?", monitorType, true).
		First(&rec).Error
	if isNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return rec.toDomain(), true, nil
}

// HasDefault reports whether another default mapping exists for monitorType.
func (r *GORMMappingRepository) HasDefault(ctx context.Context, monitorType, excludeID string) (bool, error) {
	q := r.db.WithContext(ctx).Model(&mappingRecord{}).
		Where("monitor_type = ? AND is_default = ?", monitorType, true)
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	var count int64
	if err := q.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}

// CountByExporterTemplate counts mappings that reference an exporter template.
func (r *GORMMappingRepository) CountByExporterTemplate(ctx context.Context, exporterID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&mappingRecord{}).
		Where("exporter_template_id = ?", exporterID).Count(&count).Error
	return count, err
}

// CountByLabelTemplate counts mappings that reference a label template.
func (r *GORMMappingRepository) CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error) {
	if labelTemplateID == "" {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&mappingRecord{}).
		Where("label_template_id = ?", labelTemplateID).Count(&count).Error
	return count, err
}
