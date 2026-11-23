# 监控策略与指标管理 概要设计

> **文档类型**：概要设计（High-Level Design, HLD）
> **目标读者**：后端/前端开发工程师、测试工程师、运维架构师、代码审查者
> **文档版本**：v1.5
> **状态**：reviewing（场景优先试点）
> **编写日期**：2026-11-20
> **修订日期**：2026-11-22
> **Domain ID**：`DOMAIN-M01`
> **实现模块**：`m01`
> **需求基线**：
> - [监控策略与指标管理 SRS](../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)（v1.9，场景优先试点）
> - [采集 Job 组与对象优先动线 SRS（增量，已并入基线 §5.7）](../02-product-requirements/Modules/SRS/Module_01_Job_Group_and_Object_First_SRS.md)
> **场景链接（唯一链接点）**：[Module_01_Scenario_Link.md](Module_01_Scenario_Link.md)
> **场景演示脚本**：`docs/05-execution-records/module-01/scenario-walkthrough.md`
> **接口契约**：`docs/05-execution-records/rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md`（字段级权威）
> **对外验收说明书**：`docs/07-design/Module_01_Acceptance.md`（待创建，派生，非追溯）
> **关键设计专题**：
> - [规则检查与提交门禁](design-notes/m01-rule-validation-gate.md)
> **关联决策**：D-2（M01/M09 边界）、D35/D36（规则中心求值、规则不绑网域）、D40（资源删除 M01 对账回收）、决策 44（RequireAdmin 最小授权，v1.1 起收口到内置模板与指标库）、决策 66/67-2/69-1/69-2（规则 job 引用与检查门禁）、v1.5 采集模板化（取消监控对象类型，模板不带适用范围）

---

## 1. 引言

### 1.1 目的

本文档描述监控策略与指标管理的**架构级设计**：模块边界、接口清单、数据归属、关键流程、状态机、安全与性能约束，以及**能力清单**；完整“场景 ↔ 设计 ↔ 演示 ↔ 验收”见 [Scenario Link](Module_01_Scenario_Link.md)。

本文档**不展开**字段级契约、DTO、算法伪代码与页面组件细节：

- 接口字段以 `api-contract-snapshot-v3.md` 为准；
- 高风险/反直觉的实现放在 `design-notes/` 专题中；
- 代码与测试是实现细节的最终事实来源。

### 1.2 范围

覆盖六个能力域：采集模板与采集实现池、采集任务（单域 Job 与跨域任务组，含选择器）、监控规则、技术/业务指标库、安装登记与对账回收。

不覆盖：M07 资源台账与标签模板维护、M09 配置生成/下发/查询、M08 告警通知、M06 网域行政字段与权限点。

### 1.3 参考

- [SRS](../02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md)
- [Scenario Link](Module_01_Scenario_Link.md)
- [场景演示脚本](../05-execution-records/module-01/scenario-walkthrough.md)
- [API 设计标准](../03-engineering-standards/03_API_Standard.md)
- [后端架构与技术债控制](../03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md)
- [前端开发规范](../03-engineering-standards/02_Frontend_Standard.md)
- [测试标准](../03-engineering-standards/04_Testing_Standard.md)

---

## 2. 设计概述

### 2.1 系统上下文

```text
浏览器 ──HTTPS──▶ metric-center（控制面，v3-only）
                  ├─ /api/v3/platform/collection-templates|exporter-templates|candidate-fields
                  ├─ /api/v3/platform/scrape-jobs|job-groups|monitoring-rules
                  └─ /api/v3/platform/metric-library|business-metrics|blackbox-modules
                        │
        ┌───────────────┼─────────────────┐
        ▼               ▼                 ▼
   m01_* 表       M07 只读引用        promtool（规则语义校验）
   (PostgreSQL)   (resources /        （子进程，失败降级为“未执行”）
                   m07_label_templates /
                    m07_attribute_definitions)
                        ▲
                        │ pull + 同步结果回写
                  M09 配置与查询中心 ──▶ 中心 Prometheus / 各网域采集节点
```

关键约束：

