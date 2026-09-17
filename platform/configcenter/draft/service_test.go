package draft

import (
	"encoding/json"
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

var testDBCounter int64

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&testDBCounter, 1)
	dsn := fmt.Sprintf("file:draftsvc_%d?mode=memory&cache=shared", n)
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

func seedDomain(t *testing.T, db *gorm.DB, id string) *models.NetworkDomain {
	t.Helper()
	d := &models.NetworkDomain{
		ID:          id,
		Name:        "域-" + id,
		DomainType:  models.DomainTypeEdge,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		ZoneType:    "extranet",
		Channel:     models.ChannelTypeAgentPull,
		IsMonitored: true,
	}
	require.NoError(t, db.Create(d).Error)
	return d
}

func seedHost(t *testing.T, db *gorm.DB, domainID, resourceID string) {
	t.Helper()
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       resourceID,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  domainID,
		BizCode:          "biz",
		PrivateIP:        "10.0.0.1",
		InstanceName:     "host-" + resourceID,
		Status:           "online",
		Region:           "cn-east",
		ZoneEnv:          "prod",
		InstanceSpec:     "4c8g",
		Image:            "Ubuntu",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		SourceType:       models.SourceTypeManual,
	}).Error)
}

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

func touchJob(t *testing.T, db *gorm.DB, id uint) {
	t.Helper()
	require.NoError(t, db.Model(&models.ScrapeJob{}).
		Where("id = ?", id).
		Updates(map[string]interface{}{
			"metrics_path": "/metrics/v2",
			"updated_at":   time.Now(),
		}).Error)
}

func draftCount(t *testing.T, db *gorm.DB, domainID string) int64 {
	t.Helper()
	var total int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ?", domainID).Count(&total).Error)
	return total
}

func loadDraftMeta(t *testing.T, db *gorm.DB, changeNo string) models.ConfigDraftMetadata {
	t.Helper()
	var d models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", changeNo).First(&d).Error)
	var meta models.ConfigDraftMetadata
	require.NoError(t, json.Unmarshal([]byte(d.Metadata), &meta))
	return meta
}

func TestGenerateDraft_IdempotentWhenNoChange(t *testing.T) {
	db := newTestDB(t)
	seedDomain(t, db, "d1")
	seedHost(t, db, "d1", "res-1")
	seedJob(t, db, "d1", "job1")

	d1, err := GenerateDraft(db, "d1")
	require.NoError(t, err)
	require.NotNil(t, d1)
	assert.Equal(t, models.DraftStatusPending, d1.Status)
	assert.Equal(t, int64(1), draftCount(t, db, "d1"))

	// 源数据未变化：再次生成应幂等返回同一张草稿。
	d2, err := GenerateDraft(db, "d1")
	require.NoError(t, err)
	assert.Equal(t, d1.ChangeNo, d2.ChangeNo)
	assert.Equal(t, int64(1), draftCount(t, db, "d1"))
}

func TestGenerateDraft_SupersedeWhenSourceChanged(t *testing.T) {
	db := newTestDB(t)
	seedDomain(t, db, "d1")
	seedHost(t, db, "d1", "res-1")
	job := seedJob(t, db, "d1", "job1")

	old, err := GenerateDraft(db, "d1")
	require.NoError(t, err)
	require.NotNil(t, old)

	// 变更源数据（job 参数变化）后再次生成。
	touchJob(t, db, job.ID)
	newDraft, err := GenerateDraft(db, "d1")
	require.NoError(t, err)
	require.NotNil(t, newDraft)

	// 旧单被 discarded，新单 pending，且 change_no 不同。
	assert.NotEqual(t, old.ChangeNo, newDraft.ChangeNo)
	assert.Equal(t, models.DraftStatusPending, newDraft.Status)

	var oldRow models.ConfigDraft
	require.NoError(t, db.Where("change_no = ?", old.ChangeNo).First(&oldRow).Error)
	assert.Equal(t, models.DraftStatusDiscarded, oldRow.Status)

	// metadata 互记 supersede 关系。
	oldMeta := loadDraftMeta(t, db, old.ChangeNo)
	assert.Equal(t, newDraft.ChangeNo, oldMeta.SupersededByChangeNo)

	newMeta := loadDraftMeta(t, db, newDraft.ChangeNo)
	assert.Equal(t, old.ChangeNo, newMeta.SupersedesChangeNo)

	// 当前域应只有一张 pending 草稿（新单），旧单 discarded。
	var pendingCount, discardedCount int64
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ? AND status = ?", "d1", models.DraftStatusPending).Count(&pendingCount).Error)
	require.NoError(t, db.Model(&models.ConfigDraft{}).
		Where("network_domain_id = ? AND status = ?", "d1", models.DraftStatusDiscarded).Count(&discardedCount).Error)
	assert.Equal(t, int64(1), pendingCount)
	assert.Equal(t, int64(1), discardedCount)
}

func TestGenerateDraft_DomainNotMonitored(t *testing.T) {
	db := newTestDB(t)
	d := seedDomain(t, db, "d1")
	d.IsMonitored = false
	require.NoError(t, db.Save(d).Error)

	_, err := GenerateDraft(db, "d1")
	assert.ErrorIs(t, err, ErrDomainNotMonitored)
}

// 决策 44-3：无任何变更项且网域从未产生已生效版本时，抑制「配置无变化」的噪声变更单。
func TestGenerateDraft_NoChangesSuppressed(t *testing.T) {
	db := newTestDB(t)
	seedDomain(t, db, "d1")
	seedHost(t, db, "d1", "res-1") // 仅有源数据，无 ready job / rule

	_, err := GenerateDraft(db, "d1")
	assert.ErrorIs(t, err, ErrNoChanges)
	assert.Equal(t, int64(0), draftCount(t, db, "d1"), "不得生成空变更单")
}

// 决策 44-2：watcher 依据产物 checksum 与 pending 草稿的 checksum 比较决定是否取代。
func TestShouldSupersedePending_ChecksumCompare(t *testing.T) {
	db := newTestDB(t)
	dom := seedDomain(t, db, "d1")
	seedHost(t, db, "d1", "res-1")
	job := seedJob(t, db, "d1", "job1")

	pending, err := GenerateDraft(db, "d1")
	require.NoError(t, err)

	// 源数据未变化：checksum 相同，不取代。
	supersede, err := ShouldSupersedePending(db, dom, pending)
	require.NoError(t, err)
	assert.False(t, supersede)

	// job 参数变化：checksum 不同，应取代。
	touchJob(t, db, job.ID)
	supersede, err = ShouldSupersedePending(db, dom, pending)
	require.NoError(t, err)
	assert.True(t, supersede)
}

// 决策 44-2：metadata 损坏/为空的旧单按「有实质差异」处理，避免卡点。
func TestShouldSupersedePending_BrokenMetadata(t *testing.T) {
	db := newTestDB(t)
	dom := seedDomain(t, db, "d1")
	seedHost(t, db, "d1", "res-1")
	seedJob(t, db, "d1", "job1")

	broken := &models.ConfigDraft{
		NetworkDomainID:  "d1",
		ChangeNo:         "CHG-BROKEN-0001",
		Status:           models.DraftStatusPending,
		ValidationStatus: string(models.ValidationStatusPending),
		Metadata:         "not-a-json",
	}
	require.NoError(t, db.Create(broken).Error)

	supersede, err := ShouldSupersedePending(db, dom, broken)
	require.NoError(t, err)
	assert.True(t, supersede)
}
