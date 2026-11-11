package seed

import (
	"fmt"
	"sort"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CoreV3 seeds the minimal reference data a standalone v3 database needs:
// the platform_admin tenant, zone/cloud/business dictionaries and the initial
// admin user.
//
// It is intentionally a subset of Run (which also seeds legacy M01/M08/M09
// data). Every step is idempotent; existing rows are never overwritten except
// for the deployment-level zone dictionary, whose enabled flags are aligned on
// every boot (same behaviour as Run).
//
// v3 no longer pre-provisions a center-direct (`default`/management) domain:
// every network domain must be registered through M06 and onboarded through a
// collection node (M06 SRS v1.0 / NFR-02).
func CoreV3(db *gorm.DB, businessDomainsPath string) error {
	if db == nil {
		return fmt.Errorf("seed v3 core: nil database connection")
	}
	if err := runTenantAndDomain(db); err != nil {
		return fmt.Errorf("seed v3 core tenant: %w", err)
	}
	if err := runZoneTypes(db); err != nil {
		return fmt.Errorf("seed v3 core zone types: %w", err)
	}
	if err := runCloudDicts(db); err != nil {
		return fmt.Errorf("seed v3 core cloud dict: %w", err)
	}
	if err := BusinessDomains(db, businessDomainsPath); err != nil {
		return fmt.Errorf("seed v3 core business domains: %w", err)
	}
	if err := runAdminUser(db); err != nil {
		return fmt.Errorf("seed v3 core admin user: %w", err)
	}
	if err := reconcileTenantDomainAuthorizations(db); err != nil {
		return fmt.Errorf("seed v3 core tenant authorizations: %w", err)
	}
	return nil
}

// reconcileTenantDomainAuthorizations rebuilds the denormalized
// tenants.network_domain_ids cache from the authoritative
// network_domains.authorized_tenant_ids field (plus the registration owner).
//
// The domain record is the single write path for tenant/domain authorization
// (M06 SRS v1.0 §7.3). The tenant column remains for compatibility and fast
// reads, but stale entries are removed on boot so a failed write cannot leave
// a tenant seeing a domain it is no longer authorized to use.
func reconcileTenantDomainAuthorizations(db *gorm.DB) error {
	var domains []models.NetworkDomain
	if err := db.Where("deleted_at IS NULL").Find(&domains).Error; err != nil {
		return fmt.Errorf("list network domains: %w", err)
	}

	grants := make(map[string]map[string]struct{})
	addGrant := func(tenantID, domainID string) {
		if tenantID == "" || domainID == "" {
			return
		}
		if grants[tenantID] == nil {
			grants[tenantID] = make(map[string]struct{})
		}
		grants[tenantID][domainID] = struct{}{}
	}
	for i := range domains {
		domain := &domains[i]
		addGrant(domain.TenantID, domain.ID)
		for _, tenantID := range domain.AuthorizedTenantIDs {
			addGrant(tenantID, domain.ID)
		}
	}

	var tenants []models.Tenant
	if err := db.Where("deleted_at IS NULL").Find(&tenants).Error; err != nil {
		return fmt.Errorf("list tenants: %w", err)
	}
	for i := range tenants {
		tenant := &tenants[i]
		want := make([]string, 0, len(grants[tenant.ID]))
		for domainID := range grants[tenant.ID] {
			want = append(want, domainID)
		}
		sort.Strings(want)
		if sameStringSet(tenant.NetworkDomainIDs, want) {
			continue
		}
		tenant.NetworkDomainIDs = want
		if err := db.Model(tenant).Select("network_domain_ids").Updates(tenant).Error; err != nil {
			return fmt.Errorf("reconcile tenant %q domain authorizations: %w", tenant.ID, err)
		}
	}
	return nil
}

// sameStringSet compares two string slices as sets, ignoring order. Both sides
// are expected to contain unique values (the reconciliation output is unique).
func sameStringSet(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	set := make(map[string]struct{}, len(a))
	for _, v := range a {
		set[v] = struct{}{}
	}
	for _, v := range b {
		if _, ok := set[v]; !ok {
			return false
		}
	}
	return true
}
