# M09 配置同步扇出 P0 优化（执行记录）

> 日期：2026-11-17
> 关联模块：Module 09 网域接入与查询中心（v3 重写线 `rewrite/v2.0`）
> 背景：M01 采纳「Job 组 + 对象优先动线」（多域只存在于意图层，下发层仍为单域 Job），
> 组会把 Job 数放大 N 倍。为避免同步链路成为瓶颈，先做扇出 P0 三项优化。
> 需求文档：[Module_01_Job_Group_and_Object_First_SRS.md](../../../02-product-requirements/Modules/SRS/Module_01_Job_Group_and_Object_First_SRS.md)（增量 SRS v1.0，待 PRD owner 合并）

---

## 1. 做了什么（三项，均为内部实现，**不改 API 契约、不改 DB schema**）

| # | 问题 | 改动 | 落点 |
|---|---|---|---|
| P0-1 | 逐域**串行**同步：一次全局变更（含探测模块变更）会让所有域同时变脏，队尾域要等前面每个域「生成 + promtool/blackbox 校验」跑完 | `watchOnce` 改为**有界并发**（`DefaultSyncWorkers = 4`），`last` 指纹表加 mutex 保护；每域仍有独立 `domainLock`，跨域并发安全 | [config_sync_service.go](../../../platform/modules/m09/service/config_sync_service.go) |
| P0-2 | `BuildSource` 的 **N+1 查询**：每个 Job 一次 `resources.GetMany`；每域再查 2 次端口映射表 | 先收集全部 Job 的实例并集 → **一次 `IN` 查询**；端口映射按 **30s TTL 缓存**（与 watcher 同频，管理员改映射次 tick 生效） | [source_reader.go](../../../platform/modules/m09/references/source_reader.go) |
| P0-3 | 同步状态**逐 Job UPDATE**：域内 100 个 Job 就是 100 条写语句 | 按「错误消息」分组**批量 UPDATE**（成功组 1 条 + 每个不同错误消息 1 条），`updated_at` 过滤与「新编辑保留 pending」语义不变 | [sync_sink.go](../../../platform/modules/m01/references/sync_sink.go) |

### 效果量级（代码推导 + 测试断言）

| 场景 | 改前 | 改后 |
|---|---|---|
| N 域各有变化，单域成本 T | 总时长 ≈ N × T | ≈ ceil(N / 4) × T |
| 单域 J 个 Job 构建一次 | J 次资源查询 + 2 次端口查询 | 1 次资源查询（+ 端口命中缓存时 0 次） |
| 一次同步回写 J 个 Job（同一条结论） | J 条 UPDATE | 1~2 条 UPDATE |

---

## 2. 测试（TDD，先红后绿）

| 测试 | 断言 | 位置 |
|---|---|---|
| `TestRunWatcherSyncsDomainsConcurrentlyWithBound` | 8 个域：恰好 4 个并发进入构建，第 5 个被挡；放开后 8 个全部完成（不丢域） | `platform/modules/m09/service/config_sync_service_test.go` |
| `TestSourceReaderFansOutWithoutQueryAmplification` | 4 个 Job 的域：`resource_id IN` 只 1 次；第二次构建端口映射表 0 次（命中缓存） | `platform/modules/m09/references/source_reader_test.go` |
| `TestSyncSinkBatchesUpdatesPerMessage` | 5 个 Job（3 成功 + 2 同一失败原因）→ 只有 2 条 UPDATE | `platform/modules/m01/references/sync_sink_test.go` |

> 计数方式：给 GORM 挂自定义 `logger.Interface`，在 `Trace` 里按 SQL 片段统计，避免依赖 SQL 文本格式。

---

## 3. 验证

| 项 | 命令 | 结果 |
|---|---|---|
| 目标包测试 | `go test ./platform/modules/m09/... ./platform/modules/m01/references/...` | 通过（新增 3 例） |
| 全量后端 | `GOCACHE=/tmp/mc-go-cache go test ./platform/...` | 通过（exit 0） |
| 静态检查 | `go vet ./platform/modules/m09/... ./platform/modules/m01/references/...` | 通过 |
| 格式 | `gofmt -l`（改动目录） | 无输出 |

> 说明：本机沙箱不允许写 `~/Library/Caches/go-build`，测试统一用 `GOCACHE=/tmp/mc-go-cache`，与代码无关。

---

## 4. 未纳入本轮（P1/P2，已登记）

| 优先级 | 事项 | 说明 |
|---|---|---|
| P1 | 全局变更（探测模块）避免 N 次外部校验 | 现在每个域都会跑一次 promtool/blackbox；可按产物分片（blackbox.yml 单独校验一次）或复用渲染结果 |
| P1 | 回写不应推进 `updated_at` | `sync_*` 回写会 bump `updated_at` → 指纹前进 → 下次 tick 多做一次「生成 + checksum 比对」（无新快照）。可在批量 UPDATE 里以 `updated_at = updated_at` 抑制，语义上更准确（回写不是用户编辑） |
| P1 | 编辑去抖 | 30s 轮询下连续两次编辑可能跨两个 tick 各生成一次；可加 1 tick 稳定窗口合并 |
| P2 | 前端聚合 N 请求 | 合并后的「配置快照」页按域扇出；建议后端提供全局快照列表端点 |
| P2 | targets 增量写 / 渲染结果跨域复用 | 当前每域全量渲染并整文件重写 |

---

## 5. 关联变更

- 同轮新增 M01 增量 SRS：[Module_01_Job_Group_and_Object_First_SRS.md](../../../02-product-requirements/Modules/SRS/Module_01_Job_Group_and_Object_First_SRS.md)
  - 定义「Job 组」= 一张监控意图 + N 条单域子 Job；组级状态派生不落库；
  - 明确 `job_name` 唯一性口径由「全局唯一」改为「同域唯一」（M09 生成与看板受益）；
  - 本记录的三项优化是其实施前置条件（§11 风险表）。
