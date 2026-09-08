# Module 08 backend-developer 执行记录

> 本文件按 micro-task 追加任务条目；Agent 调用结束后写总结性收尾。

---

## T08-06：M02 侧 Prometheus GET /api/v1/alerts 代理

- **commit**：未提交（任务卡要求本 Agent 不执行 git commit，由 Orchestrator 统一收口；回填 hash 待提交后补）
- **新增/修改文件**：
  - `platform/query/alerts.go`（新增）：`AlertsHandler` 代理中心 Prometheus `GET /api/v1/alerts`，`data.alerts` 返回字段子集 labels/annotations/state/activeAt/value；`network_domain` Query 服务端本地过滤（`labels.network_domain` 缺失回落 `default`，与 targets.go 同构）；租户/网域注入骨架 `tenantAuthorizedDomains`/`alertDomainAllowed`（MVP 恒通过，机制保留，M02 §11.2#5）；上游不可达/非 success → `internal`；空结果返回 `[]` 而非 null。
  - `platform/query/alerts_test.go`（新增）：6 个用例——字段子集透传、network_domain 过滤、缺失标签回落 default、空结果非 null、上游三类故障（status=error / HTTP 500 / 连接拒绝）→ internal、租户骨架锚点（nil=恒通过 / 非空集合按网域收敛）。
  - `platform/query/routes.go`（修改）：`RegisterRoutes` 追加 `GET /alerts`（apiV1 组，命中认证中间件，仅认证不授权）。
- **关键实现说明**：与既有 targets 代理同构（上游拉取 + 本地过滤 + 统一响应信封）；不代理 Alertmanager 通知状态（M02 §11.2#14 边界，归 T08-07）。
- **验证**：`go test ./platform/query/...` ok；`go vet ./platform/query/...` 通过。

## T08-07：M08 侧 Alertmanager GET /api/v2/alerts 通知状态代理 + 路由注册

- **commit**：未提交（同 T08-06，由 Orchestrator 统一收口）
- **新增/修改文件**：
  - `platform/alertmanager/alerts/proxy.go`（新增）：`Proxy`/`NewProxy`（scheme 仅 http/https + host 非空，SSRF 防护，与 silence.NewProxy 同口径）；`ListAlerts` 调 AM `GET /api/v2/alerts`（v2 口径裸数组解码，决策 61；非 2xx 错误脱敏截断）。
  - `platform/alertmanager/alerts/service.go`（新增）：`AlertItem` 契约视图（labels/annotations/starts_at/ends_at/status{state,silenced_by,inhibited_by}/notify_status，snake_case）；`normalizeNotifyStatus` 服务端归一四态（active/silenced/inhibited/unprocessed，suppressed 不外露，silenced 优先于 inhibited）；`domainInScope` 决策 56 读路径授权过滤骨架（AllDomains/nil 恒通过；非全量按 labels.network_domain 缺失回落 default 收敛）；network_domain UX 筛选在授权过滤之后执行（不构成权限依据）。
  - `platform/alertmanager/alerts/handler.go`（新增）：`ListHandler` → `GET /api/v2/platform/alertmanager/alerts`；`authorizedScopeForUser` 服务端强制注入授权网域集合（MVP 恒 AllDomains，不信任前端传参）；AM 不可达/非 2xx → `internal`；空结果 `items: []`。
  - `platform/alertmanager/alerts/alerts_test.go`（新增）：9 个用例——Proxy SSRF 校验、四态映射 + 字段子集、四态优先级（silenced 优先）、授权过滤锚点（AllDomains=5 条 / Domains={default}=2 条含无标签回落 / nil=全通过）、UX 筛选、AM 不可达错误、端点 happy（断言仅命中 /api/v2/alerts 路径）、空结果非 null、AM 故障 → internal。
  - `platform/alertmanager/register.go`（修改）：追加 `am.GET("/alerts", alerts.ListHandler(...))`（只读端点挂根组，仅全局认证，同静默列表挂法）；`RegisterRoutes(platform, db, amURL)` 签名不变，main.go 无需改。
  - `platform/cmd/metric-center/main_test.go`（修改）：`fakeAlertmanager` 增加 `GET /api/v2/alerts` 夹具；`fakePromUpstream` 增加 `/api/v1/alerts` 夹具；新增 `TestEndToEndAlertStatusSmoke` 经真实路由树验证双视图（字段子集 / network_domain 过滤 / 四态归一）。
- **关键实现说明**：读路径授权过滤在 service 层执行（`domainInScope`），scope 由 handler 从服务端上下文构建（当前 MVP 恒 AllDomains=true），前端 Query 仅作 UX 筛选透传。
- **验证**：`go test ./platform/alertmanager/...` ok；`go vet ./platform/alertmanager/...` 通过；`go test ./platform/cmd/metric-center/... -run TestEndToEnd` ok（含新增冒烟）。

---

## 总结性收尾（T08-06/T08-07 批次）

- **输入文档**：
  - `docs/05-execution-records/module-08/task-sequence.yaml`（T08-06/T08-07）
  - `docs/05-execution-records/module-08/api-contract-snapshot.md` §1 通用契约 / §10.1 / §10.2（第一权威）
  - `docs/03-engineering-standards/03_API_Standard.md` §7、`04_Testing_Standard.md` §4
  - 参考实现：`platform/query/targets.go`、`platform/alertmanager/silence/*`
- **全量验证**：
  - `go test ./platform/...` 全绿；`go vet ./platform/...` 通过；`go build ./platform/...` 通过。
  - 服务启动验证：新二进制 `--listen-address :18080`（8080 被既有 `make run-metric-center` 进程占用，未触碰）——`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；两新端点无 token 返回 401（证明已注册并命中认证中间件）；admin 登录后带 token 调 `GET /api/v1/alerts` 与 `GET /api/v2/platform/alertmanager/alerts` 均返回 `{"status":"success","data":{"alerts"/"items":[]}}`（本机 9090/9093 上游在线，空结果为非 null 空数组）。验证后已停服释放 18080。
- **遗留风险与下一步**：
  - 决策 56 授权集合当前 MVP 恒 AllDomains；多租户启用时需在 `alerts.authorizedScopeForUser` / `query.tenantAuthorizedDomains` 从认证上下文解析真实授权网域集合（测试锚点已就位）。
  - T08-F6/F7 前端双视图页可直接对接本批次两接口（契约 §10 字段已按快照实现）。
  - Track B+ 强制 security-reviewer 收尾（决策 56 授权骨架 + 代理 SSRF 面）待挂。
  - 本批次未 commit（任务卡要求），commit hash 待 Orchestrator 收口后回填。
