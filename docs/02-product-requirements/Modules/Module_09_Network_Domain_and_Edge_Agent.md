# Module 09: 网域与边缘 Agent 管理

> **模块类型**: 核心能力模块（v0.2+）  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_07_Config_Management.md](Module_07_Config_Management.md)  
> **目标用户**: 运维架构师、运维工程师  
> **版本**: v1.0  
> **更新日期**: 2026-07-24

---

## 1. 模块目标

管理 MetricCenter 的**网域（Network Domain）**生命周期与**边缘 Agent（Edge Agent）**接入状态，支撑政务网、跨专网、多 DMZ、弱网或物理隔离场景下的 Edge-Cloud 架构。

核心职责：

1. **网域管理**：注册、编辑、删除网域，生成/重置 Edge Agent 认证 Token，预置默认网域 `default`。
2. **边缘 Agent 生命周期**：记录每个网域部署的采集器类型（`vmagent` / `prometheus-agent`）、版本、在线状态。
3. **配置拉取服务**：为 Edge Sync Agent 提供安全的配置包下载接口。
4. **心跳与状态监控**：接收 Edge Sync Agent 心跳，展示 Agent 在线状态、WAL 积压、配置版本。
5. **安全基础**：Token 认证、拉取接口鉴权、未来支持 mTLS 证书轮转。

> **MVP 阶段**：本模块只实现网域数据模型和默认网域 `default`，不强制要求部署真实 Edge Agent。  
> **v0.2 阶段**：实现 Edge Sync Agent 配置拉取、心跳上报、Agent 在线状态展示。  
> **v0.4 阶段**：实现 mTLS、证书自动轮转、Token 轮换。

---

## 2. 用户故事

- ARCH-11：注册一个新的隔离网域并生成 Edge Agent 接入 Token。
- ARCH-12：查看所有网域列表及其边缘 Agent 在线状态。
- OPS-11：查看某个网域 Edge Agent 的最后心跳、WAL 积压和配置版本。
- OPS-12：当某个网域 Edge Agent 失联时，触发 `EdgeSiteOffline` 告警（告警规则由 Module_08 管理）。
- OPS-13：重置某个网域的 Edge Agent Token。

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
| **边缘诊断看板** | 心跳延迟 RTT、WAL 积压、Remote Write 队列状态、最近错误 | P1 |
| **WAL 与 Remote Write 参数配置** | 按网域配置 WAL 大小、批量、压缩、回传限速 | P1 |
| **WAL 积压监控** | 接收并展示 Agent WAL 积压字节数，反映弱网/断网程度 | P1 |
| **版本管理** | 记录 Agent 版本，支持版本兼容性提示 | P2 |

### 3.3 配置拉取服务

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **配置包拉取接口** | `GET /api/v2/platform/edge/config?network_domain=<id>` | **P0** |
| **Token 鉴权** | 请求头携带 `Authorization: Bearer <token>` | **P0** |
| **配置版本比对** | Edge Sync Agent 上报当前版本，无更新时返回 304 | **P0** |
| **配置包下载** | 返回包含 `prometheus.yml`、`blackbox.yml`、`metadata.json` 的压缩包 | **P0** |

### 3.4 安全与证书（v0.4+）

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **mTLS 证书下发** | 为 Edge Agent 签发客户端证书 | P2 |
| **证书自动轮转** | 证书到期前自动更新，Edge Sync Agent 热加载 | P2 |
| **Token 轮换** | 支持重置 Token 并强制 Edge Agent 重新认证 | P2 |

### 3.5 边缘诊断看板（Edge Diagnostics Dashboard）

政务网/专网最常发生网络抖动或防火墙封堵，必须提供可视化诊断能力：

| 诊断指标 | 说明 | 优先级 |
|----------|------|--------|
| **在线状态** | online / offline / unknown | P0 |
| **最后心跳** | 距现在的时间差 | P0 |
| **心跳 RTT** | 边缘 Agent 到中心的网络延迟 | P1 |
| **配置同步状态** | In-Sync / Out-of-Sync，展示中心版本 vs 边缘版本 | P0 |
| **WAL 积压量** | 本地磁盘未发送数据大小 | P1 |
| **Remote Write 队列状态** | 发送速率、失败重试次数、当前队列长度 | P1 |
| **最近错误** | 最后 5 条配置拉取或 Remote Write 错误 | P1 |
| **断网时长统计** | 最近 24 小时累计断网时长 | P2 |

### 3.6 边缘 Agent 交付方式

政务网/金融专网通常禁止 `curl | bash` 一键脚本，提供多种交付方式：

| 交付方式 | 适用场景 | 安全等级 | 优先级 |
|----------|----------|----------|--------|
| **离线二进制包 + systemd 服务文件** | 物理隔离政务网 | 高 | **P0** |
| **Docker / Docker Compose** | 有容器 runtime 的环境 | 高 | P1 |
| **RPM / DEB 安装包** | 标准化大规模部署 | 高 | P2 |
| **Helm Chart** | Kubernetes 环境 | 高 | P2 |

