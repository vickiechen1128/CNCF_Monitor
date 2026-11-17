// Package domain holds the M05 dashboard entities and ports.
//
// M05 owns two things in v3:
//   - the homepage summary aggregate (`GET /api/v3/platform/dashboard/summary`);
//   - the mounted Grafana panel registry (M05 FR-08).
//
// The summary response structs are re-used from `platform/dashboard` so the
// frontend contract (`ui-custom/web/src/api/dashboard.ts`) stays byte-for-byte
// identical to the v2 line; only the aggregation logic differs here because v3
// stores every resource in the shared `resources` table.
package domain

import (
	"errors"
	"time"
)

// ErrNameTaken marks a panel-name collision detected at the storage layer.
// The service also pre-checks the name; this sentinel covers the race where a
// concurrent create beats that check and trips the unique index.
var ErrNameTaken = errors.New("dashboard panel name already exists")

// Panel is one mounted Grafana dashboard (M05 FR-08).
//
// The row only carries the display name used by the "自定义大屏" menu and the
// external dashboard URL rendered in kiosk mode. Identity is the numeric ID.
type Panel struct {
	ID        uint
	Name      string
	URL       string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// CreatePanelInput is the validated create payload.
type CreatePanelInput struct {
	Name string
	URL  string
}

// UpdatePanelInput is the validated update payload (only name / url are
// mutable; the ID and created_at never change).
type UpdatePanelInput struct {
	Name string
	URL  string
}
