# dev-feedback：module-06-tenant-user-auth

## FB-01：Session 模型字段集为 PRD 空白（① 类，自定留痕）

- **PRD 位置**：`Module_03_Gateway_and_Auth.md` §4.0 / `Module_06_Multi_Tenant.md` §5.3
- **现状**：PRD 仅约定「Token 为不透明随机串，服务端 `sessions` 表存储，有效期 12 小时」，未定义 Session 表的具体字段。
- **自定方案**（tu-01 落地于 `platform/models/user.go`）：
  - `id string` 主键；`token string`（size:128，uniqueIndex）——不透明随机串本身即查询键，单独保留代理主键便于运维；
  - `user_id string`（index）——支撑「改密 / 禁用用户后该用户全部会话失效」的按用户批量失效；
  - `expires_at datetime`（not null, index）——签发时写入 `now + 12h`（`SessionTTL` 常量）；
  - `created_at` / `updated_at` 时间戳。
- **影响模块**：module-06（tu-01 模型层），后续 au-01（认证接口）/ tu-03（用户管理）按此字段实现。
- **发现场景**：tu-01 模型定义，PRD §5.3/§5.4 只覆盖 User / LoginLog，Session 无字段表。

## FB-02：User / LoginLog 主键类型与软删除（① 类，自定留痕）

- **PRD 位置**：`Module_06_Multi_Tenant.md` §5.3 / §5.4
- **现状**：PRD 声明 `id string`，未规定主键生成方式与软删除策略。
- **自定方案**：沿用 `Tenant` 模型风格——string 业务主键（由服务层生成 uuid）；`User` 增加 `DeletedAt *time.Time` 软删除字段（与 `Tenant` 一致），`LoginLog` 为追加型日志不带软删除。
- **影响模块**：module-06。
- **发现场景**：tu-01 模型定义。

## FB-03：admin 种子的部署配置项名称 / 展示名 / 主键 / bcrypt cost（① 类，自定留痕）

- **PRD 位置**：`Module_06_Multi_Tenant.md` §5.3「初始管理员」/ §9.2
- **现状**：PRD 仅约定「初始密码为部署配置项（默认 `admin123`）」，未规定配置项名称、admin 的 `id` / `display_name` 取值与 bcrypt cost。
- **自定方案**（tu-02 落地于 `platform/db/seed/admin.go`）：
  - 配置项走环境变量 `METRIC_CENTER_ADMIN_PASSWORD`（与 `METRIC_CENTER_DB_DSN`、`CONFIG_*` 风格一致），缺省回退 `admin123`；
  - admin 主键固定为字符串 `"admin"`（种子幂等按 `username` 查重，主键只需全局唯一）；
  - `display_name` 预置「系统管理员」，`status=active`，`tenant_id=platform_admin`（MVP 固定）；
  - bcrypt cost 取 `bcrypt.DefaultCost`（=10）。
- **影响模块**：module-06（tu-02 种子），后续 au-01（登录接口）需使用同一 `bcrypt` 校验与常量。
- **发现场景**：tu-02 种子实现。
