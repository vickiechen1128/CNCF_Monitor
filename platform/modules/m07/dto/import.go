package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// ImportError is a row-level import error.
type ImportError struct {
	Row              int    `json:"row"`
	ResourceCategory string `json:"resource_category"`
	Field            string `json:"field"`
	Value            string `json:"value"`
	Reason           string `json:"reason"`
}

// ImportRecord is an import job record.
type ImportRecord struct {
	ID               string        `json:"id"`
	ImportNo         string        `json:"import_no"`
	ResourceCategory string        `json:"resource_category"`
	Mode             string        `json:"mode"`
	Total            int           `json:"total"`
	Success          int           `json:"success"`
	Updated          int           `json:"updated"`
	Failed           int           `json:"failed"`
	Status           string        `json:"status"`
	Errors           []ImportError `json:"errors"`
	Operator         string        `json:"operator"`
	CreatedAt        time.Time     `json:"created_at"`
}

// FromImportRecord maps a domain import record to a DTO.
func FromImportRecord(record *domain.ImportRecord) ImportRecord {
	errors := make([]ImportError, 0, len(record.Errors))
	for _, item := range record.Errors {
		errors = append(errors, ImportError{
			Row:              item.Row,
			ResourceCategory: item.ResourceCategory,
			Field:            item.Field,
			Value:            item.Value,
			Reason:           item.Reason,
		})
	}
	return ImportRecord{
		ID:               record.ID,
		ImportNo:         record.ImportNo,
		ResourceCategory: string(record.ResourceCategory),
		Mode:             string(record.Mode),
		Total:            record.Total,
		Success:          record.Success,
		Updated:          record.Updated,
		Failed:           record.Failed,
		Status:           string(record.Status),
		Errors:           errors,
		Operator:         record.Operator,
		CreatedAt:        record.CreatedAt,
	}
}

// FromImportRecords maps domain records to DTOs.
func FromImportRecords(records []*domain.ImportRecord) []ImportRecord {
	out := make([]ImportRecord, 0, len(records))
	for _, record := range records {
		out = append(out, FromImportRecord(record))
	}
	return out
}
