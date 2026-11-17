package references

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// DomainReader reads M06 network-domain state (read-only).
type DomainReader interface {
	// Status returns the domain status and whether the domain exists.
	Status(ctx context.Context, domainID string) (string, bool, error)
	// Usable reports whether the domain exists, is enabled and monitorable.
	Usable(ctx context.Context, domainID string) (bool, error)
}

// GORMDomainReader reads network_domains without taking ownership.
type GORMDomainReader struct{ db *gorm.DB }

// NewDomainReader constructs the reader.
func NewDomainReader(db *gorm.DB) *GORMDomainReader { return &GORMDomainReader{db: db} }

type domainStatusRow struct {
	ID     string `gorm:"column:id"`
	Status string `gorm:"column:status"`
	Type   string `gorm:"column:domain_type"`
}

// Status returns the raw status of a live domain.
func (r *GORMDomainReader) Status(ctx context.Context, domainID string) (string, bool, error) {
	var row domainStatusRow
	err := r.db.WithContext(ctx).Table("network_domains").
		Select("id, status, domain_type").
		Where("id = ? AND deleted_at IS NULL", domainID).Take(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", false, nil
		}
		return "", false, fmt.Errorf("read network domain %q: %w", domainID, err)
	}
	return row.Status, true, nil
}

// Usable reports whether the domain exists, is enabled and edge/collection typed.
func (r *GORMDomainReader) Usable(ctx context.Context, domainID string) (bool, error) {
	var row domainStatusRow
	err := r.db.WithContext(ctx).Table("network_domains").
		Select("id, status, domain_type").
		Where("id = ? AND deleted_at IS NULL", domainID).Take(&row).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return false, nil
		}
		return false, fmt.Errorf("read network domain %q: %w", domainID, err)
	}
	if row.Status != "enabled" {
		return false, nil
	}
	return row.Type == "edge" || row.Type == "collection", nil
}

// DomainAuthorizer resolves the network domains a caller may act on (FR-17).
type DomainAuthorizer interface {
	AuthorizedDomains(ctx context.Context, actor domain.Actor) ([]string, error)
}

// GORMDomainAuthorizer reads the tenant authorization cache (D17). Platform
// admins are scoped to every enabled domain; regular users only to the domains
// granted to their tenant.
type GORMDomainAuthorizer struct{ db *gorm.DB }

// NewDomainAuthorizer constructs the authorizer.
func NewDomainAuthorizer(db *gorm.DB) *GORMDomainAuthorizer {
	return &GORMDomainAuthorizer{db: db}
}

// AuthorizedDomains implements DomainAuthorizer.
func (a *GORMDomainAuthorizer) AuthorizedDomains(ctx context.Context, actor domain.Actor) ([]string, error) {
	if actor.IsPlatformAdmin {
		var ids []string
		if err := a.db.WithContext(ctx).Table("network_domains").
			Where("deleted_at IS NULL AND status = ?", "enabled").
			Pluck("id", &ids).Error; err != nil {
			return nil, fmt.Errorf("list enabled domains: %w", err)
		}
		return ids, nil
	}
	if actor.TenantID == "" {
		return []string{}, nil
	}
	var tenant models.Tenant
	err := a.db.WithContext(ctx).Select("id", "network_domain_ids").
		Where("id = ? AND deleted_at IS NULL", actor.TenantID).First(&tenant).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return []string{}, nil
		}
		return nil, fmt.Errorf("load tenant %q authorizations: %w", actor.TenantID, err)
	}
	if tenant.NetworkDomainIDs == nil {
		return []string{}, nil
	}
	return tenant.NetworkDomainIDs, nil
}
