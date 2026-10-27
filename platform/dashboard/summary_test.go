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
		&models.InterfaceService{},
		&models.ScrapeJob{},
		&models.ConfigDraft{},
		&models.ConfigVersion{},
		&models.ConfigDeployment{},
		// 决策 92：by_app 的 app_name 展示名 join 应用字典
		&models.ApplicationDict{},
		// 决策 92/93/95：by_app 的 biz_name 展示名 join 业务字典
		&models.BusinessDomain{},
		// 拨测目标应用服务分区：平台字典 + 应用↔平台 M:N 关系（platform_names）
		&models.PlatformDict{},
		&models.AppPlatformRel{},
		// by_cloud 的 cloud_name 展示名 join 云字典（M06 决策 103 scheme-B 派生链末环）
		&models.CloudDict{},
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

	// 15 个资源，覆盖六类 + 应用归属（含未归类）+ 子类，用于分组聚合不变量断言：
	//   host(3): Image=linux/linux/windows；AppCode=app/app/""（未归类）；BizCode=pay/ops/infra
	//   database(2): DatabaseType=mysql/redis；AppName=db/db；BizCode=infra/infra
	//   middleware(2): MiddlewareType=nginx/kafka；AppName=app/""（未归类）；BizCode=pay/infra
	//   application(2): AppName=appsvc/""（未归类）；无子类；BizCode=infra/infra
	//   generic_target(3): ExporterType=snmp_exporter/snmp_exporter/http_exporter；AppName=gt/gt/""（未归类）；BizCode=infra/infra/infra
	//   interface_service(3): AppCode=""（未归类）；BizCode=infra；无子类
	// → resource_count=15，未归类(app 空)=7，app 非空=8。
	// 业务域多数归因（决策 92/93/95）：app 下 3 资源 biz=pay×2 + ops×1 → BizCode=pay；
	// db/appsvc/gt 全量 biz=infra → BizCode=infra。
	for _, m := range []interface{}{
		&models.Host{
			ResourceID: "res-host-1", ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "pay", SourceType: models.SourceTypeManual,
			AppCode: "app", EnvFlag: "PRD", SubAppCode: "cluster", InstanceName: "web-01",
			ServerID: "srv-host-1", Status: "online", Image: "linux",
		},
		&models.Host{
			ResourceID: "res-host-2", ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "ops", SourceType: models.SourceTypeManual,
			AppCode: "app", EnvFlag: "PRD", SubAppCode: "cluster", InstanceName: "web-02",
			ServerID: "srv-host-2", Status: "online", Image: "windows",
		},
		&models.Host{
			ResourceID: "res-host-3", ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppCode: "", EnvFlag: "PRD", SubAppCode: "cluster", InstanceName: "web-03",
			ServerID: "srv-host-3", Status: "online", Image: "linux",
		},
		&models.Database{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-db-1", ResourceCategory: models.ResourceCategoryDatabase,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("db"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
			},
			DatabaseType: "mysql", InstanceIP: "10.0.0.1", Port: 3306,
		},
		&models.Database{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-db-2", ResourceCategory: models.ResourceCategoryDatabase,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("db"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
			},
			DatabaseType: "redis", InstanceIP: "10.0.0.2", Port: 6379,
		},
		&models.Middleware{
			ResourceID: "res-mw-1", ResourceCategory: models.ResourceCategoryMiddleware,
			NetworkDomainID: "default", BizCode: "pay", SourceType: models.SourceTypeManual,
			AppName: "app", Env: "PRD", Cluster: "cluster", Status: "online",
			MiddlewareType: "nginx", InstanceIP: "10.0.0.3", Port: 80,
		},
		&models.Middleware{
			ResourceID: "res-mw-2", ResourceCategory: models.ResourceCategoryMiddleware,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: "", Env: "PRD", Cluster: "cluster", Status: "online",
			MiddlewareType: "kafka", InstanceIP: "10.0.0.4", Port: 9092,
		},
		&models.Application{
			ResourceID: "res-app-1", ResourceCategory: models.ResourceCategoryApplication,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: "appsvc", Env: "PRD", Cluster: "cluster", Status: "online",
			ServiceName: "order-svc", HealthCheckURL: "http://10.0.0.5/health", Protocol: "http", Port: 8080,
		},
		&models.Application{
			ResourceID: "res-app-2", ResourceCategory: models.ResourceCategoryApplication,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: "", Env: "PRD", Cluster: "cluster", Status: "online",
			ServiceName: "pay-svc", HealthCheckURL: "http://10.0.0.6/health", Protocol: "http", Port: 8081,
		},
		&models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-gt-1", ResourceCategory: models.ResourceCategoryGenericTarget,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("gt"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
			},
			TargetName: "snmp-1", InstanceIP: "10.0.0.7", Port: 161, ExporterType: "snmp_exporter",
		},
		&models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-gt-2", ResourceCategory: models.ResourceCategoryGenericTarget,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr("gt"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
			},
			TargetName: "snmp-2", InstanceIP: "10.0.0.8", Port: 161, ExporterType: "snmp_exporter",
		},
		&models.GenericTarget{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-gt-3", ResourceCategory: models.ResourceCategoryGenericTarget,
				NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
				AppName: strPtr(""), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
			},
			TargetName: "http-1", InstanceIP: "10.0.0.9", Port: 9115, ExporterType: "http_exporter",
		},
		// 接口服务（第 6 类，拨测资源模式的目标源）：app_code 空（未归类）。
		&models.InterfaceService{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-is-1", ResourceCategory: models.ResourceCategoryInterfaceService,
				NetworkDomainID: "default", BizCode: "infra", Env: "PRD", Status: "online",
				SourceType: models.SourceTypeManual,
			},
			APIName: "订单查询", APIURL: "https://api.example.com/order/health",
			ResourceType: models.ResourceTypeInterfaceService,
		},
		&models.InterfaceService{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-is-2", ResourceCategory: models.ResourceCategoryInterfaceService,
				NetworkDomainID: "default", BizCode: "infra", Env: "PRD", Status: "online",
				SourceType: models.SourceTypeManual,
			},
			APIName: "支付回调", APIURL: "https://api.example.com/pay/health",
			ResourceType: models.ResourceTypeInterfaceService,
		},
		&models.InterfaceService{
			ResourceBase: models.ResourceBase{
				ResourceID: "res-is-3", ResourceCategory: models.ResourceCategoryInterfaceService,
				NetworkDomainID: "default", BizCode: "infra", Env: "PRD", Status: "online",
				SourceType: models.SourceTypeManual,
			},
			APIName: "用户查询", APIURL: "https://api.example.com/user/health",
			ResourceType: models.ResourceTypeInterfaceService,
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
//     res-gt-1（去重）；
//   - draft 状态、enabled=false 的标准 Job 选中的资源不得计入；
//   - blackbox Job（资源模式）选中 3 个 interface_service 资源，其拨测目标由 api_url 派生；
//     H9：黑盒资源模式的选择**计入 monitored**（与覆盖率口径一致）；
//   - 未软删 Job 共 5 个，其中 enabled=true 4 个。
func seedScrapeJobs(t *testing.T, db *gorm.DB) {
	t.Helper()

	jobs := []models.ScrapeJob{
		newJob("job-standard-a", models.JobTypeStandard, "ready", true, []string{"res-host-1", "res-host-2", "res-db-1"}),
		newJob("job-standard-b", models.JobTypeStandard, "ready", true, []string{"res-mw-1", "res-app-1", "res-gt-1"}),
		newJob("job-standard-c", models.JobTypeStandard, "draft", true, []string{"res-host-3"}),
		newJob("job-standard-d", models.JobTypeStandard, "ready", false, []string{"res-db-2"}),
		newJob("job-blackbox-a", models.JobTypeBlackbox, "ready", true, []string{"res-is-1", "res-is-2", "res-is-3"}),
		newJob("job-blackbox-draft", models.JobTypeBlackbox, "draft", true, []string{"res-is-1", "res-is-2", "res-is-3"}),
		newJob("job-blackbox-disabled", models.JobTypeBlackbox, "ready", false, []string{"res-is-1", "res-is-2", "res-is-3"}),
	}
	// 拨测目标改走资源选择：blackbox Job 通过 selected_instance_ids 选择接口服务资源，
	// 地址取所选资源的 api_url（不再手填 blackbox_targets）。draft/disabled 不得计入。
	jobs[4].ResourceType = models.ResourceTypeInterfaceService
	jobs[5].ResourceType = models.ResourceTypeInterfaceService
	jobs[6].ResourceType = models.ResourceTypeInterfaceService
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

	assert.Equal(t, 15, s.ResourceCount, "六类资源合计")
	assert.Equal(t, 2, s.PendingDraftCount)
	assert.Equal(t, 1, s.DomainCount, "仅 default 网域已纳管")

	// 已监控：ready+enabled Job 覆盖 9 个资源——标准 Job 6 个（host-1/2、db-1、mw-1、
	// app-1、gt-1）+ 拨测资源模式 3 个接口服务（H9 统一口径）。draft / disabled / 软删
	// Job 均不计入。
	assert.Equal(t, 9, s.MonitoredCount)
	assert.LessOrEqual(t, s.MonitoredCount, s.ResourceCount, "已监控不得超过资源总数")

	// —— 决策 91 分组聚合不变量（验收红线）——
	// 不变量 1 & 2：sum(by_category) == 全局 resource/monitored。
	var sumCatRes, sumCatMon int
	for _, c := range s.ByCategory {
		sumCatRes += c.ResourceCount
		sumCatMon += c.MonitoredCount
		// 子类合计应等于该类合计（application / interface_service 不设子类，
		// by_subtype 恒为空数组，跳过）。
		if c.ResourceCategory == "application" || c.ResourceCategory == "interface_service" {
			assert.Empty(t, c.BySubtype, "%s 不设子类", c.ResourceCategory)
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
	assert.Equal(t, 7, s.UnclassifiedResourceCount, "未归类资源数（app_code 空，含 3 个接口服务）")
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

	// 六类固定齐全且 application 不拆子类。
	require.Len(t, s.ByCategory, 6, "by_category 六类固定齐全")
	catByKey := make(map[string]CategorySummary)
	for _, c := range s.ByCategory {
		catByKey[c.ResourceCategory] = c
	}
	// application by_subtype 必须为空数组。
	assert.Empty(t, catByKey["application"].BySubtype, "application 不设子类")
	// host 子类 linux=2/windows=1；database mysql=1/redis=1；middleware nginx=1/kafka=1；
	// generic_target snmp_exporter=2/http_exporter=1；interface_service 不拆子类。
	assert.Equal(t, 3, catByKey["host"].ResourceCount)
	assert.Equal(t, 2, catByKey["host"].MonitoredCount)
	assert.Equal(t, 2, catByKey["database"].ResourceCount)
	assert.Equal(t, 1, catByKey["database"].MonitoredCount)
	assert.Equal(t, 2, catByKey["middleware"].ResourceCount)
	assert.Equal(t, 2, catByKey["application"].ResourceCount)
	// 接口服务：3 个资源全部被拨测资源模式选中（H9：计入 monitored）；不拆子类。
	assert.Equal(t, 3, catByKey["interface_service"].ResourceCount)
	assert.Equal(t, 3, catByKey["interface_service"].MonitoredCount)
	assert.Empty(t, catByKey["interface_service"].BySubtype, "interface_service 不设子类")

	// 拨测目标（api_url 派生）独立统计；未注入 querier 时 abnormal 恒 0。
	assert.Equal(t, 3, s.ProbeTargetCount, "blackbox 目标数")
	assert.Equal(t, 0, s.ProbeTargetAbnormalCount, "未注入 querier：无样本，异常恒 0")

	// —— 决策 93：probe_targets 拨测目标明细 ——
	require.Len(t, s.ProbeTargets, 3, "blackbox 目标明细条数")
	// url：资源模式下即所选接口服务资源的 api_url。
	assert.Equal(t, "https://api.example.com/order/health", s.ProbeTargets[0].URL)
	assert.Equal(t, "https://api.example.com/pay/health", s.ProbeTargets[1].URL)
	assert.Equal(t, "https://api.example.com/user/health", s.ProbeTargets[2].URL)
	// service_name：同源于所选接口服务资源的 api_name（首页关键识别信息）。
	assert.Equal(t, "订单查询", s.ProbeTargets[0].ServiceName)
	assert.Equal(t, "支付回调", s.ProbeTargets[1].ServiceName)
	assert.Equal(t, "用户查询", s.ProbeTargets[2].ServiceName)
	// status 不得臆造：无实时拨测样本，每条恒为空串（前端显示「未知」），禁硬编 up/down。
	for _, p := range s.ProbeTargets {
		assert.Empty(t, p.Status, "无实时拨测样本，status 必须为空串而非臆造的 up/down")
	}
	// 归属：拨测目标以「归属网域」承载归属（ScrapeJob.NetworkDomainID，not null）
	// → network_domains.name。blackbox Job 归属 default → 展示名「管理网域」。
	// last_probe_at：未注入 querier，无最近拨测时间源，恒为 nil。
	for _, p := range s.ProbeTargets {
		assert.Equal(t, "default", p.NetworkDomainID)
		assert.Equal(t, "管理网域", p.NetworkDomainName)
		assert.Nil(t, p.LastProbeAt)
	}
	// 采集 Job 总数包含草稿/禁用项；探活目标只含 ready+enabled blackbox Job。
	assert.Equal(t, 7, s.ScrapeJobCount)
	assert.Equal(t, 5, s.ScrapeJobEnabledCount)

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

	// 空库下分组聚合字段同样为零值：六类固定齐全（全 0）、by_app 空、拨测 0。
	require.Len(t, s.ByCategory, 6, "空库仍返回六类 0 值条目")
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
		EnvFlag: "PRD",
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
			"https://api.example.com/order/health": {Success: true, At: upAt},
			"https://api.example.com/pay/health":   {Success: false, At: downAt},
			"https://api.example.com/user/health":  {Success: true, At: upAt},
		},
	}}

	s, err := Build(db, WithProbeQuerier(q))
	require.NoError(t, err)
	require.Len(t, s.ProbeTargets, 3)

	assert.Equal(t, "up", s.ProbeTargets[0].Status, "probe_success=1 → up")
	require.NotNil(t, s.ProbeTargets[0].LastProbeAt)
	assert.True(t, s.ProbeTargets[0].LastProbeAt.Equal(upAt))

	assert.Equal(t, "down", s.ProbeTargets[1].Status, "probe_success=0 → down")
	assert.Equal(t, "up", s.ProbeTargets[2].Status, "probe_success=1 → up")

	assert.Equal(t, 1, s.ProbeTargetAbnormalCount, "异常数 = probe_success=0 条数")
	assert.Equal(t, 3, s.ProbeTargetCount)
}

