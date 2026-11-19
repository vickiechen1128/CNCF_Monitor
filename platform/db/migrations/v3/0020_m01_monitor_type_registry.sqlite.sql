-- +goose Up
-- M01 monitor object type registry (SRS Module_01 v1.3 §3.1 / §5.6).
--
-- monitor_type stops being a Go enum: a type is a definition row plus one or
-- more derivation rules that explain how to recognise it from M07 resource
-- attributes. Adding a type is a data change, never a code change (FR-21/22).
--
-- Rules never write back to M07 and never copy resource rows; they only drive
-- the candidate query of a scrape job (FR-23/24).

CREATE TABLE m01_monitor_types (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  rule_logic TEXT NOT NULL DEFAULT 'all'
    CHECK (rule_logic IN ('all', 'any')),
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_monitor_types_code
  ON m01_monitor_types(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_monitor_types_category
  ON m01_monitor_types(resource_category, sort_order);

CREATE TABLE m01_monitor_type_rules (
  id TEXT PRIMARY KEY,
  monitor_type_code TEXT NOT NULL,
  field_name TEXT NOT NULL,
  match_operator TEXT NOT NULL
    CHECK (match_operator IN ('eq', 'contains', 'contains_any', 'in', 'always', 'regexp')),
  field_values TEXT NOT NULL DEFAULT '[]',
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_m01_monitor_type_rules_type
  ON m01_monitor_type_rules(monitor_type_code, priority);
CREATE INDEX IF NOT EXISTS idx_m01_monitor_type_rules_deleted_at
  ON m01_monitor_type_rules(deleted_at);

-- +goose Down
DROP INDEX IF EXISTS idx_m01_monitor_type_rules_deleted_at;
DROP INDEX IF EXISTS idx_m01_monitor_type_rules_type;
DROP TABLE IF EXISTS m01_monitor_type_rules;
DROP INDEX IF EXISTS idx_m01_monitor_types_category;
DROP INDEX IF EXISTS uq_m01_monitor_types_code;
DROP TABLE IF EXISTS m01_monitor_types;
