-- +goose Up
-- M05 v3 dashboard schema (PostgreSQL production variant).
--
-- Mirrors 00010_m05_dashboard.sqlite.sql. The only DDL difference is the
-- auto-increment strategy (BIGSERIAL vs INTEGER PRIMARY KEY AUTOINCREMENT);
-- identity, uniqueness and ordering semantics are identical.
--
-- The homepage summary is a read-only aggregate over M00/M06/M07/M01 tables, so
-- M05 owns exactly one table: the mounted Grafana panel registry (M05 FR-08).
CREATE TABLE IF NOT EXISTS m05_dashboard_panels (
  id BIGSERIAL PRIMARY KEY,
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