- M01 **不渲染** `prometheus.yml` / `rules.yml`，**不写** M09 快照，**不触发** reload（D-2）；
- M09 以 pull 方式读取 M01 源数据（Job 的 `draft_status=ready AND enabled`、规则的 `enabled AND draft_status=ready`），并通过 `SyncResultSink` 回写 `sync_*`；
- M01 只读消费 M07 资源、标签模板与字段字典（内置字段清单 + `m07_attribute_definitions`），不写 M07 表；资源删除由 M01 周期对账回收（D40）。

### 2.2 组件职责

| 组件 | 代码位置 | 职责 |
|------|----------|------|
| Module 装配 | `platform/modules/m01/module.go` | 组装仓储/服务/Handler、注册路由、启动对账循环 |
| CollectionTemplate | `service/collection_template.go`（规划）、`repository/collection_template.go`（规划） | 采集模板 CRUD、内置模板保护、引用计数与删除保护、模板→采集实现/标签模板绑定校验 |
| Exporter | `service/exporter_template.go` | 采集实现池（软件目录） |
| 字段字典 | `service/candidate_fields.go`（规划）、`references/field_dictionary.go`（规划） | 合并 M07 内置字段与自定义字段为可选筛选字段；持有 key → 取数列/子查询映射 |
| Job | `service/job.go` | 单域 Job 校验/参数解析、选择器校验与候选查询、安装确认、targets 预演 |
| JobGroup | `service/job_group.go`、`repository/job_group.go` | 任务组扇出计划与单事务落库、组级启停、组级状态派生 |
| Rule | `service/rule.go`、`service/promtool.go` | 规则结构校验、组名唯一性、job 引用分级、promtool 语义校验 |
| Metric | `service/metric.go`、`repository/metric.go` | 技术指标库查询/用户扩展、锚点判重、JSON 锚点过滤 |
| Reconcile | `service/reconcile.go` | 60s 对账：回收已删除资源、停用失效域下的组内子 Job |
| 跨模块只读引用 | `references/` | M07 资源、标签模板与字段字典，M06 网域，M09 同步结果写回 |
| 前端 | `ui-custom/web/src/pages/strategy/` | 采集模板（含采集实现）、采集任务向导（选模板 → 定条件 → 确认实例）、规则编辑、指标库 |

### 2.3 代码结构

```text
platform/modules/m01/
├── module.go          # 组合根：仓储/服务/路由/后台循环
├── domain/            # 领域对象、不变量、参数解析、规则解析
├── dto/               # API DTO 与投影
├── handler/           # Gin handlers + 路由 + 错误映射
├── service/           # 业务服务（job / job_group / rule / metric / collection_template / candidate_fields / reconcile）
├── repository/        # GORM 仓储与 JSON 锚点查询
├── references/        # M06/M07 只读引用（含字段字典）+ M09 同步结果 sink
└── seed/              # 幂等种子（采集实现、内置模板、指标、拨测模块）
```

### 2.4 前端信息架构

一级模块：**采集策略**（`monitoring-strategy`）。

| 顺序 | 二级菜单 | 路由 | 页面 | 状态 |
|------|----------|------|------|------|
| 1 | 采集模板 | `/collectors` | `CollectorListPage`（页内 Tab：采集模板 / 采集实现） | 已实现（待按 v1.1 改造：模板吸收原「默认采集配置」，取消独立类型页） |
| 2 | 采集任务 | `/scrape-jobs` | `ScrapeJobListPage`（统一任务视图 + 三步向导） | 已实现（待改造：选模板 + 选择器） |
| 3 | 规则编辑（含告警/记录规则） | `/rules` | `RulesPage` + `RuleMountDrawer` | 已实现（文件透传） |
| 4 | 指标库 | `/metric-library` | `MetricLibraryPage` + `MetricLibraryDrawer` | 已实现（写操作仅 admin，锚点改挂模板） |

> - 独立「监控对象类型」页（`/monitor-types`）在本版删除，其能力由「采集模板」吸收；旧路由与旧接口**同步下线**（不保留只读别名），前端在同一版本内改造，避免出现第二套读模型。
> - 「采集器管理」菜单更名为「采集模板」，路由沿用 `/collectors` 以免书签失效。
> - 业务指标库（`/business-metrics`）当前只有 API 与数据层，前端页面未落地（SRS §1.2 外）。

### 2.5 能力清单

