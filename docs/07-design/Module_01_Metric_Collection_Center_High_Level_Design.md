# M01 监控策略与指标管理 概要设计

> **文档类型**：概要设计（High-Level Design, HLD）
> **目标读者**：后端/前端开发工程师、测试工程师、运维架构师、代码审查者
> **文档版本**：v1.0
> **状态**：reviewing
> **编写日期**：2026-11-20
> **对应模块**：Module 01 — 监控策略与指标管理
> **需求基线**：
> - [M01 监控策略与指标管理 SRS](../../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)（v1.4）
> - [M01 采集 Job 组与对象优先动线 SRS（增量，已并入基线 §5.7）](../../02-product-requirements/Modules/SRS/Module_01_Job_Group_and_Object_First_SRS.md)
> **接口契约**：`docs/05-execution-records/rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md`（字段级权威）
> **关键设计专题**：
> - [规则检查与提交门禁](design-notes/m01-rule-validation-gate.md)
> **关联决策**：D-2（M01/M09 边界）、D35/D36（规则中心求值、规则不绑网域）、D40（资源删除 M01 对账回收）、决策 44（RequireAdmin 最小授权）、决策 66/67-2/69-1/69-2（规则 job 引用与检查门禁）

---

## 1. 引言

### 1.1 目的

本文档描述 M01 的**架构级设计**：模块边界、接口清单、数据归属、关键流程、状态机、安全与性能约束，以及与 SRS 需求条目的追溯关系。

本文档**不展开**字段级契约、DTO、算法伪代码与页面组件细节：

- 接口字段以 `api-contract-snapshot-v3.md` 为准；
- 高风险/反直觉的实现放在 `design-notes/` 专题中；
- 代码与测试是实现细节的最终事实来源。

### 1.2 范围

覆盖六个能力域：监控对象类型注册表、采集实现池与默认采集配置、采集任务（单域 Job 与跨域任务组）、监控规则、技术/业务指标库、安装登记与对账回收。

不覆盖：M07 资源台账与标签模板维护、M09 配置生成/下发/查询、M08 告警通知、M06 网域行政字段与权限点。

### 1.3 参考

- [SRS](../../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)
- [API 设计标准](../03-engineering-standards/03_API_Standard.md)
- [后端架构与技术债控制](../03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md)
- [前端开发规范](../03-engineering-standards/02_Frontend_Standard.md)
- [测试标准](../03-engineering-standards/04_Testing_Standard.md)

---

## 2. 设计概述

### 2.1 系统上下文

```text
浏览器 ──HTTPS──▶ metric-center（控制面，v3-only）
                  ├─ /api/v3/platform/monitor-types|exporter-templates|ci-exporter-mappings
                  ├─ /api/v3/platform/scrape-jobs|job-groups|monitoring-rules
                  └─ /api/v3/platform/metric-library|business-metrics|blackbox-modules
                        │
        ┌───────────────┼─────────────────┐
        ▼               ▼                 ▼
   m01_* 表       M07 只读引用        promtool（规则语义校验）
   (SQLite/PG)    (resources /        （子进程，失败降级为“未执行”）
                   m07_label_templates)
                        ▲
                        │ pull + 同步结果回写
                  M09 配置与查询中心 ──▶ 中心 Prometheus / 各网域采集节点
```

关键约束：

- M01 **不渲染** `prometheus.yml` / `rules.yml`，**不写** M09 快照，**不触发** reload（D-2）；
- M09 以 pull 方式读取 M01 源数据（Job 的 `draft_status=ready AND enabled`、规则的 `enabled AND draft_status=ready`），并通过 `SyncResultSink` 回写 `sync_*`；
- M01 只读消费 M07 资源与标签模板，不写 M07 表；资源删除由 M01 周期对账回收（D40）。

### 2.2 组件职责

