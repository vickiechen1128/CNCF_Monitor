# M09 配置与查询中心 概要设计

> **文档类型**：概要设计（High-Level Design, HLD）
> **目标读者**：后端/前端开发工程师、测试工程师、运维架构师、代码审查者
> **文档版本**：v1.0
> **状态**：reviewing
> **编写日期**：2026-11-20
> **对应模块**：Module 09 — 配置与查询中心
> **需求基线**：[M09 配置与查询中心 SRS](../02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md)
> **接口契约**：`docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md`（字段级权威）
> **关键设计专题**：
> - [PromQL 网域注入](design-notes/m09-promql-domain-injection.md)
> - [配置生成与原子发布](design-notes/m09-config-generation-and-publish.md)
> - [指标查询页交互契约](design-notes/m09-query-page-ux.md)
> **关联决策**：D23–D39；D28/D33（网域隔离）、D31（告警配置不扇出）、D35（规则中心求值）、D38（API 版本）、D39（Token 哈希）

---

## 1. 引言

### 1.1 目的

本文档描述 M09 的**架构级设计**：模块边界、接口清单、数据归属、关键流程、状态机、安全与性能约束，以及与 SRS 需求条目的追溯关系。

本文档**不展开**字段级契约、DTO、算法伪代码和页面组件细节：

- 接口字段以 `api-contract-snapshot-v3.md` 为准；
- 高风险/反直觉的实现放在 `design-notes/` 专题中；
- 代码与测试是实现细节的最终事实来源。

### 1.2 范围

覆盖五个能力域：网域纳管与接入凭据、采集节点与 edge 协议、配置生成/校验/产物历史、目标状态与覆盖率、指标查询代理与查询页。

不覆盖：M06 行政字段、M01 采集策略编辑、M07 资源台账、M08 告警配置生成与通知链路。

### 1.3 参考

- [SRS](../02-product-requirements/Modules/SRS/Module_09_Network_Domain_Access_and_Query_Center_Requirements.md)
- [API 设计标准](../03-engineering-standards/03_API_Standard.md)
- [后端架构与技术债控制](../03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md)
- [前端开发规范](../03-engineering-standards/02_Frontend_Standard.md)
- [测试标准](../03-engineering-standards/04_Testing_Standard.md)

---

## 2. 设计概述

### 2.1 系统上下文

```text
浏览器 ──HTTPS──▶ metric-center（控制面，v3-only）
                  ├─ /api/v3/platform/*   M06/M01/M07/M08/M09 业务 API
                  ├─ /api/v1/*            M09 查询代理 + 目标状态
                  └─ /api/v3/edge/*       M09 edge 协议（Token 鉴权）
                        │
           ┌────────────┴────────────┐
           ▼                         ▼
     SQLite / PostgreSQL        Prometheus（中心）
                                     ▲
                                     │ remote write
                             采集节点（各网域，Edge Sync Agent）
```

关键约束：中心节点不直接 scrape；所有采集由网域内采集节点执行；控制面与数据面独立进程。

### 2.2 组件职责

| 组件 | 代码位置 | 职责 |
|------|----------|------|
| Module 装配 | `platform/modules/m09/module.go` | 组装子服务、注册路由、启动后台循环 |
| Onboarding | `service/onboarding_service.go` | 纳管/退纳管、凭据签发/重置 |
| Edge | `service/edge_service.go` | 心跳、自动注册、在线判定、远程指令、清理 |
| Config Sync | `service/config_sync_service.go`、`config_trigger_service.go` | 生成/校验/发布配置、reload |
| Artifact | `service/artifact_service.go` | 统一产物历史、预览、导出、恢复包 |
| Query | `service/query_service.go`、`handler/query_handler.go` | targets/coverage、查询代理、网域注入 |
| Config Center | `configcenter/generator/` | 渲染 prometheus.yml / targets / rules |
| Edge Auth | `handler/edge_auth.go` | Edge Bearer Token → 网域 |
| 内容存储 | `storage/content_store.go` | 产物内容持久化 |
| 前端 | `pages/config-center/`、`pages/query/` | 网域纳管、节点、目标、指标查询、产物历史 |

### 2.3 代码结构

