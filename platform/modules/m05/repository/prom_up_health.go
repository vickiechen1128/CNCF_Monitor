package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m05/domain"
)

// upInstantQuery is the instant PromQL expression behind collection_health.
//
// Only samples inside the instant-query lookback are considered, so the panel
// reflects the *current* scrape state (same as v2 `dashboard/collection_health.go`).
const upInstantQuery = "up"

// PromUpHealthQuerier implements domain.UpHealthQuerier against the center
// Prometheus `/api/v1/query` endpoint.
//
// 与 v2 `platform/dashboard.PromUpHealthQuerier` 同源实现：一次查询 `up`，按
// `resource_id` 标签归集成「出现过 / up=1 / up≠1」三个集合，禁止 per-resource
// N+1。查询失败一律向上返回 error，由 service 降级为 nil（响应字段省略）。
type PromUpHealthQuerier struct {
	baseURL *url.URL
	client  *http.Client
}

// NewPromUpHealthQuerier constructs the querier. A nil base URL returns nil so
// callers can wire it conditionally ("no Prometheus configured" ⇒ degrade).
func NewPromUpHealthQuerier(baseURL *url.URL, client *http.Client) *PromUpHealthQuerier {
	if baseURL == nil {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return &PromUpHealthQuerier{baseURL: baseURL, client: client}
}

// UpHealth implements domain.UpHealthQuerier.
func (q *PromUpHealthQuerier) UpHealth(ctx context.Context) (*domain.UpHealthIndex, error) {
	if q == nil || q.baseURL == nil {
		return nil, fmt.Errorf("up health querier not configured")
	}
	endpoint := *q.baseURL
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/") + "/api/v1/query"
	vals := url.Values{}
	vals.Set("query", upInstantQuery)
	endpoint.RawQuery = vals.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build %s request: %w", upInstantQuery, err)
	}
	resp, err := q.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("query %s: %w", upInstantQuery, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("query %s: unexpected status %d", upInstantQuery, resp.StatusCode)
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
		return nil, fmt.Errorf("decode %s: %w", upInstantQuery, err)
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("query %s: prometheus status %q", upInstantQuery, payload.Status)
	}

	isOne := make(map[string]bool)
	isZero := make(map[string]bool)
	for _, result := range payload.Data.Result {
		resourceID := result.Metric["resource_id"]
		if resourceID == "" || len(result.Value) < 2 {
			continue
		}
		var raw string
		if err := json.Unmarshal(result.Value[1], &raw); err != nil {
			continue
		}
		if strings.TrimSpace(raw) == "1" {
			isOne[resourceID] = true
			continue
		}
		isZero[resourceID] = true
	}
	return domain.NewUpHealthIndex(isOne, isZero), nil
}
