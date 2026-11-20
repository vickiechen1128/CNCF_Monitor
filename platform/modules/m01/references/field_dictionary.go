// Package references contains the read-only cross-module adapters of M01.
//
// This file exposes the M07 CI-model custom fields so the selector field
// dictionary can list them without duplicating M07's schema (SRS Module_01 v1.5
// §5.6 / NFR-11).
package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// CustomField is one M07-registered custom field usable as a selector condition.
type CustomField struct {
	Key              string
	Label            string
	ValueType        string
	ResourceCategory string
}

// CustomFieldReader lists the custom fields M07 currently keeps "in the model".
type CustomFieldReader interface {
	ListCustomFields(ctx context.Context) ([]CustomField, error)
}

// GORMCustomFieldReader reads m07_attribute_definitions directly (read-only).
type GORMCustomFieldReader struct {
	db *gorm.DB
}

// NewCustomFieldReader constructs the reader.
func NewCustomFieldReader(db *gorm.DB) *GORMCustomFieldReader {
	return &GORMCustomFieldReader{db: db}
}

// ListCustomFields returns every active custom field across CI categories.
func (r *GORMCustomFieldReader) ListCustomFields(ctx context.Context) ([]CustomField, error) {
	var rows []struct {
		AttributeKey     string `gorm:"column:attribute_key"`
		DisplayName      string `gorm:"column:display_name"`
		ValueType        string `gorm:"column:value_type"`
		ResourceCategory string `gorm:"column:resource_category"`
	}
	err := r.db.WithContext(ctx).Table("m07_attribute_definitions").
		Select("attribute_key, display_name, value_type, resource_category").
		Where("status = ? AND deleted_at IS NULL", "active").
		Order("resource_category ASC, display_order ASC, attribute_key ASC").
		Scan(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("list M07 custom fields: %w", err)
	}
	out := make([]CustomField, 0, len(rows))
	for _, row := range rows {
		out = append(out, CustomField{
			Key:              row.AttributeKey,
			Label:            row.DisplayName,
			ValueType:        row.ValueType,
			ResourceCategory: row.ResourceCategory,
		})
	}
	return out, nil
}
