# Module 09: 网域与边缘配置中心

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.2
> **产品版本覆盖**: MVP / v0.2 / v1.0
> **原型版本**: v1.2
> **更新日期**: 2026-08-03
> **对应原型**: `docs/prototypes/module-09/`

> **模块类型**: 核心能力模块（v0.2+）
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)
> **目标用户**: 运维架构师、运维工程师

---

## 1. 模块目标

管理 MetricCenter 的**网域（Network Domain）**生命周期与**边缘 Agent（Edge Agent）**接入状态，同时作为监控配置的**生成 / 预览 / 下发中心**，支撑政务网、跨专网、多 DMZ、弱网或物理隔离场景下的 Edge-Cloud 架构。

核心职责：

1. **网域管理**：注册、编辑、删除网域，生成/重置 Edge Agent 认证 Token，预置默认网域 `default`。
2. **租户-网域关联 {v0.2}**：`NetworkDomain` 数据模型归属本模块，`tenant_id` 字段在 v0.2 必须落地，保证 1 租户 : N 网域、禁止跨租户共享网域、`network_domain_id` 全局唯一。
3. **边缘 Agent 生命周期**：记录每个网域部署的采集器类型（`vmagent` / `prometheus-agent`）、版本、在线状态。
4. **配置生成服务 {v0.2+}**：轮询 Module_01 的 ScrapeJobs / Rules 与 Module_07 的 Resources / LabelTemplates，按网域生成 `prometheus.yml` 与 `rules.yml` 草稿。
5. **草稿与预览 {v0.2+}**：维护 draft 配置态，提供预览、diff 对比与人工确认，确认后再转为待下发版本。
6. **配置下发中心 {v0.2+}**：
   - 单网域 MVP：支持对中心 Prometheus 执行 SIGHUP / HTTP `/-/reload`；
   - 多网域场景：向 Edge Sync Agent 提供配置包下载接口。
7. **配置拉取服务**：为 Edge Sync Agent 提供安全的配置包下载接口。
8. **心跳与状态监控**：接收 Edge Sync Agent 心跳，展示 Agent 在线状态、WAL 积压、配置版本。
9. **安全基础**：Token 认证、拉取接口鉴权、未来支持 mTLS 证书轮转。

> **MVP 阶段**：本模块只实现网域数据模型和默认网域 `default`，不强制要求部署真实 Edge Agent；中心 Prometheus 配置由配置中心生成并通过 UI 确认后 reload。  
> **v0.2 阶段**：实现配置生成 / 预览 / 下发、Edge Sync Agent 配置拉取、心跳上报、Agent 状态列表展示。  
> **v0.4 阶段**：实现 mTLS、证书自动轮转、Token 轮换。

---

## 2. 用户故事

- ARCH-11：注册一个新的隔离网域并生成 Edge Agent 接入 Token。
- ARCH-12：查看所有网域列表及每个网域 Edge Agent 的在线状态（列表页形式）。
- OPS-11：在 Agent 状态列表页查看某个网域 Edge Agent 的最后心跳、WAL 积压和配置版本。
- OPS-12：当某个网域 Edge Agent 失联时，触发 `EdgeSiteOffline` 告警（告警规则由 Module_08 管理）。
- OPS-13：重置某个网域的 Edge Agent Token。
- OPS-14：查看按网域生成的 `prometheus.yml` 草稿，并与当前生效配置做 diff 对比。
- OPS-15：确认配置草稿后，一键下发并 reload 中心 Prometheus 或 Edge Agent。
- OPS-16：查看历史配置版本与下发记录，必要时回滚到上一版本。

---

## 3. 核心功能

### 3.1 网域管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **网域列表** | 展示所有网域：ID、名称、状态、Agent 类型、最后心跳 | P0 |
| **网域注册** | 创建新网域，生成唯一 `id` 和认证 Token | P0 |
| **网域编辑** | 修改网域名称、描述、Agent 类型、Remote Write 目标 | P1 |
| **网域删除** | 删除无资源绑定的网域；有资源绑定时禁止删除 | P1 |
| **Token 管理** | 查看/重置 Edge Sync Agent 认证 Token | **P0** |
| **默认网域** | 系统初始化自动创建 `default` 网域，MVP 单网域场景无感知 | P0 |

