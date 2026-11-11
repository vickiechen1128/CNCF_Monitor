# Module 06 API v3 契约快照（frozen）

> **状态**：frozen（B6-2）
> **分支**：`rewrite/v2.0`
> **前缀**：`/api/v3/platform/*`
> **旧线**：`/api/v2/platform/*` 兼容窗口内保留
> **上位文档**：`assessment.md`、`backend-execution.md`、`03_API_Standard.md`

---

## 1. 通用约定

### 1.1 响应信封

```json
{ "status": "success", "data": {} }
{ "status": "error", "errorType": "bad_request", "error": "human readable message" }
```

`errorType`：`bad_request` / `unauthorized` / `forbidden` / `not_found` /
`conflict` / `unavailable` / `internal`。

### 1.2 分页

- `page` 从 1 开始，默认 1；
- `page_size` 默认 20，上限 100；
- 响应：`{ "list": [], "total": 0, "page": 1, "page_size": 20 }`；
- 时间：RFC3339；空时间返回 `null`；
- 字段：snake_case；ID 字段以 `_id` 结尾（用户主键例外，沿用 `id`）。

### 1.3 鉴权

- 全局 `AuthMiddleware` 覆盖 `/api/v3/*`，匿名 → 401 `unauthorized`。
- 网域 GET（列表/详情/影响面）仅要求登录。
- 租户、用户、登录日志、网域写操作、存储日志全部挂 `RequireAdmin`，`user` 角色 → 403 `forbidden`。
- 过渡期登录：`POST /api/v3/platform/auth/login`（匿名）。

---

## 2. 租户

### 2.1 视图

```json
{
  "id": "platform_admin",
  "name": "平台默认租户",
  "network_domain_ids": ["mc-demo"],
  "multi_site_enabled": false,
  "is_platform_admin": true,
  "status": "active",
  "created_at": "2026-11-11T10:00:00Z",
  "updated_at": "2026-11-11T10:00:00Z"
}
```

`network_domain_ids` 是只读派生缓存，权威字段为
`network_domains.authorized_tenant_ids`（D17）。

### 2.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tenants` | `status` / `keyword` + 分页；`created_at asc` |
| GET | `/tenants/:id` | 详情；不存在 → 404 |
| PUT | `/tenants/:id` | 仅 `name` / `multi_site_enabled`；无字段或不可变字段 → 400 |
| POST | `/tenants` | MVP 固定 403（不开放创建） |
| PATCH | `/tenants/:id/status` | MVP 固定 403（不开放状态变更） |

PUT 使用严格 JSON：`network_domain_ids`、`is_platform_admin`、`status`、`id`
等出现即 400，不静默忽略（D20）。

---

## 3. 网域（行政字段）

### 3.1 视图

```json
{
  "id": "mc-demo",
  "name": "演示采集域",
  "description": "示例",
  "domain_type": "edge",
  "domain_type_label": "采集节点域",
  "zone_type": "beijing",
  "cloud_code": "aliyun",
  "tenant_id": "platform_admin",
  "authorized_tenant_ids": ["platform_admin"],
  "status": "enabled",
  "created_at": "2026-11-11T10:00:00Z",
  "updated_at": "2026-11-11T10:00:00Z"
}
```

响应不包含 `channel/token/agent_type/remote_write_url/last_heartbeat/
monitored_status/ip_cidrs/cmdb_*`。

### 3.2 端点

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/network-domains` | 登录 | `status/keyword/cloud_code/zone_type/tenant_id` + 分页；`created_at asc` |
| GET | `/network-domains/:id` | 登录 | 详情；不存在 → 404 |
| GET | `/network-domains/:id/impact` | 登录 | 影响面 |
| POST | `/network-domains` | admin | 登记；固定 `edge` + `agent_pull` |
| PUT | `/network-domains/:id` | admin | 仅 `name/description/zone_type/authorized_tenant_ids` |
| PATCH | `/network-domains/:id/status` | admin | `enabled/disabled`；禁用返回 `impact` |
| DELETE | `/network-domains/:id` | admin | 有 M07 引用 → 409；无引用软删 |

### 3.3 创建

```json
{
  "name": "演示采集域",
  "description": "可选",
  "cloud_code": "aliyun",
  "zone_type": "beijing",
  "domain_code": "demo",
  "authorized_tenant_ids": ["platform_admin"]
}
```

- `name` 必填、trim 后非空、≤100、大小写不敏感唯一；
- `description` ≤500；
- `cloud_code` 必填且必须是启用云字典条目；
- `zone_type` 必填且必须存在于 `zone_types`；
- `domain_code` 可选，规则 `[a-z0-9-]`，保留 `default`；缺省随机 8 位 hex；
- `domain_type` 仅接受 `edge`；`collection`/`management`/其他 → 400（D22）；
- `tenant_id` 由服务端固定 `platform_admin`，请求出现 → 400；
- `authorized_tenant_ids` 缺省 `[platform_admin]`；每个租户必须存在且 active；
- ID = `<METRIC_CENTER_DEPLOY_CODE 或 mc>-<domain_code>`；
- 名称或 ID 冲突 → 409；软删 ID 不可重登记 → 409。

### 3.4 编辑

```json
{
  "name": "新名称",
  "description": "新描述",
  "zone_type": "beijing",
  "authorized_tenant_ids": ["platform_admin", "tenant-a"]
}
```

- 至少一个字段；`{}` → 400；
- `cloud_code`、`tenant_id`、`domain_type`、`id`、`status` 出现 → 400；
- 授权变更在事务内重建受影响租户的 `network_domain_ids`。

### 3.5 状态与影响面

PATCH body：`{"status":"enabled"}` 或 `{"status":"disabled"}`。

禁用响应：

```json
{
  "id": "mc-demo",
  "status": "disabled",
  "impact": {
    "resource_count": 1,
    "sample_resources": [
      {"resource_id": "res-1", "resource_category": "host", "name": "web-01"}
    ],
    "managed_edge_agent_count": 0,
    "has_online_agents": false,
    "monitoring_available": false
  }
}
```

- 启用不返回 `impact`；重复禁用幂等；
- `monitoring_available=false` 表示 M09/M11 v3 尚未接入（D19）。

### 3.6 删除

- M07 引用 >0 → 409 `conflict`，`error` 含引用数量与样例；
- 无引用 → 软删 + 清运行态 token/agent 字段 + `registration_status=retired`
  + 清租户授权缓存；
- 响应同时返回 `impact` 与 `cascade_impact`（同口径）。

---

## 4. 用户

### 4.1 视图

```json
{
  "id": "0f0e...",
  "tenant_id": "platform_admin",
  "username": "ops01",
  "display_name": "运维一号",
  "role": "user",
  "status": "active",
  "last_login_at": null,
  "created_at": "2026-11-11T10:00:00Z"
}
```

绝不返回 `password_hash`。

### 4.2 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/users` | `keyword/role/status` + 分页；`created_at asc` |
| POST | `/users` | `username/display_name/password/role?` |
| PUT | `/users/:id` | 仅 `display_name/role`；`username` 出现 → 400 |
| PATCH | `/users/:id/status` | `active/disabled`；禁用即清会话 |
| PUT | `/users/:id/password` | 重置密码并清会话 |
| DELETE | `/users/:id` | 仅 `role=user`；admin → 400；软删 + 清会话 |

