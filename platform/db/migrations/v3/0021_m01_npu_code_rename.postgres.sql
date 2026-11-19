-- +goose Up
-- Rename the legacy monitor type code npu -> host_npu (SRS Module_01 v1.3 §3.1).
-- Postgres counterpart of 0021_m01_npu_code_rename.sqlite.sql.
--
-- Before v1.3 NPU was its own bare code ("npu"). It is now "host_npu" because the
-- type is a host capability that is orthogonal to the operating system. Any row
-- written by the previous build must follow the rename, otherwise existing jobs
-- and mappings would point at a type that no longer resolves.
--
-- The statement is idempotent: a database created after v1.3 has no "npu" rows,
-- so every UPDATE touches zero rows.

-- 1) Plain monitor_type columns.
UPDATE m01_scrape_jobs SET monitor_type = 'host_npu' WHERE monitor_type = 'npu';
UPDATE m01_job_groups SET monitor_type = 'host_npu' WHERE monitor_type = 'npu';
UPDATE m01_ci_type_exporter_mappings SET monitor_type = 'host_npu' WHERE monitor_type = 'npu';
UPDATE m01_monitoring_rules SET monitor_type = 'host_npu' WHERE monitor_type = 'npu';

-- 2) JSON arrays: exporter supported types and metric anchors store the code as
--    a quoted JSON string, so a textual replace is portable across drivers.
UPDATE m01_exporter_templates
   SET supported_monitor_types = REPLACE(supported_monitor_types::text, '"npu"', '"host_npu"')::jsonb
 WHERE supported_monitor_types::text LIKE '%"npu"%';
UPDATE m01_metric_library
   SET monitor_types = REPLACE(monitor_types::text, '"npu"', '"host_npu"')::jsonb
 WHERE monitor_types::text LIKE '%"npu"%';

-- 3) A registry definition row may exist if an intermediate build was run before
--    the rename. Move it only when host_npu is still absent, so this can never
--    clash with the seeded definition.
UPDATE m01_monitor_types
   SET code = 'host_npu'
 WHERE code = 'npu'
   AND NOT EXISTS (SELECT 1 FROM m01_monitor_types WHERE code = 'host_npu');
UPDATE m01_monitor_type_rules
   SET monitor_type_code = 'host_npu'
 WHERE monitor_type_code = 'npu';

-- +goose Down
-- Best-effort rollback for development only. The registry definition keeps the
-- host_npu code (rolling it back would break the current code line), while the
-- reference columns return to the legacy value.
UPDATE m01_scrape_jobs SET monitor_type = 'npu' WHERE monitor_type = 'host_npu';
UPDATE m01_job_groups SET monitor_type = 'npu' WHERE monitor_type = 'host_npu';
UPDATE m01_ci_type_exporter_mappings SET monitor_type = 'npu' WHERE monitor_type = 'host_npu';
UPDATE m01_monitoring_rules SET monitor_type = 'npu' WHERE monitor_type = 'host_npu';
UPDATE m01_exporter_templates
   SET supported_monitor_types = REPLACE(supported_monitor_types::text, '"host_npu"', '"npu"')::jsonb
 WHERE supported_monitor_types::text LIKE '%"host_npu"%';
UPDATE m01_metric_library
   SET monitor_types = REPLACE(monitor_types::text, '"host_npu"', '"npu"')::jsonb
 WHERE monitor_types::text LIKE '%"host_npu"%';
