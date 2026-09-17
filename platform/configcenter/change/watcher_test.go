package change

import (
	"encoding/json"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/metriccenter/metriccenter/platform/configcenter/draft"
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

// seedJob seeds one ready standard job in the domain（draft_status=ready、
// change_status=pending，等价于「批量提交生效」后的状态），其目标解析到 seedHost 的实例。
func seedJob(t *testing.T, db *gorm.DB, domainID, name string) *models.ScrapeJob {
	t.Helper()
	job := &models.ScrapeJob{
		JobName:               name,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       domainID,
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   []string{"res-1"},
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		Enabled:               true,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusPending,
	}
	require.NoError(t, db.Create(job).Error)
	return job
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

// forceCheckNow 将该域基线的 NextCheckAt 置为过去，使下一轮 ProcessDomain 立即执行。
func forceCheckNow(t *testing.T, db *gorm.DB, domainID string) {
	t.Helper()
	past := time.Now().Add(-time.Second)
	require.NoError(t, db.Model(&models.ConfigChangeBaseline{}).
		Where("network_domain_id = ?", domainID).
		Updates(map[string]interface{}{
			"next_check_at": past,
		}).Error)
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
	assert.Equal(t, int(defaultMinInterval.Seconds()), b.IntervalSeconds)

	// 无变化且未到 NextCheckAt 时跳过；强制到达检测点后仍不生成，版本保持不变。
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(0), countDrafts(t, db, "edge-g1"))
	b = loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, versionAtInit, b.SourceVersion)
	assert.True(t, b.IntervalSeconds >= int(defaultMinInterval.Seconds()))
}

func TestProcessDomain_ChangeGeneratesPending(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	seedJob(t, db, "edge-g1", "job1") // 决策 44-3：需 ready job 才有实质产物变更
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化
	versionAtInit := loadBaselineForTest(t, db, "edge-g1").SourceVersion

	// 源数据版本推进 → 触发生成一张 pending 草稿。
	// 注意：必须超过种子 job 的 created_at（now），否则 max(updated_at) 不前进。
	setHostUpdatedAt(t, db, "res-1", time.Now().Add(time.Hour))
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(1), countDrafts(t, db, "edge-g1"))

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusGenerated, b.DetectStatus)
	assert.NotEqual(t, versionAtInit, b.SourceVersion, "成功后应推进基线版本")
	assert.Equal(t, int(defaultMinInterval.Seconds()), b.IntervalSeconds, "生成后间隔应回退到最小")

	// 再跑一轮：版本未变（无新变更），不重复生成。
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(1), countDrafts(t, db, "edge-g1"))
}

func TestProcessDomain_ChangeWithLivePendingSkips(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	seedJob(t, db, "edge-g1", "job1")
	// 真实生成一张带 checksum 的 pending（种子空 metadata 会被判为「有差异」而取代）。
	_, err := draft.GenerateDraft(db, "edge-g1")
	require.NoError(t, err)
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化

	// 源数据版本推进（host updated_at 变化）但产物 checksum 未变（不渲染 updated_at）
	// → 已有活 pending 不重复生成、不取代，标记 skipped_pending（决策 44-2）。
	// 注意：必须超过种子 job 的 created_at（now），否则 max(updated_at) 不前进。
	setHostUpdatedAt(t, db, "res-1", time.Now().Add(time.Hour))
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(1), countDrafts(t, db, "edge-g1"), "产物无变化时不得重复生成")

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusSkippedPending, b.DetectStatus)
	assert.Equal(t, versionAtInit(t, db, "edge-g1"), b.SourceVersion, "skipped_pending 不得推进基线版本")
}

