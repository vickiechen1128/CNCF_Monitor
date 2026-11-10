-- +goose Up
-- M07 v3 resource schema: one shared resource table + six 1:1 extension tables.
--
-- Reference tables (tenants / network_domains / business_domains /
-- application_dicts / platform_dicts) are owned by M00/M06. SQLite allows FK
-- references to tables created later; runtime inserts require them to exist.

CREATE TABLE IF NOT EXISTS resources (
  resource_id TEXT PRIMARY KEY,
  resource_category TEXT NOT NULL CHECK (resource_category IN (
    'host', 'database', 'middleware', 'application', 'generic_target', 'interface_service'
  )),
  tenant_id TEXT NOT NULL,
  network_domain_id TEXT NOT NULL,
  biz_code TEXT,
  app_code TEXT,
  platform_code TEXT,
  env TEXT NOT NULL CHECK (env IN ('OPS', 'PRD', 'UAT')),
  cluster TEXT,
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'maintenance')),
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'import', 'cmdb')),
  scrape_port INTEGER NOT NULL DEFAULT 0 CHECK (scrape_port BETWEEN 0 AND 65535),
  dedup_key TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (network_domain_id) REFERENCES network_domains(id),
  FOREIGN KEY (biz_code) REFERENCES business_domains(code),
  FOREIGN KEY (app_code) REFERENCES application_dicts(app_code),
  FOREIGN KEY (platform_code) REFERENCES platform_dicts(platform_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resources_category_dedup
  ON resources(resource_category, dedup_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resources_category_status ON resources(resource_category, status);
CREATE INDEX IF NOT EXISTS idx_resources_tenant ON resources(tenant_id);
CREATE INDEX IF NOT EXISTS idx_resources_domain ON resources(network_domain_id);
CREATE INDEX IF NOT EXISTS idx_resources_app ON resources(app_code);
CREATE INDEX IF NOT EXISTS idx_resources_biz ON resources(biz_code);
CREATE INDEX IF NOT EXISTS idx_resources_platform ON resources(platform_code);
CREATE INDEX IF NOT EXISTS idx_resources_deleted_at ON resources(deleted_at);

CREATE TABLE IF NOT EXISTS host_resources (
  resource_id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  instance_ip TEXT NOT NULL,
  os_type TEXT NOT NULL,
  os_version TEXT,
  activated_at DATETIME,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_host_resources_ip ON host_resources(instance_ip);

CREATE TABLE IF NOT EXISTS database_resources (
  resource_id TEXT PRIMARY KEY,
  database_type TEXT NOT NULL,
  instance_ip TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  version TEXT,
  connection_secret_ref TEXT,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_database_resources_ip_port ON database_resources(instance_ip, port);

CREATE TABLE IF NOT EXISTS middleware_resources (
  resource_id TEXT PRIMARY KEY,
  middleware_type TEXT NOT NULL,
  instance_ip TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  version TEXT,
  connection_secret_ref TEXT,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_middleware_resources_ip_port ON middleware_resources(instance_ip, port);

CREATE TABLE IF NOT EXISTS application_resources (
  resource_id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  health_check_url TEXT NOT NULL,
  protocol TEXT,
  endpoint TEXT,
  port INTEGER CHECK (port = 0 OR (port BETWEEN 1 AND 65535)),
  owner1 TEXT,
  owner1_contact TEXT,
  owner2 TEXT,
  owner2_contact TEXT,
  ops_person TEXT,
  ops_person_contact TEXT,
  go_live_at DATETIME,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_application_resources_service ON application_resources(service_name);

CREATE TABLE IF NOT EXISTS generic_target_resources (
  resource_id TEXT PRIMARY KEY,
  target_name TEXT NOT NULL,
  instance_ip TEXT NOT NULL,
  port INTEGER CHECK (port = 0 OR (port BETWEEN 1 AND 65535)),
  metrics_path TEXT,
  scheme TEXT,
  exporter_type TEXT,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_generic_target_resources_ip_port ON generic_target_resources(instance_ip, port);

CREATE TABLE IF NOT EXISTS interface_service_resources (
  resource_id TEXT PRIMARY KEY,
  api_name TEXT NOT NULL,
  api_url TEXT NOT NULL,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_interface_service_resources_url ON interface_service_resources(api_url);

CREATE TABLE IF NOT EXISTS resource_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('system', 'user', 'cmdb')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  FOREIGN KEY (resource_id) REFERENCES resources(resource_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_labels_resource_key_source
  ON resource_labels(resource_id, key, source)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_resource_labels_resource ON resource_labels(resource_id);

CREATE TABLE IF NOT EXISTS app_platform_rels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_code TEXT NOT NULL,
  platform_code TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,
  FOREIGN KEY (app_code) REFERENCES application_dicts(app_code),
  FOREIGN KEY (platform_code) REFERENCES platform_dicts(platform_code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_platform_rel_pair
  ON app_platform_rels(app_code, platform_code)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_platform_rel_primary
  ON app_platform_rels(app_code)
  WHERE is_primary = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS resource_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  operator TEXT,
  before_json TEXT,
  after_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_resource_audit_logs_resource ON resource_audit_logs(resource_id, created_at);

-- +goose Down
DROP TABLE IF EXISTS resource_audit_logs;
DROP TABLE IF EXISTS app_platform_rels;
DROP TABLE IF EXISTS resource_labels;
DROP TABLE IF EXISTS interface_service_resources;
DROP TABLE IF EXISTS generic_target_resources;
DROP TABLE IF EXISTS application_resources;
DROP TABLE IF EXISTS middleware_resources;
DROP TABLE IF EXISTS database_resources;
DROP TABLE IF EXISTS host_resources;
DROP TABLE IF EXISTS resources;
