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

	require.NoError(t, db.Create(&networkDomainRecord{ID: "mc-demo", DomainType: "edge", Status: "enabled"}).Error)
	require.NoError(t, db.Create(&networkDomainRecord{ID: "mc-disabled", DomainType: "edge", Status: "disabled"}).Error)
	require.NoError(t, db.Create(&networkDomainRecord{ID: "mc-collection", DomainType: "collection", Status: "enabled"}).Error)
	require.NoError(t, db.Create(&businessDomainRecord{Code: "payment", Name: "支付", Enabled: true}).Error)
	require.NoError(t, db.Create(&businessDomainRecord{Code: "legacy", Name: "旧业务", Enabled: false}).Error)
	require.NoError(t, db.Create(&applicationDictRecord{AppCode: "order-service", AppName: "订单服务", Status: "enabled"}).Error)
	require.NoError(t, db.Create(&applicationDictRecord{AppCode: "new-app", AppName: "新应用", Status: "enabled"}).Error)
	require.NoError(t, db.Create(&applicationDictRecord{AppCode: "legacy-app", AppName: "旧应用", Status: "disabled"}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "ecommerce", PlatformName: "电商平台", Enabled: true}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "lab", PlatformName: "实验室", Enabled: true}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "new-platform", PlatformName: "新平台", Enabled: true}).Error)
	require.NoError(t, db.Create(&platformDictRecord{PlatformCode: "legacy-platform", PlatformName: "旧平台", Enabled: false}).Error)
	require.NoError(t, db.Create(&appPlatformRelRecord{ID: "rel-1", AppCode: "order-service", PlatformCode: "ecommerce", IsPrimary: true}).Error)
	require.NoError(t, db.Create(&appPlatformRelRecord{ID: "rel-2", AppCode: "order-service", PlatformCode: "lab", IsPrimary: false}).Error)
	cloudDescription := "预置"
	require.NoError(t, db.Create(&cloudDictRecord{
		CloudCode:   "PUB-TX",
		CloudName:   "腾讯云",
		CloudType:   "PUB",
		Carrier:     "TX",
		Description: &cloudDescription,
		Enabled:     true,
	}).Error)
	require.NoError(t, db.Create(&zoneTypeRecord{Code: "internet", DisplayName: "互联网区", Enabled: true}).Error)
	return db
}

