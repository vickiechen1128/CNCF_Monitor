-- +goose Up
-- Align the network_domains.domain_type CHECK constraint across dialects.
--
-- Background (v3 rewrite review):
--   * SQLite: 00000 created CHECK (domain_type IN ('management','edge'));
--     00004 blocked 'management' with BEFORE INSERT/UPDATE triggers but could
--     not rebuild the CHECK (the table is referenced by resources FKs). The
--     only storable value is therefore 'edge'.
--   * Postgres: 00004 replaced the CHECK with ('edge','collection'), so a
--     'collection' row can be written that SQLite rejects and that the v3
--     service layer never produces (Create always writes 'edge'; 00004 already
--     migrated historical management rows to edge).
--
-- This migration tightens Postgres to accept exactly the value the service
-- layer writes: 'edge'. 'collection' remains a READ-COMPAT value in the
-- application code (admin list filters, reference lookups); no code change is
-- required because those paths only tolerate pre-existing rows, they do not
-- create them.

-- Defensive: never let a stale 'collection' row block the stricter CHECK.
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
  CHECK (domain_type IN ('edge'));

-- +goose Down
-- Restore the post-00004 Postgres shape (edge + collection read-compat) so the
-- rollback chain (0013 -> 00004) stays intact.

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