> 能力（CAP）是技术内部的复用抽象，不要求需求方理解；完整「场景 → 实现」映射见 [Module_01_Scenario_Link.md](Module_01_Scenario_Link.md)（唯一链接点），本文不维护第二份追溯表。

| CAP | 意图 | 实现模块 | 扩展点 |
|-----|------|----------|--------|
| CAP-COLLECTION-TEMPLATE | 采集模板、采集实现池、标签模板绑定、字段字典 | m01 | 新增采集模板 / 采集实现登记，无需改代码 |
| CAP-SELECTOR | 选择器求值、候选预览、实例快照 | m01 | 条件组合 `all` / `any` + M07 字段字典 |
| CAP-JOB-ORCHESTRATION | 单域 Job、跨域任务组扇出、整组启停 | m01 | 对象优先任务组 + 逐域子 Job |
| CAP-RULE-GATE | 规则结构/job 引用/PromQL 检查与提交门禁 | m01 + promtool | 分级校验 + 逃生门留痕 |
| CAP-METRIC-CATALOG | 技术/业务指标库、指标锚点、用户扩展 | m01 | 指标锚点挂采集模板 |
| CAP-SYNC-STATUS | 同步状态回写与实例采集状态回显 | m01（消费 m09） | SyncResultSink 回写 |
| CAP-RECONCILE | 资源删除对账回收、失效域子任务停用 | m01 | 对账周期回收 |
| CAP-UI-STRATEGY | 采集策略导航、任务向导、规则与指标库页面 | ui-custom/web | 菜单 / 路由注册 |
| CAP-AUTH-ADMIN | 登录鉴权与管理员写权限 | foundation | RequireAdmin 中间件 |

> 本轮无新建能力；全部复用现有 `m01` 能力。若后续需要新建，必须在本文件说明为什么不能复用/扩展。

---

## 3. 约束与关键决策

| 编号 | 决策/约束 | 影响 |
|------|-----------|------|
| D-2 | M01 只写源数据，不生成配置/不 reload | M09 负责渲染与下发；M01 通过 `SyncResultSink` 接收回写 |
| D35 | 规则统一在中心 Prometheus 求值 | 边缘配置包不含 `rules.yml`；规则 `scope` 仅 `central` |
| D36 | 规则为平台级对象、不绑网域 | `job` 引用按全平台 `ready+enabled` Job 并集校验 |
| D40 | 资源删除由 M01 周期对账回收 | 60s 对账（可配）；Job 保存仍保留实例存在性校验兜底 |
| 决策 44 | 最小授权：`RequireAdmin` | 内置采集模板与指标库写接口仅 admin；自定义模板与采集任务同权；前端同步隐藏入口 |
| v1.1 | 采集模板不带适用范围 | 模板只描述「怎么采」（采集实现 + 参数 + 标签模板）；候选范围由任务的选择器表达，避免「监控对象类型」以另一个名字复活 |
| v1.1 | 模板与采集实现 1:1 | 需要第二套采集器或参数即新增第二个模板；取消「同类型多实现 + 默认标记」 |
| v1.1 | 字段字典由 M07 提供 | M01 只持有 key → 取数（列/子查询）映射；自定义字段走 `资源 × key × value` 子查询，M07 加字段无需 M01 发版 |
| 2026-11-22 | FR-04 网域级参数覆盖**不做**（需求已删除） | 模板可复制、选择器已支持 `network_domain_id`、实例已有 `scrape_port`，域覆盖的不可替代性不足；且会让同一模板跨域隐式分叉。域级差异改用域专用模板 + 网域筛选或实例端口表达；端口链固定为三级，不预留网域层 |
| 2026-11-22 | FR-01 与 FR-21/24 职责互斥 | FR-01 只定义模板构成；FR-21/24 定义生命周期、权限与变更影响；FR-09 定义选择器求值，FR-22 只做选择器配置校验 |
| 决策 66/67-2 | 规则 job 引用分级 + 逃生门 | 存活类规则 error 阻断；勾选确认后放行并留痕 |
| 决策 69-1/69-2 | 检查与提交同口径、检查态驱动提交 | 组名唯一性纳入检查；内容变更作废检查结论 |
| — | `job_name` 唯一性按「网域 + 任务名」 | 跨域任务组的子 Job 共用同一任务名（00012 起） |
| — | 内置指标只读 + 用户扩展另存 | 用户扩展 `is_builtin=false`；不覆盖内置行 |
| — | 锚点存 JSON 数组 | `(metric_name, template_code)` 唯一性由应用层保证（DB 无法建复合唯一索引） |

