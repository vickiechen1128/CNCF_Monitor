/**
 * 采集健康聚合（M05 反馈 10，路线 B；反馈 12 起统一为两态）：首页「工程师视角 · 采集健康」
 * 面板取数。
 *
 * 背景：首页 L0「纳管覆盖率」是**下发口径**（已下发资源 ÷ 资源总数），不代表数据真的
 * 采到了。工程师需要另一个视角回答「已下发的这批，采到了吗、哪些没在采」。本文件把
 * 该口径聚合为 `dashboard/summary.collection_health`，前端零聚合（不逐 Job 拉取）。
 *
 * 口径（反馈 12 定版）：**与 M02 `/api/v1/health/coverage`、M07 资源列表完全一致**——
 *   - 5min 内有 `up` 样本且 =1 → collecting（采集中）
 *   - 其余（有 up==0 样本 / 待首次抓取 / 回传延迟）→ down（已下发未采到）
 * 不再区分 stale（回传延迟中）与 pending（待采集），避免同一资源在首页与资源列表
 * 显示不同状态/颜色（反馈 12 的歧义来源）。
 *
 * 分母 = **已下发资源数**（= monitored_count，被 ready+enabled 标准 Job 选中且仍存在的
 * resource_id）；未下发资源**不进**本面板（其进度归「纳管覆盖率」），故两态计数之和恒
 * 等于 dispatched_count。拨测目标不参与。
 *
 * 数据源与 M02 `/api/v1/health/coverage` 同源：一次查询 `up`（5min lookback 实时态），
 * 按 `resource_id` 标签聚合（O(1) 查表，禁止 per-resource N+1）。查询失败一律降级——
 * 返回 nil，前端按「不可用」呈现，绝不误报 0。
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

// 采集健康判定所需的 PromQL 表达式。
// upInstantQuery：即时查询，只认 5min lookback 窗口内的样本（实时态）。
const upInstantQuery = "up"

// CollectionHealth 采集健康两态聚合（工程师视角，反馈 12）。
// 不变量：DispatchedCount == CollectingCount + DownCount。
type CollectionHealth struct {
	DispatchedCount int `json:"dispatched_count"` // 已下发资源数（= monitored_count，本面板分母）
	CollectingCount int `json:"collecting_count"` // 采集中：5min 内有 up==1 样本
	DownCount       int `json:"down_count"`       // 已下发未采到：其余情形（up==0 / 待首抓 / 回传延迟）
}

// UpHealthIndex 按 resource_id 归集的 up 健康索引（一次查询、O(1) 查表）。
type UpHealthIndex struct {
	upNow  map[string]bool // 5min 内有 up 样本（任意值）的 resource_id
	upTrue map[string]bool // 5min 内有 up==1 样本的 resource_id
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

// UpHealth 实现 UpHealthQuerier：拉取 `up` 并按 resource_id 归集实时态。
func (q *PromUpHealthQuerier) UpHealth(ctx context.Context) (*UpHealthIndex, error) {
	if q == nil || q.BaseURL == nil {
		return nil, fmt.Errorf("up health querier not configured")
	}
	upNow, upTrue, err := q.queryResourceIDs(ctx, upInstantQuery)
	if err != nil {
		return nil, err
	}
	return &UpHealthIndex{upNow: upNow, upTrue: upTrue}, nil
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

// classifyCollectionHealth 对已下发 resource_id 集合做两态分类，判定与 M02 coverage /
// M07 资源列表一致：5min 内有 up==1 → 采集中，否则 → 已下发未采到。
// idx 为 nil（未注入 querier / 查询失败）时返回 nil，由调用方留空字段（前端按不可用呈现）。
func classifyCollectionHealth(dispatched []string, idx *UpHealthIndex) *CollectionHealth {
	if idx == nil {
		return nil
	}
	ch := &CollectionHealth{}
	for _, id := range dispatched {
		ch.DispatchedCount++
		if idx.upTrue[id] {
			ch.CollectingCount++
		} else {
			ch.DownCount++
		}
	}
	return ch
}