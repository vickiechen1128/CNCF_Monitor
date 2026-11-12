# Module 09 网域接入与查询中心 — v3 重构现状评估

> **状态**：doing（B0 契约评审通过，owner 2026-11-11 确认 D27/D28 + 退纳管 MVP；进入 B1 实施）
> **分支**：`rewrite/v2.0`
> **里程碑**：v2.0-m3
> **schema_change**：breaking（新增 00005；M09 纳管字段拆为独立表；取消 management/local/default 与配置确认/回滚）
> **data_migration**：none（D7：v3 从空库 + seed 开始，不迁移旧 v2 数据）
> **API 版本**：v3（平台管理 `/api/v3/platform/*`；边缘协议 `/api/v3/edge/*`；Prometheus 兼容 `/api/v1/*`）
> **权威需求**：`docs/02-product-requirements/Modules/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md` v1.1（2026-11-11）
> **历史参考**：`Module_09_Network_Domain_and_Edge_Config_Center.md`（配置面）、`Module_11_Edge_Access_and_Agent_Delivery.md`（接入面）、`Module_02_Query_Center.md`（查询面）；冲突以新 SRS 为准
> **关联决策**：D2 / D7 / D11 / D13 / D16–D22（见 `docs/05-execution-records/rewrite/v2.0/decisions.md`）
> **更新日期**：2026-11-11

---

## 1. 结论摘要

1. **新建 `platform/modules/m09/` v3 模块**，按 `domain / dto / repository / service / handler / references / configgen / edgeproto` 分层；legacy `platform/{edge, query, configcenter, domainregistry}` 与 `platform/admin/networkdomain` 的 M09 部分冻结保留，仅服务 `/api/v2/*` 兼容窗口，不在原包上做大改。
2. **M09 v3 合并原 M09 配置面、M11 接入面、M02 查询面**：网域纳管、采集节点生命周期、配置同步（去确认化）、目标状态融合、实时指标查询，统一归本模块。
3. **取消中心直连域与下发通道分支**：所有网域均为采集节点域，统一 `agent_pull`；不再预置 `default` 管理域；中心节点所在网域也必须部署采集节点（NFR-01/NFR-02）。
4. **配置同步去确认化**：删除 `ConfigDraft` 确认/废弃、`Deployment` 重试/回滚整套流程；改为「源数据变化 → 生成 → 校验 → 原子切换为当前快照 → 保留最近 3~5 份只读历史」；生成失败不覆盖当前生效版本（FR-10/FR-12/FR-13，NFR-04/NFR-05）。
5. **纳管字段独立成表**：新增 `network_domain_access`（1:1 于 `network_domains`）承载 token/通道/运行态，**不写 `network_domains` 的 legacy 纳管列**，保持 M06 表的行政 Owner 边界（D15/D16）。Token 只存 `sha256(token)` + 脱敏值，不存明文（NFR-07）。
6. **边缘协议独立前缀与鉴权链**：`/api/v3/edge/*`（heartbeat/config）只走 Token 中间件，不挂用户 `AuthMiddleware`；平台管理面 `/api/v3/platform/*` 走用户鉴权 + 租户授权（D2/D13/NFR-03/NFR-08）。
7. **查询与目标状态单维度隔离**：`/api/v1/query*`、`/api/v1/targets`、`/api/v1/health/coverage` 在转发/融合前，服务端按当前租户解析被授权网域集（D17），**只注入 `network_domain` 一个标签匹配器**；不注入 `tenant`（写入侧数据面无此标签）。任何用户（含 `platform_admin`）无 bypass，越权或未带网域标签的数据返回空（FR-19/FR-20，NFR-08，D28）。
8. **v3 表全新建**：`network_domain_access`、`edge_agents`、`edge_heartbeats`、`edge_target_snapshots`、`domain_config_snapshots` 由新增迁移 `00005` 创建；不复用 `platform/models` 全局模型，v3-only 库中 legacy 纳管列保持空值不写。
9. **`edge-sync-agent` 同步重构**：主循环/心跳/拉取/守护拆包、协议 DTO 与中心共享版本化、注入式可测；独立 `go.mod` 不变。

