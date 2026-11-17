package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// EventFilter filters alert-event listings (FR-24).
type EventFilter struct {
	Status        domain.EventStatus
	StatusGroup   string // "open" selects the three unresolved states
	Severity      string
	AlertName     string
	Summary       string
	Description   string
	NetworkDomain string
	StartsFrom    *time.Time
	StartsTo      *time.Time
	EndsFrom      *time.Time
	EndsTo        *time.Time
	Sort          string
	Page          int
	PageSize      int
}

// Stats mirrors the frozen home-card counters (D-M08-03). Field names must not
// change: M05 consumes them directly.
type Stats struct {
	TodayTotal int64 `json:"today_total"`

	TodayResolvedTotal    int64 `json:"today_resolved_total"`
	TodayResolvedReal     int64 `json:"today_resolved_real"`
	TodayResolvedInferred int64 `json:"today_resolved_inferred"`

	OpenTotal     int64 `json:"open_total"`
	OpenFiring    int64 `json:"open_firing"`
	OpenSilenced  int64 `json:"open_silenced"`
	OpenInhibited int64 `json:"open_inhibited"`

	LegacyOpenTotal     int64 `json:"legacy_open_total"`
	LegacyOpenFiring    int64 `json:"legacy_open_firing"`
	LegacyOpenSilenced  int64 `json:"legacy_open_silenced"`
	LegacyOpenInhibited int64 `json:"legacy_open_inhibited"`

	LegacyResolvedTodayTotal    int64 `json:"legacy_resolved_today_total"`
	LegacyResolvedTodayReal     int64 `json:"legacy_resolved_today_real"`
	LegacyResolvedTodayInferred int64 `json:"legacy_resolved_today_inferred"`
}

var terminalStatuses = []string{
	string(domain.EventStatusResolved), string(domain.EventStatusSilencedClosed),
	string(domain.EventStatusInhibitedClosed), string(domain.EventStatusResolvedUnknown),
}

var inferredTerminalStatuses = []string{
	string(domain.EventStatusSilencedClosed), string(domain.EventStatusInhibitedClosed),
	string(domain.EventStatusResolvedUnknown),
}

// EventRepository persists alert events (single source of truth, FR-21..25).
type EventRepository interface {
	FindByOccurrenceKey(ctx context.Context, key string) (*domain.Event, bool, error)
	Insert(ctx context.Context, event *domain.Event) error
	Update(ctx context.Context, event *domain.Event) error
	ListOpen(ctx context.Context, networkDomain string) ([]*domain.Event, error)
	List(ctx context.Context, filter EventFilter) ([]*domain.Event, int64, error)
	Stats(ctx context.Context, dayStart, dayEnd time.Time, networkDomain string) (Stats, error)
	PurgeExpired(ctx context.Context, before time.Time) (int64, error)
	DistinctValues(ctx context.Context, column string) ([]string, error)
}

// GORMEventRepository is the GORM-backed implementation.
type GORMEventRepository struct{ db *gorm.DB }

// NewEventRepository constructs the repository.
func NewEventRepository(db *gorm.DB) *GORMEventRepository { return &GORMEventRepository{db: db} }

// FindByOccurrenceKey loads one event by its dedup key.
func (r *GORMEventRepository) FindByOccurrenceKey(ctx context.Context, key string) (*domain.Event, bool, error) {
	var rec eventRecord
	err := r.db.WithContext(ctx).Where("occurrence_key = ?", key).First(&rec).Error
	if isNotFound(err) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return rec.toDomain(), true, nil
}

// Insert creates a new event row.
func (r *GORMEventRepository) Insert(ctx context.Context, event *domain.Event) error {
	rec := eventFromDomain(event)
	if err := r.db.WithContext(ctx).Create(rec).Error; err != nil {
		return mapWriteError(err, "alert_event", "occurrence_key", event.OccurrenceKey)
	}
	event.ID = rec.ID
	event.CreatedAt, event.UpdatedAt = rec.CreatedAt, rec.UpdatedAt
	return nil
}