> **不提供** `curl | bash` 一键部署脚本。所有交付物均提供校验和与签名验证说明。

### 3.7 WAL 与 Remote Write 参数（按网域配置）

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `wal.max_size` | 20GB | 本地 WAL 最大磁盘占用 |
| `wal.min_backfill_age` | 1h | 只回传最近 1 小时内数据，避免历史风暴 |
| `remote_write.queue.max_samples_per_send` | 2000 | 每批次发送样本数 |
| `remote_write.queue.max_shards` | 50 | 并发发送分片数 |
| `remote_write.queue.retry_on_rate_limit` | true | 触发限流时自动退避重试 |
| `remote_write.compression` | snappy | 传输压缩算法 |

---

## 4. 数据模型

### 4.1 网域（NetworkDomain）

本模块是 `NetworkDomain` 数据模型与生命周期的唯一 Owner。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 网域唯一标识，如 `default`、`gov-cloud-a` |
| name | string | ✅ | 网域展示名 |
| description | string | ❌ | 网域描述 |
| token | string | ✅ | Edge Sync Agent 拉取配置时的认证 Token |
| agent_type | enum | ✅ | 边缘采集器类型：`vmagent`（默认）/ `prometheus-agent` |
| remote_write_url | string | ✅ | 该网域 Agent Remote Write 目标地址 |
| status | enum | ✅ | online / offline / unknown |
| last_heartbeat | datetime | ❌ | 边缘 Agent 最后心跳时间 |
| agent_version | string | ❌ | 边缘 Agent 版本 |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |

> **MVP 处理**：系统初始化时自动创建一个 `id=default` 的默认网域，所有未指定网域的资源自动归属到默认网域，保证单网域场景无感知。

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
| config_sync_status | enum | in_sync / out_of_sync / unknown |
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

---

## 5. Edge Sync Agent 协议

### 5.1 心跳与配置检查接口

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

### 5.2 配置包拉取接口

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
└── metadata.json           # 配置版本、生成时间、agent_type、checksum
```

### 5.3 Edge Sync Agent 本地行为

1. 启动时从环境变量或配置文件读取 `NETWORK_DOMAIN_ID` 和 `TOKEN`。
2. 每 30s 向 MetricCenter 发送心跳，上报当前配置版本和 WAL 积压。
3. 若响应提示 `config_changed=true`，拉取最新配置包。
4. 校验配置包 checksum，解压到本地目录。
5. 调用本地采集器 `/-/reload`（vmagent 与 Prometheus Agent Mode 均支持）。
6. 网络中断时保留最后一份有效配置，按原配置继续采集和 WAL 缓存。

---

## 6. 与 Module_07 的边界

| 职责 | Module_07（配置管理） | Module 09（网域与边缘 Agent） |
|------|------------------------|-------------------------------|
| NetworkDomain 数据模型定义 | ❌ 仅引用 `id/name/status` | ✅ 数据模型归属 |
| NetworkDomain 生命周期 UI/API | ❌ | ✅ 功能 Owner |
| 按网域生成 `prometheus.yml` | ✅ 实现 | ❌ |
| 配置包拉取接口 | ❌ | ✅ 实现 |
| Edge Sync Agent 协议 | ❌ | ✅ 定义 |
| Edge Agent 心跳接收与状态展示 | ❌ | ✅ 实现 |
| Edge Agent 告警（失联） | ❌ | ✅ 触发条件定义；告警规则写入 Module 08 |

---

## 7. 依赖

- `platform/edge/`
- `platform/config/`（读取按网域生成的配置）
- `platform/gateway/`（统一 API 入口、鉴权）
- `platform/models/`
- `vmagent` 或 `prometheus-agent`（边缘部署）

---

## 8. 验收标准

- [ ] MVP 阶段系统存在默认网域 `default`，资源可无感知归属默认网域
- [ ] 可以创建/编辑/删除网域，删除前校验无资源绑定
- [ ] 可以为网域生成/重置 Edge Agent Token
- [ ] v0.2 阶段，Edge Sync Agent 可通过 Token 拉取本域配置包
- [ ] v0.2 阶段，Edge Sync Agent 心跳可更新网域最后在线时间、配置版本、WAL 积压
- [ ] v0.2 阶段，Web 门户可查看各网域 Edge Agent 在线状态、心跳 RTT、配置同步状态
- [ ] 边缘诊断看板展示 WAL 积压、Remote Write 队列状态、最近错误
- [ ] Edge Agent 失联超过阈值（默认 5 分钟）时，触发 `EdgeSiteOffline` 告警
- [ ] 配置包包含 `prometheus.yml` 和 `metadata.json`，且已注入 `external_labels.network_domain`
- [ ] 提供离线二进制包 + systemd 服务文件的交付方式
- [ ] 不提供 `curl | bash` 一键部署脚本
- [ ] v0.4 阶段支持 mTLS 证书下发与自动轮转（可选）
