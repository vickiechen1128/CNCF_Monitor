# backend-developer 执行记录 — Module_09（Phase 4，MVP）

> 归属：MetricCenter 后端开发（backend-developer）
> 分支：`feat/module-09-config-center`
> 目标：按 `docs/05-execution-records/module-09/task-sequence.yaml` 顺序执行 T09-01~T09-07，每个任务 TDD、接口闭环即 commit。

## 执行环境与工具

- Go 工具链：项目级 `.tools/go/bin/go`（go1.26.1 darwin/arm64），所有命令以其为准。
- 校验命令：`go test ./platform/<pkg>/...` / `go test ./platform/...` / `go vet ./platform/...` / `go build ./platform/...` / `make build-metric-center`。
- 服务启动验证：`./platform/cmd/metric-center/metric-center -listen-address :18080`，curl 检查 `/api/v1/health`/`/api/v1/health/db`/`/api/v1/status` 返回 200，验证完毕停服释放端口。

## 提交清单（含 commit hash + 任务 id）

| task id | 主题 | commit |
|---------|------|--------|
| T09-01~05 | models 契约对齐/枚举集中、配置生成器、labels/targets/校验/变更检测、网域监控纳管+agent_pull 占位、配置草稿服务 | 早前基线（承接 Summary 中已提交项） |
| T09-06 | 配置下发与历史：local 写盘 reload / retry / rollback / change_status 回写 | `bc86e41d` |
| T09-07 | 配置中心路由注册 + 全链路集成冒烟 | `7f56b2aa` |
| review-fix HIGH-1 | main.go 装配真实 DiskApplier + reload 回调，修复 local 下发伪成功 | `2d7cd860` |
| review-fix MEDIUM-1/3 | ConfirmDraft 事务化 + writeback 降级/就绪过滤 | `68b5dd8b` |
| review-fix MEDIUM-2 | GenerateDraft 消除二次查询吞错 | `21930a2d` |

## T09-06 配置下发与历史（commit bc86e41d）

### 修改/新增文件
- 新增 `platform/configcenter/deployment/service.go`：`Applier` 接口 + `Dispatch`（local 经 Applier 写盘 reload / agent_pull 占位登记）+ `Retry`（仅 local + 原记录 failed，复用版本重下发）+ `Rollback`（目标版本存在且同网域 local）+ `DiskApplier`（targets 临时文件+rename 原子写；仅 prometheus/rules/blackbox 结构变化才 reload）。
- 新增 `platform/configcenter/deployment/callback.go`：ConfigDeployment.status=success 后回写 M01 `ScrapeJob.change_status` pending→deployed（决策 31-M2）。
- 新增 `platform/configcenter/deployment/history.go`：配置版本 / 下发记录分页列表与详情。
- 新增 `platform/configcenter/deployment/handler.go`：`/config-versions`、`/config-versions/{id}`、`/deployments`、`/deployments/{id}/retry`、`/deployments/{id}/rollback` 路由与响应映射。
- 新增 `platform/configcenter/deployment/deployment_test.go`：local 成功/失败、agent_pull 占位、retry 校验、rollback、DiskApplier reload 策略分离、change_status 回写等。
- 修改 `platform/configcenter/draft/service.go`：`ConfirmDraft` 确认后触发 local 下发（`deployment.DeployConfirmedVersion`）。
- 修改 `platform/configcenter/draft/draft_test.go`：seed 已纳管网域 + 断言 confirm 触发下发记录。

