# M09 B2 — 模块骨架与 v3 双路由组接入（实施计划）

## Context（为什么做这件事）

B0 契约冻结（`api-contract-snapshot-v3.md`，D23–D31）与 B1 schema 迁移（`00005_m09_edge_platform`，5 张表 + 测试全绿）已完成。当前批次 **B2 / T09-B2-1** 建立 `platform/modules/m09/` 模块骨架并接入 v3 注册表与双路由组（`/api/v3/platform` + `/api/v3/edge`），让 v3-only 启动后：

- `/api/v3/platform/meta` 的 `modules` 列表包含 `m09`；
- platform 面未登录 → 401（沿用全局 `AuthMiddleware`）；
- edge 面无 Token → 401（m09 自挂 `EdgeTokenMiddleware`）。

业务逻辑（纳管/Token/心跳/配置同步/查询代理）全部留到 B3+，本批次只锁死模块边界、注册顺序、鉴权链与错误映射。

## 关键发现与决策

### 1. 路由冲突（记录为 D32，B3 前定稿；本批次不实施）

冻结契约 §2.2 列出 m09 的 `GET /network-domains` 与 `GET /network-domains/:id`，但 m06 v3 已在同一 group `/api/v3/platform` 注册了这两条路由（见 [m06/handler/routes.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/modules/m06/handler/routes.go#L25-L26)）。gin radix tree 对同路径重复注册会 panic。

- **B2 处理**：只注册 m09 不冲突的 platform 路由（`edge-agents*`、`edge-packages*`、`network-domains/:id/monitor`、`network-domains/:id/token/reset`、`network-domains/:id/config-snapshots*`）；冲突的两个读端点推迟到 B3。
- **B3 方案（D32 推荐）**：m06 让出 `GET /network-domains` 与 `GET /network-domains/:id`（行政读），由 m09 提供「行政字段 + m09 运行态」的 enriched 读视图（契约 §2.1 已明确该视图含 name/cloud_code/zone_type + registration_status/token_masked/agent_count 等）；m06 保留行政写（POST/PUT/PATCH/DELETE）。同步更新 m06 的 e2e 测试中对这两条 GET 的断言。
- 本批次在 `decisions.md` 登记 D32，但**不改 m06 代码**（避免 B2 破坏 m06 现有绿测）。

### 2. 双路由组接入方式

`module.Module` 接口（[registry.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/foundation/module/registry.go#L17-L24)）只暴露 `Name()` + `RegisterRoutes(platform)`。m09 新增 `RegisterEdgeRoutes(edge *gin.RouterGroup)`，在 `v3.go` 里 `registry.Mount(platform)` 之后手动调用——**不修改 foundation 共享接口**，避免波及 m06/m07/system。

### 3. 构建顺序 ≠ 注册顺序

m09 实现 `references.MonitoringRetirer`（[monitoring.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/modules/m06/references/monitoring.go#L14-L18)）并注入 `m06.Options.Monitoring`，故**构建顺序**为 m09 → m06；但**注册表插入顺序**（= meta 列表顺序）为 `system → m06 → m07 → m09 → auth`。

### 4. EdgeTokenMiddleware 注入式设计

定义 `TokenValidator` 接口：`Validate(ctx, token) (networkDomainID string, ok bool)`。

- B2 默认 `rejectAllValidator{}`（始终 `ok=false`），因为尚无有效 Token（纳管签发端点 B3-2 才落地）→ 所有 edge 请求 401，安全收敛。
- B4 替换为真实 sha256 校验（查 `network_domain_access.token_hash`）。
- 中间件从 `Authorization: Bearer <token>` 取 token；缺失或无效 → 401（`unauthorized`），有效 → 把 `network_domain_id` 写入 gin context。可单测（fake validator）。

### 5. PublicPathPrefixes 豁免

`auth.PublicPathPrefixes` 是包级变量（[middleware.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/gateway/auth/middleware.go#L66)），在请求时读取。在 `r.Use(auth.AuthMiddleware(...))` **之前** append `"/api/v3/edge/"`，让全局用户认证跳过 edge 前缀。v3-only（`setupV3Router`）与 transition（`setupRouter`）两处都要加。

## 变更清单

### 新建 `platform/modules/m09/`（镜像 m06/m07 子包结构）

| 文件 | 内容 |
|---|---|
| `module.go` | `Options{PromURL *url.URL; ConfigOutputDir string}`；`Module` 持有 `handler.Handlers` + retirer；`NewModule(db, opts)`（nil db 报错，空值安全降级）；`Name()="m09"`；`RegisterRoutes`→`handler.RegisterPlatformRoutes`；`RegisterEdgeRoutes`→`handler.RegisterEdgeRoutes`；`MonitoringRetirer()` 返回内部 retirer（B2 为 `Available()=false` 的 no-op，B3-2 实现真实清退）。 |
| `handler/doc.go` | 包注释占位。 |
| `handler/routes.go` | `Handlers` 空结构体（B3+ 填充字段）；`RegisterPlatformRoutes` 注册不冲突路由 → `notImplemented` stub；`RegisterEdgeRoutes` 先 `edge.Use(EdgeTokenMiddleware(validator))` 再注册 `POST /heartbeat`、`GET /config` → stub。 |
| `handler/edge_auth.go` | `TokenValidator` 接口 + `rejectAllValidator` + `EdgeTokenMiddleware(v)`；401 走 `httpapi.WriteError` 或 `response.Unauthorized`（与全局中间件一致）。 |
| `handler/errors.go` | `respondError(c, err)` → `httpapi.WriteError(c, err)`，镜像 [m07/handler/errors.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/modules/m07/handler/errors.go)。 |
| `handler/stub.go` | `notImplemented(c)` 返回 501 + 统一信封（契约外占位，B3+ 逐条替换）。 |
| `domain/doc.go`、`dto/doc.go`、`repository/doc.go`、`service/doc.go`、`references/doc.go` | 子包占位，保证可编译、无业务逻辑，供 B3+ 落地。 |

### 修改 [v3.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/cmd/metric-center/v3.go)

- import `m09 "github.com/metriccenter/metriccenter/platform/modules/m09"`。
- `mountV3Modules` 签名增加 `edge *gin.RouterGroup`：先 `m09Module := m09.NewModule(...)`，`m06Opts.Monitoring = m09Module.MonitoringRetirer()`，再构建 m06/m07；按 `system → m06 → m07 → m09 → auth` 注册；`registry.Mount(platform)` 后 `m09Module.RegisterEdgeRoutes(edge)`。
- `setupV3Router`：`r.Use(auth.AuthMiddleware...)` 之前 append `"/api/v3/edge/"` 到 `auth.PublicPathPrefixes`；创建 `apiV3.Group("/edge")` 传入 `mountV3Modules`。
- `runV3`：把 m09.Options（`PromURL` + `ConfigOutputDir: *configDir`）经 `setupV3Router` 透传到 `mountV3Modules`（扩展 `setupV3Router` 入参或在内部用全局 flag，二选其一，实施时取最小改动）。

### 修改 [main.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/cmd/metric-center/main.go)（transition 模式）

- `setupRouter`：同样 append `"/api/v3/edge/"`；创建 `apiV3.Group("/edge")` 传给 `mountV3Modules`。

### 修改 [v3_test.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/cmd/metric-center/v3_test.go)

- meta 断言改为 `[]string{"system", "m06", "m07", "m09", "auth"}`。
- 新增路由冒烟：`GET /api/v3/platform/edge-agents` 无 token → 401；`POST /api/v3/edge/heartbeat` 无 token → 401。

### 文档回填

- `docs/05-execution-records/rewrite/v2.0/decisions.md`：登记 **D32**（m06 让出 `/network-domains` 读端点给 m09 enriched 视图，B3 实施；B2 不冲突路由先行）。
- `docs/05-execution-records/rewrite/v2.0/modules/module-09/backend-task-sequence.yaml`：`T09-B2-1` → `done`，附验证证据。
- `docs/05-execution-records/rewrite/v2.0/modules/module-09/acceptance.md`：对应 NFR 行回填。

## 复用的既有设施

- `platform/foundation/httpapi.WriteError` + `platform/foundation/apierror`：统一错误信封映射。
- `platform/api/response.Unauthorized`：401 写法（与 `auth.AuthMiddleware` 一致）。
- `platform/modules/m06/references.MonitoringRetirer` + `NoopMonitoring`：m09 retirer 的接口契约与默认行为参照。
- `platform/gateway/auth.PublicPathPrefixes`：edge 前缀豁免用户认证的既有机制（main.go v2 edge 已在用）。
- m06/m07 的 `module.go` + `handler/routes.go` + `handler/errors.go`：骨架与错误映射的镜像模板。

## 验证

```bash
# 路径含空格，用 cwd 参数；Go 工具链需清 GOROOT
env -u GOROOT GOTOOLCHAIN=local .tools/go/bin/go build ./...
env -u GOROOT GOTOOLCHAIN=local .tools/go/bin/go test ./platform/cmd/metric-center/... ./platform/modules/m09/...
env -u GOROOT GOTOOLCHAIN=local .tools/go/bin/go vet ./platform/modules/m09/... ./platform/cmd/metric-center/...
```

**判据（B2 验收）**：
1. `go build ./...` 退出 0；
2. `go test ./platform/cmd/metric-center/...` 全绿，且 meta 含 `m09`；
3. 路由冒烟：platform 未登录 401、edge 无 token 401；
4. `go test ./platform/modules/m09/...`（EdgeTokenMiddleware 单测：无 token 401 / 无效 401 / 有效透传并写 context）全绿；
5. 既有 m06/m07 v3 测试不回归。

## 明确不做（本批次边界）

- 不实现任何业务 handler（全部 501 stub）。
- 不改 m06 路由（冲突读端点 D32 推迟到 B3）。
- 不动 `upstream/`、legacy v2 包、前端。
- 不做数据迁移（v3 空库重建，D7）。
