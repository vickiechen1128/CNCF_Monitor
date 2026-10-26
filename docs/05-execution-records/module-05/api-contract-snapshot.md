> **模块**: Module 05 — 自定义前端门户  
> **PRD 版本**: v1.7  
> **计划版本**: v1.7（对应 `05_Code_Implementation_Plan.md` / `task-sequence.yaml`）  
> **日期**: 2026-10-16（v1.8 按 M05 dev-feedback 反馈 11 刷新首页版式与两个新聚合字段；v1.7 = 2026-09-19 按 PRD v1.7 / 决策 91；初版 2026-09-14）  
> **说明**: 首页 MVP 子集（决策 72 / 72-1 / 72-2）为前端增量，仅消费既有接口并在前端本地计数；决策 72-3（v1.5）放宽该约束——`dashboard/summary` 新增 3 个计数字段（增字段、向后兼容）；**决策 91（v1.7）再增 6 个分组聚合字段**（`by_category` 含 `by_subtype` / `by_app` / `unclassified_*` / `probe_target_*`）；**反馈 11（v1.8）再增 2 个**（`by_platform_app` 平台 × 应用主机矩阵 / `by_cloud` 按云主机数，权威来源见 §1.1 `by_cloud` 口径段）——全程**不新增接口**。本快照记录前端任务消费的既有 API 契约、新增前端路由与页面级深链。  

---

## 1. 既有后端 API 消费清单

### 1.1 GET /api/v2/platform/dashboard/summary

- **用途**: 首页各区块取数——**反馈 11（v1.8）定稿版式**：02「按云主机数」读 `by_cloud`、03「平台 × 应用 · 主机数」矩阵读 `by_platform_app`、04「纳管覆盖率」读 `resource_count` / `monitored_count`（**首页唯一整体纳管率呈现点**）+ 下方 `by_category` 六类卡、05 拨测读 `probe_targets`、L2 应用明细读 `by_app`；**原 L0 全局态势卡已整块删除**（v1.7 起亦不再消费 `recent_deployments`，下发表随决策 91 移除，字段与接口保留，见 §3.4 注）。
- **消费位置**: `ui-custom/web/src/api/dashboard.ts`（`dashboardApi.getSummary`）。
- **本次变更（决策 91，v1.7）**: **新增 6 个分组聚合字段**（增字段、向后兼容）——`by_category`（含 `by_subtype`）/ `by_app` / `unclassified_resource_count` / `unclassified_monitored_count` / `probe_target_count` / `probe_target_abnormal_count`；**不含任何告警字段**（告警计数归 `/api/v1/alerts` 前端分组，见 §1.2）；`recent_deployments` 首页不再消费。既有变更（决策 72-3，v1.5）：新增 `monitored_count` / `scrape_job_count` / `scrape_job_enabled_count`；`resource_count` / `pending_draft_count` / `domain_count` / `recent_deployments` 语义不变。
- **请求**: 无参数。
- **响应结构**（统一 `ApiResponse<DashboardSummary>`）：

