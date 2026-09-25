package query

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// promTargetsFixture 为 /api/v1/targets 提供一个预置的上游响应。返回四个 target：
//   - job-a 的 t1（up，network_domain=default，resource_id=srv-1，labels.instance）
//   - job-b 的 t2（down，无 network_domain 标签 → 回落 default，无 resource_id，labels.instance）
//   - job-a 的 t3（unknown，network_domain=dmz，resource_id=srv-2，labels.instance）
//   - job-c 的 t4（up，模拟真实 Prometheus 结构：labels 无 instance，仅有 __address__，
//     顶层 scrapeUrl 兜底 → 应解析为 "192.168.1.10:9100"）。
func promTargetsFixture() map[string]interface{} {
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"activeTargets": []map[string]interface{}{
				{
					"scrapePool": "job-a",
					"labels": map[string]interface{}{
						"job":            "job-a",
						"instance":       "10.0.0.1:9100",
						"network_domain": "default",
						"resource_id":    "srv-1",
					},
					"health":    "up",
					"lastError": "",
				},
				{
					"scrapePool": "job-b",
					"labels": map[string]interface{}{
						"job":      "job-b",
						"instance": "10.0.0.2:9100",
					},
					"health":    "down",
					"lastError": "connection refused",
				},
				{
					"scrapePool": "job-a",
					"labels": map[string]interface{}{
						"job":            "job-a",
						"instance":       "10.0.0.3:9100",
						"network_domain": "dmz",
						"resource_id":    "srv-2",
					},
					"health": "unknown",
				},
				{
					"scrapePool": "job-c",
					"labels": map[string]interface{}{
						"job":         "job-c",
						"__address__": "192.168.1.10:9100",
					},
					"scrapeUrl": "http://192.168.1.10:9100/metrics",
					"health":    "up",
					"lastError": "",
				},
			},
			"droppedTargets": []interface{}{},
			"targetsByJob":   map[string]interface{}{},
		},
	}
}

// newTargetsRouter 构造一个 fake upstream（/api/v1/targets 返回固定 fixture）并挂载
// TargetsHandler，返回 router、upstream 与融合用内存 DB（F-11：边缘快照落库表）。
func newTargetsRouter(t *testing.T) (*gin.Engine, fakeUpstream, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	fake := newFakeUpstream(promTargetsFixture())
	u, err := url.Parse(fake.server.URL)
	require.NoError(t, err)
	db := openTargetsTestDB(t)
	r := gin.New()
	r.GET("/api/v1/targets", TargetsHandler(db, u, http.DefaultClient))
	return r, fake, db
}

var targetsTestDBCounter int64

// openTargetsTestDB 打开逐测试隔离的内存 SQLite 并迁移 /api/v1/targets 融合所需模型
// （local 侧透传上游无需表，边缘侧需 EdgeTargetSnapshot，F-11 落库表；blackbox
// 黑名单过滤需 ScrapeJob 表，F-11 收尾；search 的「实例名」需回连 M07 五类资源台账）。
func openTargetsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	n := atomic.AddInt64(&targetsTestDBCounter, 1)
	dsn := fmt.Sprintf("file:targets_%d?mode=memory&cache=shared", n)
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.EdgeTargetSnapshot{}, &models.ScrapeJob{},
		&models.Host{}, &models.Database{}, &models.Middleware{},
		&models.Application{}, &models.GenericTarget{},
	))
	return db
}

// seedHostResource 落一条 host 资源台账行，供 search 的「实例名」回连测试。
func seedHostResource(t *testing.T, db *gorm.DB, resourceID, instanceName, netDomain string) {
	t.Helper()
	h := &models.Host{
		ResourceID:       resourceID,
		SourceType:       models.SourceTypeManual,
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  netDomain,
		BizCode:         "biz-1",
		ServerID:        "server-" + resourceID, // 唯一索引列，需逐行唯一
		InstanceName:    instanceName,
		Status:           "running",
		Region:           "ap-guangzhou",
		ZoneEnv:          "prod",
		InstanceSpec:     "S5.MEDIUM4",
		Image:            "ubuntu-22.04",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
	}
	require.NoError(t, db.Create(h).Error)
}