预计实施量：**后端 + Agent 约 12–15 人日**（不含前端改造与 M01 v3 依赖落地）。

---

## 2. 新 SRS 与历史实现的差异矩阵

| # | 能力 | 历史实现（v2） | 新 SRS v1.0 | v3 处理 |
|---|---|---|---|---|
| 1 | 网域类型 | `management`/`edge`，中心直连域 local 下发 | 仅采集节点域，统一 `agent_pull` | 00005 不再写 management/local；M09 只对 M06 已登记 `edge` 域纳管 |
| 2 | 默认网域 | 预置 `default` 管理域 | 不预置；中心网域也须部署采集节点 | 不 seed；纳管列表从 M06 已登记域读取（D16/D22） |
| 3 | 配置变更流程 | `ConfigDraft` 确认/废弃/重新校验 + `Deployment` 回滚 | 去确认化；自动同步；不支持回滚 | 删除确认/回滚路径；改为快照原子切换 + 3~5 份只读历史 |
| 4 | Token | `network_domains.token` 明文存，`AfterFind` 派生脱敏 | 完全脱敏；明文仅单次获取；重置/废止立即生效 | 独立 `network_domain_access.token_hash`（sha256）；明文仅在签发/重置响应中返回一次 |
| 5 | 下发通道 | `local`（中心写盘 reload）与 `agent_pull` 双轨 | 统一 `agent_pull` | v3 只产生 `agent_pull`；不提供 local 写盘/reload |
| 6 | 采集节点 | `edge_agents` 表存在但逻辑分散在 `platform/edge` | 自动注册、在线/离线、组件/crash-loop、远程指令 | v3 新表 + service 收敛；seq 指令幂等（沿用 F-42/F-43 机制） |
| 7 | 目标状态 | `/api/v1/targets` 融合中心 + 边缘快照，但无租户隔离 | 融合 + 按授权网域过滤 | 服务端按租户解析授权网域集，注入 `network_domain` 过滤（单维度，D28）；无 bypass |
| 8 | 指标查询 | `/api/v1/query*` 裸透传，`tenantAuthorizedDomains` 空实现 | 代理 + 注入隔离 + meta envelope | 重写代理层；只注入 `network_domain` 标签匹配器；返回 `meta{data_source,freshness_at,network_domains}` |
| 9 | 告警配置 | M09 生成 `alertmanager.yml` 并下发中心与边缘 | M08 生成，M09 仅快照与分发，不扇出边缘 | M08 通过端口写入快照；M09 不参与生成（D-M09-09） |
| 10 | 规则 | 中心求值、边缘不注入 rules | 同左（由 M01/M08 决定） | M09 配置包按域扇出时，中心域保留 rules，边缘域空 rules（沿用既有口径，固化到契约） |
| 11 | 心跳保留 | 无统一清理 | 保留 7 天，自动清理 | 后台 worker 按可配置保留期清理；快照随删除同步清理（NFR-06） |
| 12 | 离线包 | `release_meta.json` + 流式下载，未打包返回空数组 | 版本清单 + sha256 + 下载 + 节点版本差异 | 保留实现，迁入 m09 并补版本差异字段 |
| 13 | 采集覆盖率 | `/api/v1/health/coverage` 三态 | 同左，供 M07 消费 | 保留，注入授权网域过滤 |

---

## 3. 现状盘点（legacy 基线）

### 3.1 代码规模与质量热点

