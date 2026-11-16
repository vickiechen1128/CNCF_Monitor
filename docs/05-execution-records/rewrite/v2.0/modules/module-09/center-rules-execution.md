# M09 v3 中心规则同步执行记录

> **分支**：`rewrite/v2.0`
> **范围**：`00008_m09_center_rules` + 中心规则生成/reload + M01 写回
> **状态**：完成（2026-11-16）
> **关联**：M01 `task-sequence.yaml` T01-B4-2 / T01-B5-2 / T01-B5-3

---

## 1. 变更清单

| 产物 | 说明 |
|---|---|
| `platform/db/migrations/v3/00008_m09_center_rules.{sqlite,postgres}.sql` | `center_config_snapshots`：版本唯一、单 current、校验状态/归因；Down 可回滚 |
| `platform/modules/m09/repository/center_snapshot_repository.go` | 中心快照 Insert / InsertAndActivate / CurrentPassed / List |
| `platform/modules/m09/configgen/configgen.go` | `GenerateCenterRules`：`centerEvaluator=true`，生成中心 `rules.yml` |
| `platform/modules/m09/references/center_rules.go` | 只读 `m01_monitoring_rules`（enabled+ready）+ 指纹（含软删） |
| `platform/modules/m09/service/center_rules_service.go` | 生成/校验/原子写 `rules.yml` + reload + `RecordRuleSync`；30s watcher |
| `platform/modules/m09/module.go` | 服务装配与 `StartBackground` watcher |
| 测试 | 00008 migration、configgen center、center service（发布/幂等/reload 失败） |

---

## 2. 流程

```text
m01_monitoring_rules (enabled+ready)
        │  CenterRuleSource
        ▼
GenerateCenterRules → artifacts.RulesYML
        │  configgen.Validate
        ▼
passed ──► 写 <config.dir>/rules.yml（temp+rename）
        ──► POST <prometheus.url>/-/reload
        ──► InsertAndActivate center_config_snapshots
        ──► SyncResultSink.RecordRuleSync（M01 sync_*）
failed ──► Insert failed snapshot（不切换 current）
        ──► RecordRuleSync(error)
```

- watcher 每 30s 比较 M01 规则指纹（`updated_at` / `deleted_at`），变化才同步。
- 校验失败或 reload 失败不覆盖当前中心规则；下一次 watcher 重试。
- 边缘域配置包仍不含 `rules.yml`（D35）。

---

## 3. 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/db/... ./platform/modules/m09/... ./platform/modules/m01/...
ok .../platform/db
ok .../platform/modules/m09/configgen
ok .../platform/modules/m09/references
ok .../platform/modules/m09/service
ok .../platform/modules/m01/...

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 实测（端口 18085，假 Prometheus 19090）：

```text
POST /monitoring-rules              -> sync=pending
中心 watcher 约 20s                  -> sync=synced, version=20261116-609a
<config.dir>/rules.yml              -> groups[host] HostDown
center_config_snapshots             -> passed, is_current=1
```

---

## 4. 偏差与遗留

1. **`rules.yml` 写入 `--config.dir`**：与 legacy local 通道共用目录；v3-only 模式下由中心 Prometheus 读取。
2. **reload 失败即失败**：文件已写但 reload 失败时快照为 `platform_fault`、不切换 current；下一轮重试。
3. **无中心快照保留策略**：当前仅保留全部记录；后续按需补类似 per-domain 的 5 份保留。
4. **PostgreSQL 未实跑**：00008 postgres 与 sqlite 同构，待 R3 环境验证。
