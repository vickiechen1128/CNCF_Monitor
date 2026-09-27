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
| 版本 | v2026-09-05（第 2 版：契约增量重派生，对齐 PRD v2.30）；**v2026-09-19 增量（v2.41，决策 92~97）**：追加应用字典管理 API、资源必填分化口径、Excel 声明导入契约，见 §5A / §10A / §13；**v2026-09-25 增量（v2.42 / v2.43，决策 98 / 101 / 102；v2026-09-27 增量 决策 98/102-③、103 scheme-B）**：云字典只读 API（§5B）、`cloud_code` 升格 NetworkDomain 行政字段与资源派生字段（§10B）、资源列表派生只读 `cloud_code`/`zone_type` 与 `cloud`/`zone`/`network_domain` 三标签派生口径（§3 注 / §10C / §11）、`cloud_type`/`carrier` 描述性元数据边界（前端红-line ④，§9）、Excel `cloud_code` 列移除与历史值归一（§10B.3） |
| 生成方式 | v2026-08-23 由已落地后端路由 + 前端类型反向回填；**v2026-09-05 重派生**覆盖决策 47-3 `collection_status` 三态筛选（PRD v2.22~v2.25 口径收敛）与 v0.2 `Resource.scrape_port`（v2.26 范围收敛落版）；**v2026-09-19 增量**由 PRD v2.40→v2.41 + design-decisions.md 决策 92~97 派生 |
| 来源 | PRD `Module_07_Monitoring_Object_Management.md` v2.30 §3/§5/§6/§8/§9/§11；`03_API_Standard.md` §7；`task-sequence.yaml`；`platform/config/{resource,label}/routes.go`；design-decisions.md 决策 92~97（v2.41）；`platform/config/resource/cloud_dict.go` + `platform/models/cloud_dict.go`（`CloudDict`/`CloudType`/`CloudCarrier`）、决策 98/102-③/103 scheme-B（v2026-09-27 增量） |

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
| 云字典列表 `GET /cloud-dict` | `{ list, total }` | list 键；**含停用项**（前端筛启用项自行过滤） |

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

> **云/区派生（决策 103 scheme-B）**：资源列表/详情响应 item 上的 `cloud_code` / `zone_type` 为**派生字段**（非 Resource 落库字段），由 `network_domain_id` 关联网域的 `cloud_code` / `zone_type` 实时批量派生（list.go 一次性映射，禁止 N+1；空网域回退 `""`）。由此派生的 `cloud`（= 网域 `cloud_code`）/ `zone`（= 网域 `zone_type`）是 target 的系统标签（configcenter generator），**资源侧不落、不写 cloud 标签**；`cloud_type`/`carrier` 仅云字典条目描述属性，**绝不**作为独立分类轴或筛选维度（前端红-line ④）。

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

## 5B. 云字典 API（只读，决策 98 / 102-③ / 103 scheme-B，新增）

> **定位**：云字典是 **NetworkDomain.cloud_code** 的**取值权威**（决策 103 方案 B 后，消费方由「资源侧录入/编辑/导入」改为「M06 网域登记 cloud_code 必填且引用启用条目」）；与业务分组字典（§5）、应用字典（§5A）同构，但**部署级只读**——随 seed / 部署配置预置，**不提供任何写接口与管理界面**（决策 102-③，既无用户自助登记页也无平台管理员页），增删改随版本发版。`cloud` / `zone` / `network_domain` 三标签改在 target 级 system 层注入（见 §10C），不再经 `cloud_code → cloud` 模板映射。
>
> **一个云 = 云类型 × 云载体的组合整体**：`cloud_code` 为 `{类型}-{载体}` 复合码（大写短码），`cloud_type` / `carrier` 仅为条目**描述属性**（用于展示 / 分类），**不是告警维度、不独立成 label、不得在 UI 独立成列或筛选维度**（红线⑥：`TX` 只是载体，腾讯云的云标识是 `PUB-TX`，不得把 `TX` 等同于「公有云」）。资源本身**不落 cloud_code**（决策 103 scheme-B），其 `cloud`/`zone`/`network_domain` 三标签一律经 `network_domain_id` 派生（见 §3 派生注 / §11）。

| 方法 | 路径 | 请求体 / Query | 响应 data | 业务错误 | PRD 源 |
|------|------|----------|-----------|----------|--------|
| GET | `/cloud-dict` | — | `{list:[CloudDict], total}`：`CloudDict[]`（**含停用项**） | — | §5.20 / M06 |

`CloudDict` 字段：`{cloud_code, cloud_name, cloud_type, carrier, enabled}`

