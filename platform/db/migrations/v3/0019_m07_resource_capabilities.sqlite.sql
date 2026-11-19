-- +goose Up
-- M07 resource capability attributes (SRS Module_07 v2.1 §3.5 / §5.8):
-- common capabilities get first-class boolean columns, long-tail capabilities
-- go through the generic attribute dictionary + per-resource attribute rows.
--
-- HARD RULE: capability attributes describe FACTS only. They never carry
-- collection strategy and never inject Prometheus labels; M01 reads them to
-- derive a monitor_type (SRS Module_01 v1.3 §5.6).

-- 1) Common capabilities as first-class host columns.
ALTER TABLE host_resources ADD COLUMN has_npu BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE host_resources ADD COLUMN has_gpu BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Long-tail capability dictionary. Registering a new key must not require a
-- schema change or a release (FR-31 / NFR-23).
CREATE TABLE m07_attribute_definitions (
  id TEXT PRIMARY KEY,
  attribute_key TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  value_type TEXT NOT NULL
    CHECK (value_type IN ('boolean', 'number', 'text', 'enum')),
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  enum_options TEXT NOT NULL DEFAULT '[]',
  required BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m07_attribute_definitions_key
  ON m07_attribute_definitions(resource_category, attribute_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m07_attribute_definitions_deleted_at
  ON m07_attribute_definitions(deleted_at);

-- 3) Per-resource capability values. The value column is TEXT and is parsed
-- according to the dictionary value_type, keeping one row per (resource, key).
CREATE TABLE m07_resource_attributes (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  attribute_key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m07_resource_attributes_key
  ON m07_resource_attributes(resource_id, attribute_key)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m07_resource_attributes_resource
  ON m07_resource_attributes(resource_id);
CREATE INDEX IF NOT EXISTS idx_m07_resource_attributes_key
  ON m07_resource_attributes(attribute_key);

-- +goose Down
DROP INDEX IF EXISTS idx_m07_resource_attributes_key;
DROP INDEX IF EXISTS idx_m07_resource_attributes_resource;
DROP INDEX IF EXISTS uq_m07_resource_attributes_key;
DROP TABLE IF EXISTS m07_resource_attributes;
DROP INDEX IF EXISTS idx_m07_attribute_definitions_deleted_at;
DROP INDEX IF EXISTS uq_m07_attribute_definitions_key;
DROP TABLE IF EXISTS m07_attribute_definitions;
ALTER TABLE host_resources DROP COLUMN has_gpu;
ALTER TABLE host_resources DROP COLUMN has_npu;
