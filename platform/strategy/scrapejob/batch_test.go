package scrapejob

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

var batchTestDBCounter int64

func newBatchTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&batchTestDBCounter, 1)
	dsn := fmt.Sprintf("file:batch_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&models.ScrapeJob{}, &models.NetworkDomain{}))
	return db
}

func seedBatchDomain(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          "domain-1",
		Name:        "domain-1",
		DomainType:  models.DomainTypeEdge,
		TenantID:    models.PlatformAdminTenantID,
		Status:      models.DomainStatusEnabled,
		Channel:     models.ChannelTypeLocal,
		IsMonitored: true,
	}).Error)
}

func seedBatchJob(t *testing.T, db *gorm.DB, name, draftStatus string) *models.ScrapeJob {
	t.Helper()
	job := &models.ScrapeJob{
		JobName:               name,
		JobType:               models.JobTypeStandard,
		ResourceType:          models.ResourceTypeHost,
		MonitorType:           "mysql",
		NetworkDomainID:       "domain-1",
		InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		Enabled:               true,
		DraftStatus:           draftStatus,
		ChangeStatus:          models.ChangeStatusNone,
	}
	require.NoError(t, db.Create(job).Error)
	return job
}

func TestBatchSubmitReady(t *testing.T) {
	db := newBatchTestDB(t)
	seedBatchDomain(t, db)
	j1 := seedBatchJob(t, db, "job1", "draft")
	j2 := seedBatchJob(t, db, "job2", "draft")

	jobs, err := BatchSubmitReady(db, []uint{j1.ID, j2.ID})
	require.NoError(t, err)
	require.Len(t, jobs, 2)
	for _, j := range jobs {
		assert.Equal(t, "ready", j.DraftStatus)
		assert.Equal(t, models.ChangeStatusPending, j.ChangeStatus)
	}

	var count int64
	require.NoError(t, db.Model(&models.ScrapeJob{}).
		Where("id IN ? AND draft_status = ? AND change_status = ?", []uint{j1.ID, j2.ID}, "ready", string(models.ChangeStatusPending)).Count(&count).Error)
	assert.Equal(t, int64(2), count)
}

func TestBatchSubmitReady_RejectReadyJob(t *testing.T) {
	db := newBatchTestDB(t)
	seedBatchDomain(t, db)
	j1 := seedBatchJob(t, db, "job1", "draft")
	j2 := seedBatchJob(t, db, "job2", "ready") // 已在 ready

	_, err := BatchSubmitReady(db, []uint{j1.ID, j2.ID})
	require.Error(t, err)

	// j1 也不应被部分更新（all-or-nothing）。
	var updated models.ScrapeJob
	require.NoError(t, db.First(&updated, j1.ID).Error)
	assert.Equal(t, "draft", updated.DraftStatus)
}

func TestBatchSubmitReady_ValidateBeforeReady(t *testing.T) {
	db := newBatchTestDB(t)
	seedBatchDomain(t, db)
	j1 := seedBatchJob(t, db, "job1", "draft")
	// 把必填字段置空，模拟草稿态未填完整。
	require.NoError(t, db.Model(j1).Update("scrape_interval", "").Error)

	_, err := BatchSubmitReady(db, []uint{j1.ID})
	require.Error(t, err)

	var updated models.ScrapeJob
	require.NoError(t, db.First(&updated, j1.ID).Error)
	assert.Equal(t, "draft", updated.DraftStatus)
}

func TestBatchSubmitReady_MissingID(t *testing.T) {
	db := newBatchTestDB(t)
	seedBatchDomain(t, db)
	j1 := seedBatchJob(t, db, "job1", "draft")

	_, err := BatchSubmitReady(db, []uint{j1.ID, 999})
	require.Error(t, err)
}