---

## 4. 接口清单

字段、错误码、分页细节以 `api-contract-snapshot-v3.md` 为准；本节只列路由、权限与用途。

### 4.1 鉴权

| 入口 | 鉴权 | 说明 |
|------|------|------|
| `/api/v3/platform/*` | 用户 `AuthMiddleware` | 匿名 401；登录用户可读 |
| 内置采集模板 / 指标库写接口 | `AuthMiddleware` + `RequireAdmin` | 非 admin 403（决策 44，2026-11-19 裁定） |
| 自定义采集模板 / 采集实现池 / 采集任务写接口 | `AuthMiddleware` | 与采集任务同权，本期对登录用户开放；M03 权限点落地后细化 |

### 4.2 采集模板、字段字典与采集实现

| 方法 | 路径 | 权限 | 用途 |
|------|------|------|------|
| GET | `/collection-templates`、`/collection-templates/:code`、`/:code/impact` | 登录 | 模板目录、影响面（引用任务数、指标锚点数） |
| POST / PUT / DELETE | `/collection-templates`、`/collection-templates/:code` | 见下行 | 模板维护 |
| — | 内置模板（`is_builtin=true`）的 PUT / DELETE | admin | 内置模板仅可停用，不可删除 |
| — | 自定义模板的 POST / PUT / DELETE | 登录 | 与采集任务同权 |
| GET | `/candidate-fields` | 登录 | 选择器字段字典（M07 内置字段 + 自定义字段，只暴露 key / 类型 / 支持操作符，不暴露物理列） |
| GET / POST / PUT / DELETE | `/exporter-templates`、`/exporter-templates/:id` | 登录 | 采集实现池 |

> 旧接口 `/monitor-types*`、`/monitor-types/scope-fields`、`/ci-exporter-mappings*` 已随本版下线（未注册 → 404）；前端与脚本改用上表路由。`default_selector` 只用于新建任务的向导预填，后端从不据此求值。

### 4.3 采集任务（Job / JobGroup）

| 方法 | 路径 | 用途 |
|------|------|------|
| GET / POST / PUT / DELETE | `/scrape-jobs`、`/scrape-jobs/:id` | 单域 Job CRUD |
| GET | `/scrape-jobs/instance-candidates`、`/filter-schema` | 候选预览（兼容）+ 字段 schema（与 `/candidate-fields` 同源） |
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
| `m01_collection_templates` | 采集模板（编码、资源类别、采集实现、参数集、标签模板引用、向导预填选择器）（0023） | M01 |
| `m01_exporter_templates` | 采集实现池 | M01 |
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
| `m07_attribute_definitions` / `m07_resource_attributes` | 自定义字段定义与取值（选择器字段字典来源） | M07（只读） |

字段级结构以 migration（`00006_m01_strategy`、`00012_m01_job_groups`、`0023_m01_collection_templates`）与契约快照为准；`0020_m01_monitor_type_registry` / `0021_m01_npu_code_rename` 已被 0023 取代（Up 期完成数据搬迁后删表，Down 期按结构重建空表）。

### 5.2 关键约束

- `m01_collection_templates.code` 全局唯一、创建后不可变；内置模板仅可停用，不可删除；
- 采集模板是标签模板在 M01 的**唯一引用点**；迁移期 `m01_scrape_jobs.label_template_id` 保留为只读列（由模板派生），不再接受独立写入；
- `m01_scrape_jobs` 唯一索引 `(network_domain_id, job_name) WHERE deleted_at IS NULL`；`job_groups.name` 全局唯一（软删外）；
- `m01_metric_library` 仅对内置行建 `metric_name` 唯一索引；用户行 `(metric_name, template_code)` 由服务层判重（锚点是 JSON 数组）；
- 全部软删除（`deleted_at`）；种子按「不存在才插入」幂等，不覆盖用户改动。

### 5.3 生命周期与保留

