package dashboard

import (
	"context"
	"encoding/json"
	"errors"
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
		// 决策 92：by_app 的 app_name 展示名 join 应用字典
		&models.ApplicationDict{},
		// 决策 92/93/95：by_app 的 biz_name 展示名 join 业务字典
		&models.BusinessDomain{},
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

	// 业务字典（决策 48）：biz_code → biz_name 展示名；by_app 的 biz_name 多数归因取值源。
	require.NoError(t, db.Create(&models.BusinessDomain{
		Code: "pay", Name: "支付域", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.BusinessDomain{
		Code: "ops", Name: "运维域", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.BusinessDomain{
		Code: "infra", Name: "公共基础设施", Enabled: true,
	}).Error)

	// 12 个资源，覆盖五类 + 应用归属（含未归类）+ 子类，用于分组聚合不变量断言：
	//   host(3): Image=linux/linux/windows；AppCode=app/app/""（未归类）；BizCode=pay/ops/infra
	//   database(2): DatabaseType=mysql/redis；AppName=db/db；BizCode=infra/infra
	//   middleware(2): MiddlewareType=nginx/kafka；AppName=app/""（未归类）；BizCode=pay/infra
	//   application(2): AppName=appsvc/""（未归类）；无子类；BizCode=infra/infra
	//   generic_target(3): ExporterType=snmp_exporter/snmp_exporter/http_exporter；AppName=gt/gt/""（未归类）；BizCode=infra/infra/infra
	// → resource_count=12，未归类(app 空)=4，app 非空=8。
	// 业务域多数归因（决策 92/93/95）：app 下 3 资源 biz=pay×2 + ops×1 → BizCode=pay；
	// db/appsvc/gt 全量 biz=infra → BizCode=infra。
	for _, m := range []interface{}{
		&models.Host{
			ResourceID: "res-host-1", ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "pay", SourceType: models.SourceTypeManual,
			AppCode: "app", EnvFlag: "prod", SubAppCode: "cluster", InstanceName: "web-01",
			ServerID: "srv-host-1", Status: "online", Image: "linux",
		},
		&models.Host{
			ResourceID: "res-host-2", ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "ops", SourceType: models.SourceTypeManual,
			AppCode: "app", EnvFlag: "prod", SubAppCode: "cluster", InstanceName: "web-02",
			ServerID: "srv-host-2", Status: "online", Image: "windows",
		},
		&models.Host{
			ResourceID: "res-host-3", ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppCode: "", EnvFlag: "prod", SubAppCode: "cluster", InstanceName: "web-03",
			ServerID: "srv-host-3", Status: "online", Image: "linux",
		},
		&models.Database{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-db-1", ResourceCategory: models.ResourceCategoryDatabase,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("db"), Env: "prod", Cluster: strPtr("cluster"), Status: "online",
			},
			DatabaseType: "mysql", InstanceIP: "10.0.0.1", Port: 3306,
		},
		&models.Database{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-db-2", ResourceCategory: models.ResourceCategoryDatabase,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("db"), Env: "prod", Cluster: strPtr("cluster"), Status: "online",
			},
			DatabaseType: "redis", InstanceIP: "10.0.0.2", Port: 6379,
		},
		&models.Middleware{
			ResourceID: "res-mw-1", ResourceCategory: models.ResourceCategoryMiddleware,
			NetworkDomainID: "default", BizCode: "pay", SourceType: models.SourceTypeManual,
			AppName: "app", Env: "prod", Cluster: "cluster", Status: "online",
			MiddlewareType: "nginx", InstanceIP: "10.0.0.3", Port: 80,
		},
		&models.Middleware{
			ResourceID: "res-mw-2", ResourceCategory: models.ResourceCategoryMiddleware,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: "", Env: "prod", Cluster: "cluster", Status: "online",
			MiddlewareType: "kafka", InstanceIP: "10.0.0.4", Port: 9092,
		},
		&models.Application{
			ResourceID: "res-app-1", ResourceCategory: models.ResourceCategoryApplication,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: "appsvc", Env: "prod", Cluster: "cluster", Status: "online",
			ServiceName: "order-svc", HealthCheckURL: "http://10.0.0.5/health", Protocol: "http", Port: 8080,
		},
		&models.Application{
			ResourceID: "res-app-2", ResourceCategory: models.ResourceCategoryApplication,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: "", Env: "prod", Cluster: "cluster", Status: "online",
			ServiceName: "pay-svc", HealthCheckURL: "http://10.0.0.6/health", Protocol: "http", Port: 8081,
		},
		&models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-gt-1", ResourceCategory: models.ResourceCategoryGenericTarget,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("gt"), Env: "prod", Cluster: strPtr("cluster"), Status: "online",
			},
			TargetName: "snmp-1", InstanceIP: "10.0.0.7", Port: 161, ExporterType: "snmp_exporter",
		},
		&models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-gt-2", ResourceCategory: models.ResourceCategoryGenericTarget,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("gt"), Env: "prod", Cluster: strPtr("cluster"), Status: "online",
			},
			TargetName: "snmp-2", InstanceIP: "10.0.0.8", Port: 161, ExporterType: "snmp_exporter",
		},
		&models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-gt-3", ResourceCategory: models.ResourceCategoryGenericTarget,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr(""), Env: "prod", Cluster: strPtr("cluster"), Status: "online",
			},
			TargetName: "http-1", InstanceIP: "10.0.0.9", Port: 9115, ExporterType: "http_exporter",
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

