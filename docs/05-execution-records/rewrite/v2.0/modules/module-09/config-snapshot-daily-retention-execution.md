# M09 配置快照自然日保留（SRS v1.7）执行记录

- 状态：implemented / verified（M09 主链路）
- 日期：2026-11-18
- 关联：M09 SRS v1.7 FR-12 / FR-13；`immediate-config-sync-execution.md`

## 1. SRS 回填

已更新 `docs/02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md`：

- FR-13 改为自然日维度：网域采集配置 / 中心规则默认保留最近 **30 天**，每天最多一份**成功版本**；
- 同一天多次成功变更只保留当日最后一份；
- 失败尝试不写入快照历史，仅回写 M01 `sync_status` / `sync_error` 与日志；
- 当前生效版本始终保留；
- 时区与天数可配置：`METRIC_CENTER_SNAPSHOT_TIMEZONE`（默认 `Asia/Shanghai`）、`METRIC_CENTER_SNAPSHOT_RETENTION_DAYS`（默认 30）；
- 告警配置沿用 M08 的 20 份策略；
- FR-12 / FR-13.1 / §3.4 / §7.2 / §8.3 / §9 / Change Log v1.7 同步修订。

未修改历史技术 PRD。

## 2. 代码实现

### 2.1 每日裁剪

- 新增 `platform/modules/m09/repository/snapshot_prune.go`：
  - 按 `family + 自然日` 分组；
  - 每天只保留最新成功版本；
  - 失败版本直接删除；
  - 当前版本永不删除；
  - 超过保留天数的非当前版本删除。
- `SnapshotRepository.PruneSnapshots(ctx, domainID, keepDays, loc)`；
- `CenterSnapshotRepository.Prune(ctx, keepDays, loc)`；
- 新增 `platform/modules/m09/service/snapshot_retention.go` 读取环境变量，提供默认 30 天 / Asia/Shanghai；
- `ConfigSyncService` / `CenterRulesService` 新增 `retentionDays` / `dayLocation`，并提供测试用 `SetRetention`。

### 2.2 失败尝试不再落快照

- `ConfigSyncService.SyncDomain`：校验/发布失败时不插入 `config_snapshots`，只做：
  - `recordSyncResult` 回写 M01 `sync_status=failed` / `sync_error`；
  - 执行一次日裁剪，清理历史失败/同日重复行。
- `CenterRulesService.Sync`：同样不插入失败记录；`recordOutcomes` 回写 M01 规则同步状态。
- 移除上一轮为「失败行去重」新增的 `Latest` / `UpdateAttempt` / `UpdateAndActivate`，避免保留无用路径。

### 2.3 校验状态回写自愈

- `SyncDomain` 在 checksum 未变化、直接返回当前版本时，仍调用 `recordSyncResult`；
- `CenterRulesService.Sync` 在 checksum 未变化时仍调用 `recordOutcomes`；
- 目的：修复历史 pending 状态（例如上一次回写因时区比较被跳过）。

### 2.4 前端配置历史页

`ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`：

- 标题改为「配置备份历史」，并展示「仅保留最近 30 天」标签；
- 新增「配置日期」列与「全部日期」下拉筛选，按本地自然日过滤；
- 搜索框改为「搜索版本或日期」；
- 移除列表中的 checksum 列，减少技术信息；
- 状态列改为「状态」，「当前生效」改为「当前使用」；
- 信息 Alert 改为用户语言：按日期展示、30 天保留、每天最多 1 份成功配置、当前配置不删除、历史不可回滚；
- 错误 Alert 不再直出后端技术错误，改为「请刷新重试 / 联系管理员」；
- 恢复包入口改为「下载恢复包」，提示语去掉 Prometheus/rules/Alertmanager/targets 等技术名词。

`SnapshotDetailDrawer.tsx`：

- 标题改为「配置详情」，按钮改为「下载配置包 / 下载规则文件 / 下载告警配置」；
- 「校验状态/校验归因/校验值/校验明细」改为「状态/失败原因/配置标识/失败详情」；
- 内容不可用、无权限、加载失败等 Alert 改为用户可理解文案；
- checksum 仅在详情中作为「配置标识」保留。

测试：

