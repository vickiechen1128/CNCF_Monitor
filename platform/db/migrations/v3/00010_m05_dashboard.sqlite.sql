-- +goose Up
-- M05 v3 dashboard schema (SQLite dev/test variant).
--
-- Only the mounted-panel registry is owned by M05. The homepage summary itself
-- is a read-only aggregate over M00/M06/M07/M01 tables (`resources` + the six
-- extension tables, `m01_scrape_jobs`, `network_domains`, the dictionaries), so
-- it introduces no table of its own — v3 reuses the shared v3 schema instead of
-- the legacy v2 per-category tables.
--
-- Boundaries:
--   * a panel is an external Grafana dashboard URL; the row only carries the
--     display name used by the "自定义大屏" menu (M05 FR-08);
--   * `name` is globally unique (no soft delete in v3): renaming to an existing
--     name is a 409 conflict, and the list/menu never shows duplicates;
--   * no `deleted_at` on purpose — v3 keeps the “admin grows only” surface of
--     create/rename/update-url, and a soft-deleted row would keep occupying the
--     unique name.
CREATE TABLE IF NOT EXISTS m05_dashboard_panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The list is ordered by updated_at DESC, id DESC (most recently edited first).
CREATE INDEX IF NOT EXISTS idx_m05_dashboard_panels_updated_at
  ON m05_dashboard_panels(updated_at);

-- +goose Down
DROP TABLE IF EXISTS m05_dashboard_panels;
