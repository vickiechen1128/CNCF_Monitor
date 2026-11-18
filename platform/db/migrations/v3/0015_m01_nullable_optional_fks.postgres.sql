-- +goose Up
-- M01 optional foreign keys: empty string -> NULL + real ON DELETE SET NULL FKs.
-- Postgres counterpart of 0015_m01_nullable_optional_fks.sqlite.sql.
--
-- exporter_template_id / label_template_id become real FKs to
-- m01_exporter_templates(id) / m07_label_templates(id); blackbox_module keeps
-- its name-based (no FK) semantics but is normalized to NULL. Down is a no-op
-- (irreversible) by design, mirroring the m08 pattern.

-- 1) m01_ci_type_exporter_mappings.label_template_id -> m07_label_templates(id).
ALTER TABLE m01_ci_type_exporter_mappings
  ALTER COLUMN label_template_id DROP NOT NULL,
  ALTER COLUMN label_template_id DROP DEFAULT;
UPDATE m01_ci_type_exporter_mappings
   SET label_template_id = NULL WHERE label_template_id = '';
ALTER TABLE m01_ci_type_exporter_mappings
  ADD CONSTRAINT fk_m01_mappings_label_template
  FOREIGN KEY (label_template_id) REFERENCES m07_label_templates(id)
  ON DELETE SET NULL;

-- 2) m01_scrape_jobs optional refs.
ALTER TABLE m01_scrape_jobs
  ALTER COLUMN exporter_template_id DROP NOT NULL,
  ALTER COLUMN exporter_template_id DROP DEFAULT,
  ALTER COLUMN label_template_id DROP NOT NULL,
  ALTER COLUMN label_template_id DROP DEFAULT,
  ALTER COLUMN blackbox_module DROP NOT NULL,
  ALTER COLUMN blackbox_module DROP DEFAULT;
UPDATE m01_scrape_jobs SET exporter_template_id = NULL WHERE exporter_template_id = '';
UPDATE m01_scrape_jobs SET label_template_id = NULL WHERE label_template_id = '';
UPDATE m01_scrape_jobs SET blackbox_module = NULL WHERE blackbox_module = '';
ALTER TABLE m01_scrape_jobs
  ADD CONSTRAINT fk_m01_jobs_exporter_template
  FOREIGN KEY (exporter_template_id) REFERENCES m01_exporter_templates(id)
  ON DELETE SET NULL;
ALTER TABLE m01_scrape_jobs
  ADD CONSTRAINT fk_m01_jobs_label_template
  FOREIGN KEY (label_template_id) REFERENCES m07_label_templates(id)
  ON DELETE SET NULL;

-- 3) m01_monitoring_rules.exporter_template_id -> m01_exporter_templates(id).
ALTER TABLE m01_monitoring_rules
  ALTER COLUMN exporter_template_id DROP NOT NULL,
  ALTER COLUMN exporter_template_id DROP DEFAULT;
UPDATE m01_monitoring_rules
   SET exporter_template_id = NULL WHERE exporter_template_id = '';
ALTER TABLE m01_monitoring_rules
  ADD CONSTRAINT fk_m01_rules_exporter_template
  FOREIGN KEY (exporter_template_id) REFERENCES m01_exporter_templates(id)
  ON DELETE SET NULL;

-- 4) m01_metric_library.exporter_template_id -> m01_exporter_templates(id).
ALTER TABLE m01_metric_library
  ALTER COLUMN exporter_template_id DROP NOT NULL,
  ALTER COLUMN exporter_template_id DROP DEFAULT;
UPDATE m01_metric_library
   SET exporter_template_id = NULL WHERE exporter_template_id = '';
ALTER TABLE m01_metric_library
  ADD CONSTRAINT fk_m01_metrics_exporter_template
  FOREIGN KEY (exporter_template_id) REFERENCES m01_exporter_templates(id)
  ON DELETE SET NULL;

-- 5) m01_job_groups optional refs (00012).
ALTER TABLE m01_job_groups
  ALTER COLUMN exporter_template_id DROP NOT NULL,
  ALTER COLUMN exporter_template_id DROP DEFAULT,
  ALTER COLUMN label_template_id DROP NOT NULL,
  ALTER COLUMN label_template_id DROP DEFAULT,
  ALTER COLUMN blackbox_module DROP NOT NULL,
  ALTER COLUMN blackbox_module DROP DEFAULT;
UPDATE m01_job_groups SET exporter_template_id = NULL WHERE exporter_template_id = '';
UPDATE m01_job_groups SET label_template_id = NULL WHERE label_template_id = '';
UPDATE m01_job_groups SET blackbox_module = NULL WHERE blackbox_module = '';
ALTER TABLE m01_job_groups
  ADD CONSTRAINT fk_m01_job_groups_exporter_template
  FOREIGN KEY (exporter_template_id) REFERENCES m01_exporter_templates(id)
  ON DELETE SET NULL;
ALTER TABLE m01_job_groups
  ADD CONSTRAINT fk_m01_job_groups_label_template
  FOREIGN KEY (label_template_id) REFERENCES m07_label_templates(id)
  ON DELETE SET NULL;

-- +goose Down
-- The empty-string -> NULL conversion is irreversible (original '' values are
-- not distinguishable from genuinely-unset NULL after the Up), but the FK
-- constraints MUST be dropped here: PostgreSQL refuses to drop the parent
-- tables (m01_exporter_templates / m07_label_templates) while they are still
-- referenced when the rollback chain reaches migration 00006/00007.
ALTER TABLE m01_ci_type_exporter_mappings DROP CONSTRAINT IF EXISTS fk_m01_mappings_label_template;
ALTER TABLE m01_scrape_jobs DROP CONSTRAINT IF EXISTS fk_m01_jobs_exporter_template;
ALTER TABLE m01_scrape_jobs DROP CONSTRAINT IF EXISTS fk_m01_jobs_label_template;
ALTER TABLE m01_monitoring_rules DROP CONSTRAINT IF EXISTS fk_m01_rules_exporter_template;
ALTER TABLE m01_metric_library DROP CONSTRAINT IF EXISTS fk_m01_metrics_exporter_template;
ALTER TABLE m01_job_groups DROP CONSTRAINT IF EXISTS fk_m01_job_groups_exporter_template;
ALTER TABLE m01_job_groups DROP CONSTRAINT IF EXISTS fk_m01_job_groups_label_template;
