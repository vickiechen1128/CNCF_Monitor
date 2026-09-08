# backend-developer 执行记录：module-06 Track B 增量（决策 44：轻量认证 + 租户/用户管理）

## tu-01 — User / Session / LoginLog 模型定义与迁移

- **commit**: `d3e1e678`（`feat(module-06): User/Session/LoginLog 模型定义与迁移（tu-01）`）
- **分支**: `feat/module-06-domain-registry`

### 输入文档

- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` §5.3（User）/ §5.4（LoginLog）
- `docs/02-product-requirements/Modules/Module_03_Gateway_and_Auth.md` §4.0（轻量认证机制约定）
- `docs/05-execution-records/module-06/track-b-increment-decision-44/api-contract-snapshot.md`
- `docs/05-execution-records/module-06/track-b-increment-decision-44/task-sequence.yaml`（tu-01）

### 新增 / 修改文件

- 新增 `platform/models/user.go`：`User` / `Session` / `LoginLog` 三个模型 + `UserStatus` 枚举 + `SessionTTL = 12h` 常量
- 新增 `platform/models/user_test.go`：6 个模型契约测试
- 修改 `platform/db/db.go`：AutoMigrate 清单加入 `User` / `Session` / `LoginLog`
- 修改 `platform/db/db_test.go`：新增 `TestAuthTablesMigrated`（建表 + 唯一约束 + 回读）
- 修改 `docs/04-source-architecture/repo-map.md`：`make repo-map` 重新生成（新鲜度门禁要求）

### 关键实现说明

- 字段与 PRD §5.3/§5.4 逐字段对齐：`User`（id / tenant_id / username / password_hash / display_name / status / last_login_at / created_at / updated_at），`LoginLog`（id / username / success / ip / message / created_at）。
- `PasswordHash` 使用 `json:"-"`，任何接口 / 日志不输出哈希（验收标准）。
- `Session` 为不透明 Token 服务端会话模型：`token`（uniqueIndex）+ `user_id` + `expires_at`；`SessionTTL = 12 * time.Hour` 表达 12h 过期语义（Module_03 §4.0）。
- 主键风格与 `Tenant` 一致：string 业务主键（PRD §5.3/§5.4 均声明 `id string`），未使用 `BaseModel` 的 uint 自增主键；`User` 沿用 `Tenant` 的 `*time.Time` 软删除字段。
- `username` 加 `uniqueIndex`（PRD：全局唯一）；`LoginLog.username` / `created_at`、`Session.user_id` / `expires_at` 加普通索引支撑 tu-03 查询。
- 模型层未引入 bcrypt 依赖（`golang.org/x/crypto` 留给 tu-02/au-01）。

### TDD 过程

- RED：先写 `user_test.go` + `TestAuthTablesMigrated`，`go test` 编译失败（undefined: User / Session / LoginLog / SessionTTL），确认 RED。
- GREEN：实现 `user.go` + 迁移清单后全部通过。

### 测试用例清单（7 例）

| 用例 | 位置 | 覆盖 |
|------|------|------|
| TestUserTableNames | models | 三表表名 users / sessions / login_logs |
| TestUserJSONDoesNotExposePasswordHash | models | password_hash 不出现在 JSON 输出 |
| TestUserStatusConstants | models | active / disabled 枚举值 |
| TestSessionTTLSemantic | models | SessionTTL == 12h |
| TestSessionJSONContract | models | token / user_id / expires_at JSON 契约 |
| TestLoginLogJSONContract | models | username / success / ip / message JSON 契约 |
| TestAuthTablesMigrated | db | AutoMigrate 建三表 + username 唯一约束 + 回读 |

### 验证结果

- `go test ./platform/models/... ./platform/db/...`：全部通过（models / db / db/seed ok）
- `go test ./platform/...`：全量通过
- `go vet ./platform/...`：无输出（通过）
- `make check-repo-map`：OK
- 服务启动验证：编译启动 `platform/cmd/metric-center`，`curl /api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均返回 200；验证后已停止进程释放 8080 端口

### 遗留风险与下一步

- bcrypt 依赖尚未入 `go.mod`，由 tu-02（admin 种子 upsert）/ au-01（登录接口）按需引入。
- `Session` 失效联动（登出 / 改密 / 用户禁用即失效）需在 au-01 / tu-03 服务层实现，模型层仅提供 `expires_at` 与索引。
- PRD 空白决策（Session 字段集等）已记录至 `dev-feedback.md`。

