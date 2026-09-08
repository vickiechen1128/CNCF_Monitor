# API 契约快照 — Module 02 查询中心（决策 47：采集状态回显，Track B 增量）

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6/8 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 或 `platform/query/*` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 模块变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。
>
> 模板：`docs/05-execution-records/_api-contract-snapshot.template.md`

## 0. 快照元信息

| 项     | 值                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Phase | Track B 增量（决策 47 系列，derived for `feat/module-08-alert-dispatch`）                                                                   |
| 模块    | module-02-query-center（采集状态回显 API 子集）                                                                                              |
| 分支    | feat/module-08-alert-dispatch（决策 47 批次先行）                                                                                          |
| 版本    | v2026-09-01                                                                                                                        |
| 生成方式  | 由决策 47 全文 + Module\_02 PRD v1.7 §5.3/§6.1/§7 + 03\_API\_Standard 派生                                                                |
| 来源    | PRD `Module_02_Query_Center.md` §5.3/§6.1/§7/§8；`03_API_Standard.md` §3/§7；决策 47 design-decisions（module-01 & module-02 cross-ref） |

## 1. 通用契约

### 1.1 前缀与认证

- 本模块 API 挂在 **`/api/v1`**（Prometheus 查询代理通道），新增 `/targets` 与 `/health/coverage`；既有 `/query`、`/query_range`、`/labels`、`/label/:name/values`、`/series` 保持不动。

- 统一响应格式（`03_API_Standard §3`，`platform/api/response`）：

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

- 认证：`/api/*` 走全局认证中间件（auth.AuthMiddleware，仅认证不授权，决策 44）；租户/网域注入 MVP 恒 `platform_admin` + `default` 网域（v1.2/决策 4 机制 MVP 落地、多租户语义 v0.2 启用）。**@TBD**：注入标签 key 用 `network_domain`（Prometheus 标签，M09 external\_labels）而非 `network_domain_id`（对象字段），两者不得混用。

### 1.2 errorType 枚举（复用 03\_API\_Standard）

`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict`。

### 1.3 数据源与消费方边界

- `/api/v1/targets`：直接代理中心 Prometheus `/api/v1/targets`，本地做 `job` / `network_domain` / `health` 过滤与 `network_domain` 字段补全（Prometheus targets API 原生无 job 过滤，需 M02 侧后处理）。

- `/api/v1/health/coverage`：基于 `up` 指标聚合，**按** **`resource_id`** **稳定标签回连五类资源**；选出关系取自各 `ScrapeJob.selected_instance_ids`（M01 维护，M02 只读引用 DB）。覆盖「已选」与「up/down」两维输出三态。

- 消费方：M01（Job 实例采集状态回显，决策 47-2）、M07（资源三态 badge，决策 47-3）、独立目标状态页（P1 极简列表，决策 47-4）。

## 2. 接口清单

### 2.1 `GET /api/v1/targets`（代理，决策 47-4，MVP P0）

| 项       | 值                                                                                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 方法      | GET                                                                                                                           |
| 路径      | `/api/v1/targets`                                                                                                             |
| Query   | `job`（可选，M01 回显按 Job 过滤）、`network_domain`（可选，按注入标签过滤）、`health`（可选，`up` / `down` / `unknown`）、`state`（透传上游，MVP 恒 `active`，可不传） |
| 响应 data | 代理 Prometheus `data.activeTargets[]`，逐项增强补全 `network_domain` 字段；结构见 §2.2                                                      |
| 业务错误    | `bad_request`：`health` 传入非枚举值；上游 Prometheus 不可达 `internal`                                                                    |
| PRD 源   | §5.3 / §6.1 / §8 验收第 3 条                                                                                                      |

> 透传 + 本地过滤：M02 先不带 `job` 调上游 `GET /api/v1/targets`，取回 activeTargets 后在本地按 `job` / `network_domain` / `health` 过滤并补全 `network_domain`，避免上游不支持该过滤导致空结果。

#### 2.1.1 单条 target 对象字段（PRD §5.3）

