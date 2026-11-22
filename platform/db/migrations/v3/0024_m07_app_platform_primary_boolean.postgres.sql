-- +goose Up
-- app_platform_rels.is_primary was created as INTEGER (0/1) in the shared
-- 00002 migration, a SQLite-portability shape. On PostgreSQL the column type
-- then disagrees with every consumer: the GORM models declare bool and the
-- repositories filter with `is_primary = true`, which PostgreSQL rejects with
-- "operator does not exist: integer = boolean". Convert it to a real BOOLEAN.
DROP INDEX IF EXISTS uq_app_platform_rel_primary;
ALTER TABLE app_platform_rels
  DROP CONSTRAINT IF EXISTS app_platform_rels_is_primary_check;
ALTER TABLE app_platform_rels
  ALTER COLUMN is_primary DROP DEFAULT,
  ALTER COLUMN is_primary TYPE BOOLEAN USING (is_primary <> 0),
  ALTER COLUMN is_primary SET DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_platform_rel_primary
  ON app_platform_rels(app_code) WHERE is_primary AND deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS uq_app_platform_rel_primary;
ALTER TABLE app_platform_rels
  ALTER COLUMN is_primary DROP DEFAULT,
  ALTER COLUMN is_primary TYPE INTEGER USING (CASE WHEN is_primary THEN 1 ELSE 0 END),
  ALTER COLUMN is_primary SET DEFAULT 0;
ALTER TABLE app_platform_rels
  ADD CONSTRAINT app_platform_rels_is_primary_check CHECK (is_primary IN (0, 1));
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_platform_rel_primary
  ON app_platform_rels(app_code) WHERE is_primary = 1 AND deleted_at IS NULL;
