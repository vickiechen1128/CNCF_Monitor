# MetricCenter v2.0 版本重写章程（rewrite/v2.0）

> **状态**：approved（2026-11-10，chenrt 确认）
> **分支**：`rewrite/v2.0`
> **基线**：`develop` @ `5dc058d`（旧版本基线；tag `v1.0.0` 保留）
> **定位**：全模块下一代版本重写，不是单模块代码重构，也不是产品线分叉。
> **工作方式**：Vibe Coding 主导；PRD + 代码 + DB schema 在同一分支演进；轻量计划 + 关键门禁，不跑完整 L2 矩阵。
> **目标**：把项目级工具产品重写为可移交给正式开发团队的 v2.0。

---

## 1. 为什么重写

- 旧版本是项目级工具产品，保留价值有限；不维护第二条产品线。
- 旧 PRD 作为参考，不作为兼容包袱；新 PRD 从业务原始需求重新推导。
- 旧版本通过 tag 归档；`rewrite/v2.0` 是唯一活跃开发线。
- 重写过程同时沉淀产品设计、工程规范、测试与交接资产。

---

## 2. 范围

**在**：

- 全模块 PRD 优化与重写（M00–M11，按依赖排序）。
- 代码重构 / 功能重开发。
- DB schema 演进（允许直接修改，但必须可迁移、可回滚、可对账）。
- API 契约升级：新线统一使用 `/api/v3/platform/*`；旧线 `/api/v2/*` 归档。
- 测试、审查、handover 文档。

**不在**：

- 维护旧版本产品线（仅保留 tag / 分支快照）。
- 为旧 API 做长期向后兼容（除非某个模块明确要求）。
- 完整 L2 实施地图矩阵（改用 `plan.md` + 模块 task-sequence）。
- 一次性重写所有模块；按模块顺序推进，每模块独立验收。

---

## 3. 分支与基线

```text
旧版本（归档，不维护）
  develop
  design/module-mvp-demo
  tag: v1.0.0 / legacy/m07-v1.0

新版本（唯一活跃线）
  rewrite/v2.0
  rewrite/v2.0-module-XX   # 可选，短期并行，合回 rewrite/v2.0
  tag: v2.0-m0 / v2.0-m1 / v2.0-rc
```

规则：

- `rewrite/v2.0` 从 `develop` 切出，长期存在至 v2.0 发布。
- 旧 `develop` 不再接收新功能；只允许必要的生产 hotfix（cherry-pick 到 `rewrite/v2.0`）。
- 模块并行时使用 `rewrite/v2.0-module-XX`，完成后合回 `rewrite/v2.0` 并删除。
- 发布时 `rewrite/v2.0` `--no-ff` 合回 `develop`，打 `baseline/v2.0`，旧版本 tag 保留。

---

## 4. 工作流（R0–R6）

| 阶段 | 内容 | 关键产物 | 门禁 |
|---|---|---|---|
| R0 基线 | 冻结旧版、打 tag、建章程 | `charter.md` | 旧基线可回退 |
| R1 业务需求 | 从原始业务需求重写 | `business-requirements.md` | 业务目标 / 用户 / 场景 / 非目标确认 |
| R2 PRD v2 | 新 PRD、数据模型、API 契约 | `Module_XX_*.md`、`api-contract-snapshot.md` | PRD 评审通过 |
| R3 重写计划 | 模块顺序、依赖、里程碑 | `plan.md`、模块 `task-sequence.yaml` | 计划评审通过 |
| R4 模块重写 | PRD 增量 → 代码 → 测试 → 审查 | 模块代码 / 测试 / 执行记录 | 模块验收 + 代码审查 |
| R5 集成回归 | 旧 vs 新行为矩阵、迁移对账、E2E | `regression.md`、`migration.md` | 回归通过 |
| R6 交接发布 | handover 文档、runbook、onboarding | `handover.md` | handover checklist 全绿 |

### 关键门禁

- **G1 业务需求**：业务目标、用户、场景、非目标明确；用户确认。
- **G2 PRD/架构**：数据模型、API、验收标准可实施；跨模块契约登记。
- **G3 模块代码**：目标测试 + lint/vet + 服务启动 + 代码审查通过。
- **G4 集成回归**：旧版关键行为对照、迁移 up/down、数据对账、E2E 通过。
- **G5 交接**：PRD、架构、API、迁移、runbook、onboarding、known issues 完整。
- **G6 发布**：chenrt 批准，`rewrite/v2.0` 合回 `develop` 并打 tag。

---

## 5. 角色与权限

| 角色 | 职责 | 写权限 |
|---|---|---|
| chenrt（产品 Owner / Orchestrator） | 业务需求、PRD、范围、验收、合并 | `docs/02-product-requirements/`、`docs/05-execution-records/rewrite/`、合并操作 |
| backend-developer | Go 代码、schema、测试 | `platform/` |
| frontend-developer | React 代码、测试 | `ui-custom/web/` |
| reviewer | 独立审查 | 只读 |
| prototype-designer（可选） | 原型 / PRD 辅助 | `docs/prototypes/`、PRD（任务卡授权时） |

> rewrite 模式下不再强制设计空间 / 开发空间分离；PRD 与代码同分支演进。开发者不得自行改 PRD；PRD 变更由 chenrt 或任务卡授权的角色执行。

---

## 6. 数据与 schema 策略

- **先定旧数据是否迁移**：每个模块在 R4 前必须明确 `data_migration: none | backfill | dual-write`。
- 不迁移：v2.0 从空库 + seed 开始；在模块计划中写明。
- 要迁移：migration + backfill + 数据对账 + 回滚方案。
- 一次 schema 变更 = 一个独立 commit + 一个 migration 文件（Up/Down）+ schema changelog 一行。
- schema commit 与代码搬移 / 功能 commit 分开。
- API 变更与 schema 变更分开提交，便于回滚和审查。
- migration 工具链（goose 或等价）在 R0/R1 接入；未接入前，在空库 + 旧基线副本上人工执行并记录结果，不能只依赖 `AutoMigrate`。

---

## 7. Handover 标准

v2.0 完成不仅是“能跑”，还必须：

- [ ] 新 PRD ready，业务需求可追溯。
- [ ] 架构图、数据模型、API 契约快照。
- [ ] 单元 / 集成 / E2E 测试与覆盖率。
- [ ] migration / 回滚 / 部署 runbook。
- [ ] 安全审查（认证、鉴权、密钥、配置下发、SSRF）。
- [ ] R1–R4 / lint / vet 通过。
- [ ] README / onboarding / 已知问题 / roadmap。
- [ ] 旧版本基线 tag 与差异说明。

---

## 8. 变更与决策

- rewrite 期内不建 CR；所有产品 / 架构决策写入 `docs/05-execution-records/rewrite/v2.0/decisions.md`。
- PRD 版本按里程碑递增；旧版本 PRD 通过 git tag / 历史 commit 追溯。
- 跨模块契约变更必须在 `decisions.md` 登记，并同步对应模块 PRD / API 快照。
- 旧版本 `design/module-mvp-demo` 保持只读，不再作为 v2.0 的 PRD 输入源。

---

## 9. 退出方式

1. R5 回归通过。
2. R6 handover checklist 全绿。
3. chenrt 批准。
4. `git merge --no-ff rewrite/v2.0` 到 `develop`。
5. 打 annotated tag `baseline/v2.0`（消息含模块 PRD 版本 + 验收日期）。
6. 保留 `v1.0.0` / `legacy/m07-v1.0`；删除 `rewrite/v2.0-module-XX` 临时分支。
