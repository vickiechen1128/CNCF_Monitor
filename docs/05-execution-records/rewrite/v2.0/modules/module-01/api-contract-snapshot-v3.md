# Module 01 API v3 契约快照（draft，待 G2 评审）

> **状态**：draft（D-1/D-2 已由 owner 2026-11-16 确认：v3 模块重写 + `m01_*` 独立表 + M09 写回同步状态；其余待决见 `assessment.md` §10.2）
> **分支**：`rewrite/v2.0`
> **前缀**：`/api/v3/platform/*`
> **旧线**：`/api/v2/platform/*`（`platform/strategy/`）冻结保留，仅服务 legacy 模式
> **上位文档**：`assessment.md`、`docs/03-engineering-standards/03_API_Standard.md`、M01 SRS v1.2
> **冲突处理**：与 SRS 冲突以 SRS 为准；与工程标准冲突先报告 Orchestrator，禁止擅自改契约
> **变更**：v3 采集模板化（2026-11-20）：取消 monitor_type/推导规则/默认采集配置，改为采集模板 + 任务选择器；对应 migration 0023。

---

## 1. 通用约定

### 1.1 响应信封

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

`errorType`：`bad_request` / `unauthorized` / `forbidden` / `not_found` / `conflict` / `unavailable` / `internal`。

### 1.2 分页与时间

- `page` 从 1 开始，默认 1；`page_size` 默认 20，上限 100（超出按 100 截断）。
- 列表响应：`{ "list": [], "total": 0, "page": 1, "page_size": 20 }`。
- 时间 RFC3339；空时间返回 `null`，禁止零值 `0001-01-01...`。
- JSON 字段统一 snake_case；实体主键统一 `id` 字符串（UUID），外键以 `_id` 结尾。
- 列表默认排序：`updated_at desc, id asc`（规则/指标库同）。

### 1.3 严格 JSON 与幂等

- 所有写接口（POST/PUT）启用 `DisallowUnknownFields`；契约外字段 → 400，不静默忽略。
- 更新为全量字段语义（PUT）：未传的可选字段按「留空 = 继承/不修改」规则处理，具体见各实体。
- 删除为软删；重复删除返回 404。

### 1.4 鉴权与租户

| 面 | 鉴权 | 说明 |
|---|---|---|
| `/api/v3/platform/*` | 全局 `AuthMiddleware` | 匿名 → 401；MVP 登录用户（`platform_admin`）可读；M03 v3 落地后接入模块级权限 |
| 内置采集模板 / 指标库写接口 | `AuthMiddleware` + `RequireAdmin`（模板部分由服务端判定） | 内置采集模板（`is_builtin=true`）的 `POST/PUT/DELETE` 与指标库写接口需 `RequireAdmin`；已认证普通用户 → 403（2026-11-19 裁定，与 M05/M06/M09 管理写接口口径一致）。**内置模板的服务端判定在 service 层（`requireAdminForBuiltin`），非路由层**：`POST /collection-templates` 落库前强制 `is_builtin=false`，故实际拦截点是 `PUT`/`DELETE /collection-templates/{code}`；且 `DELETE` 内置模板对任何角色一律 403（只能停用，见 §3.4） |
| 自定义采集模板 / 采集实现池 / 采集任务写接口 | `AuthMiddleware` | 自定义采集模板、`/exporter-templates`、`/scrape-jobs`、`/job-groups`、`/monitoring-rules`、`/business-metrics` 的写接口对登录用户开放 |
| 跨模块读 | 服务端直接只读 M06/M07 表 | 不信任请求中的租户参数 |

### 1.5 同步状态对象（`sync`）

Job / 规则响应统一内联：

```json
"sync": {
  "status": "synced",
  "version": "20261116-1a2b3c4d",
  "error": "",
  "synced_at": "2026-11-16T10:00:00Z"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | enum | `draft` / `pending` / `syncing` / `synced` / `failed` |
| `version` | string | 最近一次成功同步的 M09 快照版本；未同步为空串 |
| `error` | string | 失败原因（用户可读，含归因）；非 `failed` 为空串 |
| `synced_at` | datetime? | 最近一次成功同步时间 |

语义（与 SRS §3.6 / §8.4 对齐）：

- `draft`：`draft_status=draft` 或 `enabled=false`，不在 M09 同步候选集；UI 结合 `enabled` 显示「已停用」。
- `pending`：源数据已变更，等待 M09 下一轮生成。
- `syncing`：M09 正在生成/分发（best-effort 瞬态；未捕获时直接由 `pending → synced/failed`）。
- `synced`：当前源数据已纳入 M09 最新通过校验的快照。
- `failed`：M09 校验或分发失败；`error` 给出原因与下一步。

> 同步状态由 M01 持有并展示；M09 生成完成后通过 `SyncResultSink` 回写（见 §10.2）。M01 不读取 M09 表。

---

## 2. 采集实现池（ExporterTemplate）

### 2.1 对象

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 响应 | UUID |
| `name` | string | 是 | 唯一，1~100；允许改名，写时重新校验唯一性 |
| `version` | string | 否 | 采集器版本 |
| `default_port` | int | 否 | 0~65535；0 = 未指定 |
| `metrics_path` | string | 否 | 默认 `/metrics`；必须以 `/` 开头 |
| `scheme` | enum | 否 | `http` / `https`，默认 `http` |
| `os` | enum | 否 | `linux` / `windows` / `any`，默认 `any` |
| `arch` | enum | 否 | `amd64` / `arm64` / `any`，默认 `any` |
| `download_url` | string | 否 | http(s) URL |
| `homepage` | string | 否 | http(s) URL |
| `install_guide` | string | 否 | 纯文本/Markdown |
| `description` | string | 否 | 纯文本 |
| `is_builtin` | bool | 响应 | 内置行只读 |
| `source` | enum | 否 | `official` / `third_party` / `internal`，默认 `third_party` |
| `created_at` / `updated_at` | datetime | 响应 | RFC3339 |

### 2.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/exporter-templates` | 筛选 `source` / `os` / `arch` / `is_builtin` / `keyword` + 分页 |
| POST | `/exporter-templates` | 创建用户模板（`is_builtin=false`） |
| GET | `/exporter-templates/{id}` | 详情 |
| PUT | `/exporter-templates/{id}` | 更新；内置行 → 403 |
| DELETE | `/exporter-templates/{id}` | 软删；内置行 → 403；被采集模板（`m01_collection_templates.exporter_template_id`）引用 → 409 |

> 采集实现不再声明「支持哪些监控对象类型」：模板把实现绑定为一等关系（一个模板一个实现），删掉了该字段与相应校验（migration 0023）。

### 2.3 错误

| 场景 | errorType |
|---|---|
| `name` 重复 | `conflict` |
| 内置行写操作 | `forbidden` |
| 被 `m01_collection_templates` 引用时删除 | `conflict` |
| `metrics_path` 非 `/` 开头 / port 越界 / scheme 非法 | `bad_request` |

