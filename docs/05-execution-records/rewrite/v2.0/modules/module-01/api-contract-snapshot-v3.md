# Module 01 API v3 契约快照（draft，待 G2 评审）

> **状态**：draft（D-1/D-2 已由 owner 2026-11-16 确认：v3 模块重写 + `m01_*` 独立表 + M09 写回同步状态；其余待决见 `assessment.md` §10.2）
> **分支**：`rewrite/v2.0`
> **前缀**：`/api/v3/platform/*`
> **旧线**：`/api/v2/platform/*`（`platform/strategy/`）冻结保留，仅服务 legacy 模式
> **上位文档**：`assessment.md`、`docs/03-engineering-standards/03_API_Standard.md`、M01 SRS v1.2
> **冲突处理**：与 SRS 冲突以 SRS 为准；与工程标准冲突先报告 Orchestrator，禁止擅自改契约

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
| `/api/v3/platform/*` | 全局 `AuthMiddleware` | 匿名 → 401；MVP 登录用户（`platform_admin`）可写；M03 v3 落地后接入模块级权限 |
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
| `supported_monitor_types` | []string | 否 | 支持的监控对象类型；空 = 不限制 |
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
| DELETE | `/exporter-templates/{id}` | 软删；内置行 → 403；被默认采集配置引用 → 409 |

### 2.3 错误

| 场景 | errorType |
|---|---|
| `name` 重复 | `conflict` |
| 内置行写操作 | `forbidden` |
| 被 `m01_ci_type_exporter_mappings` 引用时删除 | `conflict` |
| `metrics_path` 非 `/` 开头 / port 越界 / scheme 非法 | `bad_request` |

---

## 3. 默认采集配置（CITypeExporterMapping）

### 3.1 对象

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 响应 | UUID |
| `monitor_type` | string | 是 | 见 `models.ValidMonitorTypes()` |
| `exporter_template_id` | string | 是 | 必须存在 |
| `exporter_template_name` | string | 响应 | 便于列表展示 |
| `is_default` | bool | 否 | 同一 `monitor_type` 至多一个默认 |
| `default_port` | int | 否 | 0~65535；0 = 继承采集实现 `default_port` |
| `metrics_path` | string | 否 | 默认继承采集实现 |
| `scheme` | enum | 否 | 默认继承采集实现 |
| `scrape_interval` | duration | 否 | 默认 `15s` |
| `scrape_timeout` | duration | 否 | 默认 `10s`，须 < interval |
| `label_template_id` | string | 否 | 只读返回；变更走专用端点 |
| `label_template_name` | string | 响应 | M07 模板名称；模板不存在时为空串 |
| `is_builtin` | bool | 响应 | 内置行只读 |
| `created_at` / `updated_at` | datetime | 响应 | |

### 3.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ci-exporter-mappings` | 筛选 `monitor_type` / `is_default` / `keyword` + 分页 |
| POST | `/ci-exporter-mappings` | 创建（**不接收** `label_template_id`） |
| PUT | `/ci-exporter-mappings/{id}` | 更新（**不接收** `label_template_id`）；内置行 → 403 |
| PUT | `/ci-exporter-mappings/{id}/label-template` | 专用变更入口：`{ "label_template_id": "" }`（空串 = 清除） |
| DELETE | `/ci-exporter-mappings/{id}` | 软删；内置行 → 403；`is_default=true` → 409（先取消默认）；被 Job 引用 → 409 |

### 3.3 校验

- `monitor_type` 必须是已知类型；`exporter_template_id` 必须存在且 `supported_monitor_types` 为空或包含该类型。
- `is_default=true` 且同类型已有其它默认 → 409。
- duration 必须匹配 `^\d+(ms|s|m|h|d|w|y)$`；`scrape_timeout < scrape_interval`。
- `label_template_id` 非空时必须存在于 `m07_label_templates`，且模板 `resource_category` 与 `monitor_type` 推导类别一致。

---

## 4. 采集 Job（ScrapeJob）

### 4.1 对象

