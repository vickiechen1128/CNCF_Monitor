-- +goose Up
-- M07 v3 label templates (PostgreSQL production variant).
--
-- Mirrors 00007_m07_label_templates.sqlite.sql. JSON storage uses jsonb.
-- The v3 table is prefixed `m07_` to stay independent from the legacy v2
-- AutoMigrate table that also exists in transition mode.
CREATE TABLE IF NOT EXISTS m07_label_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware',
                                 'application', 'generic_target',
                                 'interface_service')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  mappings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m07_label_templates_name_category
  ON m07_label_templates(name, resource_category) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m07_label_templates_default
  ON m07_label_templates(resource_category)
  WHERE is_default = TRUE AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m07_label_templates_category
  ON m07_label_templates(resource_category);
CREATE INDEX IF NOT EXISTS idx_m07_label_templates_deleted_at
  ON m07_label_templates(deleted_at);

-- +goose Down
DROP INDEX IF EXISTS idx_m07_label_templates_deleted_at;
DROP INDEX IF EXISTS idx_m07_label_templates_category;
DROP INDEX IF EXISTS uq_m07_label_templates_default;
DROP INDEX IF EXISTS uq_m07_label_templates_name_category;
DROP TABLE IF EXISTS m07_label_templates;
