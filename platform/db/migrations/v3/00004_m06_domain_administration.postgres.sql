-- +goose Up
-- M06 v3 network-domain administrative cleanup (PostgreSQL production variant).
--
-- Mirrors 00004_m06_domain_administration.sqlite.sql. PostgreSQL can alter the
-- CHECK constraint directly; the DO block finds any check constraint that
-- mentions domain_type instead of relying on the auto-generated constraint
-- name (which differs across PostgreSQL versions).

-- 1) Remove management-domain wording before the type changes.
UPDATE network_domains
SET name = '默认采集域（历史迁移）'
WHERE domain_type = 'management' AND name = '中心直连域';

UPDATE network_domains
SET description = '历史中心直连域迁移为采集节点域；请通过 M09 完成纳管'
WHERE domain_type = 'management'
  AND (description IS NULL OR description = '' OR description LIKE 'v3 core seed%');

-- 2) Normalize management rows to collection-node semantics.
UPDATE network_domains
SET domain_type = 'edge',
    channel = 'agent_pull',
    token = '',
    agent_type = '',
    center_endpoint = '',
    remote_write_url = '',
    max_disk_usage_per_url = '',
    monitored_status = NULL,
    last_heartbeat = NULL,
    agent_version = '',
    is_monitored = FALSE,
    registration_status = 'created',
    authorized_tenant_ids = CASE
      WHEN authorized_tenant_ids IS NULL OR authorized_tenant_ids = ''
        THEN '["platform_admin"]'
      ELSE authorized_tenant_ids
    END
WHERE domain_type = 'management';

-- 3) Any legacy edge domain still carrying the local channel must move to the
-- collection-node delivery channel.
UPDATE network_domains
SET channel = 'agent_pull'
WHERE domain_type = 'edge' AND channel = 'local';

-- 4) Replace the domain_type CHECK constraint.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'network_domains'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%domain_type%'
  LOOP
    EXECUTE format('ALTER TABLE network_domains DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE network_domains
  ADD CONSTRAINT network_domains_domain_type_check
  CHECK (domain_type IN ('edge', 'collection'));

DROP INDEX IF EXISTS idx_network_domains_single_management;
CREATE INDEX IF NOT EXISTS idx_network_domains_status ON network_domains(status);
CREATE INDEX IF NOT EXISTS idx_network_domains_cloud_zone ON network_domains(cloud_code, zone_type);

-- 5) Login-log filters (account + result + time window).
CREATE INDEX IF NOT EXISTS idx_login_logs_username_created_at ON login_logs(username, created_at);
CREATE INDEX IF NOT EXISTS idx_login_logs_success ON login_logs(success, created_at);

-- +goose Down
-- Restore the v3.0 baseline schema shape. Data is intentionally not converted
-- back to management: the administrative semantics stay with the new model.
-- `collection` is collapsed to `edge` so the old CHECK can be restored.
UPDATE network_domains SET domain_type = 'edge' WHERE domain_type = 'collection';

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'network_domains'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%domain_type%'
  LOOP
    EXECUTE format('ALTER TABLE network_domains DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE network_domains
  ADD CONSTRAINT network_domains_domain_type_check
  CHECK (domain_type IN ('management', 'edge'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_network_domains_single_management
  ON network_domains(domain_type)
  WHERE domain_type = 'management' AND deleted_at IS NULL;

DROP INDEX IF EXISTS idx_network_domains_status;
DROP INDEX IF EXISTS idx_network_domains_cloud_zone;
DROP INDEX IF EXISTS idx_login_logs_username_created_at;
DROP INDEX IF EXISTS idx_login_logs_success;
