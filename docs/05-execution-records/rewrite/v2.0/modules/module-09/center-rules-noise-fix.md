# 中心规则快照失败记录噪音修复（执行记录）

> **后续演进（SRS v1.7）**：失败尝试已不再写入快照历史，历史改为自然日裁剪；
> 本记录中的失败行合并逻辑已被 `config-snapshot-daily-retention-execution.md` 取代，仅保留作追溯。

- 状态：implemented / verified
- 日期：2026-11-18
- 关联：M09 SRS v1.5 FR-12 / FR-13；`center-rules-execution.md`；`config-artifact-history-execution.md`
- 变更范围：`platform/modules/m09/service/center_rules_service.go`、`platform/modules/m09/repository/center_snapshot_repository.go` 及单测

---

## 1. 现象

配置产物历史页出现大量「中心规则 / 失败」记录：

```text
scope=center: 11 failed + 1 passed（SQLite 本地库）
```

所有 failed 与 passed 的 `checksum` 完全相同：

```text
b9d8b7f70a0ce77ec6b6035fdab9acf47633e4fbe5b3457804fa4f0cd7bbee87
```

失败原因同为：

```text
center prometheus reload: Post "http://localhost:9090/-/reload":
dial tcp [::1]:9090: connect: connection refused
```

时间线：09:41:23 ~ 09:46:23 每 30 秒一条 failed；Prometheus 于 09:46:30 启动；09:46:53 下一次 tick reload 成功并写入 passed。即失败的只是 reload 发布动作，配置内容本身没有变化。

另一套本地 PostgreSQL 库同时观察到 5 条 center failed（`platform_fault`、`validation_details` 为 JSON `null`，即平台工具不可用），同样每 30 秒新增一条。说明问题与具体故障类型无关，根因在 watcher 重试与失败快照去重链路。

## 2. 根因

1. **空规则指纹 = 每 tick 都同步**：`GORMCenterRuleSource.Fingerprint` 在 `m01_monitoring_rules` 无行时返回零值；`RunWatcher` 的 `!fingerprint.IsZero() && ...` 判断把零值当成「每次都有变化」，`last` 又永远是零值，导致 watcher 每 30 秒空转一次。
2. **失败快照不去重**：`Sync` 只与 `CurrentPassed` 比较 checksum。没有 passed 当前版本时 `current == nil`，每次重试都会生成新版本号并 `Insert` 一条新的 failed row。
3. **保留策略上线晚于存量数据**：`Prune` 是 2026-11-18 才加入的；本次清理的 11 条 SQLite 记录产生于 11-17，早于裁剪逻辑。裁剪只能把上限压到 5 条，不能阻止重复写入。

## 3. 修复

### 3.1 Watcher 状态机

`RunWatcher` 改为：

- 增加 `synced` 标志；
- 使用 `fingerprint.Equal(last)` 判断真实变化（同时覆盖「规则全部删除 → 指纹回到零值」）；
- 只有 `passed` 或 `user_config` 失败才推进指纹；`platform_fault` 保留重试，下一 tick 继续尝试；
- 重试由 `Sync` 按 checksum 合并到同一行，不再新增历史。

### 3.2 失败快照原地更新

`CenterSnapshotRepository` 新增：

- `Latest`：取中心 scope 最新一条（不限状态）；
- `UpdateAttempt`：按 ID 原地刷新 failed 快照（checksum / status / cause / details / created_at）；
- `UpdateAndActivate`：同一事务内刷新并切换 current，用于「同一内容重试后终于通过」。

`Sync` 在 checksum 不同时读取 `Latest`；若最新一条为 failed 且 checksum 与新产物一致，则复用其版本号并原地更新，不再生成新版本。

### 3.3 附带修正

`current.Checksum == artifacts.Checksum` 的早返回路径原先用「新生成的 version」写当前版本的 payload，导致 `metadata.json` 的版本与 DB 行不一致。现改为：仅在 payload 缺失时，按 `current.Version` 重新生成并回填。

