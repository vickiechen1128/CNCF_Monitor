// Package alerts 实现 Module_08 告警状态查看的通知状态代理（T08-07，决策 55/56/61）：
// 服务端代理 Alertmanager 原生 GET /api/v2/alerts（v2 口径——上游 >= 0.27 已移除
// v1 端点，禁止调用），将 AM GettableAlert 字段子集映射为契约视图并服务端归一
// notify_status 四态（active/silenced/inhibited/unprocessed）。
// 读路径带决策 56 授权过滤骨架：服务端强制注入当前用户授权网域集合 filter
// （不信任前端传参；授权=全部网域时不附加；MVP 单租户恒通过，机制保留）。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//
//	§5.4 / §9.2；docs/05-execution-records/module-08/api-contract-snapshot.md §10.2。
package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// amAlertStatus 是 Alertmanager GettableAlert.status 载体（camelCase）。
type amAlertStatus struct {
	State       string   `json:"state"` // unprocessed / active / suppressed
	SilencedBy  []string `json:"silencedBy"`
	InhibitedBy []string `json:"inhibitedBy"`
	// MutedBy 是时间区间静音（mute time intervals）命中项；语义等同静默。
	MutedBy []string `json:"mutedBy"`
}

// amAlert 是 Alertmanager GET /api/v2/alerts 列表项载体（GettableAlert 字段子集）。
type amAlert struct {
	Fingerprint string            `json:"fingerprint"`
	Labels      map[string]string `json:"labels"`
	Annotations map[string]string `json:"annotations"`
	StartsAt    time.Time         `json:"startsAt"`
	EndsAt      time.Time         `json:"endsAt"`
	Status      amAlertStatus     `json:"status"`
}

// ActiveAlert 是活跃告警实况（历史告警对账用，含静默/抑制/时间静音标记）。
type ActiveAlert struct {
	Fingerprint string
	Labels      map[string]string
	Annotations map[string]string
	StartsAt    time.Time
	EndsAt      time.Time
	State       string
	SilencedBy  []string
	InhibitedBy []string
	MutedBy     []string
}

// ListActiveAlerts 返回当前活跃告警全集（含 silenced / inhibited；M11 历史告警对账用）。
func (p *Proxy) ListActiveAlerts(ctx context.Context) ([]ActiveAlert, error) {
	list, err := p.ListAlerts(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]ActiveAlert, 0, len(list))
	for _, a := range list {
		out = append(out, ActiveAlert{
			Fingerprint: a.Fingerprint,
			Labels:      a.Labels,
			Annotations: a.Annotations,
			StartsAt:    a.StartsAt,
			EndsAt:      a.EndsAt,
			State:       a.Status.State,
			SilencedBy:  a.Status.SilencedBy,
			InhibitedBy: a.Status.InhibitedBy,
			MutedBy:     a.Status.MutedBy,
		})
	}
	return out, nil
}

// AlertmanagerStartedAt 返回 AM 进程启动时刻（GET /api/v2/status 的 uptime）。
// 用于历史告警对账的「重启重建窗口」判定；未知时返回零值（调用方按不可信处理）。
func (p *Proxy) AlertmanagerStartedAt(ctx context.Context) (time.Time, error) {
	endpoint := p.baseURL + "/api/v2/status"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return time.Time{}, err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return time.Time{}, fmt.Errorf("query alertmanager status at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return time.Time{}, err
	}
	if resp.StatusCode != http.StatusOK {
		return time.Time{}, fmt.Errorf("query alertmanager status: unexpected status %d: %s", resp.StatusCode, sanitize(b))
	}
	var parsed struct {
		Uptime string `json:"uptime"`
	}
	if err := json.Unmarshal(b, &parsed); err != nil {
		return time.Time{}, fmt.Errorf("decode alertmanager status: %w", err)
	}
	if parsed.Uptime == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.RFC3339, parsed.Uptime)
	if err != nil {
		return time.Time{}, fmt.Errorf("parse alertmanager uptime %q: %w", parsed.Uptime, err)
	}
	return t, nil
}

// Proxy 是与 Alertmanager 原生告警 API 通信的客户端，校验目标 scheme+host（复用
// silence.NewProxy 口径，SSRF 防护——目标由中心 endpoints 配置注入，不信任前端传参）。
type Proxy struct {
	baseURL string
	http    *http.Client
}

// NewProxy 创建 Alertmanager 告警代理；baseURL 必须为 http/https 且非空 host。
func NewProxy(baseURL string) (*Proxy, error) {
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse alertmanager base url %q: %w", baseURL, err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return nil, fmt.Errorf("parse alertmanager base url %q: scheme must be http or https", baseURL)
	}
	if u.Host == "" {
		return nil, fmt.Errorf("parse alertmanager base url %q: host must not be empty", baseURL)
	}
	return &Proxy{
		baseURL: u.String(),
		http:    &http.Client{Timeout: 10 * time.Second},
	}, nil
}

// ListAlerts 拉取 Alertmanager 全部告警（GET /api/v2/alerts，v2 裸数组解码）。
// AM 不可达或非 2xx 返回可观测错误。
func (p *Proxy) ListAlerts(ctx context.Context) ([]amAlert, error) {
	endpoint := p.baseURL + "/api/v2/alerts"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list alertmanager alerts at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list alertmanager alerts: unexpected status %d: %s", resp.StatusCode, sanitize(b))
	}
	var out []amAlert
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, fmt.Errorf("decode alertmanager alerts: %w", err)
	}
	if out == nil {
		out = []amAlert{}
	}
	return out, nil
}

// sanitize 对下游错误响应做脱敏截断（不泄露敏感响应体）。
func sanitize(b []byte) string {
	if len(b) > 120 {
		b = b[:120]
	}
	return string(b)
}
