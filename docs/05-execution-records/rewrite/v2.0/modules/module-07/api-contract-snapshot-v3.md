# Module 07 API v3 契约快照（draft）

> **状态**：draft（B0-2）
> **分支**：`rewrite/v2.0`
> **前缀**：`/api/v3/platform/*`
> **旧线**：`/api/v2/platform/*` 归档，仅作回归对照
> **上位文档**：`backend-assessment.md`、`03_API_Standard.md`、`api-standard` Skill

---

## 1. 通用约定

- 响应信封：

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

- `errorType`：`bad_request` / `unauthorized` / `forbidden` / `not_found` / `conflict` / `internal` / `bad_gateway`。
- 分页：`page` 从 1 开始；`page_size` 默认 **20**，上限 **100**；响应 `{list,total,page,page_size}`。
- 时间：RFC3339；空时间返回 `null`。
- 字段：JSON 统一 snake_case；ID 字段以 `_id` 结尾。
- 资源响应统一为「公共字段 + `attributes`」，`attributes` 按 `resource_category` 取不同结构。

---

## 2. 资源对象

### 2.1 公共字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `resource_id` | string | UUID，全局唯一，创建后不可变 |
| `resource_category` | enum | host/database/middleware/application/generic_target/interface_service |
| `tenant_id` | string | 租户；MVP `platform_admin` |
| `network_domain_id` | string | 网域 ID |
| `biz_code` | string? | 业务编码 |
| `app_code` | string? | 应用编码 |
| `platform_code` | string? | 平台编码 |
| `env` | enum | OPS/PRD/UAT |
| `cluster` | string? | 集群 |
| `owner` | string? | 负责人 |
| `status` | enum | online/offline/maintenance |
| `source_type` | enum | manual/import/cmdb |
| `scrape_port` | int | 0 = 未指定；1~65535 |
| `attributes` | object | 类型专属字段，见 §2.2 |
| `created_at` / `updated_at` | datetime | RFC3339 |

### 2.2 `attributes` 结构

| category | attributes |
|---|---|
| `host` | `hostname`, `instance_ip`, `os_type`, `os_version`, `activated_at` |
| `database` | `database_type`, `instance_ip`, `port`, `version` |
| `middleware` | `middleware_type`, `instance_ip`, `port`, `version` |
| `application` | `service_name`, `health_check_url`, `protocol`, `endpoint`, `port`, `owner1`, `owner1_contact`, `owner2`, `owner2_contact`, `ops_person`, `ops_person_contact`, `go_live_at` |
| `generic_target` | `target_name`, `instance_ip`, `port`, `metrics_path`, `scheme`, `exporter_type` |
| `interface_service` | `api_name`, `api_url` |

> `connection_string` 不在响应中回显；如需凭证，使用 secret ref / 脱敏字段，具体在 B6-3 安全审查定稿。

### 2.3 示例：host

```json
{
  "resource_id": "6f1c2d3e-...",
  "resource_category": "host",
  "tenant_id": "platform_admin",
  "network_domain_id": "default",
  "biz_code": "payment",
  "app_code": "order-service",
  "platform_code": "ecommerce",
  "env": "PRD",
  "cluster": "prod-a",
  "owner": "ops",
  "status": "online",
  "source_type": "manual",
  "scrape_port": 0,
  "attributes": {
    "hostname": "web-01",
    "instance_ip": "10.0.0.1",
    "os_type": "linux",
    "os_version": "Ubuntu 22.04",
    "activated_at": "2026-01-01T00:00:00Z"
  },
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z"
}
```

---

## 3. 资源接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v3/platform/resources` | 列表；`resource_category` 必填 |
| POST | `/api/v3/platform/resources` | 创建 |
| GET | `/api/v3/platform/resources/{resource_id}` | 详情 |
| PUT | `/api/v3/platform/resources/{resource_id}` | 全量更新 |
| DELETE | `/api/v3/platform/resources/{resource_id}` | 软删 |
| GET | `/api/v3/platform/resources/{resource_id}/referenced-by` | 引用 Job 反查 |

> D40：资源删除仅软删台账；M01 内置周期对账（pull，默认 60s 可配置）发现实例失效后，从各 Job `selected_instance_ids` 回收。M07 **不反向依赖 M01**（无同步调用、无外键/触发器）；M01 v3 尚未落地，对账循环待实现。

### 3.1 列表 Query

`resource_category`（必填）、`network_domain_id`、`biz_code`、`status`、`platform_code`、`app_code`、`keyword`、`page`、`page_size`。

### 3.2 创建 / 更新请求

创建请求 = 公共字段（不含 `resource_id` / `source_type` / 时间戳）+ `attributes`；`resource_category` 必填。

更新请求 = 全量可更新字段；`resource_id` / `resource_category` / `source_type` / `tenant_id` 不可变。

示例（application）：

```json
{
  "resource_category": "application",
  "network_domain_id": "default",
  "biz_code": "payment",
  "app_code": "order-service",
  "platform_code": "ecommerce",
  "env": "PRD",
  "cluster": "prod-a",
  "status": "online",
  "attributes": {
    "service_name": "order-api",
    "health_check_url": "https://order.example.com/health",
    "protocol": "https",
    "endpoint": "10.0.0.20",
    "port": 8080,
    "owner1": "张三",
    "owner1_contact": "13800000000"
  }
}
```

### 3.3 错误

- 必填/格式错误 → `bad_request`；
- 资源不存在/已删除 → `not_found`；
- 判重键冲突 → `conflict`（`error` 中回传 dedup_key / 已存在 resource_id）；
- 字典停用/不存在 → `bad_request`；
- 静态资源写 user 标签 → `forbidden`。

