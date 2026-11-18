-- +goose Up
-- Merge the three config snapshot tables into one scope-tagged table (0016).
-- See 0016_config_snapshots_merge.sqlite.sql for the full rationale. The rows
-- keep their is_current flag and the (scope, scope_key, version) tuple never
-- collides because the old version keys were already unique within each source.

-- 1) Unified table (column union of the three old tables).
CREATE TABLE config_snapshots (
  id BIGSERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('domain', 'center', 'alertmanager')),
  scope_key TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'full'
    CHECK (content_type IN ('full', 'patch')),
  route_tree jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_status TEXT NOT NULL DEFAULT 'passed'
    CHECK (validation_status IN ('passed', 'failed')),
  validation_cause TEXT NOT NULL DEFAULT 'none'
    CHECK (validation_cause IN ('user_config', 'platform_fault', 'none')),
  validation_details jsonb,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  generated_by TEXT NOT NULL DEFAULT '',
  generated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uq_config_snapshots_scope_version
  ON config_snapshots(scope, scope_key, version);
CREATE UNIQUE INDEX uq_config_snapshots_current
  ON config_snapshots(scope, scope_key) WHERE is_current;
CREATE INDEX idx_config_snapshots_scope_created
  ON config_snapshots(scope, scope_key, created_at);

-- 2) Backfill. jsonb columns need explicit casts for the string literals.
INSERT INTO config_snapshots (
  scope, scope_key, version, checksum, content, content_type, route_tree,
  validation_status, validation_cause, validation_details,
  is_current, generated_by, generated_at, created_at
)
SELECT 'domain', network_domain_id, version, checksum, '', content_type, '[]'::jsonb,
       validation_status, validation_cause, validation_details,
       is_current, COALESCE(generated_by, ''), NULL, created_at
  FROM domain_config_snapshots;

INSERT INTO config_snapshots (
  scope, scope_key, version, checksum, content, content_type, route_tree,
  validation_status, validation_cause, validation_details,
  is_current, generated_by, generated_at, created_at
)
-- center_config_snapshots.validation_details is TEXT (00008), so parse it
-- into the unified jsonb column; NULLIF guards against stored empty strings.
SELECT 'center', 'center', version, checksum, '', 'full', '[]'::jsonb,
       validation_status, validation_cause, NULLIF(validation_details, '')::jsonb,
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

-- 3) Remove the FK from m08_reload_logs so the old table can be dropped.
--    CASCADE is a safety net for any other dependent object (none expected).
ALTER TABLE m08_reload_logs DROP CONSTRAINT IF EXISTS m08_reload_logs_snapshot_id_fkey;

-- 4) Drop the three legacy tables.
DROP TABLE IF EXISTS domain_config_snapshots;
DROP TABLE IF EXISTS center_config_snapshots;
DROP TABLE IF EXISTS m08_config_snapshots CASCADE;

-- +goose Down
-- Irreversible: no-op by design (see 0016 SQLite variant / 00009 / 0015).
-- The test helper resets the database before each full Up/Down cycle.
SELECT 1;
