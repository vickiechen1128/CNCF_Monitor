package alerts

import (
	"context"
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

// fakeAMAlerts 是一个可脚本化的 Alertmanager /api/v2/alerts 桩服务。
// v2 列表为裸数组（非 {status,data} 信封）；recordedPaths 记录命中的请求路径，
// 用于断言代理只走 v2 口径（决策 61：v1 已移除，禁止调用）。
type fakeAMAlerts struct {
	payload       []amAlert
	statusCode    int
	recordedPaths []string
}

func startFakeAMAlerts(t *testing.T, f *fakeAMAlerts) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.recordedPaths = append(f.recordedPaths, r.URL.Path)
		if f.statusCode != 0 && f.statusCode != http.StatusOK {
			w.WriteHeader(f.statusCode)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(f.payload)
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// amFixture 构造覆盖四态的 AM GettableAlert 夹具：
//   - a1：state=active（→ notify_status=active，通知中）
//   - a2：state=suppressed + silencedBy（→ silenced，静默）
//   - a3：state=suppressed + inhibitedBy（→ inhibited，抑制）
//   - a4：state=unprocessed（→ unprocessed，待处理）
//   - a5：state=active，network_domain=hr（供授权过滤锚点）
func amFixture() []amAlert {
	now := time.Now().UTC().Truncate(time.Second)
	mk := func(name, domain, state string, silencedBy, inhibitedBy []string) amAlert {
		labels := map[string]string{"alertname": name, "severity": "critical", "instance": "10.0.0.1:9100"}
		if domain != "" {
			labels["network_domain"] = domain
		}
		a := amAlert{
			Labels:      labels,
			Annotations: map[string]string{"summary": name + " summary"},
			StartsAt:    now.Add(-time.Hour),
			EndsAt:      now.Add(time.Hour),
		}
		a.Status.State = state
		a.Status.SilencedBy = silencedBy
		a.Status.InhibitedBy = inhibitedBy
		return a
	}
	return []amAlert{
		mk("HighCPU", "default", "active", nil, nil),
		mk("DiskFull", "", "suppressed", []string{"sil-1"}, nil), // 无 network_domain 标签 → 回落 default
		mk("NodeDown", "dmz", "suppressed", nil, []string{"inh-9"}),
		mk("QueueLag", "dmz", "unprocessed", nil, nil),
		mk("HROnly", "hr", "active", nil, nil),
	}
}

func newTestService(t *testing.T, f *fakeAMAlerts) *Service {
	t.Helper()
	proxy, err := NewProxy(startFakeAMAlerts(t, f))
	require.NoError(t, err)
	return NewService(proxy, nil)
}

// --- Proxy 基础 ---

// TestNewProxyRejectsBadTarget 覆盖 SSRF 防护：scheme 仅允许 http/https 且 host 非空。
func TestNewProxyRejectsBadTarget(t *testing.T) {
	_, err := NewProxy("ftp://host")
	require.Error(t, err)
	_, err = NewProxy("http://")
	require.Error(t, err)
	_, err = NewProxy("http://localhost:9093")
	require.NoError(t, err)
}

// --- Service 四态映射（契约快照 §10.2） ---

// TestServiceListNotifyStatusFourStates 覆盖服务端归一 notify_status 四态映射：
// active→active / suppressed+silencedBy→silenced / suppressed+inhibitedBy→inhibited /
// unprocessed→unprocessed；AM 原始 suppressed 不外露为 notify_status。
func TestServiceListNotifyStatusFourStates(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)

	items, err := svc.List(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, "")
	require.NoError(t, err)
	require.Len(t, items, 5)

	byName := map[string]AlertItem{}
	for _, it := range items {
		byName[it.Labels["alertname"]] = it
	}
	assert.Equal(t, NotifyStatusActive, byName["HighCPU"].NotifyStatus)
	assert.Equal(t, NotifyStatusSilenced, byName["DiskFull"].NotifyStatus)
	assert.Equal(t, NotifyStatusInhibited, byName["NodeDown"].NotifyStatus)
	assert.Equal(t, NotifyStatusUnprocessed, byName["QueueLag"].NotifyStatus)

	// 字段子集：labels/annotations/starts_at/ends_at/status{state,silenced_by,inhibited_by}。
	a1 := byName["HighCPU"]
	assert.Equal(t, "critical", a1.Labels["severity"])
	assert.Equal(t, "HighCPU summary", a1.Annotations["summary"])
	assert.False(t, a1.StartsAt.IsZero())
	assert.False(t, a1.EndsAt.IsZero())
	assert.Equal(t, "active", a1.Status.State)
	a2 := byName["DiskFull"]
	assert.Equal(t, "suppressed", a2.Status.State, "AM 原始态保留在 status.state")
	assert.Equal(t, []string{"sil-1"}, a2.Status.SilencedBy)
	a3 := byName["NodeDown"]
	assert.Equal(t, []string{"inh-9"}, a3.Status.InhibitedBy)
}

// TestNotifyStatusPriority 覆盖四态映射优先级：suppressed 且 silencedBy 非空优先判
// silenced（即便 inhibitedBy 亦非空）；suppressed 且仅 inhibitedBy 非空判 inhibited。
func TestNotifyStatusPriority(t *testing.T) {
	both := amAlert{}
	both.Status.State = "suppressed"
	both.Status.SilencedBy = []string{"s1"}
	both.Status.InhibitedBy = []string{"i1"}
	assert.Equal(t, NotifyStatusSilenced, normalizeNotifyStatus(both.Status))

	inhibitedOnly := amAlert{}
	inhibitedOnly.Status.State = "suppressed"
	inhibitedOnly.Status.InhibitedBy = []string{"i1"}
	assert.Equal(t, NotifyStatusInhibited, normalizeNotifyStatus(inhibitedOnly.Status))

	active := amAlert{}
	active.Status.State = "active"
	assert.Equal(t, NotifyStatusActive, normalizeNotifyStatus(active.Status))

	unprocessed := amAlert{}
	unprocessed.Status.State = "unprocessed"
	assert.Equal(t, NotifyStatusUnprocessed, normalizeNotifyStatus(unprocessed.Status))
}

// TestServiceListAuthorizedScopeFilter 是决策 56 读路径授权过滤骨架的测试锚点：
// 授权集合非全量时，服务端强制按 labels.network_domain（缺失回落 default）收敛；
// AllDomains（MVP 单租户）恒通过、不附加过滤。
func TestServiceListAuthorizedScopeFilter(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)

	// 授权集合 = 全部网域（MVP）→ 不过滤。
	items, err := svc.List(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, "")
	require.NoError(t, err)
	assert.Len(t, items, 5)

	// 授权集合 = {default}：仅 default 网域（含无标签回落 default 的 DiskFull）可见，
	// dmz / hr 被服务端强制剔除——骨架语义锚点（未来多租户启用）。
	items, err = svc.List(context.Background(), &models.AuthorizedMatcherScope{Domains: []string{"default"}}, "")
	require.NoError(t, err)
	require.Len(t, items, 2)
	for _, it := range items {
		assert.NotEqual(t, "HROnly", it.Labels["alertname"])
	}

	// nil scope 缺省按 MVP 单租户全授权处理（不附加约束）。
	items, err = svc.List(context.Background(), nil, "")
	require.NoError(t, err)
	assert.Len(t, items, 5)
}