- `ConfigPreviewPage.test.tsx`：更新列表/空态/错误/详情/导出文案，新增「按配置日期筛选」与 30 天提示断言；
- `configCenterConstants.test.ts`：新增 `formatLocalDate` 用例；
- `typecheck:test` / `tsc --noEmit` / ESLint 定向通过。

## 3. 联调中发现并修复的阻塞问题

服务重启验证时发现三个与本次功能无直接关系、但会阻断验证的问题：

1. **Postgres migration 0021 jsonb LIKE 报错**
   - `m01_exporter_templates.supported_monitor_types` / `m01_metric_library.monitor_types` 为 `jsonb`；
   - 原 SQL 直接 `LIKE` / `REPLACE`，Postgres 报 `operator does not exist: jsonb ~~ unknown`；
   - 已改为 `::text` 后 `REPLACE`，再 `::jsonb`（Up/Down 同步修正）。
2. **M01 resource reader Postgres COALESCE 类型错误**
   - `COALESCE(h.has_npu, 0)` 混合 boolean / integer；
   - 已改为 `COALESCE(h.has_npu, false)` / `has_gpu`。
3. **M01 同步回写时区比较错误**
   - Postgres `timestamp without time zone` 存本地墙上时间，pgx 返回 UTC location；
   - M09 `generatedAt` 是 UTC；直接 `After` 会把 15:18 本地误判为晚于 16:08 本地，导致 `pending` 永不回写；
   - 已在 `SyncSink.updatedAfter` 对 Postgres 按墙上时间比较，SQLite 保持绝对时间比较；`RecordDomainSync` / `RecordRuleSync` 均使用。
   - 该修复假设 Postgres 会话/写入端墙上时间与进程 `time.Local` 一致（当前部署为 Asia/Shanghai）；生产若统一 UTC，建议后续把 `m01_*` 时间列迁移为 `timestamptz` 或在连接层固定时区。

## 4. 验证

定向测试：

```bash
go test ./platform/modules/m09/... -count=1
go test ./platform/modules/m09/service ./platform/modules/m09/repository ./platform/modules/m09/handler -count=1
go test ./platform/modules/m01/references -count=1
go vet ./platform/modules/m09/...
```

新增/更新覆盖：

- `TestPruneSnapshotsKeepsOneSuccessPerDay`
- `TestPruneSnapshotsKeepsCurrentOutsideRetentionWindow`
- `TestCenterSnapshotPruneKeepsOneSuccessPerDay`
- `TestCenterSnapshotPruneKeepsCurrentOutsideWindow`
- `TestSyncDomainFailureKeepsCurrent`（失败不落快照）
- `TestSyncDomainCollapsesSameDayHistory`
- `TestCenterRulesSyncDoesNotPersistFailedAttempts`
- `TestCenterRulesSyncPassAfterFailureCreatesOnlySuccessSnapshot`
- `TestCenterRulesSyncCollapsesSameDayHistory`
- `TestPostgresUpdatedAfterUsesWallClock`

服务实测（Postgres `metric_center_test`）：

- 重启迁移至 0021 成功；
- `POST /config-sync/trigger` domain/center 均返回 passed；
- 触发后 M01 `m01_scrape_jobs.sync_status` 从 `pending` 变为 `synced`；
- 触发产生新版本后，同日旧版本被自动删除，库里每域每天仅一条；
- 当前库仅保留 4 条 passed 快照（1 AM + 1 center + 2 domain），无 failed 快照。

## 5. 数据回填

已用临时 Go 程序对本地两套库执行日裁剪：

- SQLite `metric_center_v3.db`：删除 3 条同日非当前 domain 版本；
- Postgres `metric_center_test`：删除 2 条同日非当前 domain 版本；
- failed 快照此前已清理；回填后两库均为「当前 + 日版本」。

## 6. 待收尾

1. M07 资源 / 标签模板 / Excel 导入 / 批量改归属/端口仍未接入即时触发，仍依赖 30s watcher；
2. 失败尝试目前只回写 M01 状态与日志，尚未单独建 `config_change_log` 审计表（按当前 owner 口径暂不需要）；
3. 按用户要求未再跑全量前后端测试；本轮为 M09/M01 定向测试 + 服务实测。
