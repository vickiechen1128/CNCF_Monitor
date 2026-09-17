package dashboard

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// testDBCounter 为每个测试生成唯一内存 DSN，避免并行测试共享库造成数据串扰。
var testDBCounter int64

// strPtr 返回字符串指针（构造 *string 字段用）。
func strPtr(s string) *string { return &s }

func newTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&testDBCounter, 1)
	dsn := fmt.Sprintf("file:dashboard_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.NetworkDomain{},
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
		&models.ScrapeJob{},
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
	))
	t.Cleanup(func() {
		if sqlDB, e := db.DB(); e == nil {
			sqlDB.Close()
		}
	})
	return db
}

// seed 构造少量资源 / 采集 Job / 草稿 / 下发记录 / 网域，返回 db 与期望汇总。
func seed(t *testing.T, db *gorm.DB) {
	t.Helper()

	now := time.Now()

	// 2 个网域：1 个已纳管（default）、1 个未纳管（edge）。
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          "default",
		Name:        "管理网域",
		DomainType:  models.DomainTypeManagement,
		Channel:     models.ChannelTypeLocal,
		Status:      models.DomainStatusEnabled,
		IsMonitored: true,
	}).Error)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          "edge-1",
		Name:        "边缘网域A",
		DomainType:  models.DomainTypeEdge,
		ZoneType:    "internet",
		Channel:     models.ChannelTypeAgentPull,
		Status:      models.DomainStatusEnabled,
		IsMonitored: false,
	}).Error)

	// 3 个资源：host(x1)、database(x1)、middleware(x1) → resource_count=3。
	for _, m := range []interface{}{
		&models.Host{
			ResourceID:       "res-host-1",
			ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID:  "default",
			BizCode:          "infra",
			SourceType:       models.SourceTypeManual,
			AppCode:          "app",
			EnvFlag:          "prod",
			SubAppCode:       "cluster",
			InstanceName:     "web-01",
			Status:           "online",
		},
		&models.Database{
			ResourceBase: models.ResourceBase{
				ResourceID:       "res-db-1",
				ResourceCategory: models.ResourceCategoryDatabase,
				NetworkDomainID:  "default",
				BizCode:          "infra",
				SourceType:       models.SourceTypeManual,
				AppName:          strPtr("db"),
				Env:              "prod",
				Cluster:          strPtr("cluster"),
				Status:           "online",
			},
		},
		&models.Middleware{
			ResourceID:       "res-mw-1",
			ResourceCategory: models.ResourceCategoryMiddleware,
			NetworkDomainID:  "default",
			BizCode:          "infra",
			SourceType:       models.SourceTypeManual,
			AppName:          "mw",
			Env:              "prod",
			Cluster:          "cluster",
			Status:           "online",
		},
	} {
		require.NoError(t, db.Create(m).Error)
	}

	// 草稿：2 条 pending、1 条 confirmed → pending_draft_count=2。
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID:  "default",
		ChangeNo:         "CHG-20260824-001",
		Status:           models.DraftStatusPending,
		ValidationStatus: string(models.ValidationStatusPending),
	}).Error)
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID:  "default",
		ChangeNo:         "CHG-20260824-002",
		Status:           models.DraftStatusPending,
		ValidationStatus: string(models.ValidationStatusPending),
	}).Error)
	require.NoError(t, db.Create(&models.ConfigDraft{
		NetworkDomainID:  "edge-1",
		ChangeNo:         "CHG-20260823-100",
		Status:           models.DraftStatusConfirmed,
		ValidationStatus: string(models.ValidationStatusPassed),
	}).Error)

	// 下发记录：7 条，最近 created_at 应被取前 5。
	for i := 1; i <= 7; i++ {
		ts := now.Add(-time.Duration(i) * time.Hour)
		require.NoError(t, db.Create(&models.ConfigDeployment{
			BaseModel:        models.BaseModel{CreatedAt: ts},
			DeploymentID:     fmt.Sprintf("deploy-%03d", i),
			NetworkDomainID:  "default",
			ConfigVersionID:  fmt.Sprintf("%d", i),
			SourceChangeNo:   fmt.Sprintf("CHG-DEP-%03d", i),
			Channel:          models.ChannelTypeLocal,
			Status:           models.DeploymentStatusSuccess,
			ValidationStatus: string(models.ValidationStatusPassed),
			TriggeredBy:      "admin",
			TriggeredAt:      &ts,
		}).Error)
	}

	seedScrapeJobs(t, db)
}

// newJob 构造一个字段齐备（满足 not null 约束）的采集 Job。
func newJob(name string, jobType models.JobType, draftStatus string, enabled bool, selected []string) models.ScrapeJob {
	return models.ScrapeJob{
		JobName:               name,
		JobType:               jobType,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       "default",
		InstanceSelectionMode: models.InstanceSelectionManual,
		SelectedInstanceIDs:   selected,
		ScrapeInterval:        models.DefaultScrapeInterval,
		ScrapeTimeout:         models.DefaultScrapeTimeout,
		MetricsPath:           models.DefaultMetricsPath,
		Scheme:                models.DefaultScheme,
		AuthType:              models.AuthTypeNone,
		DraftStatus:           draftStatus,
		ChangeStatus:          models.ChangeStatusNone,
		Enabled:               enabled,
	}
}

