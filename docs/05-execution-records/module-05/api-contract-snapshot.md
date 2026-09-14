> **模块**: Module 05 — 自定义前端门户  
> **PRD 版本**: v1.5  
> **计划版本**: v1.5（对应 `05_Code_Implementation_Plan.md` / `task-sequence.yaml`）  
> **日期**: 2026-09-14  
> **说明**: 首页 MVP 子集（决策 72 / 72-1 / 72-2）为前端增量，仅消费既有接口并在前端本地计数；**决策 72-3（v1.5）放宽该约束**——`dashboard/summary` 新增 3 个计数字段（增字段、向后兼容），仍**不新增接口**。本快照记录前端任务消费的既有 API 契约、新增前端路由与页面级深链。

---

## 1. 既有后端 API 消费清单

### 1.1 GET /api/v2/platform/dashboard/summary

- **用途**: 首页既有平台统计卡与最近下发记录。
- **消费位置**: `ui-custom/web/src/api/dashboard.ts`（`dashboardApi.getSummary`）。
- **本次变更（决策 72-3，v1.5）**: **新增 3 个计数字段**（增字段、向后兼容；已落地于 `platform/dashboard/summary.go`）；`resource_count` / `pending_draft_count` / `domain_count` / `recent_deployments` 语义不变。前端 `src/api/dashboard.ts` 的 `DashboardSummary` 同步补 3 字段。
- **请求**: 无参数。
- **响应结构**（统一 `ApiResponse<DashboardSummary>`）：

```ts
interface DashboardSummary {
  resource_count: number
  pending_draft_count: number
  domain_count: number
  recent_deployments: RecentDeployment[]
  // —— 决策 72-3 新增（供首页关键指标卡 2/3 使用）——
  monitored_count: number            // 已监控资源数：被 ≥1 个 enabled=true 且 draft_status='ready' 且 job_type=standard 的采集 Job 覆盖的资源数（按 resource_id 去重）
  scrape_job_count: number           // 未软删 ScrapeJob 总数
  scrape_job_enabled_count: number   // 其中 enabled=true 的数量（指标卡副行「启用 N」）
}

interface RecentDeployment {
  id: string
  change_no: string
  network_domain_name: string
  status: string
  triggered_at: string
}
```

- **新增字段口径与边界**（决策 72-3；后端 `platform/dashboard/summary.go`）:
  - `monitored_count`：`loadSelectedResourceIDs()` 聚合 `job_type=standard AND draft_status='ready' AND enabled=true` 的 `selected_instance_ids`，再与五类资源表现存 `resource_id` 求交集（排除已软删资源）；`blackbox` Job 不计入；**恒有 `monitored_count ≤ resource_count`**。
  - `scrape_job_count` / `scrape_job_enabled_count`：软删 Job 不计入；空库均返回 `0`。
  - 失败/字段缺失时前端按源降级显示 `-`（禁止 `NaN%` / `启用 undefined`），**不与「恒 0」混淆**（决策 68-2 口径）。
- **使用方式**: `HomePage` 通过 `dashboardApi.getSummary()` 获取数据，渲染 6 张资产/治理进度指标卡与最近下发记录表。

---

### 1.2 GET /api/v1/alerts

- **用途**: 首页告警状态数字区次要信息——Prometheus 当前触发告警（firing / pending）。
- **消费位置**: `ui-custom/web/src/api/alertmanager.ts`（`alertStatusApi.getPromAlerts`，M08 v1.12 封装）。
- **本次变更**: 零后端改动，前端新增消费。
- **请求参数**（可选透传，本次首页不加筛选）：

```ts
interface AlertStatusQuery {
  network_domain?: string
}
```

- **响应结构**（统一 `ApiResponse<PromAlertsData>`）：

```ts
interface PromAlertsData {
  alerts: PromAlertItem[]
}

interface PromAlertItem {
  labels: Record<string, string>
  annotations: Record<string, string>
  state: 'firing' | 'pending'
  activeAt: string
  value?: string
  // AlertInstanceFields 子集（instance_address / instance_display / resource_id / resource_name / resource_category / resource_ip / resource_port）
}
```

