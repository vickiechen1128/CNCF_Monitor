package query

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// promAlertsFixture 为 /api/v1/alerts 提供预置上游响应（Prometheus 信封）。三条告警：
//   - a1：firing，labels 含 alertname/severity/network_domain=default/instance；
//   - a2：pending，无 network_domain 标签（→ 回落 default）；
//   - a3：firing，network_domain=dmz。
func promAlertsFixture() map[string]interface{} {
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"alerts": []map[string]interface{}{
				{
					"labels": map[string]interface{}{
						"alertname":      "HighCPU",
						"severity":       "critical",
						"network_domain": "default",
						"instance":       "10.0.0.1:9100",
					},
					"annotations": map[string]interface{}{"summary": "cpu high"},
					"state":       "firing",
					"activeAt":    "2026-09-08T01:00:00Z",
					"value":       "98",
				},
				{
					"labels": map[string]interface{}{
						"alertname": "DiskFull",
						"severity":  "warning",
						"instance":  "10.0.0.2:9100",
					},
					"annotations": map[string]interface{}{"summary": "disk full"},
					"state":       "pending",
					"activeAt":    "2026-09-08T02:00:00Z",
					"value":       "0.91",
				},
				{
					"labels": map[string]interface{}{
						"alertname":      "NodeDown",
						"severity":       "critical",
						"network_domain": "dmz",
						"instance":       "10.0.0.3:9100",
					},
					"annotations": map[string]interface{}{"summary": "node down"},
					"state":       "firing",
					"activeAt":    "2026-09-08T03:00:00Z",
					"value":       "0",
				},
			},
		},
	}
}

// alertsResp 镜像 /api/v1/alerts 统一响应信封。
type alertsResp struct {
	Status    string `json:"status"`
	ErrorType string `json:"errorType"`
	Error     string `json:"error"`
	Data      struct {
		Alerts []map[string]interface{} `json:"alerts"`
	} `json:"data"`
}

// newAlertsRouter 以指定上游处理器挂载 AlertsHandler。
func newAlertsRouter(t *testing.T, upstream http.Handler) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	srv := httptest.NewServer(upstream)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	r := gin.New()
	r.GET("/api/v1/alerts", AlertsHandler(u, http.DefaultClient))
	return r
}

func newAlertsRouterOK(t *testing.T) *gin.Engine {
	t.Helper()
	body, err := json.Marshal(promAlertsFixture())
	require.NoError(t, err)
	return newAlertsRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
}

// doAlerts 以指定 query 请求 /api/v1/alerts 并解码响应。
func doAlerts(t *testing.T, r *gin.Engine, query string) (int, alertsResp) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/alerts"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out alertsResp
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

// TestAlertsPassthroughFields 覆盖契约快照 §10.1：data.alerts 返回 firing/pending
// 实例字段子集 labels/annotations/state/activeAt/value。
func TestAlertsPassthroughFields(t *testing.T) {
	r := newAlertsRouterOK(t)
	code, out := doAlerts(t, r, "")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.Alerts, 3)

	a1 := out.Data.Alerts[0]
	labels := a1["labels"].(map[string]interface{})
	assert.Equal(t, "HighCPU", labels["alertname"])
	assert.Equal(t, "critical", labels["severity"])
	assert.Equal(t, "default", labels["network_domain"])
	assert.Equal(t, "10.0.0.1:9100", labels["instance"])
	assert.Equal(t, "cpu high", a1["annotations"].(map[string]interface{})["summary"])
	assert.Equal(t, "firing", a1["state"])
	assert.Equal(t, "2026-09-08T01:00:00Z", a1["activeAt"])
	assert.Equal(t, "98", a1["value"])
}

// TestAlertsFilterNetworkDomain 覆盖 network_domain 服务端本地过滤（前端不重复过滤）。
func TestAlertsFilterNetworkDomain(t *testing.T) {
	r := newAlertsRouterOK(t)
	_, out := doAlerts(t, r, "?network_domain=dmz")
	require.Len(t, out.Data.Alerts, 1)
	labels := out.Data.Alerts[0]["labels"].(map[string]interface{})
	assert.Equal(t, "NodeDown", labels["alertname"])
}

