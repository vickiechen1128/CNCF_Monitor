package seed

import (
	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runTenantAndDomain upserts the platform admin tenant and the default
// management domain, aligned with Module_06 §5 and Module_09 default-domain
// initialization.
func runTenantAndDomain(db *gorm.DB) error {
	tenant := &models.Tenant{
		ID:              models.PlatformAdminTenantID,
		Name:            "平台默认租户",
		NetworkDomainIDs: []string{models.DefaultDomainID},
		MultiSiteEnabled: false,
		IsPlatformAdmin:  true,
		Status:           models.TenantStatusActive,
	}
	if err := firstOrCreate(db, tenant, "id = ?", models.PlatformAdminTenantID); err != nil {
		return err
	}

	domain := &models.NetworkDomain{
		ID:         models.DefaultDomainID,
		Name:       "默认网域",
		DomainType: models.DomainTypeManagement,
		Channel:    models.ChannelTypeLocal,
		TenantID:   models.PlatformAdminTenantID,
		Status:     models.DomainStatusEnabled,
	}
	if err := firstOrCreate(db, domain, "id = ?", models.DefaultDomainID); err != nil {
		return err
	}
	return nil
}