-- +goose Up
-- M07 v3 dictionary lifecycle — cloud/zone extension (PostgreSQL production).
--
-- See the SQLite variant for the design rationale. Cloud/zone dictionaries gain
-- the same two terminal states as business/application/platform; the audit
-- table's dictionary_type CHECK is widened from three to five values.

ALTER TABLE cloud_dicts ADD COLUMN IF NOT EXISTS merged_into TEXT;
ALTER TABLE cloud_dicts ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMP;
ALTER TABLE zone_types  ADD COLUMN IF NOT EXISTS merged_into TEXT;
ALTER TABLE zone_types  ADD COLUMN IF NOT EXISTS revoked_at  TIMESTAMP;

-- PostgreSQL cannot ALTER an existing CHECK, so drop the constraint that guards
-- dictionary_type and re-add it with the widened whitelist. Identify the
-- constraint by inspecting its definition (inline CHECKs get a generated name).
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'm07_dictionary_audit_logs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%dictionary_type%'
  LOOP
    EXECUTE 'ALTER TABLE m07_dictionary_audit_logs DROP CONSTRAINT ' || quote_ident(con.conname);
  END LOOP;
END $$;

ALTER TABLE m07_dictionary_audit_logs
  ADD CONSTRAINT m07_dictionary_audit_logs_dictionary_type_check
  CHECK (dictionary_type IN ('business', 'application', 'platform', 'cloud', 'zone'));

-- +goose Down
-- Data is irreversible: any cloud/zone audit rows written while 0018 was active
-- would violate the restored three-value CHECK and must be archived first. The
-- lifecycle columns are intentionally left in place.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'm07_dictionary_audit_logs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%dictionary_type%'
  LOOP
    EXECUTE 'ALTER TABLE m07_dictionary_audit_logs DROP CONSTRAINT ' || quote_ident(con.conname);
  END LOOP;
END $$;

ALTER TABLE m07_dictionary_audit_logs
  ADD CONSTRAINT m07_dictionary_audit_logs_dictionary_type_check
  CHECK (dictionary_type IN ('business', 'application', 'platform'));