// TestSummaryProbeTargetsUnknownWhenNoSample 覆盖 F-13：无样本（未下发 / 指标未回传）
// 保持「未知」，且不计入异常。
func TestSummaryProbeTargetsUnknownWhenNoSample(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	q := &fakeProbeQuerier{index: map[string]map[string]ProbeSample{
		"job-blackbox-a": {"https://api.example.com/order/health": {Success: true, At: time.Now()}},
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

// TestSummaryProbeTargetsCoversBothCategories 覆盖拨测的两类对象（
// models.BlackboxProbeCategories）：接口服务（偏业务，api_url / api_name）与
// 应用服务（偏平台，health_check_url / **应用字典中文名** + 所属平台）。两类都必须
// 出现在 probe_targets 里并带 resource_category，供前端分区展示——早前只查接口服务表，
// 会让应用服务拨测目标整体缺失。
func TestSummaryProbeTargetsCoversBothCategories(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	// 应用字典：app_code=appsvc → 中文展示名「大模型应用」。应用服务拨测的服务名取
	// 这个中文名而非 service_name 实例名（order-svc）：多个模型服务实例同属一个应用时，
	// 领导视角关心的是该应用整体的拨测情况。
	require.NoError(t, db.Create(&models.ApplicationDict{
		AppCode: "appsvc", AppName: "大模型应用", Status: models.AppStatusEnabled,
	}).Error)
	// 平台字典 + 应用↔平台 M:N：appsvc 同时部署在 paas-a / paas-b 两个平台。
	require.NoError(t, db.Create(&models.PlatformDict{
		PlatformCode: "paas-b", PlatformName: "私有云B平台", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.PlatformDict{
		PlatformCode: "paas-a", PlatformName: "私有云A平台", Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.AppPlatformRel{
		AppCode: "appsvc", PlatformCode: "paas-b", IsPrimary: true,
	}).Error)
	require.NoError(t, db.Create(&models.AppPlatformRel{
		AppCode: "appsvc", PlatformCode: "paas-a",
	}).Error)

	// 追加一个应用服务拨测任务：选中已有应用资源 res-app-1（health_check_url
	// = http://10.0.0.5/health，app_code = appsvc）。
	appJob := newJob("job-blackbox-app", models.JobTypeBlackbox, "ready", true, []string{"res-app-1"})
	appJob.ResourceType = models.ResourceTypeApplication
	require.NoError(t, db.Create(&appJob).Error)

	upAt := time.Date(2026, 9, 21, 18, 0, 0, 0, time.UTC)
	q := &fakeProbeQuerier{index: map[string]map[string]ProbeSample{
		"job-blackbox-a": {
			"https://api.example.com/order/health": {Success: true, At: upAt},
			"https://api.example.com/pay/health":   {Success: false, At: upAt},
			"https://api.example.com/user/health":  {Success: true, At: upAt},
		},
		"job-blackbox-app": {
			"http://10.0.0.5/health": {Success: true, At: upAt},
		},
	}}

	s, err := Build(db, WithProbeQuerier(q))
	require.NoError(t, err)
	require.Len(t, s.ProbeTargets, 4, "接口服务 3 + 应用服务 1")
	assert.Equal(t, 4, s.ProbeTargetCount)

	// 按类别取首条（同类别有多条，后续按 URL 定位其余条目）。
	byCat := make(map[string]ProbeTargetItem, len(s.ProbeTargets))
	for _, p := range s.ProbeTargets {
		if _, seen := byCat[p.ResourceCategory]; !seen {
			byCat[p.ResourceCategory] = p
		}
	}

	// 接口服务：地址取 api_url、服务名取 api_name；无平台字段（恒空串）。
	iface := byCat[string(models.ResourceCategoryInterfaceService)]
	assert.Equal(t, "https://api.example.com/order/health", iface.URL)
	assert.Equal(t, "订单查询", iface.ServiceName)
	assert.Empty(t, iface.PlatformNames, "接口服务不体现平台")
	assert.Equal(t, "up", iface.Status)

	// 应用服务：地址取 health_check_url；服务名取应用字典中文名（不是 service_name
	// 实例名 order-svc），并带出应用↔平台 M:N 的全部关联平台（按展示名排序）。
	app := byCat[string(models.ResourceCategoryApplication)]
	assert.Equal(t, "http://10.0.0.5/health", app.URL, "应用服务拨测地址取 health_check_url")
	assert.Equal(t, "大模型应用", app.ServiceName, "应用服务拨测服务名取应用字典中文名")
	assert.Equal(t, "私有云A平台、私有云B平台", app.PlatformNames, "多平台全部列出（排序后「、」连接）")
	assert.Equal(t, "up", app.Status)
}

// TestSummaryProbeTargetAppFallsBackToCodes 覆盖展示名/平台的回落口径（不编造）：
//   - 应用字典缺条目 → 服务名回落 app_code（不是空串、也不是 service_name 实例名）；
//   - 无应用↔平台关联 → 平台回落资源行 platform_code；平台字典缺条目再回落编码。
func TestSummaryProbeTargetAppFallsBackToCodes(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	// res-app-1 无 M:N 关联；应用字典与平台字典均无条目 → 全链路回落编码。
	require.NoError(t, db.Model(&models.Application{}).
		Where("resource_id = ?", "res-app-1").
		Update("platform_code", "paas-x").Error)

	appJob := newJob("job-blackbox-app", models.JobTypeBlackbox, "ready", true, []string{"res-app-1"})
	appJob.ResourceType = models.ResourceTypeApplication
	require.NoError(t, db.Create(&appJob).Error)

	s, err := Build(db)
	require.NoError(t, err)

	var appItem *ProbeTargetItem
	for i := range s.ProbeTargets {
		if s.ProbeTargets[i].ResourceCategory == string(models.ResourceCategoryApplication) {
			appItem = &s.ProbeTargets[i]
			break
		}
	}
	require.NotNil(t, appItem, "应用服务拨测目标应存在")
	assert.Equal(t, "appsvc", appItem.ServiceName, "应用字典缺条目时服务名回落 app_code")
	assert.Equal(t, "paas-x", appItem.PlatformNames, "无关联且字典缺条目时平台回落 platform_code")
}

// TestLookupProbeSampleMatchesAddress：拨测资源模式下按 api_url（probe_success 的
// instance 标签 = 目标地址）精确匹配；地址不符不命中。
func TestLookupProbeSampleMatchesAddress(t *testing.T) {
	index := map[string]map[string]ProbeSample{
		"job-blackbox-a": {"https://api.example.com/order/health": {Success: true, At: time.Now()}},
	}
	sample, ok := lookupProbeSample(index, "job-blackbox-a", "https://api.example.com/order/health")
	require.True(t, ok)
	assert.True(t, sample.Success)

	_, ok = lookupProbeSample(index, "job-blackbox-a", "https://api.example.com/other")
	assert.False(t, ok, "地址不一致不命中")
}

// TestLookupProbeSampleNilIndex 覆盖 F-13：未注入查询器时（index 为 nil）不 panic、不匹配。
func TestLookupProbeSampleNilIndex(t *testing.T) {
	_, ok := lookupProbeSample(nil, "job-blackbox-a", "https://api.example.com/order/health")
	assert.False(t, ok)
}

// TestResourceModelsAlignWithValidCategories 是 H1 护栏：dashboard.resourceModels()
// 与 models.ValidResourceCategories() 必须等长且逐项类别一致——Build 按**下标**把
// 两者对齐取值（cat := models.ValidResourceCategories()[i]），两处不同序追加会让
// 资源被归入错误类别且不报错（静默错误）。新增类别时必须两处同序追加到末尾。
func TestResourceModelsAlignWithValidCategories(t *testing.T) {
	modelsList := resourceModels()
	cats := models.ValidResourceCategories()
	require.Len(t, modelsList, len(cats),
		"resourceModels() 与 ValidResourceCategories() 长度必须一致（新增类别须两处同序追加）")
	for i, cat := range cats {
		res, ok := modelsList[i].(models.Resource)
		require.True(t, ok, "resourceModels()[%d] (%T) 应实现 models.Resource", i, modelsList[i])
		assert.Equal(t, string(cat), string(res.GetResourceType()),
			"下标 %d 的模型类别必须与 ValidResourceCategories() 一致", i)
	}
}

// —— 反馈 11：「平台 × 应用 · 主机数」矩阵（by_platform_app）——

// seedMatrixHosts 构造反馈 11 矩阵的专用 fixture：7 台主机覆盖 5 个平台 + 未指定平台，
// 跨 3 个应用 + 未指定应用，并刻意让「paas-c」在平台字典缺条目、「app-c」在应用字典缺条目。
//
// 分布（platform_code → [(app_code, 台数)]）：
//
//	paas-a(字典:私有云A): app-a×3, app-b×2   → 5
//	paas-b(字典:私有云B): app-a×2, ""×1      → 3
//	paas-c(字典缺条目):   app-a×1            → 1
//	paas-d(字典:私有云D): app-b×1, ""×1      → 2
//	paas-e(字典:私有云E): app-c×1            → 1   ← 落选 → 并入「其他」
//	""(未指定平台):      app-a×1            → 1   ← 恒保留
//
// 合计 13 台。app-c 字典缺条目 → 回落编码；未指定应用列（app_code=""）恒保留。
func seedMatrixHosts(t *testing.T, db *gorm.DB) {
	t.Helper()
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID:          "default",
		Name:        "管理网域",
		DomainType:  models.DomainTypeManagement,
		Channel:     models.ChannelTypeLocal,
		Status:      models.DomainStatusEnabled,
		IsMonitored: true,
	}).Error)
	// 平台字典：paas-c 刻意缺条目（验证「回落编码、不臆造」）。
	for _, p := range []models.PlatformDict{
		{PlatformCode: "paas-a", PlatformName: "私有云A", Enabled: true},
		{PlatformCode: "paas-b", PlatformName: "私有云B", Enabled: true},
		{PlatformCode: "paas-d", PlatformName: "私有云D", Enabled: true},
		{PlatformCode: "paas-e", PlatformName: "私有云E", Enabled: true},
	} {
		require.NoError(t, db.Create(&p).Error)
	}
	// 应用字典：app-c 刻意缺条目（验证「回落编码、不臆造」）。
	for _, a := range []models.ApplicationDict{
		{AppCode: "app-a", AppName: "订单应用"},
		{AppCode: "app-b", AppName: "支付应用"},
	} {
		require.NoError(t, db.Create(&a).Error)
	}

	type hostSeed struct {
		id           string
		platformCode string
		appCode      string
	}
	seeds := []hostSeed{
		{"m-h1", "paas-a", "app-a"}, {"m-h2", "paas-a", "app-a"}, {"m-h3", "paas-a", "app-a"},
		{"m-h4", "paas-a", "app-b"}, {"m-h5", "paas-a", "app-b"},
		{"m-h6", "paas-b", "app-a"}, {"m-h7", "paas-b", "app-a"}, {"m-h8", "paas-b", ""},
		{"m-h9", "paas-c", "app-a"},
		{"m-h10", "paas-d", "app-b"}, {"m-h11", "paas-d", ""},
		{"m-h12", "paas-e", "app-c"},
		{"m-h13", "", "app-a"},
	}
	for i, hs := range seeds {
		require.NoError(t, db.Create(&models.Host{
			ResourceID: hs.id, ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			PlatformCode: hs.platformCode, AppCode: hs.appCode,
			EnvFlag: "PRD", SubAppCode: "cluster",
			InstanceName: fmt.Sprintf("node-%02d", i+1),
			ServerID:     fmt.Sprintf("srv-m-%02d", i+1),
			Status:       "online", Image: "linux",
		}).Error)
	}
	// 一条非 host 资源：即便 app_code / platform_code 与矩阵重叠，也不得进入矩阵
	//（矩阵只统计 host，拨测目标与其他资源类别一律不参与）。
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: "m-db-1", ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: strPtr("app-a"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
		},
		DatabaseType: "mysql", InstanceIP: "10.0.1.1", Port: 3306,
	}).Error)
}

