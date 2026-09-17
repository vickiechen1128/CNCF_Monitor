package seed

import (
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// runTenantAndDomain upserts the platform admin tenant and the default
// management domain, aligned with Module_06 §5/§9.2 and Module_09
// default-domain initialization.
func runTenantAndDomain(db *gorm.DB) error {
	tenant := &models.Tenant{
		ID:               models.PlatformAdminTenantID,
		Name:             "平台默认租户",
		NetworkDomainIDs: []string{models.DefaultDomainID},
		MultiSiteEnabled: false,
		IsPlatformAdmin:  true,
		Status:           models.TenantStatusActive,
	}
	if err := firstOrCreate(db, tenant, "id = ?", models.PlatformAdminTenantID); err != nil {
		return fmt.Errorf("seed platform_admin tenant: %w", err)
	}

	domain := &models.NetworkDomain{
		ID:                  models.DefaultDomainID,
		Name:                "默认网域",
		DomainType:          models.DomainTypeManagement,
		Channel:             models.ChannelTypeLocal,
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Status:              models.DomainStatusEnabled,
		IsMonitored:         true, // Module_01：已纳管，作为 ScrapeJob 保存校验前提
	}
	if err := firstOrCreate(db, domain, "id = ?", models.DefaultDomainID); err != nil {
		return fmt.Errorf("seed default domain: %w", err)
	}

	// firstOrCreate loads a pre-existing row back into domain, clobbering the
	// preset registration/auth fields; re-assert the canonical value so a Phase 0
	// row without authorized_tenant_ids is back-filled.
	domain.AuthorizedTenantIDs = []string{models.PlatformAdminTenantID}

	// firstOrCreate 同样会把已存在的 default 域重载回 domain（覆盖 IsMonitored），
	// 导致早期版本创建（is_monitored=false）的 default 域无法被回填为已纳管。
	// 与 AuthorizedTenantIDs 一致，此处显式重断言预置值（F-02：MVP 由 seed 预置
	// default 域 is_monitored=true，作为采集 Job 保存校验前提）。
	domain.IsMonitored = true

	// Idempotent back-fill: a freshly created row already carries the canonical
	// fields; a Phase 0 pre-created row may lack AuthorizedTenantIDs, so
	// re-apply the canonical administrative fields. Select limits the update to
	// the administrative set, and re-running Run never duplicates nor errors.
	if err := db.Model(domain).
		Select("name", "domain_type", "channel", "tenant_id", "status", "authorized_tenant_ids", "is_monitored").
		Updates(domain).Error; err != nil {
		return fmt.Errorf("align default domain fields: %w", err)
	}
	return nil
}
