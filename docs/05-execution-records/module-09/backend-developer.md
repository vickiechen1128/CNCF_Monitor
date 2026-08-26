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
| user-verify-fix | ListDeployments/ListVersions 去必填（未传网域返回全量）+ 单测 | `ce0ac65b` |
| user-verify-fix | ListDrafts 去必填（未传网域返回全量，前端默认/「全部网域」不再 `network domain not found`）+ 单测 | `2d8a6d94` |

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

### review-fix（T09-05 定向复审）source_version 基线回填 + 版本查询兼容

#### 问题
- GenerateDraft 从不设置 `source_version`；全库唯一写入点是 ConfirmDraft，误置为**草稿自身的 change_no**（而非「基于的上一版本」）。
- 前端按数字主键 id 调 `GET /config-versions/{id}` 拉基线版本，而 source_version 存的是 change_no 字符串 → 查询不命中 → ErrVersionNotFound → 版本对比 Diff Tab 降级（永不渲染真实 diff）。

#### 修复（方案 a：source_version 存 change_no + GetVersion 双语义兼容）
- `platform/configcenter/draft/service.go` GenerateDraft：新增 `lastConfirmedVersion`，取该网域最近 confirm 生成的 ConfigVersion（created_at 倒序）并回填 `SourceVersion = 上一版本 change_no`；无历史版本为空（前端据此显示「无历史版本可对比」）。
- `platform/configcenter/draft/service.go` ConfirmDraft：移除 updates 中 `"source_version": d.ChangeNo`（确认不改变基线指向，避免覆盖 GenerateDraft 已回填的正确值）。
- `platform/configcenter/deployment/history.go` GetVersion：纯数字入参按主键 id 查，否则按 change_no 查（新增 `loadVersionByChangeNo`）；`loadVersion`（按 id）保持供 Retry/Rollback 使用，改动不波及下发/回滚路径。
- 契约 `api-contract-snapshot.md` §4/§5 补充 source_version 口径（存 change_no）与 `{id}` 双语义命中；登记 `dev-feedback.md`（口径确认）。

#### 新增/修改测试
- `platform/configcenter/draft/draft_test.go`：
  - `TestGenerateDraftBackfillsSourceVersion`（无历史→source_version 空；有历史→回填上一版本 change_no）；
  - `TestConfirmDraftKeepsSourceVersion`（confirm 后 source_version 仍指向前一版本，不被覆盖为草稿自身 change_no）。
- `platform/configcenter/deployment/deployment_test.go`：`TestListAndGetVersion` 追加按 change_no 拉详情命中断言。

