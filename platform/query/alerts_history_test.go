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
	"gorm.io/gorm"
)

// historyMatrixFixture 构造 Prometheus query_range 上游响应（matrix 信封）。
func historyMatrixFixture() map[string]interface{} {
	now := time.Now().Unix()
	// 构造两条序列：
	// - s1：HighCPU 在 default 域，instance 10.0.0.1，当前仍在触发（最后一个样本在 now-30s）。
	// - s2：HostTargetsMissing 聚合告警（无 instance），已恢复（样本结束于 5 分钟前）。
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"resultType": "matrix",
			"result": []map[string]interface{}{
				{
					"metric": map[string]interface{}{
						"__name__":       "ALERTS",
						"alertname":      "HighCPU",
						"alertstate":     "firing",
						"network_domain": "default",
						"instance":       "10.0.0.1:9100",
						"severity":       "critical",
					},
					"values": [][2]interface{}{
						{float64(now - 240), "1"},
						{float64(now - 210), "1"},
						{float64(now - 180), "1"},
						{float64(now - 150), "1"},
						{float64(now - 120), "1"},
						{float64(now - 90), "1"},
						{float64(now - 60), "1"},
						{float64(now - 30), "1"},
					},
				},
				{
					"metric": map[string]interface{}{
						"__name__":   "ALERTS",
						"alertname":  "HostTargetsMissing",
						"alertstate": "firing",
						"severity":   "critical",
					},
					"values": [][2]interface{}{
						{float64(now - 600), "1"},
						{float64(now - 570), "1"},
						{float64(now - 540), "1"},
					},
				},
			},
		},
	}
}

// historyRulesFixture 构造 Prometheus /api/v1/rules 上游响应，用于 summary 回填。
func historyRulesFixture() map[string]interface{} {
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"groups": []map[string]interface{}{
				{
					"name": "node",
					"rules": []map[string]interface{}{
						{
							"name":        "HighCPU",
							"annotations": map[string]interface{}{"summary": "CPU 使用率过高"},
						},
						{
							"name":        "HostTargetsMissing",
							"annotations": map[string]interface{}{"summary": "主机监控目标全部丢失"},
						},
					},
				},
			},
		},
	}
}

// newHistoryRouter 以指定上游处理器挂载 AlertsHistoryHandler。
// dbs 可选：传入非 nil 时用于按 resource_id 回连 M01 的实例字段测试（决策 70）。
func newHistoryRouter(t *testing.T, upstream http.Handler, dbs ...*gorm.DB) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	var db *gorm.DB
	if len(dbs) > 0 {
		db = dbs[0]
	}
	srv := httptest.NewServer(upstream)
	t.Cleanup(srv.Close)
	u, err := url.Parse(srv.URL)
	require.NoError(t, err)
	r := gin.New()
	r.GET("/api/v1/alerts/history", AlertsHistoryHandler(db, u, http.DefaultClient))
	return r
}

// doHistory 请求 /api/v1/alerts/history 并解码响应。
func doHistory(t *testing.T, r *gin.Engine, query string) (int, map[string]interface{}) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/alerts/history"+query, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var out map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out))
	return w.Code, out
}

func TestAlertHistoryRebuildsIntervals(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/api/v1/query_range":
			body, _ := json.Marshal(historyMatrixFixture())
			_, _ = w.Write(body)
		case req.URL.Path == "/api/v1/rules":
			body, _ := json.Marshal(historyRulesFixture())
			_, _ = w.Write(body)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))

	code, out := doHistory(t, r, "")
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, "success", out["status"])

	data := out["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	require.Len(t, list, 2)

	// 按触发时间倒序，第一条应为 HighCPU（firing）。
	first := list[0].(map[string]interface{})
	assert.Equal(t, "HighCPU", first["alertname"])
	assert.Equal(t, "10.0.0.1:9100", first["instance"])
	assert.Equal(t, "default", first["network_domain"])
	assert.Equal(t, "firing", first["state"])
	assert.Nil(t, first["resolved_at"])
	assert.Equal(t, "CPU 使用率过高", first["summary"])
	assert.Equal(t, "1", first["value"])
	assert.True(t, first["duration_seconds"].(float64) >= 240)

	// 第二条 HostTargetsMissing 已恢复。
	second := list[1].(map[string]interface{})
	assert.Equal(t, "HostTargetsMissing", second["alertname"])
	assert.Equal(t, "resolved", second["state"])
	assert.NotNil(t, second["resolved_at"])
	assert.Equal(t, "", second["instance"])
	assert.Equal(t, "", second["instance_display"])
}

