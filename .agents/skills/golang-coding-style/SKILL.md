---
name: golang-coding-style
description: "MetricCenter Go 编码规范（V3）：platform/modules 分层、migration、模块自注册、错误处理、API 信封与测试要求"
---

# Golang 编码规范（V3）

本 Skill 是后端开发的编码基线。API 契约以 `api-standard` 为准，测试流程以 `testing-tdd` 为准，交付流程以 `cncf-git-workflow` 为准。

---

## 1. 通用规范

- Go 版本：以项目 `go.mod` 为准（当前 1.26.1），使用项目级工具链 `.tools/go/`。
- 遵循 Effective Go 与 Google Go Style Guide。
- 所有导出标识符必须有注释；包注释首行注明归属模块与 SRS/设计文档路径。
- 错误处理显式，不吞异常；使用 `fmt.Errorf("...: %w", err)` 包装上下文。
- 优先组合，避免过度工程；但 handler → service → repository 分层不是过度工程。
- 函数建议 < 50 行，文件 < 800 行。
- 业务代码放在 `platform/` 对应目录；禁止直接修改 `upstream/`。

---

## 2. V3 目录与分层

```text
platform/
├── cmd/metric-center/          # v3-only 主程序（main.go + v3.go）
├── cmd/migrate/                # migration 命令行
├── modules/mXX/                # 业务模块（m01/m05/m06/m07/m08/m09）
│   ├── handler/                # HTTP 适配
│   ├── service/                # 业务规则编排
│   ├── repository/             # 数据访问
│   ├── dto/                    # HTTP 请求/响应结构
│   ├── domain/                 # 领域类型/错误
│   └── module.go               # 模块自注册入口
├── foundation/                 # 跨模块基础设施
│   ├── apierror/               # 统一错误类型
│   ├── apiresponse/            # 统一响应信封
│   ├── httpapi/ httpx/         # HTTP 辅助
│   ├── module/                 # Registry 与 Module 接口
│   └── system/                 # health / ready
├── gateway/auth/               # 认证（M03 重写前的过渡适配器）
├── models/                     # 共享 GORM 模型
├── db/migrations/v3/           # PostgreSQL-only 版本化迁移
├── testutil/testdb/            # 逐测试独立 PG schema
└── edge-sync-agent/            # 边缘客户端（独立 Go module）
```

### 2.1 R1：handler 禁止直连 DB

新增 HTTP handler 必须经过 `service → repository`，禁止把 `*gorm.DB` 作为 handler 依赖：

```go
// ✅ handler 依赖 service
func NewQueryHandler(svc *service.QueryService) *QueryHandler { ... }

// ❌ 禁止
func NewQueryHandler(db *gorm.DB) *QueryHandler { ... }
```

- handler：解析请求、调用 service、返回统一响应。
- service：业务规则、事务边界、跨 repository 协作。
- repository：GORM/SQL 封装，不开启跨模块事务。
- 参考实现：`platform/modules/m09/handler/query_handler.go` 与同模块 `service/`、`repository/`。

### 2.2 R2：schema 变更必须写 migration

- 目录：`platform/db/migrations/v3/`
- 命名：`NNNNN_<描述>.postgres.sql`（如 `0024_m07_app_platform_primary_boolean.postgres.sql`）
- 格式：`-- +goose Up` / `-- +goose Down`；一次变更 = 一个 migration + 回滚说明。
- 数据库：PostgreSQL-only（生产与测试同方言）；不写 SQLite 分支。
- 禁止只改 `platform/models/` 让 `AutoMigrate` 隐式生效。
- 验证：`make test-platform`；涉及迁移生命周期时同时跑空库与基线库 Up/Down。

### 2.3 R4：模块自注册

新增模块必须实现 `platform/foundation/module.Module`：

```go
type Module interface {
    Name() string
    RegisterRoutes(platform *gin.RouterGroup) error
}
```

- 在 `platform/cmd/metric-center/v3.go` 的模块装配处注册，不在 `main.go` 里逐条挂路由。
- 模块内部自行组织 handler/service/repository；跨模块查询通过 service 接口，不直接查对方表。
- 禁止绕过 Registry 直接修改全局路由。

---

## 3. API 契约

- 路由、响应信封、字段命名、分页、枚举、鉴权、SSRF 规则见 `api-standard`。
- 所有平台响应必须通过 `platform/foundation/apiresponse` 封装。
- Go 结构体 JSON 字段必须显式写 `json:"snake_case"` 标签。
- 契约来源：SRS 第 5/6 章 + `api-contract-snapshot*` + `docs/03-engineering-standards/03_API_Standard.md`；禁止反向读取前端代码对齐字段。
- URL 解析 / 反向代理必须校验 scheme（仅 http/https）与 host，防范 SSRF。

---

## 4. 命名与错误处理

| 类型 | 规范 | 示例 |
|------|------|------|
| 包名 | 小写、简短 | `query`、`handler` |
| 结构体 | PascalCase | `QueryService` |
| 接口 | PascalCase，动词优先 | `Provider`、`Store` |
| 函数 | CamelCase | `loadConfig` |
| 错误变量 | Err 前缀 | `ErrNotFound` |

```go
if err != nil {
    return fmt.Errorf("failed to load config: %w", err)
}
```

- 不用 `panic` 处理业务错误。
- 不忽略错误返回值。
- 对外错误类型使用 `apierror` 与 `api-standard` 的 `errorType` 枚举。
- 核心写操作（配置下发、资源导入、用户/租户变更）必须有审计记录。

---

## 5. 测试

- 所有业务包必须包含 `*_test.go`。
- 使用标准 `testing` + `testify/assert` / `require`；表驱动优先。
- 数据库测试统一使用 `platform/testutil/testdb`（逐测试独立 PostgreSQL schema），不新写 SQLite/内存库。
- 外部依赖通过接口注入或 mock。
- 并发相关代码提供 `go test -race` 结果。
- TDD 循环、命令与覆盖率要求见 `testing-tdd`。

---

## 6. 禁止

- 不直接修改 `upstream/prometheus/` 源码。
- 不新增 handler 直接接收 `*gorm.DB`。
- 不新增表/字段却不写 `platform/db/migrations/v3/` migration。
- 不绕过 `foundation/module.Registry` 直接挂路由。
- 不用 `panic` 处理业务错误，不忽略错误返回值。
- 不为绕过测试问题引入复杂生产代码包装。

---

## 7. 相关 Skill

- `api-standard`：契约、信封、分页、鉴权、SSRF
- `testing-tdd`：测试矩阵、PG 测试、前端测试
- `cncf-git-workflow`：分支、commit、执行记录
- `code-review`：审查清单与严重级别
