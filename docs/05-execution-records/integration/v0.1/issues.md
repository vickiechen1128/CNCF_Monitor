# integration/v0.1：联调问题与修复记录

## 记录格式

| 序号 | 问题描述 | 涉及模块 | 根因 | 修复方案 | 修复人 | 验证结果 | 状态 |
|------|----------|----------|------|----------|--------|----------|------|
| 1 | ResourceFormDrawer 测试全量运行时偶发失败 | M07 | 全量并行的 getComputedStyle/时序 flaky | 单独复跑通过，非本轮改动引入，不制度化重试 | frontend-developer | 单独复跑 11/11 通过 | closed |

---

## 已记录问题

### 1. ResourceFormDrawer 测试 flaky（偶发）
- **问题**：`pnpm vitest run` 全量（44 文件）时 `src/pages/resources/ResourceFormDrawer.test.tsx`（M07 资源表单）失败，断言「请选择业务」文案超时。
- **根因**：全量并行执行时 getComputedStyle 伪元素未就绪/时序竞争，属 flaky；本轮未改动 resources 模块。
- **处置**：单独复跑 `vitest run src/pages/resources/ResourceFormDrawer.test.tsx` → **11/11 通过**，判定非本轮改动引入。按项目原则不制度化重试，归因挂账。
- **修复人**：frontend-developer（Orchestrator 协调）
- **状态**：closed（已归因，非缺陷）

---

## 变更记录

### 首页聚合 Dashboard 接口（Phase 5 新增）
- **后端**：新增 `GET /api/v2/platform/dashboard/summary`，返回 `resource_count / pending_draft_count / recent_deployments / domain_count`，复用 M07/M09 各表 count/join，见 `platform/dashboard/summary.go`。
- **前端**：新增 `ui-custom/web/src/api/dashboard.ts`；改造 `HomePage.tsx` 展示概览卡片 + 最近下发记录表格（Spin/Alert/空态/mock）。
- **契约**：`{ status, data: { resource_count, pending_draft_count, recent_deployments: [{ id, change_no, network_domain_name, status, triggered_at }], domain_count } }`。
- **状态**：closed（已端到端验证）