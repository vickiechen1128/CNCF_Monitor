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