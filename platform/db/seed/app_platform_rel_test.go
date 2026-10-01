package seed

import (
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// relOf 返回某应用 ↔ 平台关联（不存在时返回零值）。
func relOf(t *testing.T, db *gorm.DB, appCode, platformCode string) models.AppPlatformRel {
	t.Helper()
	var rel models.AppPlatformRel
	err := db.Where("app_code = ? AND platform_code = ?", appCode, platformCode).First(&rel).Error
	if err == gorm.ErrRecordNotFound {
		return models.AppPlatformRel{}
	}
	require.NoError(t, err)
	return rel
}

// primaryOf 返回某应用的主平台编码（无则空串）。
func primaryOf(t *testing.T, db *gorm.DB, appCode string) string {
	t.Helper()
	var rel models.AppPlatformRel
	err := db.Where("app_code = ? AND is_primary = ?", appCode, true).First(&rel).Error
	if err == gorm.ErrRecordNotFound {
		return ""
	}
	require.NoError(t, err)
	return rel.PlatformCode
}

// TestRunAppPlatformBackfillMigratesLegacyCode 覆盖决策 111 一次性迁移：
// 遗留单值 PlatformCode 应迁移为 AppPlatformRel 且置为主平台。
func TestRunAppPlatformBackfillMigratesLegacyCode(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.AutoMigrate(&models.PlatformDict{}, &models.AppPlatformRel{}))

	// 现存平台
	require.NoError(t, db.Create(&models.PlatformDict{
		PlatformCode: "ecommerce", PlatformName: "电商中台", Enabled: true,
	}).Error)

	// 携带遗留 PlatformCode 的存量应用（应被迁移为主平台）
	require.NoError(t, db.Create(&models.ApplicationDict{
		AppCode: "order-service", AppName: "订单服务", Status: models.AppStatusEnabled, PlatformCode: "ecommerce",
	}).Error)
	// 无遗留 PlatformCode 的应用（不应生成关联）
	require.NoError(t, db.Create(&models.ApplicationDict{
		AppCode: "pay-service", AppName: "支付服务", Status: models.AppStatusEnabled,
	}).Error)
	// 遗留 PlatformCode 指向已不存在平台的应用（不应生成悬空关联）
	require.NoError(t, db.Create(&models.ApplicationDict{
		AppCode: "legacy-app", AppName: "历史应用", Status: models.AppStatusEnabled, PlatformCode: "gone-pf",
	}).Error)

	require.NoError(t, runAppPlatformBackfill(db))

	rel := relOf(t, db, "order-service", "ecommerce")
	assert.NotZero(t, rel.ID, "遗留单值平台应迁移为关联")
	assert.True(t, rel.IsPrimary, "遗留单值平台应置为主平台")
	assert.Equal(t, "ecommerce", primaryOf(t, db, "order-service"))

	assert.Zero(t, relOf(t, db, "pay-service", "").ID, "无遗留平台码的应用不生成关联")
	assert.Zero(t, relOf(t, db, "legacy-app", "gone-pf").ID, "指向不存在平台的遗留值不生成悬空关联")
}

// TestRunAppPlatformBackfillIdempotent 保证重复 Run 不重复生成关联行。
func TestRunAppPlatformBackfillIdempotent(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.AutoMigrate(&models.PlatformDict{}, &models.AppPlatformRel{}))
	require.NoError(t, db.Create(&models.PlatformDict{
		PlatformCode: "ecommerce", PlatformName: "电商中台", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.ApplicationDict{
		AppCode: "order-service", AppName: "订单服务", Status: models.AppStatusEnabled, PlatformCode: "ecommerce",
	}).Error)

	require.NoError(t, runAppPlatformBackfill(db))
	require.NoError(t, runAppPlatformBackfill(db))

	var count int64
	require.NoError(t, db.Model(&models.AppPlatformRel{}).Where("app_code = ?", "order-service").Count(&count).Error)
	assert.Equal(t, int64(1), count, "重复迁移不应生成重复关联行")
}

// TestRunAppPlatformBackfillSkipsExistingPrimary 覆盖：应用已存在主平台时，
// 遗留单值平台迁移为非主平台，不破坏「至多一个主平台」约束。
func TestRunAppPlatformBackfillSkipsExistingPrimary(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.AutoMigrate(&models.PlatformDict{}, &models.AppPlatformRel{}))
	require.NoError(t, db.Create(&models.PlatformDict{
		PlatformCode: "ecommerce", PlatformName: "电商中台", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.PlatformDict{
		PlatformCode: "public-data-auth", PlatformName: "公共数据授权平台", Enabled: true,
	}).Error)
	// 应用已存在主平台 public-data-auth
	require.NoError(t, db.Create(&models.AppPlatformRel{
		AppCode: "order-service", PlatformCode: "public-data-auth", IsPrimary: true,
	}).Error)
	// 遗留单值平台为 ecommerce（非主平台）
	require.NoError(t, db.Create(&models.ApplicationDict{
		AppCode: "order-service", AppName: "订单服务", Status: models.AppStatusEnabled, PlatformCode: "ecommerce",
	}).Error)

	require.NoError(t, runAppPlatformBackfill(db))

	rel := relOf(t, db, "order-service", "ecommerce")
	assert.NotZero(t, rel.ID, "遗留单值平台应迁移为关联")
	assert.False(t, rel.IsPrimary, "应用已有主平台时遗留平台不应置为主平台")
	assert.Equal(t, "public-data-auth", primaryOf(t, db, "order-service"))
}
