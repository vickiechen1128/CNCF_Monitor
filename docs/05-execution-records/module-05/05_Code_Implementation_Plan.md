# Module 05 首页 MVP 子集代码实施计划

> **模块**: Module 05 — 自定义前端门户  
> **PRD 版本**: v1.3  
> **PRD 状态**: `dev-ready`（Track B 增量 v1.3，2026-09-14 用户书面确认；原型验证豁免）  
> **计划版本**: v1.3  
> **日期**: 2026-09-14  
> **关联 PRD**: `docs/02-product-requirements/Modules/Module_05_Custom_UI.md` §1、§3 首页行、§3.1「首页（MVP 子集）交互契约」、§6 验收标准  
> **关联决策**: `docs/05-execution-records/module-05/design-decisions.md`「决策登记：2026-09-14（决策 72）」、「Track B 豁免记录」  

---

## 1. 范围

本次 L3 代码实施覆盖 **Module 05 首页 MVP 子集（决策 72）**，仅涉及前端页面与路由调整，**零后端改动**。

具体包括：

1. **既有统计卡保留**：`HomePage` 中继续展示 `/api/v2/platform/dashboard/summary` 返回的资源总数、待确认配置草稿数、已纳管网域数（PRD §3.1）。
2. **告警状态数字区新增**：在统计卡下方新增告警状态卡，主数字为 Alertmanager 治理态「通知中」，次要行为已静默 / 已抑制，并列小字展示 Prometheus firing / pending；未挂载 AM 通知配置时显示空态引导（PRD §3.1、§6）。
3. **系统快速入口区新增**：在告警卡下方新增核心功能页快捷卡片（资源管理 / 采集 Job / 配置预览下发 / 指标查询 / 告警状态），点击深链到对应路由（PRD §3.1、§6）。
4. **使用指引区新增**：在快速入口下方新增五步开箱动线（登记网域 → 导入资源 → 建采集 Job → 下发 → 查指标），每步配深链与完成态标识；第 5 步「查指标」深链 `/query`（PRD §3.1、§6）。
5. **既有「最近下发」表保留**：继续展示 `dashboard.summary.recent_deployments` 前 5 条。
6. **`/query` 路由落地**：`App.tsx` 新增 `<Route path="/query" element={<QueryPage />} />`，使使用指引第 5 步可跳转（PRD §3.1）。
7. **`HomePage.test.tsx` 同步**：mock `alertStatusApi` 两个告警接口，补充告警数字、空态引导、快速入口、使用指引第 5 步深链的断言；同步 `/query` 路由的测试影响（本节无，但 App.test.tsx 若有路由表测试需关注）。

**明确不做（决策 72 豁免）**：

- 轻量实时图表、采集覆盖率聚合卡片（v0.3）。
- 「进入可视化大屏」快捷入口（v0.3）。
- Grafana iframe 嵌入与预置仪表盘模板（v0.3，决策 51）。

---

## 2. 关键判断与假设

### 2.1 决策 72 要点

- **首页 MVP 子集提前**：原决策 51 的 v0.3 首页两阶段交付拆分为 MVP 子集 + v0.3 增强；MVP 子集仅含系统快速入口、使用指引、告警状态数字，保留既有统计卡与最近下发表（PRD §1、§3.1）。
- **告警数字方案 A（零后端改动）**：前端直接调用既有只读接口 `alertStatusApi.getPromAlerts()` 与 `alertStatusApi.getAlertmanagerAlerts()`，取返回数组长度计数；`platform/dashboard/summary` 保持纯 GORM 聚合，不引入 Prometheus 代理调用（PRD §3.1；design-decisions.md 决策 72 结论 2）。
- **数字口径**：主数字 = AM 治理态「通知中」（`notify_status === 'active'`），次要行 = 已静默（`silenced`）/ 已抑制（`inhibited`），Prom 当前触发（firing / pending）作并列小字或 tooltip（PRD §3.1；design-decisions.md 决策 72 结论 3）。
- **空态引导**：未挂载 AM 通知配置时 `alerting:` 段不生成（决策 68-2），AM 数字恒为 0；卡片展示「尚未挂载通知配置，去配置 →」深链 M08 告警配置，把 0 转化为引导动线（PRD §3.1；design-decisions.md 决策 72 结论 3）。
- **配套项**：`QueryPage` 挂入 `/query` 路由，使用指引第 5 步深链落地（PRD §3.1；design-decisions.md 决策 72 结论 4）。
- **菜单联动预留**：若后续采纳「告警中心（治理视图）vs 触发排障」拆菜单方案，首页告警卡跳转目标指向治理视图；当前先指向 `/alert-status`（M08 v1.12 已上线页面），避免二次改动（PRD §3.1；design-decisions.md 决策 72 结论 5）。

