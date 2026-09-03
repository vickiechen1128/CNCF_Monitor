// Package silence 实现 Module_08 静默管理：服务端代理 Alertmanager 原生
// /api/v2/silences（读取/创建/删除），并对写路径做 matcher 授权收敛校验（决策 56）。
// 静默为 Alertmanager 运行时状态，不入 M09 流水线、即时生效（决策 59）。
// 使用 v2 API：上游 Alertmanager >= 0.27 已移除 v1 /api/v1/silences（返回 410 Gone），
// v2 列表/单条为裸对象（非 v1 的 {status,data} 信封），create 直接返回 {"silenceID":...}。
// 参见 docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
//   §5.2 / §6.3 / §9.1 / §9.2；docs/05-execution-records/module-08/api-contract-snapshot.md §4。
package silence

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// ErrSilenceNotFound 表示目标静默在 Alertmanager 不存在（契约 §4：not_found）。
var ErrSilenceNotFound = errors.New("silence not found")

// amMatcher 是 Alertmanager 原生 matcher 载体（camelCase；合约 §4 Matcher 为 snake_case，
// 在 proxy 层负责转换）。
type amMatcher struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	IsEqual *bool  `json:"isEqual,omitempty"`
	IsRegex *bool  `json:"isRegex,omitempty"`
}

// amSilence 是 Alertmanager /api/v2/silences 列表项载体。
type amSilence struct {
	ID        string      `json:"id"`
	Matchers  []amMatcher `json:"matchers"`
	StartsAt  time.Time   `json:"startsAt"`
	EndsAt    time.Time   `json:"endsAt"`
	CreatedBy string      `json:"createdBy"`
	Comment   string      `json:"comment"`
	Status    struct {
		State string `json:"state"` // active / pending / expired
	} `json:"status"`
}

// amCreateSilenceRequest 是 Alertmanager POST /api/v2/silences 请求体。
type amCreateSilenceRequest struct {
	Matchers  json.RawMessage `json:"matchers"`
	StartsAt  time.Time       `json:"startsAt"`
	EndsAt    time.Time       `json:"endsAt"`
	CreatedBy string          `json:"createdBy"`
	Comment   string          `json:"comment"`
}

// amCreateSilenceResponse 是 Alertmanager POST /api/v2/silences 响应（v2 直接返回
// {"silenceID":"..."}，非 v1 的 {status,data:{silenceID}} 信封）。
type amCreateSilenceResponse struct {
	SilenceID string `json:"silenceID"`
}

// amListResponse 已被 v1→v2 迁移移除：v2 GET /api/v2/silences 返回裸数组，直接解码为 []amSilence。

// Proxy 是与 Alertmanager 原生静默 API 通信的客户端，校验目标 scheme+host（复用控制面
// parseURL 口径，SSRF 防护——目标由中心 endpoints 配置注入，不信任前端传参）。
type Proxy struct {
	baseURL string
	http    *http.Client
}

// NewProxy 创建 Alertmanager 静默代理；baseURL 必须为 http/https 且非空 host。
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

// ListSilences 拉取 Alertmanager 全部静默（含 active/pending/expired）。
//
// review-fix E（保守处理）：MVP 采用「全量拉取 + 内存分页」，不做 AM 侧 filter/limit。
// 静默量大时内存与网络开销线性增长，属已声明的 MVP 边界（golang-review MEDIUM）。
// 演进方向为向 AM /api/v2/silences 传 filter/limit 参数或改服务端分页；短期可在
// activeOnly 过滤前置到解码阶段减少内存滞留。MVP 单租户静默规模可控，暂不升级。
func (p *Proxy) ListSilences(ctx context.Context) ([]amSilence, error) {
	endpoint := p.baseURL + "/api/v2/silences"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("list alertmanager silences at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	return decodeList(resp)
}

// CreateSilence 创建静默，返回 Alertmanager 分配的 silence ID。
func (p *Proxy) CreateSilence(ctx context.Context, body []byte) (string, error) {
	endpoint := p.baseURL + "/api/v2/silences"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := p.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("create alertmanager silence at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("create alertmanager silence at %s: unexpected status %d", endpoint, resp.StatusCode)
	}
	var out amCreateSilenceResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", fmt.Errorf("decode create silence response: %w", err)
	}
	if out.SilenceID == "" {
		return "", errors.New("create alertmanager silence: empty silenceID")
	}
	return out.SilenceID, nil
}

// GetSilence 查询单个静默；不存在返回 ErrSilenceNotFound。v2 成功响应为裸对象，直接解码进 amSilence。
func (p *Proxy) GetSilence(ctx context.Context, id string) (*amSilence, error) {
	endpoint := p.baseURL + "/api/v2/silence/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("get alertmanager silence at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, ErrSilenceNotFound
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("get alertmanager silence at %s: unexpected status %d", endpoint, resp.StatusCode)
	}
	var out amSilence
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteSilence 删除静默；目标不存在返回 ErrSilenceNotFound（先查询，规避 AM
// 对不存在 ID 仍返回 success 的宽行为，保证契约 §4 not_found 语义）。
func (p *Proxy) DeleteSilence(ctx context.Context, id string) error {
	if _, err := p.GetSilence(ctx, id); err != nil {
		return err
	}
	endpoint := p.baseURL + "/api/v2/silence/" + url.PathEscape(id)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := p.http.Do(req)
	if err != nil {
		return fmt.Errorf("delete alertmanager silence at %s: %w", endpoint, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("delete alertmanager silence at %s: unexpected status %d", endpoint, resp.StatusCode)
	}
	return nil
}

// decodeList 解析 GET /api/v2/silences 响应：v2 列表为裸数组，成功直接解码为 []amSilence。
func decodeList(resp *http.Response) ([]amSilence, error) {
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("list alertmanager silences: unexpected status %d: %s", resp.StatusCode, sanitize(b))
	}
	var out []amSilence
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = []amSilence{}
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