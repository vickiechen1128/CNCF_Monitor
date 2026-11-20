package domain

import "time"

// Snapshot is one generated alertmanager.yml version (FR-06). `content` is the
// rendered YAML; `route_tree` is the editable truth that produced it (D47).
// History is read-only: there is no rollback path.
type Snapshot struct {
	ID          int64
	Version     string
	Checksum    string
	Content     string
	RouteTree   []RouteNode
	IsCurrent   bool
	GeneratedBy string
	GeneratedAt time.Time
	CreatedAt   time.Time
}

// ReloadLog is one reload attempt (FR-07). Append-only.
type ReloadLog struct {
	ID            int64
	SnapshotID    *int64
	ConfigVersion string
	Checksum      string
	Trigger       ReloadTrigger
	Status        ReloadStatus
	Operator      string
	Error         string
	DurationMS    int64
	StartedAt     time.Time
	FinishedAt    *time.Time
	CreatedAt     time.Time
}

// Silence is a runtime Alertmanager silence (FR-16). It is never persisted
// locally; the audit trail is.
type Silence struct {
	ID        string    `json:"id"`
	Matchers  []Matcher `json:"matchers"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	CreatedBy string    `json:"created_by"`
	Comment   string    `json:"comment"`
	Status    string    `json:"status,omitempty"`
}