// Update rewrites the mutable state columns.
func (r *GORMEventRepository) Update(ctx context.Context, event *domain.Event) error {
	labels, err := json.Marshal(event.Labels)
	if err != nil {
		return fmt.Errorf("encode alert labels: %w", err)
	}
	annotations, err := json.Marshal(event.Annotations)
	if err != nil {
		return fmt.Errorf("encode alert annotations: %w", err)
	}
	res := r.db.WithContext(ctx).Model(&eventRecord{}).Where("id = ?", event.ID).
		Updates(map[string]any{
			"status":      string(event.Status),
			"severity":    event.Severity,
			"summary":     event.Summary,
			"description": event.Description,
			"network_domain": event.NetworkDomain,
			"resource_id": event.ResourceID,
			"resource_category": event.ResourceCategory,
			"instance":    event.Instance,
			"labels":      string(labels),
			"annotations": string(annotations),
			"ends_at":     event.EndsAt,
			"closed_at":   event.ClosedAt,
			"updated_at":  time.Now().UTC(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return notFound("alert_event", idString(event.ID))
	}
	return nil
}

// ListOpen returns every unresolved event.
func (r *GORMEventRepository) ListOpen(ctx context.Context, networkDomain string) ([]*domain.Event, error) {
	q := r.db.WithContext(ctx).Where("status IN ?", domain.OpenEventStatuses())
	if strings.TrimSpace(networkDomain) != "" {
		q = q.Where("network_domain = ?", networkDomain)
	}
	var recs []eventRecord
	if err := q.Order("id ASC").Find(&recs).Error; err != nil {
		return nil, err
	}
	out := make([]*domain.Event, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, nil
}

// List returns a page of events (FR-24).
func (r *GORMEventRepository) List(ctx context.Context, filter EventFilter) ([]*domain.Event, int64, error) {
	page, pageSize := normalizePage(filter.Page, filter.PageSize)
	build := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&eventRecord{})
		if filter.StatusGroup == "open" {
			q = q.Where("status IN ?", domain.OpenEventStatuses())
		} else if filter.Status != "" {
			q = q.Where("status = ?", string(filter.Status))
		}
		if v := strings.TrimSpace(filter.Severity); v != "" {
			q = q.Where("severity = ?", v)
		}
		if v := strings.TrimSpace(filter.AlertName); v != "" {
			q = q.Where("alert_name LIKE ?", "%"+v+"%")
		}
		if v := strings.TrimSpace(filter.Summary); v != "" {
			q = q.Where("summary LIKE ?", "%"+v+"%")
		}
		if v := strings.TrimSpace(filter.Description); v != "" {
			q = q.Where("description LIKE ?", "%"+v+"%")
		}
		if v := strings.TrimSpace(filter.NetworkDomain); v != "" {
			q = q.Where("network_domain = ?", v)
		}
		if filter.StartsFrom != nil {
			q = q.Where("starts_at >= ?", *filter.StartsFrom)
		}
		if filter.StartsTo != nil {
			q = q.Where("starts_at <= ?", *filter.StartsTo)
		}
		if filter.EndsFrom != nil {
			q = q.Where("ends_at >= ?", *filter.EndsFrom)
		}
		if filter.EndsTo != nil {
			q = q.Where("ends_at <= ?", *filter.EndsTo)
		}
		return q
	}
	var total int64
	if err := build().Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "starts_at DESC, id DESC"
	if strings.EqualFold(strings.TrimSpace(filter.Sort), "starts_at asc") {
		order = "starts_at ASC, id ASC"
	}
	var recs []eventRecord
	if err := paginate(build().Order(order), page, pageSize).Find(&recs).Error; err != nil {
		return nil, 0, err
	}
	out := make([]*domain.Event, 0, len(recs))
	for i := range recs {
		out = append(out, recs[i].toDomain())
	}
	return out, total, nil
}

// Stats computes the frozen home-card counters. dayStart/dayEnd must already be
// expressed in the display timezone (they are compared against stored times as
// given), so callers pass the local-day bounds converted to UTC.
func (r *GORMEventRepository) Stats(ctx context.Context, dayStart, dayEnd time.Time, networkDomain string) (Stats, error) {
	var st Stats
	base := func() *gorm.DB {
		q := r.db.WithContext(ctx).Model(&eventRecord{})
		if strings.TrimSpace(networkDomain) != "" {
			q = q.Where("network_domain = ?", networkDomain)
		}
		return q
	}
	open := domain.OpenEventStatuses()
	queries := []struct {
		dest *int64
		q    *gorm.DB
	}{
		{&st.OpenTotal, base().Where("status IN ?", open)},
		{&st.OpenFiring, base().Where("status = ?", string(domain.EventStatusFiring))},
		{&st.OpenSilenced, base().Where("status = ?", string(domain.EventStatusSilenced))},
		{&st.OpenInhibited, base().Where("status = ?", string(domain.EventStatusInhibited))},
		{&st.TodayTotal, base().Where("starts_at >= ? AND starts_at < ?", dayStart, dayEnd)},
		{&st.TodayResolvedTotal, base().Where(
			"status IN ? AND starts_at >= ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?",
			terminalStatuses, dayStart, dayEnd, dayStart, dayEnd)},
		{&st.TodayResolvedReal, base().Where(
			"status = ? AND starts_at >= ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?",
			string(domain.EventStatusResolved), dayStart, dayEnd, dayStart, dayEnd)},
		{&st.TodayResolvedInferred, base().Where(
			"status IN ? AND starts_at >= ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?",
			inferredTerminalStatuses, dayStart, dayEnd, dayStart, dayEnd)},
		{&st.LegacyOpenTotal, base().Where(
			"starts_at < ? AND (status IN ? OR (status IN ? AND closed_at >= ? AND closed_at < ?))",
			dayStart, open, terminalStatuses, dayStart, dayEnd)},
		{&st.LegacyOpenFiring, base().Where("status = ? AND starts_at < ?", string(domain.EventStatusFiring), dayStart)},
		{&st.LegacyOpenSilenced, base().Where("status = ? AND starts_at < ?", string(domain.EventStatusSilenced), dayStart)},
		{&st.LegacyOpenInhibited, base().Where("status = ? AND starts_at < ?", string(domain.EventStatusInhibited), dayStart)},
		{&st.LegacyResolvedTodayTotal, base().Where(
			"status IN ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?",
			terminalStatuses, dayStart, dayStart, dayEnd)},
		{&st.LegacyResolvedTodayReal, base().Where(
			"status = ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?",
			string(domain.EventStatusResolved), dayStart, dayStart, dayEnd)},
		{&st.LegacyResolvedTodayInferred, base().Where(
			"status IN ? AND starts_at < ? AND closed_at >= ? AND closed_at < ?",
			inferredTerminalStatuses, dayStart, dayStart, dayEnd)},
	}
	for _, item := range queries {
		if err := item.q.Count(item.dest).Error; err != nil {
			return Stats{}, err
		}
	}
	return st, nil
}

// distinctColumns whitelists the columns usable for matcher autocomplete.
var distinctColumns = map[string]bool{
	"network_domain": true, "alert_name": true, "severity": true, "resource_category": true,
}

// DistinctValues returns the non-empty distinct values of a whitelisted column.
func (r *GORMEventRepository) DistinctValues(ctx context.Context, column string) ([]string, error) {
	if !distinctColumns[column] {
		return nil, fmt.Errorf("distinct: unsupported column %q", column)
	}
	var values []string
	err := r.db.WithContext(ctx).Model(&eventRecord{}).
		Where(column+" <> ''").
		Distinct().Order(column).Pluck(column, &values).Error
	return values, err
}

// PurgeExpired deletes terminal events older than the retention boundary. Open
// rows are never purged (NFR-09).
func (r *GORMEventRepository) PurgeExpired(ctx context.Context, before time.Time) (int64, error) {
	res := r.db.WithContext(ctx).
		Where("status NOT IN ?", domain.OpenEventStatuses()).
		Where("COALESCE(closed_at, ends_at, updated_at) < ?", before).
		Delete(&eventRecord{})
	return res.RowsAffected, res.Error
}