// findPlatformRow 取指定 platform_code 的矩阵行（不存在返回 nil）。
func findPlatformRow(rows []PlatformAppSummary, code string) *PlatformAppSummary {
	for i := range rows {
		if rows[i].PlatformCode == code {
			return &rows[i]
		}
	}
	return nil
}

// TestSummaryByPlatformAppInvariants 覆盖反馈 11 §11.4 的四条不变量：
//  1. sum(各行 host_count) === sum(各列 host_count) === by_category 中 host 的 resource_count；
//  2. 「未指定平台」行 host_count === host 类中 platform_code 为空的资源数；
//  3. Top 4 + 「其他」的收敛不改变合计（各行之和恒等于 13 台主机）；
//  4. 字典缺条目时名称回落编码，不返回空串、不编造。
func TestSummaryByPlatformAppInvariants(t *testing.T) {
	db := newTestDB(t)
	seedMatrixHosts(t, db)

	s, err := Build(db)
	require.NoError(t, err)
	require.NotNil(t, s.ByPlatformApp, "by_platform_app 恒为非 nil slice（避免 JSON null）")

	// 不变量 1 & 3：行合计 === 列合计 === by_category 中 host 的 resource_count。
	hostTotal := 0
	for _, c := range s.ByCategory {
		if c.ResourceCategory == string(models.ResourceCategoryHost) {
			hostTotal = c.ResourceCount
		}
	}
	require.Equal(t, 13, hostTotal, "fixture 共 13 台主机")

	var rowSum, colSum int
	for _, row := range s.ByPlatformApp {
		rowSum += row.HostCount
		var cellSum int
		for _, cell := range row.Cells {
			cellSum += cell.HostCount
			assert.NotEmpty(t, cell.AppName, "app_name 不得为空串（字典缺条目时回落 app_code）")
			colSum += cell.HostCount
		}
		assert.Equal(t, row.HostCount, cellSum, "行 %s 的 host_count 恒等于其 cells 之和", row.PlatformCode)
		assert.NotEmpty(t, row.PlatformName, "platform_name 不得为空串")
	}
	assert.Equal(t, hostTotal, rowSum, "不变量1&3: 行合计 === 主机总数")
	assert.Equal(t, hostTotal, colSum, "不变量1: 列合计 === 主机总数")

	// 只统计 host：fixture 另有 1 条 database（app-a）不得进入矩阵。
	paasA := findPlatformRow(s.ByPlatformApp, "paas-a")
	require.NotNil(t, paasA)
	assert.Equal(t, 5, paasA.HostCount, "paas-a 5 台（database 不参与）")

	// 不变量 2：未指定平台行 host_count === host 中 platform_code 为空的资源数。
	unset := findPlatformRow(s.ByPlatformApp, "")
	require.NotNil(t, unset, "「未指定平台」行恒保留")
	assert.Equal(t, 1, unset.HostCount, "host 中 platform_code 为空恰 1 台（m-h13）")
	assert.Equal(t, platformAppUnsetName, unset.PlatformName)
	unsetCells := map[string]int{}
	for _, c := range unset.Cells {
		unsetCells[c.AppCode] = c.HostCount
	}
	assert.Equal(t, map[string]int{"app-a": 1}, unsetCells)

	// 不变量 4：平台字典缺条目 → 回落 platform_code 本身（paas-c），不空串、不编造。
	paasC := findPlatformRow(s.ByPlatformApp, "paas-c")
	require.NotNil(t, paasC)
	assert.Equal(t, "paas-c", paasC.PlatformName, "平台字典缺条目时回落编码")

	// 应用字典缺条目 → 回落 app_code 本身（app-c，仅出现在「其他」行）。
	assert.Equal(t, "其他", s.ByPlatformApp[len(s.ByPlatformApp)-2].PlatformName)
	other := findPlatformRow(s.ByPlatformApp, platformAppOtherCode)
	require.NotNil(t, other, "落选平台必须合并为「其他」行")
	assert.Equal(t, platformAppOtherName, other.PlatformName)
	require.Len(t, other.Cells, 1)
	assert.Equal(t, "app-c", other.Cells[0].AppCode)
	assert.Equal(t, "app-c", other.Cells[0].AppName, "应用字典缺条目时回落编码")
	assert.Equal(t, 1, other.Cells[0].HostCount)
}