| 数据 | 策略 |
|------|------|
| Job / 规则 / 指标 | 软删；硬删需人工介入 |
| 心跳与配置快照 | 归 M09，不在 M01 |
| 资源删除 | 60s 对账回收 Job 的 `selected_instance_ids`，并将失效域下的组内子 Job 停用（行保留） |
| 种子 | 启动幂等补齐；内置模板/模块只增不覆盖 |

---

## 6. 关键设计

### 6.1 采集模板与字段字典

- 模板是平台元数据（`m01_collection_templates`）：编码、展示名、资源类别、`exporter_template_id`、参数集、`label_template_id`、启用、内置标记。**一条模板恰好一个采集实现**，需要第二套采集器或参数就新增第二条模板。
- **模板不携带适用范围**：模板上不存任何筛选条件；范围只存在于采集任务的 `selector`（`{category, logic, filters[]}`），category 由模板继承并强校验一致。
- 模板写操作后刷新进程内快照（或直接查库 + 短缓存），供任务下拉、指标锚点、规则渲染统一读取（NFR-11）。
- 删除保护：`CountReferences` 统计采集任务 / 指标锚点引用，任一非零拒绝删除并回传清单；内置模板只允许停用。
- 停用模板：不再出现在新建任务与指标锚点候选；存量任务保留并提示。
- **字段字典**（`/candidate-fields`）由两部分合并：
  - 内置字段：M07 六类 CI 的内置字段清单 + 跨类别的归属字段（`app_code` / `biz_code` / `platform_code` / `env` / `cluster` / `owner` / `status`），服务端持有固定列映射；
  - 自定义字段：读 M07 `m07_attribute_definitions`（状态=在模型中），取数走 `EXISTS (SELECT 1 FROM m07_resource_attributes WHERE resource_id=r.resource_id AND attribute_key=? AND value?)`，key 与 value 全参数绑定；
  - 字典只暴露 `key / label / value_type / 支持的操作符 / 适用类别`，**不暴露物理列名**。
- 选择器求值：`all` → AND 拼接、`any` → OR 拼接；值类型为 boolean 的字段只允许 `eq/in` 且值必须是 true/false；`regexp` 使用 PostgreSQL `~*`（已无 SQLite 方言分支）。

### 6.2 参数层叠与端口解析

- 参数解析顺序：Job 显式值 → 采集模板 → 采集实现（exporter）→ 系统默认；解析结果落 Job 参数快照（间隔、超时、认证 / TLS、采集路径等），并计算 `template_overrides` 标记被覆盖字段。
- 端口**不进入 Job 快照**，每次预览 / 生成时实时求值：
  - 本期（MVP）三级链：Resource `scrape_port` → 采集模板默认端口 → 类别兜底（数据库 / 中间件回退业务端口；主机回退采集实现默认端口）。
  - 旁路：`application` 直接使用资源自身端口；`generic_target` 使用资源端口，缺失时按 scheme 回落 443/80。
  - 不做网域级覆盖：域级差异用域专用模板 + 按 `network_domain_id` 筛选，或实例 `scrape_port`；同一模板在不同网域保持确定行为。
- 「同步模板默认值」按模板重算参数并清空对应 override；端口按链实时求值，不受该操作影响。
- 保存前强制校验：任务名、模板存在且启用、选择器 category 与模板资源类别一致、网域已纳管、参数格式与 `timeout < interval`、实例存在/类别/同域/离线规则、凭据完整性。标签模板类别由模板保证，Job 不再重复校验。

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

- 指标 ↔ 采集模板为多对多，锚点元素 `{template_code, source_exporter}` 以 JSON 数组存储；同名不同义用 `source_exporter` 区分。
- 查询过滤：`template_code` 直接匹配锚点；`resource_category` 先由模板表展开为该类别下的启用模板集合，再匹配锚点（PostgreSQL `jsonb_array_elements`）。
- 内置指标只读；用户扩展由管理员创建，服务层强制 `is_builtin=false`，并校验 Prometheus 命名、标签键、锚点类型存在且启用。
- 判重：同名 + 任一相同锚点 → 409（内置行与用户行一起参与）；锚点是 JSON 数组，暂由应用层保证唯一性。

### 6.6 同步状态与对账回收

