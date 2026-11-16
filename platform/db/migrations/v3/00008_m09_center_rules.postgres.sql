-- +goose Up
-- M09 v3 center rules snapshots (PostgreSQL production variant).
--
-- Rules are platform-global and evaluated by the center Prometheus (D35).
-- Edge packages never contain rules.yml. One row is current at a time.
CREATE TABLE IF NOT EXISTS center_config_snapshots (
  id BIGSERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'passed'
    CHECK (validation_status IN ('passed', 'failed')),
  validation_cause TEXT NOT NULL DEFAULT 'none'
    CHECK (validation_cause IN ('user_config', 'platform_fault', 'none')),
  validation_details TEXT,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_center_config_snapshots_current
  ON center_config_snapshots(is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_center_config_snapshots_created
  ON center_config_snapshots(created_at);

-- +goose Down
DROP INDEX IF EXISTS idx_center_config_snapshots_created;
DROP INDEX IF EXISTS idx_center_config_snapshots_current;
DROP TABLE IF EXISTS center_config_snapshots;