### 2.2 方案 A 零后端改动

- 不新增后端接口、不修改 `platform/cmd/metric-center`、不调整 `dashboard/summary` 聚合逻辑。
- 告警计数完全由前端在前置 `useEffect` 中并发请求后本地计算。

### 2.3 AM 治理态主数字

- AM 通知四态由服务端归一（`active` / `silenced` / `inhibited` / `unprocessed`），前端只按 `notify_status` 分组计数，不做额外业务映射（类型定义见 `src/types/alertmanager.ts`）。
- 「通知中」仅统计 `active`；`unprocessed` 数量较小，本次按 PRD 描述不单独展示，若需可在 tooltip 中补充。

### 2.4 空态引导

- 判定条件：AM 接口返回 `items.length === 0` 且 Prom 接口返回 `alerts.length === 0` 时，展示空态引导文案。
- 深链目标：`/alert-config`（M08 告警配置挂载页），与「去配置」按钮语义一致。

### 2.5 Track B 原型验证豁免

- 本增量为 Track B，高保真原型验证豁免；开发以 PRD §3.1 交互契约 + §6 验收清单为基准（design-decisions.md「Track B 豁免记录」）。
- 开发完成后需按 Track B 回填要求把 PRD 反向同步为 as-built，状态补登 `ready`。

---

## 3. 任务拆分

任务 ID 与 `task-sequence.yaml` 一一对应，按代码执行顺序排列。

| ID | 标题 | 输出文件 | 依赖 |
|----|------|----------|------|
| M05-T1 | HomePage 结构重构：分离统计卡、告警数字卡、快速入口区、使用指引区、最近下发表 | `src/pages/home/HomePage.tsx` | — |
| M05-T2 | 新增告警数字卡：调用 `alertStatusApi` 两个接口，展示主数字/次要行/小字，加空态引导 | `src/pages/home/HomePage.tsx` | M05-T1 |
| M05-T3 | 新增系统快速入口区组件与深链 | `src/pages/home/HomePage.tsx`（或拆出 `QuickAccess.tsx`） | M05-T1 |
| M05-T4 | 新增使用指引区组件（五步，第 5 步深链 `/query`） | `src/pages/home/HomePage.tsx`（或拆出 `OnboardingSteps.tsx`） | M05-T1 |
| M05-T5 | `App.tsx` 挂 `/query` 路由 | `src/App.tsx` | — |
| M05-T6 | `HomePage.test.tsx` 同步：mock 告警接口与路由断言 | `src/pages/home/HomePage.test.tsx` | M05-T2、M05-T3、M05-T4 |
| M05-T7 | 全量 lint/build 验证 | — | M05-T5、M05-T6 |

---

## 4. 风险与依赖

### 4.1 与 M08 AM 配置挂载状态的依赖

- 首页告警数字的空态引导依赖「AM 通知配置未挂载时 AM 接口恒返回 0」这一状态，由决策 68-2 保证：`alerting:` 段在 AM 配置已挂载且 `--alertmanager.url` 可解析时才生成。
- **风险**：若 M08 后端在 AM 未挂载时接口行为变化（例如报错而非返回空数组），首页需额外错误处理。当前契约约定空结果返回 `[]` / `{ items: [] }`（见 `src/types/alertmanager.ts`）。

### 4.2 与决策 68-2 alerting 段生成的依赖

- 空态引导的文案依据决策 68-2： alerting 段生成条件 = AM 配置已挂载 + URL 可解析。
- **风险**：若后续决策调整生成条件，空态引导判定逻辑可能需要同步修改。

### 4.3 与 M02 `/api/v1/alerts` / `/api/v2/platform/alertmanager/alerts` 稳定性的依赖

- 两个接口均由 M08/M02 实现并已在 `alertStatusApi` 中封装（`src/api/alertmanager.ts`）。
- **风险**：接口字段变化（如 `AmAlertsData` 从 `{ items }` 改为 `{ list }`）会导致计数错误。当前契约以 M08 `api-contract-snapshot.md` 为第一权威。

### 4.4 路由 `/query` 与 M02 路由的冲突

- `/query` 为新增页面级路由，指向 `QueryPage`。
- **风险排查**：当前 `App.tsx` 中不存在 `/query`；M02 相关路由为 `/targets`（TargetStatusPage），无冲突。未来 M02 若新增 `/query*` 子路由需协调。

### 4.5 页面状态处理

- 需覆盖：加载中（骨架屏 / Spin）、空态（无数据引导）、接口错误（`message.error` + 保留旧数据 / 错误提示）、AM 未挂载空态（引导去配置）。按 `02_Frontend_Standard.md` §10 执行。

---

