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