package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// collectionTemplateRecord maps m01_collection_templates (SRS Module_01 v1.5).
type collectionTemplateRecord struct {
	Code               string          `gorm:"column:code;primaryKey"`
	Name               string          `gorm:"column:name;not null"`
	ResourceCategory   string          `gorm:"column:resource_category;not null"`
	ExporterTemplateID string          `gorm:"column:exporter_template_id;not null"`
	DefaultPort        int             `gorm:"column:default_port;not null"`
	MetricsPath        string          `gorm:"column:metrics_path;not null"`
	Scheme             string          `gorm:"column:scheme;not null"`
	ScrapeInterval     string          `gorm:"column:scrape_interval;not null"`
	ScrapeTimeout      string          `gorm:"column:scrape_timeout;not null"`
	LabelTemplateID    *string         `gorm:"column:label_template_id"`
	DefaultSelector    domain.Selector `gorm:"column:default_selector;serializer:json;not null"`
	Description        string          `gorm:"column:description;not null"`
	SortOrder          int             `gorm:"column:sort_order;not null"`
	Enabled            bool            `gorm:"column:enabled;not null"`
	IsBuiltin          bool            `gorm:"column:is_builtin;not null"`
	CreatedAt          time.Time       `gorm:"column:created_at"`
	UpdatedAt          time.Time       `gorm:"column:updated_at"`
	DeletedAt          gorm.DeletedAt  `gorm:"column:deleted_at;index"`
}

func (collectionTemplateRecord) TableName() string { return "m01_collection_templates" }

func (r collectionTemplateRecord) toDomain() *domain.CollectionTemplate {
	return &domain.CollectionTemplate{
		Code:               r.Code,
		Name:               r.Name,
		ResourceCategory:   domain.ResourceCategory(r.ResourceCategory),
		ExporterTemplateID: r.ExporterTemplateID,
		DefaultPort:        r.DefaultPort,
		MetricsPath:        r.MetricsPath,
		Scheme:             domain.Scheme(r.Scheme),
		ScrapeInterval:     r.ScrapeInterval,
		ScrapeTimeout:      r.ScrapeTimeout,
		LabelTemplateID:    derefString(r.LabelTemplateID),
		DefaultSelector:    r.DefaultSelector,
		Description:        r.Description,
		SortOrder:          r.SortOrder,
		Enabled:            r.Enabled,
		IsBuiltin:          r.IsBuiltin,
		CreatedAt:          r.CreatedAt,
		UpdatedAt:          r.UpdatedAt,
	}
}

func collectionTemplateFromDomain(t *domain.CollectionTemplate) collectionTemplateRecord {
	return collectionTemplateRecord{
		Code:               t.Code,
		Name:               t.Name,
		ResourceCategory:   string(t.ResourceCategory),
		ExporterTemplateID: t.ExporterTemplateID,
		DefaultPort:        t.DefaultPort,
		MetricsPath:        t.MetricsPath,
		Scheme:             string(t.Scheme),
		ScrapeInterval:     t.ScrapeInterval,
		ScrapeTimeout:      t.ScrapeTimeout,
		LabelTemplateID:    nilIfEmpty(t.LabelTemplateID),
		DefaultSelector:    t.DefaultSelector,
		Description:        t.Description,
		SortOrder:          t.SortOrder,
		Enabled:            t.Enabled,
		IsBuiltin:          t.IsBuiltin,
		CreatedAt:          t.CreatedAt,
		UpdatedAt:          t.UpdatedAt,
	}
}

// TemplateFilter filters collection templates.
type TemplateFilter struct {
	ResourceCategory string
	Enabled          *bool
	Keyword          string
	Page             int
	PageSize         int
}

// TemplateReferenceCounts is the reference breakdown returned by delete
// pre-flight and by the change-impact preview (FR-24).
type TemplateReferenceCounts struct {
	Jobs          int64 `json:"jobs"`
	MetricAnchors int64 `json:"metric_anchors"`
}

// Total sums every reference class.
func (c TemplateReferenceCounts) Total() int64 { return c.Jobs + c.MetricAnchors }

// CollectionTemplateRepository persists collection templates.
type CollectionTemplateRepository interface {
	Create(ctx context.Context, template *domain.CollectionTemplate) error
	Get(ctx context.Context, code string) (*domain.CollectionTemplate, error)
	Find(ctx context.Context, code string) (*domain.CollectionTemplate, bool, error)
	List(ctx context.Context, filter TemplateFilter) ([]*domain.CollectionTemplate, int64, error)
	Update(ctx context.Context, template *domain.CollectionTemplate) error
	SoftDelete(ctx context.Context, code string) error
	CountReferences(ctx context.Context, code string) (TemplateReferenceCounts, error)
	CountByExporterTemplate(ctx context.Context, exporterID string) (int64, error)
	CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error)
}

// GORMCollectionTemplateRepository is the GORM-backed implementation.
type GORMCollectionTemplateRepository struct {
	db *gorm.DB
}

// NewCollectionTemplateRepository constructs the repository.
func NewCollectionTemplateRepository(db *gorm.DB) *GORMCollectionTemplateRepository {
	return &GORMCollectionTemplateRepository{db: db}
}

