> **模块**: Module 05 — 自定义前端门户  
> **PRD 版本**: v1.7  
> **计划版本**: v1.7（对应 `05_Code_Implementation_Plan.md` / `task-sequence.yaml`）  
> **日期**: 2026-09-19（本版按 PRD v1.7 / 决策 91 刷新；初版 2026-09-14）  
> **说明**: 首页 MVP 子集（决策 72 / 72-1 / 72-2）为前端增量，仅消费既有接口并在前端本地计数；决策 72-3（v1.5）放宽该约束——`dashboard/summary` 新增 3 个计数字段（增字段、向后兼容）；**决策 91（v1.7）再增 6 个分组聚合字段**（`by_category` 含 `by_subtype` / `by_app` / `unclassified_*` / `probe_target_*`），并首次引入「**L0 / L1 / L2 三处『未恢复』均由 `/api/v1/alerts` 前端分组**」的消费方式——仍**不新增接口**。本快照记录前端任务消费的既有 API 契约、新增前端路由与页面级深链。  

---

## 1. 既有后端 API 消费清单

### 1.1 GET /api/v2/platform/dashboard/summary

- **用途**: 首页 L0 全局态势卡与 L1 资源类型区取数（v1.7 起首页**不再消费** `recent_deployments`，下发表随决策 91 移除，字段与接口保留，见 §3.4 注）。
- **消费位置**: `ui-custom/web/src/api/dashboard.ts`（`dashboardApi.getSummary`）。
- **本次变更（决策 91，v1.7）**: **新增 6 个分组聚合字段**（增字段、向后兼容）——`by_category`（含 `by_subtype`）/ `by_app` / `unclassified_resource_count` / `unclassified_monitored_count` / `probe_target_count` / `probe_target_abnormal_count`；**不含任何告警字段**（告警计数归 `/api/v1/alerts` 前端分组，见 §1.2）；`recent_deployments` 首页不再消费。既有变更（决策 72-3，v1.5）：新增 `monitored_count` / `scrape_job_count` / `scrape_job_enabled_count`；`resource_count` / `pending_draft_count` / `domain_count` / `recent_deployments` 语义不变。
- **请求**: 无参数。
- **响应结构**（统一 `ApiResponse<DashboardSummary>`）：

```ts
interface DashboardSummary {
  resource_count: number              // M07 五类资源表行数之和；不含拨测目标；空库返回 0
  pending_draft_count: number
  domain_count: number
  recent_deployments: RecentDeployment[]   // v1.7 起首页不再消费（决策 91 移除下发表）；字段保留
  // —— 决策 72-3 新增（v1.5，供首页计量卡使用）——
  monitored_count: number            // 已监控资源数：被 ≥1 个 enabled=true 且 draft_status='ready' 且 job_type=standard 的采集 Job 覆盖的资源数（按 resource_id 去重）
  scrape_job_count: number           // 未软删 ScrapeJob 总数
  scrape_job_enabled_count: number   // 其中 enabled=true 的数量
  // —— 决策 91 新增（v1.7，供首页 L1 资源类型区 / L2 应用明细表使用）——
  by_category: CategorySummary[]          // 按 resource_category 分组，驱动 L1 五张资源类型卡；五类 resource_count 之和 === resource_count
  by_app: AppSummary[]                    // 按应用归属分组，驱动 L2 应用明细表；与 unclassified_* 之和 === resource_count
  unclassified_resource_count: number     // 未标注应用归属的资源数（L2「未归类应用」行）
  unclassified_monitored_count: number    // 上项中已被采集任务覆盖的资源数
  probe_target_count: number              // job_type=blackbox 采集 Job 的拨测目标总数（不计入 resource_count）
  probe_target_abnormal_count: number     // 当前探测失败的拨测目标数
}

interface CategorySummary {
  resource_category: 'host' | 'database' | 'middleware' | 'application' | 'generic_target'
  resource_count: number
  monitored_count: number
  coverage_rate: number              // 取整百分数（0-100）
  by_subtype: SubtypeSummary[]       // 采集类型子类；应用服务为空数组（平台不按语言 / 框架拆分）
}

interface SubtypeSummary {
  subtype: string                    // 主机=OS 类型 / 数据库=database_type / 中间件=middleware_type / 其他监控目标=端点类型
  resource_count: number
  monitored_count: number
  coverage_rate: number
}

interface AppSummary {
  app_code: string                   // 应用简称（不可变，`app` 标签来源，见 M07 §5.2）
  app_name: string                   // 应用展示名（必填）
  biz_code: string                   // 关联业务域
  resource_count: number
  monitored_count: number
  coverage_rate: number
}

interface RecentDeployment {
  id: string
  change_no: string
  network_domain_name: string
  status: string
  triggered_at: string
}
```

