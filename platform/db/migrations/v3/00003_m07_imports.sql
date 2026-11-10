-- +goose Up
CREATE TABLE IF NOT EXISTS import_records (
  id TEXT PRIMARY KEY,
  import_no TEXT NOT NULL,
  resource_category TEXT NOT NULL,
  mode TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  errors_json TEXT NOT NULL DEFAULT '[]',
  operator TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_records_no ON import_records(import_no);
CREATE INDEX IF NOT EXISTS idx_import_records_category ON import_records(resource_category, created_at);

-- +goose Down
DROP TABLE IF EXISTS import_records;
