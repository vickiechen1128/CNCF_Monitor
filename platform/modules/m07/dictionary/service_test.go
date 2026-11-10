package dictionary

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openDictionaryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "m07_dictionary.db")
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&businessDomainRecord{},
		&applicationDictRecord{},
		&platformDictRecord{},
		&cloudDictRecord{},
		&zoneTypeRecord{},
		&networkDomainRecord{},
		&appPlatformRelRecord{},
	))

	require.NoError(t, db.Create(&networkDomainRecord{ID: "default"}).Error)
	require.NoError(t, db.Create(&businessDomainRecord{Code: "payment", Name: "支付", Enabled: true}).Error)
	require.NoError(t, db.Create(&businessDomainRecord{Code: "legacy", Name: "旧业务", Enabled: false}).Error)
	require.NoError(t, db.Create(&applicationDictRecord{AppCode: "order-service", AppName: "订单服务", Status: "enabled"}).Error)
	require.NoError(t, db.Create(&applicationDictRecord{AppCode: "legacy-app", AppName: "旧应用", Status: "disabled"}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "ecommerce", PlatformName: "电商平台", Enabled: true}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "lab", PlatformName: "实验室", Enabled: true}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "legacy-platform", PlatformName: "旧平台", Enabled: false}).Error)
	require.NoError(t, db.Create(&appPlatformRelRecord{AppCode: "order-service", PlatformCode: "ecommerce", IsPrimary: true}).Error)
	require.NoError(t, db.Create(&appPlatformRelRecord{AppCode: "order-service", PlatformCode: "lab", IsPrimary: false}).Error)
	require.NoError(t, db.Create(&cloudDictRecord{CloudCode: "PUB-TX", CloudName: "腾讯云", Enabled: true}).Error)
	require.NoError(t, db.Create(&zoneTypeRecord{Code: "internet", DisplayName: "互联网区", Enabled: true}).Error)
	return db
}

func testResource() *domain.Resource {
	return &domain.Resource{
		ResourceID:      "res-1",
		Category:        domain.CategoryApplication,
		TenantID:        "platform_admin",
		NetworkDomainID: "default",
		BizCode:         "payment",
		AppCode:         "order-service",
		PlatformCode:    "ecommerce",
		Env:             domain.EnvPRD,
		Cluster:         "prod-a",
		Status:          domain.StatusOnline,
		SourceType:      domain.SourceManual,
		Attributes: domain.ApplicationAttributes{
			ServiceName:    "order-api",
			HealthCheckURL: "https://order.example.com/health",
		},
	}
}

func TestServiceValidateResource(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	require.NoError(t, svc.ValidateResource(ctx, testResource()))

	badDomain := testResource()
	badDomain.NetworkDomainID = "missing"
	require.ErrorContains(t, svc.ValidateResource(ctx, badDomain), "network_domain_id")

	badBiz := testResource()
	badBiz.BizCode = "legacy"
	require.ErrorContains(t, svc.ValidateResource(ctx, badBiz), "biz_code")

	badApp := testResource()
	badApp.AppCode = "legacy-app"
	require.ErrorContains(t, svc.ValidateResource(ctx, badApp), "app_code")

	badPlatform := testResource()
	badPlatform.PlatformCode = "legacy-platform"
	require.ErrorContains(t, svc.ValidateResource(ctx, badPlatform), "platform_code")

	badRelation := testResource()
	badRelation.PlatformCode = "lab"
	badRelation.AppCode = "order-service"
	// lab is related to order-service, so this should pass.
	require.NoError(t, svc.ValidateResource(ctx, badRelation))

	noRelation := testResource()
	noRelation.AppCode = "order-service"
	noRelation.PlatformCode = "ecommerce"
	require.NoError(t, svc.ValidateResource(ctx, noRelation))
}

func TestServicePrimaryPlatform(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	platform, ok, err := svc.PrimaryPlatformOfApp(ctx, "order-service")
	require.NoError(t, err)
	require.True(t, ok)
	assert.Equal(t, "ecommerce", platform)

	_, ok, err = svc.PrimaryPlatformOfApp(ctx, "missing-app")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestServiceList(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	biz, err := svc.ListBusinessDomains(ctx)
	require.NoError(t, err)
	assert.Len(t, biz, 2)

	apps, err := svc.ListApplications(ctx)
	require.NoError(t, err)
	assert.Len(t, apps, 2)

	platforms, err := svc.ListPlatforms(ctx)
	require.NoError(t, err)
	assert.Len(t, platforms, 3)

	clouds, err := svc.ListClouds(ctx)
	require.NoError(t, err)
	assert.Len(t, clouds, 1)

	zones, err := svc.ListZoneTypes(ctx)
	require.NoError(t, err)
	assert.Len(t, zones, 1)

	rels, err := svc.ListAppPlatformRels(ctx, "order-service", "")
	require.NoError(t, err)
	assert.Len(t, rels, 2)

	osOptions, err := svc.ListOSOptions(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, osOptions)
}