// seedScrapeJob 落一条采集 Job 配置行，供 blackbox 黑名单过滤测试（job_type 权威来源）。
func seedScrapeJob(t *testing.T, db *gorm.DB, jobName string, jobType models.JobType) {
	t.Helper()
	j := &models.ScrapeJob{
		JobName:               jobName,
		JobType:               jobType,
		ResourceType:          models.ResourceTypeHost,
		NetworkDomainID:       "default",
		InstanceSelectionMode: models.InstanceSelectionManual,
		ScrapeInterval:        "15s",
		ScrapeTimeout:         "10s",
		MetricsPath:           "/metrics",
		Scheme:                "http",
		AuthType:              models.AuthTypeNone,
		DraftStatus:           "ready",
		ChangeStatus:          models.ChangeStatusDeployed,
		Enabled:               true,
	}
	require.NoError(t, db.Create(j).Error)
}

// seedEdgeSnapshot 直接落一条边缘 target 快照（模拟心跳 clear-then-insert 落库产物）。
// lastReportAt 缺省取调用时刻（新鲜）。
func seedEdgeSnapshot(t *testing.T, db *gorm.DB, domain, job, instance, resourceID, health string, lastReportAt time.Time) {
	t.Helper()
	s := &models.EdgeTargetSnapshot{
		NetworkDomainID:       domain,
		EdgeAgentID:           1,
		Job:                   job,
		Instance:              instance,
		ResourceID:            resourceID,
		Health:                health,
		LastScrape:            "2026-09-21T08:00:00Z",
		LastError:             "dial tcp: connection refused",
		ScrapeDurationSeconds: 0.123,
		LastReportAt:          lastReportAt,
	}
	require.NoError(t, db.Create(s).Error)
}

// doTargets 以指定 query 请求 targets 并解码响应。
func doTargets(t *testing.T, r *gin.Engine, query string) targetsResp {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/targets"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out targetsResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return out
}

// targetsResp 镜像 /api/v1/targets 统一响应信封。
type targetsResp struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		ActiveTargets []map[string]interface{} `json:"activeTargets"`
	} `json:"data"`
}

func TestTargetsPassthroughAndEnrichment(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "")

	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.ActiveTargets, 4)

	// t1 补全：job / network_domain / resource_id / instance 均注入。
	t1 := out.Data.ActiveTargets[0]
	require.Equal(t, "job-a", t1["job"])
	require.Equal(t, "default", t1["network_domain"])
	require.Equal(t, "srv-1", t1["resource_id"])
	require.Equal(t, "10.0.0.1:9100", t1["instance"])
	// 原始字段透传保留。
	require.Equal(t, "10.0.0.1:9100", t1["labels"].(map[string]interface{})["instance"])
	require.Equal(t, "up", t1["health"])
}

func TestTargetsNetworkDomainFallbackDefault(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 4)

	// t2 无 network_domain 标签 → 回落 default。
	var t2 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["labels"].(map[string]interface{})["instance"] == "10.0.0.2:9100" {
			t2 = a
		}
	}
	require.NotNil(t, t2)
	require.Equal(t, "default", t2["network_domain"])
	require.Equal(t, "", t2["resource_id"]) // 无 resource_id 标签 → 留空
	require.Equal(t, "job-b", t2["job"])    // labels.job 解析
	require.Equal(t, "10.0.0.2:9100", t2["instance"])
}

func TestTargetsFilterJob(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?job=job-a")
	require.Len(t, out.Data.ActiveTargets, 2)
	for _, a := range out.Data.ActiveTargets {
		require.Equal(t, "job-a", a["job"])
	}
}

func TestTargetsFilterNetworkDomain(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?network_domain=dmz")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "srv-2", out.Data.ActiveTargets[0]["resource_id"])
}

func TestTargetsFilterHealth(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?health=down")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "connection refused", out.Data.ActiveTargets[0]["lastError"])
}

func TestTargetsFilterCombination(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?job=job-a&network_domain=dmz&health=unknown")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "srv-2", out.Data.ActiveTargets[0]["resource_id"])
}

func TestTargetsInvalidHealthBadRequest(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?health=garbage")
	require.Equal(t, "error", out.Status)
	require.Equal(t, "bad_request", out.ErrorType)
	require.Contains(t, out.Error, "health")
}

func TestTargetsFilterNoMatchEmptyActive(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?job=no-such-job")
	require.Equal(t, "success", out.Status)
	require.Empty(t, out.Data.ActiveTargets) // [] 而非 null
}

