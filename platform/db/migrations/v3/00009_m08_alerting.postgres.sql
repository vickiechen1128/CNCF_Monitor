-- +goose Up
-- M08 v3 alerting schema (PostgreSQL production variant).
--
-- Mirrors 00009_m08_alerting.sqlite.sql. DDL differs only in auto-increment
-- strategy (BIGSERIAL vs INTEGER PRIMARY KEY AUTOINCREMENT) and JSON storage
-- (jsonb vs TEXT).
--
-- Seven v3-only tables: notify templates, notify channels, config snapshots,
-- reload logs, alert events, inhibition rules and silence audits. Boundaries:
-- snapshots are immutable read-only history with one is_current (FR-06/NFR-01);
-- inhibition rules are searchable rows (D49) and never parsed back from YAML;
-- silence audits are append-only and include rejected attempts (D50); channel
-- secrets remain plaintext until the global credential-encryption initiative
-- lands (D45) and must never be echoed by the API.

-- 1) notify templates first: channels reference them.
CREATE TABLE IF NOT EXISTS m08_notify_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL
    CHECK (channel_type IN ('feishu', 'dingtalk', 'wecom', 'webhook')),
  content TEXT NOT NULL,
  builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m08_notify_templates_name_type
  ON m08_notify_templates(name, channel_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m08_notify_templates_type
  ON m08_notify_templates(channel_type);
CREATE INDEX IF NOT EXISTS idx_m08_notify_templates_deleted_at
  ON m08_notify_templates(deleted_at);

-- 2) notify channels. `secret` is plaintext today (D45).
CREATE TABLE IF NOT EXISTS m08_notify_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_type TEXT NOT NULL
    CHECK (channel_type IN ('feishu', 'dingtalk', 'wecom', 'webhook')),
  webhook_url TEXT NOT NULL,
  secret TEXT NOT NULL DEFAULT '',
  sign_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  template_id TEXT REFERENCES m08_notify_templates(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m08_notify_channels_name
  ON m08_notify_channels(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m08_notify_channels_type
  ON m08_notify_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_m08_notify_channels_template
  ON m08_notify_channels(template_id);
CREATE INDEX IF NOT EXISTS idx_m08_notify_channels_deleted_at
  ON m08_notify_channels(deleted_at);

-- 3) generated configuration snapshots (read-only history, one current).
CREATE TABLE IF NOT EXISTS m08_config_snapshots (
  id BIGSERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  content TEXT NOT NULL,
  route_tree jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  generated_by TEXT NOT NULL DEFAULT '',
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m08_config_snapshots_current
  ON m08_config_snapshots(is_current) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_m08_config_snapshots_created
  ON m08_config_snapshots(created_at);

-- 4) reload attempts (append-only).
CREATE TABLE IF NOT EXISTS m08_reload_logs (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id BIGINT REFERENCES m08_config_snapshots(id) ON DELETE SET NULL,
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
CREATE INDEX IF NOT EXISTS idx_m08_reload_logs_created
  ON m08_reload_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_m08_reload_logs_status
  ON m08_reload_logs(status);

-- 5) alert events: single source of truth for current/history (FR-21..25).
CREATE TABLE IF NOT EXISTS m08_alert_events (
  id BIGSERIAL PRIMARY KEY,
  occurrence_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL DEFAULT '',
  alert_name TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('firing', 'silenced', 'inhibited', 'resolved',
                      'silenced_closed', 'inhibited_closed',
                      'resolved_unknown')),
  severity TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  network_domain TEXT NOT NULL DEFAULT '',
  resource_id TEXT NOT NULL DEFAULT '',
  resource_category TEXT NOT NULL DEFAULT '',
  instance TEXT NOT NULL DEFAULT '',
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  annotations jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_m08_alert_events_status
  ON m08_alert_events(status);
CREATE INDEX IF NOT EXISTS idx_m08_alert_events_starts
  ON m08_alert_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_m08_alert_events_domain
  ON m08_alert_events(network_domain);
CREATE INDEX IF NOT EXISTS idx_m08_alert_events_resource
  ON m08_alert_events(resource_id);
CREATE INDEX IF NOT EXISTS idx_m08_alert_events_name
  ON m08_alert_events(alert_name);

-- 6) inhibition rules (D49: searchable table, not YAML-derived).
CREATE TABLE IF NOT EXISTS m08_inhibition_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_matchers jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_matchers jsonb NOT NULL DEFAULT '[]'::jsonb,
  equal jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m08_inhibition_rules_name
  ON m08_inhibition_rules(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m08_inhibition_rules_enabled
  ON m08_inhibition_rules(enabled);
CREATE INDEX IF NOT EXISTS idx_m08_inhibition_rules_deleted_at
  ON m08_inhibition_rules(deleted_at);

-- 7) silence audit trail (D50: append-only, includes rejected attempts).
CREATE TABLE IF NOT EXISTS m08_silence_audits (
  id BIGSERIAL PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('create', 'delete')),
  result TEXT NOT NULL CHECK (result IN ('success', 'rejected')),
  operator TEXT NOT NULL DEFAULT '',
  silence_id TEXT NOT NULL DEFAULT '',
  matchers jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL DEFAULT '',
  failure_reason TEXT NOT NULL DEFAULT '',
  at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_m08_silence_audits_at
  ON m08_silence_audits(at);
CREATE INDEX IF NOT EXISTS idx_m08_silence_audits_operator
  ON m08_silence_audits(operator);
CREATE INDEX IF NOT EXISTS idx_m08_silence_audits_silence
  ON m08_silence_audits(silence_id);

-- +goose Down
DROP INDEX IF EXISTS idx_m08_silence_audits_silence;
DROP INDEX IF EXISTS idx_m08_silence_audits_operator;
DROP INDEX IF EXISTS idx_m08_silence_audits_at;
DROP TABLE IF EXISTS m08_silence_audits;

DROP INDEX IF EXISTS idx_m08_inhibition_rules_deleted_at;
DROP INDEX IF EXISTS idx_m08_inhibition_rules_enabled;
DROP INDEX IF EXISTS uq_m08_inhibition_rules_name;
DROP TABLE IF EXISTS m08_inhibition_rules;

DROP INDEX IF EXISTS idx_m08_alert_events_name;
DROP INDEX IF EXISTS idx_m08_alert_events_resource;
DROP INDEX IF EXISTS idx_m08_alert_events_domain;
DROP INDEX IF EXISTS idx_m08_alert_events_starts;
DROP INDEX IF EXISTS idx_m08_alert_events_status;
DROP TABLE IF EXISTS m08_alert_events;

DROP INDEX IF EXISTS idx_m08_reload_logs_status;
DROP INDEX IF EXISTS idx_m08_reload_logs_created;
DROP TABLE IF EXISTS m08_reload_logs;

DROP INDEX IF EXISTS idx_m08_config_snapshots_created;
DROP INDEX IF EXISTS uq_m08_config_snapshots_current;
DROP TABLE IF EXISTS m08_config_snapshots;

DROP INDEX IF EXISTS idx_m08_notify_channels_deleted_at;
DROP INDEX IF EXISTS idx_m08_notify_channels_template;
DROP INDEX IF EXISTS idx_m08_notify_channels_type;
DROP INDEX IF EXISTS uq_m08_notify_channels_name;
DROP TABLE IF EXISTS m08_notify_channels;

DROP INDEX IF EXISTS idx_m08_notify_templates_deleted_at;
DROP INDEX IF EXISTS idx_m08_notify_templates_type;
DROP INDEX IF EXISTS uq_m08_notify_templates_name_type;
DROP TABLE IF EXISTS m08_notify_templates;
