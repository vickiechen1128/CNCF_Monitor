-- +goose Up
-- M00 v3 platform core schema (SQLite dev/test variant).
--
-- These are the shared reference / identity tables consumed by every v3
-- module. Column semantics are owned by M06 (tenants, network domains,
-- dictionaries) and M03 (users, sessions, login logs); M00 owns the portable
-- baseline schema so a fresh v3 database can be created before modules land.
--
-- SQLite uses INTEGER PRIMARY KEY AUTOINCREMENT for GORM uint primary keys;
-- see the .postgres.sql sibling for the BIGSERIAL variant.

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  network_domain_ids TEXT,
  multi_site_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS network_domains (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  domain_type TEXT NOT NULL CHECK (domain_type IN ('management', 'edge')),
  zone_type TEXT,
  cloud_code TEXT,
  tenant_id TEXT NOT NULL,
  authorized_tenant_ids TEXT,
  -- 物理列名沿用 v2 库（GORM 对 IPCIDRs 的历史推导），v3 首版保持同构。
  ip_c_id_rs TEXT,
  cmdb_cloud_area_id TEXT,
  cmdb_cloud_area_path TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('local', 'agent_pull')),
  token TEXT,
  agent_type TEXT,
  center_endpoint TEXT,
  remote_write_url TEXT,
  max_disk_usage_per_url TEXT,
  monitored_status TEXT,
  last_heartbeat TIMESTAMP,
  agent_version TEXT,
  is_monitored BOOLEAN NOT NULL DEFAULT FALSE,
  registration_status TEXT NOT NULL DEFAULT 'created',
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_network_domains_tenant ON network_domains(tenant_id);
CREATE INDEX IF NOT EXISTS idx_network_domains_deleted_at ON network_domains(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_domains_single_management
  ON network_domains(domain_type)
  WHERE domain_type = 'management' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS zone_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_types_code ON zone_types(code);
CREATE INDEX IF NOT EXISTS idx_zone_types_deleted_at ON zone_types(deleted_at);

CREATE TABLE IF NOT EXISTS business_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_domain_code ON business_domains(code);
CREATE INDEX IF NOT EXISTS idx_business_domains_deleted_at ON business_domains(deleted_at);

CREATE TABLE IF NOT EXISTS application_dicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_code TEXT NOT NULL,
  app_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'enabled',
  source TEXT NOT NULL DEFAULT 'manual',
  platform_code TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_application_dict_code ON application_dicts(app_code);
CREATE INDEX IF NOT EXISTS idx_application_dicts_deleted_at ON application_dicts(deleted_at);

CREATE TABLE IF NOT EXISTS platform_dicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_code TEXT NOT NULL,
  platform_name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_dict_code ON platform_dicts(platform_code);
CREATE INDEX IF NOT EXISTS idx_platform_dicts_deleted_at ON platform_dicts(deleted_at);

CREATE TABLE IF NOT EXISTS cloud_dicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cloud_code TEXT NOT NULL,
  cloud_name TEXT NOT NULL,
  cloud_type TEXT NOT NULL,
  carrier TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_dict_code ON cloud_dicts(cloud_code);
CREATE INDEX IF NOT EXISTS idx_cloud_dicts_deleted_at ON cloud_dicts(deleted_at);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_logs (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  ip TEXT,
  message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_logs_username ON login_logs(username);
CREATE INDEX IF NOT EXISTS idx_login_logs_created_at ON login_logs(created_at);

-- +goose Down
DROP TABLE IF EXISTS login_logs;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS cloud_dicts;
DROP TABLE IF EXISTS platform_dicts;
DROP TABLE IF EXISTS application_dicts;
DROP TABLE IF EXISTS business_domains;
DROP TABLE IF EXISTS zone_types;
DROP TABLE IF EXISTS network_domains;
DROP TABLE IF EXISTS tenants;
