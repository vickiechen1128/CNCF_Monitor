package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	return NewService(proxy)
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

// TestServiceListAMUnreachable 覆盖 AM 不可达 → 可观测错误。
func TestServiceListAMUnreachable(t *testing.T) {
	proxy, err := NewProxy("http://127.0.0.1:1")
	require.NoError(t, err)
	svc := NewService(proxy)
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
	r2 := newAlertsRouter(NewService(proxy))
	code2, out2 := doListAlerts(t, r2, "")
	assert.Equal(t, http.StatusInternalServerError, code2)
	assert.Equal(t, "internal", out2.ErrorType)
}
