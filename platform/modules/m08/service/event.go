package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
	"github.com/metriccenter/metriccenter/platform/modules/m08/references"
	"github.com/metriccenter/metriccenter/platform/modules/m08/repository"
)

// WebhookPayload is the Alertmanager webhook body we consume (FR-21).
type WebhookPayload struct {
	Version           string            `json:"version"`
	GroupKey          string            `json:"groupKey"`
	TruncatedAlerts   int               `json:"truncatedAlerts"`
	Status            string            `json:"status"`
	Receiver          string            `json:"receiver"`
	GroupLabels       map[string]string `json:"groupLabels"`
	CommonLabels      map[string]string `json:"commonLabels"`
	CommonAnnotations map[string]string `json:"commonAnnotations"`
	ExternalURL       string            `json:"externalURL"`
	Alerts            []WebhookAlert    `json:"alerts"`
}

// WebhookAlert is one alert in the webhook payload.
type WebhookAlert struct {
	Status       string            `json:"status"`
	Labels       map[string]string `json:"labels"`
	Annotations  map[string]string `json:"annotations"`
	StartsAt     time.Time         `json:"startsAt"`
	EndsAt       time.Time         `json:"endsAt"`
	GeneratorURL string            `json:"generatorURL"`
	Fingerprint  string            `json:"fingerprint"`
}

// IngestResult counts what one webhook delivery changed.
type IngestResult struct {
	Received int
	Inserted int
	Updated  int
	Skipped  int
}

// EventView is a persisted event plus its resource backfill (FR-25).
type EventView struct {
	Event    *domain.Event
	Instance EventInstance
}

// EventInstance carries the display fields resolved from M07.
type EventInstance struct {
	Address  string
	Display  string
	ResourceID string
	Name     string
	Category string
}

// EventService owns alert-event ingestion, reconciliation and queries
// (FR-21..25). The event table is the single source of truth.
type EventService struct {
	events repository.EventRepository
	namer  references.ResourceNamer
	loc    *time.Location
	now    func() time.Time
	retentionDays int
}

// EventOptions wires the event service.
type EventOptions struct {
	Namer         references.ResourceNamer
	Location      *time.Location
	RetentionDays int
}

// NewEventService constructs the service.
func NewEventService(events repository.EventRepository, opts EventOptions) *EventService {
	loc := opts.Location
	if loc == nil {
		loc = time.FixedZone("CST", 8*3600)
	}
	retention := opts.RetentionDays
	if retention <= 0 {
		retention = 180
	}
	return &EventService{events: events, namer: opts.Namer, loc: loc, retentionDays: retention,
		now: func() time.Time { return time.Now().UTC() }}
}

// SetClock overrides the clock (tests).
func (s *EventService) SetClock(now func() time.Time) { s.now = now }

// Ingest writes one webhook delivery; it is idempotent per occurrence key.
func (s *EventService) Ingest(ctx context.Context, payload WebhookPayload) (IngestResult, error) {
	result := IngestResult{Received: len(payload.Alerts)}
	for _, alert := range payload.Alerts {
		outcome, err := s.ingestOne(ctx, alert)
		if err != nil {
			return result, err
		}
		switch outcome {
		case ingestInserted:
			result.Inserted++
		case ingestUpdated:
			result.Updated++
		default:
			result.Skipped++
		}
	}
	return result, nil
}

type ingestOutcome int

const (
	ingestSkipped ingestOutcome = iota
	ingestInserted
	ingestUpdated
)

func (s *EventService) ingestOne(ctx context.Context, alert WebhookAlert) (ingestOutcome, error) {
	fingerprint := alertFingerprint(alert)
	startsAt := alert.StartsAt.UTC()
	if startsAt.IsZero() {
		startsAt = s.now()
	}
	key := domain.OccurrenceKey(fingerprint, startsAt)
	existing, found, err := s.events.FindByOccurrenceKey(ctx, key)
	if err != nil {
		return ingestSkipped, err
	}
	status := domain.NormalizeStatus(alert.Status)
	event := buildEvent(alert, fingerprint, key, startsAt, status, s.now())
	if !found {
		if err := s.events.Insert(ctx, event); err != nil {
			return ingestSkipped, err
		}
		return ingestInserted, nil
	}
	if !domain.IsOpenStatus(existing.Status) {
		return ingestSkipped, nil
	}
	applyAlertUpdate(existing, alert, status, s.now())
	if err := s.events.Update(ctx, existing); err != nil {
		return ingestSkipped, err
	}
	return ingestUpdated, nil
}

