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

---

## 待决

- [ ] 旧数据是否迁移（按模块定：`none` / `backfill` / `dual-write`）。
- [ ] 各模块 API v3 路径与旧 v2 的映射表。
- [ ] 模块重写顺序与里程碑确认。
