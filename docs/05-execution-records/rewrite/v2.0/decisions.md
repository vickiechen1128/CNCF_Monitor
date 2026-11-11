# MetricCenter v2.0 重写决策记录

> 本文件记录 rewrite 期的产品 / 架构 / 契约决策；不建 CR。
> 跨模块契约、数据迁移、安全敏感面变更必须在此登记，并同步对应 PRD / API 快照。

| # | 日期 | 决策 | 结论 | 影响 |
|---|---|---|---|---|
| D1 | 2026-11-10 | 分支模型 | 使用 `rewrite/v2.0`，旧版本归档不维护 | Gitflow / Agent Skill |
| D2 | 2026-11-10 | API 版本 | 新线统一 `/api/v3/platform/*`；旧 `/api/v2/*` 归档 | 前后端 / 契约快照 |
| D3 | 2026-11-10 | 计划重量 | 轻量 `plan.md` + 模块 `task-sequence.yaml`，不跑完整 L2 矩阵 | Planner / Orchestrator |
| D4 | 2026-11-10 | PRD 定位 | 新 PRD 为 living document；旧 PRD 仅参考 | PRD / 原型 |
| D5 | 2026-11-10 | schema | 允许直接演进；必须 migration + 回滚 + 数据对账 | 后端 / DB |
| D6 | 2026-11-10 | M07 数据模型 | `resources` 主表 + 六类扩展表；`resource_id` 全局主键；`dedup_key` 唯一；字典 FK；`cloud_code` 不落资源表 | 后端 / DB |
| D7 | 2026-11-10 | 旧数据 | **不迁移**；v3 从新 schema 开始；旧库仅备份/归档 | DB / 迁移 |
| D8 | 2026-11-10 | API v3 | 资源响应采用公共字段 + `attributes` 嵌套；分页默认 20、上限 100 | 前后端 / 契约 |
| D9 | 2026-11-10 | 安全 / 审计 | `connection_string` 改为 secret ref 或加密存储；纳入 `resource_audit_logs` | 后端 / 安全 |
| D10 | 2026-11-10 | v2 保留 | v2.0 发布后保留一个版本兼容窗口，再删除旧 v2 包 | Gitflow / 发布 |
| D11 | 2026-11-10 | 数据库目标 | **PostgreSQL 为 v3 生产目标；SQLite 仅开发/测试**；旧 v2 继续 SQLite | 后端 / 部署 / CI |
| D12 | 2026-11-11 | v3 schema 归属 | M00 拥有共享参考 / 身份表 baseline（`00000_m00_platform_core`，版本 0）；业务语义归 M06/M03；迁移文件按 dialect 后缀加载（`.sqlite.sql` / `.postgres.sql`）；不引入 goose 依赖，保留其标记 | 后端 / DB / 迁移 |
| D13 | 2026-11-11 | 启动模式 | 默认 `legacy`（旧 v2 功能面 + 增量 v3 迁移）；`METRIC_CENTER_DB_MODE=v3` 或 `--database.mode=v3` 启用 v3-only（`InitV3` + `CoreV3` seed + 模块注册表，不挂 `/api/v2`、不启动旧后台任务） | 后端 / 部署 / 运维 |
| D14 | 2026-11-11 | 过渡期认证 | v3-only 模式复用 legacy auth handler 适配为 `auth` 模块，登录 `POST /api/v3/platform/auth/login`；M03 v3 模块落地后替换，路径不变 | 后端 / 安全 |

---

## 待决

- [ ] 各模块 API v3 路径与旧 v2 的映射表（B0-2）。
- [ ] 模块重写顺序与里程碑确认。
