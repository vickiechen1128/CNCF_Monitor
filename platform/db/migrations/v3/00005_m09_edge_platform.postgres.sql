-- +goose Up
-- M09 v3 edge platform schema (PostgreSQL production variant).
--
-- Mirrors 00005_m09_edge_platform.sqlite.sql. DDL differs only in auto-increment
-- strategy (BIGSERIAL vs INTEGER PRIMARY KEY AUTOINCREMENT) and JSON storage
-- (jsonb vs TEXT).
--
-- Boundaries (D24 / D25 / D26): M09 onboarding fields live in
-- `network_domain_access`; `network_domains` legacy onboarding columns are not
-- written by v3 M09. No management/local/default branches; no config
-- confirmation/rollback (snapshots are immutable history with one is_current).

-- 1) network_domain_access: 1:1 with network_domains (M06-owned base table).
CREATE TABLE IF NOT EXISTS network_domain_access (
  domain_id TEXT PRIMARY KEY REFERENCES network_domains(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  token_masked TEXT,
  token_created_at TIMESTAMP,
  remote_write_url TEXT,
  center_endpoint TEXT,
  max_disk_usage_per_url TEXT,
  registration_status TEXT NOT NULL DEFAULT 'created'
    CHECK (registration_status IN ('created', 'monitored', 'retired')),
  monitored_at TIMESTAMP,
  last_heartbeat_at TIMESTAMP,
  last_config_version TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2) edge_agents: collection nodes, soft-deleted.
CREATE TABLE IF NOT EXISTS edge_agents (
  id BIGSERIAL PRIMARY KEY,
  network_domain_id TEXT NOT NULL REFERENCES network_domains(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL,
  agent_type TEXT,
  version TEXT,
  ip TEXT,
  status TEXT NOT NULL DEFAULT 'offline'
    CHECK (status IN ('online', 'offline', 'unknown', 'retired')),
  last_heartbeat_at TIMESTAMP,
  heartbeat_rtt_ms INTEGER,
  last_config_pull_at TIMESTAMP,
  config_version TEXT,
  config_sync_status TEXT
    CHECK (config_sync_status IS NULL
        OR config_sync_status IN ('in_sync', 'out_of_sync', 'unknown',
                                  'manual_override', 'no_version')),
  out_of_sync_cause TEXT,
  config_apply_error TEXT,
  config_apply_failed_version TEXT,
  collector_status TEXT,
  collector_version TEXT,
  queue_backlog_bytes BIGINT,
  remote_write_dropped_total BIGINT,
  remote_write_retries_total BIGINT,
  remote_write_last_error TEXT,
  metadata_remote_write_url TEXT,
  metadata_max_disk_usage_per_url TEXT,
  vm_agent_restart_seq INTEGER NOT NULL DEFAULT 0,
  restart_requested_by TEXT,
  restart_requested_at TIMESTAMP,
  flush_backlog_seq INTEGER NOT NULL DEFAULT 0,
  flush_requested_by TEXT,
  flush_requested_at TIMESTAMP,
  components jsonb,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_agents_domain_hostname
  ON edge_agents(network_domain_id, hostname) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_edge_agents_domain_status
  ON edge_agents(network_domain_id, status);
CREATE INDEX IF NOT EXISTS idx_edge_agents_deleted_at
  ON edge_agents(deleted_at);

-- 3) edge_heartbeats: append-only heartbeat history (7-day retention, NFR-06).
CREATE TABLE IF NOT EXISTS edge_heartbeats (
  id BIGSERIAL PRIMARY KEY,
  network_domain_id TEXT NOT NULL REFERENCES network_domains(id) ON DELETE CASCADE,
  edge_agent_id INTEGER,
  agent_type TEXT,
  version TEXT,
  config_version TEXT,
  queue_backlog_bytes BIGINT,
  remote_write_queue_size BIGINT,
  remote_write_dropped_total BIGINT,
  remote_write_retries_total BIGINT,
  remote_write_last_error TEXT,
  hostname TEXT,
  ip TEXT,
  components jsonb,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_edge_heartbeats_domain_timestamp
  ON edge_heartbeats(network_domain_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_edge_heartbeats_agent
  ON edge_heartbeats(edge_agent_id);

-- 4) edge_target_snapshots: latest target health per (domain, job, instance),
-- hard-delete overwrite (F-11).
CREATE TABLE IF NOT EXISTS edge_target_snapshots (
  id BIGSERIAL PRIMARY KEY,
  network_domain_id TEXT NOT NULL REFERENCES network_domains(id) ON DELETE CASCADE,
  edge_agent_id INTEGER,
  job TEXT NOT NULL,
  instance TEXT NOT NULL,
  resource_id TEXT,
  health TEXT,
  last_scrape TIMESTAMP,
  last_error TEXT,
  scrape_duration_seconds DOUBLE PRECISION,
  last_report_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_edge_target_snapshots_cover
  ON edge_target_snapshots(network_domain_id, job, instance);
CREATE INDEX IF NOT EXISTS idx_edge_target_snapshots_agent
  ON edge_target_snapshots(network_domain_id, edge_agent_id);
CREATE INDEX IF NOT EXISTS idx_edge_target_snapshots_last_report_at
  ON edge_target_snapshots(last_report_at);

-- 5) domain_config_snapshots: immutable config versions; one is_current per domain.
CREATE TABLE IF NOT EXISTS domain_config_snapshots (
  id BIGSERIAL PRIMARY KEY,
  network_domain_id TEXT NOT NULL REFERENCES network_domains(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'full'
    CHECK (content_type IN ('full', 'patch')),
  validation_status TEXT NOT NULL DEFAULT 'passed'
    CHECK (validation_status IN ('passed', 'failed')),
  validation_cause TEXT NOT NULL DEFAULT 'none'
    CHECK (validation_cause IN ('user_config', 'platform_fault', 'none')),
  validation_details jsonb,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  generated_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_config_snapshots_current
  ON domain_config_snapshots(network_domain_id) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS idx_domain_config_snapshots_domain_version
  ON domain_config_snapshots(network_domain_id, version);
CREATE INDEX IF NOT EXISTS idx_domain_config_snapshots_domain_created
  ON domain_config_snapshots(network_domain_id, created_at);

-- +goose Down
-- Reverse creation order. network_domains is intentionally untouched.
DROP INDEX IF EXISTS idx_domain_config_snapshots_domain_created;
DROP INDEX IF EXISTS idx_domain_config_snapshots_domain_version;
DROP INDEX IF EXISTS idx_domain_config_snapshots_current;
DROP TABLE IF EXISTS domain_config_snapshots;

DROP INDEX IF EXISTS idx_edge_target_snapshots_last_report_at;
DROP INDEX IF EXISTS idx_edge_target_snapshots_agent;
DROP INDEX IF EXISTS idx_edge_target_snapshots_cover;
DROP TABLE IF EXISTS edge_target_snapshots;

DROP INDEX IF EXISTS idx_edge_heartbeats_agent;
DROP INDEX IF EXISTS idx_edge_heartbeats_domain_timestamp;
DROP TABLE IF EXISTS edge_heartbeats;

DROP INDEX IF EXISTS idx_edge_agents_deleted_at;
DROP INDEX IF EXISTS idx_edge_agents_domain_status;
DROP INDEX IF EXISTS idx_edge_agents_domain_hostname;
DROP TABLE IF EXISTS edge_agents;

DROP TABLE IF EXISTS network_domain_access;
