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
| GET | `/api/v3/platform/cloud-dict` | 云字典（只读） |
| GET | `/api/v3/platform/os-options` | OS 字典（只读） |
| GET/POST/PUT/DELETE | `/api/v3/platform/app-platform-rel` | 应用↔平台关系 |

- 字典编码不可变；停用不删除；写接口需鉴权。
- `app-platform-rel` 同一 `app_code` 至多一个 `is_primary=true`。

---

## 6. 导入接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v3/platform/resources/import-templates/{resource_category}` | 模板下载 |
| POST | `/api/v3/platform/resources/import` | Excel 导入（multipart） |
| GET | `/api/v3/platform/imports` | 导入记录 |
| GET | `/api/v3/platform/imports/{import_id}` | 导入详情 |

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