- **既有新增字段口径与边界**（决策 72-3，v1.5；后端 `platform/dashboard/summary.go`）:
  - `monitored_count`：`loadSelectedResourceIDs()` 聚合 `job_type=standard AND draft_status='ready' AND enabled=true` 的 `selected_instance_ids`，再与五类资源表现存 `resource_id` 求交集（排除已软删资源）；`blackbox` Job 不计入；**恒有 `monitored_count ≤ resource_count`**。
  - `scrape_job_count` / `scrape_job_enabled_count`：软删 Job 不计入；空库均返回 `0`。
  - 失败/字段缺失时前端按源降级显示 `-`（禁止 `NaN%` / `启用 undefined`），**不与「恒 0」混淆**（决策 68-2 口径）。
- **新增字段口径与边界**（决策 91；后端 `platform/dashboard/summary.go`）:
  - `by_category`：五类 `resource_count` 之和**必须等于** `resource_count`（前端据此校验分项加得齐）；`by_subtype` 的 `resource_count` 之和也须等于该类型的 `resource_count`；`application` 的 `by_subtype` 恒为空数组。
  - `by_app`：与 `unclassified_*` 之和等于 `resource_count`；`app_code` 为不可变简称、`app_name` 为必填展示名。
  - `probe_target_*`：来源为 `job_type=blackbox` 的采集 Job 拨测目标，**不计入** `resource_count`，也不参与覆盖率。
  - 失败 / 字段缺失时前端按源降级显示 `-`（禁止 `NaN%`），**不与「恒 0」混淆**（决策 68-2 口径）。
- **使用方式**: `HomePage` 通过 `dashboardApi.getSummary()` 获取数据，渲染 L0 四张 KPI 卡、L1 资源类型区与 L2 应用明细表（v1.7 版式，见 `frontend-prototype-map.md` §5.5 W-1~W-5）。

---

### 1.2 GET /api/v1/alerts

- **用途**: 首页**三处「未恢复」数字的唯一取数来源**（决策 91）——L0 第 4 卡（全量）、L1 各资源类型卡右上角胶囊（按 `resource_category`）、L2 应用明细行「未恢复」（按应用归属）；告警状态卡的四格统计条与列表另行消费（见 §1.3）。
- **消费位置**: `ui-custom/web/src/api/alertmanager.ts`（`alertStatusApi.getPromAlerts`，M08 v1.12 封装）。
- **本次变更**: **零后端改动**，前端新增消费；决策 91 明确本接口独立承担全部「未恢复」计数，`dashboard/summary` **不含告警字段**（在 L0/L1/L2 之间保持一致口径的唯一手段）。
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

- **首页使用方式（决策 91，v1.7）**:
  - **L0 第 4 卡「当前未恢复告警」**：`alerts.filter(a => a.state === 'firing').length`（不含 `pending`；条数 >0 时红色语义）。
  - **L1 分类计数**：按响应项的 `resource_category`（`AlertInstanceFields` 子集，由 `platform/query/resource_identity.go` 回填）
    分组计数，落到对应资源类型卡的「未恢复 N」胶囊；**零告警显示「无未恢复」**（灰底灰字），不显示 `0`。
  - **无 `resource_category` 的告警**（拨测目标 / 聚合规则 / 用户自写规则）：不计入任何资源类型卡，
    在 L1 入口卡下方以附注呈现「另有 N 条未恢复告警不属于资源台账对象」。
  - **L2 应用计数**：按告警标签中的应用归属（`app` = `app_code`）分组计数。
- **与告警状态卡的口径分工**：本接口出**当前实时**口径（判断「现在有没有问题」）；
  `/api/v1/alerts/history` 出**历史累计**口径（`fired_at` 计数当日 / 近 7 天，判断「这段时间告警多不多」）；两者并存不互替。
- **既有消费（v1.5 及以前）**：按 `state` 分组的 `firingCount` / `pendingCount` 仍供告警状态卡 11px 灰字参考行使用
  （Prom 求值态文案见 `PROM_EVAL_LABEL`）。