#### 验证
- `go test ./platform/configcenter/draft/...`、`./platform/configcenter/deployment/...`、`go test ./platform/...` 全绿；`go vet ./platform/...`、`go build ./platform/...` 通过。
- 服务启动 :8080 后 `/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；验证完毕已停服释放端口。

#### 前端联动
- 前端**无需改动**：`deploymentApi.getConfigVersion(source_version)` → `/config-versions/{change_no}`，后端 GetVersion 已兼容按 change_no 命中；source_version 语义（上一版本 change_no）与 ConfigPreviewPage 现有拉取方式对齐。

### user-verify-fix：列表接口去 network_domain_id 必填（下发记录/配置版本未选网域报错）

#### 问题
- 用户验收 «下发记录»页未筛选网域时，前端 `GET /api/v2/platform/deployments` 不带 `network_domain_id`，后端 `ListDeployments` 直接返回 `ErrDomainRequired`（“network_domain_id is required”）→ 页面级报错。裁定：未传网域应返回全量，而非报错。

#### 修复
- `platform/configcenter/deployment/history.go`：
  - `ListDeployments`：删除 `if domainID == "" { return nil, 0, ErrDomainRequired }`，改为仅当 `domainID != ""` 才追加 `.Where("network_domain_id = ?", domainID)`；status/change_no 过滤保留。
  - `ListVersions`：同步删除必填分支，`domainID` 非空才按网域过滤，返回全量。
- `platform/configcenter/deployment/handler.go`：`ErrDomainRequired` 常量与 BadRequest 分支保留不删（list 接口不再触发该错误，空网域路径自然返回全量，不再 400）。

#### 新增/修改测试（deployment_test.go）
- `TestListAndGetVersion`：空 domainID 断言由「ErrDomainRequired」改为「返回全量（total=2）」。
- `TestListDeploymentsFilter`：空 domainID 断言改为「返回全量（total=3）」。
- `TestDeploymentHandlerRoutes`：GET `/deployments` 不带 `network_domain_id` 由「期望 400」改为「期望 200」。

#### 验证
- `go test ./platform/configcenter/deployment/...` 通过；`go build ./platform/...`、`go vet ./platform/configcenter/deployment/...` 通过。

#### 前端联动
- 前端下发记录页不再因未选网域报错；「网域信息加载失败」由前端 `fetchAllDomains` 信封 `items/list` 修正解决（见 frontend-developer.md）。
### user-verify-fix：变更清单按产物 diff 派生（修复「禁用 Job 显示本次无配置变更」误导）

#### 问题
- 用户验收反馈：禁用采集 Job 后，配置变更预览页显示「本次配置无变化 / 无实际内容变化」，与「版本对比」Tab 中真实 diff（scrape_config 被删除）自相矛盾，引发误解。
- 根因：`buildChangeItems`（原 `platform/configcenter/draft/service.go`）不做新旧产物 diff，仅罗列当前「仍启用」的 Job/规则且全部写死标为「新增」；被禁用的 Job 已被 `generator.LoadJobs` 过滤，永远不会以「移除」出现在清单中。禁用唯一 Job 时清单为空 → `buildSummary` 返回「本次无配置变更」。不符合 M09 PRD §3.4（变更类型 新增/修改/移除、按产物差异派生、删除目标=高风险醒目提示）。

#### 修复
- 新增 `platform/configcenter/draft/change_items.go`：
  - `buildChangeItems(jobs, rules, artifacts, base)`：以「上一已确认 ConfigVersion 产物 vs 本次草稿产物」做 diff；`base == nil`（首次生成）保持原「全部新增」口径（`buildInitialChangeItems`）。
  - `diffJobItems`：对比新旧 `prometheus.yml` 的 scrape_config（`snapshotScrapeConfigs` 重序列化后与键序无关）+ 对应 targets 文件内容 → 新增（low）/ 变更（low）；生效版本中存在但本次产物已摘除的 Job → 「移除采集 Job X（监控断点风险）」（delete，high）。
  - `diffRuleItems`：按规则组名对比新旧 `rules.yml` → 新增/变更/移除（规则一律 high，契约 §8）；任一侧解析失败（如多条透传规则拼接出重复顶层 groups 键）退化为整文件比较，避免误报移除。
- `platform/configcenter/generator/generator.go`：导出 `NormalizeJobFilename`（供 draft 包按同一口径反查 job 对应 targets 文件名）。
- `service.go` GenerateDraft / reconcileWithExistingPending：`lastConfirmedVersion` 前置为 diff 基线（GenerateDraft 顺带消除原两次重复查询）；决策 44-3 噪声抑制扩展为「变更清单为空即 ErrNoChanges」（含「仅改动禁用对象字段」的空跑，PRD §3.3.3，由 checksum 等价裁决）。
- `buildSummary`：按「变更类型+对象」聚合，如实输出「新增/变更/移除采集 Job N 个（移除标高风险）」，不再笼统「涉及 N 个」。

#### 新增/修改测试（draft_test.go）
- 新增 `TestGenerateDraftDiffRemoveOnDisableJob`：禁用唯一已生效 Job → 草稿含 delete/high「移除采集 Job job1」，摘要含「移除采集 Job 1 个」。
- 新增 `TestGenerateDraftNoDiffReturnsErrNoChanges`：confirm 后源数据无实质变化 → ErrNoChanges，不再生成「无变化」草稿。
- 调整 `TestGenerateDraftBackfillsSourceVersion` / `TestConfirmDraftKeepsSourceVersion`：补 seed ready job 形成实质 diff（新语义下无 diff 即 ErrNoChanges），测试意图（source_version 回填/保持）不变。

#### 验证
- `go build ./platform/...`、`go vet ./platform/...`、`go test ./platform/...` 全绿。

#### 前端联动
- 前端无需改动：`ConfigPreviewPage` 的 `changeTypeLabel/changeTypeColor` 已支持 add/update/delete 渲染；禁用 Job 后变更清单 Tab 现在会如实出现红色「移除」高风险项。