// TestTargetsInstanceFallback 验证当 labels.instance 缺失时，后端按 __address__ /
// scrapeUrl 解析出顶层 instance 字段，供前端 TargetStatusPage 直接显示。
func TestTargetsInstanceFallback(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "")

	var t4 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["job"] == "job-c" {
			t4 = a
		}
	}
	require.NotNil(t, t4)
	require.Equal(t, "192.168.1.10:9100", t4["instance"])
	require.Equal(t, "default", t4["network_domain"])
}

// --- search：按「M07 台账实例名」/「实例地址(IP)」模糊搜索 ---
//
// 口径：target 的 job 名是用户自由填写的抓取任务标识，不保证等于实例名，故「实例名」
// 只能经 resource_id 回连 M07 资源台账取值；「实例IP」取 target 的 instance（host:port）
// 的 host 部分。search 大小写不敏感 contains，local 与边缘快照统一生效。

// TestTargetsEnrichInstanceName 验证无 search 时也按 resource_id 回填实例名，供前端
// 「实例名」列展示（无 resource_id / 台账无此资源时为空串）。
func TestTargetsEnrichInstanceName(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedHostResource(t, db, "srv-1", "GL_OPS_MONITOR_01_X86", "default")

	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 4)

	byInstance := map[string]map[string]interface{}{}
	for _, a := range out.Data.ActiveTargets {
		byInstance[a["instance"].(string)] = a
	}
	require.Equal(t, "GL_OPS_MONITOR_01_X86", byInstance["10.0.0.1:9100"]["instance_name"])
	require.Equal(t, "", byInstance["10.0.0.2:9100"]["instance_name"]) // 无 resource_id → 空
}

// TestTargetsSearchByInstanceName 验证按 M07 台账实例名搜索命中对应 target。
func TestTargetsSearchByInstanceName(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedHostResource(t, db, "srv-1", "GL_OPS_MONITOR_01_X86", "default")
	seedHostResource(t, db, "srv-2", "monito2-02", "dmz")

	out := doTargets(t, r, "?search=GL_OPS_MONITOR_01_X86")
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "10.0.0.1:9100", out.Data.ActiveTargets[0]["instance"])
	require.Equal(t, "GL_OPS_MONITOR_01_X86", out.Data.ActiveTargets[0]["instance_name"])
}

// TestTargetsSearchCaseInsensitive 验证实例名搜索大小写不敏感。
func TestTargetsSearchCaseInsensitive(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedHostResource(t, db, "srv-1", "GL_OPS_MONITOR_01_X86", "default")

	out := doTargets(t, r, "?search=gl_ops_monitor")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "srv-1", out.Data.ActiveTargets[0]["resource_id"])
}

// TestTargetsSearchByInstanceIP 验证按实例 IP（instance 的 host 部分）搜索，且
// 无 resource_id 的 target 同样可命中（实例名为空不影响 IP 搜索）。
func TestTargetsSearchByInstanceIP(t *testing.T) {
	r, _, _ := newTargetsRouter(t)

	out := doTargets(t, r, "?search=10.0.0.2")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "10.0.0.2:9100", out.Data.ActiveTargets[0]["instance"])
	require.Equal(t, "job-b", out.Data.ActiveTargets[0]["job"])
}

// TestTargetsSearchNoMatchEmpty 验证无命中时返回空 activeTargets（[] 而非 null）。
func TestTargetsSearchNoMatchEmpty(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?search=no-such-instance")
	require.Equal(t, "success", out.Status)
	require.Empty(t, out.Data.ActiveTargets)
}

// TestTargetsSearchAppliesToEdge 验证 search 对边缘快照同样生效（按 resource_id
// 回连台账实例名命中）。
func TestTargetsSearchAppliesToEdge(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedHostResource(t, db, "srv-5", "edge-host-01", "mc-edge")
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", time.Now())

	out := doTargets(t, r, "?search=edge-host-01")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "10.0.0.5:9100", out.Data.ActiveTargets[0]["instance"])
	require.Equal(t, "edge-host-01", out.Data.ActiveTargets[0]["instance_name"])
}

