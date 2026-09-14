> **模块**: Module 05 — 自定义前端门户  
> **PRD 版本**: v1.3  
> **计划版本**: v1.3（对应 `05_Code_Implementation_Plan.md` / `task-sequence.yaml`）  
> **日期**: 2026-09-14  
> **说明**: 本次首页 MVP 子集（决策 72）为前端增量，**不新增后端接口**，仅消费既有接口并在前端本地计数。本快照记录前端任务消费的既有 API 契约、新增前端路由与页面级深链。

---

## 1. 既有后端 API 消费清单

### 1.1 GET /api/v2/platform/dashboard/summary

- **用途**: 首页既有平台统计卡与最近下发记录。
- **消费位置**: `ui-custom/web/src/api/dashboard.ts`（`dashboardApi.getSummary`）。
- **本次变更**: 继续消费，无变更。
- **请求**: 无参数。
- **响应结构**（统一 `ApiResponse<DashboardSummary>`）：

```ts
interface DashboardSummary {
  resource_count: number
  pending_draft_count: number
  recent_deployments: RecentDeployment[]
  domain_count: number
}

interface RecentDeployment {
  id: string
  change_no: string
  network_domain_name: string
  status: string
  triggered_at: string
}
```

- **使用方式**: `HomePage` 通过 `dashboardApi.getSummary()` 获取数据，渲染统计卡与最近下发表。

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

### 3.2 使用指引区五步深链

| 步骤 | 文案 | 深链目标 |
|------|------|----------|
| 1 | 登记网域 | `/domain-onboarding`（NetworkDomainsPage，M09） |
| 2 | 导入资源 | `/resources`（ResourcesPage，M07） |
| 3 | 建采集 Job | `/scrape-jobs`（ScrapeJobListPage，M01） |
| 4 | 下发 | `/config-preview`（ConfigPreviewPage，M09） |
| 5 | 查指标 | `/query`（QueryPage，M02，本次新增路由） |

### 3.3 告警状态空态引导跳转

| 场景 | 文案 | 深链目标 |
|------|------|----------|
| AM 与 Prom 均无告警 | 尚未挂载通知配置，去配置 → | `/alert-config`（AlertConfigPage，M08） |

---

## 4. 版本与变更控制

- **版本**: v1.3（与 PRD v1.3 / 代码实施计划 v1.3 / task-sequence.yaml 一致）。
- **变更类型**: 前端增量消费既有接口，无后端契约变更。
- **第一权威契约**: M08 告警相关接口以 `docs/05-execution-records/module-08/api-contract-snapshot.md` 为第一权威；本文件仅记录 M05 首页消费视角。
- **下游影响**: 若 M08 `/api/v2/platform/alertmanager/alerts` 或 M02 `/api/v1/alerts` 响应结构变化，需同步更新 `src/types/alertmanager.ts` 与首页计数逻辑。
