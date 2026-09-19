# API 契约快照 — Module 07 监控对象管理

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。
>
> 模板：`docs/05-execution-records/_api-contract-snapshot.template.md`

## 0. 快照元信息

| 项 | 值 |
|----|----|
| Phase | Phase 2 |
| 模块 | module-07-resource-management |
| 分支 | feat/module-07-resource-management |
| 版本 | v2026-09-05（第 2 版：契约增量重派生，对齐 PRD v2.30）；**v2026-09-19 增量（v2.41，决策 92~97）**：追加应用字典管理 API、资源必填分化口径、Excel 声明导入契约，见 §5A / §10A / §13 |
| 生成方式 | v2026-08-23 由已落地后端路由 + 前端类型反向回填；**v2026-09-05 重派生**覆盖决策 47-3 `collection_status` 三态筛选（PRD v2.22~v2.25 口径收敛）与 v0.2 `Resource.scrape_port`（v2.26 范围收敛落版）；**v2026-09-19 增量**由 PRD v2.40→v2.41 + design-decisions.md 决策 92~97 派生 |
| 来源 | PRD `Module_07_Monitoring_Object_Management.md` v2.30 §3/§5/§6/§8/§9/§11；`03_API_Standard.md` §7；`task-sequence.yaml`；`platform/config/{resource,label}/routes.go`；design-decisions.md 决策 92~97（v2.41） |

## 1. 通用契约

### 1.1 前缀与响应

- 所有接口挂在 **`/api/v2/platform`** 平台组下（与 M06 网域登记一致；PRD §6 原文写 `/api/v1`，以实际实现为准，见 §2）。
- 统一响应格式（`03_API_Standard §3`，`platform/api/response`）：

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

### 1.2 errorType 枚举

`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict`（唯一性/引用共存冲突）。

### 1.3 分页信封（关键差异，分两种形态）

| 接口 | 信封 | 说明 |
|------|------|------|
| 资源列表 `GET /resources` | `{ list, total, page, page_size }` | list 键；page 默认 1、page_size 默认 50、上限 100 |
| 标签模板列表 `GET /label-templates` | `{ list, total, page, page_size }` | list 键；默认 1/50，上限 100 |
| 导入记录列表 `GET /imports` | `{ list, total, page, page_size }` | list 键 |
| 关联实例 `GET /label-templates/:template_id/resources` | `{ items, total, page, page_size }` | **items 键**；默认 1/10，上限 100（前端为此单独声明 `TemplateInstancePage`，不复用 `Paginated`） |
| 资源标签 `GET /resources/:resource_id/labels` | `{ items, total }` | items 键，不分页 |

> ⚠️ 前端消费时必须按接口区分 `list` / `items` 信封；空结果一律返回 `[]` 而非 `null`。

## 2. 路径偏差说明（PRD → 实际实现）

| PRD §6 原文 | 实际实现（前端消费） | 原因 |
|-------------|---------------------|------|
| 前缀 `/api/v1` | 前缀 `/api/v2/platform` | M07 归入平台组，与 M06 一致 |
| `POST /api/v1/resources/import` | `POST /api/v2/platform/resources/{resource_category}/import` | Gin 通配符约束（同一层级仅允许同名参数），`:resource_id` 位置承载 type，对外形态不变（见 `resource/routes.go` 注释） |
| `GET /api/v1/resources/import-templates/{resource_category}` | `GET /api/v2/platform/resources/{resource_category}/template` | 同上 |