| 字段               | 类型        | UI 展示名     | 说明                                         |
| ---------------- | --------- | ---------- | ------------------------------------------ |
| `scrapePool`     | string    | 采集 Job     | 上游透传（≈ job 名）                              |
| `job`            | string    | Job 名称     | 从 discoveryLabels/`job` 标签解析               |
| `instance`       | string    | 实例地址       | `host:port`                                |
| `network_domain` | string    | 所属网域       | 从注入 `network_domain` 标签解析补全（缺失时 `default`） |
| `health`         | string    | 采集状态       | `up` / `down` / `unknown`                  |
| `lastScrape`     | timestamp | 最后采集时间     | 上游透传                                       |
| `lastError`      | string    | 最后错误       | 上游透传，空串表示无                                 |
| `scrapeDuration` | number    | 采集耗时       | 秒（上游透传 `lastScrapeDuration`）               |
| `resource_id`    | string    | 资源 ID（回连键） | 从目标标签 `resource_id` 解析（可选，供 M07 回连）        |

#### 2.1.2 外层 data（对齐 Prometheus targets 响应）

```json
{
  "status": "success",
  "data": {
    "activeTargets": [ /* 过滤后的 target 对象数组 */ ],
    "droppedTargets": [],
    "targetsByJob": {}
  }
}
```

> 前端以 `data.activeTargets` 消费；`job` / `network_domain` / `health` 过滤由后端 M02 承担，前端不重复过滤。

### 2.2 `GET /api/v1/health/coverage`（三态聚合，决策 47-3，v0.2 提前 MVP）

| 项       | 值                                                                                                                                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 方法      | GET                                                                                                                                                                                |
| 路径      | `/api/v1/health/coverage`                                                                                                                                                          |
| Query   | `network_domain`（可选，MVP 恒 `default`）、`resource_category`（可选，过滤五类）、`state`（可选，按 `collecting` / `pending_down` / `not_monitored` 过滤）、`page` / `page_size`（默认 1 / 500，上限 1000，覆盖全部资源） |
| 响应 data | `{ items, total, summary }`（**items 键**；summary 见 §2.2.2）                                                                                                                          |
| 业务错误    | 无强校验错误；上游 Prometheus 不可达 `internal`                                                                                                                                                |
| PRD 源   | §6.1 / §7 与 Module\_07 边界 / §8 验收第 11 条                                                                                                                                            |

#### 2.2.1 item 字段

| 字段                  | 类型     | 枚举 / 说明                                                               |
| ------------------- | ------ | --------------------------------------------------------------------- |
| `resource_id`       | string | 资源唯一键（与 M07 `resource_id` 一致）                                         |
| `resource_category` | string | `host` / `database` / `middleware` / `application` / `generic_target` |
| `instance_name`     | string | 可读实例名（M01/M07 回显用）                                                    |
| `monitor_state`     | string | `collecting`（采集中）/ `pending_down`（已下发未采到）/ `not_monitored`（未监控）       |
| `health`            | string | `up` / `down` / `unknown` / `null`（未监控时 null）                         |
| `last_error`        | string | 最近抓取错误（down 时定位，可选）                                                   |

**三态判定规则（决策 47-3；2026-09-02 口径修订：不感知 M09 下发时序）**：

- 选中关系取 DB 当前值：资源 ∈ 任一 `draft_status=ready` 且 `enabled=true` Job 的 `selected_instance_ids`（**不问** **`change_status`**——已选中但变更未确认下发的实例同样计入选中侧）：

  - 存在对应 target 且 `health=up` → `collecting`；

  - 其余一切（`down` / `unknown` / 无 target 无 `up` 样本——含变更未确认下发、已下发未 reload、待首次抓取、采集器未装）→ `pending_down`；

- 资源 ∉ 任何 ready+enabled Job 的 `selected_instance_ids` → `not_monitored`。

> 「待采集（变更未下发）vs 已下发未采到」的细分由 M01 Job 上下文回显承担（M01 持有 `change_status`，见 M01 §5.10）；coverage / M07 badge 保持三态不区分，M02 聚合不耦合 M09 时序。

#### 2.2.2 summary 字段（覆盖率汇总）