| 组件 | 代码位置 | 职责 |
|------|----------|------|
| Module 装配 | `platform/modules/m01/module.go` | 组装仓储/服务/Handler、注册路由、启动对账循环 |
| MonitorType | `service/monitor_type.go`、`repository/monitor_type.go` | 类型定义/推导规则、注册表刷新、影响面、引用计数与删除保护 |
| Exporter / Mapping | `service/exporter_template.go`、`service/mapping.go` | 采集实现池、默认采集配置、标签模板绑定 |
| Job | `service/job.go` | 单域 Job 校验/参数解析、实例候选、安装确认、targets 预演 |
| JobGroup | `service/job_group.go`、`repository/job_group.go` | 任务组扇出计划与单事务落库、组级启停、组级状态派生 |
| Rule | `service/rule.go`、`service/promtool.go` | 规则结构校验、组名唯一性、job 引用分级、promtool 语义校验 |
| Metric | `service/metric.go`、`repository/metric.go` | 技术指标库查询/用户扩展、锚点判重、JSON 锚点过滤 |
| Reconcile | `service/reconcile.go` | 60s 对账：回收已删除资源、停用失效域下的组内子 Job |
| 跨模块只读引用 | `references/` | M07 资源与标签模板、M06 网域、M09 同步结果写回 |
| 前端 | `ui-custom/web/src/pages/strategy/` | 采集器管理、监控对象类型、采集 Job、规则编辑、指标库 |

### 2.3 代码结构

```text
platform/modules/m01/
├── module.go          # 组合根：仓储/服务/路由/后台循环
├── domain/            # 领域对象、不变量、参数解析、规则解析
├── dto/               # API DTO 与投影
├── handler/           # Gin handlers + 路由 + 错误映射
├── service/           # 业务服务（job / job_group / rule / metric / monitor_type / reconcile）
├── repository/        # GORM 仓储与 JSON 锚点查询
├── references/        # M06/M07 只读引用 + M09 同步结果 sink
└── seed/              # 幂等种子（采集实现、默认配置、指标、拨测模块、内置类型）
```

### 2.4 前端信息架构

一级模块：**采集策略**（`monitoring-strategy`）。

| 顺序 | 二级菜单 | 路由 | 页面 | 状态 |
|------|----------|------|------|------|
| 1 | 采集器管理 | `/collectors` | `CollectorListPage` | 已实现 |
| 2 | 监控对象类型 | `/monitor-types` | `MonitorTypePage` | 已实现（写操作仅 admin） |
| 3 | 采集 Job | `/scrape-jobs` | `ScrapeJobListPage`（统一任务视图） | 已实现 |
| 4 | 规则编辑（含告警/记录规则） | `/rules` | `RulesPage` + `RuleMountDrawer` | 已实现（文件透传） |
| 5 | 指标库 | `/metric-library` | `MetricLibraryPage` + `MetricLibraryDrawer` | 已实现（写操作仅 admin） |

> 业务指标库（`/business-metrics`）当前只有 API 与数据层，前端页面未落地（SRS §1.2 外）。

---

## 3. 约束与关键决策

| 编号 | 决策/约束 | 影响 |
|------|-----------|------|
| D-2 | M01 只写源数据，不生成配置/不 reload | M09 负责渲染与下发；M01 通过 `SyncResultSink` 接收回写 |
| D35 | 规则统一在中心 Prometheus 求值 | 边缘配置包不含 `rules.yml`；规则 `scope` 仅 `central` |
| D36 | 规则为平台级对象、不绑网域 | `job` 引用按全平台 `ready+enabled` Job 并集校验 |
| D40 | 资源删除由 M01 周期对账回收 | 60s 对账（可配）；Job 保存仍保留实例存在性校验兜底 |
| 决策 44 | 最小授权：`RequireAdmin` | 监控对象类型与指标库写接口仅 admin；前端同步隐藏入口 |
| 决策 66/67-2 | 规则 job 引用分级 + 逃生门 | 存活类规则 error 阻断；勾选确认后放行并留痕 |
| 决策 69-1/69-2 | 检查与提交同口径、检查态驱动提交 | 组名唯一性纳入检查；内容变更作废检查结论 |
| — | `job_name` 唯一性按「网域 + 任务名」 | 跨域任务组的子 Job 共用同一任务名（00012 起） |
| — | 内置指标只读 + 用户扩展另存 | 用户扩展 `is_builtin=false`；不覆盖内置行 |
| — | 锚点存 JSON 数组 | `(metric_name, monitor_type)` 唯一性由应用层保证（DB 无法建复合唯一索引） |

---

## 4. 接口清单

字段、错误码、分页细节以 `api-contract-snapshot-v3.md` 为准；本节只列路由、权限与用途。

### 4.1 鉴权

| 入口 | 鉴权 | 说明 |
|------|------|------|
| `/api/v3/platform/*` | 用户 `AuthMiddleware` | 匿名 401；登录用户可读 |
| 监控对象类型 / 指标库写接口 | `AuthMiddleware` + `RequireAdmin` | 非 admin 403（决策 44，2026-11-19 裁定） |
| 其他 M01 写接口 | `AuthMiddleware` | 本期对登录用户开放；M03 权限点落地后细化 |