// TestAlertsNetworkDomainFallbackDefault 覆盖缺失 network_domain 标签时回落 default：
// 过滤 default 应命中 a1（显式 default）与 a2（无标签回落）。
func TestAlertsNetworkDomainFallbackDefault(t *testing.T) {
	r := newAlertsRouterOK(t)
	_, out := doAlerts(t, r, "?network_domain=default")
	require.Len(t, out.Data.Alerts, 2)
	names := []string{
		out.Data.Alerts[0]["labels"].(map[string]interface{})["alertname"].(string),
		out.Data.Alerts[1]["labels"].(map[string]interface{})["alertname"].(string),
	}
	assert.Contains(t, names, "HighCPU")
	assert.Contains(t, names, "DiskFull")
}

// TestAlertsNetworkDomainWriteBack 覆盖「网域」列的取值链路修复（契约快照 §10.1）：
// 上游 Prometheus /api/v1/alerts 的标签是规则求值标签，不含 external_labels，
// 因此代理必须把解析 + 回落结果回写进响应 labels.network_domain——
// 否则前端「网域」列对每一行都渲染为 '-'（本次缺陷根因）。
func TestAlertsNetworkDomainWriteBack(t *testing.T) {
	r := newAlertsRouterOK(t)
	code, out := doAlerts(t, r, "")
	require.Equal(t, http.StatusOK, code)
	require.Len(t, out.Data.Alerts, 3)

	byName := map[string]map[string]interface{}{}
	for _, a := range out.Data.Alerts {
		labels := a["labels"].(map[string]interface{})
		byName[labels["alertname"].(string)] = labels
	}

	// a1 显式携带 → 原值透传。
	assert.Equal(t, "default", byName["HighCPU"]["network_domain"])
	// a2 缺失 → 回写回落值 default（修复前该键不存在，前端渲染 '-'）。
	assert.Equal(t, "default", byName["DiskFull"]["network_domain"])
	// a3 显式携带 dmz → 原值透传。
	assert.Equal(t, "dmz", byName["NodeDown"]["network_domain"])
}

// TestAlertsNetworkDomainFromExternalLabelKey 覆盖写入侧 external_labels 键的读取：
// 边缘网域经 vmagent remote_write 回传的序列（及发往 Alertmanager 的告警）携带的是
// M09 external_labels 键 network_domain_id（决策 19），代理需归一为消费侧
// network_domain 再回写，前端才能显示真实网域而非 default。
func TestAlertsNetworkDomainFromExternalLabelKey(t *testing.T) {
	fixture := map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"alerts": []map[string]interface{}{
				{
					"labels": map[string]interface{}{
						"alertname":         "HighCPU",
						"network_domain_id": "gov-cloud-a",
						"instance":          "10.0.0.1:9100",
					},
					"annotations": map[string]interface{}{"summary": "cpu high"},
					"state":       "firing",
					"activeAt":    "2026-09-08T01:00:00Z",
					"value":       "98",
				},
			},
		},
	}
	body, err := json.Marshal(fixture)
	require.NoError(t, err)
	r := newAlertsRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))

	_, out := doAlerts(t, r, "")
	require.Len(t, out.Data.Alerts, 1)
	labels := out.Data.Alerts[0]["labels"].(map[string]interface{})
	assert.Equal(t, "gov-cloud-a", labels["network_domain"], "应归一为消费侧契约键")

	// 服务端本地过滤按归一后的网域生效。
	_, filtered := doAlerts(t, r, "?network_domain=gov-cloud-a")
	assert.Len(t, filtered.Data.Alerts, 1)
	_, miss := doAlerts(t, r, "?network_domain=default")
	assert.Empty(t, miss.Data.Alerts)
}

