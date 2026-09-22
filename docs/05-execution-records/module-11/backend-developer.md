# backend-developer 执行记录 — Module_11（F-11：中心落库边缘 vmagent target 快照）

> 归属：MetricCenter 后端开发（backend-developer）
> 分支：`feat/module-09-config-center`
> 任务：F-11 中心侧落库边缘 vmagent target 快照（方案 B），TDD + 契约优先。

## 背景

M09「监控目标状态」页对边缘域恒空：边缘 vmagent 抓取经 remote_write 只上报指标样本、不上报 target 元数据，中心 Prometheus `/api/v1/targets` 对边缘 target 恒空，缺 lastScrape/lastError/scrapeDuration 排障详情。数据只在边缘 vmagent 本地，故走 F-11 定版 B 方案——agent 心跳上报 vmagent 本地 target 快照。

agent 侧上报已完成（`platform/edge-sync-agent` contract + heartbeat 采集）。**本任务中心侧落库**：`HeartbeatRequest.Targets` 已反序列化但未落库，现实现持久化。

## 设计决策（F-11 待定子项落定，详见 dev-feedback.md F-11 定版块）

1. **心跳体积/分页**：MVP 全量上报 + 中心上限截断（`maxSnapshotsPerHeartbeat = 1000`），超出丢弃；v0.3 再评估分页/压缩。
2. **去重键**：`(network_domain_id, job, instance)`；`resource_id` 为注入标签可能缺，不作去重键；建 `uniqueIndex:idx_etargets_uniq` 兜底。
3. **快照有效期/清理**：clear-then-insert —— 每轮事务内 `Unscoped()` 硬删该 `edge_agent_id` 上轮全部快照 → 批量插入本轮；row 级 `last_report_at` 供融合阶段离线过期降级判断。**targets 为空时不清不插**（vmagent 拉取失败/未启动上报空，误清丢"真实为空"与"获取失败"分野）。
4. **与 F-10 并存**：F-10「实例采集状态」走 up 指标，F-11「监控目标状态」走 target 快照，语义/数据源并存不冲突。
5. **agent 维度**：表存 `edge_agent_id` 冗余追溯；当前一网域一 agent，`network_domain_id` 已能唯一定位。

## 修改/新增文件

- 新增 `platform/models/edge_target_snapshot.go`：`models.EdgeTargetSnapshot`（表 `edge_target_snapshots`），字段对齐上报契约 snake_case。
- 修改 `platform/db/db.go`：`AutoMigrate` 注册 `EdgeTargetSnapshot`。
- 修改 `platform/edge/heartbeat_service.go`：新增 `persistEdgeTargetSnapshots`（clear-then-insert + 上限截断 + 空不落 + 硬删防唯一索引冲突）；`Handle` 调用并降级（失败不阻断心跳，同 writebackAgentPullDeployments 口径）。
- 修改 `platform/edge/edge_test.go`：`newEdgeTestDB` 注册新表 + 新增 6 个用例。
- 修改 `docs/05-execution-records/module-11/dev-feedback.md`：F-11 待定子项定版 + 落库实施记录。

## 新增测试（platform/edge/edge_test.go）

- `TestHeartbeatPersistsTargetSnapshots`：落库成功 + 字段契约对齐 + 同轮同键去重。
- `TestHeartbeatTargetUpsertOverwritesSameKey`：同 agent 同 (job,instance) 二次心跳覆盖，行数不增。
- `TestHeartbeatTargetClearOldSnapshots`：二次心跳 target 集合变化 → 旧快照清理。
- `TestHeartbeatEmptyTargetsNoDirtyData`：空 targets 不新增也不清空。
- `TestHeartbeatTargetPersistenceIndependent`：极简心跳 targets 仍独立落库（落库独立性）。
- `TestHeartbeatTargetTruncatesAtMax`：超过上限截断。

## 验证