// TestSummaryByPlatformAppTopNAndOther 覆盖反馈 11 §11.4 的 Top 4 收敛规则：
//   - 平台按主机台数降序取前 4 单独成行，其余合并为「其他」（合计不变）；
//   - 「未指定平台」不占用 Top N 名额（恒保留、恒在末位）；
//   - 单元格顺序按台数降序（并列按 app_code 字典序升序），输出确定性可测。
func TestSummaryByPlatformAppTopNAndOther(t *testing.T) {
	db := newTestDB(t)
	seedMatrixHosts(t, db)

	s, err := Build(db)
	require.NoError(t, err)

	// 5 个非空平台：paas-a(5) / paas-b(3) / paas-d(2) / paas-c(1) / paas-e(1)。
	// Top 4 = paas-a / paas-b / paas-d / paas-c；paas-e(1) 落选 → 「其他」。
	// 并列时（paas-c 与 paas-e 均为 1）按 platform_code 升序，paas-c 先、paas-e 后，
	// 故 paas-c 进 Top 4、paas-e 进「其他」。
	require.Len(t, s.ByPlatformApp, 6, "Top4 + 「其他」+ 「未指定平台」共 6 行")
	got := make([]string, 0, len(s.ByPlatformApp))
	for _, row := range s.ByPlatformApp {
		got = append(got, row.PlatformCode)
	}
	assert.Equal(t,
		[]string{"paas-a", "paas-b", "paas-d", "paas-c", platformAppOtherCode, ""},
		got, "行序：Top4 台数降序 →「其他」→「未指定平台」")

	// 各行台数：5 / 3 / 2 / 1 / 1 / 1，合计 13（收敛不改变合计）。
	assert.Equal(t, []int{5, 3, 2, 1, 1, 1},
		[]int{s.ByPlatformApp[0].HostCount, s.ByPlatformApp[1].HostCount,
			s.ByPlatformApp[2].HostCount, s.ByPlatformApp[3].HostCount,
			s.ByPlatformApp[4].HostCount, s.ByPlatformApp[5].HostCount})

	// 单元格顺序：台数降序；「未指定应用」列（app_code=""）按编码参与排序，不被丢弃。
	paasA := findPlatformRow(s.ByPlatformApp, "paas-a")
	require.NotNil(t, paasA)
	require.Len(t, paasA.Cells, 2)
	assert.Equal(t, "app-a", paasA.Cells[0].AppCode, "台数多者在前")
	assert.Equal(t, "订单应用", paasA.Cells[0].AppName, "字典命中")
	assert.Equal(t, 3, paasA.Cells[0].HostCount)
	assert.Equal(t, "app-b", paasA.Cells[1].AppCode)
	assert.Equal(t, 2, paasA.Cells[1].HostCount)

	paasB := findPlatformRow(s.ByPlatformApp, "paas-b")
	require.NotNil(t, paasB)
	require.Len(t, paasB.Cells, 2)
	assert.Equal(t, "app-a", paasB.Cells[0].AppCode, "2 > 1")
	assert.Equal(t, "", paasB.Cells[1].AppCode, "app_code 空 → 「未指定应用」列恒保留")
	assert.Equal(t, platformAppUnsetAppName, paasB.Cells[1].AppName)
	assert.Equal(t, 1, paasB.Cells[1].HostCount)
}