| 字段 | 类型 | 说明 |
|------|------|------|
| `cloud_code` | string | 不可变复合编码（如 `PUB-TX` / `GM-CU`），资源 `cloud` 标签与网域登记的唯一取值；seed 预置 `PUB-TX`（启用）、`GM-CU`（启用，规划中） |
| `cloud_name` | string | 展示名（如「腾讯云」「政务云（联通）」） |
| `cloud_type` | enum | `PUB` 公有云 / `GM` 政务云 / `IND` 行业云 / `PRI` 私有云；**描述性元数据，非独立筛选维度** |
| `carrier` | enum | `TX` 腾讯 / `CU` 联通 / `CM` 移动；**描述性元数据，非独立筛选维度** |
| `enabled` | bool | 是否启用；停用的 `cloud_code` 不可被 M06 网域登记引用（登记接口 `validateCloudCodeEnabled` 硬校验），资源侧亦不可引用 |

- **禁止**：`POST` / `PUT` / `DELETE` `/cloud-dict*`（无写接口）；前端不得提供登记/编辑/删除入口。
- **seed 登记**（幂等，按 `cloud_code` 对齐展示名与启用态）：

| cloud_code | cloud_name | cloud_type | carrier | enabled | 说明 |
|---|---|---|---|---|---|
| `PUB-TX` | 腾讯云 | `PUB`（公有云） | `TX`（腾讯） | true | 当前唯一在用 |
| `GM-CU` | 政务云（联通） | `GM`（政务云） | `CU`（联通） | true | 规划中（description 标注） |

- **不预置**：`GM-CM`（政务云·移动）、`IND-TX`、`PRI-TX`——将来按同形制新增条目。
- **展示名解析**：列表 / 详情「云」列展示 `cloud_name`（字典缺条目回退 `cloud_code`，停用条目标识「云名（已停用）」），与 §5A `app_name` 解析同款。
- **历史 Excel 值归一**（导入层）：`TX → PUB-TX`、`CU → GM-CU`（大小写不敏感、trim）；无法归一的值整行报错。
- **`cloud` label**：仅取 `cloud_code`（禁止以 `cloud_name` 作为标签值）；空值**不注入** `cloud` 标签（复用 §10A 空值语义）。
- **消费方**：① M06 网域登记 UI 用 `GET /cloud-dict`（取 enabled 项）渲染 `cloud_code` 下拉；② 资源列表/详情的 `cloud_code`/`zone_type` 为**派生字段**（见 §3 派生注），前端**不得**把 `cloud_type`/`carrier` 渲染为独立列或独立筛选维度（前端红-line ④）。

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
| `cloud_type`（描述性） | `PUB` 公有云 / `GM` 政务云 / `IND` 行业云 / `PRI` 私有云 | 云字典条目**描述属性**；**非独立分类轴/筛选维度**（前端红-line ④），资源标签不引用 |
| `carrier`（描述性） | `TX` 腾讯 / `CU` 联通 / `CM` 移动 | 同上，描述性元数据，不进标签/筛选 |
| `cloud_code` 派生 | 经 `network_domain_id` 关联网域 `cloud_code` 派生 | 见 §3 派生注 / §5B；资源不落该字段 |
| `zone_type` 派生 | 经 `network_domain_id` 关联网域 `zone_type` 派生 | 同上，标识 target `zone` 系统标签 |

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

### 10B. {v2.44 决策 103 / M06 决策 78} `cloud_code` / `zone_type` 契约增量（方案 B，取代决策 98 / 101 / 102 方案 A）

> **方案 B 总纲**：`cloud_code` 上提为 **NetworkDomain 行政字段**（必填，取值须为云字典启用条目），资源侧不再维护 `cloud_code`；`zone_type` 转网域登记必填；`cloud` / `zone` / `network_domain` 三标签统一在 **target 级 system 层注入**（非 LabelTemplate 默认映射、非 external_labels，沿用决策 68-§2.5）；位置三标签对所有资源类型派生（不再限定 host）。

#### 10B.1 承载位置与必填口径

| 项 | 口径 |
|---|---|
| `cloud_code` 承载位置 | **NetworkDomain 行政字段**（M06 §5.2，必填），资源侧不存 cloud_code 写字段；`Host.cloud_code` 物理列保留为**兼容只读列**（不暴露写方法，值经 `network_domain_id` 派生展示，决策 103） |
| `cloud_code` 取值 | 云字典**启用**条目的 `cloud_code`（复合码 `{类型}-{载体}`），由 M06 网域登记校验引用 |
| `zone_type` 承载位置 | **NetworkDomain 行政字段**（M06 §5.2，必填），资源侧无独立分区字段 |
| 资源侧必填 | 资源录入 / 编辑 / 导入**不再要求填 `cloud_code` / `zone_type`**（云与分区经所属网域派生）；`network_domain_id` 仍必填（MVP） |
| 派生展示 | 资源列表 / 详情响应**经 `network_domain_id` 查网域**，返回只读 `cloud_code`（= domain.cloud_code）与 `zone_type`（= domain.zone_type），**五类均带**；空值空串 |
| 服务侧校验（cloud_code） | 仅 **M06 网域登记**处校验（引用启用云字典条目）；资源侧不校验 |
| 标签注入 | `cloud` / `zone` / `network_domain` 由 `platform/configcenter/generator/targets.go` 在 target 级 system 层注入（见 §10C），取代原 host 默认模板 `cloud_code → cloud` 映射 |