```json
{
  "id": "8f2c...",
  "job_name": "mysql-prod",
  "job_type": "standard",
  "resource_category": "database",
  "monitor_type": "mysql",
  "exporter_template_id": "et-mysqld",
  "exporter_template_name": "mysqld-exporter",
  "network_domain_id": "mc-demo",
  "network_domain_name": "演示采集域",
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
| `job_name` | string | 是 | 唯一；Prometheus `job_name`；`^[a-zA-Z_][a-zA-Z0-9_.-]*$`，≤100 |
| `job_type` | enum | 否 | `standard`（默认）/ `blackbox` |
| `resource_category` | enum | 是 | `host` / `database` / `middleware` / `application` / `interface_service` / `generic_target` |
| `monitor_type` | string | 条件 | standard 必填；blackbox 必须为空 |
| `exporter_template_id` | string | 否 | 可空（手填参数 / application_http / blackbox） |
| `network_domain_id` | string | 是 | M06 已登记 + enabled + `domain_type=edge` + M09 `monitored` |
| `instance_selection_mode` | enum | 否 | MVP 仅 `manual`；`filter` → 400（v0.2） |
| `selected_instance_ids` | []string | 条件 | `ready` 时至少 1；`draft` 可为空 |
| `scrape_interval` | duration | 否 | 留空按层叠链解析 |
| `scrape_timeout` | duration | 否 | 留空按层叠链解析 |
| `metrics_path` | string | 条件 | `application` 分类必填；其余留空继承 |
| `scheme` | enum | 否 | `http` / `https` |
| `auth_type` | enum | 否 | `none`（默认）/ `basic` / `bearer` |
| `username` / `password` | string | 条件 | `basic` 必填；`password` 只写不回显，更新时留空 = 保持原值 |
| `token` | string | 条件 | `bearer` 必填；只写不回显，更新时留空 = 保持原值 |
| `tls_skip_verify` | bool | 否 | 默认 false |
| `ca_file` | string | 否 | 证书路径（由部署约定解析） |
| `label_template_id` | string | 否 | 须存在且类别匹配；空 = 无模板 |
| `blackbox_module` | string | 条件 | blackbox 必填，须为启用的拨测模块名 |
| `target_field` | string | 响应 | 服务端派生：`interface_service→api_url`、`application→health_check_url`；请求传值忽略 |
| `mapping_overrides` | []object | 响应 | 服务端按提交值与映射默认值比对后计算；请求不接收 |
| `blackbox_targets` | — | — | **已删除**；请求出现该字段或非空 → 400 |
| `draft_status` | enum | 否 | `draft` / `ready`（默认）；仅允许 `draft→ready` |
| `enabled` | bool | 否 | 默认 true；与 `draft_status` 正交 |

`password` / `token` 永不返回；仅返回 `credential_configured`。

### 4.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/scrape-jobs` | 筛选 `network_domain_id` / `monitor_type` / `job_type` / `enabled` / `draft_status` / `keyword` / `label_template_id` + 分页 |
| POST | `/scrape-jobs` | 创建 |
| GET | `/scrape-jobs/{id}` | 详情（含 `sync`） |
| PUT | `/scrape-jobs/{id}` | 更新（含启停/草稿提交） |
| DELETE | `/scrape-jobs/{id}` | 软删；响应 `{ "job_id": "..." }` |
| GET | `/scrape-jobs/instance-candidates` | 见 §5.1 |
| GET | `/scrape-jobs/{id}/instances` | 见 §5.2 |
| POST | `/scrape-jobs/{id}/instances/{resource_id}/confirm` | 见 §5.3 |
| DELETE | `/scrape-jobs/{id}/instances/{resource_id}/confirm` | 撤销安装留痕 |
| POST | `/scrape-jobs/{id}/preview-targets` | 见 §5.4 |

### 4.3 校验矩阵（保存时，按顺序短路）

| # | 校验 | 失败 |
|---|---|---|
| 1 | `job_name` 格式与唯一（排除自身） | 400 / 409 |
| 2 | `job_type=blackbox` → `resource_category ∈ {interface_service, application}`；`monitor_type` 必须为空；`blackbox_module` 必须存在且 enabled | 400 |
| 3 | `job_type=standard` → `monitor_type` 合法；`resource_category` 与 `monitor_type` 推导一致 | 400 |
| 4 | 网域存在 + enabled + `edge` + M09 `monitored` | 400（提示先纳管） |
| 5 | 选中实例全部存在、同网域、类别匹配；`offline` 不可新增（已选存量允许保留） | 400 |
| 6 | `draft_status=ready` → 至少 1 个选中实例 | 400 |
| 7 | blackbox 选中实例的派生地址非空 | 400 |
| 8 | 认证组合：`basic` 需 username + password（更新可留空沿用）；`bearer` 需 token | 400 |
| 9 | `tls_skip_verify=true` 且 `scheme=http` → 允许但告警（不阻断） | — |
| 10 | duration 合法且 timeout < interval；`metrics_path` 以 `/` 开头 | 400 |
| 11 | `label_template_id` 存在且类别匹配（M07 `m07_label_templates`） | 400 |
| 12 | `exporter_template_id` 存在且支持该 `monitor_type` | 400 |