// TestSummaryByPlatformAppEmptyAndNoHost 覆盖边界：空库与「有资源但无 host」
// 都返回空 slice（非 nil、序列化不为 null），不 panic。
func TestSummaryByPlatformAppEmptyAndNoHost(t *testing.T) {
	// 1. 空库
	db := newTestDB(t)
	s, err := Build(db)
	require.NoError(t, err)
	assert.NotNil(t, s.ByPlatformApp)
	assert.Empty(t, s.ByPlatformApp, "空库返回空 slice")
	raw, err := json.Marshal(s.ByPlatformApp)
	require.NoError(t, err)
	assert.Equal(t, "[]", string(raw), "空库序列化为 [] 而非 null")

	// 2. 有非 host 资源但无 host：矩阵仍为空（只统计 host）
	db2 := newTestDB(t)
	require.NoError(t, db2.Create(&models.NetworkDomain{
		ID: "default", Name: "管理网域", DomainType: models.DomainTypeManagement,
		Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled, IsMonitored: true,
	}).Error)
	require.NoError(t, db2.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: "r-db-1", ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: strPtr("app-a"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
		},
		DatabaseType: "mysql", InstanceIP: "10.0.2.1", Port: 3306,
	}).Error)
	s2, err := Build(db2)
	require.NoError(t, err)
	assert.NotNil(t, s2.ByPlatformApp)
	assert.Empty(t, s2.ByPlatformApp, "无 host 资源时矩阵为空")
}

