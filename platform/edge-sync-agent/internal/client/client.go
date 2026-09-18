// Package client 实现 Edge Sync Agent → 中心 的出站客户端：心跳与配置包拉取。
//
// 覆盖 PRD §6.2 401 语义：收到 401 → 指数退避（5s→60s），持续 401 超 10min
// 降为低频探测（5min 一次）并写本地日志（syslog）。
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/metriccenter/platform/edge-sync-agent/internal/config"
	"github.com/metriccenter/platform/edge-sync-agent/internal/contract"
	"github.com/metriccenter/platform/edge-sync-agent/internal/logger"
	"github.com/metriccenter/platform/edge-sync-agent/internal/token"
)

// Errauth 表示 401 鉴权失败，调用方应进入退避降频逻辑。
var Errauth = errors.New("edge: auth failed (401)")

// Client 是 edge 协议出站客户端。
type Client struct {
	cfg      *config.Config
	token    *token.Store
	httpc    *http.Client
	throttle *token.Throttle
	backoff  time.Duration // 下次 401 退避等待（注入便于测试）
	logger   *logger.Logger
}

// NewClient 构造客户端。
func NewClient(cfg *config.Config, tok *token.Store, logg *logger.Logger) *Client {
	if cfg.HTTPTimeout <= 0 {
		cfg.HTTPTimeout = config.DefaultHTTPTimeout
	}
	return &Client{
		cfg:      cfg,
		token:    tok,
		httpc:    &http.Client{Timeout: cfg.HTTPTimeout},
		throttle: token.NewThrottle(cfg.BackoffMin, cfg.BackoffMax, cfg.AuthDowngradeAfter, cfg.AuthDowngradeInterval, time.Now),
		logger:   logg,
	}
}

// heartbeatEndpoint 拼接心跳绝对地址（center_endpoint + 固定路径）。
func (c *Client) heartbeatEndpoint() string {
	return strings.TrimRight(c.cfg.CenterEndpoint, "/") + contract.HeartbeatPath
}

func (c *Client) bearer() string { return "Bearer " + c.token.Get() }

// Heartbeat 发送一次心跳并解析 center 响应。401 时返回 ErrErrauth（不在此退避）。
func (c *Client) Heartbeat(ctx context.Context, hb contract.HeartbeatRequest) (*contract.HeartbeatResponse, error) {
	body, err := json.Marshal(hb)
	if err != nil {
		return nil, fmt.Errorf("edge: marshal heartbeat: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.heartbeatEndpoint(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("edge: build heartbeat req: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", c.bearer())

	resp, err := c.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("edge: heartbeat request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, Errauth
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("edge: heartbeat http %d", resp.StatusCode)
	}
	// 中心统一响应为 {status,data:{...}} 信封（platform/api/response），须先解包 data。
	var env struct {
		Status string                     `json:"status"`
		Data   contract.HeartbeatResponse `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("edge: decode heartbeat response: %w", err)
	}
	if env.Status != "" && env.Status != "success" {
		return nil, fmt.Errorf("edge: heartbeat failed (status=%s)", env.Status)
	}
	// 心跳成功 → 重置 401 退避状态。
	c.throttle.Reset()
	return &env.Data, nil
}

// PullConfig 从 config_download_url 拉取配置 zip 字节。401 时返回 ErrErrauth。
func (c *Client) PullConfig(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("edge: build config req: %w", err)
	}
	req.Header.Set("Authorization", c.bearer())

	resp, err := c.httpc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("edge: config request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, Errauth
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("edge: config http %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("edge: read config: %w", err)
	}
	return data, nil
}

// WaitAuthBackoff 在 401 后调用：进入指数退避等待，并判定是否降频写本地日志。
// 返回本次等待时长与是否触发降频。ctx 取消可中断等待。
func (c *Client) WaitAuthBackoff(ctx context.Context) (time.Duration, bool) {
	interval, downgraded := c.throttle.Next()
	if downgraded {
		c.warnf("持续 401 超过 %s，降为低频探测（%s 一次）",
			c.cfg.AuthDowngradeAfter, c.cfg.AuthDowngradeInterval)
		interval = c.cfg.AuthDowngradeInterval
	} else {
		c.infof("401 退避：%s 后重试", interval)
	}
	c.sleep(ctx, interval)
	return interval, downgraded
}

// Now 返回连续 401 次数（供测试/观测）。
func (c *Client) ConsecutiveAuthFailures() int { return c.throttle.Consecutive() }

// ---- 测试钩子与内部 ----

// setTimeout/ setThrottle allow injecting for tests.
func (c *Client) infof(f string, a ...any) {
	if c.logger != nil {
		c.logger.Infof(f, a...)
	}
}
func (c *Client) warnf(f string, a ...any) {
	if c.logger != nil {
		c.logger.Warnf(f, a...)
	}
}

// sleep 可被覆盖实现（默认 time.Sleep，ctx 感知）。
var sleepF = func(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

func (c *Client) sleep(ctx context.Context, d time.Duration) { sleepF(ctx, d) }
