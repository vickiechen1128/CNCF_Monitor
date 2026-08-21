package networkdomain

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// containsStr reports whether s is present in list.
func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// syncAuthorizedTenants appends domainID to each authorized tenant's
// NetworkDomainIDs when missing (authorization != ownership). It is a one-way,
// add-only sync so existing authorizations are never removed and the default
// domain authorization is never broken. AuthorizedTenantIDs on the domain
// record remain the authoritative source; missing tenant rows are skipped.
func syncAuthorizedTenants(db *gorm.DB, domainID string, tenantIDs []string) error {
	for _, tid := range tenantIDs {
		if tid == "" {
			continue
		}
		var t models.Tenant
		if err := db.Where("id = ?", tid).First(&t).Error; err != nil {
			continue // tenant not registered yet; domain record stays authoritative
		}
		if containsStr(t.NetworkDomainIDs, domainID) {
			continue
		}
		t.NetworkDomainIDs = append(t.NetworkDomainIDs, domainID)
		if err := db.Save(&t).Error; err != nil {
			return fmt.Errorf("sync tenant %q authorization for domain %q: %w", tid, domainID, err)
		}
	}
	return nil
}