// Reconcile aligns the event table with Alertmanager's active alerts: it inserts
// misses, refreshes state and closes rows that disappeared (FR-22).
func (s *EventService) Reconcile(ctx context.Context, alerts []AMAlert) (int, int, error) {
	now := s.now()
	live := make(map[string]bool, len(alerts))
	for _, alert := range alerts {
		key := domain.OccurrenceKey(alert.FingerprintKey(), alert.StartsAt.UTC())
		live[key] = true
		if _, err := s.ingestOne(ctx, alert.toWebhookAlert()); err != nil {
			return 0, 0, err
		}
	}
	open, err := s.events.ListOpen(ctx, "")
	if err != nil {
		return 0, 0, err
	}
	closed := 0
	for _, event := range open {
		if live[event.OccurrenceKey] || now.Sub(event.StartsAt) < 2*time.Minute {
			continue
		}
		event.Status = domain.ClosedStatus(event.Status)
		event.ClosedAt = &now
		if err := s.events.Update(ctx, event); err != nil {
			return 0, 0, err
		}
		closed++
	}
	return len(alerts), closed, nil
}

// List returns a page of historical events (FR-24) with resource backfill.
func (s *EventService) List(ctx context.Context, filter repository.EventFilter) ([]EventView, int64, error) {
	events, total, err := s.events.List(ctx, filter)
	if err != nil {
		return nil, 0, err
	}
	views, err := s.enrich(ctx, events)
	return views, total, err
}

// Current returns every unresolved event (FR-23).
func (s *EventService) Current(ctx context.Context, networkDomain string) ([]EventView, error) {
	events, err := s.events.ListOpen(ctx, networkDomain)
	if err != nil {
		return nil, err
	}
	return s.enrich(ctx, events)
}

// Stats computes the frozen home-card counters for the current local day.
func (s *EventService) Stats(ctx context.Context, networkDomain string) (repository.Stats, error) {
	local := s.now().In(s.loc)
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, s.loc).UTC()
	return s.events.Stats(ctx, dayStart, dayStart.AddDate(0, 0, 1), networkDomain)
}

// PurgeExpired applies the retention policy (NFR-09): terminal rows older than
// the configured days; unresolved rows are never purged.
func (s *EventService) PurgeExpired(ctx context.Context) (int64, error) {
	before := s.now().AddDate(0, 0, -s.retentionDays)
	return s.events.PurgeExpired(ctx, before)
}

// RunRetention purges once at start and then daily until ctx is cancelled.
func (s *EventService) RunRetention(ctx context.Context) {
	purge := func() {
		if deleted, err := s.PurgeExpired(ctx); err != nil {
			log.Printf("[m08] alert-event retention failed: %v", err)
		} else if deleted > 0 {
			log.Printf("[m08] alert-event retention deleted %d expired rows", deleted)
		}
	}
	purge()
	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			purge()
		}
	}
}

func (s *EventService) enrich(ctx context.Context, events []*domain.Event) ([]EventView, error) {
	ids := make([]string, 0, len(events))
	for _, event := range events {
		if event.ResourceID != "" {
			ids = append(ids, event.ResourceID)
		}
	}
	var named map[string]references.ResourceInfo
	if s.namer != nil && len(ids) > 0 {
		var err error
		named, err = s.namer.GetMany(ctx, ids)
		if err != nil {
			log.Printf("[m08] resource backfill failed: %v", err)
			named = nil
		}
	}
	views := make([]EventView, 0, len(events))
	for _, event := range events {
		instance := EventInstance{
			Address: event.Instance, ResourceID: event.ResourceID,
			Category: event.ResourceCategory,
		}
		if info, ok := named[event.ResourceID]; ok {
			instance.Name = info.Name
			if instance.Category == "" {
				instance.Category = info.Category
			}
		}
		instance.Display = instance.Name
		if instance.Display == "" {
			instance.Display = event.Instance
		}
		views = append(views, EventView{Event: event, Instance: instance})
	}
	return views, nil
}