// TestTargetsSearchCombinesWithHealth 验证 search 与既有过滤参数叠加生效。
func TestTargetsSearchCombinesWithHealth(t *testing.T) {
	r, _, _ := newTargetsRouter(t)

	out := doTargets(t, r, "?search=10.0.0&health=up")
	// local fixture 中 up 的仅 t1（10.0.0.1:9100）与 t4（192.168.1.10，不匹配 search）。
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "10.0.0.1:9100", out.Data.ActiveTargets[0]["instance"])
}

// fakeUpstream 是一个可复用的伪 Prometheus 上游：可按路径返回固定 JSON。
type fakeUpstream struct {
	server *httptest.Server
}

func newFakeUpstream(payload map[string]interface{}) fakeUpstream {
	body, _ := json.Marshal(payload)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, "%s", body)
	}))
	return fakeUpstream{server: srv}
}

// newFakeUpstreamFailing 返回一个恒 500 的伪上游，模拟中心 Prometheus 不可达/故障。
func newFakeUpstreamFailing() fakeUpstream {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream down", http.StatusInternalServerError)
	}))
	return fakeUpstream{server: srv}
}

// --- F-11：/api/v1/targets 融合 local targets + 边缘 vmagent 快照 ---
//
// 边缘快照统一合成为 Prometheus target 结构追加进 activeTargets（envelope 不变），
// 去重键 (network_domain, job, instance)，local 优先、边缘补缺；快照 last_report_at
// 距今超过 edgeSnapshotStaleAfter 时 health 降级 unknown。详见 targets.go。

// TestTargetsFusionLocalPlusEdge 验证 local 与边缘快照按 (job, instance) 归并追加，
// 边缘快照补全 job / network_domain / resource_id / instance / lastScrape /
// lastError / scrapeDuration，与 local 增强语义对齐。
func TestTargetsFusionLocalPlusEdge(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.6:9100", "srv-6", "down", now)

	out := doTargets(t, r, "")
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.ActiveTargets, 6) // 4 local + 2 边缘

	var e1 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.5:9100" {
			e1 = a
		}
	}
	require.NotNil(t, e1)
	require.Equal(t, "job-e", e1["job"])
	require.Equal(t, "mc-edge", e1["network_domain"])
	require.Equal(t, "srv-5", e1["resource_id"])
	require.Equal(t, "10.0.0.5:9100", e1["instance"])
	require.Equal(t, "up", e1["health"])
	require.Equal(t, "2026-09-21T08:00:00Z", e1["lastScrape"])
	require.Equal(t, "dial tcp: connection refused", e1["lastError"])
	require.Equal(t, 0.123, e1["scrapeDuration"])
	// labels 合成对齐 local 结构（前端按 labels.instance 兜底也兼容）。
	require.Equal(t, "job-e", e1["labels"].(map[string]interface{})["job"])
}

// TestTargetsFusionNetworkDomainFilter 验证 network_domain 过滤对边缘快照同样生效。
func TestTargetsFusionNetworkDomainFilter(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.6:9100", "srv-6", "down", now)
	seedEdgeSnapshot(t, db, "default", "job-e", "10.0.0.7:9100", "srv-7", "up", now)

	out := doTargets(t, r, "?network_domain=mc-edge")
	require.Len(t, out.Data.ActiveTargets, 2) // local 无 mc-edge 域，仅边缘 2 条
	for _, a := range out.Data.ActiveTargets {
		require.Equal(t, "mc-edge", a["network_domain"])
	}
}

// TestTargetsFusionJobFilterAppliesToEdge 验证 job 过滤对边缘快照生效。
func TestTargetsFusionJobFilterAppliesToEdge(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "job-f", "10.0.0.6:9100", "srv-6", "down", now)

	out := doTargets(t, r, "?job=job-e")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "job-e", out.Data.ActiveTargets[0]["job"])
}

// TestTargetsFusionHealthFilterAppliesToEdge 验证 health 过滤对边缘快照生效。
func TestTargetsFusionHealthFilterAppliesToEdge(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.6:9100", "srv-6", "down", now)

	out := doTargets(t, r, "?health=down")
	// local fixture 中 t2(down) + 边缘 e2(down)。
	require.Len(t, out.Data.ActiveTargets, 2)
	for _, a := range out.Data.ActiveTargets {
		require.Equal(t, "down", a["health"])
	}
}

