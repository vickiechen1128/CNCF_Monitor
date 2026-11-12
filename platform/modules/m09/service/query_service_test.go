package service_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/models"
	"github.com/metriccenter/metriccenter/platform/modules/m09/repository"
	"github.com/metriccenter/metriccenter/platform/modules/m09/service"
)

func TestQueryTargetsAndCoverage(t *testing.T) {
	gormDB, _, repo := newTestStack(t)
	ctx := context.Background()
	now := time.Now().UTC()

	insertSnapshot := func(domain, job, instance, resourceID, health string, reportAt time.Time) {
		require.NoError(t, gormDB.Exec(`INSERT INTO edge_target_snapshots
			(network_domain_id, job, instance, resource_id, health, last_report_at)
			VALUES (?,?,?,?,?,?)`, domain, job, instance, resourceID, health, reportAt).Error)
	}
	insertSnapshot("mc-a", "node", "10.0.0.1:9100", "r-1", "up", now)
	insertSnapshot("mc-a", "node", "10.0.0.2:9100", "r-2", "up", now.Add(-10*time.Minute))
	insertSnapshot("mc-b", "node", "10.0.0.3:9100", "r-3", "down", now)

	insertResource := func(id, ip string) {
		require.NoError(t, gormDB.Exec(`INSERT INTO resources
			(resource_id, resource_category, tenant_id, network_domain_id, env, status, source_type, scrape_port, dedup_key)
			VALUES (?,'host',?,?,?,'online','manual',9100,?)`,
			id, models.PlatformAdminTenantID, "mc-a", "PRD", "host|mc-a|"+id).Error)
		require.NoError(t, gormDB.Exec(`INSERT INTO host_resources
			(resource_id, hostname, instance_ip, os_type) VALUES (?,?,?,'linux')`, id, id, ip).Error)
	}
	insertResource("r-1", "10.0.0.1") // covered by a snapshot
	insertResource("r-4", "10.0.0.4") // not covered

	svc := service.NewQueryService(nil, repo, repo)

	admin := service.Actor{TenantID: models.PlatformAdminTenantID}
	rows, total, err := svc.Targets(ctx, admin, repository.TargetFilter{Page: 1, PageSize: 50})
	require.NoError(t, err)
	assert.EqualValues(t, 3, total)
	healthByInstance := map[string]string{}
	for _, row := range rows {
		healthByInstance[row.Instance] = row.Health
	}
	assert.Equal(t, "up", healthByInstance["10.0.0.1:9100"])
	assert.Equal(t, "unknown", healthByInstance["10.0.0.2:9100"], "stale report is downgraded")
	assert.Equal(t, "down", healthByInstance["10.0.0.3:9100"])

	tenantRows, tenantTotal, err := svc.Targets(ctx, service.Actor{TenantID: "tenant-a"},
		repository.TargetFilter{Page: 1, PageSize: 50})
	require.NoError(t, err)
	assert.EqualValues(t, 2, tenantTotal, "tenant-a only sees mc-a")
	for _, row := range tenantRows {
		assert.Equal(t, "mc-a", row.NetworkDomainID)
	}

	coverage, err := svc.Coverage(ctx, admin)
	require.NoError(t, err)
	assert.EqualValues(t, 1, coverage.Collecting)
	assert.EqualValues(t, 2, coverage.DeployedNotCollected)
	assert.EqualValues(t, 1, coverage.NotMonitored, "r-4 has no matching snapshot")

	emptyCoverage, err := svc.Coverage(ctx, service.Actor{TenantID: "tenant-missing"})
	require.NoError(t, err)
	assert.Equal(t, service.CoverageCounts{}, emptyCoverage, "no authorization yields zero counts")
}

func TestQueryProxyInjectsDomainMatcher(t *testing.T) {
	var gotQuery string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.Query().Get("query")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	require.NoError(t, err)

	_, _, repo := newTestStack(t)
	svc := service.NewQueryService(target, repo, repo)
	ctx := context.Background()

	status, body, meta, err := svc.Proxy(ctx, service.Actor{TenantID: "tenant-a"},
		"/api/v1/query", url.Values{"query": {"rate(http_requests_total[5m])"}})
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, status)
	assert.Contains(t, gotQuery, `http_requests_total{network_domain_id=~"mc-a"}`)
	assert.Equal(t, []string{"mc-a"}, meta.NetworkDomains)
	assert.Contains(t, string(body), `"success"`)
}

func TestQueryProxyFiltersAlerts(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","data":{"alerts":[
			{"labels":{"network_domain_id":"mc-a","alertname":"A"}},
			{"labels":{"network_domain_id":"mc-b","alertname":"B"}},
			{"labels":{"alertname":"unlabeled"}}
		]}}`))
	}))
	defer upstream.Close()
	target, err := url.Parse(upstream.URL)
	require.NoError(t, err)

	_, _, repo := newTestStack(t)
	svc := service.NewQueryService(target, repo, repo)
	status, body, _, err := svc.Proxy(context.Background(), service.Actor{TenantID: "tenant-a"},
		"/api/v1/alerts", url.Values{})
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, status)
	assert.Contains(t, string(body), "mc-a")
	assert.NotContains(t, string(body), "mc-b")
	assert.NotContains(t, string(body), "unlabeled")
}

func TestQueryProxyUnreachableIsUpstreamError(t *testing.T) {
	target, err := url.Parse("http://127.0.0.1:1")
	require.NoError(t, err)
	_, _, repo := newTestStack(t)
	svc := service.NewQueryService(target, repo, repo)

	_, _, _, err = svc.Proxy(context.Background(), service.Actor{TenantID: "tenant-a"},
		"/api/v1/query", url.Values{"query": {"up"}})
	require.Error(t, err)
	var upstream *service.UpstreamError
	assert.ErrorAs(t, err, &upstream)
	assert.True(t, strings.Contains(strings.ToLower(err.Error()), "unreachable"))
}