### 关键实现细节
- **reload 策略分离（决策 31）**：targets/*.json 原子写后由 Prometheus file_sd 自动感知，不触发 reload；仅结构文件变化才重写并 reload。
- **重试/回滚仅 local**：Retry 校验原记录 channel==local 且 status==failed，并校验网域 channel==local；Rollback 校验目标版本同网域 local。
- **gin 路由约束**：`/deployments/{deployment_id}/retry` 与 `/deployments/{config_version_id}/rollback` 因 gin 同段通配符名必须一致，统一用 `:id`（语义由 handler 区分），不影响前端调用路径 `/deployments/{id}/retry|rollback`。

### 验证
- `go test ./platform/configcenter/deployment/...`（含 Retry 拒绝非 local、回滚版本不存在等用例）
- `go test ./platform/configcenter/...` 全绿；`go vet` / `go build` 通过。

## T09-07 路由注册 + 全链路集成冒烟（commit 7f56b2aa）

### 修改/新增文件
- 新增 `platform/configcenter/register.go`：`configcenter.RegisterRoutes` 统一挂载 domain / draft / deployment 子包路由到 `/api/v2/platform/*`。
- 修改 `platform/cmd/metric-center/main.go`：挂载 `configcenter.RegisterRoutes(platform, db.DB)`；移除旧 `/api/v2/platform/config/preview|apply` 占位 handler（收敛至 configcenter，契约 §6 决策）。
- 修改 `platform/cmd/metric-center/main_test.go`：`buildIntegrationEngine` 补挂 configcenter 路由 + migrate `ConfigDraft`/`ConfigVersion`/`ConfigDeployment`；新增 `TestEndToEndConfigCenterSmoke`。

### TestEndToEndConfigCenterSmoke（主链路冒烟）
复用 seed 生成的 default(local, 已纳管) 网域 + 种子一条 change_status=pending 的 ScrapeJob，串联：
1. `POST /config/drafts` 生草稿 → 2. 直接落库 validation_status=passed（等价 revalidate，测试环境无 promtool）→ 3. `GET /config-drafts/{change_no}` 取详情 → 4. `POST .../confirm` 生成 ConfigVersion + 触发 local 下发 → 5. `GET /deployments` 见 local/success 记录 → 6. ScrapeJob.change_status pending→deployed 回写断言 → 7. `GET /config-versions` 版本可见。

### 服务启动 curl 验证（端口 18080）
- `/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` → 200
- M09 路由已注册：`config-versions`、`deployments` 缺网域 → 400（bad_request，非 404，证明路由生效）
- 旧占位 `/api/v2/platform/config/preview`、`config/apply` → 404（已移除，未重复注册）
- 验证完毕已停服释放端口。

### 验证
- `go test ./platform/...` 全部通过
- `go vet ./platform/...`、`go build ./platform/...` 通过
- `make build-metric-center` 通过

## dev-feedback 登记项
- promtool / blackbox 二进制本环境不可调用：校验返回 `validation_status=pending`，不阻断（MVP 硬约束第 11 条）。集成冒烟中以直接落库 passed 等价模拟 revalidate 通过。
- 部署路由 param 名由契约 `deployment_id`/`config_version_id` 统一为 gin `:id`（实现层内部，URL 形态不变）。

## 遗留 & 后续
- 前端任务 T09-F1~F7 待 frontend-developer 基于 `api-contract-snapshot.md` 推进。
- agent_pull / Edge Sync Agent 拉包、心跳、Token 在线下收为 v0.2（feat/module-09-edge-cloud），本分支仅 UI 字段与占位。

## review-fix（golang-reviewer 审查回修）

### HIGH-1 运行期装配真实 Applier，修复 local 伪成功（commit 2d7cd860）
- **问题**：`DefaultApplier` 恒为 `noopApplier{}`，运行期只写 success 不写盘不 reload，violates M09 §3.5。
- **修复**（`platform/cmd/metric-center/main.go`）：
  - 新增 `-config.dir`（默认 `./config-output`）与 `-config.reload-url`（空则结构变更报错，不伪成功）。
  - main() 启动时装配 `deployment.DefaultApplier = &deployment.DiskApplier{Dir, Reload: buildReloadFunc(url)}`。
  - 新增 `buildReloadFunc`：POST reload 地址；未配置 / 非 2xx / 非法 scheme 均如实报错。
  - 修正 `service.go` `DefaultApplier` 误导注释（原「由路由注册替换」→ 明确由 main.go 装配）。
- **测试**：`TestBuildReloadFunc`（未配置报错 / 2xx 成功 / 非 2xx / 非法 scheme）。
- 说明：集成测试 `buildIntegrationEngine` 不调用 main()，仍走 no-op，符合「测试替换、生产装配经 main」约束。

### MEDIUM-1 confirm 多步事务化 + writeback 解耦（commit 68b5dd8b）
- **问题**：ConfirmDraft 先建版本/置 confirmed 再下发，dispatch 失败可造成「版本已建、草稿已 confirmed」部分提交死角；writeback 失败整链 500 可致客户端重复下发。
- **修复**：
  - `draft/service.go` `ConfirmDraft`：create ConfigVersion + 置草稿 confirmed + DeployConfirmedVersion 收拢到 `db.Transaction`，任一步失败整体回滚，重试仍见 pending。
  - `deployment/service.go` `dispatchVersion`：writeback 失败从「整链 500」改为「降级记录到 dep.error_message 并返回成功」，投递成功与回写解耦。
- **测试**：`TestDispatchWritebackFailureDegrades`（无 scrape_jobs 表 → writeback 失败降级不报错）。

### MEDIUM-2 GenerateDraft 吞错修复（commit 21930a2d）
- **问题**：`jobs, _ :=` / `rules, _ :=` 吞 LoadJobs/LoadRules 错误，DB 瞬态失败静默生成空草稿。
- **修复**：`buildArtifacts` 改为同时返回 jobs/rules（一次加载即可复用），GenerateDraft 删除二次查询与吞错，加载错误统一上抛。
- **测试**：`TestGenerateDraftPropagatesLoadFailure`（drop monitoring_rules 表 → GenerateDraft 报错，不生成空草稿）。

### MEDIUM-3 writeback 回写口径对齐（commit 68b5dd8b）
- **问题**：callback 注释声称仅回写 draft_status=ready，但 WHERE 实际只按 `change_status=pending`，会把未就绪 Job 一并置 deployed。
- **修复**：`deployment/callback.go` `writebackChangeStatus` WHERE 增加 `draft_status='ready'`，与注释语义对齐。
- **测试**：`TestWritebackChangeStatusFiltersDraftReady`（ready 回写、draft 态不回写）。

### 契约口径确认（list 不返回明文 token）
- **结论**：`NetworkDomain.Token` 序列化为 `json:"-"`，明文不进入任何 list/detail 响应；`token_masked` 经 AfterFind 派生。明文仅在 `POST /monitor` 与 `POST /reset-token` 通过专用 `TokenResult{token,token_masked}` 单次返回。**契约 §3/§9 口径已满足，无需改动网络域序列化**。（已登记 dev-feedback.md）