- **首页使用方式**: 调用 `alertStatusApi.getPromAlerts()`，按 `state` 分组计数：
  - `firingCount = alerts.filter(a => a.state === 'firing').length`
  - `pendingCount = alerts.filter(a => a.state === 'pending').length`
- **无分页说明**: 该接口代理 Prometheus `/api/v1/alerts`，返回全量数组，前端直接取长度。

---

### 1.3 GET /api/v2/platform/alertmanager/alerts

- **用途**: 首页告警状态数字区主数字——Alertmanager 治理态「通知中」（active），以及次要行已静默（silenced）/ 已抑制（inhibited）。
- **消费位置**: `ui-custom/web/src/api/alertmanager.ts`（`alertStatusApi.getAlertmanagerAlerts`，M08 v1.12 封装）。
- **本次变更**: 零后端改动，前端新增消费。
- **请求参数**（可选透传，本次首页不加筛选）：

```ts
interface AlertStatusQuery {
  network_domain?: string
}
```

- **响应结构**（统一 `ApiResponse<AmAlertsData>`）：

```ts
interface AmAlertsData {
  items: AmAlertItem[]
}

interface AmAlertItem {
  labels: Record<string, string>
  annotations: Record<string, string>
  starts_at: string
  ends_at?: string
  status?: AmAlertStatus
  notify_status: 'active' | 'silenced' | 'inhibited' | 'unprocessed'
  // AlertInstanceFields 子集
}

interface AmAlertStatus {
  state?: string
  silenced_by?: string[]
  inhibited_by?: string[]
}
```

- **首页使用方式**: 调用 `alertStatusApi.getAlertmanagerAlerts()`，按 `notify_status` 分组计数：
  - 主数字：`activeCount = items.filter(i => i.notify_status === 'active').length`
  - 次要行：`silencedCount = items.filter(i => i.notify_status === 'silenced').length`
  - 次要行：`inhibitedCount = items.filter(i => i.notify_status === 'inhibited').length`
- **无分页说明**: M08 接口当前无分页，返回全量 `items` 数组，前端直接取长度（PRD §3.1 方案 A 明确）。

> **`unprocessed` 裁剪（决策 72-3）**: 本接口返回的 `unprocessed` 不计数、不进首页告警列表；仅当 `unprocessed > 0` 时在告警状态卡显示一行 11px 灰字「另有 N 条告警仍在计算通知状态」。首页任何位置不出现「待处理」字样。

---

### 1.4 `GET` / `POST` /api/v1/query（M02 查询代理，上一轮遗留补登）

- **用途**: `/query` 路由的 `QueryPage` 执行 PromQL 瞬时查询（决策 72-1 配套）。
- **消费位置**: `ui-custom/web/src/pages/query/QueryPage.tsx`；经 M02 查询代理转发。
- **补登说明**: 该接口在 v1.4 实现 QueryPage 时已消费但未登记契约，本轮（v1.5）按 §7 第 2 项遗留补登。
- **请求参数**:

```ts
interface QueryRequest {
  query: string        // PromQL 表达式（必填）
  time?: string        // RFC3339 或 Unix 秒；缺省为服务端当前时间
}
```

- **响应结构**: 沿用 Prometheus HTTP API v1 形状（由 M02 代理透传，M05 不改写）：

```ts
interface PromQueryResponse {
  status: 'success' | 'error'
  data?: {
    resultType: 'vector' | 'matrix' | 'scalar' | 'string'
    result: unknown[]
  }
  error?: string
  errorType?: string
}
```

- **前端渲染**: 按 `resultType` 渲染结果表格或 JSON（MVP 不做折线图，不引入图表库）。
- **禁令**: **不直连** Prometheus `/api/v1/query`；门户查询一律走 M02 代理（租户 / 网域注入红线，见 `Module_02 §1 可视化边界`）。
- **第一权威契约**: M02 侧以 `docs/05-execution-records/module-02/api-contract-snapshot.md` 为准，本文件仅记录 M05 消费视角。

---

## 2. 前端路由新增

| 路由 | 组件 | 来源 | 说明 |
|------|------|------|------|
| `/query` | `QueryPage`（`ui-custom/web/src/pages/query/QueryPage.tsx`） | PRD §3.1 决策 72 配套项 | 使用指引第 5 步「查指标」深链目标；挂载于 `App.tsx` 受 `RequireAuth` 保护 |

