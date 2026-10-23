---
name: golang-coding-style
description: "MetricCenter Go 编码规范：代码组织、分层 R1、migration R2、字段访问 R3、模块自注册 R4、错误处理与测试要求"
---

# Golang 编码规范

本 Skill 是后端开发的编码基线。API 契约以 `api-standard` 为准，测试流程以 `testing-tdd` 为准。

---

## 1. 通用规范

- Go 版本：以项目 `go.mod` 为准（当前 1.26.1），使用项目级工具链 `.tools/go/`。
- 遵循 Effective Go 与 Google Go Style Guide。
- 所有导出标识符必须有注释；包注释首行注明归属模块与 PRD 路径。
- 错误处理显式，不吞异常；使用 `fmt.Errorf("...: %w", err)` 包装上下文。
- 优先组合，避免过度工程；但 handler → service → repository 分层不是过度工程。
- 函数建议 < 50 行，文件 < 800 行。
- 业务代码放在 `platform/` 对应目录；禁止直接修改 `upstream/`。

---

## 2. 包结构与代码组织

```go
// Package networkdomain implements Module_06 网域登记管理。
// 参见 docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md
package networkdomain

import (
    // 标准库
    "context"
    "fmt"

    // 第三方库
    "github.com/gin-gonic/gin"

    // 本项目
    "github.com/your-org/metriccenter/platform/models"
)
```

### 2.1 分层（R1 架构分层义务）

新增 HTTP handler 必须经过 `service → repository` 两层，禁止直接依赖 `*gorm.DB`：

- **handler**：解析请求、调用 service、返回响应；
- **service**：业务规则编排；
- **repository**：数据库访问封装。

```go
// ✅ 推荐
func CreateXxx(svc *XxxService) gin.HandlerFunc {
    return func(c *gin.Context) { ... }
}

// ❌ 禁止
func CreateXxx(db *gorm.DB) gin.HandlerFunc { ... }
```

参考示例：`platform/gateway/auth/`（`repository.go` / `service.go` / `handler.go`）。

存量代码在本次 feature 触碰范围内按 Boy Scout Rule 逐步清理；不得借机大重构。

### 2.2 目录归属

| 内容 | 目录 |
|------|------|
| 数据库模型 | `platform/models/` |
| API 定义 / 响应 | `platform/api/` |
| 配置 | `platform/config/` |
| Gateway / 认证 | `platform/gateway/` |
| 模块业务包 | `platform/<module>/` |

---

## 3. 技术债四条红线（R1–R4）

新增代码必须遵守 `docs/05-execution-records/module-00-infrastructure/feature-debt-control.md`：

- **R1 架构分层义务**：新增 HTTP handler 禁止直接依赖 `*gorm.DB`，必须经过 `service → repository`；存量在触碰范围内逐步清理。
- **R2 数据 schema 变更义务**：新增表、字段、索引或删列，必须写 `platform/db/migrations/` 版本化 migration；禁止只修改 `platform/db/db.go` 的 `AutoMigrate` 列表。
- **R3 字段访问义务**：禁止在业务逻辑中新增 `models.GetResourceField` / `models.LegacyFieldMap` 调用；仅 Excel / 模板渲染等真正需要动态字段名的场景可用。
- **R4 模块自注册义务**：新增模块不得直接修改 `platform/cmd/metric-center/main.go` 路由注册或 `platform/db/db.go` 的 `AutoMigrate` 列表；必须提供模块自注册入口，由 `main.go` 统一遍历。

### 3.1 Feature 两步法

每个后端 feature 拆成：

1. **清理战场（约 20%）**：在触碰范围内补齐分层、migration、字段访问、自注册；
2. **实现功能（约 80%）**：按契约与测试实现。

开工前回答 5 个架构 checklist（详见 `feature-debt-control.md` §5）。

### 3.2 Migration

- 工具：`pressly/goose` 或 `go-gormigrate/gormigrate`（团队统一后固定一种）。
- 文件放在 `platform/db/migrations/`，按版本命名。
- migration 必须可向前执行；破坏性变更需提供回滚说明。
- 禁止只通过 `AutoMigrate` 注册新 schema。

### 3.3 技术债修复 vs 新功能（增量/修复阶段）

| 场景 | R1–R4 要求 |
|------|-----------|
| 新功能 | **必须遵守**，禁止新增技术债 |
| Bug 修复 / 增量维护（`mode: incremental`） | 允许在触碰范围内顺手还债，但**必须与功能修复分开提交**并标记 `debt:`；若还债导致 scope 明显扩大，拆分为独立任务 |
| 还债放行标准 | 不影响现有已实现功能（现有测试 + 服务启动验证通过）即可，不要求用户逐条审批 |

---

## 4. API 契约

- API 路由、响应信封、字段命名、分页、枚举、鉴权、SSRF 规则见 `api-standard`。
- 所有平台响应必须通过 `platform/api/response` 封装。
- Go 结构体 JSON 字段必须显式写 `json:"snake_case"` 标签。
- 契约来源：PRD 第 5/6 章 + `api-contract-snapshot.md` + `03_API_Standard.md`；禁止反向读取前端代码对齐字段。
- URL 解析 / 反向代理必须校验 scheme（仅 http/https）与 host，防范 SSRF。

---

## 5. 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 包名 | 小写、简短 | `config`、`gateway` |
| 结构体 | PascalCase | `AssetResource` |
| 接口 | PascalCase，动词优先 | `Provider`、`Store` |
| 函数 | CamelCase | `loadConfig` |
| 常量 | CamelCase 或 UPPER_SNAKE | `defaultTimeout` |
| 错误变量 | Err 前缀 | `ErrNotFound` |

---

## 6. 错误处理

```go
if err != nil {
    return fmt.Errorf("failed to load config: %w", err)
}
```

- 不要用 `panic` 处理业务错误。
- 不要忽略错误返回值。
- 对外错误类型使用 `api-standard` 的 `errorType` 枚举。

---

## 7. 测试

- 所有 `platform/` 业务包必须包含 `*_test.go`。
- 使用标准 `testing` + `testify/assert`；表驱动优先。
- 外部依赖通过接口注入或 mock。
- 并发相关代码应提供 `go test -race` 结果（如适用）。
- TDD 循环、测试命令与覆盖率要求见 `testing-tdd`。

---

## 8. 禁止

- 不要使用 `panic` 处理业务错误。
- 不要忽略错误返回值。
- 不要直接修改 `upstream/prometheus/` 源码。
- 禁止新增 handler 直接接收 `*gorm.DB`。
- 禁止新增业务代码调用 `models.GetResourceField` / `models.LegacyFieldMap`。
- 禁止只通过 `AutoMigrate` 新增表 / 字段而不写 migration。
- 禁止新增模块直接修改 `main.go` 路由注册或 `AutoMigrate` 列表。
- 禁止为绕过测试问题引入复杂生产代码包装。