// TestSummaryByPlatformAppWithSeedFixture 在既有 seed fixture 上验证不破坏既有口径：
// 3 台主机的 platform_code 全为空（seed 未设 PlatformCode）、AppCode 为 app/app/""，
// 故矩阵恰有 1 行「未指定平台」，行内 app=2 台 + 未指定应用=1 台。
func TestSummaryByPlatformAppWithSeedFixture(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	s, err := Build(db)
	require.NoError(t, err)
	require.Len(t, s.ByPlatformApp, 1, "seed 的 3 台主机 platform_code 全空 → 仅「未指定平台」行")
	row := s.ByPlatformApp[0]
	assert.Equal(t, "", row.PlatformCode)
	assert.Equal(t, platformAppUnsetName, row.PlatformName)
	assert.Equal(t, 3, row.HostCount)
	require.Len(t, row.Cells, 2)
	assert.Equal(t, "app", row.Cells[0].AppCode, "2 > 1，台数多者在前")
	assert.Equal(t, 2, row.Cells[0].HostCount)
	assert.Equal(t, "", row.Cells[1].AppCode)
	assert.Equal(t, platformAppUnsetAppName, row.Cells[1].AppName)
	assert.Equal(t, 1, row.Cells[1].HostCount)
}

// TestPlatformAppOtherCodeDoesNotCollide 护栏：「其他」行的约定编码不得与任何真实平台
// 编码碰撞——models.ValidPlatformCode 的正则不含下划线，故 "__other__" 永非法，
// 前端可据此判定「该行不可点击下钻」。
func TestPlatformAppOtherCodeDoesNotCollide(t *testing.T) {
	assert.Equal(t, "__other__", platformAppOtherCode)
	assert.False(t, models.ValidPlatformCode.MatchString(platformAppOtherCode),
		"「其他」约定编码必须不符合平台编码规范，从语法上排除与真实平台碰撞的可能")
}

// —— by_cloud：按云 · 主机台数（M06 决策 103 scheme-B 派生链）——

// seedCloudHosts 构造 by_cloud 的专用 fixture：11 台主机跨 4 个云编码 + 「未指定云」，
// 覆盖「多云分布 / 网域记录缺失 / 网域未登记 cloud_code / 云字典缺条目」四类场景。
//
// 云字典（cloud_dict）：
//
//	PUB-TX → 腾讯云          （有字典条目）
//	GM-CU  → 政务云（联通）  （有字典条目）
//	IND-XX → 刻意缺条目     （验证「回落编码、不臆造、不返回空串」）
//
// 网域（network_domains，cloud_code 为 cloud 标签权威来源）：
//
//	dom-tx      → PUB-TX
//	dom-gm      → GM-CU
//	dom-ind     → IND-XX（字典缺条目）
//	dom-nocloud → ""（网域存在但未登记 cloud_code）
//	（dom-ghost 故意不建记录 → 网域缺失）
//
// 主机分布（network_domain_id → 台数）：
//
//	dom-tx      → 4 台   ← 最多，排序应在首位
//	dom-gm      → 3 台
//	dom-ind     → 1 台
//	dom-nocloud → 2 台   ┐ 两者合并成「未指定云」行
//	dom-ghost   → 1 台   ┘
//
// 合计 11 台。刻意在 dom-tx 上放 1 台带残留 CloudCode 列值（GHOST-CODE）的主机，
// 验证派生链**不读**该残留列（决策 103 scheme-B 红线）。
func seedCloudHosts(t *testing.T, db *gorm.DB) {
	t.Helper()
	for _, d := range []models.NetworkDomain{
		{ID: "dom-tx", Name: "腾讯云网域", DomainType: models.DomainTypeManagement,
			Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled,
			IsMonitored: true, CloudCode: "PUB-TX"},
		{ID: "dom-gm", Name: "政务云网域", DomainType: models.DomainTypeManagement,
			Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled,
			IsMonitored: true, CloudCode: "GM-CU"},
		{ID: "dom-ind", Name: "行业云网域", DomainType: models.DomainTypeManagement,
			Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled,
			IsMonitored: false, CloudCode: "IND-XX"},
		{ID: "dom-nocloud", Name: "未登记云网域", DomainType: models.DomainTypeEdge,
			Channel: models.ChannelTypeAgentPull, Status: models.DomainStatusEnabled,
			IsMonitored: true},
	} {
		require.NoError(t, db.Create(&d).Error)
	}
	// 云字典：IND-XX 刻意缺条目。CloudType / Carrier 只作描述性元数据，与分组无关。
	for _, c := range []models.CloudDict{
		{CloudCode: "PUB-TX", CloudName: "腾讯云", CloudType: models.CloudTypePublic,
			Carrier: models.CloudCarrierTencent, Enabled: true},
		{CloudCode: "GM-CU", CloudName: "政务云（联通）", CloudType: models.CloudTypeGovernment,
			Carrier: models.CloudCarrierUnicom, Enabled: true},
	} {
		require.NoError(t, db.Create(&c).Error)
	}

	type hostSeed struct {
		id        string
		domainID  string
		cloudCode string // 写入残留列，仅用于证明派生链不读它
	}
	seeds := []hostSeed{
		{"c-h1", "dom-tx", ""}, {"c-h2", "dom-tx", ""}, {"c-h3", "dom-tx", ""},
		{"c-h4", "dom-tx", "GHOST-CODE"}, // 残留列有值 → by_cloud 仍须归 PUB-TX
		{"c-h5", "dom-gm", ""}, {"c-h6", "dom-gm", ""}, {"c-h7", "dom-gm", ""},
		{"c-h8", "dom-ind", ""},
		{"c-h9", "dom-nocloud", ""}, {"c-h10", "dom-nocloud", ""},
		{"c-h11", "dom-ghost", ""}, // 网域记录缺失 → 「未指定云」
	}
	for i, hs := range seeds {
		require.NoError(t, db.Create(&models.Host{
			ResourceID: hs.id, ResourceCategory: models.ResourceCategoryHost,
			NetworkDomainID: hs.domainID, BizCode: "infra", SourceType: models.SourceTypeManual,
			CloudCode: hs.cloudCode, EnvFlag: "PRD", SubAppCode: "cluster",
			InstanceName: fmt.Sprintf("cn-%02d", i+1),
			ServerID:     fmt.Sprintf("srv-c-%02d", i+1),
			Status:       "online", Image: "linux",
		}).Error)
	}

	// 已下发（ready+enabled）精确 fixture：命中 5 台主机 + 1 台数据库。
	//   - c-h1 / c-h2（dom-tx）→ PUB-TX monitored=2
	//   - c-h5（dom-gm）→ GM-CU monitored=1
	//   - c-h8（dom-ind）→ IND-XX monitored=1
	//   - c-h11（网域缺失）→ 「未指定云」monitored=1
	//   - c-db-1（database）→ 计入全局 monitored_count，但**不进** by_cloud
	// 故 by_cloud 各行 monitored 之和 = 5，而全局 monitored_count = 6（两者刻意不同，
	// 防止测试误拿全局值当 host 已下发数比对）。
	require.NoError(t, db.Create(&models.Database{
		ResourceBase: models.ResourceBase{
			ResourceID: "c-db-1", ResourceCategory: models.ResourceCategoryDatabase,
			NetworkDomainID: "dom-tx", BizCode: "infra", SourceType: models.SourceTypeManual,
			AppName: strPtr("app-a"), Env: "PRD", Cluster: strPtr("cluster"), Status: "online",
		},
		DatabaseType: "mysql", InstanceIP: "10.0.3.1", Port: 3306,
	}).Error)
	job := newJob("job-cloud", models.JobTypeStandard, "ready", true,
		[]string{"c-h1", "c-h2", "c-h5", "c-h8", "c-h11", "c-db-1"})
	require.NoError(t, db.Create(&job).Error)
	// draft / disabled Job 选中的主机不得计入 by_cloud 的 monitored。
	draftJob := newJob("job-cloud-draft", models.JobTypeStandard, "draft", true, []string{"c-h3", "c-h6"})
	require.NoError(t, db.Create(&draftJob).Error)
	offJob := newJob("job-cloud-off", models.JobTypeStandard, "ready", false, []string{"c-h7"})
	require.NoError(t, db.Create(&offJob).Error)
}

