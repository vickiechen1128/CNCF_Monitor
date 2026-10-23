# Feature 开发技术债控制规范

> **状态**：approved（2026-10-23）
> **长期规范**：本文为执行记录 / 初始提案；面向架构师与高级工程师的长期版本已沉淀到
> `docs/03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md`，后续以该标准为准。
> **范围**：MetricCenter 后端（`platform/`）Feature 开发流程
> **关联文档**：
> - `.kimi/agents/backend-developer.md`
> - `.kimi/skills/golang-coding-style/SKILL.md`
> - `docs/03-engineering-standards/03_API_Standard.md`
> - `docs/03-engineering-standards/04_Testing_Standard.md`

---

## 1. 背景

随着模块增多，后端出现以下典型技术债：

- handler 直接接收 `*gorm.DB`，业务逻辑与数据库访问、HTTP 层混在一起；
- 新表/新字段只通过 `platform/db/db.go` 的 `AutoMigrate` 注册，没有版本化 migration；
- 业务代码大量使用 `platform/models/resource_fields.go` 的字符串字段映射（`LegacyFieldMap` / `GetResourceField`）；
- 每新增一个模块都要改 `platform/cmd/metric-center/main.go` 和 `platform/db/db.go` 这两个中央文件，冲突和耦合持续增加。

这些债务并非某个 Agent 或工程师“能力不够”，而是**增量开发模式下缺少明确的架构红线**。本规范的目标是在不暂停业务的前提下，**阻止新债指数增长，并逐步偿还旧债**。

---

## 2. 核心原则

**增量合规，存量渐进。**

- 所有**新增代码**必须遵守本规范；
- 存量代码在 feature 开发时按“Boy Scout Rule”逐步清理，但不强制一次性重写。

---

## 3. 四条红线规则（R1-R4）

### R1：新增 handler 禁止直连 DB

新增 HTTP handler 不得把 `*gorm.DB` 作为依赖注入对象，必须依赖 `Service`（或 `Usecase`），由 Service 再依赖 `Repository`。

**推荐结构**：

```
platform/<module>/<feature>/
├── handler.go      # gin.HandlerFunc，只负责解析请求/调用 service/返回响应
├── service.go      # 业务规则编排
├── repository.go   # GORM / SQL 访问封装
└── *_test.go
```

**错误示例**：

```go
// ❌ 禁止
func CreateScrapeJob(db *gorm.DB) gin.HandlerFunc { ... }
```

**正确示例**（参考 `platform/gateway/auth/`）：

```go
// ✅ handler 依赖 service
func CreateScrapeJob(svc *ScrapeJobService) gin.HandlerFunc {
    return func(c *gin.Context) { ... }
}
```

### R2：新增表/字段必须写 migration

新增 GORM 模型或字段时，禁止只修改 `platform/db/db.go` 的 `AutoMigrate` 列表。必须同步提供版本化 migration。

**工具选型**：`pressly/goose`（优先）或 `go-gormigrate/gormigrate`。

**路径约定**：

```
platform/db/migrations/
├── 20261023000000_create_scrape_job_versions.sql
└── 20261023120000_add_retention_to_storage_logs.sql
```

**执行入口**：`Makefile` 新增 `make migrate` / `make migrate-status`，`setup.sh` 初始化时自动运行到最新版本。

**存量策略**：

- 已存在的表继续由 `AutoMigrate` 维护，作为“基线”；
- 从本规范生效之日起，所有**新增表/新增字段/删列/加索引**都必须走 migration。

### R3：禁止新增字符串字段映射调用

`platform/models/resource_fields.go` 的 `LegacyFieldMap` / `GetResourceField` 仅允许用于 **Excel 导入导出、模板渲染** 等真正需要动态字段名的场景。

**业务 handler / service 禁止调用**。业务逻辑应使用类型化的 `Resource` 方法或各自模块的 service 方法。

**错误示例**：

```go
// ❌ 禁止在业务逻辑里用字符串字段名反射取值
val, ok := models.GetResourceField(res, "app_code")
```

**正确示例**：

```go
// ✅ 调用类型化方法
appCode := res.GetAppCode()
```

### R4：禁止直接修改中央路由/表注册

新增模块不得直接修改：

