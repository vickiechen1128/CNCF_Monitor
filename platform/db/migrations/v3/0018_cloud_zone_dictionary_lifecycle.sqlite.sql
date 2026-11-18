-- +goose Up
-- M07 v3 dictionary lifecycle — cloud/zone extension (SQLite dev/test variant).
--
-- 00011 gave business/application/platform dictionaries the two terminal states
-- (merged_into / revoked_at) and created the audit table with a three-value
-- dictionary_type CHECK. This migration extends the same lifecycle to the two
-- remaining dictionaries: cloud_dicts and zone_types.
--
-- Cloud references live in network_domains.cloud_code; zone references live in
-- network_domains.zone_type (the authoritative cloud/zone label source, D103).

ALTER TABLE cloud_dicts ADD COLUMN merged_into TEXT;
ALTER TABLE cloud_dicts ADD COLUMN revoked_at  TIMESTAMP;
ALTER TABLE zone_types  ADD COLUMN merged_into TEXT;
ALTER TABLE zone_types  ADD COLUMN revoked_at  TIMESTAMP;

-- SQLite cannot ALTER a CHECK constraint. Rebuild the audit table with the
-- widened dictionary_type whitelist (business/application/platform/cloud/zone).
CREATE TABLE m07_dictionary_audit_logs_new (
  id              TEXT PRIMARY KEY,
  dictionary_type TEXT NOT NULL
    CHECK (dictionary_type IN ('business', 'application', 'platform', 'cloud', 'zone')),
  action          TEXT NOT NULL
    CHECK (action IN ('enable', 'disable', 'revoke', 'merge')),
  source_code     TEXT NOT NULL,
  target_code     TEXT NOT NULL DEFAULT '',
  reference_count INTEGER NOT NULL DEFAULT 0,
  operator        TEXT NOT NULL DEFAULT '',
  detail          TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO m07_dictionary_audit_logs_new
  (id, dictionary_type, action, source_code, target_code, reference_count, operator, detail, created_at)
  SELECT id, dictionary_type, action, source_code, target_code, reference_count, operator, detail, created_at
  FROM m07_dictionary_audit_logs;
DROP TABLE m07_dictionary_audit_logs;
ALTER TABLE m07_dictionary_audit_logs_new RENAME TO m07_dictionary_audit_logs;
CREATE INDEX IF NOT EXISTS idx_m07_dictionary_audit_source
  ON m07_dictionary_audit_logs(dictionary_type, source_code, created_at);
CREATE INDEX IF NOT EXISTS idx_m07_dictionary_audit_created
  ON m07_dictionary_audit_logs(created_at);

-- +goose Down
-- Data is irreversible: once cloud/zone lifecycle columns and audit rows exist
-- they cannot be safely dropped/narrowed without losing history. Keep the
-- widened schema (the PostgreSQL Down likewise cannot recover dropped data).
SELECT 1;