## 3. 资源管理 API

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/resources` | `resource_category`（必填）、`network_domain_id`、`keyword`（名称+IP 模糊）、`collection_status`（决策 47-3 三态筛选：`up`=采集中 / `down`=已下发未采到 / `unmonitored`=未监控）、`is_monitored`（透传预留，M01 未实现时不生效）、`page`、`page_size` | `{list,total,page,page_size}`，item = §5.2 字段 + 派生采集状态（见下注） | `bad_request`：resource_category 缺失/非法 | §6.1/6.6.1 |
| POST | `/resources` | `ResourceCreateInput`（见 §10） | 创建后的完整对象 | `bad_request`：必填缺失 / `network_domain_id` 不存在（M06 行政记录） | §6.6.1 |
| PUT | `/resources/:resource_id` | `ResourceUpdateInput`（resource_category/source_type 创建后不可改，不随请求体） | 更新后的完整对象 | `not_found`；`bad_request` | §6.6.1 |
| DELETE | `/resources/:resource_id` | — | `{ resource_id }` | `not_found`；`forbidden`：被 Module_01 的 ScrapeJob 引用时禁止删除（报错 data 返回引用 Job 名单） | §6.1/6.6.1 |
| GET | `/resources/:resource_category/template` | — | Excel 模板下载（含「取值说明」sheet：M06 网域清单） | `not_found`：未知资源类型 | §6.1 |
| POST | `/resources/:resource_category/import` | multipart：`file` + `resource_category` + `mode` | `ImportResult`（`{total,success,updated?,failed,errors[]}`，errors item = `{row,field,value?,reason}`） | `bad_request`：文件格式/必填列缺失/非法 mode | §5.16/6.6.1 |

> **{v2.41 决策 97} Excel 内联声明 sheet（新增）**：资源导入文件 `file` 可包含 `业务声明`（列 `biz_code|biz_name|说明?`）与 `应用声明`（列 `app_code|app_name|说明?`）两个内联 sheet，用于一次导入携带全新业务/应用。校验顺序：①声明自身（编码 BIZ_CODE_RE/APP_CODE_RE、声明内重码去重、与存量同名且 name 不一致则**硬拒绝绝不覆盖**、不可激活停用条目）→②资源可达性（字典 ∪ 声明）→③整体写。声明建出字典条目 `status=enabled`、`source=excel-import`、只增不覆盖（web 下拉可用、不依赖资源存活）；与资源同批**原子提交、任一失败整体回滚**（SQLite 事务）。权重复用「导入资源」权限位，不额外收紧。资源引用的码既不存也非声明 → 报错归入「待登记清单」兜底、不静默跳过。

> **采集状态三态（决策 47-3；口径收敛 2026-09-02，PRD v2.25/v2.30）**：列表「采集状态」列展示三态 badge——`采集中`（被 ScrapeJob 选中且 target `up`）/ `已下发未采到`（被选中但未采到数据：`down` / 待首次抓取 / **变更未确认下发**）/ `未监控`（未被任何 Job 选中）。数据 = M01 选中关系 `is_monitored`（取 DB 当前 `selected_instance_ids`、ready+enabled Job，**不问 M09 `change_status`、不感知下发时序**）+ M02 健康度/覆盖率 API（`up` 聚合，按 `resource_id` 稳定身份标签回连，MVP 起提供）。**M07 只读消费、不直连时序数据**：列表级查询走 M02 聚合 API 一次性获取，**禁止逐行查询**（TQ-6 N+1 教训）；响应 item 上的采集状态为**派生字段**（如 `collection_status`），非 Resource 落库字段。「待采集 vs 已下发未采到」细分由 M01 Job 回显承担（M01 §5.10/快照 §6）；「未纳入任何 Job」同步可在 M01 实例选择器筛选；异常驱动展示——仅「已下发未采到」高饱和。

## 4. 资源标签 API

| 方法 | 路径 | 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|--------|-----------|----------|--------|
| GET | `/resources/:resource_id/labels` | — | `{items,total}`；item = `{id,key,value,source,source_map?}`；按来源优先级排序（system / user / cmdb） | `not_found` | §6.2/6.6.2 |
| POST | `/resources/:resource_id/labels` | `{key,value}` | 新增的 user 标签 | `forbidden`：resource_category ≠ application；`bad_request`：key 规则非法 / 覆盖 system/cmdb 标签 | §6.6.2 |
| PUT | `/resources/:resource_id/labels/:label_id` | `{value}` | 更新后的 user 标签 | `forbidden`：非 user 来源；`not_found` | §6.6.2 |
| DELETE | `/resources/:resource_id/labels/:label_id` | — | `{label_id}` | `forbidden`：非 user 来源；`not_found` | §6.6.2 |

> **写接口边界**：user 来源写接口仅对 `resource_category=application` 开放；host / middleware / generic_target 标签只读。

## 5. 业务分组字典（只读）

| 方法 | 路径 | 请求体 / Query | 响应 data | 业务错误 | PRD 源 |
|------|------|----------|-----------|----------|--------|
| GET | `/business-domains` | — | `{list:[{code,name,description?,enabled}], total}`：`BusinessDomain[]` | — | §3.1/6.1 |
| POST | `/business-domains` | `{code,name,description?}`（`code`=biz_code，编码规范小写字母/数字/连字符 ≤64 且永不可改；`source` 服务端设 manual） | 创建后的完整对象 | `bad_request`：编码重复 / 编码不规范 | §6.1 |
| PUT | `/business-domains/:code` | `{name?,description?,enabled?}`（**请求体不接收 code**） | 更新后的完整对象 | `bad_request`：`infra` 兜底条目禁止停用；`not_found` | §6.1 |

> 字典落 DB、web 管理页维护；`platform/config/business_domains.yaml` 仅首次启动 seed，热加载退役（决策 48 / §5.18）。停用（`enabled=false`）条目不可被新资源选用；强制预置兜底条目 `infra`（禁止停用/删除）。**{v2.41 决策 97}**：`source` 来源扩展 `manual` / `excel-import` / `cmdb` {v0.4+}；Excel 导入「业务声明」sheet 建出的条目 `enabled=true`、`source=excel-import`、只增不覆盖（见 §6.1 Import）。

## 5A. 应用字典 API（v2.41 决策 92/96，新增）

> **定位**：应用字典是 `app_code → app` 标签的取值权威，与业务分组字典（§5）同构；业务与应用**正交两维**（决策 96，本字典不设父级 `biz_code`）。`app_code` 主键创建后不可变（编码规范小写字母/数字/连字符 ≤64）、`app_name` 必填展示名（修改不触发监控配置重生成）、`status` 停用不删除；资源侧 `app_code` 只允许引用未停用条目。**首次 seed** 以存量资源 app 取值归一化生成。

| 方法 | 路径 | 请求体 / Query | 响应 data | 业务错误 | PRD 源 |
|------|------|----------|-----------|----------|--------|
| GET | `/application-dict` | — | `{list:[{app_code,app_name,description?,enabled}], total}`：`ApplicationDictEntry[]` | — | §5.19/§3.1/6.1 |
| POST | `/application-dict` | `{app_code,app_name,description?}`（`app_code` 编码规范同 biz，永不可改；`source` 服务端设 manual） | 创建后的完整对象 | `bad_request`：编码重复 / 编码不规范 / `app_name` 缺失 | §5.19/6.1 |
| PUT | `/application-dict/:app_code` | `{app_name?,description?,enabled?}`（**请求体不接收 app_code**） | 更新后的完整对象 | `bad_request` / `not_found` | §5.19/6.1 |

> **展示名解析**：资源列表/详情「应用」列展示 `app_name`（前端经 `GET /application-dict` 按 `app_code` 解析）；字典缺条回退显示 `app_code`。停用条目 UI 标识「应用名（已停用）」。**{v2.41 决策 97}**：`source` 来源扩展同 §5；Excel 导入「应用声明」sheet 建出条目 `enabled=true`、`source=excel-import`、只增不覆盖。

## 6. 导入记录 API

| 方法 | 路径 | Query | 响应 data | PRD 源 |
|------|------|-------|-----------|--------|
| GET | `/imports` | `resource_category`、`status`、`page`、`page_size` | `{list,total,page,page_size}`，item = `ImportRecord` | §6.4/6.6.4 |
| GET | `/imports/:import_id` | — | `ImportRecord`（含 errors 明细） | §6.4 |

`ImportRecord` 字段：`{id, import_no, resource_category, mode, total, success, updated, failed, status, errors[], operator, created_at}`；status ∈ `success` / `partial` / `failed`。

## 7. 标签模板 API

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | `/label-templates` | `resource_category`、`is_default`、`keyword`、`page`、`page_size` | `{list,total,page,page_size}`，item = `LabelTemplateListItem`（含完整 mappings + `instance_count`） | — | §6.3/6.6.3 |
| POST | `/label-templates` | `{name, resource_category, description?, mappings?}` | 创建的模板（`is_default=false`） | `bad_request`：同名同资源类型 / 非法 mapping | §6.6.3 |
| PUT | `/label-templates/:template_id` | `{name?, description?}`（resource_category 创建后不可改，不随请求体） | 更新后的模板 | `not_found`；`bad_request` | §6.6.3 |
| DELETE | `/label-templates/:template_id` | — | `{template_id}` | `bad_request`：默认模板禁止删除；`forbidden`：被 Module_01 引用时禁止删除 | §6.6.3 |
| POST | `/label-templates/:template_id/clone` | `{name?}` | 克隆后的新模板（含全部 mappings，is_default=false） | `not_found` | §6.6.3 |
| GET | `/label-templates/:template_id/resources` | `page`、`page_size`（默认 1/10） | `{items,total,page,page_size}`，item = `{resource_id, instance_name, status}` | `not_found`：模板不存在/已软删 | §6.3/6.6.3 |

## 8. 字段映射 API

| 方法 | 路径 | 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|--------|-----------|----------|--------|
| POST | `/label-templates/:template_id/mappings` | `MappingInput`：`{target_label, source_type, source_field?, transform_rule?}` | 新增后的 mappings 列表 | `bad_request`：保护 label / 同模板 target_label 重复 | §6.6.3 |
| PUT | `/label-templates/:template_id/mappings/:mapping_id` | 部分 `MappingInput`（编辑自身排除唯一性校验） | 更新后的 mappings 列表 | `not_found`；`bad_request` | §6.6.3 |
| DELETE | `/label-templates/:template_id/mappings/:mapping_id` | — | `{mapping_id}` | `not_found` | §6.6.3 |

> **组合字段语义**：模板 API 只保存映射规则（`source_field=instance_ip:port`、`source_type=composite`），不保存任何实例值；`instance` 标签出值由 Module_09 生成配置时拼接（§5.12）。

## 9. 枚举字典

| 枚举 | 取值 | 说明 |
|------|------|------|
| `resource_category` | `host` / `database` / `middleware` / `application` / `generic_target` | 五类权威枚举；UI 展示名「资源类型」 |
| `resource_status` | `online` / `offline` / `maintenance` | UI 展示名「运行状态」；Excel 外部状态经 `status_mapping` 映射到该枚举 |
| `collection_status`（派生） | `up`（采集中）/ `down`（已下发未采到）/ `unmonitored`（未监控） | 采集状态三态筛选/展示枚举（决策 47-3），**非落库字段**；数据 = M01 选中关系 + M02 健康度聚合 |
| `source_type` | `manual`（创建恒为 manual）/ `import` / `cmdb` | `resource_category` 创建后不可改 |
| `label_source` | `system` / `user` / `cmdb` | 排序优先级 system > user > cmdb（v0.4+） |
| `import_mode` | `create_only`（默认）/ `upsert` | |
| `import_record.status` | `success` / `partial` / `failed` | |
| `env` | `dev` / `test` / `staging` / `prod` | 合法环境集合 |
| `protocol` | `http` / `https` / `tcp` | |
| `scheme` | `http` / `https` | |
| `mapping.source_type` | `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field` | |
| 保护 label | `instance` / `job` / `scheme` / `__address__` 等 | `PROTECTED_PROMETHEUS_LABELS`；composite → instance 例外 |
| `biz_code` 规范 | 小写字母/数字/连字符，≤64；永不可改 | 上线前须命名评审；强制预置 `infra`（禁止停用/删除） |
| `app_code` 规范 | 小写字母/数字/连字符，≤64；永不可改 | {v2.41 决策 92} `app` label 的取值来源；禁止用展示名 `app_name` 当编码/映射来源 |
| `dict_source` | `manual` / `excel-import` / `cmdb` {v0.4+} | {v2.41 决策 97} 字典来源；`excel-import` 条目 `enabled=true`、只增不覆盖 |
| label key 规则 | 小写/下划线，禁止 `__` 开头，≤128 | |

## 10. 字段必填口径

### 10.1 资源创建（POST /resources）

- 必填：`resource_category`（创建必传）、`network_domain_id`（M06 网域，须存在）、`env`
- **{v2.41 决策 93/95} `biz_code` / `app_code` 必填按类型分化**：见 §10A。历史 v2.30 口径「`biz_code` 全类型必填」已撤销。
- 可选：`cluster`、`owner`、`status`（默认 `online`）、`scrape_port`（{v0.2} 实例级采集端口覆盖，可选；留空由 M09 按「网域覆盖表 `CITypeExporterMappingOverride` → `CITypeExporterMapping.default_port` → `ExporterTemplate.default_port`」解析，见 Module_01 §5.1 端口一致性）
- 服务端固定：`source_type=manual`、`tenant_id=platform_admin`、`resource_id`（M07 生成 uuid）
- 差异化字段按类型：host（`instance_name`/`instance_ip`/`os_type?`）、database（`database_type`/`instance_ip`/`port`/`version?`）、middleware（`middleware_type`/`instance_ip`/`port`/`version?`）、application（`service_name`/`endpoint`/`health_check_url?`/`protocol?`/`port?`）、generic_target（`target_name`/`instance_ip`/`port?`/`metrics_path?`/`scheme?`/`exporter_type?`/`custom_labels?`）

### 10.2 资源更新（PUT /resources/:resource_id）

- 仅可更新：`network_domain_id`/`biz_code`/`app_code`/`env`/`cluster`/`owner`/`status`/`scrape_port` + 各类型差异化字段
- 不可改：`resource_category`、`source_type`（不随请求体）
- `biz_code`/`app_code` 必填分化同 §10A；编辑已属停用条目时提示并允许保留历史值

### 10A. {v2.41 决策 93/95} `biz_code`/`app_code` 必填分化口径（新增）

| 类型 | `biz_code` | `app_code` | 说明 |
|------|-----------|-----------|------|
| host | 可空可后补 | 可空 | 静态资源登记仅应用概念、无业务，`biz` 常缺 |
| database | 可空可后补 | 必填（MVP 1 实例 = 1 主 app_code；多库 1:N 延后 v0.2+，决策 94） | |
| middleware | 可空可后补 | 必填 | |
| application | **必填**（上线后） | 必填 | 应用上线跑起来后才出现业务 |
| generic_target | 二选一（与 app_code） | 二选一（与 biz_code） | app/biz **至少填一个**（决策 95），不会全空致指标无归属 |

> 空值语义：`biz_code`/`app_code` 空值**不注入** `biz`/`app` 标签（复用既有空值不注入语义）；前端展示留空（-）。`app_code` 只允许引用应用字典**未停用**条目；`biz_code` 引用启用业务条目（host/db/middleware 为空时不校验存在性）。未归类口径（M05）：`biz_code` 空=未归类业务、`app_code` 空=未归类应用，并存。

### 10.3 标签模板

- 创建：`name`（必填）、`resource_category`（必填）、`description?`、`mappings?`
- 更新：仅 `name?` / `description?`；`resource_category` 创建后不可改

### 10.4 映射（Mapping）

- 创建：`target_label`（必填，同模板唯一）、`source_type`（必填）、`source_field`（必填，composite 时 = `instance_ip:port`）、`transform_rule?`（留空 = 原样透传）

### 10.5 导入

- `mode`（默认 `create_only`）/ `resource_category` / `file` 必填

## 11. UI 展示名映射（字段 ↔ 用户语言）

| 接口字段（snake_case） | UI 展示名 | 备注 |
|------------------------|-----------|------|
| `resource_category` | 资源类型 | 禁止直接展示 `host` 等英文枚举裸值 |
| `network_domain_id` | 所属网域 | 下拉数据来自 M06 网域登记 |
| `biz_code` | 业务分组 | 下拉数据来自 `GET /business-domains`；v2.41 决策 93 按类型可空（host/db/mw 可后补，空态 '-'） |
| `app_code` | 应用 | {v2.41 决策 92} 二元组：选应用字典 `app_code`，回显 `app_name`（字典缺条回退显示 `app_code`）；停用条目「应用名（已停用）」标识；下拉数据来自 `GET /application-dict` |
| `app_name` | 应用名（展示名） | {v2.41 决策 92} label 存 `app_code`，`app_name` 仅 UI 展示；改展示名不触发配置重生成 |
| `env` | 环境 | |
| `status` | 运行状态 | |
| `owner` | 负责人 | |
| `instance_ip` / `port` | 实例 IP / 端口 | |
| `target_label` | 目标标签 | |
| `source_field` / `source_type` | 来源字段 / 来源类型 | |
| `instance_count` | 关联实例数 | |
| `scrape_port` | 采集端口 | {v0.2} 实例级采集端口覆盖；留空由 M09 解析链取默认 |
| `collection_status` | 采集状态 | 三态 badge（采集中 / 已下发未采到 / 未监控，决策 47-3）；「已下发未采到」高饱和展示 |

## 12. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3（核心功能）/ §5（数据模型）/ §6（接口设计）/ §8（状态机）/ §11（前端交互契约）
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7（字段/分页/枚举契约）
- 序列：`docs/05-execution-records/module-07/task-sequence.yaml`
- 设计决策：`docs/05-execution-records/module-07/design-decisions.md` 决策 92~97（v2.40/v2.41，本版增量的权威依据）

## 13. 跨模块契约登记（v2.41 决策 94，新增）

> **decision 94（database/middleware 的 1:N 应用归属）**：MVP 维持「database / middleware 实例级 = 1 行资源 = 1 个主 `app_code`」。多库/多 schema 分属不同应用的 1:N 延后 **{v0.2+}**，作为**跨 M01 / M09 待确认点**——「共享实例到底按 schema 下沉资源粒度，还是由 exporter 在采集层按库打 `app` 标签」需 M01（scrape target 粒度 / exporter 按 schema 打标）与 M09（target 生成层级）一起定，**M07 不在单模块拍板**。本版仅标注口径与资源模型注释，不落地任何 1:N 数据模型字段变化。