- `platform/cmd/metric-center/main.go` 中的路由注册；
- `platform/db/db.go` 中的 `AutoMigrate` 列表。

**模块必须自注册**。每个模块提供一个 `Module` 类型（或 `Register*` 函数），由 `main.go` 统一遍历注册。

**示例**：

```go
// platform/config/resource/module.go
type Module struct {
    Repo *Repository
}

func (m *Module) RegisterRoutes(g *gin.RouterGroup) {
    g.GET("/resources", m.ListResources())
    ...
}
```

```go
// platform/cmd/metric-center/main.go
modules := []platform.Module{
    networkdomain.NewModule(deps),
    resource.NewModule(deps),
    ...
}
for _, m := range modules {
    if err := m.RegisterRoutes(platformGroup); err != nil { ... }
}
```

---

## 4. Feature 开发两步法

每个后端 feature 必须拆成两个 sub-task：

### Sub-task 1：清理战场（约占 20% 时间）

在写新功能前，先对本次会触碰的存量代码做最小必要清理：

- 若新增 handler，先把同模块邻近的 1-2 个旧 handler 抽象出 service/repository（可选，但至少新增代码本身必须分层）；
- 若新增表/字段，先确认 migration 目录和工具链可用；
- 若需要跨模块查询，先定义接口（anti-corruption layer），禁止直接访问其他模块的内部 DB 模型。

### Sub-task 2：实现功能（约占 80% 时间）

在清理后的结构上实现需求，并补测试。

---

## 5. Feature 开工前架构 Checklist

backend-developer 在写第一行代码前，必须在执行记录或 task-sequence 中回答以下 5 个问题：

| # | 问题 | 通过标准 |
|---|------|---------|
| 1 | 这次要新增几张表/几个字段？ | 输出 migration 文件路径；R2 |
| 2 | 会改 `main.go` 或 `db.go` 的中央注册吗？ | 如果会，必须先做模块自注册改造；R4 |
| 3 | 会用到 `GetResourceField` / `LegacyFieldMap` 吗？ | 如果会，必须改为类型化方法；R3 |
| 4 | 新增 handler 是否经过 service？ | 必须画出 `请求 → handler → service → repository → DB` 链路；R1 |
| 5 | 本次会触碰哪些热点文件？ | 列出并说明能否通过更小范围修改避免 |

---

## 6. 与现有 Agent 流程的衔接

### planner

- L3 `task-sequence.yaml` 中，任何涉及 schema 变更的 task 必须包含 `migration_files` 字段；
- 涉及跨模块调用的 task 必须输出 `interfaces` 字段（即 anti-corruption 接口定义路径）。

### backend-developer

- 必须将 R1-R4 视为比“函数 < 50 行”更强的约束；
- 当 R1-R4 与“避免过度工程化”冲突时，优先执行 R1-R4；
- “避免过度工程化”的解释修订为：**不要为了测试而引入不必要的生产抽象**，但 `repository` / `service` 分层是必要抽象，不属于过度工程。

### golang-reviewer / 新增 architecture-reviewer

- golang-reviewer 在审查 diff 时，必须检查 R1-R4 增量合规性；
- 建议引入 `architecture-reviewer` 角色，专门审查涉及 `platform/models/`、`platform/db/db.go`、`platform/cmd/metric-center/main.go`、跨模块调用的 PR。

---

## 7. 推荐落地顺序

1. **第 1 周**：更新 `backend-developer.md`、`golang-coding-style/SKILL.md`；新增本规范文件。
2. **第 2 周**：引入 migration 工具链（goose），并写第一个示例 migration；`Makefile` / `setup.sh` 增加 `migrate` 命令。
3. **第 3-4 周**：选一个中等复杂度的模块（如 `scrapejob` 或 `configcenter/draft`）做 repository/service 分层试点。
4. **第 5 周起**：新增 `.github/workflows/check-backend-arch.yml`（调用 `scripts/ci/check-backend-arch.sh`），对增量代码做 R1-R4 自动化检查。

---

## 8. 例外与豁免

- 纯 bugfix 且改动小于 20 行的 PR，可豁免 R1（但鼓励顺手提取 service）；
- 紧急线上 hotfix 可先堆代码，事后 1 周内补 migration 和分层；
- 任何豁免必须在 PR 描述中声明，并在合并后创建 follow-up task。
