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
| 版本 | v2026-08-23（M07 回填） |
| 生成方式 | 由已落地后端路由 + 前端类型反向回填，供后续 Phase 复用格式 |
| 来源 | PRD `Module_07_Monitoring_Object_Management.md` §3/§5/§6/§8/§11；`03_API_Standard.md` §7；`task-sequence.yaml`；`platform/config/{resource,label}/routes.go` |

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
| GET | `/resources` | `resource_category`（必填）、`network_domain_id`、`keyword`（名称+IP 模糊）、`is_monitored`（透传预留，M01 未实现时不生效）、`page`、`page_size` | `{list,total,page,page_size}`，item = §5.2 字段 | `bad_request`：resource_category 缺失/非法 | §6.1/6.6.1 |
| POST | `/resources` | `ResourceCreateInput`（见 §10） | 创建后的完整对象 | `bad_request`：必填缺失 / `network_domain_id` 不存在（M06 行政记录） | §6.6.1 |
| PUT | `/resources/:resource_id` | `ResourceUpdateInput`（resource_category/source_type 创建后不可改，不随请求体） | 更新后的完整对象 | `not_found`；`bad_request` | §6.6.1 |
| DELETE | `/resources/:resource_id` | — | `{ resource_id }` | `not_found`；`forbidden`：被 Module_01 的 ScrapeJob 引用时禁止删除（报错 data 返回引用 Job 名单） | §6.1/6.6.1 |
| GET | `/resources/:resource_category/template` | — | Excel 模板下载（含「取值说明」sheet：M06 网域清单） | `not_found`：未知资源类型 | §6.1 |
| POST | `/resources/:resource_category/import` | multipart：`file` + `resource_category` + `mode` | `ImportResult`（`{total,success,updated?,failed,errors[]}`，errors item = `{row,field,value?,reason}`） | `bad_request`：文件格式/必填列缺失/非法 mode | §5.16/6.6.1 |

## 4. 资源标签 API

| 方法 | 路径 | 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|--------|-----------|----------|--------|
| GET | `/resources/:resource_id/labels` | — | `{items,total}`；item = `{id,key,value,source,source_map?}`；按来源优先级排序（system / user / cmdb） | `not_found` | §6.2/6.6.2 |
| POST | `/resources/:resource_id/labels` | `{key,value}` | 新增的 user 标签 | `forbidden`：resource_category ≠ application；`bad_request`：key 规则非法 / 覆盖 system/cmdb 标签 | §6.6.2 |
| PUT | `/resources/:resource_id/labels/:label_id` | `{value}` | 更新后的 user 标签 | `forbidden`：非 user 来源；`not_found` | §6.6.2 |
| DELETE | `/resources/:resource_id/labels/:label_id` | — | `{label_id}` | `forbidden`：非 user 来源；`not_found` | §6.6.2 |

> **写接口边界**：user 来源写接口仅对 `resource_category=application` 开放；host / middleware / generic_target 标签只读。

## 5. 业务分组字典（只读）

| 方法 | 路径 | 响应 data | PRD 源 |
|------|------|-----------|--------|
| GET | `/business-domains` | `BusinessDomain[]`：`{code,name,description?,enabled}` | §3.1/6.1 |

> 数据来自 `platform/config/business_domains.yaml` 预置，改动热加载生效；停用（`enabled=false`）条目不可被新资源选用；强制预置兜底条目 `infra`。

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
| `source_type` | `manual`（创建恒为 manual）/ `import` / `cmdb` | `resource_category` 创建后不可改 |
| `label_source` | `system` / `user` / `cmdb` | 排序优先级 system > user > cmdb（v0.4+） |
| `import_mode` | `create_only`（默认）/ `upsert` | |
| `import_record.status` | `success` / `partial` / `failed` | |
| `env` | `dev` / `test` / `staging` / `prod` | 合法环境集合 |
| `protocol` | `http` / `https` / `tcp` | |
| `scheme` | `http` / `https` | |
| `mapping.source_type` | `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field` | |
| 保护 label | `instance` / `job` / `scheme` / `__address__` 等 | `PROTECTED_PROMETHEUS_LABELS`；composite → instance 例外 |
| `biz_code` 规范 | 小写字母/数字/连字符，≤64；永不可改 | 上线前须命名评审；强制预置 `infra` |
| label key 规则 | 小写/下划线，禁止 `__` 开头，≤128 | |

## 10. 字段必填口径

### 10.1 资源创建（POST /resources）

- 必填：`resource_category`（创建必传）、`network_domain_id`（M06 网域，须存在）、`biz_code`（全类型必填）、`env`
- 可选：`app_name`、`cluster`、`owner`、`status`（默认 `online`）
- 服务端固定：`source_type=manual`、`tenant_id=platform_admin`、`resource_id`（M07 生成 uuid）
- 差异化字段按类型：host（`instance_name`/`instance_ip`/`os_type?`）、database（`database_type`/`instance_ip`/`port`/`version?`）、middleware（`middleware_type`/`instance_ip`/`port`/`version?`）、application（`service_name`/`endpoint`/`health_check_url?`/`protocol?`/`port?`）、generic_target（`target_name`/`instance_ip`/`port?`/`metrics_path?`/`scheme?`/`exporter_type?`/`custom_labels?`）

### 10.2 资源更新（PUT /resources/:resource_id）

- 仅可更新：`network_domain_id`/`biz_code`/`app_name`/`env`/`cluster`/`owner`/`status` + 各类型差异化字段
- 不可改：`resource_category`、`source_type`（不随请求体）

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
| `biz_code` | 业务分组 | 下拉数据来自 `GET /business-domains` |
| `env` | 环境 | |
| `status` | 运行状态 | |
| `owner` | 负责人 | |
| `instance_ip` / `port` | 实例 IP / 端口 | |
| `target_label` | 目标标签 | |
| `source_field` / `source_type` | 来源字段 / 来源类型 | |
| `instance_count` | 关联实例数 | |

## 12. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md` §3（核心功能）/ §5（数据模型）/ §6（接口设计）/ §8（状态机）/ §11（前端交互契约）
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7（字段/分页/枚举契约）
- 序列：`docs/05-execution-records/module-07/task-sequence.yaml`
