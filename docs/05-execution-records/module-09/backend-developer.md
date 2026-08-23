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