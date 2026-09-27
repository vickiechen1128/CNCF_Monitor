/**
 * 拨测结果查询（F-13）：首页 L3「拨测态势」面板的 probe_status / last_probe_at /
 * probe_target_abnormal_count 取数。
 *
 * 背景：PRD Module_05 §5.1 与决策 93 第 8 条要求 probe_targets[] 提供实时探测状态与
 * 最近拨测时间，且明确「last_probe_time 口径由 Module_01 承载，M05 只消费」。既有实现
 * 因「无实时拨测数据源」把 status / last_probe_at 恒留空，导致前端 L3 面板状态列恒
 * 「未知」、最近拨测恒 '-'。
 *
 * 现数据面已具备该数据源：blackbox 拨测结果经 vmagent → remote_write 落到中心
 * Prometheus 的 probe_success 指标（1=通过 / 0=失败，样本自带采样时间戳）。
 *
 * 本文件提供 ProbeQuerier 抽象 + 中心 Prometheus 实现；由 summary.go 通过 Option 注入，
 * 查询失败一律降级（status 留空、异常计数为 0），不使聚合接口整体失败。
 */
package dashboard

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// probeSuccessQuery 拨测结果表达式：全量拉取后在本地按 job + instance 匹配。
const probeSuccessQuery = "probe_success"

// ProbeSample 单条 probe_success 样本。
type ProbeSample struct {
	Success bool      // true=1（拨测通过）/ false=0（拨测失败）
	At      time.Time // 样本采样时间（last_probe_at 来源）
}

// ProbeQuerier 拨测结果查询能力抽象（便于单测注入假实现）。
type ProbeQuerier interface {
	// ProbeSuccess 返回按 job 名 → instance → 样本 的二级索引。
	ProbeSuccess(ctx context.Context) (map[string]map[string]ProbeSample, error)
}

// PromProbeQuerier 基于中心 Prometheus /api/v1/query 的 ProbeQuerier 实现。
type PromProbeQuerier struct {
	BaseURL *url.URL
	Client  *http.Client
}

// NewPromProbeQuerier 构造中心 Prometheus 拨测查询器；baseURL 为 nil 时返回 nil（视为不启用）。
func NewPromProbeQuerier(baseURL *url.URL, client *http.Client) *PromProbeQuerier {
	if baseURL == nil {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &PromProbeQuerier{BaseURL: baseURL, Client: client}
}

// ProbeSuccess 实现 ProbeQuerier：GET /api/v1/query?query=probe_success 并解析 vector 结果。
func (q *PromProbeQuerier) ProbeSuccess(ctx context.Context) (map[string]map[string]ProbeSample, error) {
	if q == nil || q.BaseURL == nil {
		return nil, fmt.Errorf("probe querier not configured")
	}
	endpoint := *q.BaseURL
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + "/api/v1/query"
	vals := url.Values{}
	vals.Set("query", probeSuccessQuery)
	endpoint.RawQuery = vals.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build probe_success request: %w", err)
	}
	resp, err := q.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("query probe_success: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("query probe_success: unexpected status %d", resp.StatusCode)
	}

	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  []json.RawMessage `json:"value"`
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode probe_success: %w", err)
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("query probe_success: prometheus status %q", payload.Status)
	}

	out := make(map[string]map[string]ProbeSample)
	for _, r := range payload.Data.Result {
		job := r.Metric["job"]
		instance := r.Metric["instance"]
		if job == "" || instance == "" || len(r.Value) < 2 {
			continue
		}
		var ts float64
		if err := json.Unmarshal(r.Value[0], &ts); err != nil {
			continue
		}
		var raw string
		if err := json.Unmarshal(r.Value[1], &raw); err != nil {
			continue
		}
		if out[job] == nil {
			out[job] = make(map[string]ProbeSample)
		}
		out[job][instance] = ProbeSample{
			Success: strings.TrimSpace(raw) == "1",
			At:      time.Unix(int64(ts), 0),
		}
	}
	return out, nil
}