```ts
interface DashboardSummary {
  resource_count: number              // M07 六类资源表行数之和（host/database/middleware/application/generic_target/interface_service）；不含拨测目标；空库返回 0
  pending_draft_count: number
  domain_count: number
  recent_deployments: RecentDeployment[]   // v1.7 起首页不再消费（决策 91 移除下发表）；字段保留
  // —— 决策 72-3 新增（v1.5，供首页计量卡使用）——
  monitored_count: number            // 已监控资源数：被 ≥1 个 enabled=true 且 draft_status='ready' 且 job_type=standard 的采集 Job 覆盖的资源数（按 resource_id 去重）
  scrape_job_count: number           // 未软删 ScrapeJob 总数
  scrape_job_enabled_count: number   // 其中 enabled=true 的数量
  // —— 决策 91 新增（v1.7，供首页 L1 资源类型区 / L2 应用明细表使用）——
  by_category: CategorySummary[]          // 按 resource_category 分组，驱动 L1 资源类型卡（6 类，缺则补 0 值条目）；六类 resource_count 之和 === resource_count
  by_app: AppSummary[]                    // 按应用归属分组，驱动 L2 应用明细表；与 unclassified_* 之和 === resource_count
  unclassified_resource_count: number     // 未标注应用归属的资源数（L2「未归类应用」行）
  unclassified_monitored_count: number    // 上项中已被采集任务覆盖的资源数
  probe_target_count: number              // job_type=blackbox 采集 Job 的拨测目标总数（不计入 resource_count）
  probe_target_abnormal_count: number     // 当前探测失败的拨测目标数
  // —— 反馈 10 新增（路线 B，供首页「采集健康」面板使用）——
  collection_health?: CollectionHealth    // 已下发资源的采集健康四态聚合；后端查询失败 / 未实现时字段缺失（前端按「不可用」呈现，绝不误报 0）
  // —— 反馈 11 新增（供首页「平台 × 应用 · 主机数」矩阵使用）——
  by_platform_app: PlatformAppSummary[]  // 恒为数组（空库返回 []，绝不 null）；空数组表示无主机台账，前端按「不可用态」呈现，不渲染全 0 矩阵
  // —— by_cloud 新增（供首页「按云分布」使用；云归属权威来源见下方口径段）——
  by_cloud: CloudSummary[]                // 按云分组的主机台数；恒为数组（空库返回 []，绝不 null）；空数组表示无主机台账，前端渲染空态「暂无主机数据」，**不得回落静态样例**伪造云台数
}

interface PlatformAppSummary {
  platform_code: string              // 平台编码。约定值：'' = 「未指定平台」兜底行；'__other__' = 「其他」聚合行（其下所有落选平台合并，不可点击下钻）
  platform_name: string              // 平台展示名；字典缺条目时回落 platform_code 本身（不臆造、不返回空串）。'' 与 '__other__' 为固定名「未指定平台」/「其他」
  cells: PlatformAppCell[]           // 该平台下各应用的主机台数；恒非空数组
  host_count: number                 // 该平台主机合计（恒等于 cells 之和）
}

interface PlatformAppCell {
  app_code: string                   // 应用编码；'' = 「未指定应用」列（恒保留，不丢弃）
  app_name: string                   // 应用展示名；字典缺条目时回落 app_code 本身（不臆造、不返回空串）。'' 为固定名「未指定应用」
  host_count: number                 // 该平台 × 该应用的主机台数
}

interface CloudSummary {
  cloud_code: string                 // 云字典主键（NetworkDomain.CloudCode 派生）；'' = 「未指定云」兜底行（恒保留，不丢弃）
  cloud_name: string                 // 云展示名；查云字典（CloudDict.CloudName），缺条目时回落 cloud_code 本身（不臆造、不返回空串）。'' 为固定名「未指定云」
  resource_count: number             // 该云主机数（仅 host）
  monitored_count: number            // 该云主机中已被采集任务纳管（已下发）的台数
  coverage_rate: number              // 取整百分数（0-100）：monitored_count * 100 / resource_count 整数除法；resource_count = 0 时取 0
}

interface CollectionHealth {
  dispatched_count: number               // 分母 = 已下发资源数（=== monitored_count）；不含「未下发」，未下发进度归 04「纳管覆盖率」区块与各类型卡
  collecting_count: number               // 采集中：5min 内有 up==1 样本
  stale_count: number                    // 回传延迟中（F-40 独立一态）：5min 内无样本、1h 内有历史样本
  down_count: number                     // 已下发未采到：5min 内有 up==0 样本
  pending_count: number                  // 待采集：1h 内亦无任何样本
}

interface CategorySummary {
  resource_category: 'host' | 'database' | 'middleware' | 'application' | 'generic_target' | 'interface_service'
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
  - `monitored_count`：`loadSelectedResourceIDs()` 聚合 `job_type=standard AND draft_status='ready' AND enabled=true` 的 `selected_instance_ids`，再与六类资源表现存 `resource_id` 求交集（排除已软删资源）；`blackbox` Job 不计入；**恒有 `monitored_count ≤ resource_count`**。
  - `scrape_job_count` / `scrape_job_enabled_count`：软删 Job 不计入；空库均返回 `0`。
  - 失败/字段缺失时前端按源降级显示 `-`（禁止 `NaN%` / `启用 undefined`），**不与「恒 0」混淆**（决策 68-2 口径）。
- **新增字段口径与边界**（决策 91；后端 `platform/dashboard/summary.go`）:
  - `by_category`：六类（`host` / `database` / `middleware` / `application` / `generic_target` / `interface_service`）`resource_count` 之和**必须等于** `resource_count`（前端据此校验分项加得齐）；`by_subtype` 的 `resource_count` 之和也须等于该类型的 `resource_count`；`application` 的 `by_subtype` 恒为空数组。
  - `by_app`：与 `unclassified_*` 之和等于 `resource_count`；`app_code` 为不可变简称、`app_name` 为必填展示名。
  - `probe_target_*`：来源为 `job_type=blackbox` 的采集 Job 拨测目标，**不计入** `resource_count`，也不参与覆盖率。
  - 失败 / 字段缺失时前端按源降级显示 `-`（禁止 `NaN%`），**不与「恒 0」混淆**（决策 68-2 口径）。
- **新增字段口径与边界**（反馈 10 路线 B，2026-10-13；后端 `platform/dashboard/collection_health.go` + `summary.go`）:
  - `collection_health`：**可选字段**——后端 `WithUpHealthQuerier` 未注入（如中心 Prom 未配置）或 `up` / `last_over_time(up[1h])` 查询失败时，字段缺失（`nil`/`undefined`），前端渲染「采集健康数据暂不可用」，**绝不回退成 0**（决策 68-2）。
  - 分母 `dispatched_count`：恒等于 `monitored_count`（已下发资源数，按 `resource_id` 去重），**不含「未下发」**；不变量 `dispatched_count === collecting_count + stale_count + down_count + pending_count`。
  - 四态判定沿用 F-40（与 M07 采集状态、M01 `useJobScrapeStatus` 同口径）；`stale`（回传延迟中）**独立一态**，不并入其他态；拨测目标不参与。
  - 聚合口径按 `up` 序列的 `resource_id` 标签匹配已下发资源集合（与 M02 `/api/v1/health/coverage` 一致）；无 `resource_id` 标签的 series 不计入。
- **新增字段口径与边界**（反馈 11，2026-10-16；后端 `platform/dashboard/summary.go`，需求落档见 `dev-feedback.md` §11.4）:
  - **仅统计 `resource_category = host`**：数据库 / 中间件 / 应用服务 / 通用目标 / 接口服务与拨测目标一律不进入矩阵（否则行列合计无法与主机总数闭合）。
  - **度量单位是主机台数，不是应用数**：每台主机恰有一个 `platform_code` + 一个 `app_code`，故 **各行 `host_count` 之和 === 各列 `host_count` 之和 === `by_category` 中 `resource_category='host'` 的 `resource_count`**。右下角单一合计格同时闭合两个方向。
  - **Top 4 +「其他」收敛**：非空平台按主机台数**降序**取前 4 个单独成行（并列时按 `platform_code` 字典序升序，保证输出确定性），其余平台**全部合并**为一行 `platform_code = '__other__'`；「其他」行的每个格子是其下所有落选平台 × 同一应用的计数之和。收敛只改呈现粒度，**不改变合计**。`__other__` 不符合 `models.ValidPlatformCode`（`^[a-z0-9-]{1,64}$`，不含下划线），故与任何真实平台编码天然不碰撞；前端据此判定「该行**不可点击下钻**」。
  - **「未指定平台」兜底行恒保留、且不占用 Top 4 名额**：其 `host_count` 恒等于 host 类中 `platform_code` 为空的资源数，固定排在末位（`platform_name = '未指定平台'`）。同理 `app_code` 为空的格子恒保留为「未指定应用」列（`app_name = '未指定应用'`）。**这两类行/列一律不丢弃**——丢弃则合计对不上。
  - **行内格子顺序**：按该平台下各应用主机台数降序（并列按 `app_code` 字典序升序）。行输出顺序固定为 `Top 4（台数降序）→「其他」→「未指定平台」`。
  - **名称回落不臆造**：`platform_name` / `app_name` 一律「查字典 → 缺条目回落编码本身」，**不返回空串、不编造展示名**；仅 `''` 与 `'__other__'` 三处因回落无意义而给固定展示名。
  - **空库 / 无主机资源**：返回 `[]`（非 `null`），不 panic；前端对 `undefined` / `[]` 一律按**不可用态**呈现，**不渲染全 0 矩阵**（决策 68-2）。
  - 本字段为**纯新增**：`by_category` / `by_app` / `collection_health` / `probe_targets` 等既有字段语义**一律未改动**。
- **`by_cloud` 口径与权威来源（M06 决策 103 scheme-B；后端 `platform/dashboard/summary.go`）**:
  - **权威来源是派生链，不是主机表的云字段**：`Host.NetworkDomainID → NetworkDomain.CloudCode → CloudDict.CloudName`。`CloudCode` 取自网域（与 `platform/config/resource/list.go` §资源列表云列派生同源），`CloudName` 取自云字典。
  - **明确不使用 `Host.CloudCode`**：该列是决策 103 scheme-B 之前的**历史残留**，可与网域不一致；后端一律**不读**该列做云归属（即使残留值非空），以网域派生值为唯一权威。
  - **`CloudType`（公有/政务/行业/私有）与 `Carrier`（运营商）是描述性元数据，不是分类轴**：`by_cloud` 只按 `cloud_code` 分组，**不在响应中扩展** `cloud_type` / `carrier` 维度；需要按这三者筛选时走 M06 云字典 / 网域列表接口。
  - **仅统计主机**：只聚合 `resource_category = host`；数据库 / 中间件 / 应用服务 / 通用目标 / 接口服务与拨测目标一律不进入（否则合计无法与主机总数闭合）。
  - **「未指定云」兜底行恒保留、且不丢弃**：网域缺失（`network_domain_id` 为空或指向已删网域）或网域 `cloud_code` 为空的主机，一律归入 `cloud_code = ''` 行（`cloud_name` = 固定名「未指定云」），固定排在**末位**。丢弃该行则行合计与主机总数对不上。
  - **名称回落不臆造**：`cloud_name` 一律「查云字典 → 缺条目回落 `cloud_code` 本身」，**不返回空串、不编造展示名**；仅 `''` 因回落无意义而给固定展示名「未指定云」。
  - **纳管口径与全局一致**：`monitored_count` 复用 `by_category` / 全局 `monitored_count` 的**同一套已下发判定**（`job_type=standard AND draft_status='ready' AND enabled=true` 的 `selected_instance_ids` 并集，按 `resource_id` 去重），不另起口径；因 `by_cloud` 只统计主机，其行合计**小于等于**全局 `monitored_count`（差额为其他资源类型），前端**不得**用全局值直接比对。
  - **`coverage_rate` 为取整百分数**：`monitored_count * 100 / resource_count` 整数除法；`resource_count = 0` 时取 `0`（不除零）。
  - **输出顺序**：按 `resource_count` **降序**，并列时按 `cloud_code` **字典序升序**（保证输出确定性）；「未指定云」（`cloud_code = ''`）不参与降序竞争，**恒排末位**。
  - **空库 / 无主机资源**：返回 `[]`（非 `null`），不 panic；前端对 `undefined` / `[]` 一律渲染面板空态「暂无主机数据」（含「去导入主机资源 →」深链），**绝不回落静态样例云卡**——样例只在 `VITE_STATIC_PREVIEW=true` 下生效，真库回落会向领导展示虚构云台数（决策 68-2 同源红线：取数失败不伪造、不静默成 0）。
- 本字段为**纯新增**：`by_category` / `by_app` / `by_platform_app` / `collection_health` 等既有字段语义**一律未改动**。
- **使用方式（反馈 11 定稿版式，2026-10-16）**: `HomePage` 通过 `dashboardApi.getSummary()` 获取数据，区块自上而下为 **02「按云主机数」（`by_cloud` 云卡）→ 03「平台 × 应用 · 主机数」（`by_platform_app` 矩阵）→ 04「纳管覆盖率」（**首页唯一整体纳管率呈现点**：全局 `monitored_count` / `resource_count` + 进度条 + 口径脚注 + 下方 `by_category` 六类卡）→ 告警状态（独立整宽）→ 05「拨测态势」→ 采集健康（`collection_health`）→ L2 应用明细表（`by_app`）→ 06「使用指引」**。原 L0 五张 KPI 卡（资源总数 / 已下发 / 覆盖率 / 告警数 / 拨测数）已整块删除，不再消费对应字段做首屏呈现；定稿版式见 `dev-feedback.md` §11.3。
- **文案口径（反馈 10 §10.4 正名 + 反馈 11 §11.2 归口）**: `monitored_count` 为**下发口径**——首页 L1 类型卡 / L2 应用覆盖表原「已采 / 覆盖率」字样统一正名为「**已下发 / 纳管率**」；**整体纳管率只在 04 区块头部呈现一次**（02 云卡不显示已下发 / 纳管率，避免同屏两个同源纳管率）。新面板名「采集健康」**禁用「覆盖率」字样**（避免与下发口径同词不同义），且 04 区块须带口径脚注「反映纳管/下发进度，不代表数据已采到」。

---

### 1.2 GET /api/v1/alerts

- **用途**: 首页**告警数字的唯一取数来源**（决策 91 + 反馈 11）——告警状态卡的四格统计条与最新告警列表、底部「Prometheus 原始求值」参考行（`firing` / `pending`）；L1 各资源类型卡与 L2 应用明细行的「未下发」仍由 `dashboard/summary` 的 `monitored_count` 供给，**不再**从本接口按类型分组（见 §1.1）。
- **消费位置**: `ui-custom/web/src/api/alertmanager.ts`（`alertStatusApi.getPromAlerts`，M08 v1.12 封装）。
- **本次变更**: **零后端改动**，前端新增消费；决策 91 明确本接口独立承担全部告警计数，`dashboard/summary` **不含告警字段**（首页唯一告警呈现点位于告警状态卡，见 §1.3）。
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

- **首页使用方式（决策 91 + 反馈 11，v1.8）**:
  - **告警状态卡「Prometheus 原始求值」参考行**：`firing` = `alerts.filter(a => a.state === 'firing').length`（不含 `pending`），`pending` 同理按 `state === 'pending'` 计数——两者并列在卡片底部 11px 灰字行（`prom-reference-line`），**不占用任何 KPI 卡位**。
  - **首页不再按 `resource_category` / 应用归属对告警分组**：反馈 11 删除了 L0 告警卡与 L1/L2 的「未恢复」胶囊，告警数字收敛到告警状态卡一处；资源侧「未下发」改由 `dashboard/summary` 的 `monitored_count` 供给（口径不同，见 §1.1）。
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
| 告警状态卡「查看全部」 | `/alert-status` | 无 | M08；`resource_category` 预筛随 L1 胶囊删除后暂无入口 |


## 4. 版本与变更控制

- **版本**: v1.8（2026-10-16，反馈 11 首页改版：`dashboard/summary` 再增 `by_platform_app` / `by_cloud` 两个聚合字段，L0 五张 KPI 卡删除、整体纳管率归口 04 区块）；v1.7 与 PRD v1.7 / 决策 91 一致；初版随 PRD v1.5。
- **变更类型**: 前端增量消费既有接口 + **`dashboard/summary` 增 8 个分组聚合字段**（增字段、向后兼容）；**不新增接口、无破坏性契约变更**；告警计数**零后端改动**（全部由 `/api/v1/alerts` 前端分组）。
- **第一权威契约**: M08 告警相关接口以 `docs/05-execution-records/module-08/api-contract-snapshot.md` 为第一权威；M02 查询代理以 `docs/05-execution-records/module-02/api-contract-snapshot.md` 为第一权威；本文件仅记录 M05 首页/查询页消费视角。
- **下游影响**:
  - 若 M08 `/api/v2/platform/alertmanager/alerts` 或 M02 `/api/v1/alerts` 响应结构变化，需同步更新 `src/types/alertmanager.ts` 与首页计数逻辑。
  - 若 `dashboard/summary` 分组字段口径调整（如 M07 资源类型 / 应用归属枚举变化），需同步更新 `src/api/dashboard.ts`、L1/L2 组件与「六类之和 = 总数」自洽校验，并与 M07 采集覆盖率页对齐（见 `design-decisions.md` 决策 72-3 / 91）。
  - **不变量红线**：`by_category` 之和 === `resource_count`；`by_app` + `unclassified_*` 之和 === `resource_count`；`monitored_count ≤ resource_count`；`probe_target_*` 永不进入 `resource_count` 与覆盖率；**`by_platform_app` 各行 `host_count` 之和 === 各列之和 === `by_category` 中 `resource_category='host'` 的 `resource_count`**；**`by_cloud` 各行 `resource_count` 之和 === 同上 host 类 `resource_count`**。破坏任一条即属契约回归。
  - 若 M02 `/api/v1/query` 代理形状变化，需同步更新 `QueryPage` 的结果渲染分支。

---

## 5. Grafana 面板挂载增量（2026-10-26，M05-PANEL-01）

> 本节为最新增量契约；§4「不新增接口」仅描述 v1.8 及此前首页改版，不限制本节新增接口。

### 5.1 数据对象

```ts
interface DashboardPanel {
  id: number
  name: string                 // 1~100 个字符，去首尾空白，全库唯一
  url: string                  // 原始完整 Grafana /d/ 仪表盘 URL，最长 2048 字符
  created_at: string           // RFC3339
  updated_at: string           // RFC3339
}