- **实现位置**: `ui-custom/web/src/App.tsx` 中 `<Route element={<RequireAuth />}>` 内新增：
  ```tsx
  <Route path="/query" element={<QueryPage />} />
  ```
- **冲突检查**: 当前 `App.tsx` 路由表中不存在 `/query`；M02 相关路由为 `/targets`，无冲突。

---

## 3. 页面级跳转深链表

### 3.1 系统快速入口区卡片跳转

| 卡片 | 深链目标 | 目标页面 |
|------|----------|----------|
| 资源管理 | `/resources` | ResourcesPage（M07） |
| 采集 Job | `/scrape-jobs` | ScrapeJobListPage（M01） |
| 配置预览下发 | `/config-preview` | ConfigPreviewPage（M09） |
| 指标查询 | `/query` | QueryPage（M02，本次新增路由） |
| 告警状态 | `/alert-status` | AlertStatusPage（M08） |

### 3.2 使用指引区六步深链（决策 72-1）

| 步骤 | 文案 | 深链目标 |
|------|------|----------|
| 1 | 登记网域 | `/domain-onboarding`（NetworkDomainsPage，M09） |
| 2 | 导入资源 | `/resources`（ResourcesPage，M07） |
| 3 | 建采集 Job | `/scrape-jobs`（ScrapeJobListPage，M01） |
| 4 | 下发 | `/config-preview`（ConfigPreviewPage，M09） |
| 5 | 配置告警通知 | `/alert-config`（AlertConfigPage，M08） |
| 6 | 查指标 / 看告警 | `/query`（QueryPage，M02，v1.4 新增路由）或 `/alert-status`（AlertStatusPage，M08） |

### 3.3 告警状态空态引导跳转

| 场景 | 文案 | 深链目标 |
|------|------|----------|
| AM 与 Prom 均无告警 | 尚未挂载通知配置，去配置 → | `/alert-config`（AlertConfigPage，M08） |

### 3.4 首页列表「查看全部 →」深链（决策 72-3，§3.7 口径）

| 位置 | 深链目标 | 说明 |
|------|----------|------|
| 告警状态卡标题右侧「查看全部 →」 | `/alert-status` | 首页唯一告警中心入口（卡内不重复；底部仅留「配置告警通知 →」） |
| 最近下发记录标题右侧「查看全部 →」 | `/deployments` | 变更单列表页 |
| 告警状态卡底部「配置告警通知 →」 | `/alert-config` | 与空态引导同目标 |

> **分页口径**: 首页两块列表**均不放分页器**（告警中心入口只保留标题右侧「查看全部 →」）；告警列表固定取最新 10 条（`LATEST_ALERT_LIMIT = 10`），最近下发固定取前 5 条。理由含 M08 告警接口无分页能力（见 §1.3）。

---

## 4. 版本与变更控制

- **版本**: v1.5（与 PRD v1.5 / 代码实施计划 v1.5 / task-sequence.yaml 一致）。
- **变更类型**: 前端增量消费既有接口 + **`dashboard/summary` 增 3 个计数字段**（增字段、向后兼容）；无新增接口、无破坏性契约变更。
- **第一权威契约**: M08 告警相关接口以 `docs/05-execution-records/module-08/api-contract-snapshot.md` 为第一权威；M02 查询代理以 `docs/05-execution-records/module-02/api-contract-snapshot.md` 为第一权威；本文件仅记录 M05 首页/查询页消费视角。
- **下游影响**:
  - 若 M08 `/api/v2/platform/alertmanager/alerts` 或 M02 `/api/v1/alerts` 响应结构变化，需同步更新 `src/types/alertmanager.ts` 与首页计数逻辑。
  - 若 `dashboard/summary` 三字段口径调整（如 M07 `coverage.go` 补 `job_type` 过滤），需同步更新 `src/api/dashboard.ts` 注释与首页「已监控」口径，并与 M07 采集覆盖率页对齐（见 `design-decisions.md` 决策 72-3 遗留）。
  - 若 M02 `/api/v1/query` 代理形状变化，需同步更新 `QueryPage` 的结果渲染分支。