| 包 | 文件数 | 约行数 | 主要问题 | v3 处理 |
|---|---|---|---|---|
| `platform/configcenter` | 42 | ~13,000 | `draft/service.go` 1103 行上帝文件；反向依赖 `deployment`/`generator`；包含确认/回滚逻辑（与新 SRS 冲突） | 冻结；纯生成逻辑迁入 `m09/configgen`；删除 draft/change/deployment 调用链 |
| `platform/edge` | 18 | ~4,600 | 业务在 handler；`heartbeat_service` 反向依赖 `draft`；`edge_test.go` 1183 行集成测试 | 冻结；逻辑重写进 m09 |
| `platform/query` | 15 | ~5,150 | `targets.go` 352 行单 handler 完成拉取+归一+回落；`alerts.go` 租户授权空实现 | 冻结；重写进 m09 并补隔离 |
| `platform/admin/networkdomain` | 26 | ~2,800 | 网域行政 + 纳管字段混杂；`create.go` 354 行全在 handler | M06 v3 已重写行政部分；M09 纳管部分迁入 m09 |
| `platform/edge-sync-agent` | 34 | ~6,500 | 主循环/心跳/拉取/守护经全局状态串联；`supervisor.go` 405 行、`probe.go` 455 行 | 拆包重构；协议 DTO 共享 |
| `platform/domainregistry` | 2 | 129 | alertmanager 网域名助手 | 评估是否迁入 m09 或保留 |

上帝文件：`configcenter/generator/generator_test.go`(1587)、`draft/draft_test.go`(1269)、`edge/edge_test.go`(1183)、`configcenter/draft/service.go`(1103)、`edge/management_test.go`(1008)。

### 3.2 v3 当前基线（必须切断的假设）

