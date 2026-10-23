# 后端架构与技术债控制标准

> **文档类型**：工程标准（技术规范）
> **目标读者**：技术架构师、高级后端工程师（如 ZWQ）、后端开发工程师、AI 编程助手
> **适用范围**：`platform/` 下所有 Go 业务代码
> **状态**：生效中（2026-10-23 起）
> **关联文档**：
> - `docs/05-execution-records/module-00-infrastructure/feature-debt-control.md`（执行记录 / 提案）
> - `.kimi/agents/backend-developer.md`
> - `.kimi/skills/golang-coding-style/SKILL.md`
> - `.github/workflows/check-backend-arch.yml`
> - `scripts/ci/check-backend-arch.sh`

---

## 1. 为什么需要这份标准

MetricCenter 从 MVP 快速迭代至今，后端功能持续增加，但架构约束没有同步升级。结果是：

- 功能能交付，但代码越来越难维护；
- 新 feature 不断堆进已有文件，冲突和耦合持续增加；
- 每次改动都要“全局找字段”，没人能说清某个字段到底属于哪张表、哪个模块；
- 表结构靠 `AutoMigrate` 堆叠，没有可追溯的 schema 变更历史。

这不是某一位工程师或某一个 Agent 的能力问题，而是**增量开发流程缺少架构红线**的必然结果。本标准的目标是：

1. **阻止新债继续指数增长**；
2. **给存量债一个可执行的偿还路径**；
3. **让架构师 / 高级工程师有统一的评审依据**。

---

## 2. 现状诊断（基于代码证据）

### 2.1 没有稳定分层，handler 直接操作 DB

典型代码：

```go
// platform/strategy/scrapejob/create.go
func CreateScrapeJob(db *gorm.DB) gin.HandlerFunc { ... }

// platform/alertmanager/notify/template_handler.go
func CreateTemplateHandler(db *gorm.DB) gin.HandlerFunc { ... }
```

一个 handler 同时负责：

- HTTP 请求解析；
- 业务校验；
- GORM 查询与写入；
- 响应组装。

只有 `platform/gateway/auth/` 等少数模块做到了 `repository → service → handler` 分层。这说明问题不是“不会写”，而是**没有统一要求**。

### 2.2 没有版本化 migration，表结构靠 `AutoMigrate`

`platform/db/db.go` 用一个 `AutoMigrate(...)` 列出全部模型。新增表要到这里加一行；删列只能靠手写 `DB.Exec("ALTER TABLE ...")`。

后果：

- 无法回答“某个字段是哪次需求加的”；
- 无法在测试 / 生产环境可靠地重放 schema 变更；
- 回滚困难，迁移顺序不可控。

### 2.3 “全局字段查找”把耦合扩散到业务层

`platform/models/resource_fields.go` 通过字符串映射把 PRD 字段名映射到不同表的物理列：

```go
func LegacyFieldMap(category ResourceCategory) map[string]string { ... }
func GetResourceField(res any, field string) (string, bool) { ... }
```

这本身是为了支撑多资源类型（主机 / 数据库 / 中间件 / 应用 / 通用目标 / 接口）和 Excel 导入导出，但被业务代码大量使用后，任何字段调整都会变成全局搜索。

`platform/strategy/scrapejob/selection.go` 里对 6 类资源写了 6 组几乎相同的查询分支，就是这种抽象的典型外溢。

### 2.4 新增功能必改“中央热点文件”

- `platform/cmd/metric-center/main.go`：所有 v2 路由的注册中心；
- `platform/db/db.go`：所有表的注册中心；
- `platform/models/resource_category.go`：新资源类别必须按固定顺序追加，否则 dashboard 下标错位。

模块之间没有真正的边界，新增功能天然会堆到别人已经改过的文件里。

---

## 3. 根因分析

