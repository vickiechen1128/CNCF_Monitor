package service

import (
	"context"
	"log"
	"time"
)

// AlertsSource reads the Alertmanager active-alert set for reconciliation.
type AlertsSource interface {
	ActiveAlerts(ctx context.Context) ([]AMAlert, error)
}

// ReconcileService periodically aligns the event table with Alertmanager
// (FR-22). One round is bounded by the caller's context; a failed round is
// logged and retried on the next tick.
type ReconcileService struct {
	events   *EventService
	source   AlertsSource
	interval time.Duration
}

// NewReconcileService constructs the reconciler (default interval 60s).
func NewReconcileService(events *EventService, source AlertsSource, interval time.Duration) *ReconcileService {
	if interval <= 0 {
		interval = time.Minute
	}
	return &ReconcileService{events: events, source: source, interval: interval}
}

// RunOnce performs one reconciliation round.
func (s *ReconcileService) RunOnce(ctx context.Context) (int, int, error) {
	if s.source == nil {
		return 0, 0, nil
	}
	alerts, err := s.source.ActiveAlerts(ctx)
	if err != nil {
		return 0, 0, err
	}
	return s.events.Reconcile(ctx, alerts)
}

// Run loops until ctx is cancelled; the first round runs immediately.
func (s *ReconcileService) Run(ctx context.Context) {
	round := func() {
		roundCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		seen, closed, err := s.RunOnce(roundCtx)
		if err != nil {
			log.Printf("[m08] alert reconcile failed: %v", err)
			return
		}
		if seen > 0 || closed > 0 {
			log.Printf("[m08] alert reconcile: active=%d closed=%d", seen, closed)
		}
	}
	round()
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			round()
		}
	}
}
