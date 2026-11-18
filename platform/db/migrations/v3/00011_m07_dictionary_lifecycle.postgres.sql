-- +goose Up
-- M07 v3 dictionary lifecycle (PostgreSQL production variant).
--
-- See the SQLite variant for the design rationale. Enable flags stay as the
-- authoritative "selectable" bit; merged_into / revoked_at add the two terminal
-- states required by M07 SRS v2.0.

ALTER TABLE business_domains  ADD COLUMN IF NOT EXISTS merged_into TEXT;
ALTER TABLE business_domains  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMP;
ALTER TABLE application_dicts ADD COLUMN IF NOT EXISTS merged_into TEXT;
ALTER TABLE application_dicts ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMP;
ALTER TABLE platform_dicts    ADD COLUMN IF NOT EXISTS merged_into TEXT;
ALTER TABLE platform_dicts    ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMP;

CREATE TABLE IF NOT EXISTS m07_dictionary_audit_logs (
  id              TEXT PRIMARY KEY,
  dictionary_type TEXT NOT NULL
    CHECK (dictionary_type IN ('business', 'application', 'platform')),
  action          TEXT NOT NULL
    CHECK (action IN ('enable', 'disable', 'revoke', 'merge')),
  source_code     TEXT NOT NULL,
  target_code     TEXT NOT NULL DEFAULT '',
  reference_count INTEGER NOT NULL DEFAULT 0,
  operator        TEXT NOT NULL DEFAULT '',
  detail          TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_m07_dictionary_audit_source
  ON m07_dictionary_audit_logs(dictionary_type, source_code, created_at);
CREATE INDEX IF NOT EXISTS idx_m07_dictionary_audit_created
  ON m07_dictionary_audit_logs(created_at);

-- +goose Down
DROP INDEX IF EXISTS idx_m07_dictionary_audit_created;
DROP INDEX IF EXISTS idx_m07_dictionary_audit_source;
DROP TABLE IF EXISTS m07_dictionary_audit_logs;
ALTER TABLE platform_dicts    DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE platform_dicts    DROP COLUMN IF EXISTS merged_into;
ALTER TABLE application_dicts DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE application_dicts DROP COLUMN IF EXISTS merged_into;
ALTER TABLE business_domains  DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE business_domains  DROP COLUMN IF EXISTS merged_into;