func buildEvent(alert WebhookAlert, fingerprint, key string, startsAt time.Time, status domain.EventStatus, now time.Time) *domain.Event {
	event := &domain.Event{
		OccurrenceKey: key, Fingerprint: fingerprint, AlertName: labelOf(alert.Labels, "alertname"),
		Status: status, Severity: labelOf(alert.Labels, "severity"),
		Summary: labelOf(alert.Annotations, "summary"), Description: labelOf(alert.Annotations, "description"),
		NetworkDomain: labelOf(alert.Labels, "network_domain_id"),
		ResourceID:    labelOf(alert.Labels, "resource_id"),
		Instance:      labelOf(alert.Labels, "instance"),
		Labels:        alert.Labels, Annotations: alert.Annotations, StartsAt: startsAt,
		CreatedAt: now, UpdatedAt: now,
	}
	if !alert.EndsAt.IsZero() && status != domain.EventStatusFiring &&
		status != domain.EventStatusSilenced && status != domain.EventStatusInhibited {
		ends := alert.EndsAt.UTC()
		event.EndsAt = &ends
		event.ClosedAt = &ends
	}
	return event
}

func applyAlertUpdate(event *domain.Event, alert WebhookAlert, status domain.EventStatus, now time.Time) {
	if alert.Labels != nil {
		event.Labels = alert.Labels
		event.AlertName = orFallback(labelOf(alert.Labels, "alertname"), event.AlertName)
		event.Severity = orFallback(labelOf(alert.Labels, "severity"), event.Severity)
		event.NetworkDomain = orFallback(labelOf(alert.Labels, "network_domain_id"), event.NetworkDomain)
		event.ResourceID = orFallback(labelOf(alert.Labels, "resource_id"), event.ResourceID)
		event.Instance = orFallback(labelOf(alert.Labels, "instance"), event.Instance)
	}
	if alert.Annotations != nil {
		event.Annotations = alert.Annotations
		event.Summary = orFallback(labelOf(alert.Annotations, "summary"), event.Summary)
		event.Description = orFallback(labelOf(alert.Annotations, "description"), event.Description)
	}
	if status == domain.EventStatusResolved {
		event.Status = domain.ClosedStatus(event.Status)
		closed := now
		if !alert.EndsAt.IsZero() {
			ends := alert.EndsAt.UTC()
			event.EndsAt = &ends
			closed = ends
		}
		event.ClosedAt = &closed
	} else if domain.IsOpenStatus(status) {
		event.Status = status
	}
	event.UpdatedAt = now
}

// alertFingerprint prefers the payload fingerprint and otherwise derives a
// stable digest from the sorted label set.
func alertFingerprint(alert WebhookAlert) string {
	if alert.Fingerprint != "" {
		return alert.Fingerprint
	}
	keys := make([]string, 0, len(alert.Labels))
	for key := range alert.Labels {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for _, key := range keys {
		builder.WriteString(key)
		builder.WriteString("=")
		builder.WriteString(alert.Labels[key])
		builder.WriteString(";")
	}
	sum := sha256.Sum256([]byte(builder.String()))
	return hex.EncodeToString(sum[:8])
}

func labelOf(labels map[string]string, key string) string {
	if labels == nil {
		return ""
	}
	return labels[key]
}

func orFallback(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// String renders the ingest summary for logs.
func (r IngestResult) String() string {
	return fmt.Sprintf("received=%d inserted=%d updated=%d skipped=%d", r.Received, r.Inserted, r.Updated, r.Skipped)
}