- `go test ./platform/edge/... ./platform/models/... ./platform/db/...` 全绿。
- `go test ./platform/...` 全绿。
- `go vet ./platform/edge/... ./platform/models/... ./platform/db/...` 通过。
- `go build ./platform/...` 通过。
- 服务启动（`metric-center -listen-address :18080`）：`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均 200；`EdgeTargetSnapshot` auto-migrate 建表成功（含 `idx_etargets_uniq` 唯一索引），验证后停服清理。

## Commit

- `feat(module-09): 中心落库边缘 vmagent target 快照（F-11）`

## 遗留/协调点

1. `/api/v1/targets` 融合接口（local + 边缘 target 快照归并）= **下一阶段**，本任务未改动（B 方案要点第 3 条）。
2. 快照有效期降级（agent 离线后 `last_report_at` 窗口置 health=unknown）= 融合阶段配套，本任务仅落 `last_report_at` 字段。
3. 一处为「待定子项 ①」新增的注释常量 `maxSnapshotsPerHeartbeat`；若 v0.3 引入分页/增量需评估该上限与上报协议。

---

# backend-developer 执行记录 — Module_11（F-11：/api/v1/targets 融合 local + 边缘 vmagent 快照）

> 归属：MetricCenter 后端开发（backend-developer）
> 分支：`feat/module-09-config-center`
> 任务：F-11 B 方案第三阶段——`TargetsHandler` 融合中心 Prometheus local targets + `edge_target_snapshots` 落库快照，TDD + 契约优先。

## 背景

上一阶段（commit `ac0a0bf`）已完成中心侧落库边缘 vmagent target 快照（`edge_target_snapshots` 表，clear-then-insert）。本阶段实现 M09「监控目标状态」页（`/targets` 路由）的边缘域回显：`GET /api/v1/targets` 由「纯 local 透传」升级为「local + 边缘快照融合」，边缘 target 的 health/lastScrape/lastError/scrapeDuration 直取落库快照，解决边缘域恒空（F-11 设计缺口）。

## 设计决策（归并/去重/过期降级口径，落档）

1. **数据源融合**：local targets（中心 Prometheus `/api/v1/targets?state=active`，原逻辑）+ 边缘快照（`edge_target_snapshots` 表，按 `network_domain_id` 过滤查询）。边缘快照**统一合成为 Prometheus target 结构**追加进 `activeTargets`：`labels` 合成 `{job, instance, network_domain, resource_id}`，抓取详情 `lastScrape / lastError / scrapeDuration` 直取快照，顶层补全 `job / network_domain / resource_id / instance`（对齐 local 增强语义，resource_id 缺失置空）。**响应 envelope `{activeTargets, droppedTargets, targetsByJob}` 不变**，前端 TargetStatusPage 7 列自动生效，无需前端改数据结构。
2. **归并/去重键**：`(network_domain, job, instance)`（F-11 子项②定版，resource_id 不作键）。**local 优先、边缘补缺**——同一 domain 下同键冲突时保留 local（中心亲自抓取为权威），边缘跳过；实际一个 job 仅被一个通道抓取，冲突罕见，防御性实现。
3. **离线过期降级**：新增常量 `EdgeSnapshotStaleAfter = 90 * time.Second`（= 3×agent 心跳间隔 30s，比任务建议的 2 倍更保守，容忍一次心跳抖动）。快照 `last_report_at` 距今超过该值时 health 置 `unknown`（无论上报值），抓取详情仍透传；上报 health 为空同样置 unknown。前端据此显示「未知」，避免陈旧 up/down 常驻。
4. **过滤一致性**：`job / network_domain / health` 过滤对融合后快照同样生效；`network_domain` 过滤下沉到 SQL 查询层（未指定不过滤，与 local 语义一致，含 default 域）；`health` 过滤作用于**降级后**的 effective health；health 三枚举 `up/down/unknown` 校验保持。
5. **上游降级不整链失败**：中心 Prometheus 不可达/故障时不再 500——local targets 置空，边缘快照仍返回（排障价值）。这是相对原实现的**行为变更**（原上游失败 → internal 500）。
6. **未指定 network_domain 默认行为**：与 local 一致不过滤（返回全部域含 default 域边缘快照）。

## 修改/新增文件

- 修改 `platform/query/targets.go`：`TargetsHandler` 签名增加 `db *gorm.DB`；新增 `fetchEdgeTargetSnapshots`（按域查询快照）、`dedupKey`（(domain,job,instance) 三键）、`edgeTargetHealth`（过期/空值降级 unknown）、`edgeSnapshotToTarget`（合成 Prometheus target 结构）、常量 `EdgeSnapshotStaleAfter`；上游失败降级为空 activeTargets；包注释与 handler 注释更新。
- 修改 `platform/query/routes.go`：`TargetsHandler(db, promURL, client)` 传入 db。
- 修改 `platform/query/targets_test.go`：`newTargetsRouter` 三返回值（含 DB）；新增 `openTargetsTestDB`（内存 SQLite + 迁移 `EdgeTargetSnapshot`）、`seedEdgeSnapshot`、`newFakeUpstreamFailing`。
- 修改 `platform/cmd/metric-center/main_test.go`：`buildIntegrationEngine` AutoMigrate 注册 `EdgeTargetSnapshot`（端到端 targets 路由依赖该表，缺表会 500）。

## 新增测试（platform/query/targets_test.go，共 9 例）

- `TestTargetsFusionLocalPlusEdge`：local+边缘按 (job,instance) 归并追加，边缘字段补全对齐（job/network_domain/resource_id/instance/lastScrape/lastError/scrapeDuration/labels）。
- `TestTargetsFusionNetworkDomainFilter`：network_domain 过滤对边缘快照生效。
- `TestTargetsFusionJobFilterAppliesToEdge` / `TestTargetsFusionHealthFilterAppliesToEdge`：job/health 过滤对边缘快照生效。
- `TestTargetsFusionDedupLocalPriority`：同键 local 优先、边缘被去重。
- `TestTargetsFusionStaleEdgeDegradedToUnknown`：last_report_at 距今 >90s 降级 unknown、新鲜快照保持原值、抓取详情仍透传。
- `TestTargetsFusionNoEdgeSnapshotsFallsBackToLocal`：快照表空回落纯 local。
- `TestTargetsFusionDefaultDomainReturnedWhenNoFilter`：未指定 network_domain 返回全部域（含 default）。
- `TestTargetsFusionUpstreamDownStillReturnsEdge`：上游恒 500 时边缘快照仍返回、status=success。

## 验证

- `go test ./platform/query/... ./platform/edge/...` 全绿；`go test ./platform/...` 28 包全绿（含 cmd/metric-center 端到端）。
- `go vet ./platform/...` 通过；`go build ./platform/...` 通过；改动文件 gofmt 干净。
- 服务启动（8080）+ 真实 Prometheus 上游（9090）：`/api/v1/health|health/db|status` 均 200；注入 1 条新鲜（up）+ 1 条过期（5 分钟前）边缘快照后 `GET /api/v1/targets?network_domain=mc-edge-debug` 返回 `job-e health=up`（透传）+ `job-f health=unknown`（降级），抓取详情齐全；`health=up`/`job=job-f` 过滤对边缘快照生效；验证后删除测试数据并停服释放端口。

## Commit

- `feat(module-09): /api/v1/targets 融合边缘 vmagent 快照（F-11）`

## 遗留/协调点

1. **前端契约**：envelope 与既有字段不变（targetsByJob 仍透传上游、不重算边缘聚合，前端按 activeTargets 渲染即可），边缘 target 多 `labels` 合成结构——前端无需改 TargetStatusPage；若后续要区分「边缘快照来源」，可在 target 顶层增加 `source` 字段（本期未加，避免契约膨胀）。
2. **targetsByJob 不重算**：融合后 `targetsByJob` 仍是上游 Prometheus 原始值（不含边缘），与现有透传口径一致，后续如需边缘聚合另议。
3. **过期阈值 90s 为常量**：与 agent 心跳间隔（30s）解耦硬编码；若心跳间隔可配置化，需同步改为按配置推导。
4. **上游降级行为变更**：`/api/v1/targets` 上游失败由 500 改为降级返回空 local + 边缘快照（F-11 排障价值），与 F-10「up 指标回显」数据源并存不冲突（见 dev-feedback.md F-11 定版 §④）。

---

# backend-developer 执行记录 — Module_11（F-11 收尾：/api/v1/targets 融合时过滤 blackbox 快照）

> 归属：MetricCenter 后端开发（backend-developer）
> 分支：`feat/module-09-config-center`
> 任务：F-11 收尾优化——按用户批准的方案 A，`TargetsHandler` 融合边缘快照时排除 `job_type=blackbox` 的 job 快照，TDD + 契约优先。

## 背景

M09「监控目标状态」页经产品决策定位为**拉模型（standard）抓取的排障入口**：health/lastScrape/lastError/scrapeDuration 语义针对「抓取动作是否成功」。拨测类（blackbox）target 状态（`probe_success`）已由 M01 实例采集状态与 F-13 首页拨测态势承载，若混入会语义误导——blackbox target 的 health 只表达「抓 blackbox_exporter 动作是否成功」≠ 目标可用性。因此融合边缘快照时按 blackbox 黑名单排除。

## 前置核实（任务要求：无法确认则报告而不是猜）

**配置生成器不改写 job 名**：`platform/configcenter/generator/render.go` `jobScrapeConfig` 中 `JobName: job.JobName` 原样透传，blackbox 分支仅改 `metrics_path="/probe"`、`params module`、`relabel_configs`，不改 job_name；边缘配置包 prometheus.yml = `ConfigVersion.PrometheusYml`（`generator.Assemble` 产物，zipper.go 打包），vmagent targets 的 job 标签即 `ScrapeJob.JobName`。**结论：黑名单按 `ScrapeJob.JobName` 精确匹配即可，无改写规则。**

## 设计决策（落档）

1. **黑名单口径**：融合前从 `ScrapeJob` 表 `Pluck("job_name") WHERE job_type='blackbox'` 取集合；边缘快照循环内 `job` 精确命中黑名单即 `continue`。精确匹配（大小写敏感），与配置生成器不改写 job 名的实际规则一致。
2. **范围**：仅过滤边缘快照，local targets 侧不变（local 的 blackbox job target 是否展示由上游 Prometheus 行为决定，本方案不动）。
3. **空态一致**：`ScrapeJob` 表为空或未匹配到 blackbox job 时黑名单为空集，行为与未加过滤前完全一致；仅在存在边缘快照时才执行黑名单查询，纯 local 路径零额外 DB 开销。
4. **查询失败处理**：黑名单查询失败与快照查询失败同口径 → internal 500（不做静默降级，避免误放行 blackbox）。

## 修改/新增文件

- 修改 `platform/query/targets.go`：`TargetsHandler` 融合段新增黑名单查询与循环排除；新增 `fetchBlackboxJobNames`（Pluck job_name WHERE job_type='blackbox'）；handler 注释与包注释更新。
- 修改 `platform/query/targets_test.go`：`openTargetsTestDB` AutoMigrate 注册 `&models.ScrapeJob{}`；新增 `seedScrapeJob` helper。

## 新增测试（platform/query/targets_test.go，共 6 例）

- `TestTargetsFusionExcludesBlackboxSnapshots`：blackbox job 边缘快照被排除，local 侧 4 条不受影响。
- `TestTargetsFusionKeepsStandardSnapshots`：standard job 快照正常保留（4 local + 1）。
- `TestTargetsFusionMixedKeepsOnlyStandard`：同域混合时仅保留 standard 快照、排除 blackbox。
- `TestTargetsFusionNoBlackboxJobsKeepsAll`：ScrapeJob 表无 blackbox job 时全部保留（空态一致）。
- `TestTargetsFusionBlackboxMatchIsExact`：黑名单精确匹配（大小写敏感），"probe-a" 不被 "Probe-A" 黑名单排除。
- `TestTargetsFusionBlackboxFilterLocalUntouched`：黑名单仅过滤边缘快照，local 侧 job-a 仍返回。

## 验证

- TDD RED/GREEN：先写 6 例 → 4 例按预期失败（排除类）→ 实现后全绿。
- `go test ./platform/query/... ./platform/edge/...` 全绿；`go test ./platform/...` 28 包全绿（含 cmd/metric-center 端到端）。
- `go vet ./platform/...` 通过；`go build ./platform/...` 通过；改动文件 gofmt 干净。
- 服务启动（8080，复用 9090 真实 Prometheus 上游）：`/api/v1/health|health/db|status` 均 200；注入 blackbox ScrapeJob（job-bb-e2e）+ 黑名单快照 + standard 快照（job-std-e2e）后 `GET /api/v1/targets?network_domain=mc-edge-debug` 仅返回 `job-std-e2e/down`；`job=job-bb-e2e` 返回空 activeTargets；`job=job-std-e2e` 正常保留；验证后删除测试数据并停服释放端口。

## Commit

- `feat(module-09): /api/v1/targets 融合时过滤 blackbox 快照（F-11）`

## 遗留/协调点

1. **PRD 契约**：本改动为技术口径收敛（M09 页面语义定位 + 数据源去重），未触及 PRD 字段/枚举/路由契约，无需改 PRD；已在 dev-feedback.md F-11 定版块登记该产品决策口径。
2. **local 侧 blackbox**：中心 Prometheus local targets 中若存在 blackbox job（中心直接拨测场景），其 target 仍透传上游原始值——本方案仅过滤边缘快照（任务范围限定），中心直连拨测的展示策略留待后续评估。
3. **前端**：envelope 与既有字段不变，前端 TargetStatusPage 无需改动。