-- +goose Up
CREATE TABLE IF NOT EXISTS blackbox_modules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blackbox_modules_name ON blackbox_modules(name);
CREATE INDEX IF NOT EXISTS idx_blackbox_modules_deleted_at ON blackbox_modules(deleted_at);

-- +goose Down
DROP INDEX IF EXISTS idx_blackbox_modules_deleted_at;
DROP INDEX IF EXISTS idx_blackbox_modules_name;
DROP TABLE IF EXISTS blackbox_modules;