// findCloudRow 取指定 cloud_code 的 by_cloud 行（不存在返回 nil）。
func findCloudRow(rows []CloudSummary, code string) *CloudSummary {
	for i := range rows {
		if rows[i].CloudCode == code {
			return &rows[i]
		}
	}
	return nil
}

// TestSummaryByCloudInvariants 覆盖 by_cloud 的六条不变量：
//  1. sum(各行 resource_count) == by_category 中 host 的 resource_count；
//  2. sum(各行 monitored_count) == host 类已下发数（≠ 全局 monitored_count）；
//  3. 每行 coverage_rate == monitored_count * 100 / resource_count（整数除法）；
//  4. 云字典缺条目时 cloud_name 回落 cloud_code，不返回空串；
//  5. 排序：resource_count 降序、并列 cloud_code 字典序升序，「未指定云」恒末位；
//  6. 空库 / 无主机返回非 nil 空 slice（序列化 [] 而非 null）。
func TestSummaryByCloudInvariants(t *testing.T) {
	db := newTestDB(t)
	seedCloudHosts(t, db)

	s, err := Build(db)
	require.NoError(t, err)
	require.NotNil(t, s.ByCloud, "by_cloud 恒为非 nil slice（避免 JSON null）")

	// 不变量 1：行合计 === by_category 中 host 的 resource_count。
	hostCat, hostMon := categoryOfHost(t, s)
	var sumRes int
	for _, row := range s.ByCloud {
		sumRes += row.ResourceCount
	}
	assert.Equal(t, hostCat, sumRes, "各行 resource_count 之和必须等于 host 类资源数")

	// 不变量 2：行 monitored 之和 === host 类已下发数，且**不等于**全局 monitored_count。
	var sumMon int
	for _, row := range s.ByCloud {
		sumMon += row.MonitoredCount
	}
	assert.Equal(t, hostMon, sumMon, "各行 monitored_count 之和必须等于 host 类已下发数")
	assert.Equal(t, 6, s.MonitoredCount, "fixture 的全局 monitored_count = 5 台主机 + 1 台数据库")
	assert.NotEqual(t, s.MonitoredCount, sumMon,
		"by_cloud 只统计 host，行 monitored 之和天然小于全局 monitored_count（防误用全局值比对）")

	// 不变量 3：每行 coverage_rate === 整数除法。
	for _, row := range s.ByCloud {
		assert.Equal(t, row.MonitoredCount*100/row.ResourceCount, row.CoverageRate,
			"cloud_code=%q 的 coverage_rate 必须是整数除法结果", row.CloudCode)
		assert.GreaterOrEqual(t, row.CoverageRate, 0)
		assert.LessOrEqual(t, row.CoverageRate, 100)
	}

	// 不变量 4：字典有 / 缺条目两类都必须给出非空展示名。
	assert.Equal(t, "腾讯云", findCloudRow(s.ByCloud, "PUB-TX").CloudName)
	assert.Equal(t, "政务云（联通）", findCloudRow(s.ByCloud, "GM-CU").CloudName)
	orphan := findCloudRow(s.ByCloud, "IND-XX")
	require.NotNil(t, orphan, "云字典缺条目仍须成行（只是名字回落编码）")
	assert.Equal(t, "IND-XX", orphan.CloudName, "云字典缺条目时 cloud_name 回落 cloud_code")
	assert.NotEmpty(t, orphan.CloudName, "cloud_name 绝不返回空串")
	unset := findCloudRow(s.ByCloud, "")
	require.NotNil(t, unset, "「未指定云」行恒保留（否则合计对不上）")
	assert.Equal(t, cloudUnsetName, unset.CloudName)

	// 派生链正确性 + 残留列隔离 + 具体分布。
	tx := findCloudRow(s.ByCloud, "PUB-TX")
	require.NotNil(t, tx)
	assert.Equal(t, 4, tx.ResourceCount, "dom-tx 4 台（含残留 CloudCode=GHOST-CODE 的那台）")
	assert.Equal(t, 2, tx.MonitoredCount)
	assert.Equal(t, 50, tx.CoverageRate)
	gm := findCloudRow(s.ByCloud, "GM-CU")
	require.NotNil(t, gm)
	assert.Equal(t, 3, gm.ResourceCount)
	assert.Equal(t, 1, gm.MonitoredCount)
	assert.Equal(t, 1, orphan.ResourceCount)
	assert.Equal(t, 1, orphan.MonitoredCount)
	assert.Equal(t, 100, orphan.CoverageRate)
	assert.Equal(t, 3, unset.ResourceCount, "dom-nocloud 2 台 + 网域缺失 1 台")
	assert.Equal(t, 1, unset.MonitoredCount)
	assert.Nil(t, findCloudRow(s.ByCloud, "GHOST-CODE"),
		"残留列 Host.CloudCode 不得成为云归属来源（决策 103 scheme-B 红线）")

	// 不变量 5：排序（resource_count 降序 + 并列字典序 + 「未指定云」恒末位）。
	require.Len(t, s.ByCloud, 4)
	assert.Equal(t, []string{"PUB-TX", "GM-CU", "IND-XX", ""},
		[]string{s.ByCloud[0].CloudCode, s.ByCloud[1].CloudCode, s.ByCloud[2].CloudCode, s.ByCloud[3].CloudCode},
		"4 > 3 > 1 降序；「未指定云」（3 台）不参与降序竞争、恒排末位")

	// 不变量 6：空库 → 非 nil 空 slice，序列化为 [] 而非 null。
	emptyDB := newTestDB(t)
	sEmpty, err := Build(emptyDB)
	require.NoError(t, err)
	require.NotNil(t, sEmpty.ByCloud)
	raw, err := json.Marshal(sEmpty.ByCloud)
	require.NoError(t, err)
	assert.Equal(t, "[]", string(raw), "空库 by_cloud 序列化为 [] 而非 null")
}