// seedScrapeJobs 构造采集 Job 覆盖场景，用于 monitored_count / scrape_job_count 口径断言：
//   - ready+enabled 标准 Job 覆盖 res-host-1 / res-db-1（res-gone-1 是已不存在的资源）→ monitored=2；
//   - blackbox Job 亦选中 res-mw-1，用于证明「blackbox 不计入」（去掉 job_type 过滤即会失败）；
//   - draft 状态、enabled=false、soft-deleted 的 Job 同样不得计入 monitored_count；
//   - 未软删 Job 共 5 个，其中 enabled=true 4 个。
func seedScrapeJobs(t *testing.T, db *gorm.DB) {
	t.Helper()

	jobs := []models.ScrapeJob{
		newJob("job-standard-a", models.JobTypeStandard, "ready", true, []string{"res-host-1", "res-db-1"}),
		newJob("job-standard-b", models.JobTypeStandard, "ready", true, []string{"res-host-1", "res-gone-1"}),
		newJob("job-standard-c", models.JobTypeStandard, "draft", true, []string{"res-mw-1"}),
		newJob("job-standard-d", models.JobTypeStandard, "ready", false, []string{"res-mw-1"}),
		newJob("job-blackbox-a", models.JobTypeBlackbox, "ready", true, []string{"res-mw-1"}),
	}
	for i := range jobs {
		require.NoError(t, db.Create(&jobs[i]).Error)
	}

	// 软删 Job：不计入任何计数（GORM 默认排除）。
	deleted := newJob("job-standard-deleted", models.JobTypeStandard, "ready", true, []string{"res-mw-1"})
	require.NoError(t, db.Create(&deleted).Error)
	require.NoError(t, db.Delete(&deleted).Error)
}

func runSummaryRequest(t *testing.T, db *gorm.DB) (int, Summary) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/dashboard/summary", SummaryHandler(db))
	req := httptest.NewRequest(http.MethodGet, "http://mc.local/api/v2/platform/dashboard/summary", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	var body struct {
		Status string  `json:"status"`
		Data   Summary `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	return w.Code, body.Data
}

func TestSummaryHandler(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	code, s := runSummaryRequest(t, db)
	require.Equal(t, http.StatusOK, code)

	assert.Equal(t, 3, s.ResourceCount)
	assert.Equal(t, 2, s.PendingDraftCount)
	assert.Equal(t, 1, s.DomainCount, "仅 default 网域已纳管")

	// 已监控：ready+enabled 标准 Job 覆盖 res-host-1 / res-db-1（res-gone-1 已不存在，
	// draft / disabled / blackbox / 软删 Job 均不计入）。
	assert.Equal(t, 2, s.MonitoredCount)
	assert.LessOrEqual(t, s.MonitoredCount, s.ResourceCount, "已监控不得超过资源总数")
	// 采集 Job：未软删 5 个（standard 4 + blackbox 1），其中 enabled=true 4 个。
	assert.Equal(t, 5, s.ScrapeJobCount)
	assert.Equal(t, 4, s.ScrapeJobEnabledCount)

	// 最近下发：created_at 最早 i=1（now-1h）最新，前 5 条为 DEP-001..005。
	require.Len(t, s.RecentDeployments, 5, "应返回最近 5 条下发记录")
	assert.Equal(t, "CHG-DEP-001", s.RecentDeployments[0].ChangeNo)
	assert.Equal(t, "管理网域", s.RecentDeployments[0].NetworkDomainName)
	assert.Equal(t, string(models.DeploymentStatusSuccess), s.RecentDeployments[0].Status)
	assert.NotNil(t, s.RecentDeployments[0].TriggeredAt)
	assert.NotZero(t, s.RecentDeployments[0].ID)
	assert.Equal(t, "CHG-DEP-005", s.RecentDeployments[4].ChangeNo)
}

func TestSummaryHandlerEmpty(t *testing.T) {
	// 空库：各计数为 0，recent_deployments 为空数组而非 null。
	db := newTestDB(t)
	code, s := runSummaryRequest(t, db)
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, 0, s.ResourceCount)
	assert.Equal(t, 0, s.PendingDraftCount)
	assert.Equal(t, 0, s.DomainCount)
	assert.Equal(t, 0, s.MonitoredCount)
	assert.Equal(t, 0, s.ScrapeJobCount)
	assert.Equal(t, 0, s.ScrapeJobEnabledCount)
	assert.NotNil(t, s.RecentDeployments)
	assert.Empty(t, s.RecentDeployments)

	// JSON 编码校验 recent_deployments 输出为 []。
	raw, err := json.Marshal(s.RecentDeployments)
	require.NoError(t, err)
	assert.Equal(t, "[]", string(raw))
}

// TestSummaryMonitoredCountExcludesDeletedResources 校验「已监控」与五类资源表现存 ID
// 求交集：资源软删后即使仍被启用 Job 选中，也不计入，且 monitored_count ≤ resource_count。
func TestSummaryMonitoredCountExcludesDeletedResources(t *testing.T) {
	db := newTestDB(t)

	host := &models.Host{
		ResourceID:       "res-host-1",
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		AppCode:          "app",
		EnvFlag:          "prod",
		SubAppCode:       "cluster",
		InstanceName:     "web-01",
		Status:           "online",
	}
	require.NoError(t, db.Create(host).Error)

	job := newJob("job-1", models.JobTypeStandard, "ready", true, []string{"res-host-1"})
	require.NoError(t, db.Create(&job).Error)

	_, s := runSummaryRequest(t, db)
	require.Equal(t, 1, s.ResourceCount)
	assert.Equal(t, 1, s.MonitoredCount)

	// 资源软删：resource_count 归零，且被选中关系不再计入 monitored_count。
	require.NoError(t, db.Delete(host).Error)
	_, s = runSummaryRequest(t, db)
	assert.Equal(t, 0, s.ResourceCount)
	assert.Equal(t, 0, s.MonitoredCount, "已软删资源不得计入已监控")
	// 采集 Job 本身未删，计数不受影响。
	assert.Equal(t, 1, s.ScrapeJobCount)
}
