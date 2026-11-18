-- +goose Up
-- V3-only line: drop the 11 legacy onboarding columns from `network_domains`.
--
-- Runtime ownership of these fields moved to `network_domain_access` in 00005
-- (M09). Keeping duplicate columns on the administrative table allowed the two
-- sources of truth to drift; the v3-only line removes them outright and accepts
-- that the legacy mode is no longer maintained.
--
-- Ordering is safe: 00004 (which still UPDATEs these columns during the
-- historical management -> edge normalization) runs before this migration on a
-- fresh v3 database. No index or CHECK elsewhere in the v3 chain references
-- these columns, so plain DROP COLUMN is sufficient.
ALTER TABLE network_domains DROP COLUMN channel;
ALTER TABLE network_domains DROP COLUMN token;
ALTER TABLE network_domains DROP COLUMN agent_type;
ALTER TABLE network_domains DROP COLUMN center_endpoint;
ALTER TABLE network_domains DROP COLUMN remote_write_url;
ALTER TABLE network_domains DROP COLUMN max_disk_usage_per_url;
ALTER TABLE network_domains DROP COLUMN monitored_status;
ALTER TABLE network_domains DROP COLUMN last_heartbeat;
ALTER TABLE network_domains DROP COLUMN agent_version;
ALTER TABLE network_domains DROP COLUMN is_monitored;
ALTER TABLE network_domains DROP COLUMN registration_status;

-- +goose Down
-- Intentionally irreversible in the V3-only line.
--
-- The legacy column values were superseded by `network_domain_access` rows
-- during M09 onboarding and cannot be reconstructed here (tokens were hashed,
-- registration state was promoted/demoted through the access record). Restoring
-- empty columns would silently fabricate data and let legacy writers diverge
-- from the authoritative access table again.
--
-- `SELECT 1;` is a deliberate no-op: the migration runner requires a non-empty
-- Down section (see rollbackMigration), but rolling back this migration does not
-- pretend the dropped columns can return.
SELECT 1;
