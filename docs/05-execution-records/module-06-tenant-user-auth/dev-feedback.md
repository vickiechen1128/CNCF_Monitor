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

## FB-04：sec-01 安全修复（H-1 / H-2 / M-1 / M-2）（② 类，审查整改留痕）

- **来源**：security-reviewer 在 sec-01 审查中发现并跟进，本档登记后端整改落地（Track B+ 强制关卡）。
- **现状**：Track B 增量原按「决策 8 无鉴权」口径交付。决策 44 后引入轻量认证，但存在：生产模式可用默认密码 `admin123`、管理接口无授权门、登录失败无限流、失败原因入库区分账号存在性四类问题。
- **整改方案**：
  - **H-1 生产模式拒绝默认管理员密码**（`platform/db/seed/admin.go`）：seed 读到 `METRIC_CENTER_ENV=production` 且未配置 `METRIC_CENTER_ADMIN_PASSWORD` 时直接报错，使主程序 `db.Init -> seed.Run` 失败终止，拒绝在生产环境携带弱默认凭据；非生产环境仍回退 `admin123`。
  - **H-2 RequireAdmin 最小授权门**（决策 44：无角色/权限点体系，仅两级）：`platform/models/user.go` 的 `User` 增 `Role` 字段（`admin`/`user` 常量）；seed 与新建用户分别定角色；新增 `platform/gateway/auth/admin_middleware.go` 的 `RequireAdmin()`，挂到 `/api/v2/platform/users*`、`/tenants*`、`/login-logs*` 管理后台组（`main.go`）；DTO 输出 `role`。
  - **M-1 登录失败进程内限流**（`platform/gateway/auth/service.go` + `ratelimit_test.go`）：同一用户名连续失败 5 次 / 15 分钟窗口 → 锁定 15 分钟，锁定期返回 429 `too_many_requests`、文案「尝试次数过多，请稍后再试」；成功登录解除失败计数。MVP 进程内单实例，跨实例一致性留待 v1.x。
  - **M-2 登录失败原因统一入库**：LoginLog 的 `message` 一律写入「用户名或密码错误」，不再区分「账号不存在 / 账号已禁用 / 密码错误」，避免 DB 泄露账号存在性（防账号枚举）。
- **影响模块**：module-06（tu-01 模型 / tu-02 种子 / tu-03 用户管理 / au-01 认证），横切 `platform/gateway/auth`、`platform/api/response`、`platform/cmd/metric-center/main.go`。
- **发现场景**：sec-01 安全 review（Track B+ 强制关卡）。

## FB-05：新增「删除用户」能力，PRD §6.3 接口表缺 DELETE 行、原型无删除交互（① 类，自定留痕 + 需 PRD 补列）

- **PRD 位置**：`Module_06_Multi_Tenant.md` §6.3 用户管理接口表 / 决策 44 文案
- **现状**：决策 44 文案提到「用户 CRUD」，但 PRD §6.3 接口表只列 GET/POST/PUT/PATCH-status/PUT-password，**未列删除接口**；原型 `UsersPage.tsx` 操作列仅「分配角色」，无删除按钮。
- **自定方案**（落地于 `platform/admin/user/`）：新增 `DELETE /api/v2/platform/users/:id`——**软删除普通用户并立即失效其全部会话**（复用 `DeletedAt` 软删除 + `DeleteSessionsByUserID`）；为防误删唯一管理入口，**admin 角色账号不提供删除**（service 层返回 400「admin 账号不可删除，请用禁用替代」）。前端操作列对「非当前、且 role=user」的行显示「删除」按钮（二次确认）。
- **影响模块**：module-06（tu-03 用户管理）。
- **待设计侧**：① PRD §6.3 补 `DELETE /api/v2/platform/users/:id` 一行；② 原型补删除交互，或在原型标注「删除为 MVP 补充、原点型未含」。
- **发现场景**：本会话按管理员诉求补齐删除能力；与 PRD 接口表 / 原型交互不一致。

## FB-06：【措辞澄清】MVP 落地的 admin/user 两级为「最小访问控制门」，非业务角色体系（① 类，请设计侧订正 PRD 措辞）

- **PRD 位置**：`Module_06_Multi_Tenant.md` §5.3（L262）「角色/权限字段不引入（v1.0+）」/ 决策 44「无角色体系」；原型 `mocks/module-06.ts` 为 4 级角色（platform_admin/tenant_admin/operator/viewer）+「分配角色」操作 + 邮箱/租户列。
- **现状**：sec-01 **H-2 强制要求**引入 `RequireAdmin` 最小授权门，因此 `User` 增 `Role`（`admin`/`user`）字段、DTO 输出 `role`、seed/新建用户定角色。这与 PRD「无角色体系」措辞直接冲突。
- **说明**：落地的是**访问控制门（两级 admin/user），不是业务角色/权限体系**；原型 4 级角色与权限分发属 v1.0+ 或外部 IAM（PRD 第 39/52 行已声明角色权限 v1.0+/外部承接），实现仍保持无业务角色体系。前端按角色仅隐藏/展示管理操作，不引入角色权限点。
- **影响模块**：module-06（tu-01 模型 / tu-02 种子 / tu-03 用户管理 / au-01 认证）。
- **待设计侧**：将 PRD 措辞由「无角色体系」订正为「无**业务**角色/权限体系，MVP 仅保留 `admin`/`user` 两级访问控制门（H-2）」，避免审查/验收读 PRD 误判实现越权（H-2 已在 FB-04 登记，本条仅要求同步 PRD 措辞）。原型 4 级角色保持为 v1.0+ 演示。
- **发现场景**：本会话确认「普通用户默认无新建/管理权限」「右上角仅展示角色Tag+用户名」时，显露 PRD 措辞与实现（H-2）的不一致。

## FB-07：【侧边栏命名统一 + 平台配置裁剪确认】「用户管理/登录日志」 vs「用户与权限/审计日志」；「平台配置」子菜单 MVP 是否裁剪（① 类，请设计侧裁断）

- **PRD 位置**：`Module_06_Multi_Tenant.md` §11.0 导航契约（侧边栏二级导航示例「用户与权限 / 审计日志 / 平台配置」）
- **现状**：
  - 命名口径不一：PRD §3.1 / §5.4 / §6.3 主体用「登录日志」与「用户管理」，而 §11.0 侧边栏示例用「用户与权限 / 审计日志」。开发侧侧边栏取前者（「租户管理 / 网域管理 / 用户管理 / 登录日志」），日志实体为 MVP 的 `LoginLog`（审计日志为 P2 另一实体，未实现）。
  - 「平台配置」：PRD §11.0 侧边栏示例含「平台配置」，开发侧当前 **无该子菜单/页面**。
- **影响模块**：module-06（侧边栏二级导航）。
- **待设计侧**：① 统一侧边栏二级导航权威命名（建议 MVP 取「用户管理」「登录日志」，审计日志 P2 不占位）；② 明确「平台配置」子菜单 MVP 是否保留——若裁剪，请在原型/PRD 标注，避免与原型侧边栏不一致被判缺功能。
- **发现场景**：本会话调整 M06 侧边栏顺序并核对 PRD/原型时发现命名口径不一与「平台配置」遗漏。
