package alerts

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestListActiveAlertsMapsFingerprintAndSuppression 历史告警对账依赖：
// 指纹 + 静默/抑制标记必须完整透出。
func TestListActiveAlertsMapsFingerprintAndSuppression(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/v2/alerts", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"fingerprint":"fp-1","labels":{"alertname":"InstanceDown"},"annotations":{"summary":"s"},
			 "startsAt":"2026-10-25T08:00:00Z","endsAt":"0001-01-01T00:00:00Z",
			 "status":{"state":"suppressed","silencedBy":["sil-1"],"inhibitedBy":["inh-1"]}}
		]`))
	}))
	t.Cleanup(srv.Close)

	proxy, err := NewProxy(srv.URL)
	require.NoError(t, err)
	list, err := proxy.ListActiveAlerts(context.Background())
	require.NoError(t, err)
	require.Len(t, list, 1)

	assert.Equal(t, "fp-1", list[0].Fingerprint)
	assert.Equal(t, "InstanceDown", list[0].Labels["alertname"])
	assert.Equal(t, []string{"sil-1"}, list[0].SilencedBy)
	assert.Equal(t, []string{"inh-1"}, list[0].InhibitedBy)
	assert.True(t, list[0].StartsAt.Equal(time.Date(2026, 10, 25, 8, 0, 0, 0, time.UTC)))
}

// TestAlertmanagerStartedAtParsesUptime 对账重启窗口判定依赖 AM 的 uptime（启动时刻）。
func TestAlertmanagerStartedAtParsesUptime(t *testing.T) {
	started := time.Date(2026, 10, 25, 8, 0, 0, 0, time.UTC)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/api/v2/status", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"uptime":"2026-10-25T08:00:00Z"}`))
	}))
	t.Cleanup(srv.Close)

	proxy, err := NewProxy(srv.URL)
	require.NoError(t, err)
	got, err := proxy.AlertmanagerStartedAt(context.Background())
	require.NoError(t, err)
	assert.True(t, got.Equal(started))
}

// TestAlertmanagerStartedAtEmptyUptime 缺 uptime 时返回零值（调用方按不可信处理，不关行）。
func TestAlertmanagerStartedAtEmptyUptime(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(srv.Close)

	proxy, err := NewProxy(srv.URL)
	require.NoError(t, err)
	got, err := proxy.AlertmanagerStartedAt(context.Background())
	require.NoError(t, err)
	assert.True(t, got.IsZero())
}