func TestAlertHistoryFilterByNetworkDomain(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/api/v1/query_range":
			body, _ := json.Marshal(historyMatrixFixture())
			_, _ = w.Write(body)
		case req.URL.Path == "/api/v1/rules":
			body, _ := json.Marshal(historyRulesFixture())
			_, _ = w.Write(body)
		}
	}))

	code, out := doHistory(t, r, "?network_domain=dmz")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	assert.Empty(t, data["list"])
	assert.Equal(t, float64(0), data["total"])
}

// TestAlertHistoryNetworkDomainFromExternalLabelKey 覆盖写入侧 external_labels 键的读取：
// ALERTS 序列在中心 TSDB 中由边缘网域 remote_write 回传时携带 M09 external_labels
// 键 network_domain_id（决策 19），历史告警网域需按它解析而非回落 default。
func TestAlertHistoryNetworkDomainFromExternalLabelKey(t *testing.T) {
	now := time.Now().Unix()
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/api/v1/query_range":
			body, _ := json.Marshal(map[string]interface{}{
				"status": "success",
				"data": map[string]interface{}{
					"resultType": "matrix",
					"result": []map[string]interface{}{
						{
							"metric": map[string]interface{}{
								"__name__":          "ALERTS",
								"alertname":         "HostDown",
								"alertstate":        "firing",
								"network_domain_id": "gov-cloud-a",
								"instance":          "10.0.0.9:9100",
							},
							"values": [][2]interface{}{
								{float64(now - 90), "1"},
								{float64(now - 60), "1"},
								{float64(now - 30), "1"},
							},
						},
					},
				},
			})
			_, _ = w.Write(body)
		case "/api/v1/rules":
			_, _ = w.Write([]byte(`{"status":"success","data":{"groups":[]}}`))
		}
	}))

	code, out := doHistory(t, r, "")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	require.Len(t, list, 1)
	assert.Equal(t, "gov-cloud-a", list[0].(map[string]interface{})["network_domain"])

	// 网域筛选按解析结果收敛。
	_, filtered := doHistory(t, r, "?network_domain=gov-cloud-a")
	assert.Len(t, filtered["data"].(map[string]interface{})["list"], 1)
	_, miss := doHistory(t, r, "?network_domain=default")
	assert.Empty(t, miss["data"].(map[string]interface{})["list"])
}

func TestAlertHistoryFilterByState(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/api/v1/query_range":
			body, _ := json.Marshal(historyMatrixFixture())
			_, _ = w.Write(body)
		case req.URL.Path == "/api/v1/rules":
			body, _ := json.Marshal(historyRulesFixture())
			_, _ = w.Write(body)
		}
	}))

	code, out := doHistory(t, r, "?state=resolved")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	require.Len(t, list, 1)
	assert.Equal(t, "HostTargetsMissing", list[0].(map[string]interface{})["alertname"])
}

func TestAlertHistoryFilterByStateFiring(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/api/v1/query_range":
			body, _ := json.Marshal(historyMatrixFixture())
			_, _ = w.Write(body)
		case req.URL.Path == "/api/v1/rules":
			body, _ := json.Marshal(historyRulesFixture())
			_, _ = w.Write(body)
		}
	}))

	code, out := doHistory(t, r, "?state=firing")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	list := data["list"].([]interface{})
	require.Len(t, list, 1)
	assert.Equal(t, "HighCPU", list[0].(map[string]interface{})["alertname"])
}

func TestAlertHistoryPagination(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case req.URL.Path == "/api/v1/query_range":
			body, _ := json.Marshal(historyMatrixFixture())
			_, _ = w.Write(body)
		case req.URL.Path == "/api/v1/rules":
			body, _ := json.Marshal(historyRulesFixture())
			_, _ = w.Write(body)
		}
	}))

	code, out := doHistory(t, r, "?page_size=1&page=1")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	assert.Len(t, data["list"], 1)
	assert.Equal(t, float64(2), data["total"])
	assert.Equal(t, float64(1), data["page"])
	assert.Equal(t, float64(1), data["page_size"])
}

func TestAlertHistoryTimeWindowClamped(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		body, _ := json.Marshal(map[string]interface{}{
			"status": "success",
			"data":   map[string]interface{}{"resultType": "matrix", "result": []interface{}{}},
		})
		_, _ = w.Write(body)
	}))

	// 请求 30 天时间窗，应被压缩到 7d 并正常返回。
	params := url.Values{}
	params.Set("start", time.Now().Add(-30*24*time.Hour).Format(time.RFC3339))
	params.Set("end", time.Now().Format(time.RFC3339))
	code, out := doHistory(t, r, "?"+params.Encode())
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	assert.Empty(t, data["list"])
}