- 源数据变化（保存/启停/删除）时，M01 将 Job/规则置 `sync=pending` 或 `draft`；M09 生成完成后通过 `SyncResultSink` 回写 `synced/failed` 与版本、时间。
- 前端保存后 best-effort 触发 M09 配置草稿生成；M09 侧 30s watcher + 60s 兜底，M01 不主动通知（单向依赖）。
- 对账循环（默认 60s，`Options.ReconcileInterval`）：回收已删除资源；域被禁用/退纳管时停用组内子 Job，不删除。

---

## 7. 关键流程

### 7.1 新建采集模板并挂指标

浏览器（admin 建内置 / 登录用户建自定义）→ `POST /collection-templates` → 校验编码、采集实现存在、标签模板类别一致 → 落库 + 刷新快照 → `POST /metric-library`（锚点选新模板）→ 命名/标签/锚点校验 + 同名同锚点判重 → 指标库列表按新模板可筛。

### 7.2 对象优先创建采集任务

选任务类型（采集/拨测）与采集模板 → 编辑选择器（`category` 由模板继承 + 条件行来自 `/candidate-fields`）→ 实时命中数与分域预览 → 选定/排除实例 → `POST /job-groups` → `buildPlan` 逐域解析参数并校验 → 单事务写组 + 子 Job（`sync=pending`）→ 前端触发配置草稿 → M09 生成并回写同步状态。

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
| 写权限 | 内置采集模板与指标库写接口 `RequireAdmin`；自定义模板、采集实现池与采集任务对登录用户开放；前端隐藏入口，服务端 403 兜底 |
| 凭据 | 认证密码/Token 不随响应返回，仅返回 `credential_configured`；编辑留空时继承原值 |
| **凭据加密（技术债）** | 当前 `sealCredential` 仅写入 `plain:` 前缀占位，**未加密**；生产前必须接入 KMS/密钥派生（M03 安全项） |
| 规则门禁 | 存活类规则引用不存在 Job 默认阻断；逃生门需显式确认并留痕 |
| 输入校验 | 任务名/指标名/标签键正则；规则内容 ≤1MB；枚举字段 DB CHECK |
| 注入防护 | 选择器字段来自字段字典的 key → 取数映射，不接受自由列名；值一律参数绑定（含自定义字段的 `attribute_key`）；PromQL 校验通过子进程 promtool，不经 shell 拼接 |
| 上游隔离 | M01 不访问外部 URL、不代理查询；配置与 reload 归 M09 |

---

## 10. 性能与容量

| 项 | 设计/现状 |
|----|-----------|
| 分页 | 默认 20/页，`page_size` 上限 100（契约） |
| 选择器求值 | 内置字段走固定列（归属类列已建索引）；自定义字段走 `m07_resource_attributes` 的 `EXISTS` 子查询，需 `(resource_id, attribute_key)` 索引；高频筛选项建议评估生成列或物化 |
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
| 健康检查 | `/api/v3/platform/health`、`/api/v3/platform/ready`、`/api/v3/platform/ready`（全局） |
| 后台循环 | 资源对账 60s（`Options.ReconcileInterval` 可配） |
| 关键配置 | `METRIC_CENTER_DB_DRIVER`、`PROMTOOL_BIN`（默认 `promtool`） |
| 依赖工具 | `promtool` 需在 PATH；不可用时规则 PromQL 校验降级为「未执行」仅提示 |

---

## 12. 测试与验证

> 本节只写测试策略与覆盖范围；测试清单与执行证据见 acceptance / walkthrough，不在本文复制。

- 单元：参数层叠与 override、端口链、任务名/指标名/标签校验、锚点判重、组扇出计划、组级启停级联、规则结构/组名/job 引用、目录刷新。
- 集成：模板新增 → 立即挂指标 → 按模板筛选；选模板 + 选择器 → 命中数预览 → 单事务组+子 Job → 整组启停 → 同步回写；规则检查 → 提交门禁 → 逃生门。
- 契约：路由/字段/错误类型与 `api-contract-snapshot-v3.md` 一致；非 admin 写接口 403。
- 具体用例与命令见测试代码、`design-notes/` 与 `docs/03-engineering-standards/04_Testing_Standard.md`。

---

## 13. 场景链接