```text
platform/modules/m09/
├── module.go
├── domain/          # 领域对象与不变量
├── dto/             # API DTO
├── handler/         # Gin handlers + 路由 + edge 鉴权
├── service/         # 业务服务
├── repository/      # GORM 仓储
├── configcenter/generator/  # 配置渲染与校验
├── references/      # 对 M01/M07/M08 的只读引用
└── storage/         # 配置内容存储
```

### 2.4 前端信息架构

一级模块：**配置与查询中心**（`config-center`）。

| 顺序 | 二级菜单 | 路由 | 页面 | 状态 |
|------|----------|------|------|------|
| 1 | 网域纳管 | `/domain-onboarding` | `NetworkDomainsPage` | 已实现 |
| 2 | 采集节点状态 | `/node-status` | `EdgeAgentsPage` | 已实现 |
| 3 | 监控目标状态 | `/targets` | `TargetStatusPage` | 已实现 |
| 4 | 指标查询 | `/query` | `QueryPage` | 已实现（页面无网域选择器；服务端按授权网域过滤；深链入口待增量） |
| 5 | 配置产物历史 | `/config-snapshots` | `ConfigPreviewPage` | 已实现 |

---

## 3. 约束与关键决策

| 编号 | 决策/约束 | 影响 |
|------|-----------|------|
| D23 | 网域退役由 M09 承接 | M06 删除网域时级联清退 |
| D27 | edge 协议仅 Token 鉴权 | `/api/v3/edge/*` 豁免用户鉴权，由 EdgeTokenMiddleware 接管 |
| D28/D33 | 查询只注入 `network_domain_id` | 不注入 tenant；API 字段仍用 `network_domain` |
| D30 | 查询兼容面只在 v3-only 挂 `/api/v1` | 生产二进制无 legacy v2 代理 |
| D31 | 告警配置只快照留痕、不扇出 | 统一历史只读引用 M08 |
| D35 | 规则统一在中心求值 | 边缘包不含 rules.yml；中心侧 reload |
| D38 | 业务 API `/api/v3/platform/*`，查询 `/api/v1/*` | 两套前缀职责分离 |
| D39 | Token 仅存 SHA-256 | 明文只在纳管/重置返回一次 |
| L1 | v3-only | 不保留 legacy 兼容层 |
| L2 | A2 同源部署 | 前端默认相对路径；CORS 仅开发态 |
| L3 | 生产目录只读 | 活配置落 `DATA_ROOT/config-output` |

---

## 4. 接口清单

字段、错误码、分页细节以 `api-contract-snapshot-v3.md` 为准；本节只列路由、权限与用途。

### 4.1 鉴权

| 入口 | 鉴权 | 上下文 |
|------|------|--------|
| `/api/v3/platform/*` | 用户 AuthMiddleware | 用户、租户、授权网域集 |
| `/api/v3/edge/*` | EdgeTokenMiddleware | Token → 网域 |
| `/api/v1/*` | 用户 AuthMiddleware | 用户、租户、授权网域集 |
| `/api/v3/platform/webhooks/*` | 机器回调豁免 | M08 webhook 桥 |

### 4.2 平台 API

前缀 `/api/v3/platform`。

| 方法 | 路径 | 权限 | 用途 |
|------|------|------|------|
| GET | `/network-domains` | 登录 | 纳管列表 |
| GET | `/network-domains/:id` | 登录 | 纳管详情 |
| POST | `/network-domains/:id/monitor` | admin | 纳管并签发凭据 |
| DELETE | `/network-domains/:id/monitor` | admin | 退纳管 |
| POST | `/network-domains/:id/token/reset` | admin | 重置凭据 |
| POST | `/config-sync/trigger` | 登录（域）/admin（中心） | 即时触发配置同步 |
| GET | `/edge-agents`、`/edge-agents/:id` | 登录 | 节点列表/详情 |
| PUT | `/edge-agents/:id/restart`、`/flush-backlog` | admin | 远程指令 |
| GET | `/network-domains/:id/config-snapshots` | 登录 | 网域快照历史 |
| GET | `/network-domains/:id/config-snapshots/:snapshot_id/content` | admin | 快照内容 |
| GET | `/config-artifacts`、`/config-artifacts/:id` | 登录 | 统一产物列表/详情 |
| GET | `/config-artifacts/:id/content`、`/export` | admin | 预览/导出 |
| GET | `/config-artifacts/recovery-bundle` | admin | 中心恢复包 |
| GET | `/edge-packages`、`/latest`、`/:file` | 登录 | 离线包 |