### 4.2 监控对象类型与采集实现

| 方法 | 路径 | 权限 | 用途 |
|------|------|------|------|
| GET | `/monitor-types`、`/monitor-types/:code`、`/scope-fields`、`/:code/impact` | 登录 | 类型目录、规则字段白名单、影响面 |
| POST / PUT / DELETE | `/monitor-types`、`/monitor-types/:code` | admin | 类型与推导规则维护 |
| GET / POST / PUT / DELETE | `/exporter-templates`、`/exporter-templates/:id` | 登录 | 采集实现池 |
| GET / POST / PUT / DELETE | `/ci-exporter-mappings`、`/:id`、`PUT /:id/label-template` | 登录 | 默认采集配置与标签模板绑定 |

### 4.3 采集任务（Job / JobGroup）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET / POST / PUT / DELETE | `/scrape-jobs`、`/scrape-jobs/:id` | 单域 Job CRUD |
| GET | `/scrape-jobs/instance-candidates`、`/filter-schema` | 候选实例（旧 GET + schema） |
| POST | `/scrape-jobs/instance-candidates/query`、`/query/ids` | 跨域组合筛选、全选 ID |
| GET | `/scrape-jobs/:id/instances` | 逐域实例与生效端口 |
| POST / DELETE | `/scrape-jobs/:id/instances/:resource_id/confirm` | 安装登记 / 取消 |
| POST | `/scrape-jobs/:id/preview-targets` | 目标预演 |
| GET / POST / PUT / DELETE | `/job-groups`、`/job-groups/:id` | 任务组 CRUD |
| POST | `/job-groups/from-job` | 单域 Job 晋升为任务组 |
| PUT | `/job-groups/:id/status` | 整组启用 / 停用（级联子 Job） |

### 4.4 监控规则

| 方法 | 路径 | 用途 |
|------|------|------|
| GET / POST / PUT / DELETE | `/monitoring-rules`、`/monitoring-rules/:id` | 规则 CRUD（`scope=central`） |
| POST | `/monitoring-rules/validate` | 检查：YAML/组名/job 引用/PromQL，不落库 |

### 4.5 指标库与其他

| 方法 | 路径 | 权限 | 用途 |
|------|------|------|------|
| GET | `/metric-library`、`/metric-library/:id` | 登录 | 技术指标库查询（资源类别/类型/指标类型/关键字） |
| POST / PUT / DELETE | `/metric-library`、`/:id` | admin | 用户扩展指标 |
| GET / POST / PUT / DELETE | `/business-metrics`、`/:id` | 登录 | 业务指标库（API 能力） |
| GET | `/blackbox-modules`、`/:id` | 登录 | 拨测模块（平台种子，只读） |

---

## 5. 数据设计

### 5.1 表与归属

| 表 | 作用 | 归属 |
|----|------|------|
| `m01_monitor_types` / `m01_monitor_type_rules` | 类型定义与推导规则（0020） | M01 |
| `m01_exporter_templates` | 采集实现池 | M01 |
| `m01_ci_type_exporter_mappings` | 默认采集配置 | M01 |
| `m01_scrape_jobs` | 单域 Job（含 `job_group_id`、`sync_*`） | M01 |
| `m01_job_groups` | 任务组（公共参数 + 启用状态） | M01 |
| `m01_monitoring_rules` | 规则内容与同步状态 | M01 |
| `m01_metric_library` | 技术指标库（锚点 JSON） | M01 |
| `m01_business_metrics` | 业务指标库 | M01 |
| `m01_installations` | `resource_id × scrape_job_id` 安装登记 | M01 |
| `m01_probe_modules` | 拨测模块（种子只读） | M01 |
| `network_domains` | 网域行政字段 | M06（只读） |
| `resources` / 六类扩展表 | 资源事实 | M07（只读） |
| `m07_label_templates` | 标签模板 | M07（只读） |

字段级结构以 migration（`00006_m01_strategy`、`00012_m01_job_groups`、`0020_m01_monitor_type_registry`、`0021_m01_npu_code_rename`）与契约快照为准。

### 5.2 关键约束

- `m01_monitor_types.code` 全局唯一、创建后不可变；内置类型仅可停用，不可删除；
- `m01_scrape_jobs` 唯一索引 `(network_domain_id, job_name) WHERE deleted_at IS NULL`；`job_groups.name` 全局唯一（软删外）；
- `m01_metric_library` 仅对内置行建 `metric_name` 唯一索引；用户行 `(metric_name, monitor_type)` 由服务层判重（锚点是 JSON 数组）；
- 全部软删除（`deleted_at`）；种子按「不存在才插入」幂等，不覆盖用户改动。