## 4. 数据清理

清理前已备份：

- SQLite：`/private/var/folders/ln/61n6p86958dc2hvhpkvrc37h0000gn/T/opencode/metric_center_v3.db.bak-20261118-135309`
- PostgreSQL `config_snapshots`：`/private/var/folders/ln/61n6p86958dc2hvhpkvrc37h0000gn/T/opencode/metric_center_test_config_snapshots_backup.sql`

清理 SQL：

```sql
-- SQLite：与 passed 内容重复的 failed 尝试
DELETE FROM config_snapshots
WHERE scope = 'center'
  AND validation_status = 'failed'
  AND checksum IN (
    SELECT checksum FROM config_snapshots
    WHERE scope = 'center' AND validation_status = 'passed'
  );

-- PostgreSQL：平台工具不可用产生的空 details platform_fault 噪音
DELETE FROM config_snapshots
WHERE validation_status = 'failed'
  AND validation_cause = 'platform_fault'
  AND (validation_details IS NULL OR validation_details = 'null'::jsonb);
```

结果：

- SQLite 删除 11 条 center failed；
- PostgreSQL 删除 11 条（5 条 center + 6 条 domain platform_fault）；
- 清理后仅保留 passed 版本。

## 5. 验证

### 5.1 自动化测试

```bash
.tools/go/bin/go test ./platform/modules/m09/... -count=1
.tools/go/bin/go test ./platform/modules/m09/service -run 'TestCenterRules|TestCenterSyncSettled' -count=1 -race
.tools/go/bin/go test ./platform/... -count=1
.tools/go/bin/go vet ./platform/...
```

新增/覆盖用例：

- `TestCenterRulesSyncCoalescesIdenticalFailures`：相同内容连续失败只保留一行；
- `TestCenterRulesSyncRetryActivatesFailedSnapshot`：同一行重试通过后原地激活，不新增行；
- `TestCenterRulesWatcherDoesNotSpinOnZeroFingerprint`：空规则零指纹不再每 tick 同步；
- `TestCenterRulesWatcherRetriesPlatformFaultWithoutNewRows`：平台故障重试但历史不膨胀；
- `TestCenterSyncSettled`：passed / user_config / platform_fault 的推进口径；
- `TestCenterSnapshotRetryUpdatesInPlace`：Repository 原地更新与激活；
- `TestCenterRulesSyncBackfillsCurrentPayloadWithPersistedVersion`：回填 payload 的版本一致性。

### 5.2 服务启动验证

以 PostgreSQL `metric_center_test` 启动修复后二进制，`--prometheus.url=http://127.0.0.1:1` 模拟 reload 不可用；约 70 秒后中心快照仍只有 1 条 failed（旧实现会每 30 秒新增一条）。日志可见 13:56:50 / 13:57:20 / 13:57:50 每 30 秒重试，但 DB 行数不变。

随后按生产 PATH（含 promtool / amtool / blackbox_exporter）重启 8080 服务，首次 watcher 立即生成：

```text
center:       passed 1（current）
domain:       passed 2（current）
alertmanager: passed 1（current）
```

`GET /api/v3/platform/health` 返回 200；35 秒后复查快照数量不变。

## 6. 说明与遗留

- `platform_fault` 仍按 30 秒间隔重试；本次只保证重试不会产生新历史行，未引入指数退避。若后续需要降低 reload 压力，可在 watcher 状态机中加入 `nextRetry` 退避。
- 失败快照的 `validation_status` 仍为 `failed`（SRS FR-13 要求失败版本留痕）；本次没有改变「reload 失败算失败」的契约语义，仅消除重复版本。
- 中心规则指纹仍只覆盖 `m01_monitoring_rules` 的 `updated_at` / `deleted_at`；若 `user_config` 失败的修复动作发生在 M01 Job 侧，需要规则本身再次变更才会触发重算（既有行为，本次未扩展）。
- 历史清理为本地开发库操作，未新增 migration；生产环境如需清理，建议按 checksum 去重并先备份。