## tu-02 — 初始管理员 admin 种子 upsert

- **commit**: `7ce19629`（`feat(module-06): 初始管理员 admin 种子 upsert（tu-02）`）
- **分支**: `feat/module-06-domain-registry`

### 输入文档

- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` §5.3（初始管理员）/ §9.2（技术验收）
- `docs/05-execution-records/module-06/track-b-increment-decision-44/task-sequence.yaml`（tu-02）
- `platform/models/user.go`（tu-01 产物）、`platform/models/tenant.go`（PlatformAdminTenantID）
- `platform/db/seed/seed.go` / `ten_domain.go`（既有种子机制与幂等原语）

### 新增 / 修改文件

- 新增 `platform/db/seed/admin.go`：`runAdminUser` 种子函数 + `AdminUserID` / `AdminUsername` / `AdminPasswordEnv` / `DefaultAdminPassword` 常量
- 新增 `platform/db/seed/admin_test.go`：4 个测试用例
- 修改 `platform/db/seed/seed.go`：`Run` 末尾挂接 `runAdminUser`；包注释补充 admin 种子说明
- 修改 `platform/db/seed/seed_test.go`：`newTestDB` AutoMigrate 清单补 `models.User`
- 修改 `platform/cmd/metric-center/main_test.go`：集成测试 AutoMigrate 清单补 `models.User`（seed.Run 新增 users 表依赖，否则 e2e 报 `no such table: users`）
- 修改 `go.mod`：`golang.org/x/crypto v0.53.0` 由间接依赖提为直接依赖（本机离线，`go mod tidy` 不可用，手工移动 require 块；go.sum 原有条目无需变更）
- 修改 `docs/04-source-architecture/repo-map.md`：`make repo-map` 重新生成

### 关键实现说明

- **幂等语义（upsert：存在即跳过）**：先按 `username='admin'` 查询，已存在直接返回 nil——不触碰 `password_hash`，改密后重启不被重置；不存在才 bcrypt 哈希并插入。
- **初始密码取部署配置**：环境变量 `METRIC_CENTER_ADMIN_PASSWORD`（风格与 `METRIC_CENTER_DB_DSN` / `CONFIG_*` 一致），未配置回退默认 `admin123`；bcrypt cost 取 `bcrypt.DefaultCost`（=10）。
- **挂接点零改 main.go**：`db.Init` 已调用 `seed.Run`，admin 种子挂在 `Run` 尾部即随启动执行，main.go 无需任何改动（满足「main.go 改动最小」）。
- bcrypt 仅在创建路径计算，避免每次启动白付哈希开销。

### TDD 过程

- RED：先写 `admin_test.go` 4 例并补测试基建（newTestDB 迁移 users 表），`go test` 编译失败（undefined: DefaultAdminPassword / AdminPasswordEnv），确认 RED。
- GREEN：实现 `admin.go` + 挂接 `Run` 后 seed 包全部通过；修复 main_test.go 迁移清单后全量通过。

### 测试用例清单（4 例）

| 用例 | 覆盖 |
|------|------|
| TestRunSeedsAdminUser | 默认密码播种：tenant=platform_admin / status=active / bcrypt 校验 admin123 通过、不落明文 |
| TestRunAdminIsIdempotent | 重复 Run 不重复插行（users 表恒 1 行） |
| TestRunAdminKeepsModifiedPassword | 改密后再次 Run 不重置 password_hash |
| TestRunAdminPasswordFromEnv | `METRIC_CENTER_ADMIN_PASSWORD` 覆盖初始密码 |

### 验证结果

- `go test ./platform/db/...`：通过（db / db/seed ok）
- `go test ./platform/...`：全量通过（含 cmd/metric-center e2e）
- `go vet ./platform/...`：通过
- `make check-repo-map`：OK
- 服务启动验证（注：8080 被历史遗留进程 PID 61906 占用，验证改用 :18080 + 独立临时 DSN）：
  - 首次启动：`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；sqlite3 确认 admin 行（bcrypt `$2a$10$` 哈希）
  - 改密后第二次启动：三接口仍 200，启动无报错，admin 恒 1 行且哈希保留被改值（幂等 + 不重置验证通过）
  - `METRIC_CENTER_ADMIN_PASSWORD=mysecret` 第三次启动（全新库）：正常播种 bcrypt 哈希
  - 验证后已停止进程、释放 18080、清理临时 DB/二进制；仓库根 `metric_center.db` 中验证残留的 admin 行已删除（下次启动由 seed 以默认密码重建）

