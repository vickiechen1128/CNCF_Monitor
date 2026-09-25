package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
)

// sampleTargetsResp 对齐 vmagent /api/v1/targets?state=active 响应结构（data.activeTargets）。
const sampleTargetsResp = `{
	"status":"success",
	"data":{
		"activeTargets":[
			{
				"labels":{"job":"node","instance":"10.0.0.1:9100","resource_id":"res-1"},
				"health":"up",
				"lastScrape":"2026-09-18T12:00:00Z",
				"lastError":"",
				"lastScrapeDuration":0.0123
			},
			{
				"labels":{"job":"node","instance":"10.0.0.2:9100"},
				"health":"down",
				"lastScrape":"2026-09-18T11:59:59Z",
				"lastError":"dial tcp: connection refused",
				"lastScrapeDuration":0.5
			}
		],
		"droppedTargets":[]
	}
}`

// TestParseEdgeTargetsFullMapping 校验解析函数把 vmagent 响应映射为契约快照的所有
// 顶层字段，并覆盖缺失 resource_id 置空。
func TestParseEdgeTargetsFullMapping(t *testing.T) {
	targets, err := parseEdgeTargets([]byte(sampleTargetsResp))
	if err != nil {
		t.Fatalf("parse should succeed: %v", err)
	}
	if len(targets) != 2 {
		t.Fatalf("len = %d want 2", len(targets))
	}

	first := targets[0]
	if first.Job != "node" || first.Instance != "10.0.0.1:9100" {
		t.Fatalf("first identity = %+v", first)
	}
	if first.ResourceID != "res-1" {
		t.Fatalf("resource_id = %q", first.ResourceID)
	}
	if first.Health != "up" {
		t.Fatalf("health = %q", first.Health)
	}
	if first.LastScrape != "2026-09-18T12:00:00Z" {
		t.Fatalf("last_scrape = %q", first.LastScrape)
	}
	if first.ScrapeDurationSeconds != 0.0123 {
		t.Fatalf("scrape_duration_seconds = %v", first.ScrapeDurationSeconds)
	}

	// 第二个 target 无 resource_id → 应置空；last_error 透传。
	second := targets[1]
	if second.ResourceID != "" {
		t.Fatalf("missing resource_id should be empty, got %q", second.ResourceID)
	}
	if second.Health != "down" {
		t.Fatalf("second health = %q", second.Health)
	}
	if second.LastError != "dial tcp: connection refused" {
		t.Fatalf("second last_error = %q", second.LastError)
	}
}

// TestParseEdgeTargetsEmptyActive 空 activeTargets 应返回空切片而非 nil（可安全遍历）。
func TestParseEdgeTargetsEmptyActive(t *testing.T) {
	raw := `{"status":"success","data":{"activeTargets":[],"droppedTargets":[]}}`
	targets, err := parseEdgeTargets([]byte(raw))
	if err != nil {
		t.Fatalf("empty active parse error: %v", err)
	}
	if targets == nil || len(targets) != 0 {
		t.Fatalf("empty active should be non-nil empty slice, got %#v", targets)
	}
}

// TestParseEdgeTargetsInvalidJSON 非法 JSON / 非 success 状态应返回错误。
func TestParseEdgeTargetsInvalidJSON(t *testing.T) {
	if _, err := parseEdgeTargets([]byte(`{invalid`)); err == nil {
		t.Fatal("invalid json should error")
	}
	if _, err := parseEdgeTargets([]byte(`{"status":"error","errorType":"bad_data"}`)); err == nil {
		t.Fatal("error status should error")
	}
}

// TestFetchVMAgentTargets 校验抓取函数：正常返回快照；HTTP 非 200 / 解析失败降级 nil。
func TestFetchVMAgentTargets(t *testing.T) {
	cli := &http.Client{Timeout: 3e9} // 3s
	ctx := context.Background()

	// 正常返回。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/targets" {
			t.Errorf("path = %s", r.URL.Path)
		}
		if got := r.URL.Query().Get("state"); got != "active" {
			t.Errorf("state query = %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(sampleTargetsResp))
	}))
	defer srv.Close()
	targets := fetchVMAgentTargets(ctx, cli, srv.URL, nil)
	if len(targets) != 2 || targets[0].Health != "up" {
		t.Fatalf("normal fetch targets = %+v", targets)
	}

	// HTTP 非 200 → 降级 nil。
	srv500 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv500.Close()
	if got := fetchVMAgentTargets(ctx, cli, srv500.URL, nil); got != nil {
		t.Fatalf("500 should degrade to nil, got %+v", got)
	}

	// 解析失败（200 但坏 JSON）→ 降级 nil。
	srvBad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{bad`))
	}))
	defer srvBad.Close()
	if got := fetchVMAgentTargets(ctx, cli, srvBad.URL, nil); got != nil {
		t.Fatalf("bad json should degrade to nil, got %+v", got)
	}

	// 连接失败 → 降级 nil。
	srvClosed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := srvClosed.URL
	srvClosed.Close()
	if got := fetchVMAgentTargets(ctx, cli, closedURL, nil); got != nil {
		t.Fatalf("connection error should degrade to nil, got %+v", got)
	}
}

// TestFetchVMAgentTargetsContractType 校验返回类型是契约快照（字段可对齐序列化）。
func TestFetchVMAgentTargetsContractType(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(sampleTargetsResp))
	}))
	defer srv.Close()
	targets := fetchVMAgentTargets(context.Background(), &http.Client{Timeout: 3e9}, srv.URL, nil)
	if _, ok := interface{}(targets[0]).(contract.EdgeTargetSnapshot); !ok {
		t.Fatalf("want []contract.EdgeTargetSnapshot, got %T", targets[0])
	}
}
