/**
 * 采集健康聚合（M05 反馈 10，路线 B）：首页「工程师视角 · 采集健康」面板取数。
 *
 * 背景：首页 L0「纳管覆盖率」是**下发口径**（已下发资源 ÷ 资源总数），不代表数据真的
 * 采到了。工程师需要另一个视角回答「已下发的这批，采到了吗、哪些没在采」。本文件把
 * 该口径聚合为 `dashboard/summary.collection_health`，前端零聚合（不逐 Job 拉取）。
 *
 * 口径（沿用 F-40，与前端 upStatus.statusFromUp 一致，不新造窗口）：
 *   - 5min 内有 `up` 样本且 =1 → collecting（采集中）
 *   - 5min 内有 `up` 样本且 =0 → down（已下发未采到）
 *   - 5min 内无 `up` 样本、但 1h 内出现过 → stale（回传延迟中，独立一态）
 *   - 1h 内也无样本 → pending（待采集）
 *
 * 分母 = **已下发资源数**（= monitored_count，被 ready+enabled 标准 Job 选中且仍存在的
 * resource_id）；未下发资源**不进**本面板（其进度归「纳管覆盖率」），故四态计数之和恒
 * 等于 dispatched_count。拨测目标不参与。
 *
 * 数据源与 M02 `/api/v1/health/coverage` 同源：一次查询 `up`（5min lookback 实时态）+
 * `last_over_time(up[1h])`（1h 是否出现过），按 `resource_id` 标签聚合（O(1) 查表，
 * 禁止 per-resource N+1）。查询失败一律降级——返回 nil，前端按「不可用」呈现，绝不误报 0。
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

// 采集健康判定所需的两个 PromQL 表达式。
//   - upInstantQuery：即时查询，只认 5min lookback 窗口内的样本（实时态）。
//   - upIn1hQuery：1h 内是否出现过样本（回传延迟判定依据）。
const (
	upInstantQuery = "up"
	upIn1hQuery    = "last_over_time(up[1h])"
)

// CollectionHealth 采集健康四态聚合（工程师视角）。
// 不变量：DispatchedCount == CollectingCount + StaleCount + DownCount + PendingCount。
type CollectionHealth struct {
	DispatchedCount int `json:"dispatched_count"` // 已下发资源数（= monitored_count，本面板分母）
	CollectingCount int `json:"collecting_count"` // 采集中：5min 内有 up==1 样本
	StaleCount      int `json:"stale_count"`      // 回传延迟中：5min 无样本、1h 内有（F-40 独立一态）
	DownCount       int `json:"down_count"`       // 已下发未采到：5min 内有 up==0 样本
	PendingCount    int `json:"pending_count"`    // 待采集：1h 内亦无任何 up 样本
}

// UpHealthIndex 按 resource_id 归集的 up 健康索引（一次查询、O(1) 查表）。
type UpHealthIndex struct {
	upNow   map[string]bool // 5min 内有 up 样本（任意值）的 resource_id
	upTrue  map[string]bool // 5min 内有 up==1 样本的 resource_id
	anyIn1h map[string]bool // 1h 内出现过 up 样本的 resource_id
}

// UpHealthQuerier 采集健康判定所需的 up 样本查询能力抽象（便于单测注入假实现）。
type UpHealthQuerier interface {
	// UpHealth 返回按 resource_id 的 up 健康索引；查询失败返回 error（由调用方降级）。
	UpHealth(ctx context.Context) (*UpHealthIndex, error)
}

// PromUpHealthQuerier 基于中心 Prometheus /api/v1/query 的 UpHealthQuerier 实现。
type PromUpHealthQuerier struct {
	BaseURL *url.URL
	Client  *http.Client
}

// NewPromUpHealthQuerier 构造中心 Prometheus 采集健康查询器；baseURL 为 nil 时返回 nil（视为不启用）。
func NewPromUpHealthQuerier(baseURL *url.URL, client *http.Client) *PromUpHealthQuerier {
	if baseURL == nil {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &PromUpHealthQuerier{BaseURL: baseURL, Client: client}
}

// UpHealth 实现 UpHealthQuerier：分别拉取 `up` 与 `last_over_time(up[1h])` 并按 resource_id 归集。
func (q *PromUpHealthQuerier) UpHealth(ctx context.Context) (*UpHealthIndex, error) {
	if q == nil || q.BaseURL == nil {
		return nil, fmt.Errorf("up health querier not configured")
	}
	upNow, upTrue, err := q.queryResourceIDs(ctx, upInstantQuery)
	if err != nil {
		return nil, err
	}
	anyIn1h, _, err := q.queryResourceIDs(ctx, upIn1hQuery)
	if err != nil {
		return nil, err
	}
	return &UpHealthIndex{upNow: upNow, upTrue: upTrue, anyIn1h: anyIn1h}, nil
}

// queryResourceIDs 执行一条 instant query，返回 (出现过样本的 resource_id 集, 其中值为 1 的集)。
// 无 resource_id 标签的 series 不计入（与 M02 coverage 口径一致）。
func (q *PromUpHealthQuerier) queryResourceIDs(ctx context.Context, expr string) (map[string]bool, map[string]bool, error) {
	endpoint := *q.BaseURL
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + "/api/v1/query"
	vals := url.Values{}
	vals.Set("query", expr)
	endpoint.RawQuery = vals.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, nil, fmt.Errorf("build %s request: %w", expr, err)
	}
	resp, err := q.Client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("query %s: %w", expr, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("query %s: unexpected status %d", expr, resp.StatusCode)
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
		return nil, nil, fmt.Errorf("decode %s: %w", expr, err)
	}
	if payload.Status != "success" {
		return nil, nil, fmt.Errorf("query %s: prometheus status %q", expr, payload.Status)
	}

	present := make(map[string]bool)
	isOne := make(map[string]bool)
	for _, r := range payload.Data.Result {
		rid := r.Metric["resource_id"]
		if rid == "" || len(r.Value) < 2 {
			continue
		}
		present[rid] = true
		var raw string
		if err := json.Unmarshal(r.Value[1], &raw); err != nil {
			continue
		}
		if strings.TrimSpace(raw) == "1" {
			isOne[rid] = true
		}
	}
	return present, isOne, nil
}

// classifyCollectionHealth 对已下发 resource_id 集合做四态分类。
// idx 为 nil（未注入 querier / 查询失败）时返回 nil，由调用方留空字段（前端按不可用呈现）。
func classifyCollectionHealth(dispatched []string, idx *UpHealthIndex) *CollectionHealth {
	if idx == nil {
		return nil
	}
	ch := &CollectionHealth{}
	for _, id := range dispatched {
		ch.DispatchedCount++
		switch {
		case idx.upTrue[id]:
			ch.CollectingCount++
		case idx.upNow[id]:
			ch.DownCount++
		case idx.anyIn1h[id]:
			ch.StaleCount++
		default:
			ch.PendingCount++
		}
	}
	return ch
}