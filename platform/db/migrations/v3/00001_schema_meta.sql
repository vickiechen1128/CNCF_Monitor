-- +goose Up
-- v3 schema baseline marker.
--
-- The actual M07 resource tables are introduced in the next migration
-- (B1-2). This first migration exists so the migration runner can be wired,
-- tested and versioned before the schema rewrite lands.

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_meta(key, value) VALUES ('schema_version', 'v3');

-- +goose Down
DROP TABLE IF EXISTS schema_meta;