func testResource() *domain.Resource {
	return &domain.Resource{
		ResourceID:      "res-1",
		Category:        domain.CategoryApplication,
		TenantID:        "platform_admin",
		NetworkDomainID: "mc-demo",
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

	disabledDomain := testResource()
	disabledDomain.NetworkDomainID = "mc-disabled"
	require.ErrorContains(t, svc.ValidateResource(ctx, disabledDomain), "network_domain_id")

	collectionDomain := testResource()
	collectionDomain.NetworkDomainID = "mc-collection"
	require.NoError(t, svc.ValidateResource(ctx, collectionDomain), "collection-node domains stay usable")

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

func TestServiceAppPlatformRelCRUD(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	// D42 I2：首个关联即使传 isPrimary=false，也由服务端强制置为主平台。
	rel, err := svc.CreateAppPlatformRel(ctx, "new-app", "new-platform", false)
	require.NoError(t, err)
	assert.NotEmpty(t, rel.RelID)
	assert.True(t, rel.IsPrimary)

	rels, err := svc.ListAppPlatformRels(ctx, "new-app", "")
	require.NoError(t, err)
	require.Len(t, rels, 1)
	assert.True(t, rels[0].IsPrimary)

	// D42 I1：不允许解绑应用的最后一个平台。
	require.ErrorIs(t, svc.DeleteAppPlatformRel(ctx, rel.RelID), ErrAppRequiresPlatform)

	// 增加第二个平台（非主平台）。
	second, err := svc.CreateAppPlatformRel(ctx, "new-app", "ecommerce", false)
	require.NoError(t, err)
	assert.False(t, second.IsPrimary)

	// D42 I3：主平台须显式转移——直接解绑主平台被拒绝。
	require.ErrorIs(t, svc.DeleteAppPlatformRel(ctx, rel.RelID), ErrPrimaryPlatformTransferRequired)
	// 主平台也不能靠「取消 is_primary」撤销。
	_, err = svc.SetPrimaryAppPlatformRel(ctx, rel.RelID, false)
	require.ErrorIs(t, err, ErrPrimaryPlatformTransferRequired)

	// 显式转移主平台到第二个平台。
	updated, err := svc.SetPrimaryAppPlatformRel(ctx, second.RelID, true)
	require.NoError(t, err)
	assert.True(t, updated.IsPrimary)

	// 转移后原主平台可以解绑。
	require.NoError(t, svc.DeleteAppPlatformRel(ctx, rel.RelID))
	rels, err = svc.ListAppPlatformRels(ctx, "new-app", "")
	require.NoError(t, err)
	require.Len(t, rels, 1)
	assert.Equal(t, "ecommerce", rels[0].PlatformCode)
	assert.True(t, rels[0].IsPrimary)

	// 剩下的也是最后一个，仍不允许解绑。
	require.ErrorIs(t, svc.DeleteAppPlatformRel(ctx, second.RelID), ErrAppRequiresPlatform)
}

func TestCreateApplicationRequiresPlatforms(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	var validation *domain.ValidationError

	// D42 I1：登记应用必须携带至少一个平台。
	_, err := svc.CreateApplication(ctx, "no-platform-app", "无平台应用", "", nil)
	require.ErrorAs(t, err, &validation)
	assert.Equal(t, "platform_codes", validation.Field)

	// 空串 / 空白不算平台。
	_, err = svc.CreateApplication(ctx, "blank-platform-app", "空平台应用", "", []string{" ", ""})
	require.ErrorAs(t, err, &validation)
	assert.Equal(t, "platform_codes", validation.Field)

	// 平台必须存在且启用。
	_, err = svc.CreateApplication(ctx, "disabled-platform-app", "停用平台应用", "", []string{"legacy-platform"})
	require.ErrorAs(t, err, &validation)
	assert.Equal(t, "platform_codes", validation.Field)

	// 正常登记：去重 + 首个平台即主平台。
	app, err := svc.CreateApplication(ctx, "with-platform-app", "有平台应用", "", []string{"ecommerce", "lab", "ecommerce"})
	require.NoError(t, err)
	assert.Equal(t, "with-platform-app", app.AppCode)
	assert.Equal(t, "enabled", app.Status)

	rels, err := svc.ListAppPlatformRels(ctx, "with-platform-app", "")
	require.NoError(t, err)
	require.Len(t, rels, 2, "重复的平台编码应被去重")
	assert.Equal(t, "ecommerce", rels[0].PlatformCode)
	assert.True(t, rels[0].IsPrimary, "首个平台自动成为主平台")
	assert.False(t, rels[1].IsPrimary)

	// 平台校验失败时不得留下半个应用（原子性）。
	apps, err := svc.ListApplications(ctx)
	require.NoError(t, err)
	for _, item := range apps {
		assert.NotContains(t,
			[]string{"no-platform-app", "blank-platform-app", "disabled-platform-app"},
			item.AppCode,
			"校验失败的应用不应落库",
		)
	}
}

func TestServiceList(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	biz, err := svc.ListBusinessDomains(ctx)
	require.NoError(t, err)
	assert.Len(t, biz, 2)

	apps, err := svc.ListApplications(ctx)
	require.NoError(t, err)
	assert.Len(t, apps, 3)

	platforms, err := svc.ListPlatforms(ctx)
	require.NoError(t, err)
	assert.Len(t, platforms, 4)

	clouds, err := svc.ListClouds(ctx)
	require.NoError(t, err)
	require.Len(t, clouds, 1)
	// D37: the admin maintenance page needs the descriptive attributes too.
	assert.Equal(t, "PUB", clouds[0].CloudType)
	assert.Equal(t, "TX", clouds[0].Carrier)
	assert.Equal(t, "预置", clouds[0].Description)

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
