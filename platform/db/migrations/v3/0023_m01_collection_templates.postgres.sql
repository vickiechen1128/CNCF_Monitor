-- +goose Up
-- M01 采集模板化（SRS Module_01 v1.5 §3.1 / §5.1 / §5.6）。
-- Postgres counterpart of 0023_m01_collection_templates.sqlite.sql.

CREATE TABLE IF NOT EXISTS m01_collection_templates (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  exporter_template_id TEXT NOT NULL DEFAULT '',
  default_port INTEGER NOT NULL DEFAULT 0 CHECK (default_port BETWEEN 0 AND 65535),
  metrics_path TEXT NOT NULL DEFAULT '/metrics',
  scheme TEXT NOT NULL DEFAULT 'http' CHECK (scheme IN ('http', 'https')),
  scrape_interval TEXT NOT NULL DEFAULT '15s',
  scrape_timeout TEXT NOT NULL DEFAULT '10s',
  label_template_id TEXT,
  -- default_selector 仅用于新建任务时的向导预填；后端从不据它求值。
  default_selector TEXT NOT NULL DEFAULT '{"logic":"all","filters":[]}',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_collection_templates_code
  ON m01_collection_templates(code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_collection_templates_category
  ON m01_collection_templates(resource_category, sort_order);
CREATE INDEX IF NOT EXISTS idx_m01_collection_templates_exporter
  ON m01_collection_templates(exporter_template_id);

INSERT INTO m01_collection_templates (
  code, name, resource_category, exporter_template_id, default_port, metrics_path,
  scheme, scrape_interval, scrape_timeout, label_template_id, sort_order,
  description, enabled, is_builtin, created_at, updated_at)
SELECT
  mt.code,
  mt.name,
  mt.resource_category,
  COALESCE((SELECT m.exporter_template_id FROM m01_ci_type_exporter_mappings m
            WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
            ORDER BY m.updated_at DESC LIMIT 1), ''),
  COALESCE((SELECT m.default_port FROM m01_ci_type_exporter_mappings m
            WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
            ORDER BY m.updated_at DESC LIMIT 1), 0),
  COALESCE((SELECT m.metrics_path FROM m01_ci_type_exporter_mappings m
            WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
            ORDER BY m.updated_at DESC LIMIT 1), '/metrics'),
  COALESCE((SELECT m.scheme FROM m01_ci_type_exporter_mappings m
            WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
            ORDER BY m.updated_at DESC LIMIT 1), 'http'),
  COALESCE((SELECT m.scrape_interval FROM m01_ci_type_exporter_mappings m
            WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
            ORDER BY m.updated_at DESC LIMIT 1), '15s'),
  COALESCE((SELECT m.scrape_timeout FROM m01_ci_type_exporter_mappings m
            WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
            ORDER BY m.updated_at DESC LIMIT 1), '10s'),
  NULLIF((SELECT m.label_template_id FROM m01_ci_type_exporter_mappings m
          WHERE m.monitor_type = mt.code AND m.is_default = TRUE AND m.deleted_at IS NULL
          ORDER BY m.updated_at DESC LIMIT 1), ''),
  mt.sort_order,
  mt.description,
  mt.enabled,
  mt.is_builtin,
  mt.created_at,
  mt.updated_at
FROM m01_monitor_types mt
WHERE mt.deleted_at IS NULL;

INSERT INTO m01_collection_templates (
  code, name, resource_category, exporter_template_id, default_port, metrics_path,
  scheme, scrape_interval, scrape_timeout, label_template_id, sort_order,
  description, enabled, is_builtin, created_at, updated_at)
SELECT
  m.monitor_type || '__' || m.exporter_template_id,
  COALESCE((SELECT mt.name FROM m01_monitor_types mt WHERE mt.code = m.monitor_type), m.monitor_type)
    || ' · ' || COALESCE((SELECT et.name FROM m01_exporter_templates et WHERE et.id = m.exporter_template_id), m.exporter_template_id),
  COALESCE((SELECT mt.resource_category FROM m01_monitor_types mt WHERE mt.code = m.monitor_type), 'generic_target'),
  m.exporter_template_id,
  m.default_port,
  m.metrics_path,
  m.scheme,
  m.scrape_interval,
  m.scrape_timeout,
  NULLIF(m.label_template_id, ''),
  900,
  '由默认采集配置迁移（原 monitor_type=' || m.monitor_type || '）',
  TRUE,
  FALSE,
  m.created_at,
  m.updated_at
FROM m01_ci_type_exporter_mappings m
WHERE m.deleted_at IS NULL
  AND m.is_default = FALSE
  AND m.monitor_type <> ''
  AND NOT EXISTS (
    SELECT 1 FROM m01_collection_templates t
    WHERE t.code = m.monitor_type || '__' || m.exporter_template_id
  );

ALTER TABLE m01_scrape_jobs ADD COLUMN IF NOT EXISTS template_code TEXT NOT NULL DEFAULT '';
UPDATE m01_scrape_jobs SET template_code = monitor_type WHERE monitor_type <> '';
ALTER TABLE m01_scrape_jobs ADD COLUMN IF NOT EXISTS selector TEXT NOT NULL DEFAULT '{"logic":"all","filters":[]}';
UPDATE m01_scrape_jobs j
SET selector = COALESCE((
  SELECT json_build_object(
    'logic', mt.rule_logic,
    'filters', COALESCE(
      json_agg(json_build_object(
        'field', r.field_name,
        'operator', r.match_operator,
        'values', (r.field_values)::json)),
      '[]'::json))::text
  FROM m01_monitor_type_rules r
  JOIN m01_monitor_types mt ON mt.code = r.monitor_type_code
  WHERE r.monitor_type_code = j.template_code
    AND r.deleted_at IS NULL
), '{"logic":"all","filters":[]}')
WHERE j.template_code <> '';
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_template
  ON m01_scrape_jobs(template_code);
ALTER TABLE m01_scrape_jobs DROP COLUMN IF EXISTS monitor_type;


ALTER TABLE m01_monitoring_rules ADD COLUMN IF NOT EXISTS template_code TEXT NOT NULL DEFAULT '';
UPDATE m01_monitoring_rules SET template_code = monitor_type WHERE monitor_type <> '';
ALTER TABLE m01_monitoring_rules DROP COLUMN IF EXISTS monitor_type;

ALTER TABLE m01_metric_library RENAME COLUMN monitor_types TO collection_templates;
UPDATE m01_metric_library
SET collection_templates = replace(collection_templates, '"monitor_type"', '"template_code"');

ALTER TABLE m01_exporter_templates DROP COLUMN IF EXISTS supported_monitor_types;

DROP TABLE IF EXISTS m01_monitor_type_rules;
DROP TABLE IF EXISTS m01_monitor_types;
DROP TABLE IF EXISTS m01_ci_type_exporter_mappings;

-- +goose Down
-- 结构回滚（空表重建，数据需从备份恢复）。
ALTER TABLE m01_job_groups ADD COLUMN monitor_type TEXT NOT NULL DEFAULT '';
UPDATE m01_job_groups SET monitor_type = template_code WHERE template_code <> '';
ALTER TABLE m01_job_groups DROP COLUMN IF EXISTS selector;
ALTER TABLE m01_job_groups DROP COLUMN IF EXISTS template_code;

ALTER TABLE m01_monitoring_rules ADD COLUMN IF NOT EXISTS monitor_type TEXT NOT NULL DEFAULT '';
UPDATE m01_monitoring_rules SET monitor_type = template_code WHERE template_code <> '';
ALTER TABLE m01_monitoring_rules DROP COLUMN IF EXISTS template_code;

DROP INDEX IF EXISTS idx_m01_scrape_jobs_template;
ALTER TABLE m01_scrape_jobs DROP COLUMN IF EXISTS selector;
ALTER TABLE m01_scrape_jobs ADD COLUMN IF NOT EXISTS monitor_type TEXT NOT NULL DEFAULT '';
UPDATE m01_scrape_jobs SET monitor_type = template_code WHERE template_code <> '';
ALTER TABLE m01_scrape_jobs DROP COLUMN IF EXISTS template_code;

ALTER TABLE m01_exporter_templates ADD COLUMN IF NOT EXISTS supported_monitor_types TEXT NOT NULL DEFAULT '[]';

ALTER TABLE m01_metric_library RENAME COLUMN collection_templates TO monitor_types;
UPDATE m01_metric_library
SET monitor_types = replace(monitor_types, '"template_code"', '"monitor_type"');

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

CREATE TABLE IF NOT EXISTS m01_monitor_types (
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

CREATE TABLE IF NOT EXISTS m01_monitor_type_rules (
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

DROP TABLE IF EXISTS m01_collection_templates;
