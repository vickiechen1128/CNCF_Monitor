# MetricCenter v2.0 重写计划（轻量版）

> **状态**：draft
> **分支**：`rewrite/v2.0`
> **章程**：`docs/05-execution-records/rewrite/v2.0/charter.md`
> **说明**：本计划替代完整 L2 实施地图矩阵；保留模块顺序、依赖、里程碑与关键门禁。
> **数据库**：PostgreSQL 为 v3 生产目标；SQLite 仅开发/测试；旧 v2 继续 SQLite。

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
| 1 | M00 基础设施 / 数据模型 | todo | 先定共享模型、迁移工具链（goose 或等价）、API v3 基础 |
| 2 | M07 监控对象管理 | doing | 前端 Phase 1 已拆解；后端 B0/B1 全部完成（PG 目标 + 可移植 schema）；B2 domain/repository 待推进 |
| 3 | M06 多租户 / 网域 | todo | 依赖 M00 数据模型 |
| 4 | M01 指标采集中心 | todo | 依赖 M07 / M06 |
| 5 | M09 配置中心 / 下发 | todo | 依赖 M01 / M06 |
| 6 | M02 指标查询中心 | todo | 依赖 M00 |
| 7 | M08 告警 | todo | 依赖 M01 / M09 |
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

## 6. 当前聚焦：M07

- 前端评估：`modules/module-07/assessment.md`
- 前端任务：`modules/module-07/task-sequence.yaml`
- 后端评估：`modules/module-07/backend-assessment.md`
- 后端任务：`modules/module-07/backend-task-sequence.yaml`
- 注意：原“行为等价 / 不改 schema / 不改 PRD”约束已失效；以本计划与章程为准。