| 字段              | 类型     | 说明                                    |
| --------------- | ------ | ------------------------------------- |
| `total`         | number | 资源总数（按过滤）                             |
| `collecting`    | number | 采集中                                   |
| `pending_down`  | number | 已下发未采到                                |
| `not_monitored` | number | 未监控                                   |
| `coverage_rate` | number | `collecting / total`，保留 2 位小数（无资源时 0） |

#### 2.2.3 响应示例

```json
{
  "status": "success",
  "data": {
    "items": [
      { "resource_id": "srv-1", "resource_category": "host", "monitor_state": "collecting", "health": "up", "last_error": "" },
      { "resource_id": "srv-2", "resource_category": "host", "monitor_state": "pending_down", "health": "down", "last_error": "connection refused" },
      { "resource_id": "srv-3", "resource_category": "host", "monitor_state": "not_monitored", "health": null, "last_error": "" }
    ],
    "total": 3,
    "summary": { "total": 3, "collecting": 1, "pending_down": 1, "not_monitored": 1, "coverage_rate": 0.33 }
  }
}
```

## 3. 路径偏差说明（PRD → 实际实现）

| PRD §6 原文                        | 实际实现                 | 原因                           |
| -------------------------------- | -------------------- | ---------------------------- |
| `/api/v1/health/coverage` 属 v0.2 | **提前 MVP（决策 47-3）**  | M07 badge 需要，落地为 T02-02      |
| 目标状态页 P0                         | 独立页降 **P1**（决策 47-4） | 知情权由 M01/M07 回显承担，独立页仅极简排障入口 |

## 4. 跨模块契约

| 模块                       | 契约                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Module\_01（决策 47-2）      | 只读消费 `GET /api/v1/targets?job=<job_name>` 做 Job 抽屉实例采集状态回显；`job` 名来自 ScrapeJob `job_name`；「待采集」= 变更未确认下发或该实例无对应 target        |
| Module\_07（决策 47-3）      | 只读消费 `GET /api/v1/health/coverage`（一次拉取全量或按 category/state 过滤），前端按 `resource_id` 与资源列表行合并渲染三态 badge；禁止逐行调 targets/query（TQ-6） |
| Module\_01 安装确认（决策 47-1） | 未确认不影响 targets 生成；确认 API 语义降为「可选登记」，与 coverage 状态无耦合                                                                          |

## 5. 仍待确认项（\[待确认]）

- ~~\[待确认] LabelTemplate 默认模板是否确实注入~~ ~~`resource_id`~~ ~~稳定标签（决策 47-3 前提：M01 §9.1 已声明 P0 验收"默认模板含 resource\_id"）——若缺失需在 M07 标签模板种子补齐后再验证 coverage 回连。~~ **已闭环（2026-09-02）**：原默认模板确实缺 `resource_id`；已补齐——`platform/models/label_template.go` `DefaultMappingBuilders` 五类默认模板均含 `resource_id → resource_id`，`platform/db/seed/label_template.go` 新增 `ensureResourceIDMapping` 存量库幂等回填（默认模板只读保护下用户无法经 UI 补）；PRD 同步收紧（M01 v3.29 §9.1 验收改为必须含 `resource_id`、M07 v2.25 §5.13 默认模板表补行）；测试覆盖 `TestDefaultTemplatesContainResourceID` / `TestRunLabelTemplatesBackfillsResourceID`。

- ~~\[待确认] coverage 聚合是否需要纳入「统计 Jobs 已生效但未确认下发」的实例（决策 47-2「待采集」口径建议按 change\_status 判定），与 M09 下发时序的解耦口径待实现期对齐。~~ **已闭环（2026-09-02，用户拍板 A 方案）**：coverage 不感知 M09 时序——选中关系取 DB 当前 `selected_instance_ids`（ready+enabled，不问 `change_status`），采集事实取 Prometheus 实际 target/`up`；「选中但未采到」统一归 `pending_down`（含未下发情形），「待采集 vs 已下发未采到」细分由 M01 Job 回显承担（§2.2.1 判定规则已同步修订）。

