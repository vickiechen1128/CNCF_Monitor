package importer

import (
	"errors"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
)

// ValidatedRow is a successfully parsed/validated row.
type ValidatedRow struct {
	RowNumber int
	Resource  *domain.Resource
	// Attributes are the parsed "attributes" column pairs, still unvalidated
	// against the capability dictionary (the importer service owns that check).
	Attributes map[string]string
}

// ValidateRows converts rows to domain resources and collects row-level errors.
func ValidateRows(rows []Row) ([]ValidatedRow, []domain.ImportErrorDetail) {
	valid := make([]ValidatedRow, 0, len(rows))
	errs := make([]domain.ImportErrorDetail, 0)
	for i := range rows {
		resource, err := rows[i].ToDomain()
		if err != nil {
			errs = append(errs, rowErrorDetail(rows[i], err))
			continue
		}
		pairs, err := rows[i].AttributePairs()
		if err != nil {
			errs = append(errs, rowErrorDetail(rows[i], err))
			continue
		}
		valid = append(valid, ValidatedRow{RowNumber: rows[i].RowNumber, Resource: resource, Attributes: pairs})
	}
	return valid, errs
}

func rowErrorDetail(row Row, err error) domain.ImportErrorDetail {
	detail := domain.ImportErrorDetail{
		Row:              row.RowNumber,
		ResourceCategory: string(row.Category),
		Reason:           err.Error(),
	}
	var rowErr *ImportRowError
	if errors.As(err, &rowErr) {
		detail.Field = rowErr.Field
		detail.Value = rowErr.Value
		detail.Reason = rowErr.Reason
	}
	return detail
}