// TestTargetsFusionDedupLocalPriority 验证 (network_domain, job, instance) 归并时
// local 优先：同键边缘快照被去重，不重复追加。
func TestTargetsFusionDedupLocalPriority(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	// 与 local t1（default/job-a/10.0.0.1:9100/up）同键，但上报 down。
	seedEdgeSnapshot(t, db, "default", "job-a", "10.0.0.1:9100", "srv-9", "down", now)

	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 4) // 边缘被去重，仍 4 条 local

	var t1 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.1:9100" {
			t1 = a
		}
	}
	require.NotNil(t, t1)
	require.Equal(t, "up", t1["health"]) // local 权威，未被子快照覆盖
}

// TestTargetsFusionStaleEdgeDegradedToUnknown 验证快照过期（last_report_at 距今 >
// edgeSnapshotStaleAfter）时 health 降级 unknown，新鲜快照保持原值。
func TestTargetsFusionStaleEdgeDegradedToUnknown(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "job-f", "10.0.0.6:9100", "srv-6", "up", now.Add(-2*time.Minute))

	out := doTargets(t, r, "?network_domain=mc-edge")
	require.Len(t, out.Data.ActiveTargets, 2)
	var fresh, stale map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.5:9100" {
			fresh = a
		} else {
			stale = a
		}
	}
	require.Equal(t, "up", fresh["health"])
	require.Equal(t, "unknown", stale["health"])
	// 抓取详情仍透传，仅 health 降级。
	require.Equal(t, "2026-09-21T08:00:00Z", stale["lastScrape"])
}

// TestTargetsFusionNoEdgeSnapshotsFallsBackToLocal 验证边缘快照表为空时回落纯 local。
func TestTargetsFusionNoEdgeSnapshotsFallsBackToLocal(t *testing.T) {
	r, _, _ := newTargetsRouter(t)
	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 4)
	require.Equal(t, "success", out.Status)
}

// TestTargetsFusionDefaultDomainReturnedWhenNoFilter 验证未指定 network_domain 时
// 默认返回全部域（含 default 域边缘快照），与 local 不过滤语义一致。
func TestTargetsFusionDefaultDomainReturnedWhenNoFilter(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "default", "job-e", "10.0.0.7:9100", "srv-7", "up", now)

	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 5) // 4 local + 1 default 域边缘快照

	var e3 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.7:9100" {
			e3 = a
		}
	}
	require.NotNil(t, e3)
	require.Equal(t, "default", e3["network_domain"])
}

// TestTargetsFusionUpstreamDownStillReturnsEdge 验证上游 Prometheus 不可达时降级
// 不整链失败：边缘快照仍返回，status 保持 success。
func TestTargetsFusionUpstreamDownStillReturnsEdge(t *testing.T) {
	gin.SetMode(gin.TestMode)
	fake := newFakeUpstreamFailing()
	u, err := url.Parse(fake.server.URL)
	require.NoError(t, err)
	db := openTargetsTestDB(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)

	r := gin.New()
	r.GET("/api/v1/targets", TargetsHandler(db, u, http.DefaultClient))
	out := doTargets(t, r, "?network_domain=mc-edge")
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "job-e", out.Data.ActiveTargets[0]["job"])
	require.Equal(t, "up", out.Data.ActiveTargets[0]["health"])
}

// --- F-11 收尾：融合边缘快照时排除 job_type=blackbox 的 job 快照 ---
//
// 产品决策：M09「监控目标状态」页定位为拉模型（standard）抓取的排障入口，
// 拨测类（blackbox）target 状态（probe_success）已由 M01/F-13 承载，混入会
// 造成语义误导。黑名单口径：ScrapeJob 表 job_type='blackbox' 的 job_name 集合
// （配置生成器不改写 job 名，render.go jobScrapeConfig 原样透传 JobName），
// 融合边缘快照时精确匹配排除；仅过滤边缘快照，local targets 侧不变。

// TestTargetsFusionExcludesBlackboxSnapshots 验证 blackbox job 的边缘快照被排除，
// local 侧不受影响（仍 4 条）。
func TestTargetsFusionExcludesBlackboxSnapshots(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedScrapeJob(t, db, "job-e", models.JobTypeBlackbox)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)

	out := doTargets(t, r, "")
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.ActiveTargets, 4) // 仅 local
	for _, a := range out.Data.ActiveTargets {
		require.NotEqual(t, "10.0.0.5:9100", a["instance"], "blackbox 快照不应出现在结果中")
	}
}