### 4.3 规则

- `tenant_id` 固定 `platform_admin`，请求出现 → 400；`status` 创建时固定 `active`；
- `username` trim 后非空、≤64、全局唯一；创建后不可变；
- `display_name` trim 后非空、≤100；
- 密码 8–72 字节（bcrypt 上限）；
- `role` 仅 `admin`/`user`，创建缺省 `user`；
- 最后一个 active admin：禁用/删除/降级 → 409 `conflict`；
- 删除普通用户为显式 `deleted_at` 软删；admin 删除（非最后）→ 400；
- 禁用/重置密码/删除在事务内删除该用户全部 `sessions`。

---

## 5. 登录日志

### 5.1 视图

```json
{
  "id": "log-1",
  "username": "ops01",
  "success": false,
  "ip": "10.0.0.1",
  "created_at": "2026-11-11T10:00:00Z"
}
```

不返回 `message`（诊断信息仅内部保留）。

### 5.2 端点

`GET /login-logs`

| 参数 | 说明 |
|---|---|
| `username` | 精确匹配 |
| `success` | `true` / `false`；非法 → 400 |
| `start_time` / `end_time` | RFC3339；非法 → 400；start > end → 400 |
| `page` / `page_size` | 分页；`created_at desc` |

---

## 6. 存储与日志

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/storage-logs` | 保留策略期望/运行时 + 磁盘占用 + 日志轮转 |
| PUT | `/storage-logs/retention` | `time/size` 必填；原子写 env；不重启 Prometheus |

### 6.1 响应

```json
{
  "retention": {
    "desired": {"time": "30d", "size": "20GB"},
    "runtime": {"time": "15d", "size": "2GiB"},
    "source": "env_file",
    "env_file": "/opt/data/metric-center/config-output/prom-retention.env",
    "env_file_exists": true,
    "runtime_available": true,
    "pending_restart": true
  },
  "disks": [
    {"label": "TSDB 数据目录", "path": "/opt/data/...", "total_bytes": 0, "used_bytes": 0, "free_bytes": 0, "usage_percent": 0}
  ],
  "log_rotation": {"mechanism": "logrotate", "active": true, "summary": "..."}
}
```

### 6.2 降级与错误

- Prometheus 不可达：200 + `runtime_available=false`；
- `EnvFile` 未配置：GET 仍 200；PUT → 503 `unavailable`，错误文案含配置指引；
- 非法时长/容量/空值/未知字段 → 400，且不落盘；
- 单位归一化：`360h`=`15d`、`2GB`=`2GiB`。

---

## 7. 旧 v2 → 新 v3 差异

| 能力 | v2 | v3 |
|---|---|---|
| 信封 | `{status,data}` / `{items,total}` | `{status,data}` / `{list,total,page,page_size}` |
| 租户 | 可 POST/PATCH | MVP POST/PATCH → 403 |
| 网域类型 | `management`/`edge` | 只创建 `edge`；`management` 拒绝；`collection` 读兼容 |
| 默认网域 | 预置 `default` 管理域 | 不预置；历史行迁移为 edge |
| 网域删除 | 有引用 403 | 有引用 409 + 引用摘要 |
| 网域响应 | 含纳管字段 | 仅行政字段 + `domain_type_label` |
| 用户 | admin 不可删；无最后管理员保护 | admin 不可删 + 最后 active admin 保护 + 事务清会话 |
| 登录日志 | username/success | + `start_time`/`end_time`，不返回 message |
| 存储日志 | `/api/v2/platform/storage-logs*` | 同语义迁入 m06/storage，Options 注入 |
| 鉴权 | 全局 AuthMiddleware + RequireAdmin | 同左；网域 GET 登录即可，写操作 admin |

---

## 8. 冻结字段与不变量

- 网域：`id`、`tenant_id`、`cloud_code`、`domain_type` 创建后不可变；
- 用户：`id`、`tenant_id`、`username` 创建后不可变；
- 租户：`id`、`network_domain_ids`、`is_platform_admin` 只读；
- `network_domains.authorized_tenant_ids` 是租户网域授权的唯一权威；
- 所有管理接口不返回密码哈希、网域 token、登录日志 message。