### 4.4 生效参数层叠（保存时解析并落快照）

```text
scrape_interval : Job 提交值 → 默认采集配置 → 15s
scrape_timeout  : Job 提交值 → 默认采集配置 → 10s（且 < interval）
metrics_path    : Job 提交值 → 默认采集配置 → 采集实现 → /metrics
scheme          : Job 提交值 → 默认采集配置 → 采集实现 → http
```

`application` 分类的 `metrics_path` 必填、不参与继承。保存后返回解析后的生效值；后续映射变更不穿透（NFR-06），除非用户调用「同步映射默认值」。

> 「同步映射默认值」在 v3 通过 `PUT /scrape-jobs/{id}` 携带 `sync_mapping_defaults: true`（请求级开关，非持久字段）实现：仅刷新 `mapping_overrides` 之外的字段。

### 4.5 端口与目标解析（MVP，供 preview-targets 与 M09 生成共用）

| 分类 | 地址 | 端口 |
|---|---|---|
| `host` | `host_resources.instance_ip` | `resources.scrape_port` → 映射 `default_port` → 采集实现 `default_port` → 9100 |
| `database` / `middleware` | `instance_ip` | `resources.scrape_port` → 映射 `default_port` → 业务 `port` |
| `application` | `instance_ip` | 资源 `port` 直用（不参与解析链） |
| `generic_target` | `instance_ip` | 资源 `port` 直用；0 时按 scheme 默认端口 |
| `interface_service` / `application`（blackbox） | `api_url` / `health_check_url` 完整 URL | 不适用 |

无地址 / 端口无法解析的实例在 `preview-targets` 中进入 `skipped`，不阻断保存。

---

## 5. 实例候选 / 安装登记 / 预演

### 5.1 实例候选

`GET /scrape-jobs/instance-candidates?monitor_type=&network_domain_id=&keyword=&page=&page_size=`

```json
{
  "list": [
    {
      "resource_id": "db-01",
      "resource_category": "database",
      "monitor_type": "mysql",
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

- `monitor_type` + `network_domain_id` 必填；候选仅同类型 + 同网域。
- `offline` 返回但 `selectable=false`、`disabled_reason="实例已离线"`。
- `npu`：候选为主机全集，不按 OS/型号过滤。
- blackbox：`monitor_type` 可空，改传 `resource_category=interface_service|application`；`target_address` 为派生 URL。

### 5.2 Job 实例列表

`GET /scrape-jobs/{id}/instances` → `{ list, total }`，元素：

```json
{
  "resource_id": "db-01",
  "display_name": "mysql-01",
  "instance_ip": "10.0.0.11",
  "port": 3306,
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

`installation` 为 `null` 表示未登记。采集健康状态不由本接口返回；前端用 `GET /api/v1/targets?job=<job_name>` 合并（§10.3）。

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
  "monitor_type": "host_linux",
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
| `monitor_type` | string | 否 | 组织/筛选维度，不参与生成 |
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
| GET | `/monitoring-rules` | 筛选 `enabled` / `draft_status` / `monitor_type` / `keyword` + 分页 |
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
  "monitor_types": [{ "monitor_type": "host_linux", "source_exporter": "node-exporter" }],
  "category": "cpu",
  "exporter_template_id": "et-node",
  "is_builtin": true,
  "enabled": true,
  "created_at": "2026-11-16T09:00:00Z",
  "updated_at": "2026-11-16T09:00:00Z"
}
```

- `GET /metric-library`：筛选 `monitor_type` / `metric_type` / `category` / `keyword` / `enabled` + 分页。
- `POST`：用户扩展指标，`is_builtin=false`；`metric_name` 重复且同 `monitor_type` 锚点 → 409。
- `PUT /metric-library/{id}`：可更新 `enabled` / `help` / `unit` / `monitor_types` / `category`；内置行 → 403。
- `DELETE /metric-library/{id}`：内置行 → 403；用户行软删。

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

1. `job_name` 创建后允许改名，但必须全局唯一；改名等同新 Job 配置变更（`sync.status → pending`）。
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
