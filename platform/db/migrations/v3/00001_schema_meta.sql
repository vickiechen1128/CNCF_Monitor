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

INSERT INTO schema_meta(key, value)
SELECT 'schema_version', 'v3'
WHERE NOT EXISTS (SELECT 1 FROM schema_meta WHERE key = 'schema_version');

-- +goose Down
DROP TABLE IF EXISTS schema_meta;