### 3.2 边缘 Agent 管理

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **Agent 注册** | Edge Sync Agent 首次拉取配置时自动注册到对应网域 | **P0** |
| **Agent 状态** | 展示在线/离线、最后心跳、最后配置拉取、当前配置版本 | **P0** |
| **配置同步状态** | 展示中心配置版本与边缘实际生效版本是否一致 | **P0** |
| **Agent 类型** | 按网域配置 `vmagent`（默认）或 `prometheus-agent` | **P0** |
| **Agent 状态列表页** | 分页表格展示各网域 Agent 在线状态、最后心跳、配置版本、配置同步状态、WAL 积压、最近错误 | **P0** |
| **WAL 与 Remote Write 参数配置** | 按网域配置 WAL 大小、批量、压缩、回传限速 | P1 |
| **WAL 积压监控** | 接收并展示 Agent WAL 积压字节数，反映弱网/断网程度 | P1 |
| **边缘诊断看板（图表/趋势）** | 心跳延迟 RTT 趋势、WAL 积压趋势、Remote Write 队列状态、24h 断网时长、最近错误等可视化图表 | P1/P2 |
| **版本管理** | 记录 Agent 版本，支持版本兼容性提示 | P2 |
| **本地告警规则下发** | 将 `scope=edge`/`both` 的告警规则随配置包下发到边缘 | P2 |
| **本地告警通知通道** | 边缘 Agent 支持配置本地飞书/钉钉 webhook，断网时独立通知 | P2 |

### 3.3 配置生成服务 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **轮询策略数据** | 定时轮询 Module_01（ScrapeJobs、Rules）与 Module_07（Resources、LabelTemplates） | **P0** |
| **按网域生成配置** | 为每个网域生成 `prometheus.yml`（含 scrape_configs、external_labels）与 `rules.yml` | **P0** |
| **标签注入** | 自动注入 `external_labels.network_domain`、租户标签、由 LabelTemplate 展开的标签 | **P0** |
| **实例过滤** | 根据 Job 中手动勾选的实例或筛选条件，从 Module_07 Resources 解析目标列表 | **P0** |
| **草稿生成** | 生成后先写入 `ConfigDraft`，不直接覆盖生效版本 | **P0** |
| **差异检测** | 对比 draft 与当前 `ConfigVersion` 内容，无变化时不生成新版本 | P1 |
| **规则作用域过滤** | 下发到边缘时仅包含 `scope=edge`/`both` 的规则；中心仅包含 `scope=central`/`both` | P1 |

#### 3.3.1 `external_labels` 注入说明

`external_labels` 是 Prometheus / vmagent 在 `global` 段配置的一组全局标签，采集器在抓取每条时间序列后会自动把这些标签附加到 series 上，因此所有从该 Agent 回写的指标都会统一携带这些标签。

Module_09 在生成每个网域的 `prometheus.yml` 时，必须在该网域 Agent 配置文件的 `global.external_labels` 中注入以下标签：

```yaml
global:
  external_labels:
    network_domain: "gov-cloud-a"
    tenant_id: "tenant-a"
```

- `network_domain`：取值对应 `NetworkDomain.id`，用于标识指标来源网域。
- `tenant_id`：取值对应 `NetworkDomain.tenant_id`，用于标识指标所属租户。

注入效果：

- 边缘 Agent 抓取的所有指标在 Remote Write 到中心时都会自动携带 `network_domain` 和 `tenant_id` 标签。
- Module_02 查询中心 Prometheus 时，可基于 `network_domain` 标签对用户有权限的网域做进一步过滤或展示来源网域。
- 该机制是 Module_02 实现「按网域查询」与「租户数据隔离」的基础之一。

