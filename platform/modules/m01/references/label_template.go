package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// GORMLabelTemplateReader reads M07 v3 label templates. M01 only reads; M07
// owns the table and lifecycle.
type GORMLabelTemplateReader struct {
	db *gorm.DB
}

// NewLabelTemplateReader constructs the reader.
func NewLabelTemplateReader(db *gorm.DB) *GORMLabelTemplateReader {
	return &GORMLabelTemplateReader{db: db}
}

// Resolve implements service.LabelTemplateResolver.
func (r *GORMLabelTemplateReader) Resolve(ctx context.Context, id string) (domain.LabelTemplateRef, bool, error) {
	var row struct {
		ID               string `gorm:"column:id"`
		Name             string `gorm:"column:name"`
		ResourceCategory string `gorm:"column:resource_category"`
		IsDefault        bool   `gorm:"column:is_default"`
	}
	if err := r.db.WithContext(ctx).
		Table("m07_label_templates").
		Select("id, name, resource_category, is_default").
		Where("id = ? AND deleted_at IS NULL", id).
		Limit(1).
		Scan(&row).Error; err != nil {
		return domain.LabelTemplateRef{}, false, fmt.Errorf("resolve label template %q: %w", id, err)
	}
	if row.ID == "" {
		return domain.LabelTemplateRef{}, false, nil
	}
	return domain.LabelTemplateRef{
		ID:        row.ID,
		Name:      row.Name,
		Category:  row.ResourceCategory,
		IsDefault: row.IsDefault,
	}, true, nil
}

// LabelTemplateUsageChecker counts M01 source records that still reference a
// label template. M07 injects it to guard template deletion.
type LabelTemplateUsageChecker struct {
	db *gorm.DB
}

// NewLabelTemplateUsageChecker constructs the checker.
func NewLabelTemplateUsageChecker(db *gorm.DB) *LabelTemplateUsageChecker {
	return &LabelTemplateUsageChecker{db: db}
}

// CountReferences implements the M07 usage-checker port.
func (c *LabelTemplateUsageChecker) CountReferences(ctx context.Context, templateID string) (int64, error) {
	var mappingCount int64
	if err := c.db.WithContext(ctx).
		Table("m01_ci_type_exporter_mappings").
		Where("label_template_id = ? AND deleted_at IS NULL", templateID).
		Count(&mappingCount).Error; err != nil {
		return 0, fmt.Errorf("count mapping references for label template %q: %w", templateID, err)
	}
	var jobCount int64
	if err := c.db.WithContext(ctx).
		Table("m01_scrape_jobs").
		Where("label_template_id = ? AND deleted_at IS NULL", templateID).
		Count(&jobCount).Error; err != nil {
		return 0, fmt.Errorf("count job references for label template %q: %w", templateID, err)
	}
	return mappingCount + jobCount, nil
}