// 决策 44-2：活 pending 期间产物 checksum 变化 → 生成新 pending 取代旧单，
// 旧单置 discarded 且 metadata 互记 supersede 关系。
func TestProcessDomain_LivePendingSupersededOnChecksumChange(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	job := seedJob(t, db, "edge-g1", "job1")
	old, err := draft.GenerateDraft(db, "edge-g1")
	require.NoError(t, err)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化
	initVersion := loadBaselineForTest(t, db, "edge-g1").SourceVersion

	// 直接改库推进源数据与产物 checksum（绕过 pending 禁编辑守卫，模拟规则编辑等旁路变更）。
	require.NoError(t, db.Model(&models.ScrapeJob{}).Where("id = ?", job.ID).
		Updates(map[string]interface{}{"metrics_path": "/metrics/v2", "updated_at": time.Now()}).Error)
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))

	assert.Equal(t, int64(2), countDrafts(t, db, "edge-g1"), "应生成新 pending 并保留被取代的旧单")

	var oldRow, newRow models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", old.ChangeNo).First(&oldRow).Error)
	assert.Equal(t, models.DraftStatusDiscarded, oldRow.Status)
	require.NoError(t, db.Where("network_domain_id = ? AND status = ?", "edge-g1", models.DraftStatusPending).First(&newRow).Error)
	assert.NotEqual(t, old.ChangeNo, newRow.ChangeNo)

	var oldMeta, newMeta models.ConfigDraftMetadata
	require.NoError(t, json.Unmarshal([]byte(oldRow.Metadata), &oldMeta))
	require.NoError(t, json.Unmarshal([]byte(newRow.Metadata), &newMeta))
	assert.Equal(t, newRow.ChangeNo, oldMeta.SupersededByChangeNo, "旧单应记录 superseded_by")
	assert.Equal(t, oldRow.ChangeNo, newMeta.SupersedesChangeNo, "新单应记录 supersedes")

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusGenerated, b.DetectStatus)
	assert.NotEqual(t, initVersion, b.SourceVersion, "取代成功后应推进基线版本")
}

// 决策 44-3：源数据版本推进但无任何变更项（无 ready job/rule）且从未生效，
// 不生成「配置无变化」的噪声变更单，仅推进基线。
func TestProcessDomain_NoChangesSuppressed(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化
	initVersion := loadBaselineForTest(t, db, "edge-g1").SourceVersion

	setHostUpdatedAt(t, db, "res-1", past.Add(time.Hour))
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(0), countDrafts(t, db, "edge-g1"), "无实质变更不得生成变更单")

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusIdle, b.DetectStatus)
	assert.NotEqual(t, initVersion, b.SourceVersion, "抑制后仍推进基线，避免每轮重试")
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
	forceCheckNow(t, db, "edge-g1")
	require.Error(t, ProcessDomain(db, "edge-g1"))
	assert.Equal(t, int64(0), countDrafts(t, db, "edge-g1"))

	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusFailed, b.DetectStatus)
	assert.NotEmpty(t, b.LastError)
	assert.Equal(t, versionAtInit, b.SourceVersion, "失败时不得推进基线版本")
}

func TestProcessDomain_AdaptiveBackoff(t *testing.T) {
	db := newMemDB(t)
	seedDomain(t, db, "edge-g1", true)
	seedHost(t, db, "edge-g1", "res-1")
	seedJob(t, db, "edge-g1", "job1") // 决策 44-3：需 ready job 才有实质产物变更
	past := time.Now().Add(-2 * time.Hour)
	setHostUpdatedAt(t, db, "res-1", past)

	require.NoError(t, ProcessDomain(db, "edge-g1")) // 首启初始化

	minI := defaultMinInterval
	maxI := defaultMaxInterval

	// 连续多轮无变化，间隔应指数增长。
	prevInterval := minI
	for i := 0; i < 10; i++ {
		forceCheckNow(t, db, "edge-g1")
		require.NoError(t, ProcessDomain(db, "edge-g1"))
		b := loadBaselineForTest(t, db, "edge-g1")
		cur := time.Duration(b.IntervalSeconds) * time.Second
		if cur < maxI {
			assert.True(t, cur >= prevInterval, "间隔应单调不减")
		}
		prevInterval = cur
	}
	b := loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, int(maxI.Seconds()), b.IntervalSeconds, "间隔应达到上限")

	// 一旦有源数据变化，间隔立即回退到最小。
	// 注意：必须超过种子 job 的 created_at（now），否则 max(updated_at) 不前进。
	setHostUpdatedAt(t, db, "res-1", time.Now().Add(time.Hour))
	forceCheckNow(t, db, "edge-g1")
	require.NoError(t, ProcessDomain(db, "edge-g1"))
	b = loadBaselineForTest(t, db, "edge-g1")
	assert.Equal(t, models.DetectStatusGenerated, b.DetectStatus)
	assert.Equal(t, int(minI.Seconds()), b.IntervalSeconds, "源变化后间隔回退到最小")
	assert.Equal(t, 0, b.BackoffLevel)
}

// versionAtInit 读取首启初始化后的 SourceVersion（用于断言 skipped_pending 不推进）。
func versionAtInit(t *testing.T, db *gorm.DB, domainID string) string {
	t.Helper()
	var b models.ConfigChangeBaseline
	require.NoError(t, db.Where("network_domain_id = ?", domainID).First(&b).Error)
	return b.SourceVersion
}
