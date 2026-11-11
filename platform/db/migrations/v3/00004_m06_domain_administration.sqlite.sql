-- +goose Up
-- M06 v3 network-domain administrative cleanup (SQLite dev/test variant).
--
-- The v3.0 SRS removes the center-direct (`management`) domain: every network
-- domain must be reached through a collection node. SQLite cannot alter a CHECK
-- constraint in place, and rebuilding `network_domains` while `resources` holds
-- a foreign key to it would make the FK follow the renamed table in the Go
-- migration transaction. Instead we keep the physical table and enforce the
-- new contract with BEFORE INSERT/UPDATE triggers. The service layer rejects
-- management as well; the trigger is the database-level backstop.
--
-- Historical management rows are converted to edge domains instead of being
-- soft-deleted: M07 resources may still reference them, and deleting the row
-- would leave those resources unusable. They keep their id (including the
-- historical `default` id) and become ordinary collection-node domains that
-- must be onboarded by M09.

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

-- 4) Block new management rows without rebuilding the table (keeps the
-- resources.network_domain_id foreign key intact).
DROP TRIGGER IF EXISTS trg_network_domains_no_management_insert;
CREATE TRIGGER trg_network_domains_no_management_insert
BEFORE INSERT ON network_domains
WHEN NEW.domain_type = 'management'
BEGIN
  SELECT RAISE(ABORT, 'management domain_type is no longer supported; use edge/collection');
END;

DROP TRIGGER IF EXISTS trg_network_domains_no_management_update;
CREATE TRIGGER trg_network_domains_no_management_update
BEFORE UPDATE OF domain_type ON network_domains
WHEN NEW.domain_type = 'management'
BEGIN
  SELECT RAISE(ABORT, 'management domain_type is no longer supported; use edge/collection');
END;

-- 5) The single-management partial index is obsolete. New filters for the v3
-- administrative list.
DROP INDEX IF EXISTS idx_network_domains_single_management;
CREATE INDEX IF NOT EXISTS idx_network_domains_status ON network_domains(status);
CREATE INDEX IF NOT EXISTS idx_network_domains_cloud_zone ON network_domains(cloud_code, zone_type);

-- 6) Login-log filters (account + result + time window).
CREATE INDEX IF NOT EXISTS idx_login_logs_username_created_at ON login_logs(username, created_at);
CREATE INDEX IF NOT EXISTS idx_login_logs_success ON login_logs(success, created_at);

-- +goose Down
-- Restore the historical constraint shape. Data stays edge (the administrative
-- semantics are not reverted).
DROP TRIGGER IF EXISTS trg_network_domains_no_management_insert;
DROP TRIGGER IF EXISTS trg_network_domains_no_management_update;

CREATE UNIQUE INDEX IF NOT EXISTS idx_network_domains_single_management
  ON network_domains(domain_type)
  WHERE domain_type = 'management' AND deleted_at IS NULL;

DROP INDEX IF EXISTS idx_network_domains_status;
DROP INDEX IF EXISTS idx_network_domains_cloud_zone;
DROP INDEX IF EXISTS idx_login_logs_username_created_at;
DROP INDEX IF EXISTS idx_login_logs_success;
