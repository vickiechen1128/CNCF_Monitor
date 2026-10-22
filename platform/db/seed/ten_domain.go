package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runTenantAndDomain upserts the platform admin tenant, aligned with
// Module_06 §5/§9.2.
//
// The center-direct (management) domain is no longer seeded: it is registered
// on demand through the M06 network-domain page (at most one, internal id
// "default"), and the registration flow is responsible for its monitoring
// fields. Existing databases keep their pre-existing default row; seed never
// deletes user data.
func runTenantAndDomain(db *gorm.DB) error {
	tenant := &models.Tenant{
		ID:               models.PlatformAdminTenantID,
		Name:             "平台默认租户",
		NetworkDomainIDs: nil,
		MultiSiteEnabled: false,
		IsPlatformAdmin:  true,
		Status:           models.TenantStatusActive,
	}
	if err := firstOrCreate(db, tenant, "id = ?", models.PlatformAdminTenantID); err != nil {
		return fmt.Errorf("seed platform_admin tenant: %w", err)
	}
	return nil
}
