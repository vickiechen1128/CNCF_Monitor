package dto

import (
	"time"

	"github.com/metriccenter/metriccenter/platform/modules/m08/domain"
)

// ReloadSummary is the reload outcome embedded in save responses.
type ReloadSummary struct {
	Status     string     `json:"status"`
	Trigger    string     `json:"trigger,omitempty"`
	DurationMS int64      `json:"duration_ms"`
	At         *time.Time `json:"at,omitempty"`
}

// SnapshotResponse is the current (or historical) generated configuration.
// `route_tree` is the editable truth behind the YAML (D47); `inhibit_rules` is
// hydrated from its own table at read time (D49).
type SnapshotResponse struct {
	ID           string                  `json:"id"`
	Version      string                  `json:"version"`
	Checksum     string                  `json:"checksum"`
	Content      string                  `json:"content"`
	RouteTree    []domain.RouteNode      `json:"route_tree"`
	InhibitRules []InhibitionResponse    `json:"inhibit_rules"`
	IsCurrent    bool                    `json:"is_current"`
	GeneratedBy  string                  `json:"generated_by"`
	GeneratedAt  time.Time               `json:"generated_at"`
	Reload       *ReloadSummary          `json:"reload,omitempty"`
}

// SnapshotListItem is the history row (content omitted to keep the list light).
type SnapshotListItem struct {
	ID          string    `json:"id"`
	Version     string    `json:"version"`
	Checksum    string    `json:"checksum"`
	IsCurrent   bool      `json:"is_current"`
	GeneratedBy string    `json:"generated_by"`
	GeneratedAt time.Time `json:"generated_at"`
}

// ReloadLogResponse is one reload attempt (read-only).
type ReloadLogResponse struct {
	ID            string     `json:"id"`
	ConfigVersion string     `json:"config_version"`
	Checksum      string     `json:"checksum"`
	Status        string     `json:"status"`
	Trigger       string     `json:"trigger"`
	Operator      string     `json:"operator"`
	DurationMS    int64      `json:"duration_ms"`
	StartedAt     time.Time  `json:"started_at"`
	FinishedAt    *time.Time `json:"finished_at,omitempty"`
	Error         string     `json:"error,omitempty"`
}

// RouteTreeResponse is the read-only routing tree plus the optimistic-lock base.
type RouteTreeResponse struct {
	RouteTree    []domain.RouteNode `json:"route_tree"`
	BaseChecksum string             `json:"base_checksum"`
}

// SaveRouteRequest is the route-save payload (FR-13/FR-14).
type SaveRouteRequest struct {
	BaseChecksum string             `json:"base_checksum"`
	RouteTree    []domain.RouteNode `json:"route_tree"`
}

// SaveResult is the shared save response for route and inhibition writes.
type SaveResult struct {
	ConfigChecksum  string        `json:"config_checksum"`
	ConfigVersion   string        `json:"config_version"`
	PendingSections []string      `json:"pending_sections"`
	Reload          *ReloadSummary `json:"reload,omitempty"`
	SnapshotSynced  bool          `json:"snapshot_synced"`
}
