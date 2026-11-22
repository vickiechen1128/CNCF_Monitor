package dictionary

import (
	"context"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m07/domain"
	"github.com/metriccenter/metriccenter/platform/testutil/testdb"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func openDictionaryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(postgres.Open(testdb.DSN(t)), &gorm.Config{Logger: logger.Discard})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&businessDomainRecord{},
		&applicationDictRecord{},
		&platformDictRecord{},
		&cloudDictRecord{},
		&networkDomainRecord{},
		&appPlatformRelRecord{},
		&dictionaryAuditLogRecord{},
	))
	// The v3 `resources` table is owned by M07's main migration; dictionary
	// tests only need the reference columns for count/merge assertions.
	require.NoError(t, db.Exec(`CREATE TABLE IF NOT EXISTS resources (
		resource_id TEXT PRIMARY KEY,
		biz_code TEXT,
		app_code TEXT,
		platform_code TEXT,
		updated_at TIMESTAMP,
		deleted_at TIMESTAMP
	)`).Error)

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

	rels, err := svc.ListAppPlatformRels(ctx, "order-service", "")
	require.NoError(t, err)
	assert.Len(t, rels, 2)

	osOptions, err := svc.ListOSOptions(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, osOptions)
}

// TestValidateResourceUpdateIgnoresUnchangedDisabledRefs covers M07 SRS v2.0
// FR-29: a historical reference to a now-disabled dictionary must not block
// edits to unrelated fields, while a newly selected disabled value still fails.
func TestValidateResourceUpdateIgnoresUnchangedDisabledRefs(t *testing.T) {
	svc := NewService(NewGORMRepository(openDictionaryTestDB(t)))
	ctx := context.Background()

	before := testResource()
	before.BizCode = "legacy" // disabled after the resource was registered
	after := testResource()
	after.BizCode = "legacy"
	after.Cluster = "prod-b"
	after.Owner = "alice"
	require.NoError(t, svc.ValidateResourceUpdate(ctx, before, after))

	after.BizCode = "missing"
	require.ErrorContains(t, svc.ValidateResourceUpdate(ctx, before, after), "biz_code")
	require.ErrorContains(t, svc.ValidateResource(ctx, after), "biz_code",
		"新增资源仍执行全量校验")
}

func TestDictionaryRevokeLifecycle(t *testing.T) {
	gormDB := openDictionaryTestDB(t)
	svc := NewService(NewGORMRepository(gormDB))
	ctx := context.Background()

	// 零引用 → 撤销成功，编码保留为终态。
	item, err := svc.RevokeBusinessDomain(ctx, "payment", "alice")
	require.NoError(t, err)
	assert.Equal(t, DictionaryStatusRevoked, item.Status)

	// 已撤销不可再次撤销 / 编辑。
	_, err = svc.RevokeBusinessDomain(ctx, "payment", "alice")
	require.ErrorIs(t, err, ErrDictionaryTerminal)
	_, err = svc.UpdateBusinessDomain(ctx, "payment", nil, nil, boolPtr(true))
	require.ErrorIs(t, err, ErrDictionaryTerminal)

	// 有引用 → 拒绝撤销，并带上引用数。
	require.NoError(t, gormDB.Exec(
		`INSERT INTO resources(resource_id,biz_code) VALUES ('res-biz-1','legacy'),('res-biz-2','legacy')`).Error)
	_, err = svc.RevokeBusinessDomain(ctx, "legacy", "alice")
	require.ErrorIs(t, err, ErrDictionaryReferenced)
	assert.Contains(t, err.Error(), "2")

	// 应用：零引用可撤销。
	_, err = svc.RevokeApplication(ctx, "new-app", "alice")
	require.NoError(t, err)

	// 平台：应用归属也算引用，组织关系未清理前不可撤销。
	_, err = svc.RevokePlatform(ctx, "ecommerce", "alice")
	require.ErrorIs(t, err, ErrDictionaryReferenced)
	// 无资源、无应用归属的平台可撤销。
	_, err = svc.RevokePlatform(ctx, "new-platform", "alice")
	require.NoError(t, err)
}

// assertResourceTouchRecorded 断言合并刷新了 resources.updated_at：M09 的配置
// 指纹只看 updated_at，引用变更不刷新时间就不会触发自动同步。
func assertResourceTouchRecorded(t *testing.T, db *gorm.DB, resourceID string) {
	t.Helper()
	var updatedAt *time.Time
	require.NoError(t, db.Table("resources").Select("updated_at").
		Where("resource_id = ?", resourceID).Scan(&updatedAt).Error)
	require.NotNil(t, updatedAt, "合并必须刷新 updated_at，M09 指纹才能感知变更")
}

