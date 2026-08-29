# API 契约快照：module-06-tenant-user-auth（Track B/B+ 增量，决策 44）

> 来源：Module_06 v2.3 §5.3 / §5.4 / §6.1 / §6.3；Module_03 v1.2 §4.0；`docs/03-engineering-standards/03_API_Standard.md`
> 统一响应格式：`{status, data, errorType, error}`（`platform/api/response`）
> 版本：2026-08-28（与 task-sequence.yaml 同版；再生成条件：PRD §5/§6 变更、API 标准变更、模型字段变更）

## 1. 认证（Module_03 v1.2 §4.0）

### POST /api/v2/platform/auth/login

- 请求：`{"username": "admin", "password": "admin123"}`
- 成功 200：`data = {"token": "<不透明随机串>", "expires_at": "2026-08-28T22:00:00+08:00", "user": {"id": "...", "username": "admin", "display_name": "系统管理员", "tenant_id": "platform_admin", "role": "admin"}}`
- 失败 401：`errorType=unauthorized`，**统一「用户名或密码错误」，不区分账号不存在 / 密码错误**（防账号枚举）；成功与失败均写 LoginLog
- 失败 429（sec-01/M-1 登录失败限流）：同一用户名连续失败 5 次 / 15 分钟窗口后锁定 15 分钟，锁定期内 `errorType=too_many_requests`、文案「尝试次数过多，请稍后再试」；成功登录解除失败计数
- 登录失败 LoginLog（sec-01/M-2）：`message` 一律写入「用户名或密码错误」，不再区分「账号不存在 / 账号已禁用 / 密码错误」，避免 DB 泄露账号存在性

### POST /api/v2/platform/auth/logout

- 请求：无 body（Header 携带 Token）
- 成功 200：`data = null`；服务端会话失效

### GET /api/v2/platform/auth/me

- 成功 200：`data = {"id": "...", "username": "admin", "display_name": "系统管理员", "tenant_id": "platform_admin", "last_login_at": "..."}`

### PUT /api/v2/platform/auth/password

- 请求：`{"old_password": "...", "new_password": "..."}`（当前用户自助改密）
- 成功 200：`data = null`；改密后**旧会话全部失效**
- 失败 400（新密码不合规）/ 401（旧密码错误）

## 2. 用户管理（Module_06 v2.3 §6.3）

### GET /api/v2/platform/users

- 成功 200：`data = {"items": [{"id", "username", "display_name", "status": "active|disabled", "last_login_at", "created_at"}], "total": 1}`；**任何字段不含 password_hash**

### POST /api/v2/platform/users

- 请求：`{"username": "ops01", "display_name": "运维一号", "password": "..."}`
- 成功 200/201：`data = {用户对象}`；`username` 全局唯一，冲突返回 `errorType=conflict`

### PUT /api/v2/platform/users/:id

- 请求：`{"display_name": "..."}`（`username` 不可变更，请求含该字段视为 400）

### PATCH /api/v2/platform/users/:id/status

- 请求：`{"status": "disabled"}`；禁用后该用户无法登录且**已有会话立即失效**

### PUT /api/v2/platform/users/:id/password

- 请求：`{"new_password": "..."}`（管理员重置密码）；重置后该用户旧会话失效

### GET /api/v2/platform/login-logs

- 查询参数：`username`（可选）、`success`（可选）、`page` / `page_size`（默认 20）
- 成功 200：`data = {"items": [{"id", "username", "success": true, "ip", "created_at"}], "total": N}`；按时间倒序

## 3. 租户管理 MVP 子集（Module_06 v2.3 §6.1）

### GET /api/v2/platform/tenants

- 查询参数：`status`（可选，如 `active`/`suspended`，按状态筛选）
- 成功 200：`data = {"items": [Tenant], "total": 1}`（MVP 仅 `platform_admin`）；列表信封 `{items, total}`（已从 `networkdomain` 收口统一到本接口，原 `{list, page, page_size}` 旧信封不再使用）

### GET /api/v2/platform/tenants/:id

- 成功 200：`data = {Tenant 完整字段}`

### PUT /api/v2/platform/tenants/:id

- 请求：`{"name": "...", "multi_site_enabled": false}`（仅允许编辑展示名与行政字段）
- **不开放** `POST /tenants`（新建）与 `PATCH /tenants/:id/status`（禁用）：MVP 前端无入口，后端如收到返回 `errorType=forbidden`

## 4. 横切约定

- **认证中间件**：除 `POST /api/v2/platform/auth/login` 与 `/api/v1/health*` 外，所有 `/api/*` 请求须携带 `Authorization: Bearer <token>`，否则 401 `errorType=unauthorized`；中间件**只认证、不授权**（无角色 / 权限点校验）
- **Token**：不透明随机串，服务端 `sessions` 表存储，有效期 12 小时；过期 / 登出 / 改密 / 用户被禁用即失效
- **密码**：bcrypt 哈希存储；任何接口 / 日志不返回明文或哈希
- **种子**：`admin` 由后端启动 migration upsert 幂等预置；初始密码为部署配置项（默认 `admin123`），首次登录引导改密
