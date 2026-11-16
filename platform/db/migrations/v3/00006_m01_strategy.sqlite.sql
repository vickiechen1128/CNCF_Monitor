-- +goose Up
-- M01 v3 strategy schema (SQLite dev/test variant).
--
-- Module ownership: monitoring strategies (exporter pool, default mappings,
-- scrape jobs, monitoring rules, metric catalogues, installation notes and
-- probe modules). Table names are prefixed `m01_` on purpose: the legacy v2
-- line already owns `scrape_jobs` / `exporter_templates` / ... via AutoMigrate,
-- and v3 migrations also run in legacy mode. Separate names keep the two schema
-- generations from drifting (D-1).
--
-- Boundaries (D25 / D26 / D36 / D40):
--   * no change_status / confirmation state machine; jobs carry sync_* only;
--   * every job binds a network domain (M06) that must be onboarded by M09;
--   * monitoring rules are platform-global (no network_domain_id);
--   * resource deletion is reclaimed by an M01 reconciliation loop, not an FK.

-- 1) Exporter pool (采集实现池).
CREATE TABLE IF NOT EXISTS m01_exporter_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '',
  default_port INTEGER NOT NULL DEFAULT 0 CHECK (default_port BETWEEN 0 AND 65535),
  metrics_path TEXT NOT NULL DEFAULT '/metrics',
  scheme TEXT NOT NULL DEFAULT 'http' CHECK (scheme IN ('http', 'https')),
  supported_monitor_types TEXT NOT NULL DEFAULT '[]',
  os TEXT NOT NULL DEFAULT 'any' CHECK (os IN ('linux', 'windows', 'any')),
  arch TEXT NOT NULL DEFAULT 'any' CHECK (arch IN ('amd64', 'arm64', 'any')),
  download_url TEXT NOT NULL DEFAULT '',
  homepage TEXT NOT NULL DEFAULT '',
  install_guide TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'third_party'
    CHECK (source IN ('official', 'third_party', 'internal')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_exporter_templates_name
  ON m01_exporter_templates(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_exporter_templates_deleted_at
  ON m01_exporter_templates(deleted_at);

-- 2) Default collection mapping (监控对象类型 ↔ 采集实现).
CREATE TABLE IF NOT EXISTS m01_ci_type_exporter_mappings (
  id TEXT PRIMARY KEY,
  monitor_type TEXT NOT NULL,
  exporter_template_id TEXT NOT NULL REFERENCES m01_exporter_templates(id),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  default_port INTEGER NOT NULL DEFAULT 0 CHECK (default_port BETWEEN 0 AND 65535),
  metrics_path TEXT NOT NULL DEFAULT '/metrics',
  scheme TEXT NOT NULL DEFAULT 'http' CHECK (scheme IN ('http', 'https')),
  scrape_interval TEXT NOT NULL DEFAULT '15s',
  scrape_timeout TEXT NOT NULL DEFAULT '10s',
  label_template_id TEXT NOT NULL DEFAULT '',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_mappings_type_exporter
  ON m01_ci_type_exporter_mappings(monitor_type, exporter_template_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_mappings_default
  ON m01_ci_type_exporter_mappings(monitor_type)
  WHERE is_default AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_mappings_exporter
  ON m01_ci_type_exporter_mappings(exporter_template_id);
CREATE INDEX IF NOT EXISTS idx_m01_mappings_deleted_at
  ON m01_ci_type_exporter_mappings(deleted_at);

-- 3) Scrape jobs (采集 Job).
-- Optional references (exporter_template_id / label_template_id /
-- blackbox_module) are stored as empty strings and validated by the service
-- layer: empty means "manual parameters / unset", so a FK would reject it.
CREATE TABLE IF NOT EXISTS m01_scrape_jobs (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (job_type IN ('standard', 'blackbox')),
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  monitor_type TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT NOT NULL DEFAULT '',
  network_domain_id TEXT NOT NULL REFERENCES network_domains(id),
  instance_selection_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (instance_selection_mode IN ('manual', 'filter')),
  selected_instance_ids TEXT NOT NULL DEFAULT '[]',
  scrape_interval TEXT NOT NULL DEFAULT '15s',
  scrape_timeout TEXT NOT NULL DEFAULT '10s',
  metrics_path TEXT NOT NULL DEFAULT '/metrics',
  scheme TEXT NOT NULL DEFAULT 'http' CHECK (scheme IN ('http', 'https')),
  auth_type TEXT NOT NULL DEFAULT 'none'
    CHECK (auth_type IN ('none', 'basic', 'bearer')),
  username TEXT NOT NULL DEFAULT '',
  password_cipher TEXT NOT NULL DEFAULT '',
  token_cipher TEXT NOT NULL DEFAULT '',
  tls_skip_verify BOOLEAN NOT NULL DEFAULT FALSE,
  ca_file TEXT NOT NULL DEFAULT '',
  label_template_id TEXT NOT NULL DEFAULT '',
  blackbox_module TEXT NOT NULL DEFAULT '',
  target_field TEXT NOT NULL DEFAULT '',
  mapping_overrides TEXT NOT NULL DEFAULT '[]',
  draft_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (draft_status IN ('draft', 'ready')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (sync_status IN ('draft', 'pending', 'syncing', 'synced', 'failed')),
  sync_version TEXT NOT NULL DEFAULT '',
  sync_error TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_scrape_jobs_name
  ON m01_scrape_jobs(job_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_domain
  ON m01_scrape_jobs(network_domain_id);
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_candidate
  ON m01_scrape_jobs(draft_status, enabled) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_updated_at
  ON m01_scrape_jobs(updated_at);
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_deleted_at
  ON m01_scrape_jobs(deleted_at);

-- 4) Monitoring rules (监控规则, platform-global per D36).
CREATE TABLE IF NOT EXISTS m01_monitoring_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  content_mode TEXT NOT NULL DEFAULT 'yaml_passthrough'
    CHECK (content_mode IN ('yaml_passthrough', 'structured')),
  rule_content TEXT NOT NULL DEFAULT '',
  rule_type TEXT NOT NULL DEFAULT ''
    CHECK (rule_type IN ('', 'alerting', 'recording')),
  expr TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  labels TEXT NOT NULL DEFAULT '{}',
  annotations TEXT NOT NULL DEFAULT '{}',
  monitor_type TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT 'central' CHECK (scope IN ('central')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  draft_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (draft_status IN ('draft', 'ready')),
  ack_job_ref_errors BOOLEAN NOT NULL DEFAULT FALSE,
  ack_reason TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (sync_status IN ('draft', 'pending', 'syncing', 'synced', 'failed')),
  sync_version TEXT NOT NULL DEFAULT '',
  sync_error TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_m01_monitoring_rules_candidate
  ON m01_monitoring_rules(enabled, draft_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_monitoring_rules_updated_at
  ON m01_monitoring_rules(updated_at);
CREATE INDEX IF NOT EXISTS idx_m01_monitoring_rules_deleted_at
  ON m01_monitoring_rules(deleted_at);

-- 5) Technical metric catalogue (技术指标库).
CREATE TABLE IF NOT EXISTS m01_metric_library (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL
    CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'summary', 'unknown')),
  help TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  labels TEXT NOT NULL DEFAULT '[]',
  monitor_types TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT NOT NULL DEFAULT '',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_metric_library_builtin_name
  ON m01_metric_library(metric_name) WHERE is_builtin AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_metric_library_name
  ON m01_metric_library(metric_name);
CREATE INDEX IF NOT EXISTS idx_m01_metric_library_deleted_at
  ON m01_metric_library(deleted_at);

-- 6) Business metric catalogue (业务指标库).
CREATE TABLE IF NOT EXISTS m01_business_metrics (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  metric_type TEXT NOT NULL DEFAULT 'gauge'
    CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'summary', 'unknown')),
  unit TEXT NOT NULL DEFAULT '',
  business_domain TEXT NOT NULL DEFAULT '',
  app_name TEXT NOT NULL DEFAULT '',
  threshold_suggestion TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  register_source TEXT NOT NULL DEFAULT 'self'
    CHECK (register_source IN ('self', 'agent')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'instrumented', 'online')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_business_metrics_metric_id
  ON m01_business_metrics(metric_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_business_metrics_name
  ON m01_business_metrics(metric_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_business_metrics_deleted_at
  ON m01_business_metrics(deleted_at);

-- 7) Exporter installation notes (安装登记, record only).
CREATE TABLE IF NOT EXISTS m01_installations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL,
  scrape_job_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('unconfirmed', 'confirmed', 'not_applicable')),
  actual_port INTEGER NOT NULL DEFAULT 0 CHECK (actual_port BETWEEN 0 AND 65535),
  confirmed_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_installations_resource_job
  ON m01_installations(resource_id, scrape_job_id);
CREATE INDEX IF NOT EXISTS idx_m01_installations_job
  ON m01_installations(scrape_job_id);

-- 8) Blackbox probe modules (拨测模块).
CREATE TABLE IF NOT EXISTS m01_probe_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_probe_modules_name
  ON m01_probe_modules(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_probe_modules_deleted_at
  ON m01_probe_modules(deleted_at);

-- +goose Down
-- Reverse creation order. network_domains (M06) is intentionally untouched.
DROP INDEX IF EXISTS idx_m01_probe_modules_deleted_at;
DROP INDEX IF EXISTS uq_m01_probe_modules_name;
DROP TABLE IF EXISTS m01_probe_modules;

DROP INDEX IF EXISTS idx_m01_installations_job;
DROP INDEX IF EXISTS uq_m01_installations_resource_job;
DROP TABLE IF EXISTS m01_installations;

DROP INDEX IF EXISTS idx_m01_business_metrics_deleted_at;
DROP INDEX IF EXISTS uq_m01_business_metrics_name;
DROP INDEX IF EXISTS uq_m01_business_metrics_metric_id;
DROP TABLE IF EXISTS m01_business_metrics;

DROP INDEX IF EXISTS idx_m01_metric_library_deleted_at;
DROP INDEX IF EXISTS idx_m01_metric_library_name;
DROP INDEX IF EXISTS uq_m01_metric_library_builtin_name;
DROP TABLE IF EXISTS m01_metric_library;

DROP INDEX IF EXISTS idx_m01_monitoring_rules_deleted_at;
DROP INDEX IF EXISTS idx_m01_monitoring_rules_updated_at;
DROP INDEX IF EXISTS idx_m01_monitoring_rules_candidate;
DROP TABLE IF EXISTS m01_monitoring_rules;

DROP INDEX IF EXISTS idx_m01_scrape_jobs_deleted_at;
DROP INDEX IF EXISTS idx_m01_scrape_jobs_updated_at;
DROP INDEX IF EXISTS idx_m01_scrape_jobs_candidate;
DROP INDEX IF EXISTS idx_m01_scrape_jobs_domain;
DROP INDEX IF EXISTS uq_m01_scrape_jobs_name;
DROP TABLE IF EXISTS m01_scrape_jobs;

DROP INDEX IF EXISTS idx_m01_mappings_deleted_at;
DROP INDEX IF EXISTS idx_m01_mappings_exporter;
DROP INDEX IF EXISTS uq_m01_mappings_default;
DROP INDEX IF EXISTS uq_m01_mappings_type_exporter;
DROP TABLE IF EXISTS m01_ci_type_exporter_mappings;

DROP INDEX IF EXISTS idx_m01_exporter_templates_deleted_at;
DROP INDEX IF EXISTS uq_m01_exporter_templates_name;
DROP TABLE IF EXISTS m01_exporter_templates;