| 根因 | 具体表现 | 对应改进 |
|------|---------|---------|
| Agent / 工程师提示词只约束目录，不约束分层 | `backend-developer.md` 只要求“模型放 models、API 放 api”，没有要求 repository/service | R1 + 本文 §4 |
| Track B 增量节奏鼓励最小改动 | micro-task 以“能通过测试”为完成标准，不做架构清理 | Feature 两步法 |
| 缺少架构审查角色 | golang-reviewer 关注代码质量，不关注模块边界与 schema 演进 | architecture-reviewer |
| MVP 阶段“避免过度工程化”被误读 | 把分层也当成过度工程 | 明确分层是必要抽象 |
| 产品抽象（多资源类型）直接泄漏到业务层 | `GetResourceField` 被 handler 大量调用 | R3 + 类型化 Resource 方法 |
| 没有 migration 工具链 | 只能靠 AutoMigrate | R2 + `platform/db/migrations/` |

**结论：不是 Agent 能力不够，而是任务目标函数和评审机制没有对齐长期可维护性。**

---

## 4. 目标架构

### 4.1 分层模型

```
HTTP Request
    │
    ▼
┌─────────────┐
│   Handler   │  解析请求 / 参数校验 / 调用 Service / 返回统一响应
└─────────────┘
    │
    ▼
┌─────────────┐
│   Service   │  业务规则编排 / 事务边界 / 跨 Repository 协作
└─────────────┘
    │
    ▼
┌─────────────┐
│ Repository  │  GORM / SQL 封装 / 查询条件构造
└─────────────┘
    │
    ▼
        DB
```

**参考实现**：`platform/gateway/auth/`

- `repository.go`：只做数据访问；
- `service.go`：业务规则与限流；
- `handler.go`：HTTP 适配。

### 4.2 模块边界

每个模块应具备：

- 自己的 `Module` / `RegisterRoutes` 入口；
- 只暴露必要的 service 接口给其他模块；
- 禁止其他模块直接访问本模块的 GORM 模型或 repository。

推荐结构：

```
platform/<module>/<feature>/
├── handler.go
├── service.go
├── repository.go
├── module.go          # 可选：模块自注册入口
└── *_test.go
```

### 4.3 数据访问原则

- 新增业务逻辑不得直接依赖全局 `db *gorm.DB`；
- 复杂查询放在 repository，handler 不拼 SQL；
- 跨模块查询通过 service 接口，不直接查对方表；
- 事务边界放在 service 层，repository 不开启跨模块事务。

---

## 5. 四条红线（R1-R4）

> 本节是强制规范。新增代码必须遵守；存量代码按 Boy Scout Rule 渐进清理。

### R1：新增 handler 禁止直连 DB

```go
// ❌ 禁止
func CreateXxx(db *gorm.DB) gin.HandlerFunc { ... }

// ✅ 推荐
func CreateXxx(svc *XxxService) gin.HandlerFunc { ... }
```

**判定标准**：新增 handler 函数的依赖参数中不得出现 `*gorm.DB`。  
**例外**：纯 bugfix 且改动 < 20 行，可在 PR 描述中声明豁免。

### R2：新增表 / 字段必须写 migration

- 目录：`platform/db/migrations/`
- 工具：`pressly/goose`（优先）或 `go-gormigrate/gormigrate`
- 触发条件：新增表、字段、索引、删列、改列类型
- 禁止：只改 `platform/db/db.go` 的 `AutoMigrate` 列表

**存量策略**：已存在的表继续由 `AutoMigrate` 维护，作为基线；新 schema 变更一律走 migration。

### R3：禁止新增字符串字段映射调用

- `models.GetResourceField` / `models.LegacyFieldMap` 只允许在 `platform/models/resource_fields.go`、Excel 导入导出、模板渲染中使用；
- 业务 handler / service 必须使用类型化方法：

```go
// ✅
appCode := res.GetAppCode()

// ❌
val, _ := models.GetResourceField(res, "app_code")
```

### R4：禁止直接修改中央注册文件

新增模块不得直接修改：

