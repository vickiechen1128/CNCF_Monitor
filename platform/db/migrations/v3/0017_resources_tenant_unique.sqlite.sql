-- +goose Up
-- Scope the resource dedup unique key by tenant so dedup is tenant-local,
-- paving the way for multi-tenancy (MVP still pins platform_admin).
-- The old key uq_resources_category_dedup(resource_category, dedup_key) is
-- replaced by (tenant_id, resource_category, dedup_key). Because the legacy
-- key was already globally unique, widening it with tenant_id cannot create
-- duplicates for existing rows.
DROP INDEX IF EXISTS uq_resources_category_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS uq_resources_category_dedup
  ON resources(tenant_id, resource_category, dedup_key)
  WHERE deleted_at IS NULL;

-- NOTE (intentional): idx_users_username(username) from 00000 stays global.
-- MVP is single-tenant and login resolves users by username alone; scoping the
-- username unique key by tenant_id would break login without any MVP benefit.
-- Likewise the network_domains management single-instance constraint is an
-- intentional design decision and is left untouched.

-- +goose Down
-- Restore the legacy globally-unique dedup key. Rollback is safe only while
-- dedup_key values remain distinct across tenants (true for the MVP where
-- every row belongs to platform_admin).
DROP INDEX IF EXISTS uq_resources_category_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS uq_resources_category_dedup
  ON resources(resource_category, dedup_key)
  WHERE deleted_at IS NULL;