- **无分页说明**: 该接口代理 Prometheus `/api/v1/alerts`，返回全量数组，前端直接分组取长度。

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

### 3.1 系统快速入口区卡片跳转（**v1.7 已移除，决策 91**）

> 决策 91（PRD v1.7 §3.1 页面结构第 4 项）**删除「系统快速入口区」**：原型 v1.4 已移除，生产 `QuickAccess.tsx` 待退役（`frontend-prototype-map.md` §5.5 W-1）。下表为 v1.5/v1.6 的历史口径，保留备查；各功能页本身与顶部导航直达不变。

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

### 3.4 首页列表「查看全部 →」深链（决策 72-3 → 决策 91 修订）

| 位置 | 深链目标 | 说明 |
|------|----------|------|
| 告警状态卡标题右侧「查看全部 →」 | `/alert-status` | 首页唯一告警中心入口（卡内不重复；底部仅留「配置告警通知 →」） |
| 告警状态卡底部「配置告警通知 →」 | `/alert-config` | 与空态引导同目标 |
| ~~最近下发记录「查看全部 →」~~ | ~~`/deployments`~~ | **v1.7 移除**——下发表随决策 91 删除，首页不再有本深链；`/deployments` 功能页保留、改由顶部导航进入 |
| L1 资源类型卡子类行 / L2 应用明细行 | `/resources` + 预筛参数 | **v1.7 新增**（决策 91），见 §3.5；需 M07 侧支持入参 |

> **分页口径（决策 89 / 91）**: 首页**不放分页器**；告警列表**卡内分页，每页 5 行**（数据池仍为最新 8 条 = `LATEST_ALERT_LIMIT`，第 2 页 3 行）；「最近下发记录」表**已移除**，不再有「前 5 / 6 条」口径。

### 3.5 首页下钻深链（v1.7 新增，决策 91）

| 位置 | 深链目标 | 预筛参数（建议） | 依赖方 |
|------|----------|------------------|--------|
| L1 资源类型卡「子类」明细行 | `/resources` | `resource_category=<类型>` + `subtype=<子类键>` | M07 资源清单页需支持入参预筛 |
| L1「按应用查看」入口卡 | `/resources`（或应用视图） | `view=app` | 同上 |
| L2 应用明细行「看明细 / 补齐监控」 | `/resources` | `app_code=<应用简称>` | 同上 |
| L2「未归类应用」行「去补填」 | `/resources` | `app_code=__empty__`（或等价空值约定） | 同上 |
| L1 拨测附注 | `/strategy`（采集 Job 列表） | `job_type=blackbox` | M01/M09 |
| L0 第 4 卡 / L1 未恢复胶囊 | `/alert-status` | `resource_category=<类型>`（胶囊点击时携带） | M08 告警状态页需支持入参预筛 |


## 4. 版本与变更控制

- **版本**: v1.7（与 PRD v1.7 / 决策 91 一致；初版随 PRD v1.5）。
- **变更类型**: 前端增量消费既有接口 + **`dashboard/summary` 增 6 个分组聚合字段**（增字段、向后兼容）；**不新增接口、无破坏性契约变更**；告警计数**零后端改动**（全部由 `/api/v1/alerts` 前端分组）。
- **第一权威契约**: M08 告警相关接口以 `docs/05-execution-records/module-08/api-contract-snapshot.md` 为第一权威；M02 查询代理以 `docs/05-execution-records/module-02/api-contract-snapshot.md` 为第一权威；本文件仅记录 M05 首页/查询页消费视角。
- **下游影响**:
  - 若 M08 `/api/v2/platform/alertmanager/alerts` 或 M02 `/api/v1/alerts` 响应结构变化，需同步更新 `src/types/alertmanager.ts` 与首页计数逻辑。
  - 若 `dashboard/summary` 分组字段口径调整（如 M07 资源类型 / 应用归属枚举变化），需同步更新 `src/api/dashboard.ts`、L1/L2 组件与「五类之和 = 总数」自洽校验，并与 M07 采集覆盖率页对齐（见 `design-decisions.md` 决策 72-3 / 91）。
  - **不变量红线**：`by_category` 之和 === `resource_count`；`by_app` + `unclassified_*` 之和 === `resource_count`；`monitored_count ≤ resource_count`；`probe_target_*` 永不进入 `resource_count` 与覆盖率。破坏任一条即属契约回归。
  - 若 M02 `/api/v1/query` 代理形状变化，需同步更新 `QueryPage` 的结果渲染分支。