interface DashboardPanelList {
  list: DashboardPanel[]
  total: number
  page: number
  page_size: number
}
```

### 5.2 接口与权限

| 方法 | 路径 | 权限 | 成功响应 `data` |
|------|------|------|-----------------|
| GET | `/api/v2/platform/dashboard/panels` | 已登录用户 | `DashboardPanelList`；支持 `page` / `page_size`，默认 1 / 20，上限 100 |
| POST | `/api/v2/platform/dashboard/panels` | 管理员 | `DashboardPanel`；请求体仅 `name` / `url` |
| GET | `/api/v2/platform/dashboard/panels/:id` | 已登录用户 | `DashboardPanel` |

- 所有成功/错误响应使用平台统一信封。
- URL 仅允许 `http` / `https`、非空 host 和 `/d/` 仪表盘路径；后端保存原字符串，不主动请求目标 URL。
- 非法字段或 ID 返回 400 `bad_request`；名称重复返回 409 `conflict`；ID 不存在返回 404 `not_found`；非管理员新增返回 403 `forbidden`。

### 5.3 前端路由与 iframe 契约

- 管理页：`/admin/dashboard-panels`，位于「系统与平台管理 → 面板挂载」。
- 展示页：`/dashboard/panels/:id`，位于「首页 → 自定义大屏」动态子菜单。
- iframe 保留原始完整 URL 及全部查询参数；若不存在 `kiosk` 参数，追加无值参数 `&kiosk`（无查询串时使用 `?kiosk`），已存在则不重复追加；若不存在 `hideLogo`，追加 `hideLogo=true` 隐藏 Grafana kiosk 品牌页脚。
- Grafana 身份认证和 `allow_embedding` 由 Grafana 侧负责，平台不代理或绕过。
- iframe 加载后，同源时通过 `kioskEvents.ts` 在 iframe 文档捕获阶段屏蔽双击和 Escape，其他鼠标/键盘操作不受影响；跨域时安全跳过，生产需经 Nginx 将门户和 Grafana 挂到同一协议/域名/端口后启用该能力。