// TestTargetsFusionKeepsStandardSnapshots 验证 standard job 的边缘快照正常保留。
func TestTargetsFusionKeepsStandardSnapshots(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedScrapeJob(t, db, "job-e", models.JobTypeStandard)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)

	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 5) // 4 local + 1 standard 边缘快照
	var e1 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.5:9100" {
			e1 = a
		}
	}
	require.NotNil(t, e1)
	require.Equal(t, "job-e", e1["job"])
}

// TestTargetsFusionMixedKeepsOnlyStandard 验证同一 domain 下 standard 与 blackbox
// 混合时，仅保留 standard 快照、排除 blackbox 快照。
func TestTargetsFusionMixedKeepsOnlyStandard(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedScrapeJob(t, db, "job-e", models.JobTypeStandard)
	seedScrapeJob(t, db, "job-bb", models.JobTypeBlackbox)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "job-bb", "10.0.0.6:9100", "srv-6", "up", now)

	out := doTargets(t, r, "?network_domain=mc-edge")
	require.Len(t, out.Data.ActiveTargets, 1) // 仅 job-e standard 快照
	require.Equal(t, "job-e", out.Data.ActiveTargets[0]["job"])
}

// TestTargetsFusionNoBlackboxJobsKeepsAll 验证 ScrapeJob 表为空（或未匹配到
// blackbox job）时行为与现在完全一致：全部边缘快照保留。
func TestTargetsFusionNoBlackboxJobsKeepsAll(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "job-e", "10.0.0.5:9100", "srv-5", "up", now)

	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 5) // 4 local + 1 边缘快照，全保留
	var e1 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.5:9100" {
			e1 = a
		}
	}
	require.NotNil(t, e1)
	require.Equal(t, "job-e", e1["job"])
}

// TestTargetsFusionBlackboxMatchIsExact 验证黑名单匹配是精确匹配（大小写敏感）：
// 仅与 blackbox job 名完全一致的快照被排除，大小写/空白不一致的不排除，
// 与配置生成器不改写 job 名的实际规则一致。
func TestTargetsFusionBlackboxMatchIsExact(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedScrapeJob(t, db, "Probe-A", models.JobTypeBlackbox)
	now := time.Now()
	seedEdgeSnapshot(t, db, "mc-edge", "probe-a", "10.0.0.5:9100", "srv-5", "up", now)
	seedEdgeSnapshot(t, db, "mc-edge", "Probe-A", "10.0.0.6:9100", "srv-6", "up", now)

	out := doTargets(t, r, "?network_domain=mc-edge")
	// "probe-a"（小写）与 blackbox job "Probe-A" 不完全一致 → 保留；
	// "Probe-A" 精确命中黑名单 → 排除。
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "probe-a", out.Data.ActiveTargets[0]["job"])
	require.Equal(t, "10.0.0.5:9100", out.Data.ActiveTargets[0]["instance"])
}

// TestTargetsFusionBlackboxFilterLocalUntouched 验证黑名单仅过滤边缘快照：
// job-a 在 ScrapeJob 表为 blackbox 时，local 侧 job-a target 仍正常返回。
func TestTargetsFusionBlackboxFilterLocalUntouched(t *testing.T) {
	r, _, db := newTargetsRouter(t)
	seedScrapeJob(t, db, "job-a", models.JobTypeBlackbox)
	now := time.Now()
	// 与 local job-a 不同 instance（10.0.0.9），不会被去重，若不排除会出现在结果中。
	seedEdgeSnapshot(t, db, "mc-edge", "job-a", "10.0.0.9:9100", "srv-9", "up", now)

	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 4) // local job-a（t1/t3）仍在，边缘 job-a 快照被排除
	var t1 map[string]interface{}
	for _, a := range out.Data.ActiveTargets {
		if a["instance"] == "10.0.0.1:9100" {
			t1 = a
		}
	}
	require.NotNil(t, t1)
	require.Equal(t, "job-a", t1["job"])
	require.Equal(t, "up", t1["health"])
	for _, a := range out.Data.ActiveTargets {
		require.NotEqual(t, "10.0.0.9:9100", a["instance"], "blackbox 边缘快照不应出现")
	}
}
