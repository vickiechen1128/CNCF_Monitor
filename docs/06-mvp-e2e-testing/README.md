# 部署手册与运维指南

> **目录名说明**：本目录保留历史名 `06-mvp-e2e-testing`，自 2026-11-22 起仅保留**部署手册**；V2 E2E 测试与验收清单已归档到 `docs/05-execution-records/archive/v2-e2e/`。
> **当前代码线**：v3-only / PostgreSQL-only；API 为 `/api/v3/platform/*`、`/api/v3/edge/*`，`/api/v1/*` 仅 Prometheus 查询代理。

---

## 1. 当前有效文档

| 文档 | 用途 |
|------|------|
| [package-center-guide.md](package-center-guide.md) | 中心一体化交付包构建、目录、启动、升级与排障 |
| [frontend-backend-deploy-topology.md](frontend-backend-deploy-topology.md) | 前后端部署拓扑：当前单机 A2（相对路径 + metric-center 托管静态文件）、未来 nginx 反代 |
| [业务软件标准化目录与权限配置操作手册.md](业务软件标准化目录与权限配置操作手册.md) | 生产三目录基线：程序/种子、数据、日志与权限 |

## 2. 已归档

- [V2 E2E 测试与验收清单](../05-execution-records/archive/v2-e2e/) — 仅历史追溯，curl 动线为 v2，SQLite/MySQL 表述已过时。

## 3. 当前部署基线

- **程序/种子**：`/opt/apps/metric-center/`（只读）
- **数据**：`/opt/data/metric-center/`（TSDB、`config-output/` 活配置；元数据在外部 PostgreSQL）
- **日志**：`/opt/log/metric-center/`
- **数据库**：PostgreSQL 16（生产与测试同方言；SQLite 已移除）
- **启动**：交付包 `start.sh` 双模式（有 `env/env.sh` 走生产路径，否则解压即用）
- **健康检查**：`GET /api/v3/platform/health`（liveness）、`GET /api/v3/platform/ready`（DB + migration readiness）

> 生产目录与权限细节以 [业务软件标准化目录与权限配置操作手册.md](业务软件标准化目录与权限配置操作手册.md) 与 `package-center-guide.md` 为准。
