package domain

import (
	"crypto/sha256"
	"encoding/hex"
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
// time. The start time is normalised to UTC and truncated to milliseconds before
// hashing: webhook pushes and the reconciler observe the same alert at slightly
// different times/precisions, so a raw RFC3339 string would occasionally produce
// two keys for one occurrence and create duplicate rows. The SHA-256 digest keeps
// the key at a fixed 64-hex-char width (matches the V2 alert_events algorithm).
func OccurrenceKey(fingerprint string, startsAt time.Time) string {
	if fingerprint == "" {
		return ""
	}
	canonical := startsAt.UTC().Truncate(time.Millisecond).Format("2006-01-02T15:04:05.000Z")
	sum := sha256.Sum256([]byte(fingerprint + "|" + canonical))
	return hex.EncodeToString(sum[:])
}

// ClosedStatus maps the state an alert had when it disappeared to the matching
// terminal state for an explicit resolved notification (webhook path):
// silenced → silenced_closed, inhibited → inhibited_closed, otherwise resolved.
// Use InferredClosedStatus for reconciler-driven closes where no resolved
// notification (and therefore no reliable end time) was ever received.
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

// InferredClosedStatus maps an alert to its terminal state when the close was
// inferred by the reconciler (the alert simply stopped appearing). Firing alerts
// become resolved_unknown — the recovery time is not known — which keeps them
// out of the "real recovery" counter. silenced/inhibited map to their closed
// counterparts (their recovery time is likewise unknown).
func InferredClosedStatus(open EventStatus) EventStatus {
	switch open {
	case EventStatusSilenced:
		return EventStatusSilencedClosed
	case EventStatusInhibited:
		return EventStatusInhibitedClosed
	default:
		return EventStatusResolvedUnknown
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
