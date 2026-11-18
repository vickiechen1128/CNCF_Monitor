-- +goose Up
-- M01 optional foreign keys: empty string -> NULL + real ON DELETE SET NULL FKs.
--
-- Mirrors the m08_notify_channels.template_id pattern (00009): an unset
-- optional reference is SQL NULL, not ''. exporter_template_id and
-- label_template_id become real FKs to m01_exporter_templates(id) and
-- m07_label_templates(id); blackbox_module keeps its name-based (no FK)
-- semantics but is normalized to NULL as well.
--
-- SQLite cannot ALTER COLUMN nullable / add a FK to an existing table, so each
-- affected table is rebuilt: CREATE ..._new -> INSERT ... SELECT with
-- NULLIF(col, '') -> DROP old -> RENAME -> recreate indexes. FK actions are
-- deferred until commit so dropping a parent that has children stays atomic.
-- This migration is irreversible; the Down section is a deliberate no-op.

PRAGMA defer_foreign_keys = ON;

-- 1) m01_ci_type_exporter_mappings.label_template_id -> m07_label_templates(id).
CREATE TABLE m01_ci_type_exporter_mappings_new (
  id TEXT PRIMARY KEY,
  monitor_type TEXT NOT NULL,
  exporter_template_id TEXT NOT NULL REFERENCES m01_exporter_templates(id),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  default_port INTEGER NOT NULL DEFAULT 0 CHECK (default_port BETWEEN 0 AND 65535),
  metrics_path TEXT NOT NULL DEFAULT '/metrics',
  scheme TEXT NOT NULL DEFAULT 'http' CHECK (scheme IN ('http', 'https')),
  scrape_interval TEXT NOT NULL DEFAULT '15s',
  scrape_timeout TEXT NOT NULL DEFAULT '10s',
  label_template_id TEXT REFERENCES m07_label_templates(id) ON DELETE SET NULL,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
INSERT INTO m01_ci_type_exporter_mappings_new (
  id, monitor_type, exporter_template_id, is_default, default_port,
  metrics_path, scheme, scrape_interval, scrape_timeout, label_template_id,
  is_builtin, created_at, updated_at, deleted_at
)
SELECT id, monitor_type, exporter_template_id, is_default, default_port,
       metrics_path, scheme, scrape_interval, scrape_timeout,
       NULLIF(label_template_id, ''),
       is_builtin, created_at, updated_at, deleted_at
  FROM m01_ci_type_exporter_mappings;
DROP TABLE m01_ci_type_exporter_mappings;
ALTER TABLE m01_ci_type_exporter_mappings_new RENAME TO m01_ci_type_exporter_mappings;
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

-- 2) m01_scrape_jobs optional refs (incl. job_group_id from 00012).
CREATE TABLE m01_scrape_jobs_new (
  id TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (job_type IN ('standard', 'blackbox')),
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  monitor_type TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT REFERENCES m01_exporter_templates(id) ON DELETE SET NULL,
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
  label_template_id TEXT REFERENCES m07_label_templates(id) ON DELETE SET NULL,
  blackbox_module TEXT,
  target_field TEXT NOT NULL DEFAULT '',
  mapping_overrides TEXT NOT NULL DEFAULT '[]',
  draft_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (draft_status IN ('draft', 'ready')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  job_group_id TEXT REFERENCES m01_job_groups(id),
  sync_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (sync_status IN ('draft', 'pending', 'syncing', 'synced', 'failed')),
  sync_version TEXT NOT NULL DEFAULT '',
  sync_error TEXT NOT NULL DEFAULT '',
  synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
INSERT INTO m01_scrape_jobs_new (
  id, job_name, job_type, resource_category, monitor_type, exporter_template_id,
  network_domain_id, instance_selection_mode, selected_instance_ids,
  scrape_interval, scrape_timeout, metrics_path, scheme, auth_type, username,
  password_cipher, token_cipher, tls_skip_verify, ca_file, label_template_id,
  blackbox_module, target_field, mapping_overrides, draft_status, enabled,
  job_group_id, sync_status, sync_version, sync_error, synced_at,
  created_at, updated_at, deleted_at
)
SELECT id, job_name, job_type, resource_category, monitor_type,
       NULLIF(exporter_template_id, ''),
       network_domain_id, instance_selection_mode, selected_instance_ids,
       scrape_interval, scrape_timeout, metrics_path, scheme, auth_type, username,
       password_cipher, token_cipher, tls_skip_verify, ca_file,
       NULLIF(label_template_id, ''), NULLIF(blackbox_module, ''),
       target_field, mapping_overrides, draft_status, enabled,
       job_group_id, sync_status, sync_version, sync_error, synced_at,
       created_at, updated_at, deleted_at
  FROM m01_scrape_jobs;
DROP TABLE m01_scrape_jobs;
ALTER TABLE m01_scrape_jobs_new RENAME TO m01_scrape_jobs;
-- 00012 dropped the global uq_m01_scrape_jobs_name in favour of domain-scoped
-- uniqueness; do NOT restore it here (same job_name is valid across domains).
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_scrape_jobs_domain_name
  ON m01_scrape_jobs(network_domain_id, job_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_domain
  ON m01_scrape_jobs(network_domain_id);
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_candidate
  ON m01_scrape_jobs(draft_status, enabled) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_group
  ON m01_scrape_jobs(job_group_id);
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_updated_at
  ON m01_scrape_jobs(updated_at);
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_deleted_at
  ON m01_scrape_jobs(deleted_at);

-- 3) m01_monitoring_rules.exporter_template_id -> m01_exporter_templates(id).
CREATE TABLE m01_monitoring_rules_new (
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
  exporter_template_id TEXT REFERENCES m01_exporter_templates(id) ON DELETE SET NULL,
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
INSERT INTO m01_monitoring_rules_new (
  id, name, content_mode, rule_content, rule_type, expr, duration, labels,
  annotations, monitor_type, exporter_template_id, scope, enabled, draft_status,
  ack_job_ref_errors, ack_reason, sync_status, sync_version, sync_error,
  synced_at, created_at, updated_at, deleted_at
)
SELECT id, name, content_mode, rule_content, rule_type, expr, duration, labels,
       annotations, monitor_type, NULLIF(exporter_template_id, ''), scope,
       enabled, draft_status, ack_job_ref_errors, ack_reason, sync_status,
       sync_version, sync_error, synced_at, created_at, updated_at, deleted_at
  FROM m01_monitoring_rules;
DROP TABLE m01_monitoring_rules;
ALTER TABLE m01_monitoring_rules_new RENAME TO m01_monitoring_rules;
CREATE INDEX IF NOT EXISTS idx_m01_monitoring_rules_candidate
  ON m01_monitoring_rules(enabled, draft_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_monitoring_rules_updated_at
  ON m01_monitoring_rules(updated_at);
CREATE INDEX IF NOT EXISTS idx_m01_monitoring_rules_deleted_at
  ON m01_monitoring_rules(deleted_at);

-- 4) m01_metric_library.exporter_template_id -> m01_exporter_templates(id).
CREATE TABLE m01_metric_library_new (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_type TEXT NOT NULL
    CHECK (metric_type IN ('counter', 'gauge', 'histogram', 'summary', 'unknown')),
  help TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  labels TEXT NOT NULL DEFAULT '[]',
  monitor_types TEXT NOT NULL DEFAULT '[]',
  category TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT REFERENCES m01_exporter_templates(id) ON DELETE SET NULL,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
INSERT INTO m01_metric_library_new (
  id, metric_name, metric_type, help, unit, labels, monitor_types, category,
  exporter_template_id, is_builtin, enabled, created_at, updated_at, deleted_at
)
SELECT id, metric_name, metric_type, help, unit, labels, monitor_types, category,
       NULLIF(exporter_template_id, ''), is_builtin, enabled,
       created_at, updated_at, deleted_at
  FROM m01_metric_library;
DROP TABLE m01_metric_library;
ALTER TABLE m01_metric_library_new RENAME TO m01_metric_library;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_metric_library_builtin_name
  ON m01_metric_library(metric_name) WHERE is_builtin AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_metric_library_name
  ON m01_metric_library(metric_name);
CREATE INDEX IF NOT EXISTS idx_m01_metric_library_deleted_at
  ON m01_metric_library(deleted_at);

-- 5) m01_job_groups optional refs (00012).
CREATE TABLE m01_job_groups_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (job_type IN ('standard', 'blackbox')),
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  monitor_type TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT REFERENCES m01_exporter_templates(id) ON DELETE SET NULL,
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
  label_template_id TEXT REFERENCES m07_label_templates(id) ON DELETE SET NULL,
  blackbox_module TEXT,
  target_field TEXT NOT NULL DEFAULT '',
  mapping_overrides TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK (status IN ('enabled', 'disabled')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
INSERT INTO m01_job_groups_new (
  id, name, job_type, resource_category, monitor_type, exporter_template_id,
  scrape_interval, scrape_timeout, metrics_path, scheme, auth_type, username,
  password_cipher, token_cipher, tls_skip_verify, ca_file, label_template_id,
  blackbox_module, target_field, mapping_overrides, status, created_by,
  created_at, updated_at, deleted_at
)
SELECT id, name, job_type, resource_category, monitor_type,
       NULLIF(exporter_template_id, ''),
       scrape_interval, scrape_timeout, metrics_path, scheme, auth_type, username,
       password_cipher, token_cipher, tls_skip_verify, ca_file,
       NULLIF(label_template_id, ''), NULLIF(blackbox_module, ''),
       target_field, mapping_overrides, status, created_by,
       created_at, updated_at, deleted_at
  FROM m01_job_groups;
DROP TABLE m01_job_groups;
ALTER TABLE m01_job_groups_new RENAME TO m01_job_groups;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_job_groups_name
  ON m01_job_groups(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_job_groups_deleted_at
  ON m01_job_groups(deleted_at);

-- +goose Down
-- Irreversible: the original NOT NULL + empty-string semantics cannot be
-- reconstructed from NULL without losing the distinction between "unset" and
-- "was empty". No-op by design (see 00009 m08 pattern).
SELECT 1;
