package dto

import (
	"strconv"
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// EventResponse is the frozen alert-event projection consumed by M05 and the
// alert pages (D-M08-03). Field names must not change.
type EventResponse struct {
	ID               string            `json:"id"`
	AlertName        string            `json:"alert_name"`
	Status           string            `json:"status"`
	Severity         string            `json:"severity,omitempty"`
	Summary          string            `json:"summary,omitempty"`
	Description      string            `json:"description,omitempty"`
	NetworkDomain    string            `json:"network_domain,omitempty"`
	StartsAt         *time.Time        `json:"starts_at,omitempty"`
	EndsAt           *time.Time        `json:"ends_at,omitempty"`
	ClosedAt         *time.Time        `json:"closed_at,omitempty"`
	UpdatedAt        time.Time         `json:"updated_at"`
	DurationSeconds  *int64            `json:"duration_seconds,omitempty"`
	Fingerprint      string            `json:"fingerprint,omitempty"`
	Labels           map[string]string `json:"labels,omitempty"`
	Annotations      map[string]string `json:"annotations,omitempty"`
	InstanceAddress  string            `json:"instance_address"`
	InstanceDisplay  string            `json:"instance_display"`
	ResourceID       string            `json:"resource_id"`
	ResourceName     string            `json:"resource_name"`
	ResourceCategory string            `json:"resource_category"`
}

// EventInstance carries the resource-backfill fields (FR-25).
type EventInstance struct {
	InstanceAddress  string
	InstanceDisplay  string
	ResourceID       string
	ResourceName     string
	ResourceCategory string
}

// FromEvent projects an event with its resource backfill.
func FromEvent(event *domain.Event, inst EventInstance, now time.Time) EventResponse {
	updated := event.UpdatedAt
	if updated.IsZero() {
		updated = now
	}
	return EventResponse{
		ID: idString(event.ID), AlertName: event.AlertName, Status: string(event.Status),
		Severity: event.Severity, Summary: event.Summary, Description: event.Description,
		NetworkDomain: event.NetworkDomain, StartsAt: timePtr(event.StartsAt), EndsAt: event.EndsAt,
		ClosedAt: event.ClosedAt, UpdatedAt: updated,
		DurationSeconds: domain.DurationSeconds(event.StartsAt, event.EndsAt),
		Fingerprint:     event.Fingerprint, Labels: event.Labels, Annotations: event.Annotations,
		InstanceAddress: inst.InstanceAddress, InstanceDisplay: inst.InstanceDisplay,
		ResourceID: inst.ResourceID, ResourceName: inst.ResourceName,
		ResourceCategory: inst.ResourceCategory,
	}
}

// EventListResponse is the paginated event envelope.
type EventListResponse struct {
	List     []EventResponse `json:"list"`
	Total    int64           `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
}

func idString(id int64) string { return strconv.FormatInt(id, 10) }

func timePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}