> 完整“场景 ↔ 设计 ↔ 演示 ↔ 验收”唯一链接点：[Module_01_Scenario_Link.md](Module_01_Scenario_Link.md)。
> 本文不再维护第二份 FR→设计章节表；场景演示脚本见 `docs/05-execution-records/module-01/scenario-walkthrough.md`。

场景与实现的完整映射见 Scenario Link §2（本文不维护）；NFR 覆盖见 Scenario Link §3。

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
| `METRIC_CENTER_DB_DRIVER` | postgres | 固定为 postgres（PostgreSQL-only，旧 sqlite 取值已拒绝） |
| `PROMTOOL_BIN` | promtool | promtool 可执行文件路径 |

---

## 15. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-11-20 | 首版：由 M01 SRS v1.4 派生概要设计；字段级契约回归 `api-contract-snapshot-v3.md`；规则检查门禁下沉为设计专题；补任务组扇出/整组启停、指标库用户扩展、管理员写权限、对账回收与同步回写 |
| v1.1 | 2026-11-20 | **采集模板化（跟随 SRS v1.5，owner 拍板）**：①§2.1 上下文与路由改为 `collection-templates / exporter-templates / candidate-fields`，M07 只读引用增补 `m07_attribute_definitions`；②§2.2 组件职责以 CollectionTemplate + 字段字典取代 MonitorType/Mapping，§2.3 服务清单同步；③§2.4 前端 IA 由 5 项收敛为 4 项，删除 `/monitor-types` 页（旧路由同步下线），`/collectors` 语义升级为「采集模板」+ 页内「采集实现」Tab；④§3 新增三条决策：模板不带适用范围、模板与采集实现 1:1、字段字典由 M07 提供；决策 44 收口到「内置模板 + 指标库」；⑤§4.1/§4.2 权限与接口清单重写（内置模板 admin、自定义模板与任务同权；新增 `/candidate-fields`；旧 `/monitor-types*`、`/ci-exporter-mappings*` 直接下线）；⑥§5 数据设计：`m01_collection_templates`（0023）取代类型/规则/映射三表，补自定义字段表只读引用与「模板是标签模板唯一引用点」约束；⑦§6.1 重写为「采集模板与字段字典」（含自定义字段 `EXISTS` 子查询与操作符收敛），§6.2 参数层叠与端口链改按模板，§6.5 指标锚点改 `template_code`；⑧§7.1/§7.2 流程改写（选模板 → 定条件 → 确认实例）；⑨§9 注入防护、§10 选择器性能、§12 集成用例、§13 追溯同步 |
| v1.2 | 2026-11-22 | **场景优先试点（对齐 M09，跟随 SRS v1.6）**：①标题/元数据去除模块编号作为设计边界，新增 Domain ID、实现模块、Scenario Link 与场景演示脚本引用；②§1.1 增加场景→实现映射说明；③新增 §2.5 场景→实现映射（SCN-01~06 / CAP / m01 / HLD 章节 / 演示脚本）与能力图例；④§13 原 FR→设计追溯表迁移到 Scenario Link，改为引用唯一链接点 |
| v1.3 | 2026-11-22 | **FR 重叠与端口口径收敛（跟随 SRS v1.7）**：①§3 新增两条决策——FR-04 本期不实现/端口链本期三级，FR-01 与 FR-21/24 职责互斥；②§6.2 明确端口不进 Job 快照、按链实时求值，本期三级链与 FR-04 启用后的四级插入点分开表述 |
| v1.4 | 2026-11-22 | **删除 FR-04 网域级参数覆盖（跟随 SRS v1.8）**：①§3 决策改为「不做」，并记录理由与替代方案——域专用模板 + `network_domain_id` 筛选，或实例 `scrape_port`；②§6.2 删除网域层插入点，端口链固定为三级，明确同一模板跨网域行为确定 |
| v1.5 | 2026-11-22 | **文档分层与对外验收衔接（跟随 SRS v1.9）**：①§2.5「场景→实现映射」改为「能力清单」，移除 SCN 行，SCN↔实现矩阵只保留在 Scenario Link；②§12 明确只写测试策略与覆盖范围，证据见 acceptance/walkthrough；③§13 场景映射引用改为 Scenario Link §2；④头部新增对外验收说明书引用 |
