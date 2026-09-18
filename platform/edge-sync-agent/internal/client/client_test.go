package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/token"
)

func testCfg(endpoint string) *config.Config {
	c := config.Defaults()
	c.CenterEndpoint = endpoint
	c.NetworkDomainID = "gov-cloud-a"
	c.Token = "tok"
	return c
}

// newTestClient builds client with no-op sleep and a controllable clock.
func newTestClient(endpoint string, clock func() time.Time) *Client {
	cfg := testCfg(endpoint)
	c := NewClient(cfg, token.NewStore(cfg.Token), logger.New(nil))
	c.throttle = token.NewThrottle(cfg.BackoffMin, cfg.BackoffMax,
		cfg.AuthDowngradeAfter, cfg.AuthDowngradeInterval, clock)
	return c
}

func TestHeartbeatSuccessParsesResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != contract.HeartbeatPath {
			t.Errorf("path = %s want %s", r.URL.Path, contract.HeartbeatPath)
		}
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("auth header = %q", r.Header.Get("Authorization"))
		}
		// 对齐中心统一响应信封 {status,data:{...}}（platform/api/response）。
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "success",
			"data": contract.HeartbeatResponse{
				ConfigChanged:     true,
				ConfigVersion:     "v2",
				ConfigDownloadURL: "https://x/config",
			},
		})
	}))
	defer srv.Close()
	c := newTestClient(srv.URL, time.Now)

	resp, err := c.Heartbeat(context.Background(), contract.HeartbeatRequest{NetworkDomainID: "gov-cloud-a"})
	if err != nil {
		t.Fatal(err)
	}
	if !resp.ConfigChanged || resp.ConfigDownloadURL != "https://x/config" {
		t.Fatalf("unexpected %+v", resp)
	}
	// 心跳成功应重置 401 状态。
	if c.ConsecutiveAuthFailures() != 0 {
		t.Fatalf("consecutive not reset: %d", c.ConsecutiveAuthFailures())
	}
}

func TestHeartbeatReturnsAuthOn401(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	c := newTestClient(srv.URL, time.Now)

	_, err := c.Heartbeat(context.Background(), contract.HeartbeatRequest{})
	if !errors.Is(err, Errauth) {
		t.Fatalf("err = %v want Errauth", err)
	}
}

func TestPullConfigReturnsBytes(t *testing.T) {
	body := []byte("zip-bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			t.Errorf("auth = %q", r.Header.Get("Authorization"))
		}
		w.Write(body)
	}))
	defer srv.Close()
	c := newTestClient(srv.URL, time.Now)

	got, err := c.PullConfig(context.Background(), srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "zip-bytes" {
		t.Fatalf("got %q", got)
	}
}

func TestPullConfigAuthOn401(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	c := newTestClient(srv.URL, time.Now)
	_, err := c.PullConfig(context.Background(), srv.URL)
	if !errors.Is(err, Errauth) {
		t.Fatalf("err = %v want Errauth", err)
	}
}

func TestWaitAuthBackoffBackoffSequenceAndDowngrade(t *testing.T) {
	// 可控时钟 + 无操作 sleep。
	now := time.Unix(1700000000, 0)
	tm := &now
	clock := func() time.Time { return *tm }
	origSleep := sleepF
	sleepF = func(_ context.Context, _ time.Duration) {}
	defer func() { sleepF = origSleep }()

	c := newTestClient("http://x", clock)

	// 连续 401：前几次为指数退避，累计时间推到 >10min 后降频。
	for i := 0; i < 5; i++ {
		*tm = tm.Add(2 * time.Second)
		if _, downgraded := c.WaitAuthBackoff(context.Background()); downgraded {
			t.Fatal("should not downgrade before 10min")
		}
	}
	*tm = now.Add(11 * time.Minute)
	if _, downgraded := c.WaitAuthBackoff(context.Background()); !downgraded {
		t.Fatal("expected downgrade")
	}
}

// 验证降频时通过 logger 写入 WARN（对应 PRD 写本地 syslog 语义）。
func TestWaitAuthBackoffLogsDowngrade(t *testing.T) {
	var buf bytes.Buffer
	now := time.Unix(1700000000, 0)
	tm := &now
	clock := func() time.Time { return *tm }
	origSleep := sleepF
	sleepF = func(_ context.Context, _ time.Duration) {}
	defer func() { sleepF = origSleep }()

	cfg := testCfg("")
	c := NewClient(cfg, token.NewStore(cfg.Token), logger.New(&buf))
	c.throttle = token.NewThrottle(cfg.BackoffMin, cfg.BackoffMax,
		cfg.AuthDowngradeAfter, cfg.AuthDowngradeInterval, clock)

	// 首次 401 记录失败起点（此刻 failStart=now）。
	c.WaitAuthBackoff(context.Background())
	// 累计时间超过 10min 后再 401 → 触发降频并写 WARN 日志。
	*tm = now.Add(11 * time.Minute)
	c.WaitAuthBackoff(context.Background())

	if !strings.Contains(buf.String(), "降为低频探测") {
		t.Fatalf("expected downgrade warn in log, got: %q", buf.String())
	}
}