- `platform/cmd/metric-center/main.go` 的路由注册；
- `platform/db/db.go` 的 `AutoMigrate` 列表。

必须提供模块自注册入口，由 `main.go` 统一遍历。

**过渡期说明**：在模块自注册机制落地前，R4 的检查只针对“新增注册条目”。如果为了接入 migration runner 必须修改 `db.go`，需在 PR 描述中说明。

---

## 6. Feature 开发流程（两步法）

```
Feature TXX
├── Sub-task 1：清理战场（约 20%）
│   ├── 把本次会触碰的 handler 抽出 service/repository
│   ├── 为本次 schema 变更准备 migration
│   └── 定义跨模块接口（如需要）
└── Sub-task 2：实现功能（约 80%）
    ├── 在 service 上写业务逻辑
    ├── 补单元测试
    └── 补接口验证
```

### 开工前 5 个 Checklist

| # | 问题 | 通过标准 |
|---|------|---------|
| 1 | 新增几张表 / 几个字段？ | 输出 migration 文件路径 |
| 2 | 会改 `main.go` / `db.go` 吗？ | 如果会，先做模块自注册改造 |
| 3 | 会用到 `GetResourceField` / `LegacyFieldMap` 吗？ | 如果会，改为类型化方法 |
| 4 | 新 handler 是否经过 service？ | 画出 `请求 → handler → service → repository → DB` 链路 |
| 5 | 会触碰哪些热点文件？ | 列出并说明能否缩小修改范围 |

这 5 个问题建议写入 `docs/05-execution-records/module-XX/task-sequence.yaml` 的 task 描述，或单独的 `arch-check.md`。

---

## 7. Migration 规范

### 7.1 目录与命名

```
platform/db/migrations/
├── 20261023000000_create_scrape_job_versions.sql
├── 20261023120000_add_retention_to_storage_logs.sql
└── ...
```

命名格式：`YYYYMMDDHHMMSS_<动词>_<对象>.sql`  
动词建议：`create` / `add` / `drop` / `alter` / `index`。

> 当前目录已创建为空目录（`.gitkeep` 占位），工具链接入后直接在其中新增文件。

### 7.2 执行入口

建议在 `Makefile` 增加：

```bash
make migrate          # 执行到最新版本
make migrate-status   # 查看当前版本
make migrate-down     # 回滚一个版本（仅开发环境）
```

并在 `setup.sh` 初始化时执行 `make migrate`。

### 7.3 评审要求

- migration 文件必须与模型变更在同一个 PR；
- PR 描述中必须写明“升级影响 / 回滚方式”；
- 禁止在 migration 中做不可逆的数据删除，除非有备份方案。

---

## 8. 自动化门禁

### 8.1 已落地

`.github/workflows/check-backend-arch.yml` 调用 `scripts/ci/check-backend-arch.sh`，对增量代码做 R1-R4 检查：

| 规则 | 检查内容 |
|------|---------|
| R1 | 新增 `gin.HandlerFunc` 是否带 `db *gorm.DB` 参数 |
| R2 | `platform/models/` 新增 struct / `gorm:"` 字段时，是否有 `platform/db/migrations/` 变更 |
| R3 | 是否在 `resource_fields.go` 之外新增 `GetResourceField` / `LegacyFieldMap` 调用 |
| R4 | `main.go` 是否新增 `RegisterRoutes`，`db.go` 是否新增 `AutoMigrate` |

### 8.2 后续可加

- **跨模块依赖检查**：禁止 `platform/strategy/*` 直接导入 `platform/config/*` 的内部实现；
- **文件 / 函数行数检查**：存量豁免，新增超限文件告警；
- **architecture-reviewer**：涉及 `platform/models/`、`platform/db/`、`main.go` 的 PR 必须人工架构审查。

---

## 9. 还债路线图

### 阶段 0：止血（当前）

