package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m01/domain"
)

// DomainReader reads M06 network domains joined with M09 onboarding state.
type DomainReader interface {
	Get(ctx context.Context, id string) (domain.DomainRef, bool, error)
}

// GORMDomainReader is the GORM-backed implementation.
type GORMDomainReader struct {
	db *gorm.DB
}

// NewDomainReader constructs the reader.
func NewDomainReader(db *gorm.DB) *GORMDomainReader {
	return &GORMDomainReader{db: db}
}

// Get loads one domain plus its M09 registration status.
func (r *GORMDomainReader) Get(ctx context.Context, id string) (domain.DomainRef, bool, error) {
	var row struct {
		ID                 string `gorm:"column:id"`
		Name               string `gorm:"column:name"`
		Status             string `gorm:"column:status"`
		DomainType         string `gorm:"column:domain_type"`
		RegistrationStatus string `gorm:"column:registration_status"`
	}
	err := r.db.WithContext(ctx).
		Table("network_domains AS d").
		Select(`d.id AS id, d.name AS name, d.status AS status, d.domain_type AS domain_type,
			COALESCE(a.registration_status, '') AS registration_status`).
		Joins("LEFT JOIN network_domain_access a ON a.domain_id = d.id").
		Where("d.id = ? AND d.deleted_at IS NULL", id).
		Limit(1).
		Scan(&row).Error
	if err != nil {
		return domain.DomainRef{}, false, fmt.Errorf("load network domain %q: %w", id, err)
	}
	if row.ID == "" {
		return domain.DomainRef{}, false, nil
	}
	return domain.DomainRef{
		ID:                 row.ID,
		Name:               row.Name,
		Status:             row.Status,
		DomainType:         row.DomainType,
		RegistrationStatus: row.RegistrationStatus,
	}, true, nil
}