// TestServiceListNetworkDomainUXFilter 覆盖前端 network_domain Query 的 UX 筛选透传：
// 在授权过滤之后按网域本地过滤，不构成权限依据。
func TestServiceListNetworkDomainUXFilter(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)

	items, err := svc.List(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, "dmz")
	require.NoError(t, err)
	require.Len(t, items, 2)
	names := []string{items[0].Labels["alertname"], items[1].Labels["alertname"]}
	assert.Contains(t, names, "NodeDown")
	assert.Contains(t, names, "QueueLag")

	// 缺失 network_domain 标签的告警回落 default。
	items, err = svc.List(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, "default")
	require.NoError(t, err)
	require.Len(t, items, 2)
}

// TestServiceListNetworkDomainWriteBack 覆盖「网域」列的取值链路修复（契约 §10.2 展示名同 §10.1）：
// AM 侧标签经 Prometheus 通知链路附加 external_labels 后构成，键为写入侧
// network_domain_id（M09 决策 19）；代理需归一为消费侧 network_domain 并补齐回落值，
// 否则前端「网域」列恒渲染 '-'。缺失标签的告警应回写 default。
func TestServiceListNetworkDomainWriteBack(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)

	items, err := svc.List(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, "")
	require.NoError(t, err)
	require.Len(t, items, 5)

	byName := map[string]AlertItem{}
	for _, it := range items {
		byName[it.Labels["alertname"]] = it
	}
	assert.Equal(t, "default", byName["HighCPU"].Labels["network_domain"], "显式标签原值透传")
	assert.Equal(t, "default", byName["DiskFull"].Labels["network_domain"], "缺失标签回写回落值")
	assert.Equal(t, "dmz", byName["NodeDown"].Labels["network_domain"])
	assert.Equal(t, "hr", byName["HROnly"].Labels["network_domain"])
}

