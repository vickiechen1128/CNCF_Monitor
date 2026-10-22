// Package domainregistry provides read helpers for the singleton center-direct
// (management) network domain. Under the on-demand registration model there is
// no seeded default domain anymore, so callers that depend on it must resolve
// it explicitly and handle the "not registered yet" state.
package domainregistry

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// ErrManagementDomainNotRegistered is returned when no active management
// (center-direct) domain exists. It is a user-facing message: callers should
// surface it as-is so the operator knows where to register the domain.
var ErrManagementDomainNotRegistered = errors.New("中心直连域尚未登记，请先在「系统与平台管理 → 网域管理」登记中心直连域")

// ManagementDomain returns the single active management domain.
//
// GORM's soft-delete scope is applied automatically, so a deleted domain is
// treated as absent (and can be re-registered). More than one active management
// domain is an invariant violation: the registration API and the partial unique
// index must prevent it.
func ManagementDomain(db *gorm.DB) (*models.NetworkDomain, error) {
	if db == nil {
		return nil, fmt.Errorf("domainregistry: nil database connection")
	}
	var list []models.NetworkDomain
	if err := db.Where("domain_type = ?", models.DomainTypeManagement).
		Limit(2).Find(&list).Error; err != nil {
		return nil, fmt.Errorf("load management domain: %w", err)
	}
	switch len(list) {
	case 0:
		return nil, ErrManagementDomainNotRegistered
	case 1:
		return &list[0], nil
	default:
		return nil, fmt.Errorf("invariant violated: %d active management domains found, expected 1", len(list))
	}
}

// ManagementDomainID returns the id of the single active management domain.
func ManagementDomainID(db *gorm.DB) (string, error) {
	dom, err := ManagementDomain(db)
	if err != nil {
		return "", err
	}
	return dom.ID, nil
}