---

## 3. 采集模板（CollectionTemplate）

> 模板回答「这类对象怎么采」：**一个采集实现 + 一套参数 + 一个标签模板**，`code` 不可变。
> 模板**刻意不携带适用范围**——范围只属于任务选择器（§4），否则被下线的「监控对象类型」会换个名字复活。
> 实现：`handler/collection_template.go`、`service/collection_template.go`、`repository/collection_template.go`、`domain/collection_template.go`；存储 `m01_collection_templates`（migration 0023）。

### 3.1 对象（`CollectionTemplateResponse`）

```json
{
  "code": "mysql",
  "name": "MySQL 采集",
  "resource_category": "database",
  "exporter_template_id": "et-mysqld",
  "exporter_template_name": "mysqld-exporter",
  "default_port": 9104,
  "metrics_path": "/metrics",
  "scheme": "http",
  "scrape_interval": "15s",
  "scrape_timeout": "10s",
  "label_template_id": "lt-db",
  "label_template_name": "数据库默认模板",
  "default_selector": {
    "logic": "all",
    "filters": [
      { "field": "database_type", "operator": "eq", "values": ["mysql"] }
    ]
  },
  "description": "MySQL 数据库实例",
  "sort_order": 40,
  "enabled": true,
  "is_builtin": true,
  "reference_job_count": 3,
  "created_at": "2026-11-20T09:00:00Z",
  "updated_at": "2026-11-20T09:30:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `code` | string | 是（创建） | 不可变；`^[a-z][a-z0-9_]{1,63}$`；`PUT` 以路径为准，请求体中的 `code` 被忽略 |
| `name` | string | 是 | 去空白后非空；模板展示名 |
| `resource_category` | enum | 是 | `host` / `database` / `middleware` / `application` / `interface_service` / `generic_target` |
| `exporter_template_id` | string | 是 | 必须存在于采集实现池（§2）；模板与实现 1:1，换实现 = 新建模板 |
| `exporter_template_name` | string | 响应 | 解析出的实现名；实现不存在时为空串（`omitempty`，字段省略） |
| `default_port` | int | 否 | 0~65535；0 = 未指定（端口链继续回落到实现/业务端口，见 §4.5） |
| `metrics_path` | string | 否 | 默认 `/metrics`；必须以 `/` 开头 |
| `scheme` | enum | 否 | `http` / `https`，默认 `http` |
| `scrape_interval` | duration | 否 | 默认 `15s` |
| `scrape_timeout` | duration | 否 | 默认 `10s`，须 < `scrape_interval` |
| `label_template_id` | string | 否 | 空 = 无标签模板；非空须存在且类别与模板一致 |
| `label_template_name` | string | 响应 | M07 模板名称；无模板/模板不存在时为空串 |
| `default_selector` | object | 否 | `{logic, filters[]}`，元素见 §3.3；**仅作新建任务的向导预填** |
| `description` | string | 否 | 纯文本 |
| `sort_order` | int | 否 | 列表排序；0 → 服务端补 500 |
| `enabled` | bool | 否 | 默认 true；停用后不可被新任务选用（存量任务不受影响） |
| `is_builtin` | bool | 响应 | 只读；`POST` 落库前强制 `false` |
| `reference_job_count` | int64 | 响应 | 引用该模板的采集任务数（列表/详情均返回） |
| `created_at` / `updated_at` | datetime | 响应 | RFC3339；零值返回空串（`omitempty`） |

### 3.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/collection-templates` | 筛选 `resource_category` / `enabled` / `keyword` + 分页（`enabled` 取 `true`/`1` 为真，其余非空值按 false） |
| GET | `/collection-templates/{code}` | 详情（含 `reference_job_count`） |
| GET | `/collection-templates/{code}/impact` | 变更影响预览：`{code, reference_jobs, metric_anchors, updated_at}` |
| POST | `/collection-templates` | 创建（**不接收** `is_builtin`；出现 → 400）；`code` 必填 |
| PUT | `/collection-templates/{code}` | 全量更新（含启停）；`code` 不可变；内置模板 → 非平台管理员 403 |
| DELETE | `/collection-templates/{code}` | 软删；内置模板 → 403（任何角色）；被任务或指标锚点引用 → 409 |
| GET | `/candidate-fields` | 选择器字段字典（见 §3.5） |

`impact` 响应示例：

```json
{ "code": "mysql", "reference_jobs": 3, "metric_anchors": 12, "updated_at": "2026-11-20T09:30:00Z" }
```

> `matched_resources` 为 DTO 预留字段，当前实现不填充、不出现在响应中。

### 3.3 校验（按顺序短路）

| # | 校验 | 失败 |
|---|---|---|
| 1 | `code` 匹配 `^[a-z][a-z0-9_]{1,63}$`（小写字母开头，2~64 位） | 400 |
| 2 | `name` 去空白后非空 | 400 |
| 3 | `resource_category` 为已知类别（六选一） | 400 |
| 4 | `default_port` 在 0~65535 | 400 |
| 5 | `metrics_path` 非空且以 `/` 开头（服务端先补默认 `/metrics`） | 400 |
| 6 | `scheme` ∈ `http` / `https`（服务端先补 `http`） | 400 |
| 7 | duration 匹配 `^\d+(ms|s|m|h|d|w|y)$`，且 `scrape_timeout < scrape_interval`（服务端先补 15s/10s，故总参与比较） | 400 |
| 8 | `exporter_template_id` 必填且实现存在 | 400 |
| 9 | `label_template_id` 非空时 M07 模板存在，且模板类别 == 模板 `resource_category`（模板类别为空则不比对） | 400 |
| 10 | `default_selector` 按字段字典校验（见下） | 400 |

`default_selector` 的 `{logic, filters[]}`：

- `logic` ∈ `all` / `any`（空 → 归一化为 `all`）。
- `filters[].field` 必须在字段字典内，且字段适用于该模板的 `resource_category`；`operator` ∈ `eq` / `contains` / `contains_any` / `in` / `always` / `regexp`，并受字段类型约束（`enum` / `boolean` / `os_family` 只允许 `eq` / `in` / `always`）。
- `values`：`eq` / `contains` / `regexp` 恰好 1 个；`in` / `contains_any` 1 个以上；`always` 必须为空；`os_family` 只接受 `linux` / `windows`，`has_npu` / `has_gpu` 只接受 `true` / `false`；`regexp` 需可编译。
- 模板的 `default_selector` **只接受内置字段**（模板保存路径不接 M07 自定义字段解析器）；任务 `selector` 在保存与候选查询两个阶段均可使用 M07 自定义字段（§5）。

`code` 的唯一性由部分唯一索引保证（`deleted_at IS NULL`）；重名 → 409。

### 3.4 删除 / 停用