#### 10B.2 列表 item 增量（`GET /resources`）

- **五类 item 均返回派生的只读 `cloud_code` 与 `zone_type`**（值来自所属网域；空值空串，键不省略）——不再限定 host。
- 展示名解析：`cloud_code → cloud_name` 走 `GET /cloud-dict`（§5B）；`zone_type → display_name` 走 M06 zone_type 字典（`GET /api/v2/platform/zone-types`，M06 已提供）。

#### 10B.3 Excel 导入增量

- 五类模板**移除 `cloud_code` 列**（云经网域派生，导入仅填 `network_domain`）；**host 保留 `zone_env` 兼容列**（承接历史 Excel，不进标签、不作分区权威）。
- 历史 Excel 云值归一（`TX → PUB-TX` / `CU → GM-CU`）改由 **M06 网域登记层**处理；资源导入层不再接触 `cloud_code`。

#### 10B.4 网络分区单一权威（决策 101 / 103 修订）

- 资源**不持有独立分区字段**、新增 / 编辑表单**不设分区表单项**；`zone_type` 由网域登记必填，资源侧只读派生（决策 103 后 `zone` 同为 target 级 system 标签）。
- 全流程不存在「同一分区需两处填写」的入口 ⇒ **不提供任何一致性引导文案**。

### 10C. {v2.44 决策 103} 位置三标签 target 级 system 层注入

- **注入点**：`platform/configcenter/generator/targets.go` 的 `ResolveJobTargets`（与 `resource_id` 同款强制注入，line ~167 `mergeIntoLabels` 处）。
- **注入标签**（target 级 `static_configs[].labels`，**非 `external_labels`**，**不可被 LabelTemplate 映射覆盖**）：
  - `network_domain` = 资源 `network_domain_id`
  - `cloud` = 资源所属网域的 `cloud_code`
  - `zone` = 资源所属网域的 `zone_type`
- **空值不注入**：网域缺失 / `cloud_code` / `zone_type` 为空时省略对应键，沿用既有空值语义。
- 取代原 host 默认标签模板 `cloud_code → cloud` 映射（决策 98 机制被决策 103 取代）——`cloud` 值恒取 `cloud_code`（不含中文），字典改名不触发标签重算。

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
| `cloud_code` | 云 | 经所属网域派生（只读），展示 `cloud_name`（字典缺条回退 `cloud_code`，停用标识「云名（已停用）」）；不提供编辑入口 |
| `zone_type` | 网络分区 | 经所属网域派生（只读），展示分区名（互联网区 / 政务外网区 / 专线区 / DMZ / 公有云 region）；无编辑入口，附「继承所属网域」 |
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
| `cloud_code` | 云归属 | 资源列表/详情为**派生字段**（经所属网域 `cloud_code` 派生，见 §3 派生注）；前端红-line ④：`cloud_type`/`carrier` 不渲染为独立列/筛选维度 |
| `zone_type` | 网域类型 | 派生字段（经所属网域 `zone_type`）；与 `network_domain_id` 同源，标识 target `zone` 系统标签 |

## 12. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3（核心功能）/ §5（数据模型）/ §6（接口设计）/ §8（状态机）/ §11（前端交互契约）
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7（字段/分页/枚举契约）
- 序列：`docs/05-execution-records/module-07/task-sequence.yaml`
- 设计决策：`docs/05-execution-records/module-07/design-decisions.md` 决策 92~97（v2.40/v2.41，本版增量的权威依据）

## 13. 跨模块契约登记（v2.41 决策 94，新增）

> **decision 94（database/middleware 的 1:N 应用归属）**：MVP 维持「database / middleware 实例级 = 1 行资源 = 1 个主 `app_code`」。多库/多 schema 分属不同应用的 1:N 延后 **{v0.2+}**，作为**跨 M01 / M09 待确认点**——「共享实例到底按 schema 下沉资源粒度，还是由 exporter 在采集层按库打 `app` 标签」需 M01（scrape target 粒度 / exporter 按 schema 打标）与 M09（target 生成层级）一起定，**M07 不在单模块拍板**。本版仅标注口径与资源模型注释，不落地任何 1:N 数据模型字段变化。