- [x] 制定 R1-R4；
- [x] 更新 `backend-developer.md` / `golang-coding-style`；
- [x] 新增 `scripts/ci/check-backend-arch.sh` 与 CI workflow；
- [x] 创建 `platform/db/migrations/` 目录。

### 阶段 1：试点（1-2 个迭代）

- 选 1 个模块做 repository/service 分层试点（建议 `platform/strategy/scrapejob/` 或 `platform/config/resource/`）；
- 把 `selection.go` 的 6 类资源分支收敛为 `ResourceCandidateStore` 接口 + 各类型实现；
- 产出可复制的模板，写入本文档。

### 阶段 2：推广（1-2 个月）

- 新 feature 全部按 R1-R4 执行；
- 热点模块逐步迁移；
- 引入 migration 工具链并跑通第一个 migration。

### 阶段 3：常态化（长期）

- 每 2-3 个模块安排一次“架构还债 sprint”；
- 用指标跟踪债务趋势（见 §10）；
- architecture-reviewer 成为常规评审角色。

---

## 10. 度量指标

建议每季度统计一次，作为架构健康度参考：

| 指标 | 目标 |
|------|------|
| 新增 handler 直连 DB 数量 | 0 |
| 新增 schema 变更未配 migration 数量 | 0 |
| 新增 `GetResourceField` / `LegacyFieldMap` 调用 | 0 |
| `platform/cmd/metric-center/main.go` 行数 | 不再增长（目标 < 400 行） |
| `platform/db/db.go` 行数 | 不再增长（目标 < 150 行） |
| 单文件 > 800 行 / 单函数 > 50 行 | 存量逐步下降 |

---

## 11. 角色与职责

| 角色 | 职责 |
|------|------|
| **技术架构师** | 审批 R1-R4 变更；每季度审视架构健康度；决定 migration 工具链 |
| **高级后端工程师（ZWQ）** | 主导试点重构；评审跨模块 PR；维护本文档与 `feature-debt-control.md` |
| **backend-developer（人 / Agent）** | 新代码遵守 R1-R4；按 Feature 两步法拆分任务；主动报告热点文件 |
| **golang-reviewer** | 检查 R1-R4 增量合规性；发现架构异味时升级给架构师 |
| **planner** | L3 任务中标注 schema 变更、跨模块接口、migration 文件 |

---

## 12. 常见问题

### Q1：这是不是说明 backend-developer Agent 能力不行？

不是。Agent 能写出可运行、可测试的代码；问题在于提示词和评审机制没有要求它做架构分层。换成人工程师在同样约束下也会做出类似选择。

### Q2：是不是应该全部改用 OpenCode Coder 模式？

不建议一刀切。Coder 模式适合：

- 大规模重构（跨 10+ 文件的模块拆分）；
- 架构设计提案；
- 还债 sprint。

日常增量 feature 仍建议用 Agent 模式 + R1-R4 门禁。**模式不是解药，规则和审查才是。**

### Q3：存量代码怎么办？

不强制一次性重写。原则是“增量合规，存量渐进”：

- 新代码必须遵守 R1-R4；
- 每次 feature 触碰到的旧代码，按 Boy Scout Rule 做最小清理；
- 每 2-3 个模块安排一次还债 sprint。

### Q4：R1 会不会导致过度设计？

不会。R1 只要求 handler 依赖 service，不要求 DDD 全套分层。`repository → service → handler` 是最小可维护结构，`platform/gateway/auth/` 已经证明其成本可控。

### Q5：migration 工具还没接入，R2 怎么执行？

- 目录已创建：`platform/db/migrations/`；
- 当前阶段可以先手写 SQL 文件并人工执行；
- 下个迭代接入 goose / gormigrate 后改为自动执行；
- CI 只检查“是否有 migration 文件”，不检查工具是否已接入。

---

## 13. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-10-23 | 新建本文档；固化现状诊断、R1-R4、Feature 两步法、migration 规范、CI 门禁与还债路线图 |
