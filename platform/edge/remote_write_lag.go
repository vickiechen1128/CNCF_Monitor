package edge

// 中心视角「回传延迟」（F-40 口径在 M09 节点列表的延展）：
// 端到端回传延迟 = 中心 Prometheus 里该网域 up 样本距今秒数的 p95 分位。
// 边缘域配置生成时已注入 global.external_labels.network_domain_id（决策：
// 网域身份随 remote_write 上报保留），因此中心侧可按该标签一次聚合全量网域：
//
//	quantile by (network_domain_id) (0.95, time() - ts_of_last_over_time(up[24h]))
//
// 口径说明（2026-10-10 实测修正）：
//   - 旧口径 `max by (...) (time() - timestamp(last_over_time(up[24h])))` 恒返回 0：
//     timestamp() 对矩阵函数输出取到的是评估步时刻而非样本时刻（引擎对矩阵函数
//     输出打评估时间戳），导致页面永远显示「刚刚」——即使样本已滞后 80s+
//     （本地 Prometheus 实证：旧式恒 0，新式正确返回 8.26s / 断流 80.83s）。
//   - 改用 ts_of_last_over_time（本 fork 内置）取窗口内最后样本的真实时间戳；
//     分位数从 max 改为 p95，反映「大部分实例」的滞后，避免单个陈旧 series 拉满。
//   - ⚠️ 依赖中心 Prometheus 开启 --enable-feature=promql-experimental-functions
//     （Makefile run-prometheus 与交付包 start.sh 已带）；未开启时查询报
//     "function ... is not enabled"，调用方按既有降级路径呈现「无数据」。
//   - 取 24h 窗口：积压超过 1h 时 F-40 前端三态已无法区分「延迟/未采集」，
//     本查询仍能给出延迟读数；断流 series 在 24h 内不会从结果中消失。
//     窗口内完全无样本的网域不会出现在结果里，由调用方以「无数据」呈现。

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// SampleLagQueryExpr 是按网域聚合样本滞后的 PromQL（p95 分位口径）。
// 需要中心 Prometheus 开启 --enable-feature=promql-experimental-functions
// （ts_of_last_over_time 为实验函数），否则查询失败并按「无数据」降级。
const SampleLagQueryExpr = `quantile by (network_domain_id) (0.95, time() - ts_of_last_over_time(up[24h]))`

// SampleLagQuerier 提供按网域聚合的「中心视角最新样本滞后秒数」。
// 返回 map 的 key 为 network_domain_id；窗口内无样本的网域不在 map 中。
type SampleLagQuerier interface {
	QueryDomainLags(ctx context.Context) (map[string]int64, error)
}

// PromSampleLagQuerier 是基于中心 Prometheus /api/v1/query 的 SampleLagQuerier。
// 带 TTL 内存缓存与短超时：节点列表页每次加载都会触发查询，缓存避免频繁打 Prom；
// 查询失败仅降级为「无数据」（AgentView.RemoteWriteLagSeconds=nil），不阻塞列表。
type PromSampleLagQuerier struct {
	base   *url.URL
	client *http.Client
	ttl    time.Duration

	mu       sync.Mutex
	cache    map[string]int64
	cachedAt time.Time
}

// NewPromSampleLagQuerier 构造查询器；client 为 nil 时使用 2s 超时的默认客户端。
func NewPromSampleLagQuerier(base *url.URL, client *http.Client) *PromSampleLagQuerier {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Second}
	}
	return &PromSampleLagQuerier{base: base, client: client, ttl: 30 * time.Second}
}

// promQueryResponse 是 Prometheus /api/v1/query vector 响应的最小解析结构。
type promQueryResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  []interface{}     `json:"value"` // [ts, "42.3"]
		} `json:"result"`
	} `json:"data"`
}

// QueryDomainLags 查询并返回 {network_domain_id: 滞后秒数}；带 TTL 缓存。
func (q *PromSampleLagQuerier) QueryDomainLags(ctx context.Context) (map[string]int64, error) {
	q.mu.Lock()
	if q.cache != nil && time.Since(q.cachedAt) < q.ttl {
		out := q.cache
		q.mu.Unlock()
		return out, nil
	}
	q.mu.Unlock()

	lags, err := q.fetch(ctx)
	if err != nil {
		return nil, err
	}
	q.mu.Lock()
	q.cache = lags
	q.cachedAt = time.Now()
	q.mu.Unlock()
	return lags, nil
}

func (q *PromSampleLagQuerier) fetch(ctx context.Context) (map[string]int64, error) {
	u := *q.base
	u.Path = strings.TrimSuffix(u.Path, "/") + "/api/v1/query"
	v := url.Values{"query": []string{SampleLagQueryExpr}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String()+"?"+v.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("build sample-lag query: %w", err)
	}
	resp, err := q.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("query sample lag: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("query sample lag: unexpected status %d", resp.StatusCode)
	}
	var parsed promQueryResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode sample-lag response: %w", err)
	}
	if parsed.Status != "success" || parsed.Data.ResultType != "vector" {
		return nil, fmt.Errorf("sample-lag response: status=%q resultType=%q", parsed.Status, parsed.Data.ResultType)
	}
	out := make(map[string]int64, len(parsed.Data.Result))
	for _, s := range parsed.Data.Result {
		domain := s.Metric["network_domain_id"]
		if domain == "" || len(s.Value) < 2 {
			continue
		}
		secs, ok := toSeconds(s.Value[1])
		if !ok {
			continue
		}
		out[domain] = secs
	}
	return out, nil
}

// toSeconds 解析 Prometheus 标量字符串（如 "42.317"），向下取整、负值截 0
// （边缘时钟轻微超前时会算出小负数，语义上就是「刚刚」）。
func toSeconds(v interface{}) (int64, bool) {
	s, ok := v.(string)
	if !ok {
		return 0, false
	}
	var f float64
	if _, err := fmt.Sscanf(s, "%g", &f); err != nil {
		return 0, false
	}
	if f < 0 {
		f = 0
	}
	return int64(f), true
}