func TestDictionaryMergeBusinessDomain(t *testing.T) {
	gormDB := openDictionaryTestDB(t)
	svc := NewService(NewGORMRepository(gormDB))
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(
		`INSERT INTO resources(resource_id,biz_code) VALUES ('res-1','legacy'),('res-2','legacy')`).Error)

	moved, err := svc.MergeBusinessDomain(ctx, "legacy", "payment", "alice")
	require.NoError(t, err)
	assert.Equal(t, int64(2), moved)

	var biz string
	require.NoError(t, gormDB.Table("resources").Select("biz_code").
		Where("resource_id = ?", "res-1").Scan(&biz).Error)
	assert.Equal(t, "payment", biz, "引用应在同一事务内迁移")
	assertResourceTouchRecorded(t, gormDB, "res-1")

	bizList, err := svc.ListBusinessDomains(ctx)
	require.NoError(t, err)
	for _, entry := range bizList {
		if entry.Code == "legacy" {
			assert.Equal(t, DictionaryStatusMerged, entry.Status)
			assert.Equal(t, "payment", entry.MergedInto)
			assert.Equal(t, int64(0), entry.ReferenceCount)
		}
	}

	logs, err := svc.ListDictionaryAuditLogs(ctx, "business", "legacy", 10)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Equal(t, DictionaryActionMerge, logs[0].Action)
	assert.Equal(t, "payment", logs[0].TargetCode)
	assert.Equal(t, int64(2), logs[0].ReferenceCount)
	assert.Equal(t, "alice", logs[0].Operator)

	// 源条目终态不可再次合并；自身合并被拒绝。
	_, err = svc.MergeBusinessDomain(ctx, "legacy", "payment", "alice")
	require.ErrorIs(t, err, ErrDictionaryTerminal)
	_, err = svc.MergeBusinessDomain(ctx, "payment", "payment", "alice")
	require.ErrorIs(t, err, ErrDictionaryMergeSelf)
}

func TestDictionaryMergeApplicationMigratesRelations(t *testing.T) {
	gormDB := openDictionaryTestDB(t)
	svc := NewService(NewGORMRepository(gormDB))
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(
		`INSERT INTO resources(resource_id,app_code) VALUES ('res-1','order-service')`).Error)

	moved, err := svc.MergeApplication(ctx, "order-service", "new-app", "alice")
	require.NoError(t, err)
	assert.Equal(t, int64(1), moved)

	var appCode string
	require.NoError(t, gormDB.Table("resources").Select("app_code").
		Where("resource_id = ?", "res-1").Scan(&appCode).Error)
	assert.Equal(t, "new-app", appCode)
	assertResourceTouchRecorded(t, gormDB, "res-1")

	rels, err := svc.ListAppPlatformRels(ctx, "new-app", "")
	require.NoError(t, err)
	require.Len(t, rels, 2)
	var primary string
	for _, rel := range rels {
		if rel.IsPrimary {
			primary = rel.PlatformCode
		}
	}
	assert.Equal(t, "ecommerce", primary, "源应用的主平台应随归属迁移")

	ok, err := svc.repo.ApplicationEnabled(ctx, "order-service")
	require.NoError(t, err)
	assert.False(t, ok, "已合并应用不可再被引用")
}

func TestDictionaryMergePlatformMigratesOwnership(t *testing.T) {
	gormDB := openDictionaryTestDB(t)
	svc := NewService(NewGORMRepository(gormDB))
	ctx := context.Background()

	require.NoError(t, gormDB.Exec(
		`INSERT INTO resources(resource_id,platform_code) VALUES ('res-1','lab')`).Error)

	moved, err := svc.MergePlatform(ctx, "lab", "new-platform", "alice")
	require.NoError(t, err)
	assert.Equal(t, int64(1), moved)

	var platformCode string
	require.NoError(t, gormDB.Table("resources").Select("platform_code").
		Where("resource_id = ?", "res-1").Scan(&platformCode).Error)
	assert.Equal(t, "new-platform", platformCode)
	assertResourceTouchRecorded(t, gormDB, "res-1")

	rels, err := svc.ListAppPlatformRels(ctx, "order-service", "")
	require.NoError(t, err)
	require.Len(t, rels, 2)
	codes := []string{rels[0].PlatformCode, rels[1].PlatformCode}
	assert.Contains(t, codes, "new-platform")
	assert.NotContains(t, codes, "lab")

	ok, err := svc.repo.PlatformEnabled(ctx, "lab")
	require.NoError(t, err)
	assert.False(t, ok)
}

