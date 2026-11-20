package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

func newEventService(t *testing.T) *EventService {
	t.Helper()
	g := newTestDB(t)
	svc := NewEventService(repository.NewEventRepository(g), EventOptions{
		Location: time.FixedZone("CST", 8*3600),
	})
	svc.SetClock(func() time.Time { return time.Date(2026, 11, 16, 10, 0, 0, 0, time.UTC) })
	return svc
}

func firingPayload() WebhookPayload {
	return WebhookPayload{
		Status: "firing", Receiver: "notify-c1",
		Alerts: []WebhookAlert{{
			Status:      "firing",
			Labels:      map[string]string{"alertname": "HostDown", "severity": "critical", "network_domain_id": "mc-a", "resource_id": "res-1", "instance": "10.0.0.1:9100"},
			Annotations: map[string]string{"summary": "主机不可达"},
			StartsAt:    time.Date(2026, 11, 16, 9, 0, 0, 0, time.UTC),
		}},
	}
}

func TestIngestIsIdempotentPerOccurrence(t *testing.T) {
	svc := newEventService(t)
	first, err := svc.Ingest(context.Background(), firingPayload())
	require.NoError(t, err)
	assert.Equal(t, 1, first.Inserted)
	assert.Equal(t, 0, first.Updated)

	second, err := svc.Ingest(context.Background(), firingPayload())
	require.NoError(t, err)
	assert.Equal(t, 0, second.Inserted)
	assert.Equal(t, 1, second.Updated)

	views, err := svc.Current(context.Background(), "")
	require.NoError(t, err)
	require.Len(t, views, 1)
	assert.Equal(t, "HostDown", views[0].Event.AlertName)
	assert.Equal(t, "mc-a", views[0].Event.NetworkDomain)
	assert.Equal(t, domain.EventStatusFiring, views[0].Event.Status)
}

func TestIngestResolveClosesEventAndUpdatesStats(t *testing.T) {
	svc := newEventService(t)
	_, err := svc.Ingest(context.Background(), firingPayload())
	require.NoError(t, err)

	resolved := firingPayload()
	resolved.Alerts[0].Status = "resolved"
	resolved.Alerts[0].EndsAt = time.Date(2026, 11, 16, 9, 30, 0, 0, time.UTC)
	result, err := svc.Ingest(context.Background(), resolved)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Updated)

	views, _, err := svc.List(context.Background(), repository.EventFilter{Page: 1, PageSize: 20})
	require.NoError(t, err)
	require.Len(t, views, 1)
	assert.Equal(t, domain.EventStatusResolved, views[0].Event.Status)
	require.NotNil(t, views[0].Event.ClosedAt)

	stats, err := svc.Stats(context.Background(), "")
	require.NoError(t, err)
	assert.Equal(t, int64(1), stats.TodayTotal)
	assert.Equal(t, int64(1), stats.TodayResolvedTotal)
	assert.Equal(t, int64(1), stats.TodayResolvedReal)
	assert.Equal(t, int64(0), stats.OpenTotal)
}

func TestReconcileClosesMissingEvents(t *testing.T) {
	svc := newEventService(t)
	_, err := svc.Ingest(context.Background(), firingPayload())
	require.NoError(t, err)

	// Reconcile with an empty active set: the event started >2min ago, so it is
	// closed as resolved.
	svc.SetClock(func() time.Time { return time.Date(2026, 11, 16, 10, 30, 0, 0, time.UTC) })
	seen, closed, err := svc.Reconcile(context.Background(), nil)
	require.NoError(t, err)
	assert.Equal(t, 0, seen)
	assert.Equal(t, 1, closed)

	views, err := svc.Current(context.Background(), "")
	require.NoError(t, err)
	assert.Empty(t, views)
}

func TestReconcileInsertsMissingEvents(t *testing.T) {
	svc := newEventService(t)
	alerts := []AMAlert{{
		Labels:   map[string]string{"alertname": "DiskFull", "network_domain_id": "mc-b"},
		StartsAt: time.Date(2026, 11, 16, 9, 45, 0, 0, time.UTC),
	}}
	alerts[0].Status.State = "active"
	seen, closed, err := svc.Reconcile(context.Background(), alerts)
	require.NoError(t, err)
	assert.Equal(t, 1, seen)
	assert.Equal(t, 0, closed)

	views, err := svc.Current(context.Background(), "")
	require.NoError(t, err)
	require.Len(t, views, 1)
	assert.Equal(t, "DiskFull", views[0].Event.AlertName)
}

func TestRetentionKeepsOpenRows(t *testing.T) {
	svc := newEventService(t)
	_, err := svc.Ingest(context.Background(), firingPayload())
	require.NoError(t, err)
	deleted, err := svc.PurgeExpired(context.Background())
	require.NoError(t, err)
	assert.Equal(t, int64(0), deleted)
}