> **与 Module_10 的边界**：Module_09 只负责为**内部 Edge Agent**（vmagent / prometheus-agent）生成配置时注入 `external_labels`；Module_10 负责**外部异构监控源**（第三方 Prometheus、Zabbix、云监控等）接入时的标签归一化。详见 [7.4 与 Module_10 的边界](#74-与-module-10-的边界)。

### 3.4 配置预览与确认 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **草稿列表** | 展示每个网域的待确认配置草稿、生成时间、触发来源 | **P0** |
| **配置预览** | 以 YAML 高亮形式预览 `prometheus.yml`、`rules.yml` | **P0** |
| **Diff 对比** | 与当前生效版本并排 diff，标红新增/删除/修改项 | **P0** |
| **PromQL 语法校验** | 对生成的 rules 做 PromQL 解析校验（调用 Module_02 或本地校验库） | P1 |
| **人工确认下发** | 运维工程师确认后，draft 转为 `ConfigVersion`，进入待下发/已下发状态 | **P0** |
| **草稿废弃** | 允许人工废弃当前 draft，保持当前生效版本不变 | P1 |

### 3.5 配置下发与分发 {v0.2+}

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **中心 Prometheus Reload {MVP}** | 单网域/中心模式：确认后执行 SIGHUP 或 POST `/-/reload` | **P0** |
| **下发记录** | 记录每次下发的时间、目标、操作人、结果、失败原因 | **P0** |
| **版本回滚** | 支持选择历史 `ConfigVersion` 重新下发，覆盖当前生效配置 | P1 |
| **多目标分发** | 按网域分发到对应 Edge Sync Agent；支持批量选择网域下发 | P1 |
| **配置包拉取接口** | `GET /api/v2/platform/edge/config?network_domain=<id>` | **P0** |
| **配置版本比对** | Edge Sync Agent 上报当前版本，无更新时返回 304 | **P0** |
| **配置包下载** | 返回包含 `prometheus.yml`、`blackbox.yml`、`metadata.json` 的压缩包 | **P0** |

### 3.6 本地手工兜底声明

平台**只保证通过 UI 下发并成功 reload 的配置与数据库期望态一致**。允许运维工程师在紧急情况下直接修改本地磁盘上的 `prometheus.yml` 或 Edge Agent 配置文件进行手工兜底；平台不会自动强制 reconcile 本地修改。

- 本地手工修改后，UI 展示的配置版本可能高于实际生效版本，配置同步状态显示为 `out_of_sync` 或 `manual_override`。
- 运维工程师需自行在 UI 重新确认并下发，以恢复平台一致性。
- 该策略用于防止平台自身 bug 导致监控系统整体不可用。

### 3.7 安全与证书（v0.4+）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **mTLS 证书下发** | 为 Edge Agent 签发客户端证书 | P2 |
| **证书自动轮转** | 证书到期前自动更新，Edge Sync Agent 热加载 | P2 |
| **Token 轮换** | 支持重置 Token 并强制 Edge Agent 重新认证 | P2 |

### 3.8 Agent 状态列表与边缘诊断看板

政务网/专网最常发生网络抖动或防火墙封堵，必须提供诊断能力。MVP 阶段以**Agent 状态列表页**满足基本可观测需求，图表/趋势类看板延后至 P1/P2。

#### 3.8.1 MVP：Agent 状态列表页

以分页表格展示每个网域的 Edge Agent 核心状态：

| 字段 | 说明 |
|------|------|
| 网域 | `network_domain_id` / 网域名称 |
| 在线状态 | online / offline / unknown |
| 最后心跳 | 距现在的时间差 |
| 配置版本 | 当前生效的 `config_version` |
| 配置同步状态 | In-Sync / Out-of-Sync / Manual-Override / Unknown |
| WAL 积压量 | 本地磁盘未发送数据大小（字节） |
| 最近错误 | 最后一条配置拉取或 Remote Write 错误摘要 |

#### 3.8.2 P1/P2：边缘诊断看板（图表/趋势）

| 诊断指标 | 说明 | 优先级 |
|----------|------|--------|
| **心跳 RTT 趋势** | 边缘 Agent 到中心的网络延迟趋势图 | P1 |
| **WAL 积压趋势** | 本地磁盘未发送数据大小趋势图 | P1 |
| **Remote Write 队列状态** | 发送速率、失败重试次数、当前队列长度 | P1 |
| **最近错误列表** | 最近 N 条配置拉取或 Remote Write 错误 | P1 |
| **24h 断网时长统计** | 最近 24 小时累计断网时长 | P2 |
| **详细诊断仪表板** | 综合图表视图，支持按网域/时间范围下钻 | P2 |

### 3.9 边缘 Agent 交付方式

政务网/金融专网通常禁止 `curl | bash` 一键脚本，提供多种交付方式：

| 交付方式 | 适用场景 | 安全等级 | 优先级 |
|----------|----------|----------|--------|
| **离线二进制包 + systemd 服务文件** | 物理隔离政务网 | 高 | **P0** |
| **Docker / Docker Compose** | 有容器 runtime 的环境 | 高 | P1 |
| **RPM / DEB 安装包** | 标准化大规模部署 | 高 | P2 |
| **Helm Chart** | Kubernetes 环境 | 高 | P2 |

> **不提供** `curl | bash` 一键部署脚本。所有交付物均提供校验和与签名验证说明。

### 3.10 WAL 与 Remote Write 参数（按网域配置）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `wal.max_size` | 20GB | 本地 WAL 最大磁盘占用 |
| `wal.min_backfill_age` | 1h | 只回传最近 1 小时内数据，避免历史风暴 |
| `remote_write.queue.max_samples_per_send` | 2000 | 每批次发送样本数 |
| `remote_write.queue.max_shards` | 50 | 并发发送分片数 |
| `remote_write.queue.retry_on_rate_limit` | true | 触发限流时自动退避重试 |
| `remote_write.compression` | snappy | 传输压缩算法 |

### 3.11 单网域与多网域模式 {MVP / v0.2}

MetricCenter 通过**租户级开关** `Tenant.multi_site_enabled` 区分两种部署模式，以兼顾单机简单场景与政务网/专网多隔离域场景。MVP 阶段仅有 `platform_admin` 租户，该开关对该租户生效；v0.2+ 各租户可独立开启多网域能力。

| 模式 | 开启条件 | 用户感知 | 数据模型 |
|---|---|---|---|
| **单网域模式（默认）** | `Tenant.multi_site_enabled=false` | 无网域/站点概念；不展示「网域管理」与「Agent 状态」菜单；配置下发中心直接面向中心 Prometheus | 仅存在 `default` 网域 |
| **多网域模式** | `Tenant.multi_site_enabled=true` | 展示「网域管理」、「Agent 状态」、「按网域配置下发」 | 多网域，每个网域独立 Agent 与配置包 |

#### 单网域模式行为

- 系统初始化时自动创建 `default` 网域，所有资源默认归属 `default`。
- Web 门户不展示「网域管理」菜单，用户看不到网域列表、Token、Agent 状态。
- 配置下发中心不展示网域选择器；配置草稿生成后仅触发中心 Prometheus 的 `/-/reload`。
- Edge Sync Agent 协议接口在 UI 中不暴露，但**后端保留协议能力**，便于用户后续从单网域扩展到多网域时无需重新部署 Agent。

#### 多网域模式行为

- 用户需先在「网域管理」注册网域，生成 Edge Agent 认证 Token。
- 在隔离网域部署 Edge Sync Agent 后，心跳自动注册到对应网域。
- 在 [Module_07](Module_07_Monitoring_Object_Management.md) 配置资源时，资源必须选择归属网域（`default` 作为中心管理域继续存在）。
- 在 [Module_01](Module_01_Metric_Collection_Center.md) 配置 ScrapeJob 时，按网域筛选目标实例。
- 配置中心按网域生成 `ConfigDraft`，经确认后生成 `ConfigVersion`；中心管理域（`default`）走 `/-/reload`，边缘域由 Edge Sync Agent 拉取配置包。

#### 模式切换与数据兼容

- 从单网域切换到多网域：已有资源与配置保持归属 `default` 网域，用户可继续在 `default` 网域下管理中心 Prometheus 采集，或逐步迁移到新网域。
- 从多网域切换回单网域：系统仅展示 `default` 网域数据，其他网域数据不删除但隐藏；再次切回多网域后恢复显示。
- `default` 网域类型为 `management`（管理域），**禁止删除**；允许用户修改其 `name` 和 `description` 以与云区域命名保持一致。其他网域类型默认为 `edge`（边缘域）。

---

## 4. 数据模型

### 4.1 网域（NetworkDomain）

本模块是 `NetworkDomain` 数据模型与生命周期的唯一 Owner。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 网域唯一标识，必须全局唯一；v0.2 起建议采用租户前缀，如 `<tenant_id>-gov-cloud-a`、`default` |
| name | string | ✅ | 网域展示名；`default` 网域的 `name` / `description` 允许修改以匹配客户云区域命名 |
| description | string | ❌ | 网域描述 |
| domain_type | enum | ✅ | 网域类型：`management`（管理域，如 `default`）/ `edge`（边缘域）；`management` 类型网域禁止删除 |
| tenant_id | string | ✅ | {v0.2} 所属租户 ID；`platform_admin` 表示平台默认租户，禁止跨租户共享网域 |
| cmdb_cloud_area_id | string | ❌ | {v0.4+} 对应 BlueKing CMDB 云区域 ID（`bk_cloud_id`） |
| cmdb_cloud_area_path | string | ❌ | {v0.4+} 对应 BlueKing CMDB 云区域路径 |
| token | string | ✅ | Edge Sync Agent 拉取配置时的认证 Token |
| agent_type | enum | ✅ | 边缘采集器类型：`vmagent`（默认）/ `prometheus-agent` |
| remote_write_url | string | ✅ | 该网域 Agent Remote Write 目标地址 |
| status | enum | ✅ | online / offline / unknown |
| last_heartbeat | datetime | ❌ | 边缘 Agent 最后心跳时间 |
| agent_version | string | ❌ | 边缘 Agent 版本 |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |

> **MVP 处理**：系统初始化时自动创建一个 `id=default`、`domain_type=management` 的默认网域，所有未指定网域的资源自动归属到默认网域，保证单网域场景无感知。默认网域 `default` 归属于 `platform_admin` 租户，所有未指定租户的资源默认继承该归属。`default` 网域的 `name` / `description` 允许用户修改以匹配云区域命名，但禁止删除。
>
> **归属约束**：一个网域必须且只能归属一个租户（1 租户 : N 网域），禁止跨租户共享网域；`network_domain_id` 必须全局唯一，建议创建时校验租户前缀。

### 4.2 边缘 Agent（EdgeAgent）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| network_domain_id | string | 所属网域 ID |
| agent_type | enum | `vmagent` / `prometheus-agent` |
| version | string | Agent 版本 |
| hostname | string | 部署主机名（可选） |
| status | enum | online / offline / unknown |
| last_heartbeat | datetime | 最后心跳时间 |
| heartbeat_rtt_ms | int | 心跳往返延迟（毫秒） |
| last_config_pull | datetime | 最后配置拉取时间 |
| config_version | string | 当前生效配置版本 |
| config_sync_status | enum | in_sync / out_of_sync / unknown / manual_override |
| wal_backlog_bytes | int | WAL 积压字节数 |
| remote_write_url | string | Remote Write 目标地址 |
| last_error | string | 最近错误信息 |
| created_at | datetime | 创建时间 |
| updated_at | datetime | 更新时间 |

### 4.3 心跳上报（EdgeHeartbeat）

| 字段 | 类型 | 说明 |
|------|------|------|
| network_domain_id | string | 所属网域 ID |
| agent_type | enum | `vmagent` / `prometheus-agent` |
| version | string | Agent 版本 |
| config_version | string | 当前生效配置版本 |
| wal_backlog_bytes | int | WAL 积压字节数 |
| remote_write_queue_size | int | Remote Write 发送队列长度 |
| remote_write_last_error | string | 最近 Remote Write 错误 |
| timestamp | datetime | 心跳时间戳 |

### 4.4 配置草稿（ConfigDraft）{v0.2+}

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 草稿唯一标识 |
| network_domain_id | string | ✅ | 所属网域 ID |
| source_version | string | ❌ | 基于哪个 ConfigVersion 生成，可为空（首次生成） |
| prometheus_yml | text | ✅ | 生成的 prometheus.yml 内容 |
| rules_yml | text | ❌ | 生成的 rules.yml 内容（可选） |
| blackbox_yml | text | ❌ | 生成的 blackbox.yml 内容（可选） |
| metadata | json | ✅ | 生成时间、生成器版本、来源 job/rule 摘要、checksum |
| status | enum | ✅ | pending / confirmed / discarded |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |
| confirmed_by | string | ❌ | 确认人 |
| confirmed_at | datetime | ❌ | 确认时间 |

### 4.5 配置版本（ConfigVersion）{v0.2+}

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 版本唯一标识，建议作为配置包版本号 |
| network_domain_id | string | ✅ | 所属网域 ID |
| draft_id | string | ✅ | 来源 ConfigDraft ID |
| prometheus_yml | text | ✅ | 生效的 prometheus.yml 内容 |
| rules_yml | text | ❌ | 生效的 rules.yml 内容 |
| blackbox_yml | text | ❌ | 生效的 blackbox.yml 内容 |
| metadata | json | ✅ | 版本号、生成时间、checksum、来源摘要 |
| created_at | datetime | ✅ | 创建时间 |

### 4.6 配置下发记录（ConfigDeployment）{v0.2+}

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 下发记录唯一标识 |
| network_domain_id | string | ✅ | 目标网域 ID |
| config_version_id | string | ✅ | 下发的 ConfigVersion ID |
| target_type | enum | ✅ | central_prometheus / edge_agent |
| target_address | string | ❌ | 目标地址，如 Prometheus reload URL 或 Edge Agent 标识 |
| status | enum | ✅ | pending / success / failed |
| error_message | text | ❌ | 失败原因 |
| triggered_by | string | ✅ | 操作人/系统 |
| triggered_at | datetime | ✅ | 触发时间 |
| completed_at | datetime | ❌ | 完成时间 |

### 4.7 网域与 BlueKing Cloud Area 映射

> 本节映射关系在 v0.4+ 由 [Module_04](Module_04_Custom_Discovery.md) 同步时落地。

`NetworkDomain` 必须与 BlueKing CMDB 的云区域（Cloud Area）模型一一对应，保证 CMDB 作为监控对象唯一数据源时，网域边界与 CMDB 网络边界一致。

| MetricCenter 对象 | BlueKing CMDB 对象 | 映射规则 | 说明 |
|-------------------|-------------------|----------|------|
| NetworkDomain | Cloud Area（云区域） | 1:1 | 一个网域唯一对应一个蓝鲸云区域；`default` 网域可映射到默认云区域或保留为空 |
| Tenant | Business（业务） | 1:1 | 网域归属的租户对应蓝鲸业务，由 [Module_06](Module_06_Multi_Tenant.md#32-%E7%A7%9F%E6%88%B7%E4%B8%8E-blueking-cmdb-%E6%98%A0%E5%B0%84) 定义 |

> **约束 {v0.4+}**：禁止绕过 CMDB 云区域直接在 MetricCenter 中定义网络隔离边界；网域的创建与编辑应支持同步拉取/校验蓝鲸云区域信息。

---

## 5. 配置生成与下发流程 {v0.2+}

### 5.1 轮询生成流程

```text
┌─────────────┐     ┌─────────────┐     ┌─────────────────────────┐
│ Module_01   │     │ Module_07   │     │ Module_09 配置中心       │
│ ScrapeJobs  │     │ Resources   │     │                         │
│ Rules       │     │ LabelTemplates│    │ 1. 定时轮询              │
└──────┬──────┘     └──────┬──────┘     │ 2. 生成 ConfigDraft      │
       │                   │            │ 3. 人工确认              │
       └─────────┬─────────┘            │ 4. 生成 ConfigVersion    │
                 │                      │ 5. 下发 / Reload         │
                 ▼                      └────────────┬────────────┘
       ┌─────────────────────┐                       │
       │ 按 network_domain   │                       ▼
       │ 生成 prometheus.yml │         ┌─────────────────────────┐
       │ 与 rules.yml        │         │ 中心 Prometheus /       │
       └─────────────────────┘         │ Edge Sync Agent         │
                                       └─────────────────────────┘
```

### 5.2 确认与下发时序

1. **轮询触发**：配置中心定时（默认 30s）读取 Module_01 与 Module_07 的数据。
2. **草稿生成**：按网域聚合 ScrapeJobs、Rules、Resources、LabelTemplates，生成 `ConfigDraft`。
3. **差异检测**：若 draft 与当前 `ConfigVersion` 一致，则标记为无需确认或自动丢弃；若不一致，则保持 `pending`。
4. **人工确认**：运维在 UI 预览 draft，查看 diff，确认后 draft 状态变为 `confirmed`，并生成新的 `ConfigVersion`。
5. **下发执行**：
   - 中心 Prometheus：调用 `POST /-/reload` 或发送 `SIGHUP`；
   - 边缘网域：Edge Sync Agent 下次心跳检测到 `config_changed=true` 后拉取配置包。
6. **下发记录**：写入 `ConfigDeployment`，记录成功/失败状态。

---

## 6. Edge Sync Agent 协议

### 6.1 心跳与配置检查接口

```http
POST /api/v2/platform/edge/heartbeat
Authorization: Bearer <NetworkDomain.token>
Content-Type: application/json

{
  "network_domain_id": "gov-cloud-a",
  "agent_type": "vmagent",
  "version": "v1.101.0",
  "config_version": "20260724-120000",
  "wal_backlog_bytes": 1048576
}
```

响应：

```json
{
  "config_changed": true,
  "config_version": "20260724-121500",
  "config_download_url": "/api/v2/platform/edge/config?network_domain=gov-cloud-a"
}
```

### 6.2 配置包拉取接口

```http
GET /api/v2/platform/edge/config?network_domain=gov-cloud-a
Authorization: Bearer <NetworkDomain.token>
```

响应：

```
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="edge-config-gov-cloud-a.zip"

[zip body]
```

配置包结构：

```
edge-config-<network_domain_id>.zip
├── prometheus.yml          # 本域 scrape_configs（已注入 external_labels.network_domain）
├── blackbox.yml            # 本域 Blackbox 探测模块（可选）
├── rules.yml               # 本域 edge/both 告警规则（v0.4+）
├── alertmanager.yml        # 本域通知路由（v0.4+）
└── metadata.json           # 配置版本、生成时间、agent_type、checksum
```

### 6.3 Edge Sync Agent 本地行为

1. 启动时从环境变量或配置文件读取 `NETWORK_DOMAIN_ID` 和 `TOKEN`。
2. 每 30s 向 MetricCenter 发送心跳，上报当前配置版本和 WAL 积压。
3. 若响应提示 `config_changed=true`，拉取最新配置包。
4. 校验配置包 checksum，解压到本地目录。
5. 调用本地采集器 `/-/reload`（vmagent 与 Prometheus Agent Mode 均支持）。
6. 网络中断时保留最后一份有效配置，按原配置继续采集和 WAL 缓存。
7. 当配置包包含 `rules.yml` 与 `alertmanager.yml` 时，边缘 Agent 启动本地 vmalert/Alertmanager 实例，负责网域内自治告警。

---

## 7. 模块边界

### 7.1 与 Module_01 的边界 {v0.2+}

| 职责 | Module_01（监控策略与指标管理） | Module_09（网域与边缘配置中心） |
|------|----------------------------------|--------------------------------|
| ScrapeJob 数据模型定义 | ✅ | ❌ 仅读取 |
| 规则（Rule）数据模型定义 | ✅ | ❌ 仅读取 |
| CI 类型 ↔ Exporter 模板绑定 | ✅ | ❌ 仅消费 |
| 规则编辑 UI | ✅ | ❌ |
| 按网域生成 `prometheus.yml` / `rules.yml` | ❌ | ✅ |
| 配置草稿 / 预览 / Diff | ❌ | ✅ |
| 配置下发 / Reload | ❌ | ✅ |
| 策略定义与实例选择 | ✅ | ❌ |

### 7.2 与 Module_07 的边界 {v0.2+}

| 职责 | Module_07（监控对象管理） | Module_09（网域与边缘配置中心） |
|------|---------------------------|--------------------------------|
| Resource 数据模型定义 | ✅ | ❌ 仅读取 |
| LabelTemplate 数据模型定义 | ✅ | ❌ 仅读取 |
| Resource CRUD / Excel 导入 | ✅ | ❌ |
| 「已监控 / 未监控」badge | ✅ 展示 | ❌ 消费 badge 状态辅助生成配置 |
| 按网域生成 `prometheus.yml` | ❌ | ✅ |
| 配置包拉取接口 | ❌ | ✅ |
| Edge Sync Agent 协议 | ❌ | ✅ |
| Edge Agent 心跳接收与状态展示 | ❌ | ✅ |
| NetworkDomain 数据模型定义 | ❌ 仅引用 `id/name/status` | ✅ 数据模型归属 |
| NetworkDomain 生命周期 UI/API | ❌ | ✅ 功能 Owner |

### 7.3 与 Module_06 的边界

| 职责 | Module_06（租户与平台管理） | Module_09（网域与边缘配置中心） |
|------|------------------------------|--------------------------------|
| Tenant 数据模型定义 | ✅ | ❌ 仅引用 `tenant_id` |
| NetworkDomain 与 Tenant 关系 | ❌ 仅展示/校验 | ✅ 数据模型归属（`tenant_id` 在 NetworkDomain） |

### 7.4 与 Module_10 的边界

| 职责 | Module_09（网域与边缘配置中心） | Module_10（外部监控源接入与标签归一化） |
|------|--------------------------------|------------------------------------------|
| 内部 Edge Agent 的 `external_labels` 注入 | ✅ 在生成 `prometheus.yml` 时注入 `network_domain`、`tenant_id` 等 | ❌ |
| 外部异构监控源（第三方 Prometheus/Zabbix/云监控）接入 | ❌ | ✅ 负责标签归一化、映射、补全 |
| 外部来源的 `network_domain` / `tenant_id` 标签对齐 | ❌ 可提供网域/租户定义供引用 | ✅ 负责将外部指标映射到本网域模型 |

> **原则**：Module_09 管「内部 Agent 出身标签」，Module_10 管「外部来源入场标签」。两者都可能在指标上产生 `network_domain` 等标签，但生成时机和 responsibility 不同：Module_09 通过 Agent 配置注入，Module_10 通过接入网关/转换器在数据入平台时打标或改写。

---

## 8. 依赖

- `platform/edge/`
- `platform/config/`（读取按网域生成的配置）
- `platform/configgen/`（配置生成服务）
- `platform/gateway/`（统一 API 入口、鉴权）
- `platform/models/`
- Module_01 API：读取 ScrapeJobs、Rules
- Module_07 API：读取 Resources、LabelTemplates
- 中心 Prometheus reload 接口（SIGHUP 或 HTTP `/-/reload`）
- `vmagent` 或 `prometheus-agent`（边缘部署）

---

## 9. 验收标准

- [ ] MVP 阶段系统存在默认网域 `default`，资源可无感知归属默认网域
- [ ] {v0.2} `network_domain_id` 必须全局唯一，创建时建议校验租户前缀
- [ ] {v0.2} 一个网域必须且只能归属一个租户，禁止跨租户共享网域
- [ ] {v0.4+} 网域可维护 BlueKing CMDB 云区域 ID 与路径映射
- [ ] 可以创建/编辑/删除网域，删除前校验无资源绑定
- [ ] 可以为网域生成/重置 Edge Agent Token
- [ ] v0.2 阶段，配置中心可轮询 Module_01 与 Module_07 数据并生成按网域的 `prometheus.yml` 草稿
- [ ] v0.2 阶段，UI 可预览配置草稿并与当前生效版本做 diff
- [ ] v0.2 阶段，人工确认后配置中心可生成 `ConfigVersion` 并触发下发
- [ ] MVP 阶段，单网域场景下确认后的配置可通过 SIGHUP / HTTP reload 应用到中心 Prometheus
- [ ] v0.2 阶段，Edge Sync Agent 可通过 Token 拉取本域配置包
- [ ] v0.2 阶段，Edge Sync Agent 心跳可更新网域最后在线时间、配置版本、WAL 积压
- [ ] v0.2 阶段，Web 门户可查看各网域 Edge Agent 在线状态、配置版本、WAL 积压（MVP 以 Agent 状态列表页形式实现）
- [ ] P1/P2 阶段，边缘诊断看板可展示 WAL 积压趋势、Remote Write 队列状态、最近错误、24h 断网时长等图表
- [ ] Edge Agent 失联超过阈值（默认 5 分钟）时，触发 `EdgeSiteOffline` 告警
- [ ] 配置包包含 `prometheus.yml` 和 `metadata.json`，且 `prometheus.yml` 已注入 `external_labels.network_domain` 与 `external_labels.tenant_id`
- [ ] 下发记录 `ConfigDeployment` 可查询成功/失败历史，支持查看失败原因
- [ ] 平台明确允许本地手工兜底，并在 UI 中展示 `manual_override` 状态
- [ ] 提供离线二进制包 + systemd 服务文件的交付方式
- [ ] 不提供 `curl | bash` 一键部署脚本
- [ ] v0.4 阶段支持 mTLS 证书下发与自动轮转（可选）

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.2 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.2 | 2026-08-03 | 修改 | 新增 3.11 节：明确单网域/多网域模式行为；将开关从平台级 feature flag 调整为租户级 `Tenant.multi_site_enabled`；`default` 网域新增 `domain_type=management` 且允许修改名称/描述、禁止删除；Edge Sync Agent 协议后端保留能力、UI 隐藏 | 功能范围、UI/UX、MVP 边界、数据模型 | MVP / v0.2 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | MVP / v0.2 / v1.0 | draft |
