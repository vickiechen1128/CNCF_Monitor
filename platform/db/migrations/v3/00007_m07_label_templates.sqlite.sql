-- +goose Up
-- M07 v3 label templates (SQLite dev/test variant).
--
-- The legacy v2 line already owns a `label_templates` table via AutoMigrate.
-- The v3 table is prefixed `m07_` so both schema generations can coexist during
-- the transition window without drifting (same rationale as M01's `m01_*`).
--
-- A template is anchored at a coarse resource category and carries an ordered
-- list of source-field → target-label mappings (JSON). M01 references templates
-- read-only; the reference guard is provided by an injected usage checker.
CREATE TABLE IF NOT EXISTS m07_label_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware',
                                 'application', 'generic_target',
                                 'interface_service')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  mappings TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m07_label_templates_name_category
  ON m07_label_templates(name, resource_category) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m07_label_templates_default
  ON m07_label_templates(resource_category)
  WHERE is_default AND deleted_at IS NULL;
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