### 遗留风险与下一步

- bcrypt cost = `bcrypt.DefaultCost`（10）：MVP 单机可接受；若 au-01 压测登录延迟敏感可提可调配置。
- `METRIC_CENTER_ADMIN_PASSWORD` 为环境变量形态，暂无配置文件加载机制；au-01 登录实现需复用同一常量（`seed.AdminPasswordEnv` 仅种子用，登录校验走 `bcrypt.CompareHashAndPassword`）。
- admin 主键固定 `"admin"`、display_name「系统管理员」为 PRD 空白自定项，已记 dev-feedback.md FB-03。
- 遗留进程：8080 端口被非本次启动的 metric-center 旧进程（PID 61906）占用，未擅自 kill，后续任务做启动验证时注意换端口或先确认归属。

## tu-03 — 用户管理 + 登录日志 API

- **状态**: done（工作区既有实现，orchestrator 复核通过；尚未 commit）
- **分支**: `feat/module-06-domain-registry`

### 输入文档

- `docs/05-execution-records/module-06/track-b-increment-decision-44/api-contract-snapshot.md` §2（用户管理 / 登录日志契约）
- `docs/03-engineering-standards/03_API_Standard.md`（统一响应信封 / errorType 枚举 / 分页 §7.2）
- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` §6.3

### 新增 / 修改文件

- 新增 `platform/admin/user/handler.go`：路由注册 + HTTP handler + DTO 序列化（不含 password_hash / tenant_id）
- 新增 `platform/admin/user/service.go`：业务规则（username 唯一、bcrypt、禁用/重置密码使会话失效）
- 新增 `platform/admin/user/repository.go`：users / sessions / login_logs 持久化
- 新增 `platform/admin/user/handler_test.go`：14 个测试用例
- 修改 `platform/cmd/metric-center/main.go`：`user.RegisterRoutes(platform, db.DB)` 挂接（tu-03 路由与现网其它管理接口一致暂不鉴权，认证中间件由 au-02 统一挂载）

### 关键实现说明（对照验收点）

- **users CRUD / status / password 与 login-logs 查询**：`GET/POST /users`、`PUT /users/:id`、`PATCH /users/:id/status`、`PUT /users/:id/password`、`GET /login-logs` 齐全。
- **username 唯一且创建后不可变**：DB 唯一索引 + 服务层 `ExistsByUsername` / 唯一约束兜底（409 conflict）；`updateUserRequest.Username` 用指针区分「未出现/出现」，handler 收到即 400。
- **禁用用户会话立即失效**：`UpdateStatus(disabled)` 与 `ResetPassword` 均调用 `DeleteSessionsByUserID` 物理删除该用户全部 sessions（au-01 复用同一语义）。
- **响应不含 password_hash**：DTO 白名单字段集，任何接口不输出 `password_hash`、`tenant_id`。
- **密码规则（PRD 空白自定）**：最小 8 位、最大 72 字节（bcrypt 上限），已记 dev-feedback。
- **登录日志按时间倒序 + username/success 筛选 + 分页**：`ListLoginLogs` 精确匹配 + `created_at desc`；分页 page 从 1、默认 20、上限 100（API 标准 §7.2）。

### 测试用例清单（14 例，超预估 12）

- CreateUser：成功 / 响应不泄露 password_hash / 重复 username(conflict) / 校验失败
- ListUsers：分页与字段集
- UpdateUser：display_name / username 不可变(400) / not_found
- UpdateUserStatus：禁用使会话失效 / 非法值 / not_found
- ResetPassword：更新哈希并使会话失效 / 校验与 not_found
- ListLoginLogs：筛选 + 排序 + 分页

### 验证结果

- `go build ./platform/admin/user/...`：OK
- `go vet ./platform/admin/user/...`：OK
- `go test ./platform/admin/user/... -count=1`：ok（14 例）
- 注：tu-03 属 sec-01 审查输入（`platform/admin/user/`），随登录链路一起过安全审查后再提交（commit_group: user-admin-api）。

### 下一步

- tu-04（租户管理 MVP 子集）与 au-01（登录认证）可并行/续作推进；au-01 登录校验复用 `bcrypt.CompareHashAndPassword` 与 `models.Session` 失效语义。