### 4.3 Edge 协议

前缀 `/api/v3/edge`，`Authorization: Bearer <edge_token>`。

- `POST /heartbeat`：节点状态、组件、目标快照、积压、配置应用结果；返回 `config_changed`、下载地址、指令 seq。
- `GET /config`：返回当前网域配置 zip；`ETag` + `If-None-Match` → 304。
- 请求体中的 `network_domain_id` 忽略，网域以 Token 解析为准。

### 4.4 查询接口

前缀 `/api/v1`。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/query`、`/query_range` | 即时/区间查询 |
| GET | `/labels`、`/label/:name/values`、`/series` | 标签/序列枚举 |
| GET | `/alerts` | 告警查询（按授权网域过滤） |
| GET | `/targets` | 目标状态（平台 DTO，非原生透传） |
| GET | `/health/coverage` | 采集覆盖率（平台 DTO） |

查询代理的透传、注入与错误语义见 [PromQL 网域注入](design-notes/m09-promql-domain-injection.md)。

---

## 5. 数据设计

### 5.1 表与归属

| 表 | 作用 | Owner |
|----|------|-------|
| `network_domains` | 网域行政字段 | M06 |
| `network_domain_access` | 纳管状态、凭据哈希、回传参数 | M09 |
| `edge_agents` | 采集节点（软删） | M09 |
| `edge_heartbeats` | 心跳历史 | M09 |
| `edge_target_snapshots` | 目标最新快照 | M09 |
| `config_snapshots` | 统一配置产物（domain/center/alertmanager） | M09/M08 引用 |
| `m08_reload_logs` | 告警 reload 日志 | M08 |

字段级结构以 migration（`00005_m09_edge_platform`、`00008_m09_center_rules`、`0016_config_snapshots_merge`）和 `api-contract-snapshot-v3.md` 为准。

### 5.2 保留与生命周期

| 数据 | 策略 |
|------|------|
| 心跳历史 | 默认 7 天，后台清理 |
| 网域采集配置 / 中心规则 | 自然日 + 30 天，每天最多一份成功版本；current 始终保留 |
| 告警配置 | M08 的 20 份策略，M09 只读 |
| 目标快照 | 随资源/Job/退纳管/网域删除清理 |

配置项：`METRIC_CENTER_SNAPSHOT_RETENTION_DAYS`（默认 30）、`METRIC_CENTER_SNAPSHOT_TIMEZONE`（默认 `Asia/Shanghai`）。

### 5.3 内容存储与迁移

- 配置产物内容持久化到内容存储，不以“仅元数据”存在；内容与 version/checksum 对应。
- 0016 将三类快照合并为 `config_snapshots`（scope=domain/center/alertmanager），API/DTO 不变；迁移不可逆，Down 为空操作。
- v3-only 二进制不提供 legacy schema 兼容。

---

## 6. 关键设计

### 6.1 网域纳管与凭据

- 前置：M06 已登记、启用、在当前租户/授权范围。
- 状态：`created` → `monitored` →（退纳管）`created`；删除网域 → `retired`（终态）。
- 凭据：高熵随机串，`sha256` 后存 `token_hash`，列表只返回 masked；明文仅在纳管/重置响应返回一次。
- 重置：覆盖哈希；旧凭据立即失效。退纳管：清空凭据、停止下发；M06 删除：级联清退 + 节点标 `retired`，失败整体回滚。

### 6.2 采集节点与心跳

- 首次有效心跳按 `(domain, hostname)` upsert 注册；同网域 hostname 唯一（软删外）。
- 在线判定：90 秒容忍两次 30 秒心跳；后台每分钟扫描置 offline，并清理 7 天前心跳。
- 配置同步状态：`in_sync` / `out_of_sync`（`not_pulled` / `apply_failed`）/ `unknown` / `no_version`。
- 远程指令：`restart` / `flush-backlog` 递增 seq，节点按 seq 幂等执行；中心不主动入站。

### 6.3 配置生成、校验与原子发布

触发源：M01/M07 保存后 best-effort 即时触发（500ms 防抖、最多等 5s），30s watcher + 60s M01 对账兜底。

流程：读取源数据 → 渲染 prometheus.yml / targets / blackbox / metadata → promtool + blackbox + targets 校验 → 通过则写新版本并切换 current；失败不覆盖 current，回写 `sync_status/sync_error`。

中心规则单独生成并原子写入 + `/-/reload`；边缘包不含 rules.yml（D35）。

详细算法、失败语义与测试点见 [配置生成与原子发布](design-notes/m09-config-generation-and-publish.md)。

### 6.4 配置产物历史、预览与导出

- 统一视图聚合 `config_snapshots` 的 domain/center/alertmanager 三类；domain 行按调用者授权网域收敛，平台级产物全局可见。
- 列表支持类型、网域、日期、校验状态、版本/checksum 过滤；详情展示元数据 + 校验明细 + 文件列表。
- 预览/导出仅 admin；预览不改变 current、不触发 reload、不写回源数据。
- 导出：domain zip、center rules.yml、alertmanager.yml、中心一体化恢复包（含 manifest/checksum）。

### 6.5 目标状态与采集覆盖率

- 目标状态：读取 `edge_target_snapshots`，超过 90s 新鲜度置 `unknown`；回连 M07 补 `instance_name`（批量，避免 N+1）；支持网域/Job/健康/关键字/分页。
- 中心侧目标信息作为兼容来源保留：v3 当前不单独拉取中心 Prometheus targets（通常为空）。
- 覆盖率四态：`collecting` / `partial_collecting` / `pending_down` / `not_monitored`；以资源为粒度聚合，空资源集短路。

### 6.6 查询代理与网域注入

- 服务端解析授权网域集，向每个 selector 注入 `network_domain_id=~"..."`；不注入 tenant；任何用户不可绕过。
- `/labels`、`/series`、`/label/*` 对每个 `match[]` 注入。
- 上游 4xx 原样透传、5xx/不可达 → 502；响应体上限 8 MiB。
- 查询护栏（NFR-11）：表达式 ≤ 8 KiB、范围 ≤ 30 天、step ≥ 15s、每序列 ≤ 11000 点、上游超时 ≤ 30s；护栏命中返回 400 `bad_request` 且不触达上游，上游超时/不可达返回 502 `bad_gateway`。
- 算法、边界与测试见 [PromQL 网域注入](design-notes/m09-promql-domain-injection.md)；护栏实现见 §10.1。

### 6.7 指标查询页

- 入口：配置与查询中心 → 指标查询；页面支持 `/query?expr=<urlencoded>&from=<unix秒>&to=<unix秒>&step=<秒>&preset=<name>` URL 复现，供后续目标状态/告警/指标库深链直接复用（深链入口本次未接线，FR-22 标 partial）。
- 网域：页面**不提供网域选择器**；一次查询覆盖当前租户的全部授权网域，服务端转发前注入 `network_domain_id` 过滤，查询元信息展示 `meta.network_domains`。
- 能力：PromQL 输入 + 指标名/Job/实例辅助选择（`labelValues` 懒加载）、快捷/自定义时间范围、执行/取消、时序图（断点不连线、0 与无数据区分）、序列明细、查询元信息（时间范围/步长/序列数/耗时/覆盖网域/新鲜度）、URL 复现、预设模板。
- 实现：`query_range` + step 自动计算 + matrix 缺失点补 null + ECharts 6 按需引入；路由懒加载。
- URL、step、断点、状态与测试见 [指标查询页交互契约](design-notes/m09-query-page-ux.md)。

### 6.8 离线包

- `GET /edge-packages`、`/latest`、`/:file`；文件名白名单，防路径穿越。
- 节点版本对比在前端完成。

### 6.9 前端导航

- 一级 `config-center` label = 「配置与查询中心」。
- 二级 5 项：网域纳管 / 采集节点状态 / 监控目标状态 / 指标查询 / 配置产物历史。
- `resolveActiveModule` 将 `/query` 归属 `config-center`；`MainLayout.test.tsx` 已同步。

---

## 7. 关键流程

### 7.1 网域纳管

M06 登记 → 选择网域/填监控参数 → 校验归属、签发 Token、写 `network_domain_access(monitored)` → 返回明文 Token（一次）→ 部署节点 → 首次心跳注册上线。

### 7.2 心跳、注册与离线

节点心跳 → EdgeTokenMiddleware 解析网域 → upsert 节点 + 写心跳 + 更新网域最近心跳 → 计算配置变更/指令 seq → 返回；维护循环置 offline、清理历史。

### 7.3 配置同步

M01/M07 保存 → 防抖触发 → 渲染 → 校验 → 通过则切换 current（中心规则 reload），失败不覆盖 current → 节点心跳发现变更 → 拉取配置（ETag 未变 304）→ 应用失败回写 `config_apply_error`。

### 7.4 目标状态

解析授权网域 → 读边缘快照（中心 targets 兼容位，通常为空）→ 去重/补实例名 → 过滤/分页返回。

### 7.5 指标查询

导航/深链进入 `/query` → 解析 URL → 计算 step → `/api/v1/query_range` → 注入网域 → matrix 补 null → 图表 + 明细 + 元信息 → 缩放/改范围重新查询 → 复制 URL 复现。

### 7.6 配置产物历史与导出

筛选 → 详情（元数据/校验/文件）→ admin 预览 → admin 导出 → 控制面不可用时解压并按 promtool/amtool 校验后启动开源数据面。

---

## 8. 状态机

### 8.1 网域纳管

```text
created ──monitor──▶ monitored ──unmonitor──▶ created
   │                     │
   └──── domain deleted ─┴──▶ retired（终态）
```

### 8.2 采集节点

```text
unknown ──heartbeat──▶ online ──timeout(90s)──▶ offline
   ▲                      │                        │
   └──── heartbeat ───────┴────── heartbeat ───────┘
retired（终态：网域删除/退纳管）
```

配置同步：`no_version` / `in_sync` / `out_of_sync(not_pulled|apply_failed)` / `unknown` / `manual_override`。

### 8.3 配置产物

```text
generated → validated(passed) → current → history → pruned
                    │
                    └─ failed → 不写历史（仅回写 sync_status/日志）
```

---

## 9. 安全

| 项 | 设计 |
|----|------|
| 接入凭据 | 高熵随机；仅存 SHA-256；明文仅一次；日志不输出 |
| Edge 鉴权 | Bearer Token → 网域；请求体网域字段忽略 |
| Outbound-only | 中心不主动连接节点；指令随心跳下发 |
| 查询隔离 | 服务端解析授权网域 + 注入 `network_domain_id`；无 bypass |
| 目标隔离 | `/targets`、`/health/coverage` 按授权网域过滤 |
| 产物保护 | 预览/导出仅 admin；内容不进日志；zip 文件名清洗 |
| 上游访问 | Prometheus URL 由启动参数固定；查询只读 |
| 拒绝服务 | 响应 8 MiB；range/step/timeout/表达式长度护栏（见 §10.1） |

---

## 10. 性能与容量

### 10.1 查询护栏（已实现）

| 项 | 目标 |
|----|------|
| 最大范围 | 30 天 |
| 最小 step | 15 秒 |
| 最大点数 | 每序列 11000 |
| 超时 | ≤ 30 秒 |
| 查询长度 | ≤ 8 KiB |
| 响应体 | ≤ 8 MiB（现有） |

- 实现：`platform/modules/m09/service/query_guard.go`；`Proxy` 在注入网域前校验，护栏失败返回 400 `bad_request` 且不请求 Prometheus。
- 超限返回可执行提示（缩小时间范围 / 增大步长 / 建议步长）；上游超时或不可达返回 502 `bad_gateway`，不得导致 Prometheus/控制面不可用。

### 10.2 目标状态与覆盖率

- 禁止逐行查询时序；按网域批量回连 M07。
- 分页默认 20/50，最大 200；coverage 默认 500，最大 1000。
- 空资源集短路。

### 10.3 前端

- 目标：1000 点 × 20 序列首屏 1 秒级（压测待补）；
- 路由懒加载 ECharts；查询可取消；指标名/标签值按需懒加载（本次未做 5 分钟缓存）。

---

## 11. 可观测性与运维

| 项 | 设计 |
|----|------|
| 日志 | access log + 模块日志；凭据/内容脱敏 |
| reload | 中心规则写入后触达 Prometheus `/-/reload`；失败保留 current |
| 后台循环 | 节点维护 1m；配置 watcher 30s；M01 对账 60s |
| 健康检查 | `/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` |
| 关键配置 | `--prometheus.url`、`--config-dir`、`--edge-package-dir`、`METRIC_CENTER_SNAPSHOT_*`、`METRIC_CENTER_DB_*` |

---

## 12. 测试与验证

- 单元：`promql.go` 注入边界、查询护栏边界、edge 注册/离线/seq、配置校验/current 不覆盖、产物导出、coverage 四态、查询页 step/gap/URL/图表 option。
- 集成：纳管 → 心跳 → 配置生成 → 节点拉取 → 目标快照 → 查询；失败不覆盖 current；退纳管/删除级联；跨网域隔离；admin 预览/导出。
- E2E：SRS 场景 1~5；导出件用 `promtool check config` / `amtool check-config` 验证。
- 具体用例与命令见测试代码、`design-notes/` 及 `docs/03-engineering-standards/04_Testing_Standard.md`。

---

## 13. 需求追溯

| SRS 条目 | 设计章节 | 实现状态 |
|----------|----------|----------|
| FR-01 ~ FR-04 | §4.2、§6.1、§7.1、§8.1 | 已实现 |
| FR-05 ~ FR-09 | §4.3、§6.2、§7.2、§8.2 | 已实现 |
| FR-10 ~ FR-14 | §4.2、§5、§6.3、§6.4、§7.3、§7.6、§8.3 | 已实现 |
| FR-15 ~ FR-17 | §4.2、§6.5、§7.4 | 已实现（中心侧兼容拉取未启用） |
| FR-18 ~ FR-20 | §4.4、§6.6 | 已实现（查询护栏见 NFR-11） |
| FR-21 | §4.2、§6.8 | 已实现 |
| FR-22 | §6.7、§6.9 | 部分实现（图表/时间范围/URL/预设/辅助选择/护栏已完成；深链入口与查询历史待增量） |
| NFR-01 ~ NFR-09 | §3、§9 | 已实现（NFR-08 跨域 e2e 待 V1-1） |
| NFR-10 | §10.2 | 部分实现（代理结构满足；P95 压测待补） |
| NFR-11 | §10.1 | 已实现 |
| NFR-12 | §6.7、§10.3 | 部分实现（路由懒加载已完成；1000×20 首屏压测待补） |
| NFR-13 | §6.7、§6.9 | 部分实现（查询页文案/错误提示已可执行；全站文案检查待 V1-2） |

---

## 14. 附录

### A. 路由速查

见 §4.2、§4.3、§4.4；完整契约以 `api-contract-snapshot-v3.md` 为准。

### B. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `METRIC_CENTER_DB_DRIVER` | sqlite | sqlite/postgres |
| `METRIC_CENTER_SNAPSHOT_RETENTION_DAYS` | 30 | 配置产物保留天数 |
| `METRIC_CENTER_SNAPSHOT_TIMEZONE` | Asia/Shanghai | 日切时区 |

### C. 错误语义

| 场景 | HTTP | errorType |
|------|------|-----------|
| 参数非法 | 400 | invalid_request |
| 未登录 | 401 | unauthorized |
| 无权限 | 403 | forbidden |
| 不存在 | 404 | not_found |
| 冲突 | 409 | conflict |
| 校验失败 | 422 | bad_data / validation_failed |
| 上游不可达 | 502 | bad_gateway |

---

## 15. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-11-20 | 首版：由详细设计收敛为概要设计；字段级契约回归 `api-contract-snapshot-v3.md`，PromQL 注入/配置发布/查询页交互下沉为 3 个设计专题；删除 11 个历史 PRD，SRS 成为唯一需求基线 |
