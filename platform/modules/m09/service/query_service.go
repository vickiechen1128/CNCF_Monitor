package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
)

// DefaultQueryFreshness is the target freshness window used by /targets and the
// coverage aggregation (matches the edge offline threshold).
const DefaultQueryFreshness = 90 * time.Second

// QueryMeta is the meta envelope appended to Prometheus-compatible responses.
type QueryMeta struct {
	DataSource     string    `json:"data_source"`
	FreshnessAt    time.Time `json:"freshness_at"`
	NetworkDomains []string  `json:"network_domains"`
}

// CoverageCounts is the three-state collection coverage (contract §7.2).
type CoverageCounts struct {
	Collecting           int64
	DeployedNotCollected int64
	NotMonitored         int64
}

// UpstreamError marks a Prometheus failure (HTTP 502 at the edge).
type UpstreamError struct {
	Message string
	Err     error
}

func (e *UpstreamError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return "prometheus upstream error"
}

// Unwrap returns the underlying cause.
func (e *UpstreamError) Unwrap() error { return e.Err }

// QueryService implements the target/coverage read models and the isolated
// Prometheus-compatible proxy.
type QueryService struct {
	promURL   *url.URL
	client    *http.Client
	tenants   repository.TenantReader
	repo      repository.QueryRepository
	now       func() time.Time
	freshness time.Duration
}

// NewQueryService constructs the query service.
func NewQueryService(promURL *url.URL, tenants repository.TenantReader, repo repository.QueryRepository) *QueryService {
	return &QueryService{
		promURL:   promURL,
		client:    &http.Client{Timeout: 15 * time.Second},
		tenants:   tenants,
		repo:      repo,
		now:       func() time.Time { return time.Now().UTC() },
		freshness: DefaultQueryFreshness,
	}
}

// AllowedDomains resolves the caller's authorized domains from the tenant cache.
// There is no platform-admin bypass: the admin tenant must itself be granted the
// domains (FR-20 / NFR-08).
func (s *QueryService) AllowedDomains(ctx context.Context, actor Actor) ([]string, error) {
	if strings.TrimSpace(actor.TenantID) == "" {
		return []string{}, nil
	}
	allowed, err := s.tenants.AllowedDomainIDs(ctx, actor.TenantID)
	if err != nil {
		return nil, err
	}
	if allowed == nil {
		return []string{}, nil
	}
	return allowed, nil
}

// Targets returns the paginated edge targets restricted to the caller's domains.
func (s *QueryService) Targets(ctx context.Context, actor Actor, filter repository.TargetFilter) ([]repository.EdgeTargetRow, int64, error) {
	allowed, err := s.AllowedDomains(ctx, actor)
	if err != nil {
		return nil, 0, err
	}
	filter.Allowed = allowed
	freshAfter := s.now().Add(-s.freshness)
	filter.FreshAfter = freshAfter
	rows, total, err := s.repo.ListEdgeTargets(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		if rows[i].Health == "" || rows[i].LastReportAt.Before(freshAfter) {
			rows[i].Health = "unknown"
		}
	}
	return rows, total, nil
}

// Coverage aggregates the three collection states for the caller's domains.
func (s *QueryService) Coverage(ctx context.Context, actor Actor) (CoverageCounts, error) {
	allowed, err := s.AllowedDomains(ctx, actor)
	if err != nil {
		return CoverageCounts{}, err
	}
	freshAfter := s.now().Add(-s.freshness)
	collecting, degraded, err := s.repo.TargetHealthCounts(ctx, allowed, freshAfter)
	if err != nil {
		return CoverageCounts{}, err
	}
	notMonitored, err := s.repo.UnmonitoredResourceCount(ctx, allowed)
	if err != nil {
		return CoverageCounts{}, err
	}
	return CoverageCounts{
		Collecting:           collecting,
		DeployedNotCollected: degraded,
		NotMonitored:         notMonitored,
	}, nil
}

// Proxy forwards a Prometheus-compatible request with the domain matcher
// injected. The upstream is always the configured center Prometheus (no
// user-controlled URL, SSRF-safe).
func (s *QueryService) Proxy(ctx context.Context, actor Actor, path string, params url.Values) (int, []byte, QueryMeta, error) {
	allowed, err := s.AllowedDomains(ctx, actor)
	if err != nil {
		return 0, nil, QueryMeta{}, err
	}
	meta := QueryMeta{DataSource: "prometheus", FreshnessAt: s.now(), NetworkDomains: allowed}
	if s.promURL == nil {
		return 0, nil, meta, &UpstreamError{Message: "center Prometheus is not configured"}
	}

	query := cloneValues(params)
	matcher := DomainMatcher(allowed)
	switch {
	case path == "/api/v1/query", path == "/api/v1/query_range":
		query.Set("query", InjectDomain(query.Get("query"), matcher))
	case path == "/api/v1/labels", path == "/api/v1/series", strings.HasPrefix(path, "/api/v1/label/"):
		query["match[]"] = InjectMatcher(query["match[]"], matcher)
	}

	upstream := *s.promURL
	upstream.Path = path
	upstream.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream.String(), nil)
	if err != nil {
		return 0, nil, meta, &UpstreamError{Message: "build prometheus request", Err: err}
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, meta, &UpstreamError{Message: "center Prometheus unreachable", Err: err}
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return 0, nil, meta, &UpstreamError{Message: "read prometheus response", Err: err}
	}
	if resp.StatusCode >= 500 {
		return 0, nil, meta, &UpstreamError{Message: fmt.Sprintf("center Prometheus returned %d", resp.StatusCode)}
	}
	if path == "/api/v1/alerts" && resp.StatusCode == http.StatusOK {
		body = filterAlerts(body, allowed)
	}
	return resp.StatusCode, body, meta, nil
}

// filterAlerts drops alerts whose network_domain_id is not authorized. Alerts
// without the label are invisible (never leak unlabeled data).
func filterAlerts(body []byte, allowed []string) []byte {
	allow := make(map[string]struct{}, len(allowed))
	for _, domain := range allowed {
		allow[domain] = struct{}{}
	}
	var payload struct {
		Status string `json:"status"`
		Data   struct {
			Alerts []map[string]any `json:"alerts"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return body
	}
	filtered := make([]map[string]any, 0, len(payload.Data.Alerts))
	for _, alert := range payload.Data.Alerts {
		labels, _ := alert["labels"].(map[string]any)
		domain, _ := labels[DomainLabel].(string)
		if _, ok := allow[domain]; ok {
			filtered = append(filtered, alert)
		}
	}
	payload.Data.Alerts = filtered
	out, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return out
}

func cloneValues(values url.Values) url.Values {
	out := make(url.Values, len(values))
	for key, list := range values {
		out[key] = append([]string(nil), list...)
	}
	return out
}