// TestServiceListNetworkDomainFromExternalLabelKey 覆盖写入侧 external_labels 键的读取：
// 告警携带 network_domain_id（M09 决策 19）时归一为消费侧 network_domain 并回写。
func TestServiceListNetworkDomainFromExternalLabelKey(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	alert := amAlert{
		Labels: map[string]string{
			"alertname":         "HighCPU",
			"network_domain_id": "gov-cloud-a",
			"instance":          "10.0.0.1:9100",
		},
		Annotations: map[string]string{"summary": "cpu high"},
		StartsAt:    now.Add(-time.Hour),
		EndsAt:      now.Add(time.Hour),
	}
	alert.Status.State = "active"

	f := &fakeAMAlerts{payload: []amAlert{alert}}
	svc := newTestService(t, f)
	items, err := svc.List(context.Background(), &models.AuthorizedMatcherScope{AllDomains: true}, "")
	require.NoError(t, err)
	require.Len(t, items, 1)
	assert.Equal(t, "gov-cloud-a", items[0].Labels["network_domain"])

	// 授权过滤 / UX 筛选均按归一后的网域收敛。
	items, err = svc.List(context.Background(), &models.AuthorizedMatcherScope{Domains: []string{"gov-cloud-a"}}, "")
	require.NoError(t, err)
	assert.Len(t, items, 1)

	items, err = svc.List(context.Background(), &models.AuthorizedMatcherScope{Domains: []string{"default"}}, "")
	require.NoError(t, err)
	assert.Empty(t, items)
}

// TestServiceListAMUnreachable 覆盖 AM 不可达 → 可观测错误。
func TestServiceListAMUnreachable(t *testing.T) {
	proxy, err := NewProxy("http://127.0.0.1:1")
	require.NoError(t, err)
	svc := NewService(proxy, nil)
	_, err = svc.List(context.Background(), nil, "")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "alerts")
}

// --- Handler 层 ---

func newAlertsRouter(svc *Service) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.GET("/api/v2/platform/alertmanager/alerts", ListHandler(svc))
	return r
}

// alertsResp 镜像 GET /api/v2/platform/alertmanager/alerts 统一响应信封。
type alertsResp struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Data      struct {
		Items []map[string]interface{} `json:"items"`
	} `json:"data"`
}

func doListAlerts(t *testing.T, r *gin.Engine, query string) (int, alertsResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v2/platform/alertmanager/alerts"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out alertsResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

// TestListEndpointHappy 覆盖端点契约：data.items 含 labels/annotations/starts_at/ends_at/
// status{state,silenced_by,inhibited_by}/notify_status（snake_case），且上游走 v2 路径。
func TestListEndpointHappy(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)
	r := newAlertsRouter(svc)

	code, out := doListAlerts(t, r, "")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.Items, 5)

	it := out.Data.Items[0]
	assert.Equal(t, "HighCPU", it["labels"].(map[string]interface{})["alertname"])
	assert.Equal(t, "active", it["notify_status"])
	assert.NotEmpty(t, it["starts_at"])
	assert.NotEmpty(t, it["ends_at"])
	st := it["status"].(map[string]interface{})
	assert.Equal(t, "active", st["state"])
	_, hasSilencedBy := st["silenced_by"]
	assert.True(t, hasSilencedBy, "status 应含 silenced_by")
	_, hasInhibitedBy := st["inhibited_by"]
	assert.True(t, hasInhibitedBy, "status 应含 inhibited_by")

	// 决策 61：只调用 v2 口径端点。
	for _, p := range f.recordedPaths {
		assert.Equal(t, "/api/v2/alerts", p, fmt.Sprintf("禁止调用 v1 端点，命中：%s", p))
	}
}

// TestListEndpointUXFilter 覆盖 network_domain Query 透传筛选。
func TestListEndpointUXFilter(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)
	r := newAlertsRouter(svc)

	code, out := doListAlerts(t, r, "?network_domain=dmz")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Items, 2)
}

// TestListEndpointEmptyNotNull 覆盖空结果返回 [] 而非 null。
func TestListEndpointEmptyNotNull(t *testing.T) {
	f := &fakeAMAlerts{payload: []amAlert{}}
	svc := newTestService(t, f)
	r := newAlertsRouter(svc)

	code, out := doListAlerts(t, r, "")
	require.Equal(t, http.StatusOK, code)
	assert.NotNil(t, out.Data.Items)
	assert.Empty(t, out.Data.Items)

	// 无匹配过滤同样返回空数组。
	f2 := &fakeAMAlerts{payload: amFixture()}
	svc2 := newTestService(t, f2)
	r2 := newAlertsRouter(svc2)
	code2, out2 := doListAlerts(t, r2, "?network_domain=no-such")
	require.Equal(t, http.StatusOK, code2)
	assert.Empty(t, out2.Data.Items)
}