## 5. 变更文件清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `ui-custom/web/src/pages/home/HomePage.tsx` | 修改 | 重构页面结构，新增告警数字卡、快速入口区、使用指引区 |
| `ui-custom/web/src/App.tsx` | 修改 | 新增 `/query` 路由，懒加载或直接导入 `QueryPage` |
| `ui-custom/web/src/pages/home/HomePage.test.tsx` | 修改 | mock `alertStatusApi`，补充新区域断言 |
| `ui-custom/web/src/pages/home/QuickAccess.tsx`（可选） | 新增 | 若从 HomePage 拆出快速入口区组件 |
| `ui-custom/web/src/pages/home/OnboardingSteps.tsx`（可选） | 新增 | 若从 HomePage 拆出使用指引区组件 |

**不修改**：

- `ui-custom/web/src/api/alertmanager.ts`（已有 `alertStatusApi`，直接使用）。
- `ui-custom/web/src/types/alertmanager.ts`（类型已完备）。
- `ui-custom/web/src/api/dashboard.ts`（`dashboard/summary` 不变）。
- 任何 `platform/` 后端文件。

---

## 6. 提交前验证命令

以单文件测试为主，逐步扩展到全量：

```bash
# 1. 进入前端目录并安装依赖
cd ui-custom/web
pnpm install

# 2. 单文件测试（开发期每个 task 必须）
pnpm vitest run src/pages/home/HomePage.test.tsx

# 3. 全量测试（Phase 收尾 / 合并前 / CI）
pnpm test

# 4. Lint
pnpm lint

# 5. 生产构建类型检查与打包
pnpm build

# 6. 可选：本地 dev server 启动并访问首页与 /query
# exec ./node_modules/.bin/vite --host
# curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/
# curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/query
# 验证完成后停止服务释放端口
```

> 注：用户要求的标准命令 `pnpm test --run HomePage.test.tsx` 与项目实际命令 `pnpm vitest run src/pages/home/HomePage.test.tsx` 等价；实际执行时以 `package.json` 脚本定义为准。

---

## 7. 增量验收清单（Track B 必填）

以下条目对应 PRD §6 验收标准，仅列出本次 MVP 子集增量有效项。

| PRD 验收条目 | 本次增量有效性 | 验证方式 |
|--------------|----------------|----------|
| §6 {MVP，决策 72，P0} 首页提供系统快速入口区（资源管理 / 采集 Job / 配置预览下发 / 指标查询 / 告警状态快捷卡片），点击可正确跳转对应页面 | ✅ 有效 | HomePage.test.tsx 断言卡片存在且链接 href 正确；dev server 手动点击验证 |
| §6 {MVP，决策 72，P0} 首页提供使用指引区，按五步开箱动线展示并配深链；第 5 步「查指标」深链 `/query` 查询页 | ✅ 有效 | HomePage.test.tsx 断言步骤文案与第 5 步链接；访问 `/query` 路由返回 200 |
| §6 {MVP，决策 72，P0} 首页展示告警状态数字：主数字为 AM 治理态「通知中」，次要行为已静默 / 已抑制，并列展示 Prom firing/pending；数据来自前端直调 `/api/v1/alerts` 与 `/api/v2/platform/alertmanager/alerts` 计数，无新增后端接口；未挂载 AM 通知配置时展示空态引导 | ✅ 有效 | HomePage.test.tsx mock 两个告警接口并断言主数字 / 次要行 / 小字 / 空态引导；network 面板确认无新增后端请求 |
| §6 {MVP，决策 72} 首页不提供「进入可视化大屏」快捷入口与轻量实时图表 | ✅ 有效（负向验收） | HomePage.test.tsx 断言不存在「可视化大屏」相关文案；dev server 首屏无大屏入口 |
| §6 {v0.3，决策 51} 可视化大屏页作为一级菜单可正常 iframe 嵌入 Grafana | ❌ 本次不做 | 不验证 |
| §6 {v0.3，决策 51} 首页升级为概览 Dashboard 并提供「进入可视化大屏」快捷入口 | ❌ 本次不做 | 不验证 |
| §6 {v0.3，决策 51} 可视化大屏页提供「配置告警」深链 | ❌ 本次不做 | 不验证 |

---

## 8. 提交 Commit 信息建议

```
M05: 首页 MVP 子集（决策 72）前端实现计划

- 关联执行记录: docs/05-execution-records/module-05/05_Code_Implementation_Plan.md
- 关联决策: docs/05-execution-records/module-05/design-decisions.md（决策 72 / Track B 豁免）
- 变更范围: ui-custom/web/src/pages/home/HomePage.tsx、App.tsx、HomePage.test.tsx
- 计划版本: v1.3（Track B 增量，零后端改动）
```