- **内置模板不可删除**：`DELETE` → 403（任何角色，含平台管理员），错误信息提示「只能停用」。
- **内置模板可停用**：`PUT /{code}` 携带 `enabled=false` 即可（需平台管理员）。停用只影响后续保存：新建/编辑任务引用该模板 → 400（`collection template "x" is disabled`），存量任务保留原快照继续下发；向导侧应据 `enabled=false` 过滤候选模板。
- **自定义模板删除为软删**：被采集任务（`m01_scrape_jobs.template_code`）或指标锚点（`m01_metric_library.collection_templates`）引用时 → 409，错误信息回传引用计数（`jobs=N, metric_anchors=M`）。删除前可用 `GET /{code}/impact` 预检。
- 内置模板由 seed 幂等补齐（10 个 code：`host_linux` / `host_windows` / `host_npu` / `mysql` / `redis` / `kafka` / `elasticsearch` / `nginx` / `application_http` / `snmp`）；**只补缺失行，不覆盖用户改动**（含已停用的行）。
- `default_selector` **仅作新建任务的向导预填**：后端从不据其求值；每个任务保存自己的 `selector` 快照，模板改动不重写存量任务。

### 3.5 选择器字段字典（`/candidate-fields`）

`GET /candidate-fields` → `{ list: [CandidateFieldResponse], total }`：