// TestListEndpointAMError 覆盖 AM 不可达 / 非 2xx → internal 可观测错误（契约 §10.2）。
func TestListEndpointAMError(t *testing.T) {
	// AM 非 2xx。
	f := &fakeAMAlerts{statusCode: http.StatusInternalServerError}
	svc := newTestService(t, f)
	r := newAlertsRouter(svc)
	code, out := doListAlerts(t, r, "")
	assert.Equal(t, http.StatusInternalServerError, code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "internal", out.ErrorType)

	// AM 不可达（连接拒绝）。
	proxy, err := NewProxy("http://127.0.0.1:1")
	require.NoError(t, err)
	r2 := newAlertsRouter(NewService(proxy, nil))
	code2, out2 := doListAlerts(t, r2, "")
	assert.Equal(t, http.StatusInternalServerError, code2)
	assert.Equal(t, "internal", out2.ErrorType)
}

// --- 实例字段回连（M08 v1.15 决策 70） ---

var amAlertsDBCounter int64

// openAlertsIdentityDB 打开逐测试独享的内存 SQLite 并迁移五类资源表（回连 M01 用）。
func openAlertsIdentityDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := fmt.Sprintf("file:am_alerts_%d?mode=memory&cache=shared", atomic.AddInt64(&amAlertsDBCounter, 1))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(
		&models.Host{},
		&models.Database{},
		&models.Middleware{},
		&models.Application{},
		&models.GenericTarget{},
	))
	return db
}

// TestServiceListInstanceFieldsResolvedFromM01 覆盖 M08 v1.15 决策 70：AM 通知状态链路
// 同样按 labels.resource_id 只读回连 M01 五类资源表回填实例名；instance_address 恒为
// 采集地址（instance 标签），instance_display 兼容字段优先取可读实例名。
func TestServiceListInstanceFieldsResolvedFromM01(t *testing.T) {
	db := openAlertsIdentityDB(t)
	require.NoError(t, db.Create(&models.Host{
		ResourceID:       "res-1",
		ServerID:         "res-1",
		ResourceCategory: models.ResourceCategoryHost,
		NetworkDomainID:  "default",
		BizCode:          "infra",
		SourceType:       models.SourceTypeManual,
		InstanceName:     "ceshi",
		Status:           "online",
		Region:           "cn",
		ZoneEnv:          "dev",
		InstanceSpec:     "2c4g",
		Image:            "linux",
		VPC:              "vpc-1",
		SecurityGroup:    "sg-1",
		PrivateIP:        "1.15.94.116",
	}).Error)

	now := time.Now().UTC().Truncate(time.Second)
	f := &fakeAMAlerts{payload: []amAlert{{
		Labels: map[string]string{
			"alertname":   "HighCPU",
			"instance":    "1.15.94.116:9100",
			"resource_id": "res-1",
		},
		Annotations: map[string]string{"summary": "cpu high"},
		StartsAt:    now.Add(-time.Hour),
		EndsAt:      now.Add(time.Hour),
		Status:      amAlertStatus{State: "active"},
	}}}
	proxy, err := NewProxy(startFakeAMAlerts(t, f))
	require.NoError(t, err)
	svc := NewService(proxy, db)

	items, err := svc.List(context.Background(), nil, "")
	require.NoError(t, err)
	require.Len(t, items, 1)

	got := items[0]
	assert.Equal(t, "1.15.94.116:9100", got.InstanceAddress)
	assert.Equal(t, "ceshi", got.ResourceName)
	assert.Equal(t, "ceshi", got.InstanceDisplay)
	assert.Equal(t, "res-1", got.ResourceID)
	assert.Equal(t, "host", got.ResourceCategory)
	assert.Equal(t, "1.15.94.116", got.ResourceIP)
	assert.Equal(t, 0, got.ResourcePort)
	assert.Equal(t, "default", got.Labels["network_domain"], "网域回写不受实例字段影响")
}

// TestServiceListInstanceFieldsWithoutResourceID 覆盖无 resource_id 的例外路径
// （拨测 Job 的 target 组无标签）：实例名为空、采集地址保留原值。
func TestServiceListInstanceFieldsWithoutResourceID(t *testing.T) {
	f := &fakeAMAlerts{payload: amFixture()}
	svc := newTestService(t, f)

	items, err := svc.List(context.Background(), nil, "")
	require.NoError(t, err)
	require.NotEmpty(t, items)

	assert.Equal(t, "10.0.0.1:9100", items[0].InstanceAddress)
	assert.Empty(t, items[0].ResourceName, "无 resource_id 时实例名为空（前端显示 -）")
	assert.Equal(t, "10.0.0.1:9100", items[0].InstanceDisplay, "兼容字段回落为地址")
}
