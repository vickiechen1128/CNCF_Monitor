-- +goose Up
-- Merge the three config snapshot tables into one scope-tagged table (0016).
--
--   domain_config_snapshots  (00005) -> scope='domain',      scope_key=network_domain_id
--   center_config_snapshots  (00008) -> scope='center',      scope_key='center'
--   m08_config_snapshots     (00009) -> scope='alertmanager',scope_key='alertmanager'
--
-- The API/DTO surface is unchanged: scope is internal-only. M08's alertmanager
-- history saved through the domain repository (version prefix 'am-', D31) stays
-- in the 'domain' scope exactly as before -- only the table name changes.
--
-- m08_reload_logs.snapshot_id used to be an FK to m08_config_snapshots; it is
-- rebuilt as a plain integer column so the old table can be dropped without a
-- dangling FK. This migration is irreversible; Down is a deliberate no-op
-- (same pattern as 00009 / 0015).

PRAGMA defer_foreign_keys = ON;

-- 1) Unified table (column union of the three old tables).
CREATE TABLE config_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL CHECK (scope IN ('domain', 'center', 'alertmanager')),
  scope_key TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'full'
    CHECK (content_type IN ('full', 'patch')),
  route_tree TEXT NOT NULL DEFAULT '[]',
  validation_status TEXT NOT NULL DEFAULT 'passed'
    CHECK (validation_status IN ('passed', 'failed')),
  validation_cause TEXT NOT NULL DEFAULT 'none'
    CHECK (validation_cause IN ('user_config', 'platform_fault', 'none')),
  validation_details TEXT,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  generated_by TEXT NOT NULL DEFAULT '',
  generated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- (scope, scope_key, version) is unique; version was only unique per domain /
-- globally within center and m08, so the tuple cannot collide across scopes.
CREATE UNIQUE INDEX uq_config_snapshots_scope_version
  ON config_snapshots(scope, scope_key, version);
-- Exactly one current row per (scope, scope_key).
CREATE UNIQUE INDEX uq_config_snapshots_current
  ON config_snapshots(scope, scope_key) WHERE is_current = 1;
CREATE INDEX idx_config_snapshots_scope_created
  ON config_snapshots(scope, scope_key, created_at);

-- 2) Backfill (missing columns take the unified table defaults).
INSERT INTO config_snapshots (
  scope, scope_key, version, checksum, content, content_type, route_tree,
  validation_status, validation_cause, validation_details,
  is_current, generated_by, generated_at, created_at
)
SELECT 'domain', network_domain_id, version, checksum, '', content_type, '[]',
       validation_status, validation_cause, validation_details,
       is_current, COALESCE(generated_by, ''), NULL, created_at
  FROM domain_config_snapshots;

INSERT INTO config_snapshots (
  scope, scope_key, version, checksum, content, content_type, route_tree,
  validation_status, validation_cause, validation_details,
  is_current, generated_by, generated_at, created_at
)
SELECT 'center', 'center', version, checksum, '', 'full', '[]',
       validation_status, validation_cause, validation_details,
       is_current, '', NULL, created_at
  FROM center_config_snapshots;

INSERT INTO config_snapshots (
  scope, scope_key, version, checksum, content, content_type, route_tree,
  validation_status, validation_cause, validation_details,
  is_current, generated_by, generated_at, created_at
)
SELECT 'alertmanager', 'alertmanager', version, checksum, content, 'full', route_tree,
       'passed', 'none', NULL,
       is_current, generated_by, generated_at, created_at
  FROM m08_config_snapshots;

-- 3) Rebuild m08_reload_logs without the FK to m08_config_snapshots.
CREATE TABLE m08_reload_logs_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER,
  config_version TEXT NOT NULL DEFAULT '',
  checksum TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL
    CHECK (trigger IN ('route_save', 'inhibition_save', 'manual', 'm09_sync')),
  status TEXT NOT NULL
    CHECK (status IN ('succeeded', 'failed', 'rolled_back')),
  operator TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO m08_reload_logs_new (
  id, snapshot_id, config_version, checksum, trigger, status, operator,
  error, duration_ms, started_at, finished_at, created_at
)
SELECT id, snapshot_id, config_version, checksum, trigger, status, operator,
       error, duration_ms, started_at, finished_at, created_at
  FROM m08_reload_logs;
DROP TABLE m08_reload_logs;
ALTER TABLE m08_reload_logs_new RENAME TO m08_reload_logs;
CREATE INDEX idx_m08_reload_logs_created ON m08_reload_logs(created_at);
CREATE INDEX idx_m08_reload_logs_status ON m08_reload_logs(status);

-- 4) Drop the three legacy tables.
DROP TABLE domain_config_snapshots;
DROP TABLE center_config_snapshots;
DROP TABLE m08_config_snapshots;

-- +goose Down
-- Irreversible: the three source tables and their original constraints cannot
-- be reconstructed from the merged rows. No-op by design (see 00009 / 0015).
-- The test helper resets the database before each full Up/Down cycle.
SELECT 1;
