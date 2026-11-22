package db_test

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/db/seed"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
)

// TestCoreV3SeedIdempotent verifies that a fresh v3 database gets the minimal
// reference data and that a second boot does not duplicate it.
func TestCoreV3SeedIdempotent(t *testing.T) {
	t.Setenv("METRIC_CENTER_ENV", "test")
	businessDomains := filepath.Join("..", "config", "business_domains.yaml")

	gormDB := testdb.Open(t)

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
	assert.Zero(t, businessDomainCount, "系统不预置任何业务字典（M07 SRS v2.0）")

	var zoneTypeCount int64
	require.NoError(t, gormDB.Model(&models.ZoneType{}).Count(&zoneTypeCount).Error)
	assert.Zero(t, zoneTypeCount, "v3 不再预置区域类型字典（M06 SRS v1.3）")

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

	gormDB := testdb.Open(t)
	require.NoError(t, seed.CoreV3(gormDB, businessDomains))

	require.NoError(t, gormDB.Create(&models.Tenant{
		ID:     "tenant-a",
		Name:   "租户 A",
		Status: models.TenantStatusActive,
	}).Error)

	// V3-only: write the administrative columns directly. models.NetworkDomain
	// still carries the dropped legacy fields, so GORM Create/Save would emit
	// INSERTs referencing removed columns.
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains
		(id, name, domain_type, tenant_id, authorized_tenant_ids, status)
		VALUES ('mc-demo', '演示采集域', 'edge', 'platform_admin', ?, 'enabled')`,
		`["platform_admin","tenant-a"]`).Error)

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

	// Removing the authorization from the domain clears the tenant cache.
	require.NoError(t, gormDB.Exec(
		`UPDATE network_domains SET authorized_tenant_ids = ? WHERE id = 'mc-demo'`,
		`["platform_admin"]`).Error)
	require.NoError(t, seed.CoreV3(gormDB, businessDomains))
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenant).Error)
	assert.Empty(t, tenant.NetworkDomainIDs, "removed authorization must not linger in the tenant cache")

	// Re-grant, then soft-delete: the cache must be cleared again on boot.
	require.NoError(t, gormDB.Exec(
		`UPDATE network_domains SET authorized_tenant_ids = ? WHERE id = 'mc-demo'`,
		`["platform_admin","tenant-a"]`).Error)
	require.NoError(t, seed.CoreV3(gormDB, businessDomains))
	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenant).Error)
	require.Equal(t, []string{"mc-demo"}, tenant.NetworkDomainIDs)

	// Soft-deleted domains must disappear from the tenant cache on the next boot.
	require.NoError(t, gormDB.Exec(
		`UPDATE network_domains SET deleted_at = CURRENT_TIMESTAMP WHERE id = 'mc-demo'`).Error)
	require.NoError(t, seed.CoreV3(gormDB, businessDomains))

	require.NoError(t, gormDB.Where("id = ?", "tenant-a").First(&tenant).Error)
	assert.Empty(t, tenant.NetworkDomainIDs)
	require.NoError(t, gormDB.Where("id = ?", models.PlatformAdminTenantID).First(&adminTenant).Error)
	assert.NotContains(t, adminTenant.NetworkDomainIDs, "mc-demo")
}