- `v3.go` `mountV3Modules` 只注册 `system/m06/m07/auth`，**M09 完全缺席**（[v3.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/cmd/metric-center/v3.go#L102-L138)）。
- v3-only 模式（`METRIC_CENTER_DB_MODE=v3`）不建 `edge_agents`/`edge_heartbeats`/`edge_target_snapshots`/配置相关表，也不启动 legacy 后台任务。
- `00000` baseline 的 `network_domains` 仍含 `channel`/`token`/`agent_type`/`remote_write_url`/`monitored_status`/`last_heartbeat`/`agent_version`/`is_monitored`/`registration_status` 等 legacy 纳管列（[00000_m00_platform_core.sqlite.sql](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/db/migrations/v3/00000_m00_platform_core.sqlite.sql#L24-L57)），M06 `00004` 已清空其值但列仍在；**v3 M09 不写这些列**。
- 旧 `platform/models.NetworkDomain.Token` 为明文列（`json:"-"`），`AfterFind` 派生脱敏；v3 改为独立表存哈希。
- 查询侧 `tenantAuthorizedDomains` 恒返回 nil（[query/alerts.go](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/query/alerts.go#L144-L146)），即当前无租户隔离。

### 3.3 legacy 路由清单（v3 对照基线）

| 前缀 | 路由 | v3 去向 |
|---|---|---|
| `/api/v2/platform` | `/network-domains`、`/{id}/monitor`、`/{id}/reset-token` | 迁入 m09 平台管理面 |
| `/api/v2/platform` | `/config/drafts`、`/config-drafts*`、`/confirm`、`/revalidate`、`/discard` | **删除**（去确认化） |
| `/api/v2/platform` | `/config-versions*`、`/deployments*`、`/rollback` | **删除**；历史只读迁入 `/config-snapshots` |
| `/api/v2/platform/edge` | `/heartbeat`、`/config` | 迁入 `/api/v3/edge/*` |
| `/api/v1` | `/targets`、`/health/coverage`、`/query*`、`/labels*`、`/series`、`/alerts*` | 保留前缀，重写隔离与 envelope |

---

## 4. v3 目标架构

### 4.1 模块目录

```text
platform/modules/m09/
├── module.go                     # 组装 + Name + RegisterRoutes（注册两个组：platform + edge）
├── domain/
│   ├── access.go                 # 网域纳管实体 / 状态机 / Token 规则 / typed error
│   ├── edge_agent.go             # 采集节点实体 / 状态 / 组件 / crash-loop
│   ├── heartbeat.go              # 心跳 DTO 域校验
│   ├── config_snapshot.go        # 配置快照 / 校验状态 / 当前版切换规则
│   ├── target.go                 # 目标融合 / 三态覆盖率
│   └── errors.go                 # apierror.Coded 领域错误
├── dto/
│   ├── access.go                 # 纳管请求/响应、Token 视图
│   ├── edge_agent.go             # 节点列表/详情/指令请求
│   ├── config_snapshot.go        # 快照列表/详情
│   ├── target.go                 # targets 融合 / coverage
│   ├── query.go                  # 查询请求/响应 + meta envelope
│   └── edgeproto.go              # 与 agent 共享的心跳/配置协议 DTO（版本号 v1）
├── repository/
│   ├── access_repository.go      # network_domain_access
│   ├── edge_agent_repository.go
│   ├── heartbeat_repository.go
│   ├── target_snapshot_repository.go
│   └── config_snapshot_repository.go
├── service/
│   ├── access_service.go         # 纳管 / Token 签发重置废止 / 级联清退（实现 MonitoringRetirer）
│   ├── heartbeat_service.go      # 心跳接收 / 自动注册 / 状态机 / 快照写入 / seq 指令
│   ├── config_sync_service.go    # 源变更轮询 / 生成 / 校验 / 原子切换 / 历史保留
│   ├── target_service.go         # 中心+边缘融合 / 授权过滤
│   ├── coverage_service.go       # 采集覆盖率三态
│   ├── query_service.go          # PromQL 代理 / 标签注入 / envelope
│   ├── offline_detector.go       # 心跳超时 → offline/unknown
│   ├── retention_worker.go       # 心跳 7 天清理 / 快照同步清理
│   └── package_service.go        # 离线包清单 / sha256 / 下载
├── handler/
│   ├── routes.go                 # platform 组 + edge 组
│   ├── access_handler.go
│   ├── edge_agent_handler.go
│   ├── config_snapshot_handler.go
│   ├── edge_proto_handler.go     # heartbeat / config（Token 中间件）
│   ├── target_handler.go
│   ├── coverage_handler.go
│   ├── query_handler.go
│   └── package_handler.go
├── references/                   # 对 m01/m06/m07/m08 的只读端口适配（接口在本包，实现注入）
│   ├── m06.go                    # 网域存在/启用/授权读取
│   ├── m01.go                    # ScrapeJob / Rule 源数据端口（M01 v3 落地后替换）
│   ├── m07.go                    # 资源 / 标签模板只读
│   └── m08.go                    # alertmanager.yml 内容注入端口
├── configgen/                    # 从 configcenter/generator 迁入的纯生成逻辑（无 DB 副作用）
└── edgeproto/                    # 协议版本常量与兼容判断（与 agent internal/contract 对齐）
```

### 4.2 模块注册顺序

调整 `mountV3Modules` 为 `system → m06 → m07 → m09 → auth`：

1. 先构造 `m09.NewModule(db, ...)`；
2. 把 m09 的 `MonitoringRetirer` 实现注入 `m06.Options.Monitoring`（落地 D19，替换当前 no-op）；
3. 再注册 m06、m09。

m09 同时挂载两个路由组：`platform`（用户鉴权）与 `edge`（Token 中间件，不挂用户 AuthMiddleware，需在 `setupV3Router` 为 `/api/v3/edge` 单独建组）。

### 4.3 v3 路由总览

| 面 | 前缀 | 鉴权 | 主要资源 |
|---|---|---|---|
| 平台管理 | `/api/v3/platform` | 用户 AuthMiddleware + 租户授权；写操作 admin | 网域纳管、采集节点、配置快照、离线包 |
| 边缘协议 | `/api/v3/edge` | EdgeTokenMiddleware（仅域 Token） | `POST /heartbeat`、`GET /config` |
| Prometheus 兼容 | `/api/v1` | 用户 AuthMiddleware + 注入隔离 | `targets`、`health/coverage`、`query`、`query_range`、`labels`、`label/:name/values`、`series`、`alerts*` |

> `/api/v1` 前缀与 `/api/v3/platform` 并存：Prometheus 原生查询路径保持兼容（D2 允许代理接口保留原生路径），但必须经认证与隔离，禁止裸透传（api-standard §2/§6）。

---

## 5. Schema 迁移方案（00005）

### 5.1 为什么新增、不修改 00000/00004

`00000` 与 `00004` 已记录 checksum，修改会导致已应用库启动 `checksum mismatch`（D12）。M09 新增表与索引全部放入 `00005_m09_edge_platform.{sqlite,postgres}.sql`，成对提供 Up/Down。

### 5.2 Up 内容（新建表，不写 network_domains 纳管列）

1. **`network_domain_access`**（1:1 于 `network_domains`）
   - `domain_id TEXT PRIMARY KEY REFERENCES network_domains(id) ON DELETE CASCADE`
   - `token_hash TEXT NOT NULL`（sha256 hex）、`token_masked TEXT`、`token_created_at TIMESTAMP`
   - `remote_write_url TEXT`、`center_endpoint TEXT`、`max_disk_usage_per_url TEXT`
   - `registration_status TEXT NOT NULL DEFAULT 'created'`（`created`/`monitored`/`retired`）
   - `monitored_at TIMESTAMP`、`last_heartbeat_at TIMESTAMP`、`last_config_version TEXT`
   - `created_at`/`updated_at`
2. **`edge_agents`**：`id BIGSERIAL/INTEGER PK`、`network_domain_id`（索引+FK）、`hostname`（域内唯一索引 `(network_domain_id, hostname)`）、`agent_type`、`version`、`ip`、`status`、`last_heartbeat_at`、`heartbeat_rtt_ms`、`last_config_pull_at`、`config_version`、`config_sync_status`、`out_of_sync_cause`、`config_apply_error`、`config_apply_failed_version`、`collector_status`、`collector_version`、`queue_backlog_bytes`、`remote_write_dropped_total`、`remote_write_retries_total`、`remote_write_last_error`、`metadata_remote_write_url`、`metadata_max_disk_usage_per_url`、`vm_agent_restart_seq`、`restart_requested_by/at`、`flush_backlog_seq`、`flush_requested_by/at`、`components JSON`、`last_error`、`created_at`/`updated_at`/`deleted_at`（软删）。
3. **`edge_heartbeats`**：`id`、`network_domain_id`+`timestamp` 复合索引、`edge_agent_id`（索引）、`agent_type`、`version`、`config_version`、`queue_backlog_bytes`、`remote_write_queue_size`、`remote_write_dropped_total`、`remote_write_retries_total`、`remote_write_last_error`、`hostname`、`ip`、`components JSON`、`timestamp`、`created_at`。索引 `idx_edge_heartbeats_domain_timestamp(domain_id, timestamp)`。
4. **`edge_target_snapshots`**：`id`、`network_domain_id`+`job`+`instance` 唯一索引（含 `edge_agent_id`）、`resource_id`、`health`、`last_scrape`、`last_error`、`scrape_duration_seconds`、`last_report_at`（索引）。硬删覆盖更新（沿用 F-11 口径）。
5. **`domain_config_snapshots`**：`id`、`network_domain_id`（索引）、`version TEXT`、`checksum TEXT`、`content_type TEXT`（`full`/`patch`）、`validation_status`（`passed`/`failed`）、`validation_cause`（`user_config`/`platform_fault`/`none`）、`validation_details JSON`、`is_current BOOLEAN`、`generated_by`、`created_at`。每域仅一行 `is_current=true`（部分唯一索引）；保留最近 3~5 份。
6. **索引**：见上；`edge_agents` 软删索引；`edge_target_snapshots.last_report_at` 索引支撑过期降级。

### 5.3 Down 内容

- 按建表逆序 `DROP TABLE`：`domain_config_snapshots` → `edge_target_snapshots` → `edge_heartbeats` → `edge_agents` → `network_domain_access`。
- 不修改 `network_domains`；Down 后 v3 库回到无 M09 表状态，M06 行政数据完好。

### 5.4 数据迁移

- **不迁移旧 v2 数据**（D7）。v3 从空库 + `seed.CoreV3` 开始；旧库仅在 legacy 模式保留回退。
- 若上线时需保留存量网域行政数据，由 M06 迁移链路负责（已完成 00004 归一）；M09 纳管字段、节点、心跳、快照均视为 v3 全新数据，不回填。

---

## 6. 跨模块边界

### 6.1 M06（网域行政 Owner）

- M09 只消费 M06 已登记且 `status=enabled`、`domain_type=edge` 的网域；**不创建/编辑行政字段**（D15/D18/D22）。
- 删除网域的级联清退：m09 实现 `references.MonitoringRetirer.RetireDomain(ctx, tx, domainID)`：
  - 废止 Token（删 `network_domain_access` 行或置 `retired`）；
  - 该域 `edge_agents` 标 `retired`（软删）；
  - 清理 `edge_target_snapshots`；
  - 返回 `RetireResult{ManagedAgentCount, WillRetireAgents(≤10), MonitoringAvailable=true}`；
  - 幂等可重试（D19）。
- M09 注入到 `m06.Options.Monitoring` 后，M06 删除响应的 `monitoring_available` 变为 true，不再是 no-op。

### 6.2 M07（监控对象台账）

- M09 只读消费 M07 资源与标签模板，生成 targets 与标签；不修改 M07 源数据。
- `references.M07` 提供：资源清单（按域）、标签模板、资源删除事件（用于快照清理）。
- `/api/v1/health/coverage` 的三态由 M09 计算，供 M07 资源列表 badge 消费（FR-16）。

### 6.3 M01（采集策略与规则）

- M09 监听 M01 `ScrapeJob` / `Rule` 数据变化（通过源数据版本/`updated_at` 轮询），按域生成配置包（FR-10）。
- `references.M01` 端口：`ScrapeJobSource` / `RuleSource`，**当前适配 legacy `platform/models` 实现**；M01 v3 落地后替换实现，m09 契约不变。
- M01 只展示 `synced/syncing/failed`，不主动通知 M09（pull 模式，沿用 30s 轮询决策）。

### 6.4 M08（告警收敛）

- M08 是 `alertmanager.yml` 内容 Owner + 中心即时 reload（D-M09-09）。
- M09 提供端口：`AlertmanagerSnapshotSink`，M08 写入 `alertmanager.yml` 内容 → M09 落入 `domain_config_snapshots`（仅中心管理域语义在新架构下不再存在；按「中心所在网域」的当前域快照留存）。
- M09 不向边缘域扇出 `alertmanager.yml`；边缘配置包不含 alertmanager 段。

### 6.5 M03（认证）

- 用户鉴权继续由 `platform/gateway/auth` 适配器提供（D14）。
- 边缘协议 `/api/v3/edge/*` 不使用用户会话，使用网域 Token（`network_domain_access.token_hash` 校验）；Token 失效 → 401，节点自然离线。

---

## 7. 测试与验收矩阵

### 7.1 目标测试

| 层 | 范围 | 命令 |
|---|---|---|
| 迁移 | 00005 Up/Down/重复执行、FK、唯一索引、部分唯一索引 | `go test ./platform/db/...` |
| 单元 | domain/service 纯逻辑 + fake repository | `go test ./platform/modules/m09/...` |
| HTTP | 路由、鉴权、分页、字段不可变、错误码、golden | `go test ./platform/modules/m09/...` |
| 协议 | 心跳自动注册、seq 幂等、Token 失效、304 配置拉取 | `go test ./platform/modules/m09/...` |
| 配置同步 | 生成→校验→原子切换、失败不覆盖、历史保留 3~5 | `go test ./platform/modules/m09/...` |
| 查询隔离 | 越权返回空、标签注入、envelope meta | `go test ./platform/modules/m09/...` + e2e |
| v3 集成 | 纳管 → 心跳上线 → 配置同步 → targets/query | `go test ./platform/cmd/metric-center/...` |
| Agent | 主循环/心跳/拉取/守护单测（注入式） | `cd platform/edge-sync-agent && go test ./...` |
| 全局门禁 | 全量 + vet | `make test-platform`、`go vet ./platform/...` |

### 7.2 SRS 验收映射

| SRS 条目 | 验证方式 | 任务 | 证据 |
|---|---|---|---|
| FR-01~04 网域纳管 / Token 生命周期 / 安装指引 / 状态机 | handler + domain 单测 | B3 | `TestAccessLifecycle`、`TestTokenResetInvalidatesOld` |
| FR-05~09 节点注册 / 在线判定 / 配置同步状态 / 组件 / 远程指令 | 协议 + service 单测 | B4 | `TestHeartbeatAutoRegister`、`TestSeqCommandIdempotent` |
| FR-10~14 自动生成 / 拉取 / 校验 / 历史 / M08 同步 | 配置同步单测 + e2e | B5 | `TestConfigSyncAtomicSwitch`、`TestFailureKeepsCurrent` |
| FR-15~17 targets 融合 / 覆盖率 / 筛选 | target + coverage 单测 | B6 | `TestTargetsFusionAndFilter`、`TestCoverageThreeStates` |
| FR-18~20 查询代理 / envelope / 隔离 | query 单测 + 越权 e2e | B6 | `TestQueryInjectsTenantDomain`、`TestQueryNoBypass` |
| FR-21 离线包版本管理 | package 单测 | B7 | `TestPackageListEmptyWhenUnbuilt` |
| NFR-01/02 中心不采集 / 统一 agent_pull | grep + 迁移约束 | B1/B3 | 契约快照无 local/management |
| NFR-03 outbound-only | 协议层无入站连接代码审查 | B4/V1 | 安全审查 |
| NFR-04/05 原子性 / 历史只读 | 单测 + 无回滚端点 | B5 | 无 rollback 路由 |
| NFR-06 心跳/快照清理 | retention worker 单测 | B4 | `TestHeartbeatRetentionCleanup` |
| NFR-07 Token 安全 | 不存明文 / 日志 grep / 重置失效 | B3 | `TestTokenNotStoredPlaintext` |
| NFR-08 数据隔离 | 越权 targets/query 返回空 | B6/V1 | `TestCrossDomainInvisible` |
| NFR-09 查询性能 | 附加开销 P95 ≤50ms 手工测量 | B6/V1 | 性能记录（open） |
| NFR-10/11 业务语言 / 可执行错误 | 文案 grep + 错误文案审查 | B6/V1 | 契约快照 + golden |

---

## 8. 风险与待决

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | M01 v3 未启动，源数据契约不稳定 | M09 生成逻辑可能返工 | `references.M01` 端口隔离；先适配 legacy models，M01 v3 落地后替换实现，m09 契约冻结 |
| R2 | 查询隔离为标签注入，非物理隔离；`tenant` 标签在数据面不存在 | 若误注入 `tenant` 匹配器会导致全量查询返回空；网域标签缺失的数据会被过滤为不可见（保守但正确） | 已确认 D28 单维度口径：只注入 `network_domain`，服务端按租户解析授权网域集（D17）；`network_domain_id` 由 M09 生成器写入 external_labels（决策 19），不依赖 M01/M07 打标；安全审查前置验证 |
| R3 | PG 迁移执行器 `?` 占位符问题（m06 评估已记录 open） | 00005 PG 路径未实测 | 沿用 `METRIC_CENTER_TEST_POSTGRES_DSN` 门禁；修完执行器前不得宣称 PG 通过 |
| R4 | 边缘协议前缀 `/api/v3/edge/*` 与旧 agent 不兼容 | 旧 agent 连 `/api/v2/platform/edge/*` 无法工作 | 已确认采用（owner 2026-11-11）；agent 重构同步适配协议 v1；旧 agent 仅在 legacy 模式可用 |
| R5 | v3-only 与 legacy 双模式并存期间口径漂移 | 同一网域在两种模式下状态不一致 | 明确切流时点：v3 验收通过后 `METRIC_CENTER_DB_MODE=v3` 全量切换，legacy 冻结 |
| R6 | 去确认化后错误配置直接上线 | 监控断点或误告警 | 生成期强校验（promtool/blackbox/targets）；失败不覆盖当前版本；保留历史用于定位 |
| R7 | 旧 `platform/models` 全局模型被多包引用 | m09 不复用但 legacy 仍依赖，双轨维护 | v3-only 模式不加载 legacy 包；m09 自有 domain 模型；legacy 冻结不新增 |
| R8 | M08 alertmanager 边界未在新 PRD 固化 | 双方职责争议 | B0 评审登记 D-M09-09；M08 调用 m09 端口，接口契约单独约定 |

### 建议决策（B0 评审后落入 decisions.md，编号 D23 起）

| # | 决策 | 结论 |
|---|---|---|
| D23 | M09 v3 模块归属 | 新建 `platform/modules/m09/`；legacy `platform/{edge,query,configcenter,domainregistry}` 与 admin/networkdomain 纳管部分冻结，只服务 v2 兼容窗口 |
| D24 | 纳管字段归属 | 新增 `network_domain_access` 1:1 表承载 M09 纳管/运行态字段；v3 不写 `network_domains` 的 legacy 纳管列 |
| D25 | 配置同步去确认化 | 删除 ConfigDraft 确认/废弃、Deployment 重试/回滚；改为快照原子切换 + 最近 3~5 份只读历史，不支持回滚 |
| D26 | 通道与网域类型 | v3 只产生 `agent_pull`；不出现 `management`/`local`/`default`；中心网域也须部署采集节点 |
| D27 | 边缘协议 | 前缀 `/api/v3/edge/*`；仅 Token 鉴权，不挂用户 AuthMiddleware；协议版本 v1，与 agent `internal/contract` 共享 DTO |
| D28 | 查询隔离（单维度） | `/api/v1/*` 代理与 targets/coverage 服务端按租户解析授权网域集（D17），只注入 `network_domain` 一个标签匹配器；不注入 `tenant`（数据面无此标签）；无 bypass；越权/未打标数据返回空。与 SRS NFR-08「双重」措辞冲突，以此为准，PRD 由 owner 回填 |
| D29 | Token 存储 | 只存 `sha256(token)` + 脱敏值；明文仅在签发/重置响应返回一次；重置/废止立即生效 |
| D30 | 清理策略 | 心跳历史保留 7 天（可配）自动清理；target 快照在资源删除/Job 清空/退纳管/域删除时同步清理 |
| D31 | M08 边界 | `alertmanager.yml` 由 M08 生成，M09 仅快照留存与（中心域）分发，不扇出边缘 |

### 已确认（进入 B1 前，需用户评审）

- [x] 重构范围：后端 m09 + edge-sync-agent；前端本次不进入实施（契约覆盖前端所需字段）。
- [x] 数据迁移：不迁移旧 v2 数据，v3 空库重建（D7）。
- [x] 推进方式：先产出 assessment + v3 契约快照评审，过 G2 后再写代码。
- [x] D23–D31 决策口径（owner 2026-11-11 评审通过）。
- [x] 边缘协议前缀 `/api/v3/edge/*`（D27，owner 确认）。
- [x] 查询隔离采用单维度 `network_domain`（D28 方案 A，owner 确认）；不依赖 M01/M07 写入侧打 `tenant` 标签（R2 已关闭）。

---

## 9. 验证命令

```bash
# 单模块（开发期）
GOPROXY=off .tools/go/bin/go test ./platform/modules/m09/...
GOPROXY=off .tools/go/bin/go vet ./platform/modules/m09/...

# 迁移（本地 SQLite）
GOPROXY=off .tools/go/bin/go run ./platform/cmd/migrate -driver sqlite -dsn /tmp/mc-v3.db up
GOPROXY=off .tools/go/bin/go run ./platform/cmd/migrate -driver sqlite -dsn /tmp/mc-v3.db down

# 阶段门禁
GOPROXY=off .tools/go/bin/go vet ./platform/...
GOPROXY=off make test-platform

# Agent
cd platform/edge-sync-agent && GOPROXY=off ../../.tools/go/bin/go test ./...

# v3-only 冒烟
METRIC_CENTER_DB_DSN=/tmp/mc-v3.db \
  ./platform/cmd/metric-center/metric-center --database.mode=v3 --listen-address=:18080
```

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-11 | 初稿：基于 M09 SRS v1.0 完成现状评估、差异矩阵、00005 schema 方案、跨模块边界、决策 D23–D31 提案与验收矩阵 |
