-- +goose Up
CREATE TABLE IF NOT EXISTS dashboard_panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  name TEXT NOT NULL,
  url TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_panels_name ON dashboard_panels(name);
CREATE INDEX IF NOT EXISTS idx_dashboard_panels_deleted_at ON dashboard_panels(deleted_at);

-- +goose Down
DROP INDEX IF EXISTS idx_dashboard_panels_deleted_at;
DROP INDEX IF EXISTS idx_dashboard_panels_name;
DROP TABLE IF EXISTS dashboard_panels;
