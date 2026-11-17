package domain

import (
	"strings"
	"time"
)

// Event is one alert occurrence (FR-21..25). `occurrence_key` deduplicates
// webhook replays and reconciler inserts.
type Event struct {
	ID               int64
	OccurrenceKey    string
	Fingerprint      string
	AlertName        string
	Status           EventStatus
	Severity         string
	Summary          string
	Description      string
	NetworkDomain    string
	ResourceID       string
	ResourceCategory string
	Instance         string
	Labels           map[string]string
	Annotations      map[string]string
	StartsAt         time.Time
	EndsAt           *time.Time
	ClosedAt         *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

// OccurrenceKey builds the dedup key from the alert fingerprint and the start
// time. Time is normalised to UTC so replays from different zones collide.
func OccurrenceKey(fingerprint string, startsAt time.Time) string {
	return fingerprint + "|" + startsAt.UTC().Format(time.RFC3339)
}

// ClosedStatus maps the state an alert had when it disappeared to the matching
// terminal state (silenced → silenced_closed, inhibited → inhibited_closed,
// otherwise resolved; an unknown resolution time is resolved_unknown).
func ClosedStatus(open EventStatus) EventStatus {
	switch open {
	case EventStatusSilenced:
		return EventStatusSilencedClosed
	case EventStatusInhibited:
		return EventStatusInhibitedClosed
	default:
		return EventStatusResolved
	}
}

// NormalizeStatus maps an Alertmanager/reconciler status string onto an open
// event state. Unknown values are treated as firing (never lose an alert).
func NormalizeStatus(raw string) EventStatus {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "silenced":
		return EventStatusSilenced
	case "inhibited":
		return EventStatusInhibited
	case "resolved", "inactive":
		return EventStatusResolved
	default:
		return EventStatusFiring
	}
}

// DurationSeconds returns the resolved duration when both ends are known.
func DurationSeconds(start time.Time, end *time.Time) *int64 {
	if end == nil || end.IsZero() {
		return nil
	}
	seconds := int64(end.Sub(start).Seconds())
	if seconds < 0 {
		return nil
	}
	return &seconds
}