### 5.3 生命周期与保留

| 数据 | 策略 |
|------|------|
| Job / 规则 / 指标 | 软删；硬删需人工介入 |
| 心跳与配置快照 | 归 M09，不在 M01 |
| 资源删除 | 60s 对账回收 Job 的 `selected_instance_ids`，并将失效域下的组内子 Job 停用（行保留） |
| 种子 | 启动幂等补齐；内置类型/模块只增不覆盖 |

---

## 6. 关键设计

### 6.1 监控对象类型注册表

- 类型是平台元数据：`m01_monitor_types`（编码、展示名、资源类别、`rule_logic`、启用、内置标记）+ `m01_monitor_type_rules`（字段、操作符、取值、优先级）。
- 启动时由 `MonitorTypeService.Refresh` 加载数据库快照到进程内注册表；类型写操作后立即刷新，供 Job 候选、指标锚点、规则/采集器下拉统一读取（NFR-11）。
- 推导规则只接受 M07 能力属性白名单字段，取值层使用固定映射，不接受自由文本字段（防注入）。
- 删除保护：`CountReferences` 统计默认采集配置 / Job / 规则 / 指标锚点引用，任一非零拒绝删除并回传清单；内置类型只允许停用。
- 停用类型：不再出现在新建 Job 与指标锚点候选；存量 Job/规则保留。

### 6.2 默认采集配置与参数层叠

- 参数解析顺序：Job 显式值 → 默认采集配置（mapping）→ 采集实现（exporter）→ 系统默认；解析结果落 Job 快照，并计算 `mapping_overrides` 标记被覆盖字段。
- 端口链：Resource `scrape_port` → 网域级覆盖 → 默认采集配置端口 → 业务端口兜底（仅数据库/中间件）。
- 「同步映射默认值」按 mapping 重算并清空对应 override。
- 保存前强制校验：任务名、类型枚举、资源类别与 `monitor_type` 一致性、采集器支持该类型、网域已纳管、参数格式与 `timeout < interval`、实例存在/类别/同域/离线规则、凭据完整性、标签模板类别。

### 6.3 采集任务与任务组扇出

- 单域 Job 保持既有语义：一条 Job 绑定一个网域，是 M09 的下发单元。
- 任务组是「监控意图」：一次提交按实例所属网域生成 1 个组 + N 条子 Job；`buildPlan` 计算增/改/删集合，`repository.Apply` 单事务落组与子 Job。
- 职责边界：公共参数、凭据、标签模板、启停状态归组；子 Job 仅允许改实例与排障动作，`enforceGroupChildEditScope` 对越权字段返回「由组管理」。
- 整组启停（`PUT /job-groups/:id/status`）：单事务级联子 Job `enabled`；停用置 `sync=draft`、启用置 `sync=pending` 并校验每个子任务至少一个实例；启用后由 M09 重新生成配置。
- 组级同步状态由子 Job 派生（disabled > draft > partial > failed > pending > synced），不落库。

### 6.4 规则检查与提交门禁

- 规则仅支持 `yaml_passthrough`、`scope=central`（D35）；`structured` 返回 400。
- 检查（`POST /monitoring-rules/validate`）与保存共用 `evaluate`：YAML 结构 → 组名全局唯一（仅生效规则参与、排除自身）→ job 引用分级 → `promtool check rules`。
- 提交门禁：error 级 job 引用默认阻断；显式 `ack_job_ref_errors` 放行并留痕；保存时再跑一次，TOCTOU 竞态仍可能由保存侧拦下。
- 前端「检查 → 提交」两段式：提交按钮条件渲染、内容变更作废检查、校验结果按组/规则定位并展示组数/规则数与 PromQL 状态。

细节（状态机、三态 PromQL、逃生门、测试点）见 [规则检查与提交门禁](design-notes/m01-rule-validation-gate.md)。

### 6.5 指标库锚点与用户扩展