// seedScrapeJobs 构造采集 Job 覆盖场景，用于 monitored_count / scrape_job_count / 拨测口径断言：
//   - ready+enabled 标准 Job 覆盖 res-host-1 / res-host-2 / res-db-1 / res-mw-1 / res-app-1 /
//     res-gt-1（去重）→ monitored=6；
//   - draft 状态、enabled=false 的标准 Job 选中的资源不得计入；
//   - blackbox Job 选中 res-mw-2，用于证明「blackbox 不计入 monitored」且拨测目标独立统计；
//   - 未软删 Job 共 5 个，其中 enabled=true 4 个；blackbox Job 带 3 个拨测目标。
func seedScrapeJobs(t *testing.T, db *gorm.DB) {
	t.Helper()

	jobs := []models.ScrapeJob{
		newJob("job-standard-a", models.JobTypeStandard, "ready", true, []string{"res-host-1", "res-host-2", "res-db-1"}),
		newJob("job-standard-b", models.JobTypeStandard, "ready", true, []string{"res-mw-1", "res-app-1", "res-gt-1"}),
		newJob("job-standard-c", models.JobTypeStandard, "draft", true, []string{"res-host-3"}),
		newJob("job-standard-d", models.JobTypeStandard, "ready", false, []string{"res-db-2"}),
		newJob("job-blackbox-a", models.JobTypeBlackbox, "ready", true, []string{"res-mw-2"}),
	}
	// blackbox Job 自带 3 个拨测目标（models.BlackboxTarget，不计入资源台账）。
	// 第 3 个带显式 URL，用于 probe_targets.url 优先取 URL 的断言。
	jobs[4].BlackboxTargets = []models.BlackboxTarget{
		{Target: "10.0.0.1:80", Protocol: models.BlackboxTargetProtocolHTTP},
		{Target: "10.0.0.2:80", Protocol: models.BlackboxTargetProtocolHTTP},
		{Target: "10.0.0.3:443", Protocol: models.BlackboxTargetProtocolHTTPS, URL: "https://10.0.0.3:443/healthz"},
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

	assert.Equal(t, 12, s.ResourceCount, "五类资源合计")
	assert.Equal(t, 2, s.PendingDraftCount)
	assert.Equal(t, 1, s.DomainCount, "仅 default 网域已纳管")

	// 已监控：ready+enabled 标准 Job 覆盖 6 个资源（host-1/2、db-1、mw-1、app-1、gt-1）；
	// draft / disabled / blackbox / 软删 Job 均不计入。
	assert.Equal(t, 6, s.MonitoredCount)
	assert.LessOrEqual(t, s.MonitoredCount, s.ResourceCount, "已监控不得超过资源总数")

	// —— 决策 91 分组聚合不变量（验收红线）——
	// 不变量 1 & 2：sum(by_category) == 全局 resource/monitored。
	var sumCatRes, sumCatMon int
	for _, c := range s.ByCategory {
		sumCatRes += c.ResourceCount
		sumCatMon += c.MonitoredCount
		// 子类合计应等于该类合计（application 不设子类，by_subtype 恒为空数组，跳过）。
		if c.ResourceCategory == "application" {
			assert.Empty(t, c.BySubtype, "application 不设子类")
			continue
		}
		var subRes, subMon int
		for _, st := range c.BySubtype {
			subRes += st.ResourceCount
			subMon += st.MonitoredCount
		}
		assert.Equal(t, c.ResourceCount, subRes, "类 %s 子类 resource 之和应等于类合计", c.ResourceCategory)
		assert.Equal(t, c.MonitoredCount, subMon, "类 %s 子类 monitored 之和应等于类合计", c.ResourceCategory)
	}
	assert.Equal(t, s.ResourceCount, sumCatRes, "不变量1: sum(by_category.resource_count)==resource_count")
	assert.Equal(t, s.MonitoredCount, sumCatMon, "不变量2: sum(by_category.monitored_count)==monitored_count")

	// 不变量 3 & 4：sum(by_app) + 未归类 == 全局。
	var sumAppRes, sumAppMon int
	for _, a := range s.ByApp {
		sumAppRes += a.ResourceCount
		sumAppMon += a.MonitoredCount
	}
	assert.Equal(t, 8, sumAppRes, "app 非空资源数")
	assert.Equal(t, 4, s.UnclassifiedResourceCount, "未归类资源数（app_code 空）")
	assert.Equal(t, s.ResourceCount, sumAppRes+s.UnclassifiedResourceCount, "不变量3")
	assert.Equal(t, s.MonitoredCount, sumAppMon+s.UnclassifiedMonitoredCount, "不变量4")

	// 决策 92/93/95：by_app 业务域多数归因（biz_code/biz_name）。
	appByCode := make(map[string]AppSummary, len(s.ByApp))
	for _, a := range s.ByApp {
		appByCode[a.AppCode] = a
	}
	// app 下 3 资源 biz=pay×2 + ops×1 → 多数归因 pay；BizName 查业务字典。
	assert.Equal(t, "pay", appByCode["app"].BizCode, "app 多数归因 biz_code")
	assert.Equal(t, "支付域", appByCode["app"].BizName, "app 的 biz_name 查业务字典")
	// db/appsvc/gt 全量 biz=infra → 归因 infra（字典有名）。
	assert.Equal(t, "infra", appByCode["db"].BizCode)
	assert.Equal(t, "公共基础设施", appByCode["db"].BizName)
	assert.Equal(t, "infra", appByCode["appsvc"].BizCode)
	assert.Equal(t, "infra", appByCode["gt"].BizCode)

	// 五类固定齐全且 application 不拆子类。
	require.Len(t, s.ByCategory, 5, "by_category 五类固定齐全")
	catByKey := make(map[string]CategorySummary)
	for _, c := range s.ByCategory {
		catByKey[c.ResourceCategory] = c
	}
	// application by_subtype 必须为空数组。
	assert.Empty(t, catByKey["application"].BySubtype, "application 不设子类")
	// host 子类 linux=2/windows=1；database mysql=1/redis=1；middleware nginx=1/kafka=1；
	// generic_target snmp_exporter=2/http_exporter=1。
	assert.Equal(t, 3, catByKey["host"].ResourceCount)
	assert.Equal(t, 2, catByKey["host"].MonitoredCount)
	assert.Equal(t, 2, catByKey["database"].ResourceCount)
	assert.Equal(t, 1, catByKey["database"].MonitoredCount)
	assert.Equal(t, 2, catByKey["middleware"].ResourceCount)
	assert.Equal(t, 2, catByKey["application"].ResourceCount)

	// 拨测（blackbox）不进 resource/monitored，独立统计；未注入 querier 时 abnormal 恒 0。
	assert.Equal(t, 3, s.ProbeTargetCount, "blackbox 目标数")
	assert.Equal(t, 0, s.ProbeTargetAbnormalCount, "未注入 querier：无样本，异常恒 0")
	assert.NotContains(t, []int{sumCatRes, sumCatMon}, s.ProbeTargetCount, "拨测不进资源台账")

	// —— 决策 93：probe_targets 拨测目标明细 ——
	require.Len(t, s.ProbeTargets, 3, "blackbox 目标明细条数")
	// url：无显式 URL 时 protocol+target 拼接；有 URL 时优先取 URL。
	assert.Equal(t, "http://10.0.0.1:80", s.ProbeTargets[0].URL)
	assert.Equal(t, "http://10.0.0.2:80", s.ProbeTargets[1].URL)
	assert.Equal(t, "https://10.0.0.3:443/healthz", s.ProbeTargets[2].URL)
	// status 不得臆造：无实时拨测样本，每条恒为空串（前端显示「未知」），禁硬编 up/down。
	for _, p := range s.ProbeTargets {
		assert.Empty(t, p.Status, "无实时拨测样本，status 必须为空串而非臆造的 up/down")
	}
	// 归属口径（probe-ownership-alignment）：拨测目标不承载「应用 / 业务域」维度，
	// 归属取自 ScrapeJob.NetworkDomainID（not null）→ network_domains.name。
	// blackbox Job 归属 default → 展示名「管理网域」。
	// last_probe_at：未注入 querier，无最近拨测时间源，恒为 nil。
	for _, p := range s.ProbeTargets {
		assert.Equal(t, "default", p.NetworkDomainID)
		assert.Equal(t, "管理网域", p.NetworkDomainName)
		assert.Nil(t, p.LastProbeAt)
	}
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

	// 空库下分组聚合字段同样为零值：五类固定齐全（全 0）、by_app 空、拨测 0。
	require.Len(t, s.ByCategory, 5, "空库仍返回五类 0 值条目")
	for _, c := range s.ByCategory {
		assert.Equal(t, 0, c.ResourceCount)
		assert.Equal(t, 0, c.MonitoredCount)
		assert.NotNil(t, c.BySubtype)
		assert.Empty(t, c.BySubtype)
	}
	assert.NotNil(t, s.ByApp)
	assert.Empty(t, s.ByApp)
	assert.Equal(t, 0, s.UnclassifiedResourceCount)
	assert.Equal(t, 0, s.UnclassifiedMonitoredCount)
	assert.Equal(t, 0, s.ProbeTargetCount)
	assert.Equal(t, 0, s.ProbeTargetAbnormalCount)

	// probe_targets：空库下为空数组而非 nil，避免 JSON 输出 null。
	assert.NotNil(t, s.ProbeTargets)
	assert.Empty(t, s.ProbeTargets)
	raw, rawErr := json.Marshal(s.ProbeTargets)
	require.NoError(t, rawErr)
	assert.Equal(t, "[]", string(raw))

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

// fakeProbeQuerier 是 ProbeQuerier 的测试替身（F-13）。
type fakeProbeQuerier struct {
	index map[string]map[string]ProbeSample
	err   error
}

func (f *fakeProbeQuerier) ProbeSuccess(context.Context) (map[string]map[string]ProbeSample, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.index, nil
}

// TestSummaryProbeTargetsWithRealtimeStatus 覆盖 F-13：注入拨测查询器后，
// probe_status / last_probe_at / probe_target_abnormal_count 由 probe_success 填充。
func TestSummaryProbeTargetsWithRealtimeStatus(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	upAt := time.Date(2026, 9, 21, 18, 0, 0, 0, time.UTC)
	downAt := time.Date(2026, 9, 21, 18, 1, 0, 0, time.UTC)
	q := &fakeProbeQuerier{index: map[string]map[string]ProbeSample{
		"job-blackbox-a": {
			"http://10.0.0.1:80":           {Success: true, At: upAt},
			"http://10.0.0.2:80":           {Success: false, At: downAt},
			"https://10.0.0.3:443/healthz": {Success: true, At: upAt},
		},
	}}

	s, err := Build(db, WithProbeQuerier(q))
	require.NoError(t, err)
	require.Len(t, s.ProbeTargets, 3)

	assert.Equal(t, "up", s.ProbeTargets[0].Status, "probe_success=1 → up")
	require.NotNil(t, s.ProbeTargets[0].LastProbeAt)
	assert.True(t, s.ProbeTargets[0].LastProbeAt.Equal(upAt))

	assert.Equal(t, "down", s.ProbeTargets[1].Status, "probe_success=0 → down")
	assert.Equal(t, "up", s.ProbeTargets[2].Status, "URL 优先匹配（含协议头形态）")

	assert.Equal(t, 1, s.ProbeTargetAbnormalCount, "异常数 = probe_success=0 条数")
	assert.Equal(t, 3, s.ProbeTargetCount)
}

// TestSummaryProbeTargetsUnknownWhenNoSample 覆盖 F-13：无样本（未下发 / 指标未回传）
// 保持「未知」，且不计入异常。
func TestSummaryProbeTargetsUnknownWhenNoSample(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	q := &fakeProbeQuerier{index: map[string]map[string]ProbeSample{
		"job-blackbox-a": {"http://10.0.0.1:80": {Success: true, At: time.Now()}},
	}}

	s, err := Build(db, WithProbeQuerier(q))
	require.NoError(t, err)
	require.Len(t, s.ProbeTargets, 3)

	assert.Equal(t, "up", s.ProbeTargets[0].Status)
	assert.Equal(t, "", s.ProbeTargets[1].Status, "无样本 → 未知")
	assert.Nil(t, s.ProbeTargets[1].LastProbeAt)
	assert.Equal(t, "", s.ProbeTargets[2].Status)
	assert.Equal(t, 0, s.ProbeTargetAbnormalCount, "未知不计入异常")
}

// TestSummaryProbeTargetsDegradesOnQueryError 覆盖 F-13 降级：拨测查询失败时
// 聚合接口不失败，拨测字段回落「未知」。
func TestSummaryProbeTargetsDegradesOnQueryError(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	s, err := Build(db, WithProbeQuerier(&fakeProbeQuerier{err: errors.New("prometheus unreachable")}))
	require.NoError(t, err, "查询失败不应使聚合接口失败")
	require.Len(t, s.ProbeTargets, 3)
	for _, p := range s.ProbeTargets {
		assert.Equal(t, "", p.Status)
		assert.Nil(t, p.LastProbeAt)
	}
	assert.Equal(t, 0, s.ProbeTargetAbnormalCount)
}

// TestLookupProbeSampleFallsBackToRawTarget 覆盖 F-13 匹配回落：
// instance 为裸 target（无协议头）时按 protocol+target 拼接形态匹配。
func TestLookupProbeSampleFallsBackToRawTarget(t *testing.T) {
	index := map[string]map[string]ProbeSample{
		"job-blackbox-a": {"10.0.0.3:443": {Success: true, At: time.Now()}},
	}
	tgt := models.BlackboxTarget{
		Target:   "10.0.0.3:443",
		Protocol: models.BlackboxTargetProtocolHTTPS,
		URL:      "https://10.0.0.3:443/healthz",
	}
	sample, ok := lookupProbeSample(index, "job-blackbox-a", tgt)
	require.True(t, ok, "应回落到裸 target 匹配")
	assert.True(t, sample.Success)
}

// TestLookupProbeSampleNilIndex 覆盖 F-13：未注入查询器时（index 为 nil）不 panic、不匹配。
func TestLookupProbeSampleNilIndex(t *testing.T) {
	_, ok := lookupProbeSample(nil, "job-blackbox-a", models.BlackboxTarget{Target: "10.0.0.1:80"})
	assert.False(t, ok)
}
