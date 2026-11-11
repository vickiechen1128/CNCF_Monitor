package seed

import (
	"errors"
	"fmt"

	"github.com/metriccenter/metriccenter/platform/models"
	"gorm.io/gorm"
)

// CoreV3 seeds the minimal reference data a standalone v3 database needs:
// the platform_admin tenant, zone/cloud/business dictionaries, the initial
// admin user and the center-direct management domain.
//
// It is intentionally a subset of Run (which also seeds legacy M01/M08/M09
// data). Every step is idempotent; existing rows are never overwritten except
// for the deployment-level zone dictionary, whose enabled flags are aligned on
// every boot (same behaviour as Run).
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
	if err := ensureDefaultManagementDomain(db); err != nil {
		return fmt.Errorf("seed v3 core default domain: %w", err)
	}
	return nil
}

// ensureDefaultManagementDomain creates the center-direct domain when the fresh
// v3 database has no management domain yet. Existing databases are left
// untouched: M06 owns domain registration once the platform is running.
func ensureDefaultManagementDomain(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.NetworkDomain{}).
		Where("domain_type = ? AND deleted_at IS NULL", models.DomainTypeManagement).
		Count(&count).Error; err != nil {
		return fmt.Errorf("count management domains: %w", err)
	}
	if count > 0 {
		return nil
	}

	domain := &models.NetworkDomain{
		ID:                  models.DefaultDomainID,
		Name:                "中心直连域",
		Description:         "v3 core seed：中心同机部署的默认管理域",
		DomainType:          models.DomainTypeManagement,
		ZoneType:            string(models.ZoneTypeInternet),
		CloudCode:           "PUB-TX",
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID},
		Channel:             models.ChannelTypeLocal,
		Status:              models.DomainStatusEnabled,
		IsMonitored:         true,
		RegistrationStatus:  models.RegistrationStatusMonitored,
	}
	if err := db.Create(domain).Error; err != nil {
		// A concurrent boot may have won the race; treat the unique management
		// index rejection as success only when a management domain now exists.
		var after int64
		if countErr := db.Model(&models.NetworkDomain{}).
			Where("domain_type = ? AND deleted_at IS NULL", models.DomainTypeManagement).
			Count(&after).Error; countErr == nil && after > 0 {
			return nil
		}
		return fmt.Errorf("create default management domain: %w", err)
	}
	return nil
}

// ErrNoManagementDomain is reserved for callers that require a management
// domain to exist before serving traffic.
var ErrNoManagementDomain = errors.New("no management domain registered")