- 指标 ↔ 监控对象类型为多对多，锚点元素 `{monitor_type, source_exporter}` 以 JSON 数组存储；同名不同义用 `source_exporter` 区分。
- 查询过滤：`monitor_type` 直接匹配锚点；`resource_category` 先由注册表展开为该类别下的类型集合，再匹配锚点（SQLite `json_each` / PostgreSQL `jsonb_array_elements`）。
- 内置指标只读；用户扩展由管理员创建，服务层强制 `is_builtin=false`，并校验 Prometheus 命名、标签键、锚点类型存在且启用。
- 判重：同名 + 任一相同锚点 → 409（内置行与用户行一起参与）；锚点是 JSON 数组，暂由应用层保证唯一性。

### 6.6 同步状态与对账回收

- 源数据变化（保存/启停/删除）时，M01 将 Job/规则置 `sync=pending` 或 `draft`；M09 生成完成后通过 `SyncResultSink` 回写 `synced/failed` 与版本、时间。
- 前端保存后 best-effort 触发 M09 配置草稿生成；M09 侧 30s watcher + 60s 兜底，M01 不主动通知（单向依赖）。
- 对账循环（默认 60s，`Options.ReconcileInterval`）：回收已删除资源；域被禁用/退纳管时停用组内子 Job，不删除。

---

## 7. 关键流程

### 7.1 新建监控对象类型并挂指标

浏览器（admin）→ `POST /monitor-types` → 校验规则字段与引用 → 落库 + 刷新注册表 → `POST /metric-library`（锚点选新类型）→ 命名/标签/锚点校验 + 同名同锚点判重 → 指标库列表按新类型可筛。

### 7.2 对象优先创建采集任务

选任务类型/对象类型 → 组合筛选候选（跨域、按授权域收敛）→ 多选实例 → 分域预览 → `POST /job-groups` → `buildPlan` 逐域解析参数并校验 → 单事务写组 + 子 Job（`sync=pending`）→ 前端触发配置草稿 → M09 生成并回写同步状态。

### 7.3 整组启停

`PUT /job-groups/:id/status` → 加载组与子 Job → 启用时校验实例 → 级联 `enabled` 与 `sync` → 单事务落库 → 前端刷新并触发配置草稿 → M09 重新生成/剔除以域为单位。

### 7.4 规则检查与提交

粘贴/上传 `rules.yml` → 检查 → 服务端 `evaluate`（结构/组名/引用/promtool）→ 通过后提交按钮出现 → 提交（可选 ack）→ 保存再校验 → `sync=pending` → M09 生成中心 `rules.yml` 并 reload。

### 7.5 同步回写

M09 读取源数据 → 渲染/校验 → 成功切 current 或失败保留 → `SyncResultSink.RecordDomainSync/RecordRuleSync` → M01 按 `updated_at <= generatedAt` 回写 `sync_status/version/error/synced_at`。

---

## 8. 状态机

### 8.1 采集任务

```text
draft_status: draft ──保存为可同步──▶ ready
enabled:      true ⇄ false（单域 Job 走整单更新；组内子 Job 由组控制）
sync:         draft ──保存/启用──▶ pending ──M09──▶ syncing ──▶ synced
                                                       └──▶ failed（保留 current，可重试）
```

### 8.2 任务组

```text
enabled ──PUT /status(enabled=false)──▶ disabled（子 Job enabled=false, sync=draft）
   ▲                                        │
   └──── PUT /status(enabled=true) ─────────┘（校验实例，子 Job sync=pending）
```

### 8.3 规则

```text
enabled=true/false（停用不参与下发与组名唯一性校验）
draft_status: ready（本期工具仅写 ready）
sync: pending ──▶ syncing ──▶ synced / failed
```

### 8.4 同步聚合（规则/任务组）

规则按单条；任务组按子 Job 聚合：`disabled` > `draft` > `partial`（部分失败）> `failed` > `pending` > `synced`。

---

## 9. 安全

| 项 | 设计 |
|----|------|
| 写权限 | 监控对象类型与指标库写接口 `RequireAdmin`；前端隐藏入口，服务端 403 兜底 |
| 凭据 | 认证密码/Token 不随响应返回，仅返回 `credential_configured`；编辑留空时继承原值 |
| **凭据加密（技术债）** | 当前 `sealCredential` 仅写入 `plain:` 前缀占位，**未加密**；生产前必须接入 KMS/密钥派生（M03 安全项） |
| 规则门禁 | 存活类规则引用不存在 Job 默认阻断；逃生门需显式确认并留痕 |
| 输入校验 | 任务名/指标名/标签键正则；规则内容 ≤1MB；枚举字段 DB CHECK |
| 注入防护 | 推导规则字段来自白名单映射；PromQL 校验通过子进程 promtool，不经 shell 拼接 |
| 上游隔离 | M01 不访问外部 URL、不代理查询；配置与 reload 归 M09 |