// TestAlertsEmptyNotNull 覆盖空结果返回 [] 而非 null。
func TestAlertsEmptyNotNull(t *testing.T) {
	r := newAlertsRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"alerts":[]}}`))
	}))
	code, out := doAlerts(t, r, "")
	require.Equal(t, http.StatusOK, code)
	assert.NotNil(t, out.Data.Alerts)
	assert.Empty(t, out.Data.Alerts)

	// 无匹配过滤同样返回空数组。
	r2 := newAlertsRouterOK(t)
	code2, out2 := doAlerts(t, r2, "?network_domain=no-such")
	require.Equal(t, http.StatusOK, code2)
	assert.Empty(t, out2.Data.Alerts)
}

// TestAlertsUpstreamError 覆盖上游非 success / 非 200 / 不可达 → internal 可观测错误。
func TestAlertsUpstreamError(t *testing.T) {
	// 上游返回 status=error。
	r := newAlertsRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"error","errorType":"internal","error":"boom"}`))
	}))
	code, out := doAlerts(t, r, "")
	assert.Equal(t, http.StatusInternalServerError, code)
	assert.Equal(t, "error", out.Status)
	assert.Equal(t, "internal", out.ErrorType)

	// 上游 HTTP 500。
	r2 := newAlertsRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	code2, out2 := doAlerts(t, r2, "")
	assert.Equal(t, http.StatusInternalServerError, code2)
	assert.Equal(t, "internal", out2.ErrorType)

	// 上游不可达（连接拒绝）。
	gin.SetMode(gin.TestMode)
	u, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	r3 := gin.New()
	r3.GET("/api/v1/alerts", AlertsHandler(u, &http.Client{Timeout: time.Second}))
	code3, out3 := doAlerts(t, r3, "")
	assert.Equal(t, http.StatusInternalServerError, code3)
	assert.Equal(t, "internal", out3.ErrorType)
}

// TestAlertsInstanceDisplay 覆盖 instance_display 聚合字段：有 instance 标签时透传，
// 无 instance 标签时按 instance_ip/hostname/nodename/device 依次回落，均缺失时为空串。
func TestAlertsInstanceDisplay(t *testing.T) {
	r := newAlertsRouterOK(t)
	code, out := doAlerts(t, r, "")
	require.Equal(t, http.StatusOK, code)

	// a1 有 instance 标签。
	assert.Equal(t, "10.0.0.1:9100", out.Data.Alerts[0]["instance_display"])

	// 无 instance 标签但含 instance_ip。
	fixture := promAlertsFixture()
	fixture["data"].(map[string]interface{})["alerts"] = []map[string]interface{}{
		{
			"labels": map[string]interface{}{
				"alertname":   "ByIP",
				"instance_ip": "10.0.0.10",
			},
			"annotations": map[string]interface{}{"summary": "by ip"},
			"state":       "firing",
			"activeAt":    "2026-09-08T01:00:00Z",
			"value":       "1",
		},
		{
			"labels": map[string]interface{}{
				"alertname": "Aggregate",
				"severity":  "critical",
			},
			"annotations": map[string]interface{}{"summary": "aggregate alert"},
			"state":       "firing",
			"activeAt":    "2026-09-08T02:00:00Z",
			"value":       "1",
		},
	}
	body, _ := json.Marshal(fixture)
	r2 := newAlertsRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}))
	_, out2 := doAlerts(t, r2, "")
	require.Len(t, out2.Data.Alerts, 2)
	assert.Equal(t, "10.0.0.10", out2.Data.Alerts[0]["instance_display"])
	assert.Equal(t, "", out2.Data.Alerts[1]["instance_display"])
}

// TestAlertsTenantScopeSkeleton 是租户/网域注入骨架（M02 §11.2#5）的测试锚点：
// MVP 单租户恒通过（nil 集合=不过滤）；非空集合时按网域收敛，机制保留。
func TestAlertsTenantScopeSkeleton(t *testing.T) {
	// MVP：授权集合为空（nil）→ 全部通过。
	assert.True(t, alertDomainAllowed(nil, "default"))
	assert.True(t, alertDomainAllowed(nil, "any-domain"))
	// 骨架语义：非空集合按网域收敛（未来多租户启用）。
	assert.True(t, alertDomainAllowed([]string{"finance", "default"}, "finance"))
	assert.False(t, alertDomainAllowed([]string{"finance"}, "hr"))
}
