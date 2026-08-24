package change

import (
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var memDBCounter int64

// newMemDB opens a per-test in-memory SQLite DB migrated with all source +
// output tables needed by SourceDataVersion / GenerateDraft / baseline.
func newMemDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&memDBCounter, 1)
	dsn := fmt.Sprintf("file:change_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Tenant{},
		&models.NetworkDomain{},
		&models.ScrapeJob{},
		&models.MonitoringRule{},
		&models.LabelTemplate{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.CITypeExporterMapping{},
		&models.ExporterInstallationConfirmation{},
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
		&models.ConfigChangeBaseline{},
	))
	return db
}

// seedDomain seeds a network domain with given monitored/status flags.
func seedDomain(t *testing.T, db *gorm.DB, id string, monitored bool) {
	t.Helper()
	d := &models.NetworkDomain{
		ID:          id,
		Name:        "域-" + id,
		DomainType:  models.DomainTypeEdge,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		ZoneType:    "extranet",
		Channel:     models.ChannelTypeAgentPull,
		IsMonitored: monitored,
	}
	require.NoError(t, db.Create(d).Error)
}

// seedHost seeds one host in the domain as a source-data row (version can be
// advanced via setHostUpdatedAt).
func seedHost(t *testing.T, db *gorm.DB, domainID, resourceID string) {
	t.Helper()
	h := &models.Host{
		ResourceID:       resourceID,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domainID,
		BizCode:          "biz",
		InstanceName:     "host-" + resourceID,
		Status:           "online",
		Region:           "cn-east",
		ZoneEnv:          "prod",
		InstanceSpec:     "4c8g",
		Image:            "Ubuntu",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		SourceType:       models.SourceTypeManual,
	}
	require.NoError(t, db.Create(h).Error)
}

// setHostUpdatedAt force-sets updated_at (bypasses GORM auto-timestamp) so the
// aggregated source version can be reliably advanced in tests.
func setHostUpdatedAt(t *testing.T, db *gorm.DB, resourceID string, ts time.Time) {
	t.Helper()
	require.NoError(t, db.Model(&models.Host{}).
		Where("resource_id = ?", resourceID).
		UpdateColumn("updated_at", ts).Error)
}

func seedDraft(t *testing.T, db *gorm.DB, domainID string) {
	t.Helper()
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID:  domainID,
		ChangeNo:         "CHG-TEST-0001",
		PrometheusYml:    "global:\n  scrape_interval: 15s\n",
		Status:           models.DraftStatusPending,
		ValidationStatus: string(models.ValidationStatusPending),
		Summary:          "测试草稿",
	}).Error)
}

func countDrafts(t *testing.T, db *gorm.DB, domainID string) int64 {
	t.Helper()
	var total int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ?", domainID).Count(&total).Error)
	return total
}

func loadBaselineForTest(t *testing.T, db *gorm.DB, domainID string) *models.ConfigChangeBaseline {
	t.Helper()
	b, err := loadBaseline(db, domainID)
	require.NoError(t, err)
	require.NotNil(t, b)
	return b
}

func TestProcessDomain_FirstRunInitializesWithoutGenerating(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	// 首启：仅初始化基线，不生成草稿。
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(0), countDrafts(t, db, "edge-g1"))
	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusIdle, b.DetectStatus)
	assert.Empty(t, b.LastError)
	versionAtInit := b.SourceVersion
	assert.NotEmpty(t, versionAtInit)

	// 无变化跳过：版本未推进，仍不生成。
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(0), countDrafts(t, db, "edge-g1"))
	b = loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, versionAtInit, b.SourceVersion)
}

func TestProcessDomain_ChangeGeneratesPending(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化
	versionAtInit := loadBaselineForTest(t, db, "edge-g1").SourceVersion

	// 源数据版本推进 → 触发生成一张 pending 草稿。
	setHostUpdatedAt(t, db, "res-1", past.Add(time.Hour))
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(1), countDrafts(t, db, "edge-g1"))

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusGenerated, b.DetectStatus)
	assert.NotEqual(t, versionAtInit, b.SourceVersion, "成功后应推进基线版本")

	// 再跑一轮：版本未变（无新变更），不重复生成。
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(1), countDrafts(t, db, "edge-g1"))
}

func TestProcessDomain_ChangeWithLivePendingSkips(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	seedDraft(t, db, "edge-g1") // 已有活 pending
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化

	// 源数据版本推进 + 已有活 pending → 不重复生成（保活），标记 skipped_pending。
	setHostUpdatedAt(t, db, "res-1", past.Add(time.Hour))
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(1), countDrafts(t, db, "edge-g1"), "已有待确认单时不得重复生成")

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusSkippedPending, b.DetectStatus)
}

func TestProcessDomain_GenerateFailDoesNotAdvanceVersion(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", false) // 未纳管：GenerateDraft 将失败
	seedHost(t, db, "edge-g1", "res-1")
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化
	versionAtInit := loadBaselineForTest(t, db, "edge-g1").SourceVersion

	// 版本推进但生成失败 → 标记 failed，且不推进基线版本（决策 42-4，下轮重试）。
	setHostUpdatedAt(t, db, "res-1", past.Add(time.Hour))
	require.Error(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(0), countDrafts(t, db, "edge-g1"))

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusFailed, b.DetectStatus)
	assert.NotEmpty(t, b.LastError)
	assert.Equal(t, versionAtInit, b.SourceVersion, "失败时不得推进基线版本")
}