// categoryOfHost 取 by_category 中 host 类的 (resource_count, monitored_count)。
func categoryOfHost(t *testing.T, s *Summary) (int, int) {
	t.Helper()
	for _, c := range s.ByCategory {
		if c.ResourceCategory == string(models.ResourceCategoryHost) {
			return c.ResourceCount, c.MonitoredCount
		}
	}
	t.Fatal("by_category 缺少 host 条目")
	return 0, 0
}

// TestSummaryByCloudZeroResourceCountNoDivideByZero 护栏：resource_count 为 0 时
// coverage_rate 取 0 且绝不除零 panic（buildCloudSummary 的直接单测，覆盖真实库里
// 无法自然出现的 0 计数分支）。
func TestSummaryByCloudZeroResourceCountNoDivideByZero(t *testing.T) {
	rows := buildCloudSummary(map[string]*cloudAgg{
		"PUB-TX": {resourceCount: 0, monitoredCount: 0},
		"":       {resourceCount: 0, monitoredCount: 3}, // 分母 0、分子非 0：仍须取 0
	}, map[string]string{"PUB-TX": "腾讯云"})
	require.Len(t, rows, 2)
	assert.Equal(t, 0, rows[0].CoverageRate)
	assert.Equal(t, 0, rows[1].CoverageRate)
	assert.Equal(t, cloudUnsetName, rows[1].CloudName)
}

// TestSummaryByCloudOnlyHosts 护栏：by_cloud 只统计 resource_category=host——
// 同一网域下的 middleware 不得进入行合计；无 host 资源时返回空 slice。
func TestSummaryByCloudOnlyHosts(t *testing.T) {
	db := newTestDB(t)
	require.NoError(t, db.Create(&models.NetworkDomain{
		ID: "default", Name: "管理网域", DomainType: models.DomainTypeManagement,
		Channel: models.ChannelTypeLocal, Status: models.DomainStatusEnabled,
		IsMonitored: true, CloudCode: "PUB-TX",
	}).Error)
	require.NoError(t, db.Create(&models.CloudDict{
		CloudCode: "PUB-TX", CloudName: "腾讯云", CloudType: models.CloudTypePublic,
		Carrier: models.CloudCarrierTencent, Enabled: true,
	}).Error)
	require.NoError(t, db.Create(&models.Middleware{
		ResourceID: "c-mw-1", ResourceCategory: models.ResourceCategoryMiddleware,
		NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
		AppName: "app-a", Env: "PRD", Cluster: "cluster", Status: "online",
		MiddlewareType: "nginx", InstanceIP: "10.0.4.1", Port: 80,
	}).Error)
	// 该网域下 1 台主机（残留 CloudCode 列刻意填另一个编码，验证仍归 PUB-TX）。
	require.NoError(t, db.Create(&models.Host{
		ResourceID: "c-h1", ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID: "default", BizCode: "infra", SourceType: models.SourceTypeManual,
		CloudCode: "GHOST-CODE", EnvFlag: "PRD", SubAppCode: "cluster",
		InstanceName: "cn-01", ServerID: "srv-c-01", Status: "online", Image: "linux",
	}).Error)

	s, err := Build(db)
	require.NoError(t, err)
	require.Len(t, s.ByCloud, 1)
	assert.Equal(t, "PUB-TX", s.ByCloud[0].CloudCode)
	assert.Equal(t, "腾讯云", s.ByCloud[0].CloudName)
	assert.Equal(t, 1, s.ByCloud[0].ResourceCount, "middleware 不计入，合计只算 1 台主机")
	assert.Equal(t, 0, s.ByCloud[0].MonitoredCount)
	assert.Equal(t, 0, s.ByCloud[0].CoverageRate)

	// 无 host 资源 → 空 slice（非 nil、序列化为 []）。
	db2 := newTestDB(t)
	s2, err := Build(db2)
	require.NoError(t, err)
	require.NotNil(t, s2.ByCloud)
	raw, err := json.Marshal(s2.ByCloud)
	require.NoError(t, err)
	assert.Equal(t, "[]", string(raw))
}

// TestSummaryByCloudWithSeedFixture 回归：既有 seed fixture 的 3 台主机全挂在
// default 网域上，而该网域未登记 cloud_code → 恰有 1 行「未指定云」。
// 其中 res-host-1 / res-host-2 被 ready+enabled Job 覆盖，res-host-3 只被 draft Job
// 覆盖 → monitored=2（≠ 全局 9）。
func TestSummaryByCloudWithSeedFixture(t *testing.T) {
	db := newTestDB(t)
	seed(t, db)

	s, err := Build(db)
	require.NoError(t, err)
	require.Len(t, s.ByCloud, 1)
	row := s.ByCloud[0]
	assert.Equal(t, "", row.CloudCode)
	assert.Equal(t, cloudUnsetName, row.CloudName)
	assert.Equal(t, 3, row.ResourceCount)
	assert.Equal(t, 2, row.MonitoredCount)
	assert.Equal(t, 66, row.CoverageRate, "2*100/3 整数除法 = 66")
	assert.Equal(t, 9, s.MonitoredCount, "全局 monitored_count 仍为 9（未被 by_cloud 改动）")
}

// TestSummaryByCloudJSONTags 契约护栏：by_cloud 的 JSON tag 必须与前端
// ui-custom/web/src/api/dashboard.ts 的 CloudSummary interface 逐字对齐。
func TestSummaryByCloudJSONTags(t *testing.T) {
	raw, err := json.Marshal(CloudSummary{
		CloudCode: "PUB-TX", CloudName: "腾讯云",
		ResourceCount: 4, MonitoredCount: 2, CoverageRate: 50,
	})
	require.NoError(t, err)
	var got map[string]any
	require.NoError(t, json.Unmarshal(raw, &got))
	require.Len(t, got, 5, "前端契约恰好 5 个字段，不得有多余维度（如 cloud_type / carrier）")
	for _, key := range []string{"cloud_code", "cloud_name", "resource_count", "monitored_count", "coverage_rate"} {
		assert.Contains(t, got, key)
	}
	for _, forbidden := range []string{"cloud_type", "carrier", "type"} {
		assert.NotContains(t, got, forbidden,
			"CloudType / Carrier 是描述性元数据，不是分类轴，不得出现在 by_cloud 行里")
	}
}