func TestAlertHistoryEmptyNotNull(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/api/v1/query_range":
			_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[]}}`))
		case "/api/v1/rules":
			_, _ = w.Write([]byte(`{"status":"success","data":{"groups":[]}}`))
		}
	}))

	code, out := doHistory(t, r, "")
	require.Equal(t, http.StatusOK, code)
	data := out["data"].(map[string]interface{})
	assert.NotNil(t, data["list"])
	assert.Empty(t, data["list"])
}

func TestAlertHistoryUpstreamError(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"error","errorType":"internal","error":"boom"}`))
	}))

	code, out := doHistory(t, r, "")
	assert.Equal(t, http.StatusInternalServerError, code)
	assert.Equal(t, "error", out["status"])
	assert.Equal(t, "internal", out["errorType"])
}

func TestAlertHistoryInvalidState(t *testing.T) {
	r := newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"matrix","result":[]}}`))
	}))

	code, out := doHistory(t, r, "?state=invalid")
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Equal(t, "error", out["status"])
	assert.Equal(t, "bad_request", out["errorType"])
}

// historyIdentityFixture 构造带 resource_id 的 matrix fixture（用于回连 M01 测试）。
func historyIdentityFixture() map[string]interface{} {
	now := time.Now().Unix()
	return map[string]interface{}{
		"status": "success",
		"data": map[string]interface{}{
			"resultType": "matrix",
			"result": []map[string]interface{}{
				{
					"metric": map[string]interface{}{
						"__name__":    "ALERTS",
						"alertname":   "HighCPU",
						"alertstate":  "firing",
						"instance":    "10.0.0.1:9100",
						"resource_id": "res-1",
						"severity":    "critical",
					},
					"values": [][2]interface{}{
						{float64(now - 90), "1"},
						{float64(now - 60), "1"},
						{float64(now - 30), "1"},
					},
				},
			},
		},
	}
}

// newHistoryIdentityRouter 挂载带 db（回连 M01）的历史告警路由。
func newHistoryIdentityRouter(t *testing.T, db *gorm.DB) *gin.Engine {
	t.Helper()
	return newHistoryRouter(t, http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch req.URL.Path {
		case "/api/v1/query_range":
			body, _ := json.Marshal(historyIdentityFixture())
			_, _ = w.Write(body)
		case "/api/v1/rules":
			body, _ := json.Marshal(historyRulesFixture())
			_, _ = w.Write(body)
		}
	}), db)
}

// TestAlertHistoryInstanceFieldsWriteBack 覆盖 v1.15 决策 70：历史告警同样按
// resource_id 回连回填实例名，且 instance_address 恒为采集地址。
func TestAlertHistoryInstanceFieldsWriteBack(t *testing.T) {
	db := openResourceIdentityTestDB(t)
	seedIdentityHost(t, db, "res-1", "ceshi", "10.0.0.1")

	code, out := doHistory(t, newHistoryIdentityRouter(t, db), "")
	require.Equal(t, http.StatusOK, code)
	list := out["data"].(map[string]interface{})["list"].([]interface{})
	require.Len(t, list, 1)

	row := list[0].(map[string]interface{})
	assert.Equal(t, "10.0.0.1:9100", row["instance_address"])
	assert.Equal(t, "ceshi", row["resource_name"])
	assert.Equal(t, "ceshi", row["instance_display"])
	assert.Equal(t, "host", row["resource_category"])
	assert.Equal(t, "10.0.0.1", row["resource_ip"])
}

// TestAlertHistoryFilterByInstanceName 覆盖「实例」筛选同时匹配实例名与采集地址
// （v1.15 决策 70）：展示改造后用户按 M01 实例名 `ceshi` 也必须能搜到。
func TestAlertHistoryFilterByInstanceName(t *testing.T) {
	db := openResourceIdentityTestDB(t)
	seedIdentityHost(t, db, "res-1", "ceshi", "10.0.0.1")
	r := newHistoryIdentityRouter(t, db)

	// 按实例名命中。
	_, byName := doHistory(t, r, "?instance=ceshi")
	assert.Len(t, byName["data"].(map[string]interface{})["list"], 1)

	// 按采集地址命中。
	_, byAddr := doHistory(t, r, "?instance=10.0.0.1%3A9100")
	assert.Len(t, byAddr["data"].(map[string]interface{})["list"], 1)

	// 不匹配时为空。
	_, miss := doHistory(t, r, "?instance=no-such")
	assert.Empty(t, miss["data"].(map[string]interface{})["list"])
}

// 注意：strconv 仅在最后一个测试用例使用；为保持简洁放在文件顶部统一 import。
