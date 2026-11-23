# MetricCenter v2.0 重写计划（轻量版）

> **状态**：draft
> **分支**：`rewrite/v2.0`
> **章程**：`docs/05-execution-records/rewrite/v2.0/charter.md`
> **说明**：本计划替代完整 L2 实施地图矩阵；保留模块顺序、依赖、里程碑与关键门禁。
> **数据库**：PostgreSQL-only（生产 / 开发 / 测试统一，v3 迁移均为 `*.postgres.sql`）；SQLite 与双模式启动已移除。

---

## 1. 阶段计划

| 阶段 | 状态 | 说明 | 产物 |
|---|---|---|---|
| R0 基线 | done | 旧版 `v1.0.0` / `develop` @ `5dc058d` 归档；分支 `rewrite/v2.0` 建立 | `charter.md` |
| R1 业务需求 | todo | 从原始业务需求重写；明确用户 / 场景 / 非目标 | `business-requirements.md` |
| R2 PRD v2 | todo | 按模块重写 PRD；数据模型 + API v3 契约 | `Module_XX_*.md`、`api-contract-snapshot.md` |
| R3 重写计划 | doing | 本文档 + 模块 task-sequence | `plan.md` |
| R4 模块重写 | todo | 按模块顺序推进；每模块独立验收 | 代码 / 测试 / 执行记录 |
| R5 集成回归 | todo | 旧 vs 新行为矩阵、迁移对账、E2E | `regression.md`、`migration.md` |
| R6 交接发布 | todo | handover、runbook、onboarding | `handover.md` |

---

## 2. 模块顺序（草案）

> 顺序按依赖关系排列，具体以 R2/R3 评审为准。M07 为当前已启动模块。

| 顺序 | 模块 | 状态 | 备注 |
|---|---|---|---|
| 1 | M00 基础设施 / 数据模型 | done | 共享错误/迁移 runner/00000 core baseline/seed/模块注册表/system 端点完成；**PostgreSQL-only**（测试逐 schema 隔离，`make test-platform` 全绿），双模式启动与 SQLite 方言已移除 |
| 2 | M07 监控对象管理 | doing | 前端 Phase 1 + 后端 B0–B6 完成；v3 标签模板（`m07_label_templates` + CRUD，00007）已补；遗留 S-1/S-3/S-6（多租户、secret ref、审计写链路）待后续关闭 |
| 3 | M06 多租户 / 网域 | done | 后端 B0–B6 完成；租户/网域/用户/登录日志/存储 v3；PG 迁移与 NFR-10 压测 open |
| 4 | M01 指标采集中心 | doing（P1–P6 + F1 + D-3 完成：后端全链路 + 前端 v3 契约层；待 F4 测试门禁/残留清理（labelTemplates）、F2 列级清理、凭证加密（单独排期）与 B8） | 依赖 M07 / M06 / M09；产物见 `modules/module-01/`（assessment + api-contract-snapshot-v3 + task-sequence + backend-execution + frontend-execution）；D-1/D-2/D-3/D-4/D-5 已闭环，凭证加密单独排期 |
| 5 | M09 网域接入与查询中心 | doing（后端 B0–B7 + 后台调度 + A1-1/A1-2 完成；V1 回归待执行） | 合并原 M09/M11/M02；依赖 M01 / M06 / M07 / M08；产物见 `modules/module-09/`；B0 决策 D23–D33 已登记、SRS 升至 v1.2（注入标签统一 network_domain_id）；00005 迁移已落地（PG 全量测试通过）；B2 骨架、B3 纳管/Token、B4 心跳/节点/edge config、B5 configgen+快照同步、B6 targets/coverage/PromQL 代理、B7 离线包已落地；维护循环与配置 watcher 已接入 v3 bootstrap；agent 已适配 v3 协议（zip 配置包 + If-None-Match）且主循环迁入 internal/app；M01 源接入、V1 回归待后续 |
| 6 | M02 指标查询中心 | todo | 依赖 M00 |
| 7 | M08 告警 | doing（**后端 B0–B8 完成**：00009 迁移、m08 分层模块、生成器+amtool 校验、内部 Reload、事件对账、静默审计、抑制检索、M09 快照接线；`go test ./platform/...` 69 包全绿 + v3 启动冒烟通过；**前端 F1 完成**：API 适配层 + 路由/抑制页适配，`tsc`/`vitest` 393 例/scoped eslint 全绿） | 依赖 M01 / M09；产物见 `modules/module-08/`（assessment + 契约 + acceptance + task-sequence + backend-execution）；D44 三维聚合 / D45 凭据加密延后；SRS v1.4 待 owner 签字冻结 |
| 8 | M05 自定义 UI / 看板 | todo | 依赖 M02 / M08 |
| 9 | M03 / M04 / M10 / M11 | todo | 按实际范围排期 |

---

## 3. 当前里程碑

| 里程碑 | 内容 | 完成标准 | tag |
|---|---|---|---|
| M0 基线 | 章程、旧版归档、分支建立 | 章程 approved | `v2.0-m0`（待打） |
| M1 需求 / PRD 基线 | 业务需求 + M00/M07 PRD v2 | G1/G2 通过 | `v2.0-m1` |
| M2 核心模块 | M00 / M07 / M06 / M01 | 模块验收 + 审查 | `v2.0-m2` |
| M3 配置 / 查询 / 告警 | M09 / M02 / M08 | 集成回归 | `v2.0-m3` |
| M4 交接候选 | handover + 全量回归 | G5/G6 通过 | `v2.0-rc` |

---

## 4. 模块任务模板

每个模块在 `modules/module-XX/` 下至少包含：

```text
assessment.md        # 现状、债务、重写范围
task-sequence.yaml   # 轻量任务序列（mode: rewrite）
acceptance.md        # 验收标准（功能 / 数据 / 迁移 / 回归）
```

任务字段：

```yaml
mode: rewrite
module: module-XX
milestone: v2.0-mX
schema_change: none | additive | breaking
migration_files: []
data_migration: none | backfill | dual-write
api_version: v3
legacy_baseline: "v1.0.0"
```

---

## 5. 门禁检查

- G1：业务需求确认（chenrt）。
- G2：PRD / 数据模型 / API 契约评审。
- G3：模块测试 + lint/vet + 服务启动 + 代码审查。
- G4：旧 vs 新行为矩阵 + migration up/down + 数据对账 + E2E。
- G5：handover checklist 全绿。
- G6：chenrt 批准 + `--no-ff` 合并 + `baseline/v2.0` tag。

---

## 6. 当前聚焦：M06 完成 → M01

- M00 评估：`modules/module-00/assessment.md`
- M00 任务：`modules/module-00/backend-task-sequence.yaml`
- M07 前端评估：`modules/module-07/assessment.md`
- M07 前端任务：`modules/module-07/task-sequence.yaml`
- M07 后端评估：`modules/module-07/backend-assessment.md`
- M07 后端任务：`modules/module-07/backend-task-sequence.yaml`
- M06 评估：`modules/module-06/assessment.md`
- M06 任务：`modules/module-06/backend-task-sequence.yaml`
- M06 契约：`modules/module-06/api-contract-snapshot-v3.md`
- M01 评估 / 重构计划：`modules/module-01/assessment.md`
- M01 契约：`modules/module-01/api-contract-snapshot-v3.md`
- M01 任务：`modules/module-01/task-sequence.yaml`
- 下一步：M01 P1（schema + seed + 骨架）；M03 替换过渡期 auth 适配器。
- 注意：原“行为等价 / 不改 schema / 不改 PRD”约束已失效；以本计划与章程为准。