// Create inserts a template.
func (r *GORMCollectionTemplateRepository) Create(ctx context.Context, template *domain.CollectionTemplate) error {
	rec := collectionTemplateFromDomain(template)
	if err := r.db.WithContext(ctx).Create(&rec).Error; err != nil {
		return mapWriteError(err, "collection_template", "code", template.Code)
	}
	template.CreatedAt, template.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Get loads one template and surfaces a not-found error.
func (r *GORMCollectionTemplateRepository) Get(ctx context.Context, code string) (*domain.CollectionTemplate, error) {
	template, found, err := r.Find(ctx, code)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, notFound("collection_template", code)
	}
	return template, nil
}

// Find loads one template.
func (r *GORMCollectionTemplateRepository) Find(ctx context.Context, code string) (*domain.CollectionTemplate, bool, error) {
	var rec collectionTemplateRecord
	err := r.db.WithContext(ctx).Where("code = ?", code).First(&rec).Error
	if isNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get collection template %q: %w", code, err)
	}
	return rec.toDomain(), true, nil
}

// List returns a page of templates.
func (r *GORMCollectionTemplateRepository) List(ctx context.Context, filter TemplateFilter) ([]*domain.CollectionTemplate, int64, error) {
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&collectionTemplateRecord{})
		if filter.ResourceCategory != "" {
			q = q.Where("resource_category = ?", filter.ResourceCategory)
		}
		if filter.Enabled != nil {
			q = q.Where("enabled = ?", *filter.Enabled)
		}
		if filter.Keyword != "" {
			like := "%" + filter.Keyword + "%"
			q = q.Where("(code LIKE ? OR name LIKE ?)", like, like)
		}
		return q
	}

	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var recs []collectionTemplateRecord
	if err := paginate(build().Order("resource_category ASC, sort_order ASC, code ASC"), filter.Page, filter.PageSize).
		Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.CollectionTemplate, 0, len(recs))
	for _, rec := range recs {
		out = append(out, rec.toDomain())
	}
	return out, total, nil
}

// Update replaces the mutable template fields. Code is immutable.
func (r *GORMCollectionTemplateRepository) Update(ctx context.Context, template *domain.CollectionTemplate) error {
	rec := collectionTemplateFromDomain(template)
	rec.UpdatedAt = time.Now().UTC()
	res := r.db.WithContext(ctx).Model(&rec).
		Where("code = ?", rec.Code).
		Select("name", "resource_category", "exporter_template_id", "default_port", "metrics_path",
			"scheme", "scrape_interval", "scrape_timeout", "label_template_id", "default_selector",
			"description", "sort_order", "enabled", "updated_at").
		Updates(&rec)
	if res.Error != nil {
		return mapWriteError(res.Error, "collection_template", "code", template.Code)
	}
	if res.RowsAffected == 0 {
		if _, found, err := r.Find(ctx, template.Code); err != nil {
			return err
		} else if !found {
			return notFound("collection_template", template.Code)
		}
	}
	template.UpdatedAt = rec.UpdatedAt
	return nil
}

// SoftDelete marks a template as deleted.
func (r *GORMCollectionTemplateRepository) SoftDelete(ctx context.Context, code string) error {
	res := r.db.WithContext(ctx).Delete(&collectionTemplateRecord{}, "code = ?", code)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("collection_template", code)
	}
	return nil
}

// CountReferences counts the rows still pointing at a template.
func (r *GORMCollectionTemplateRepository) CountReferences(ctx context.Context, code string) (TemplateReferenceCounts, error) {
	counts := TemplateReferenceCounts{}
	if err := r.db.WithContext(ctx).Model(&jobRecord{}).
		Where("template_code = ?", code).Count(&counts.Jobs).Error; err != nil {
		return counts, fmt.Errorf("count template jobs: %w", err)
	}
	// Metric anchors are stored as an array of {template_code,…} objects. The
	// column is JSONB on PostgreSQL and TEXT (JSON1) on SQLite, so a LIKE would
	// fail on PostgreSQL ("operator does not exist: jsonb ~~ unknown"): query the
	// array elements instead.
	if err := r.anchoredMetrics(r.db.WithContext(ctx), code).Count(&counts.MetricAnchors).Error; err != nil {
		return counts, fmt.Errorf("count template metric anchors: %w", err)
	}
	return counts, nil
}

// anchoredMetrics restricts a metric query to rows whose anchor array contains
// the given template code.
func (r *GORMCollectionTemplateRepository) anchoredMetrics(q *gorm.DB, code string) *gorm.DB {
	if r.db.Dialector.Name() == "postgres" {
		return q.Model(&metricRecord{}).Where(
			"EXISTS (SELECT 1 FROM jsonb_array_elements(collection_templates) AS anchor WHERE anchor->>'template_code' = ?)",
			strings.TrimSpace(code),
		)
	}
	return q.Model(&metricRecord{}).Where(
		"EXISTS (SELECT 1 FROM json_each(collection_templates) AS anchor WHERE json_extract(anchor.value, '$.template_code') = ?)",
		strings.TrimSpace(code),
	)
}

// CountByExporterTemplate counts templates that reference an exporter template.
func (r *GORMCollectionTemplateRepository) CountByExporterTemplate(ctx context.Context, exporterID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&collectionTemplateRecord{}).
		Where("exporter_template_id = ?", exporterID).Count(&count).Error
	return count, err
}

// CountByLabelTemplate counts templates that reference a label template.
func (r *GORMCollectionTemplateRepository) CountByLabelTemplate(ctx context.Context, labelTemplateID string) (int64, error) {
	if labelTemplateID == "" {
		return 0, nil
	}
	var count int64
	err := r.db.WithContext(ctx).Model(&collectionTemplateRecord{}).
		Where("label_template_id = ?", labelTemplateID).Count(&count).Error
	return count, err
}