---

## 10. 性能与容量

| 项 | 设计/现状 |
|----|-----------|
| 分页 | 默认 20/页，`page_size` 上限 100（契约） |
| 指标库过滤 | 锚点 JSON 子查询无索引，规模大时需评估生成列/子表；当前内置量级（约 20 条）可接受 |
| 规则检查 | `evaluate` 加载全部生效规则做组名比对，规则条数大时 O(n)；当前量级可接受 |
| 对账 | 60s 一次，批量读取资源（`GetMany`），单线程互斥 |
| 配置触发 | 前端 best-effort 触发，M09 侧防抖 + watcher + 兜底，避免重复渲染 |
| 大批量实例 | 全选上限 2000 ID；请求体与 `selected_instance_ids` JSON 列需关注体量 |

---

## 11. 可观测性与运维

| 项 | 设计 |
|----|------|
| 日志 | access log + 模块日志（对账变更数、规则检查降级等）；不输出凭据 |
| 健康检查 | `/api/v1/health`、`/api/v1/health/db`、`/api/v1/status`（全局） |
| 后台循环 | 资源对账 60s（`Options.ReconcileInterval` 可配） |
| 关键配置 | `METRIC_CENTER_DB_DRIVER`、`PROMTOOL_BIN`（默认 `promtool`） |
| 依赖工具 | `promtool` 需在 PATH；不可用时规则 PromQL 校验降级为「未执行」仅提示 |

---

## 12. 测试与验证

- 单元：参数层叠与 override、端口链、任务名/指标名/标签校验、锚点判重、组扇出计划、组级启停级联、规则结构/组名/job 引用、目录刷新。
- 集成：对象优先创建 → 单事务组+子 Job → 整组启停 → 同步回写；类型新增 → 立即挂指标 → 按类型筛选；规则检查 → 提交门禁 → 逃生门。
- 契约：路由/字段/错误类型与 `api-contract-snapshot-v3.md` 一致；非 admin 写接口 403。
- 具体用例与命令见测试代码、`design-notes/` 与 `docs/03-engineering-standards/04_Testing_Standard.md`。

---

## 13. 需求追溯

| SRS 条目 | 设计章节 | 实现状态 |
|----------|----------|----------|
| FR-01 ~ FR-04 | §4.2、§6.2、§7.2 | 已实现（FR-04 网域级参数覆盖未实现） |
| FR-05 ~ FR-13 | §4.3、§6.3、§7.2、§8.1 | 已实现 |
| FR-14 ~ FR-16 | §4.4、§6.4、§7.4 | 已实现（校验结果明细随 SRS v1.4 补齐） |
| FR-17 | — | 未实现（v0.3+） |
| FR-18 ~ FR-19 | §6.5 | 技术库已实现；业务库仅 API/数据层 |
| FR-20 | §7.2、§4.3 | 已实现 |
| FR-21 ~ FR-24 | §6.1、§7.1、§8 | 已实现 |
| FR-25 ~ FR-28 | §6.3、§7.2、§7.3、§8.2 | 已实现 |
| FR-29 | §4.1、§9 | 已实现 |
| NFR-07 ~ NFR-08 | §4.1、§9 | 已实现（细粒度权限点待 M03） |
| NFR-11 | §6.1 | 已实现 |

---

## 14. 附录

### A. 路由速查

见 §4；完整契约以 `api-contract-snapshot-v3.md` 为准。

### B. 错误语义

| 场景 | HTTP | errorType |
|------|------|-----------|
| 参数/校验失败 | 400 | bad_request |
| 规则 job 引用阻断 | 400 | job_ref_unresolved |
| 未登录 | 401 | unauthorized |
| 非管理员写 | 403 | forbidden |
| 不存在 | 404 | not_found |
| 重名/冲突（含指标锚点重复） | 409 | conflict |
| 服务不可用 | 503 | service_unavailable |

### C. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `METRIC_CENTER_DB_DRIVER` | sqlite | sqlite/postgres |
| `PROMTOOL_BIN` | promtool | promtool 可执行文件路径 |

---

## 15. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-11-20 | 首版：由 M01 SRS v1.4 派生概要设计；字段级契约回归 `api-contract-snapshot-v3.md`；规则检查门禁下沉为设计专题；补任务组扇出/整组启停、指标库用户扩展、管理员写权限、对账回收与同步回写 |