---

## 4. 标签接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v3/platform/resources/{resource_id}/labels` | 标签列表 |
| POST | `/api/v3/platform/resources/{resource_id}/labels` | 新增 user 标签 |
| PUT | `/api/v3/platform/resources/{resource_id}/labels/{label_id}` | 编辑 user 标签 |
| DELETE | `/api/v3/platform/resources/{resource_id}/labels/{label_id}` | 删除 user 标签 |

- `source`：`system` / `user` / `cmdb`；system 实时计算、不落库。
- 写边界：仅 `application` / `interface_service` 可写 user 标签；其余 403。
- 唯一键：`(resource_id, key, source)`。

---

### 4.1 标签模板（v3 新增）

v3 使用 `m07_label_templates`（前缀避免与 legacy `label_templates` 冲突）。模板锚定资源类别，携带有序 mappings；M01 只读引用，并在删除时通过引用计数端口拦截。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v3/platform/label-templates` | 列表；筛选 `resource_category` / `is_default` / `keyword` + 分页 |
| POST | `/api/v3/platform/label-templates` | 创建；同名同类别 → 409 |
| GET | `/api/v3/platform/label-templates/{id}` | 详情 |
| PUT | `/api/v3/platform/label-templates/{id}` | 更新；`resource_category` 不可变（400） |
| DELETE | `/api/v3/platform/label-templates/{id}` | 软删；被 M01 映射/Job 引用 → 409 |

对象：

```json
{
  "id": "lt-1",
  "name": "host-default",
  "resource_category": "host",
  "is_default": true,
  "mappings": [
    { "source_field": "resource_id", "source_type": "resource_field", "target_label": "resource_id", "enabled": true }
  ],
  "created_at": "2026-11-16T10:00:00Z",
  "updated_at": "2026-11-16T10:00:00Z"
}
```

约束：

- 同一 `resource_category` 至多一个 `is_default=true`；设置新默认时旧默认自动取消。
- `target_label` 必须匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$`、不得以 `__` 开头、模板内唯一；`source_type=composite` 时目标必须为 `instance`。
- M01 删除引用计数端口由 `v3.go` 注入（M07 不 import M01）。

---

## 5. 字典接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v3/platform/business-domains` | 业务分组 |
| POST | `/api/v3/platform/business-domains` | 登记 |
| PUT | `/api/v3/platform/business-domains/{code}` | 受限编辑 |
| GET | `/api/v3/platform/application-dict` | 应用字典 |
| POST | `/api/v3/platform/application-dict` | 登记 |
| PUT | `/api/v3/platform/application-dict/{app_code}` | 受限编辑 |
| GET | `/api/v3/platform/platform-dict` | 平台字典 |
| POST | `/api/v3/platform/platform-dict` | 登记 |
| PUT | `/api/v3/platform/platform-dict/{platform_code}` | 受限编辑 |
| GET | `/api/v3/platform/cloud-dict` | 云字典（只读；写接口在 M06，D37） |
| GET | `/api/v3/platform/os-options` | OS 字典（只读） |
| GET/POST/PUT/DELETE | `/api/v3/platform/app-platform-rel` | 应用↔平台关系 |

- 字典编码不可变；停用不删除；写接口需鉴权。
- 云字典读视图返回 `cloud_code / cloud_name / cloud_type / carrier / description / enabled`（`description` 为空时省略）；`cloud_type` / `carrier` 仅为描述属性，不独立成筛选维度 / label。D37 起新增与停用由 M06 提供（`POST` / `PUT`，admin），M07 不重复注册写路由。
- `app-platform-rel` 同一 `app_code` 至多一个 `is_primary=true`。

---

## 6. 导入接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v3/platform/import-templates/{resource_category}` | 模板列定义 |
| POST | `/api/v3/platform/imports` | Excel 导入（multipart） |
| GET | `/api/v3/platform/imports` | 导入记录 |
| GET | `/api/v3/platform/imports/{import_id}` | 导入详情 |

> 为避免 Gin `/:resource_id` 与静态 `import` 路径冲突，v3 将导入接口放在 `/imports`，模板列定义放在 `/import-templates/{category}`。

- Form：`file`、`resource_category`、`mode=create_only|upsert`。
- 文件 ≤ 10MB；仅 xlsx。
- 返回 `{total, success, updated, failed, errors:[{row, resource_category, field, value, reason}]}`。
- 判重由 DB 唯一索引兜底；并发冲突映射为 failed / conflict。

---

## 7. v2 → v3 对照

| v2 | v3 | 说明 |
|---|---|---|
| `/api/v2/platform/resources` | `/api/v3/platform/resources` | 路径升级 |
| `app_name` 物理列 / `app_code` 语义 | `app_code` | v3 统一语义命名 |
| `sub_app_code` | `cluster` | 去掉 legacy 名 |
| `env_flag` | `env` | 去掉 legacy 名 |
| `cloud_code` 资源字段 | 经网域派生 | v3 响应可保留派生字段，但不落资源表 |
| `map[string]interface{}` 列表 | typed DTO | v3 契约稳定 |
| 默认 `page_size=50` | 默认 20 / 上限 100 | 对齐 API 标准 |

---

## 8. 待确认

- [ ] `attributes` 嵌套 vs 六类扁平 DTO（当前建议嵌套）。
- [ ] `connection_string` 的 secret ref / 加密方案。
- [ ] 旧 `/api/v2` 兼容窗口长度。
- [ ] `resource_audit_logs` 是否进入 MVP。
