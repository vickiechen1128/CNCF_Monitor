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
	require.NoError(t, gormDB.Where("domain_type = ?", models.DomainTypeManagement).Find(&domains).Error)
	require.Len(t, domains, 1, "exactly one management domain")
	assert.Equal(t, models.DefaultDomainID, domains[0].ID)
	assert.Equal(t, models.DomainStatusEnabled, domains[0].Status)
	assert.Equal(t, models.ChannelTypeLocal, domains[0].Channel)

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