func TestDictionaryCloudLifecycle(t *testing.T) {
	gormDB := openDictionaryTestDB(t)
	svc := NewService(NewGORMRepository(gormDB))
	ctx := context.Background()

	// Seed merge targets (M06 owns cloud creation; tests insert directly).
	require.NoError(t, gormDB.Create(&cloudDictRecord{
		CloudCode: "PUB-ALI", CloudName: "阿里云", CloudType: "PUB", Carrier: "ALI", Enabled: true,
	}).Error)

	// Zero-reference cloud revoke succeeds and codes stay reserved (terminal).
	cloud, err := svc.RevokeCloud(ctx, "PUB-TX", "alice")
	require.NoError(t, err)
	assert.Equal(t, DictionaryStatusRevoked, cloud.Status)
	_, err = svc.RevokeCloud(ctx, "PUB-TX", "alice")
	require.ErrorIs(t, err, ErrDictionaryTerminal)

	// Audit rows for the dictionary type must be queryable.
	cloudLogs, err := svc.ListDictionaryAuditLogs(ctx, dictionaryTypeCloud, "PUB-TX", 10)
	require.NoError(t, err)
	require.Len(t, cloudLogs, 1)
	assert.Equal(t, DictionaryActionRevoke, cloudLogs[0].Action)
	assert.Equal(t, "alice", cloudLogs[0].Operator)
}

func TestDictionaryCloudMergeMigratesNetworkDomainLabels(t *testing.T) {
	gormDB := openDictionaryTestDB(t)
	svc := NewService(NewGORMRepository(gormDB))
	ctx := context.Background()

	require.NoError(t, gormDB.Create(&cloudDictRecord{
		CloudCode: "PUB-ALI", CloudName: "阿里云", CloudType: "PUB", Carrier: "ALI", Enabled: true,
	}).Error)

	// Two live network domains reference the source cloud.
	require.NoError(t, gormDB.Exec(`INSERT INTO network_domains
		(id, cloud_code, status, deleted_at)
		VALUES ('dom-a','PUB-TX','enabled',NULL),
		       ('dom-b','PUB-TX','enabled',NULL)`).Error)

	// Referenced revoke is rejected and reports the reference count.
	_, err := svc.RevokeCloud(ctx, "PUB-TX", "alice")
	require.ErrorIs(t, err, ErrDictionaryReferenced)
	assert.Contains(t, err.Error(), "2")

	// Merge migrates authoritative labels in one transaction.
	moved, err := svc.MergeCloud(ctx, "PUB-TX", "PUB-ALI", "alice")
	require.NoError(t, err)
	assert.Equal(t, int64(2), moved)

	var cloudCode string
	require.NoError(t, gormDB.Table("network_domains").Select("cloud_code").
		Where("id = ?", "dom-a").Row().Scan(&cloudCode))
	assert.Equal(t, "PUB-ALI", cloudCode)

	clouds, err := svc.ListClouds(ctx)
	require.NoError(t, err)
	for _, entry := range clouds {
		if entry.CloudCode == "PUB-TX" {
			assert.Equal(t, DictionaryStatusMerged, entry.Status)
			assert.Equal(t, "PUB-ALI", entry.MergedInto)
			assert.Equal(t, int64(0), entry.ReferenceCount)
		}
	}

	logs, err := svc.ListDictionaryAuditLogs(ctx, dictionaryTypeCloud, "PUB-TX", 10)
	require.NoError(t, err)
	require.Len(t, logs, 1)
	assert.Equal(t, DictionaryActionMerge, logs[0].Action)
	assert.Equal(t, "PUB-ALI", logs[0].TargetCode)
	assert.Equal(t, int64(2), logs[0].ReferenceCount)

	// Terminal source is rejected.
	_, err = svc.MergeCloud(ctx, "PUB-TX", "PUB-ALI", "alice")
	require.ErrorIs(t, err, ErrDictionaryTerminal)
}

func boolPtr(v bool) *bool { return &v }
