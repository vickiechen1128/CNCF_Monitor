package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
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

// Coverage states for the per-resource report (contract §7.2).
const (
	StateCollecting        = "collecting"
	StatePartialCollecting = "partial_collecting"
	StatePendingDown       = "pending_down"
	StateNotMonitored      = "not_monitored"
)

// CoverageItem is one resource's collection state.
type CoverageItem struct {
	ResourceID       string
	ResourceCategory string
	InstanceName     string
	MonitorState     string
	Health           *string
	LastError        string
}

// CoverageSummary aggregates the per-resource coverage states.
type CoverageSummary struct {
	Total             int64
	Collecting        int64
	PartialCollecting int64
	PendingDown       int64
	NotMonitored      int64
	CoverageRate      float64
}

// CoverageReport is the per-resource coverage page (contract §7.2).
type CoverageReport struct {
	Items    []CoverageItem
	Total    int64
	Page     int
	PageSize int
	Summary  CoverageSummary
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

// CoverageReport builds the per-resource coverage items and summary for the
// caller's authorized domains (contract §7.2). The `state` filter is applied
// before pagination so `total` and `summary` stay consistent with the filter.
func (s *QueryService) CoverageReport(ctx context.Context, actor Actor, filter repository.CoverageFilter, state string, page, pageSize int) (CoverageReport, error) {
	allowed, err := s.AllowedDomains(ctx, actor)
	if err != nil {
		return CoverageReport{}, err
	}
	filter.Allowed = allowed
	resources, err := s.repo.ListCoverageResources(ctx, filter)
	if err != nil {
		return CoverageReport{}, err
	}
	targets, err := s.repo.ListCoverageTargets(ctx, filter)
	if err != nil {
		return CoverageReport{}, err
	}

	freshAfter := s.now().Add(-s.freshness)
	targetsByResource := make(map[string][]repository.CoverageTargetRow, len(targets))
	for _, target := range targets {
		targetsByResource[target.ResourceID] = append(targetsByResource[target.ResourceID], target)
	}

	items := make([]CoverageItem, 0, len(resources))
	for _, resource := range resources {
		items = append(items, buildCoverageItem(resource, targetsByResource[resource.ResourceID], freshAfter))
	}
	if state != "" {
		filtered := items[:0]
		for _, item := range items {
			if item.MonitorState == state {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ResourceID < items[j].ResourceID })

	total := int64(len(items))
	summary := summarizeCoverage(items)

	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	start := (page - 1) * pageSize
	if start > len(items) {
		start = len(items)
	}
	end := start + pageSize
	if end > len(items) {
		end = len(items)
	}
	return CoverageReport{
		Items:    items[start:end],
		Total:    total,
		Page:     page,
		PageSize: pageSize,
		Summary:  summary,
	}, nil
}

// buildCoverageItem derives the four-state display from the target snapshots
// attached to one resource.
func buildCoverageItem(resource repository.CoverageResourceRow, targets []repository.CoverageTargetRow, freshAfter time.Time) CoverageItem {
	item := CoverageItem{
		ResourceID:       resource.ResourceID,
		ResourceCategory: resource.ResourceCategory,
		InstanceName:     resource.InstanceName,
		MonitorState:     StateNotMonitored,
	}
	if len(targets) == 0 {
		return item
	}

	var up, down, unknown int
	for _, target := range targets {
		switch {
		case target.Health == "up" && !target.LastReportAt.Before(freshAfter):
			up++
		case target.Health == "down":
			down++
		default:
			unknown++
		}
		if item.LastError == "" {
			item.LastError = target.LastError
		}
	}

	switch {
	case up > 0 && down+unknown == 0:
		item.MonitorState = StateCollecting
		item.Health = healthPtr("up")
	case up > 0:
		item.MonitorState = StatePartialCollecting
		item.Health = healthPtr("down")
	case down > 0:
		item.MonitorState = StatePendingDown
		item.Health = healthPtr("down")
	default:
		item.MonitorState = StatePendingDown
		item.Health = healthPtr("unknown")
	}
	return item
}

func healthPtr(value string) *string { return &value }

// summarizeCoverage aggregates the four states; coverage_rate counts resources
// that have at least one target snapshot, regardless of scrape success.
func summarizeCoverage(items []CoverageItem) CoverageSummary {
	summary := CoverageSummary{Total: int64(len(items))}
	for _, item := range items {
		switch item.MonitorState {
		case StateCollecting:
			summary.Collecting++
		case StatePartialCollecting:
			summary.PartialCollecting++
		case StatePendingDown:
			summary.PendingDown++
		default:
			summary.NotMonitored++
		}
	}
	if summary.Total > 0 {
		covered := summary.Total - summary.NotMonitored
		summary.CoverageRate = math.Round(float64(covered)/float64(summary.Total)*100) / 100
	}
	return summary
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
