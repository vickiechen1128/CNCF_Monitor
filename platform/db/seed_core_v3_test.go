package db_test

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"github.com/metriccenter/metriccenter/platform/db"
	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
)

// TestCoreV3SeedIdempotent verifies that a fresh v3 database gets the minimal
// reference data and that a second boot does not duplicate it.
func TestCoreV3SeedIdempotent(t *testing.T) {
	t.Setenv("METRIC_CENTER_ENV", "test")
	businessDomains := filepath.Join("..", "config", "business_domains.yaml")

	dsn := filepath.Join(t.TempDir(), "core_v3.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))

	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)

	require.NoError(t, seed.CoreV3(gormDB, businessDomains))
	require.NoError(t, seed.CoreV3(gormDB, businessDomains), "seed must be idempotent")

	var tenant models.Tenant
	require.NoError(t, gormDB.Where("id = ?", models.PlatformAdminTenantID).First(&tenant).Error)
	assert.True(t, tenant.IsPlatformAdmin)
	assert.Equal(t, models.TenantStatusActive, tenant.Status)

	var admin models.User
	require.NoError(t, gormDB.Where("username = ?", seed.AdminUsername).First(&admin).Error)
	assert.Equal(t, models.UserRoleAdmin, admin.Role)

	var domains []models.NetworkDomain
	require.NoError(t, gormDB.Find(&domains).Error)
	assert.Empty(t, domains, "v3 must not seed a center-direct/default network domain")

	var businessDomainCount int64
	require.NoError(t, gormDB.Model(&models.BusinessDomain{}).Count(&businessDomainCount).Error)
	assert.Positive(t, businessDomainCount)

	var zoneTypeCount int64
	require.NoError(t, gormDB.Model(&models.ZoneType{}).Count(&zoneTypeCount).Error)
	assert.Positive(t, zoneTypeCount)

	var cloudDictCount int64
	require.NoError(t, gormDB.Model(&models.CloudDict{}).Count(&cloudDictCount).Error)
	assert.Positive(t, cloudDictCount)
}

// TestCoreV3ReconcilesTenantDomainAuthorizations verifies that
// tenants.network_domain_ids is rebuilt from
// network_domains.authorized_tenant_ids (the authoritative field) on boot.
func TestCoreV3ReconcilesTenantDomainAuthorizations(t *testing.T) {
	t.Setenv("METRIC_CENTER_ENV", "test")
	businessDomains := filepath.Join("..", "config", "business_domains.yaml")

	dsn := filepath.Join(t.TempDir(), "core_v3_authorization.db")
	require.NoError(t, db.MigrateV3("sqlite", dsn))
	gormDB, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, seed.CoreV3(gormDB, businessDomains))

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID:     "tenant-a",
		Name:   "租户 A",
		Status: models.TenantStatusActive,
	}).Error)

	domain := &models.NetworkDomain{
		ID:                  "mc-demo",
		Name:                "演示采集域",
		DomainType:          models.DomainTypeEdge,
		TenantID:            models.PlatformAdminTenantID,
		AuthorizedTenantIDs: []string{models.PlatformAdminTenantID, "tenant-a"},
		Channel:             models.ChannelTypeAgentPull,
		Status:              models.DomainStatusEnabled,
	}
	require.NoError(t, gormDB.Create(domain).Error)

	// Simulate a stale cache written by an older path.
	require.NoError(t, gormDB.Model(&models.Tenant{}).Where("id = ?", "tenant-a").
		Update("network_domain_ids", `["stale-domain"]`).Error)

	require.NoError(t, seed.CoreV3(gormDB, businessDomains))

	var tenant models.Tenant
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenant).Error)
	assert.Equal(t, []string{"mc-demo"}, tenant.NetworkDomainIDs)

	var adminTenant models.Tenant
	require.NoError(t, gormDB.Where("id = ?", models.PlatformAdminTenantID).First(&adminTenant).Error)
	assert.Contains(t, adminTenant.NetworkDomainIDs, "mc-demo",
		"the registering owner is authorized implicitly")

	// Soft-deleted domains must disappear from the tenant cache on the next boot.
	require.NoError(t, gormDB.Delete(domain).Error)
	require.NoError(t, seed.CoreV3(gormDB, businessDomains))

	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenant).Error)
	assert.Empty(t, tenant.NetworkDomainIDs)
	require.NoError(t, gormDB.Where("id = ?", models.PlatformAdminTenantID).First(&adminTenant).Error)
	assert.NotContains(t, adminTenant.NetworkDomainIDs, "mc-demo")
}