```json
{
  "list": [
    { "key": "network_domain_id", "label": "网域", "kind": "enum", "categories": ["host", "database", "middleware", "application", "interface_service", "generic_target"], "custom": false },
    { "key": "os_family", "label": "操作系统家族", "kind": "os_family", "categories": ["host"], "custom": false },
    { "key": "has_npu", "label": "是否带 NPU", "kind": "boolean", "categories": ["host"], "custom": false },
    { "key": "database_type", "label": "数据库类型", "kind": "text", "categories": ["database"], "custom": false },
    { "key": "dpu_model", "label": "DPU 型号", "kind": "text", "categories": ["host"], "custom": true }
  ],
  "total": 5
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `key` | string | 查询时提交的字段 KEY（不是物理列名） |
| `label` | string | 展示名 |
| `kind` | enum | `text` / `boolean` / `os_family` / `enum`；决定可用操作符与取值校验 |
| `categories` | []string | 该字段适用的资源类别；`custom=true` 时只有一个元素 |
| `custom` | bool | `false` = M01 内置字典；`true` = M07 注册的自定义字段 |

- 内置字段来自 M01 字段字典（`domain.FieldSpecs()`），按类别分布：

| 类别 | 内置字段 |
|---|---|
| 全部类别 | `network_domain_id` / `tenant_id` / `resource_category` / `status` / `env` / `app_code` / `biz_code` / `platform_code` / `cluster` / `owner` |
| `host` | `os_family` / `os_type` / `os_version` / `hostname` / `has_npu` / `has_gpu` |
| `database` | `database_type` / `database_version` |
| `middleware` | `middleware_type` / `middleware_version` |
| `application` | `service_name` / `protocol` |
| `interface_service` | `api_name` |
| `generic_target` | `target_name` / `exporter_type` |

- `custom=true` 的字段来自 M07 `m07_attribute_definitions`（`status=active` 且未删除），**只暴露 `key` / `label` / `kind` / `category`**，物理列与取值永远不外泄；M07 新增字段无需 M01 发版即可参与筛选（NFR-11）。

---

## 4. 采集 Job（ScrapeJob）

### 4.1 对象

```json
{
  "id": "8f2c...",
  "job_name": "mysql-prod",
  "job_type": "standard",
  "resource_category": "database",
  "template_code": "mysql",
  "selector": {
    "logic": "all",
    "filters": [
      { "field": "database_type", "operator": "eq", "values": ["mysql"] },
      { "field": "cluster", "operator": "in", "values": ["order-cluster"] }
    ]
  },
  "exporter_template_id": "et-mysqld",
  "exporter_template_name": "mysqld-exporter",
  "network_domain_id": "mc-demo",
  "network_domain_name": "演示采集域",
  "job_group_id": "g-01",
  "job_group_name": "MySQL 基础采集",
  "instance_selection_mode": "manual",
  "selected_instance_ids": ["db-01", "db-02"],
  "selected_instance_count": 2,
  "scrape_interval": "30s",
  "scrape_timeout": "10s",
  "metrics_path": "/metrics",
  "scheme": "http",
  "auth_type": "basic",
  "username": "monitor",
  "credential_configured": true,
  "tls_skip_verify": false,
  "ca_file": "",
  "label_template_id": "lt-db",
  "label_template_name": "数据库默认模板",
  "blackbox_module": "",
  "target_field": "",
  "mapping_overrides": [
    { "field": "scrape_interval", "value": "30s" }
  ],
  "draft_status": "ready",
  "enabled": true,
  "sync": { "status": "synced", "version": "20261116-1a2b", "error": "", "synced_at": "2026-11-16T10:00:00Z" },
  "created_at": "2026-11-16T09:00:00Z",
  "updated_at": "2026-11-16T09:30:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `job_name` | string | 是 | Prometheus `job_name`；`^[a-zA-Z_][a-zA-Z0-9_.-]*$`，≤100；**同域唯一**（排除自身） |
| `job_type` | enum | 否 | `standard`（默认）/ `blackbox`；创建后不可变更 |
| `resource_category` | enum | 条件 | `host` / `database` / `middleware` / `application` / `interface_service` / `generic_target`；standard 留空时从模板继承，传入则必须与模板一致 |
| `template_code` | string | 条件 | standard 必填，须存在且 `enabled=true`；blackbox 必须为空 |
| `selector` | object | 否 | `{logic, filters:[{field,operator,values}]}`，语义见 §3.3 / §5；standard 按提交快照落库，blackbox 由服务端清空 |
| `exporter_template_id` | string | 响应 | **由模板派生**（`template.exporter_template_id`）；blackbox 为空串；请求值被覆盖 |
| `exporter_template_name` | string | 响应 | 实现名解析结果 |
| `network_domain_id` | string | 是 | M06 已登记 + `status=enabled` + `domain_type` ∈ `edge`/`collection` + M09 `monitored`；创建后不可变更 |
| `job_group_id` / `job_group_name` | string | 响应 | 组内子任务才有值（独立任务省略）；公共参数由组维护 |
| `instance_selection_mode` | enum | 否 | MVP 仅 `manual`；`filter` → 400（v0.2） |
| `selected_instance_ids` | []string | 条件 | `ready` 时至少 1；`draft` 可为空 |
| `scrape_interval` | duration | 否 | 留空按层叠链解析（§4.4） |
| `scrape_timeout` | duration | 否 | 留空按层叠链解析；须 < interval |
| `metrics_path` | string | 条件 | `application` 分类必填；其余留空继承 |
| `scheme` | enum | 否 | `http` / `https` |
| `auth_type` | enum | 否 | `none`（默认）/ `basic` / `bearer` |
| `username` / `password` | string | 条件 | `basic` 必填；`password` 只写不回显，更新时留空 = 保持原值 |
| `token` | string | 条件 | `bearer` 必填；只写不回显，更新时留空 = 保持原值 |
| `tls_skip_verify` | bool | 否 | 默认 false |
| `ca_file` | string | 否 | 证书路径（由部署约定解析） |
| `label_template_id` | string | 响应 | **由模板派生**（`template.label_template_id`）；请求值被覆盖，任务不再单独维护标签模板 |
| `label_template_name` | string | 响应 | M07 模板名称 |
| `blackbox_module` | string | 条件 | blackbox 必填，须为启用的拨测模块名 |
| `target_field` | string | 响应 | 仅 blackbox 派生：`interface_service→api_url`、`application→health_check_url`；standard 为空串，请求传值忽略 |
| `mapping_overrides` | []object | 响应 | 服务端按提交值与模板默认值比对后计算；请求不接收 |
| `blackbox_targets` | — | — | **已删除**；请求出现该字段或非空 → 400 |
| `draft_status` | enum | 否 | `draft` / `ready`（默认）；仅允许 `draft→ready` |
| `enabled` | bool | 否 | 默认 true；与 `draft_status` 正交 |

`password` / `token` 永不返回；仅返回 `credential_configured`。

### 4.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/scrape-jobs` | 筛选 `network_domain_id` / `template_code` / `job_type` / `enabled` / `draft_status` / `keyword` / `label_template_id`，另支持 `ungrouped` / `grouped`（是否属于任务组）+ 分页 |
| POST | `/scrape-jobs` | 创建 |
| GET | `/scrape-jobs/{id}` | 详情（含 `sync`） |
| PUT | `/scrape-jobs/{id}` | 更新（含启停/草稿提交） |
| DELETE | `/scrape-jobs/{id}` | 软删；响应 `{ "job_id": "..." }`；组内子任务 → 400（须改组或删组） |
| GET | `/scrape-jobs/instance-candidates` | 见 §5.1 |
| GET | `/scrape-jobs/{id}/instances` | 见 §5.2 |
| POST | `/scrape-jobs/{id}/instances/{resource_id}/confirm` | 见 §5.3 |
| DELETE | `/scrape-jobs/{id}/instances/{resource_id}/confirm` | 撤销安装留痕 |
| POST | `/scrape-jobs/{id}/preview-targets` | 见 §5.4 |

### 4.3 校验矩阵（保存时，按顺序短路）

| # | 校验 | 失败 |
|---|---|---|
| 1 | `job_type` ∈ `standard` / `blackbox`（默认 `standard`） | 400 |
| 2 | `resource_category` 为已知类别；standard 留空时从 `template_code` 继承 | 400 |
| 3 | `job_name` 格式（`^[a-zA-Z_][a-zA-Z0-9_.-]*$`，≤100）与同域唯一（排除自身） | 400 / 409 |
| 4 | `instance_selection_mode` 仅 `manual`（`filter` → 400） | 400 |
| 5 | standard：`template_code` 必填 → 模板存在 → `enabled=true` → 模板类别与 `resource_category` 一致 | 400 |
| 6 | blackbox：`template_code` 必须为空；`blackbox_module` 必填且存在 + enabled；类别 ∈ `interface_service` / `application` | 400 |
| 7 | 网域存在 + `status=enabled` + `domain_type` ∈ `edge` / `collection` + `registration_status=monitored`；非平台管理员还须「归属本租户或被显式授权」（fail-closed） | 400（提示先纳管 / 未授权） |
| 8 | 参数继承链解析成功：duration 合法且 `timeout < interval`；`metrics_path` 以 `/` 开头；`application` 必须显式给 `metrics_path`；`scheme` ∈ http/https | 400 |
| 9 | `label_template_id`（模板派生）存在且类别与 `resource_category` 一致 | 400 |
| 10 | 选中实例全部存在、同网域、类别匹配、非跨租户；`offline` 不可新增（已选存量允许保留）；blackbox 实例的拨测地址非空 | 400 |
| 11 | `draft_status=ready` → 至少 1 个选中实例 | 400 |
| 12 | 认证组合：`basic` 需 username + password（更新可留空沿用）；`bearer` 需 token；`none` 清空凭证 | 400 |
| 13 | `tls_skip_verify=true` 且 `scheme=http` → 允许但告警（不阻断） | — |
| 14 | 组内子任务编辑：公共参数（`job_name` / `template_code` / 类别 / 参数 / 凭证 / `label_template_id` / `draft_status` / `enabled` 等）只能由组维护，改动 → 400 | 400 |
| 15 | `selector` 保存时先归一化（trim 取值、`logic` 空 → `all`、`operator` 空 → `eq`、`always` 清空 `values`、去重空值），再按字段字典校验：字段存在且适用于该类别、操作符受支持、取值数量与类型匹配；M07 自定义字段同样在保存期生效（与候选查询同一校验入口） | 400 |

### 4.4 生效参数层叠（保存时解析并落快照）

```text
scrape_interval : Job 提交值 → 采集模板 scrape_interval → 15s
scrape_timeout  : Job 提交值 → 采集模板 scrape_timeout  → 10s（且 < interval）
metrics_path    : Job 提交值 → 采集模板 metrics_path    → 采集实现 metrics_path → /metrics
scheme          : Job 提交值 → 采集模板 scheme          → 采集实现 scheme       → http
```

`application` 分类的 `metrics_path` 必填、不参与继承（留空 → 400）。保存后返回解析后的生效值；模板后续变更不穿透（NFR-06），除非用户调用「同步模板默认值」。

> 「同步模板默认值」在 v3 通过 `PUT /scrape-jobs/{id}` 携带 `sync_mapping_defaults: true`（请求级开关，非持久字段）实现：仅刷新 `mapping_overrides` 之外（未被用户显式覆盖）的字段。

### 4.5 端口与目标解析（MVP，供 preview-targets 与 M09 生成共用）

端口链（`domain.ResolvePort` / `ResolvePortWithSource`）：

```text
host                  : resources.scrape_port → 采集模板 default_port → 采集实现 default_port → 9100
database / middleware : resources.scrape_port → 采集模板 default_port → 业务 port
```

| 分类 | 地址 | 端口 |
|---|---|---|
| `host` | `host_resources.instance_ip` | `resources.scrape_port` → 模板 `default_port` → 采集实现 `default_port` → 9100 |
| `database` / `middleware` | `instance_ip` | `resources.scrape_port` → 模板 `default_port` → 业务 `port` |
| `application` | `instance_ip`（为空时取 `endpoint` / `target_url` 的 host） | 资源 `port` 直用（不参与解析链） |
| `generic_target` | `instance_ip` | 资源 `port` 直用；0 时按 scheme 默认端口（`https`→443，其余 80） |
| `interface_service` / `application`（blackbox） | `api_url` / `health_check_url` 完整 URL | 不适用 |

`GET /scrape-jobs/{id}/instances` 额外返回 `port_source`（`instance` / `mapping` / `template` / `business` / `default` / `unresolved`），标明端口由哪一层给出；其中 `mapping` 即「采集模板 `default_port`」层，`template` 为「采集实现 `default_port`」层（枚举名沿用旧口径）。

无地址 / 端口无法解析的实例在 `preview-targets` 中进入 `skipped`，不阻断保存。

---


---

## 4.1 Job 组（监控意图，SRS JG v1.0 增量）

> 增量能力：一次提交跨多个网域。**多域只存在于意图层**——每域仍生成一条单域子 Job，
> M09 契约零变更（仍按 `network_domain_id` 读取 Job）。
> 实现：`platform/modules/m01/handler/job_group.go`、`service/job_group.go`、`repository/job_group.go`。

### 4.1.1 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/job-groups` | 登录 | 组列表（`status` / `keyword` / 分页）；每行含 `domains` 与派生 `sync` |
| POST | `/job-groups` | 登录 | 创建：公共参数 + 跨域实例 → 单事务写 1 组 + N 子 Job |
| GET | `/job-groups/:id` | 登录 | 组详情（逐域子 Job + 派生状态） |
| PUT | `/job-groups/:id` | 登录 | 更新：公共参数扇出 + 实例增量对账（域清零 → 删除该域子 Job） |
| PUT | `/job-groups/:id/status` | 登录 | 启用 / 停用整组（`{"enabled": bool}`）：单事务级联各域子 Job 的 `enabled`；停用后 `sync.status=draft`、启用后回到 `pending`，等 M09 重新生成；无子任务 → 409 |
| DELETE | `/job-groups/:id` | 登录 | 软删组 + 全部子 Job（级联） |

### 4.1.2 请求

```json
{
  "name": "主机基础采集",
  "job_name": "host-base",
  "job_type": "standard",
  "resource_category": "host",
  "template_code": "host_linux",
  "selector": {
    "logic": "all",
    "filters": [
      { "field": "os_family", "operator": "eq", "values": ["linux"] },
      { "field": "env", "operator": "in", "values": ["PRD"] }
    ]
  },
  "exporter_template_id": "",
  "scrape_interval": "30s",
  "scrape_timeout": "10s",
  "metrics_path": "/metrics",
  "scheme": "http",
  "auth_type": "none",
  "username": "",
  "password": "",
  "token": "",
  "tls_skip_verify": false,
  "ca_file": "",
  "label_template_id": "",
  "blackbox_module": "",
  "selected_instance_ids": ["res-a1", "res-b1"],
  "enabled": true,
  "status": "enabled"
}
```

- 实例**跨域合法**：按 `resources.network_domain_id` 自动归组，不接受手填网域。
- `job_name` 组内一致；唯一性口径为「同域唯一」（见 §10 变更第 1 条）。
- `template_code` + `selector` 逐域原样扇出到每个子 Job；`label_template_id` / `exporter_template_id` 仍由模板派生，组上只保存子 Job 的解析快照。
- 公共参数缺省时与单域 Job 同规则解析（采集模板 → 采集实现 → 系统默认，§4.4）；`selector` 与单域 Job 同口径（保存即归一化 + 字段字典校验）。
- `enabled=false` 或 `status=disabled` → 全部子 Job 停用并回到 `draft`。

### 4.1.3 响应

```json
{
  "id": "8f1c…",
  "name": "主机基础采集",
  "job_name": "host-base",
  "job_type": "standard",
  "resource_category": "host",
  "template_code": "host_linux",
  "selector": {
    "logic": "all",
    "filters": [
      { "field": "os_family", "operator": "eq", "values": ["linux"] }
    ]
  },
  "scrape_interval": "30s",
  "status": "enabled",
  "created_by": "admin",
  "domains": [
    {
      "network_domain_id": "mc-a",
      "network_domain_name": "域A",
      "job_id": "…",
      "job_name": "host-base",
      "instance_count": 12,
      "enabled": true,
      "sync_status": "pending",
      "sync_version": "",
      "sync_error": "",
      "synced_at": null
    }
  ],
  "sync": {"status": "pending", "total": 2, "synced": 0, "failed": 0, "pending": 2, "draft": 0}
}
```

- `sync.status` 为**派生值**（不落库）：`disabled > empty > draft > partial > failed > pending > synced`。
- `sync` 等派生字段只出现在响应里；写请求携带 → 忽略（与单域 Job 的只读 `sync` 一致）。
- `job_name` / `template_code` / `selector` 等参数取自第一条子 Job 的解析结果（组表不冗余存储，`job_name` 亦同口径）。
- `domains[].job` 为可选内联的完整 `JobResponse`（§4.1，供合并任务表复用富列），独立于上述扁平字段。

### 4.1.4 错误

| 场景 | 状态码 | 说明 |
|---|---|---|
| 组名重复 | 409 | `job_group` / `name` 冲突 |
| 实例不存在 / 跨类别 / 离线且非既有 | 400 | 与单域 Job 同口径（`selected_instance_ids`） |
| 目标域未纳管 / 已禁用 | 400 | `network_domain_id` 不可用（复用 Job 校验） |
| 组不存在 | 404 | `job_group` |
| 无任何可解析实例 | 400 | `selected_instance_ids` |

### 4.1.5 不变量（增量）

1. 组与子 Job **同事务**写入，不存在「建了一半」的组。
2. 子 Job 的 `network_domain_id` 仍不可变更；跨域变更表达为「某域移除 + 另一域新增」。
3. 子 Job 仍完整持有参数快照与 `sync_*`；组不参与下发。
4. 组名全局唯一；`job_name` 同域唯一（部分唯一索引 `deleted_at IS NULL`）。

## 5. 实例候选 / 安装登记 / 预演

### 5.1 实例候选

`GET /scrape-jobs/instance-candidates?template_code=&resource_category=&network_domain_id=&keyword=&page=&page_size=`

```json
{
  "list": [
    {
      "resource_id": "db-01",
      "resource_category": "database",
      "template_code": "mysql",
      "display_name": "mysql-01",
      "instance_ip": "10.0.0.11",
      "port": 3306,
      "target_address": "10.0.0.11:9104",
      "network_domain_id": "mc-demo",
      "status": "online",
      "selectable": true,
      "disabled_reason": ""
    }
  ],
  "total": 1,
  "page": 1,
  "page_size": 20
}
```

- `resource_category` + `network_domain_id` 必填：GET 老接口不做模板类别推导，候选筛选始终按类别 + 网域。
- `template_code` 可选：仅用于解析模板 `default_port` / 采集实现端口，从而算出 `target_address`；模板不存在时忽略（`template_code` 原样回显）。
- `offline` 返回但 `selectable=false`、`disabled_reason="实例已离线"`。
- `npu`：候选为主机全集，不按 OS/型号过滤（NPU 是模板 `default_selector` 中的 `has_npu=true` 预填，不是类别）。
- blackbox：`template_code` 为空，改传 `resource_category=interface_service|application`；`target_address` 为派生 URL。

> 向导里「无 selector 时用模板 `default_selector` 预填」由 service 在 **POST 组合筛选**（§5.1.1）中完成；GET 老接口不读 `default_selector`。

### 5.1.1 组合筛选（SRS JG v1.1，P0）

> 目的：把「先选网域再选实例」改成「按任意维度圈对象」。条件为 **AND** 组合，
> 字段清单由服务端下发，前端不硬编码字段名；`GET` 老接口保留兼容。

**字段清单**：`GET /scrape-jobs/instance-candidates/filter-schema`

```json
{"fields":[
  {"key":"network_domain_id","label":"网域","type":"multi_enum","ops":["in"],"source":"network_domains"},
  {"key":"status","label":"运行状态","type":"multi_enum","ops":["in"],
   "options":[{"value":"online","label":"运行中"},{"value":"offline","label":"已停止"},{"value":"maintenance","label":"维护中"}],
   "default":["online","offline"]},
  {"key":"app_code","label":"应用","type":"multi_enum","ops":["in"],"source":"application_dicts"},
  {"key":"biz_code","label":"业务","type":"multi_enum","ops":["in"],"source":"business_domains"},
  {"key":"platform_code","label":"平台","type":"multi_enum","ops":["in"],"source":"platform_dicts"},
  {"key":"env","label":"环境","type":"multi_enum","ops":["in"],"options":[{"value":"OPS","label":"OPS"},{"value":"PRD","label":"PRD"},{"value":"UAT","label":"UAT"}]},
  {"key":"cluster","label":"集群","type":"text","ops":["eq","contains"]},
  {"key":"owner","label":"负责人","type":"text","ops":["contains"]}
]}
```

- `source` 表示选项来自哪个字典接口（前端懒加载）；`type=text` 的字段用输入框。
- 字段清单由服务端持有（当前为固定 8 项），**新增字段不改前端**；与选择器字段字典（§3.5）是两套口径：本清单用于「组合筛选」（`op` 为 `in`/`eq`/`contains`），选择器字典用于任务 `selector`（`operator` 另有 `contains_any`/`always`/`regexp`）。

**查询**：`POST /scrape-jobs/instance-candidates/query`

```json
{
  "template_code": "host_linux",
  "selector": {
    "logic": "all",
    "filters": [
      {"field":"os_family","operator":"eq","values":["linux"]}
    ]
  },
  "resource_category": "host",
  "filters": [
    {"field":"network_domain_id","op":"in","values":["mc-a","mc-b"]},
    {"field":"status","op":"in","values":["online"]},
    {"field":"app_code","op":"in","values":["order-svc"]}
  ],
  "keyword": "", "page": 1, "page_size": 20
}
```

- `template_code` 提供类别与向导预填：`resource_category` 留空时从模板继承；`selector` 完全缺省（无 `logic` 且无 `filters`）时用模板 `default_selector` 预填（service 侧完成，纯预填，不回写模板）。模板不存在或未绑定采集实现时按「无模板」处理（不报错），此时必须显式给 `resource_category`。
- `selector` 与 `filters` **AND 叠加**：`selector` 按字段字典编译成 SQL 谓词（§3.3 的 operator / 取值规则，含 M07 自定义字段），`filters` 走组合筛选字段表；两者同时生效。
- 显式传 `{"logic":"all","filters":[]}` 视为「用户已确认不限条件」，不触发 `default_selector` 预填。

```json
{"list":["…同 5.1 元素…"],"total":312,"page":1,"page_size":20,"truncated":false,
 "domains":[{"network_domain_id":"mc-a","network_domain_name":"域A","count":120}]}
```

- `domains` 为**分域计数**，直接用于保存前的分域预览（不再由前端二次聚合）。
- 未显式筛 `status` 时默认排除 `maintenance`（与 5.1 老接口一致）。
- 同字段多次出现按 AND 合并（`in` 取交集），不静默覆盖。
- `page_size` 上限 100。

**全选**：`POST /scrape-jobs/instance-candidates/query/ids`（同条件、无分页）

```json
{"ids":["r-1","r-2"],"total":312,"truncated":false,"max_ids":2000}
```

- 上限 2000；超限 `truncated=true`，前端必须提示收窄条件（禁止静默截断）。

**错误（400，fail-closed）**

| 场景 | 说明 |
|---|---|
| 未知字段 | `unsupported filter field "x"` |
| 不支持的操作符 | `operator "contains" is not supported for field "network_domain_id"` |
| 空 `values` | 至少一个取值 |
| 非法枚举值 | `status` / `env` 按白名单校验 |
| 未授权网域 | 授权范围外一律拒绝（服务端以会话租户为上限，浏览器不得放宽） |

**兼容**：`GET /scrape-jobs/instance-candidates` 保留（单网域、必填 `network_domain_id` 与 `resource_category`，`template_code` 仅用于地址解析），新前端走 POST。

### 5.2 Job 实例列表

`GET /scrape-jobs/{id}/instances` → `{ list, total }`，元素：

```json
{
  "resource_id": "db-01",
  "display_name": "mysql-01",
  "instance_ip": "10.0.0.11",
  "port": 3306,
  "port_source": "mapping",
  "status": "online",
  "target_address": "10.0.0.11:9104",
  "installation": {
    "status": "confirmed",
    "actual_port": 9104,
    "confirmed_by": "ops",
    "notes": "",
    "confirmed_at": "2026-11-16T10:00:00Z"
  }
}
```

`port_source` 见 §4.5（`instance` / `mapping` / `template` / `business` / `default` / `unresolved`）。`installation` 为 `null` 表示未登记。采集健康状态不由本接口返回；前端用 `GET /api/v1/targets?job=<job_name>` 合并（§10.3）。

### 5.3 安装登记

`POST /scrape-jobs/{id}/instances/{resource_id}/confirm`

```json
{ "actual_port": 9104, "confirmed_by": "ops", "notes": "已部署" }
```

- `confirmed_by` 必填；`actual_port` 可选（1~65535）。
- 资源必须在该 Job 的 `selected_instance_ids` 中，否则 400。
- 仅留痕，不影响 target 生成（NFR/FR-20）。
- 响应返回完整登记记录；`DELETE` 返回 `{ "resource_id": "...", "job_id": "..." }`。

### 5.4 目标预演

`POST /scrape-jobs/{id}/preview-targets`

```json
{
  "job_name": "mysql-prod",
  "targets": [
    {
      "targets": ["10.0.0.11:9104", "10.0.0.12:9104"],
      "labels": { "resource_id": "db-01", "network_domain": "mc-demo", "app": "order" }
    }
  ],
  "skipped": [
    { "resource_id": "db-03", "reason": "missing_address" }
  ]
}
```

- 只读预演：复用 `platform/configcenter/generator` 解析，不落盘、不生成配置、不 reload（NFR-01）。
- `skipped.reason`：`missing_address` / `missing_port` / `resource_not_found` / `resource_offline`。

---

## 6. 监控规则（MonitoringRule）

### 6.1 对象

```json
{
  "id": "r-01",
  "name": "主机存活",
  "content_mode": "yaml_passthrough",
  "rule_content": "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up == 0\n",
  "group_count": 1,
  "rule_count": 1,
  "template_code": "host_linux",
  "exporter_template_id": "",
  "scope": "central",
  "enabled": true,
  "draft_status": "ready",
  "ack_job_ref_errors": false,
  "ack_reason": "",
  "sync": { "status": "pending", "version": "", "error": "", "synced_at": null },
  "created_at": "2026-11-16T09:00:00Z",
  "updated_at": "2026-11-16T09:30:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `name` | string | 否 | 展示名；空则取首个 group 名 |
| `content_mode` | enum | 否 | MVP 仅 `yaml_passthrough`；`structured` → 400 |
| `rule_content` | string | 是 | 完整 `rules.yml`；≤1MB |
| `template_code` | string | 否 | 组织/筛选维度，不参与生成；非空时必须是已存在的采集模板（§3），否则 400 |
| `exporter_template_id` | string | 否 | 指标提示用 |
| `scope` | enum | 响应 | 固定 `central`；请求非 `central` → 400 |
| `enabled` | bool | 否 | 默认 true |
| `draft_status` | enum | 否 | `draft` / `ready`（默认） |
| `ack_job_ref_errors` | bool | 请求 | 逃生门；true 时 error 级 job 引用降级 warning 并留痕 |
| `ack_reason` | string | 否 | 逃生门原因；`ack=true` 时建议填写 |
| `group_count` / `rule_count` | int | 响应 | 解析结果 |

规则为平台级全局对象，**无** `network_domain_id`（D36）。

### 6.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/monitoring-rules` | 筛选 `enabled` / `draft_status` / `template_code` / `keyword` + 分页 |
| POST | `/monitoring-rules` | 创建；内部执行完整校验（等同于 validate + 组名唯一） |
| GET | `/monitoring-rules/{id}` | 详情 |
| PUT | `/monitoring-rules/{id}` | 更新 |
| DELETE | `/monitoring-rules/{id}` | 软删；响应 `{ "rule_id": "..." }` |
| POST | `/monitoring-rules/validate` | 预检，不落库 |

### 6.3 预检 `POST /monitoring-rules/validate`

请求：

```json
{ "id": "r-01", "rule_content": "groups:\n- name: host\n  rules:\n  - alert: HostDown\n    expr: up{job=\"node\"} == 0\n" }
```

`id` 为空或 `"0"` 表示新建（组名唯一性校验不排除自身）。响应：

```json
{
  "valid": false,
  "error": "group \"host\" 与现有规则冲突",
  "groups": 1,
  "rules": 1,
  "job_ref": [
    {
      "group": "host",
      "rule_name": "HostDown",
      "expr": "up{job=\"nope\"} == 0",
      "matcher": "job=\"nope\"",
      "referenced_job": "nope",
      "type": "literal",
      "severity": "error",
      "message": "存活类规则引用了不存在的 Job：nope"
    }
  ],
  "promql": { "status": "unavailable", "error": "promtool 不可调用" }
}
```

校验管线（顺序）：

1. YAML 语法 → 失败 `valid=false`。
2. `groups` 存在且为数组、每条规则含 `expr`、告警规则 `alert` / 记录规则 `record` 二选一。
3. group 名全局唯一：仅与「`enabled=true && draft_status=ready`」的其它规则比较。
4. job 引用分级（`jobref`）：全平台 `ready+enabled` Job 名并集；存活类（`up` / `absent(up)`）error，其余 warning；error **不改写** `valid`，但提交时未 `ack_job_ref_errors=true` → 400。
5. PromQL 语义（promtool）：`passed` 不阻断；`failed` → `valid=false`；`unavailable` 仅提示。

`valid` = 硬失败（1/2/3/5-failed）结论；`job_ref.severity=error` 是可覆盖轴。

### 6.4 提交门禁

- `POST/PUT` 内部重新执行完整校验；不信任前端「已检查」。
- 存在 error 级 `job_ref` 且 `ack_job_ref_errors != true` → 400，`error` 列出问题。
- `ack=true` 时落库 `ack_job_ref_errors=true` + `ack_reason`，供审计；后续内容变更保留标记直到再次编辑。

---

## 7. 指标库 / 业务指标 / 拨测模块

### 7.1 技术指标库（`/metric-library`）

对象：

```json
{
  "id": "m-01",
  "metric_name": "node_cpu_seconds_total",
  "metric_type": "counter",
  "help": "CPU time spent in seconds",
  "unit": "seconds",
  "labels": ["cpu", "mode"],
  "collection_templates": [{ "template_code": "host_linux", "source_exporter": "node-exporter" }],
  "category": "cpu",
  "exporter_template_id": "et-node",
  "is_builtin": true,
  "enabled": true,
  "created_at": "2026-11-16T09:00:00Z",
  "updated_at": "2026-11-16T09:00:00Z"
}
```

- 锚点数组为 `collection_templates`，元素 `{template_code, source_exporter}`：一个指标可在多套采集模板下各有含义（同 `metric_name` 不同锚点不算冲突）。`source_exporter` 仅作展示，可空（`omitempty`）。
- `GET /metric-library`：筛选 `template_code`（命中 `collection_templates` 中任一锚点）/ `metric_type` / `category`（语义域，如 cpu / memory）/ `keyword` / `enabled` + 分页。未知 `template_code` → 空页（不会退化为全量）。
- `POST`（**仅管理员**）：用户扩展指标，`is_builtin=false`；`metric_name` 须符合 Prometheus 命名 `^[a-zA-Z_:][a-zA-Z0-9_:]*$`（≤200 字符），`labels` 键须符合 `^[a-zA-Z_][a-zA-Z0-9_]*$`（≤64 个），`collection_templates[].template_code` 必填（服务端 trim + 按 code 去重）；判重口径为 **`(metric_name, template_code)`**：与任一相同锚点重复 → 409（内置行与用户行一起参与判重）。
- `PUT /metric-library/{id}`（**仅管理员**）：可更新 `metric_name` / `metric_type` / `help` / `unit` / `labels` / `collection_templates` / `category` / `exporter_template_id` / `enabled`；内置行 → 403；改名/改锚点同样走上面的命名与 `(metric_name, template_code)` 判重（排除自身）。
- `DELETE /metric-library/{id}`（**仅管理员**）：内置行 → 403；用户行软删。
- 内置指标保持只读：用户自定义一律另存 `is_builtin=false` 行，不覆盖内置行。
- ⚠️ 已知缺口：`resource_category` 查询参数仍在 handler 接收但未参与过滤（`repository.MetricFilter.ResourceCategory` 未落地），按类别筛选请改用 `template_code`（见 §11）。

### 7.2 业务指标（`/business-metrics`）

对象字段：`id` / `metric_id` / `metric_name` / `description` / `metric_type` / `unit` / `business_domain` / `app_name` / `threshold_suggestion` / `owner` / `register_source`（`self`/`agent`）/ `status`（`pending`/`instrumented`/`online`）/ `created_at` / `updated_at`。

- `GET /business-metrics`：筛选 `business_domain` / `status` / `owner` / `keyword` + 分页。
- `POST`：`metric_name` 唯一；`owner` 必填；`status` 默认 `pending`。
- `PUT /business-metrics/{id}`：状态仅允许 `pending→instrumented→online`，不可跳级/回退（400）；非 owner 修改语义字段 → 403（M03 后生效，MVP 记录）。
- `DELETE`：软删，仅 `pending` 允许。

### 7.3 拨测模块（`/blackbox-modules`）

对象：`id` / `name` / `content` / `is_builtin` / `enabled` / `referenced_job_count` / `created_at` / `updated_at`。

- 仅 `GET /blackbox-modules`、`GET /blackbox-modules/{id}`（只读，v2.0 不提供维护页）。
- 模块由平台 seed 预置：`http_2xx` / `icmp_ping` / `tcp_connect` / `dns_query`；Job 保存时校验存在且 enabled。
- M09 生成边缘 `blackbox.yml` 时读取 `m01_probe_modules`（enabled）作为模块定义。

---

## 8. 旧 v2 → v3 差异

| 旧 `/api/v2/platform/*` | 新 `/api/v3/platform/*` | 差异 |
|---|---|---|
| `GET /scrape-jobs` → `{items,total}` | `GET /scrape-jobs` → `{list,total,page,page_size}` | 分页键改名；新增 `sync`、`credential_configured` |
| `change_status`（pending/confirmed/deployed/none） | `sync.status`（draft/pending/syncing/synced/failed） | 状态机重定义；不再有 pending 锁 |
| `POST /scrape-jobs/batch-draft-status` | 删除 | 无批量草稿 |
| `blackbox_targets` 字段 | 删除 | 请求出现 → 400 |
| `mapping_overrides` 请求字段 | 服务端计算 | 请求不接收 |
| `POST /monitoring-rules/{id}/validate-yaml` | `POST /monitoring-rules/validate` | 统一入口；响应新增 `promql` / `groups` / `rules` |
| `resource_type` | `resource_category` | 与 M07 v3 用词对齐 |
| `items` 信封（子资源） | `list` | 统一 |
| `GET /metric-library`（无删除） | 新增 `DELETE` | 用户行可软删 |

---

## 9. 与 M07 / M09 / M06 的边界

### 9.1 M07（只读消费）

| 数据 | 用途 | 读取方式 |
|---|---|---|
| `resources` + 六类扩展表 | 候选实例、地址/端口、标签字段、存在性 | `m01/references` 只读 |
| `m07_label_templates` | 模板名称 / 类别 / 默认标记 / mappings | M07 v3 只读（00007）；删除前由 M01 引用计数端口拦截 |

M01 不写 M07 表；M07 资源删除由 M01 对账循环回收（D40）。

### 9.2 M09（单向依赖 M09 → M01）

- **每域配置包**：M09 `SourceReader` 只读 `m01_scrape_jobs`（`draft_status=ready && enabled && deleted_at IS NULL`）与 `m01_probe_modules`（`enabled`），把 Job 的 targets / labels / blackbox / 参数渲染进该域产物；**边缘包不含 rules**（D35）。
- **中心规则产物**：M09 单独读取 `m01_monitoring_rules`（`enabled && draft_status=ready`），以 `centerEvaluator=true` 生成中心 `rules.yml` 并 reload 中心 Prometheus（D35）。
- **同步写回**：M09 生成完成调用 `SyncResultSink`：`RecordDomainSync(domainID, version, generatedAt, outcomes)` / `RecordRuleSync(version, generatedAt, outcomes)`；M01 按 `updated_at <= generatedAt` 回写。
- M01 不 import M09、不读 M09 表、不主动通知 M09（NFR-03）。

### 9.3 M06（只读消费）

- 网域可选项：`GET /api/v3/platform/network-domains`（M09 enriched 视图，D32/D34）返回 `registration_status` / `status` / `domain_type`；前端筛选 `status=enabled && domain_type=edge && registration_status=monitored`。
- 服务端保存时二次校验：`network_domains.status=enabled` + `domain_type=edge` + `network_domain_access.registration_status=monitored`；不信任前端列表。

### 9.4 采集健康状态

- `GET /api/v1/targets?job=<job_name>`（M09，D28/D33 负责网域隔离）。
- 前端按 `instance` 与 Job 选中实例交集，派生 `待采集 / up / stale / down / unknown`；M01 后端不缓存 targets。
- 汇总口径：`在线 X / 总数 Y · 待采集 Z`。

---

## 10. 冻结字段与不变量

1. `job_name` 创建后允许改名，但必须**同域唯一**（00012 起；原「全局唯一」为 00006 口径，随 Job 组收敛）；改名等同新 Job 配置变更（`sync.status → pending`）。
2. `network_domain_id` 创建后不可变更（换域 = 新建 Job）。
3. `job_type` 创建后不可变更。
4. `draft_status` 只能 `draft → ready`，不可回退。
5. `sync` 为只读派生字段，任何写请求携带 `sync` → 400。
6. `password` / `token` 任何响应不得返回明文；日志不得打印。
7. 规则无 `network_domain_id`；`scope` 固定 `central`。
8. 所有时间戳由服务端生成，请求中的 `created_at` / `updated_at` 被忽略（严格 JSON 下出现 → 400）。
9. 删除为软删；`job_name` / `name` 唯一性仅在未删除行内生效（部分唯一索引）。
10. 跨模块读取一律只读；M01 不生成配置、不写 M09/上游目录、不触发 reload。

---

## 11. 待评审项

| 项 | 说明 | 关联 |
|---|---|---|
| ~~`label_template_name` 解析~~ | 已落地：`m07_label_templates` 只读 | D-3 已关闭 |
| 中心规则同步响应 | M09 center rules 产物版本/校验和如何回传 | D-4 |
| 凭证加密 | 当前以 `plain:<value>` 占位存储（S-M01-1）；需在安全审查前替换为 AES-GCM / secret ref | 安全审查 |
| `syncing` 瞬态 | 是否在 MVP 实现（否则 `pending → synced/failed` 两态） | D-2 |
| 业务指标权限 | `owner` 语义与 M03 权限模型对齐 | D-6 |
| 指标库 `resource_category` 过滤 | handler 已接收该查询参数，但 `MetricFilter.ResourceCategory` 尚未参与查询；当前只能按 `template_code` 过滤（§7.1 已按现状描述） | FR-18 / §7.1 |
| 采集模板 `default_selector` 的 M07 自定义字段 | 模板侧校验只认内置字段（无自定义字段解析器），任务侧候选查询支持；是否放开待定 | FR-22 / §3.3 |
| 任务 `selector` 保存期校验 | 已前移到 `POST/PUT /scrape-jobs`（与候选查询共用校验入口）；前端需在提交前完成同口径校验以给出定位提示 | FR-22 / §4.3 |
