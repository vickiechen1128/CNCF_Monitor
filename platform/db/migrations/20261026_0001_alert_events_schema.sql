-- +goose Up
-- 历史告警事件表（Module_08）最终 schema。
--
-- 说明：当前运行时仍由 GORM AutoMigrate 创建/补齐本表（存量基线）；
-- 本文件是 migration-first 的版本化 schema 记录，新环境接入 goose 后按本文件执行。
-- 变更点（2026-10-26）：新增 occurrence_key、closed_at，以及 occurrence 唯一索引。

CREATE TABLE IF NOT EXISTS alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME,
  updated_at DATETIME,
  deleted_at DATETIME,
  fingerprint TEXT,
  occurrence_key TEXT,
  alert_name TEXT,
  status TEXT NOT NULL,
  severity TEXT,
  summary TEXT,
  description TEXT,
  network_domain TEXT,
  labels TEXT,
  annotations TEXT,
  starts_at DATETIME,
  ends_at DATETIME,
  closed_at DATETIME,
  group_key TEXT,
  receiver TEXT,
  source TEXT,
  last_notified_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_alert_events_fingerprint ON alert_events(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alert_events_alert_name ON alert_events(alert_name);
CREATE INDEX IF NOT EXISTS idx_alert_events_status ON alert_events(status);
CREATE INDEX IF NOT EXISTS idx_alert_events_severity ON alert_events(severity);
CREATE INDEX IF NOT EXISTS idx_alert_events_network_domain ON alert_events(network_domain);
CREATE INDEX IF NOT EXISTS idx_alert_events_starts_at ON alert_events(starts_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_closed_at ON alert_events(closed_at);
CREATE INDEX IF NOT EXISTS idx_alert_events_deleted_at ON alert_events(deleted_at);

-- 同一 fingerprint 最多一条未结行（终态不参与约束，恢复后再次触发可插新行）。
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_events_open_fingerprint
  ON alert_events(fingerprint)
  WHERE fingerprint <> '' AND status IN ('firing','silenced','inhibited') AND deleted_at IS NULL;

-- 一次发生（occurrence）全表唯一；无指纹行 occurrence_key 为空，不参与约束。
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_events_occurrence_key
  ON alert_events(occurrence_key)
  WHERE occurrence_key <> '' AND deleted_at IS NULL;

-- +goose Down
DROP INDEX IF EXISTS uq_alert_events_occurrence_key;
DROP INDEX IF EXISTS idx_alert_events_open_fingerprint;
DROP INDEX IF EXISTS idx_alert_events_deleted_at;
DROP INDEX IF EXISTS idx_alert_events_closed_at;
DROP INDEX IF EXISTS idx_alert_events_starts_at;
DROP INDEX IF EXISTS idx_alert_events_network_domain;
DROP INDEX IF EXISTS idx_alert_events_severity;
DROP INDEX IF EXISTS idx_alert_events_status;
DROP INDEX IF EXISTS idx_alert_events_alert_name;
DROP INDEX IF EXISTS idx_alert_events_fingerprint;
DROP TABLE IF EXISTS alert_events;
