# backend-developer 执行记录：module-06-tenant-user-auth

## tu-01 — User / Session / LoginLog 模型定义与迁移

- **commit**: `d3e1e678`（`feat(module-06): User/Session/LoginLog 模型定义与迁移（tu-01）`）
- **分支**: `feat/module-06-domain-registry`

### 输入文档

- `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` §5.3（User）/ §5.4（LoginLog）
- `docs/02-product-requirements/Modules/Module_03_Gateway_and_Auth.md` §4.0（轻量认证机制约定）
- `docs/05-execution-records/module-06-tenant-user-auth/api-contract-snapshot.md`
- `docs/05-execution-records/module-06-tenant-user-auth/task-sequence.yaml`（tu-01）

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
