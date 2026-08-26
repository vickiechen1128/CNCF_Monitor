# frontend-developer 执行记录 — Module_01（MVP）

> 归属：MetricCenter 前端开发（frontend-developer）
> 范围：`ui-custom/web/` 策略域页面（采集 Job / 规则等）的验收修复记录。

## 2026-08-26（user-verify-fix）

### 采集 Job 启停操作可发现性 + 二次确认；规则挂载提交默认启用

#### 问题
1. 用户验收反馈：采集 Job 列表的启用/停用是一个挤在操作列里的小号无文字 `Switch`，显示不明显，且点击直接生效无确认。M01 PRD（破坏性操作二次确认）要求禁用 Job 前弹确认并提示影响范围。
2. 规则挂载抽屉按钮文案「保存并下发」名不副实（实际只到 M09 变更单 pending，下发需人工确认），且创建请求漏传 `enabled`，叠加后端零值导致规则保存后变「停用」（后端修复见 `backend-developer.md`）。

#### 修复
- `src/pages/strategy/ScrapeJobListPage.tsx`：
  - 启停控件由小号无文字 `Switch` 改为有文字链接按钮「停用」（danger）/「启用」，与「编辑/删除」按钮风格一致，提升可发现性；
  - 增加 `Popconfirm` 二次确认：停用提示「将从下发配置中移除，相关监控中断；需到配置变更页确认后生效」，启用提示「将重新纳入配置下发」；okText「确认停用/确认启用」（停用 danger）。
  - `change_status=pending` 的禁用守卫（决策 44-1）保持不变。
- `src/pages/strategy/RuleMountDrawer.tsx`：
  - 创建请求显式携带 `enabled: true`（M01 PRD §8「创建默认启用」，与采集 Job 抽屉 `ScrapeJobFormDrawer.buildBody` 口径对齐）；
  - 按钮文案「保存并下发」→「提交生效」（与采集 Job 抽屉一致；成功提示仍引导「变更将由 M09 生成变更单并下发」）。

#### 新增/修改测试
- `ScrapeJobListPage.test.tsx`：
  - 既有「pending 禁用守卫」用例的 `getAllByRole('switch')` 改为按「停用」按钮断言；
  - 新增「停用需 Popconfirm 二次确认」用例：点击「停用」仅弹确认（提示监控中断、不调接口），点「确认停用」后才以 `enabled: false` 调用 update。
- `RuleMountDrawer.test.tsx`：按钮文案断言改为「提交生效」；创建断言补 `enabled: true`。

#### 验证
- `pnpm vitest run`（ScrapeJobListPage / RuleMountDrawer / RulesPage）18 个用例通过；`pnpm lint` 通过；`pnpm test` 全量 317/318 通过，唯一失败 `src/api/resources.test.ts`（`new Response(blob)` 在 jsdom 环境 `object.stream is not a function`）为本次改动前已存在的问题，与本次修复无关。
