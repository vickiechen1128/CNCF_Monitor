-- +goose Up
-- M01 v3 job groups（对象优先动线，SRS: Module_01_Job_Group_and_Object_First_SRS v1.0）
--
-- 与 SQLite 变体同义：m01_job_groups = 一张监控意图；job_group_id 关联子 Job；
-- job_name 唯一性由全局唯一收敛为 (network_domain_id, job_name) 唯一。
-- 下发层不变：M09 仍按 network_domain_id 读取单域 Job。

CREATE TABLE IF NOT EXISTS m01_job_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  job_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (job_type IN ('standard', 'blackbox')),
  resource_category TEXT NOT NULL
    CHECK (resource_category IN ('host', 'database', 'middleware', 'application',
                                 'generic_target', 'interface_service')),
  monitor_type TEXT NOT NULL DEFAULT '',
  exporter_template_id TEXT NOT NULL DEFAULT '',
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
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK (status IN ('enabled', 'disabled')),
  created_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_job_groups_name
  ON m01_job_groups(name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_job_groups_deleted_at
  ON m01_job_groups(deleted_at);

ALTER TABLE m01_scrape_jobs ADD COLUMN job_group_id TEXT REFERENCES m01_job_groups(id);
DROP INDEX IF EXISTS uq_m01_scrape_jobs_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_scrape_jobs_domain_name
  ON m01_scrape_jobs(network_domain_id, job_name) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_m01_scrape_jobs_group
  ON m01_scrape_jobs(job_group_id);

-- +goose Down
DROP INDEX IF EXISTS idx_m01_scrape_jobs_group;
DROP INDEX IF EXISTS uq_m01_scrape_jobs_domain_name;
-- 回滚恢复「全局唯一」：若已存在跨域同名行，DDL 会被拒绝（需先处理数据），不静默删除。
CREATE UNIQUE INDEX IF NOT EXISTS uq_m01_scrape_jobs_name
  ON m01_scrape_jobs(job_name) WHERE deleted_at IS NULL;
ALTER TABLE m01_scrape_jobs DROP COLUMN job_group_id;
DROP INDEX IF EXISTS idx_m01_job_groups_deleted_at;
DROP INDEX IF EXISTS uq_m01_job_groups_name;
DROP TABLE IF EXISTS m01_job_groups;
