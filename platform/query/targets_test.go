package query

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// promTargetsFixture 为 /api/v1/targets 提供一个预置的上游响应。返回三个 target：
//   - job-a 的 t1（up，network_domain=default，resource_id=srv-1）
//   - job-b 的 t2（down，无 network_domain 标签 → 回落 default，无 resource_id）
//   - job-a 的 t3（unknown，network_domain=dmz，resource_id=srv-2）
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
					"health":  "up",
					"lastError": "",
				},
				{
					"scrapePool": "job-b",
					"labels": map[string]interface{}{
						"job":      "job-b",
						"instance": "10.0.0.2:9100",
					},
					"health":  "down",
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
			},
			"droppedTargets": []interface{}{},
			"targetsByJob":   map[string]interface{}{},
		},
	}
}

// newTargetsRouter 构造一个 fake upstream（/api/v1/targets 返回固定 fixture）并挂载
// TargetsHandler，返回 router 与 fixture。
func newTargetsRouter(t *testing.T) (*gin.Engine, fakeUpstream) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	fake := newFakeUpstream(promTargetsFixture())
	u, err := url.Parse(fake.server.URL)
	require.NoError(t, err)
	r := gin.New()
	r.GET("/api/v1/targets", TargetsHandler(u, http.DefaultClient))
	return r, fake
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
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "")

	require.Equal(t, "success", out.Status)
	require.Len(t, out.Data.ActiveTargets, 3)

	// t1 补全：job / network_domain / resource_id 均注入。
	t1 := out.Data.ActiveTargets[0]
	require.Equal(t, "job-a", t1["job"])
	require.Equal(t, "default", t1["network_domain"])
	require.Equal(t, "srv-1", t1["resource_id"])
	// 原始字段透传保留。
	require.Equal(t, "10.0.0.1:9100", t1["labels"].(map[string]interface{})["instance"])
	require.Equal(t, "up", t1["health"])
}

func TestTargetsNetworkDomainFallbackDefault(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "")
	require.Len(t, out.Data.ActiveTargets, 3)

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
}

func TestTargetsFilterJob(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?job=job-a")
	require.Len(t, out.Data.ActiveTargets, 2)
	for _, a := range out.Data.ActiveTargets {
		require.Equal(t, "job-a", a["job"])
	}
}

func TestTargetsFilterNetworkDomain(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?network_domain=dmz")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "srv-2", out.Data.ActiveTargets[0]["resource_id"])
}

func TestTargetsFilterHealth(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?health=down")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "connection refused", out.Data.ActiveTargets[0]["lastError"])
}

func TestTargetsFilterCombination(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?job=job-a&network_domain=dmz&health=unknown")
	require.Len(t, out.Data.ActiveTargets, 1)
	require.Equal(t, "srv-2", out.Data.ActiveTargets[0]["resource_id"])
}

func TestTargetsInvalidHealthBadRequest(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?health=garbage")
	require.Equal(t, "error", out.Status)
	require.Equal(t, "bad_request", out.ErrorType)
	require.Contains(t, out.Error, "health")
}

func TestTargetsFilterNoMatchEmptyActive(t *testing.T) {
	r, _ := newTargetsRouter(t)
	out := doTargets(t, r, "?job=no-such-job")
	require.Equal(t, "success", out.Status)
	require.Empty(t, out.Data.ActiveTargets) // [] 而非 null
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