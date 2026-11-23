# 后端架构红线（V3）

> **文档类型**：工程标准（技术规范）
> **适用范围**：`platform/` 下所有 Go 业务代码
> **状态**：生效中（V3 基线，2026-11-22 重写）
> **说明**：文件名保留历史（`07_Backend_Architecture_and_Debt_Control.md`）。自 V3 起本文只保留架构红线，不再包含技术债、还债路线图或大规模重构流程。
> **关联文档**：
> - `AGENTS.md`
> - `.agents/skills/golang-coding-style/SKILL.md`
> - `.agents/skills/code-review/SKILL.md`
> - `docs/03-engineering-standards/03_API_Standard.md`
> - `docs/03-engineering-standards/04_Testing_Standard.md`

---

## 1. 适用范围与架构基线

- 代码线：v3-only；API 以 `/api/v3/platform/*`、`/api/v3/edge/*` 为主，`/api/v1/*` 仅 Prometheus 查询代理。
- 数据库：PostgreSQL-only（生产与测试同方言），迁移在 `platform/db/migrations/v3/`。
- 入口：`platform/cmd/metric-center/`（v3-only）；模块通过 `platform/foundation/module.Registry` 注册。
- 旧 v2 业务目录已移除；`platform/gateway/auth/` 是 M03 重写前的过渡认证适配器。

---

## 2. 分层与目录

```text
platform/
├── cmd/metric-center/          # main.go + v3.go（装配与启动）
├── cmd/migrate/                # migration 命令行
├── modules/mXX/                # 业务模块
│   ├── handler/                # HTTP 适配
│   ├── service/                # 业务规则 / 事务边界
│   ├── repository/             # 数据访问
│   ├── dto/                    # HTTP 请求/响应
│   ├── domain/                 # 领域类型/错误
│   └── module.go               # 模块自注册
├── foundation/                 # 跨模块基础设施
│   ├── apierror/ apiresponse/  # 统一错误与响应
│   ├── httpapi/ httpx/         # HTTP 辅助
│   ├── module/                 # Registry 与 Module 接口
│   └── system/                 # health / ready
├── models/                     # 共享 GORM 模型
├── db/migrations/v3/           # PostgreSQL-only 迁移
└── testutil/testdb/            # 逐测试独立 PG schema
```

推荐链路：

```text
HTTP Request
    │
    ▼
Handler（解析/校验/调用 Service/返回信封）
    │
    ▼
Service（业务规则/事务/跨 Repository 协作）
    │
    ▼
Repository（GORM/SQL 封装）
    │
    ▼
PostgreSQL
```

- Handler 不直接依赖 `*gorm.DB`。
- Repository 不开启跨模块事务。
- 跨模块查询通过 Service 接口，不直接查对方表。

---

## 3. 架构红线

### R1：新增 handler 禁止直连 DB

```go
// ✅ 推荐
func NewQueryHandler(svc *service.QueryService) *QueryHandler { ... }

// ❌ 禁止
func NewQueryHandler(db *gorm.DB) *QueryHandler { ... }
```

**判定**：新增 handler 的依赖参数中不得出现 `*gorm.DB`。
**例外**：纯 bugfix 且改动 < 20 行，可在 PR/执行记录中声明豁免。

### R2：schema 变更必须写 migration

- 目录：`platform/db/migrations/v3/`
- 命名：`NNNNN_<描述>.postgres.sql`（如 `0024_m07_app_platform_primary_boolean.postgres.sql`）
- 格式：`-- +goose Up` / `-- +goose Down`
- 触发：新增表、字段、索引、删列、改列类型
- 禁止：只改 `platform/models/` 让 `AutoMigrate` 隐式生效

**数据库目标**：PostgreSQL 是唯一数据库；不写 SQLite 分支。新增 DDL 按 PostgreSQL 编写，并在 `make test-platform` 下验证。

**迁移要求**：一次变更 = 独立 commit + migration（Up/Down）+ 回滚说明 + 数据对账；破坏性变更必须有备份/回滚方案。

### R4：模块自注册

新增模块必须实现 `platform/foundation/module.Module`：

```go
type Module interface {
    Name() string
    RegisterRoutes(platform *gin.RouterGroup) error
}
```

- 在 `platform/cmd/metric-center/v3.go` 的模块装配处注册。
- 不在 `main.go` 里逐条挂业务路由。
- 模块内部自行组织 handler/service/repository。
- 禁止绕过 Registry 直接修改全局路由。

> 原 R3（禁止 `GetResourceField` / `LegacyFieldMap`）已随 V2 代码删除而退役，不再作为现行红线。

---

## 4. 新模块开工 Checklist

| # | 问题 | 通过标准 |
|---|------|---------|
| 1 | 新增几张表 / 几个字段？ | 输出 `platform/db/migrations/v3/` 文件路径 |
| 2 | 新模块如何注册？ | 实现 `foundation/module.Module` 并接入 Registry |
| 3 | 新 handler 依赖什么？ | 只依赖 Service，不依赖 `*gorm.DB` |
| 4 | 跨模块数据怎么取？ | 通过 Service 接口，不直接查对方表 |
| 5 | 契约快照是否更新？ | 跨端变更同步 `api-contract-snapshot*` |

---

## 5. Migration 规范

### 5.1 目录与命名

```text
platform/db/migrations/v3/
├── 0024_m07_app_platform_primary_boolean.postgres.sql
├── 0025_m09_xxx.postgres.sql
└── ...
```

命名：`NNNNN_<动词>_<对象>.postgres.sql`；动词建议 `create` / `add` / `drop` / `alter` / `index`。

### 5.2 执行入口

```bash
make migrate          # 执行到最新
make migrate-status   # 查看状态
make migrate-down     # 回滚一个版本（仅开发）
```

对应二进制：`platform/cmd/migrate/`。

### 5.3 评审要求

- migration 与模型变更在同一个 PR。
- PR / 执行记录写明「升级影响 / 回滚方式」。
- 禁止不可逆的数据删除，除非有备份方案。
- 数据迁移必须做计数、空值、唯一键、孤儿数据对账。

---

## 6. CI 与评审门禁

### 6.1 当前检查

`scripts/ci/check-backend-arch.sh` + `.github/workflows/check-backend-arch.yml` 对增量代码做检查：

| 规则 | 检查内容 |
|------|----------|
| R1 | 新增 `gin.HandlerFunc` 是否带 `db *gorm.DB` 参数 |
| R2 | `platform/modules/`、`platform/models/` schema 变更是否有 `platform/db/migrations/v3/` 变更 |
| R4 | 新增模块是否接入 `foundation/module.Registry`（或是否绕过 Registry 直接挂路由） |

> 脚本若暂时无法覆盖 R2/R4 的 V3 路径，按「评审优先」执行：由 reviewer 在 `code-review` 中检查，不允许保留空转检查。

### 6.2 评审关注点

- handler 是否经过 service/repository。
- schema 变更是否有 migration + 回滚 + 对账。
- 新模块是否实现 `Module` 并注册。
- API 是否使用 `/api/v3/platform/*`。
- 响应是否走 `foundation/apiresponse`。
- 是否存在直接修改 `upstream/` 而未生成 patch 的情况。

---

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-23 | 新建：固化 V2 时代的分层、migration、技术债红线 R1-R4 与还债路线图 |
| 2026-11-22 | 重写为 V3 架构红线：删除技术债/还债/大规模重构；R3 退役；R2/R4 对齐 `platform/modules` + `migrations/v3` + `foundation/module.Registry` |
