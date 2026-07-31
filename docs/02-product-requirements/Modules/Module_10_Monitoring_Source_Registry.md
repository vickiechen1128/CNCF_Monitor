# Module 10: 监控源登记册与异构接入

> **模块类型**：核心能力模块（集成模式）  
> **依赖文档**： [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)  
> **目标用户**：运维架构师、运维工程师、集成项目经理  
> **版本**：v1.0  
> **更新日期**：2026-07-24

---

## 1. 模块目标

在真实集成项目中，客户现场往往已经存在 Prometheus、Zabbix、云监控等异构监控系统。MetricCenter 不替换这些系统，而是通过 **监控源登记册（Monitoring Source Registry）** 将其统一纳管，最终汇聚到中心时序存储，提供统一的 PromQL 查询门户。

核心职责：

1. **监控源登记**：记录每个监控源的类型、归属网域、接入方式、认证信息、健康状态。
2. **异构数据接入**：支持自部署 Edge Agent、外部 Prometheus Remote Write、Zabbix Adapter、云监控 API Pull 等多种接入方式。
3. **统一接入网关（Ingestion Gateway）**：在 [Module_03](Module_03_Gateway_and_Auth.md) 统一网关框架下，实现异构接入的鉴权、限流、路由、标签注入业务逻辑。
4. **接入源健康诊断**：监控每个监控源的在线状态、最后推送时间、积压量。

> **产品化平衡**：本模块属于「集成模式」，通过 `feature_flags.heterogeneous_ingestion_enabled` 控制。单机模式下隐藏该功能，用户无感知。

---

## 2. 用户故事

- ARCH-13：客户业务专网已有一套 Prometheus，希望不替换它，只把数据汇聚到 MetricCenter 统一查询。
- ARCH-14：客户政务网运行 Zabbix，希望通过 Adapter 将其指标接入 MetricCenter。
- OPS-14：查看所有已接入监控源的状态，区分自部署 Agent、外部 Prometheus、Zabbix Adapter。
- OPS-15：某个外部 Prometheus 停止推送时，收到监控源离线告警。
- PM-01：在招投标材料中展示 MetricCenter 的异构监控汇聚能力。

---

## 3. 核心功能

### 3.1 监控源登记册

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **监控源列表** | 展示所有已登记监控源：名称、类型、归属网域、状态、最后活跃时间 | P0 |
| **监控源注册** | 创建监控源，生成唯一 Token，指定接入方式 | P0 |
| **监控源编辑** | 修改配置、Token 重置、状态启用/禁用 | P1 |
| **监控源删除** | 删除已停用监控源 | P1 |
| **批量导入** | 通过 Excel / API 批量登记多个外部 Prometheus（集成项目交付场景） | P2 |

### 3.2 异构接入方式

| 监控源类型 | 接入方式 | 是否需要部署我方组件 | 说明 |
|---|---|---|---|
| **MetricCenter Edge Agent** | Remote Write Push | 是（vmagent / prometheus-agent + Edge Sync Agent） | 自部署网域，完全可控 |
| **External Prometheus** | Remote Write Push | 否 | 在客户 Prometheus 中追加 `remote_write` 配置 |
| **Zabbix** | Adapter + Remote Write | 是（zabbix_exporter 或自研 Adapter） | 将 Zabbix 指标转换为 Prometheus 格式 |
| **Cloud Monitor（阿里云/腾讯云/AWS CloudWatch）** | API Pull / Adapter | 可选 | 中心或 DMZ 部署 Puller，定时拉取指标 |
| **OpenTelemetry Collector** | OTLP / Remote Write | 可选 | 未来扩展 |

### 3.3 Ingestion Gateway

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **统一 Remote Write 接收点** | 提供 `/api/v2/ingest/prometheus` 等标准 Remote Write 接口 | P0 |
| **Token 鉴权** | 每个监控源独立 Token，网关校验后路由到对应租户/网域 | P0 |
| **标签注入** | 根据监控源配置自动注入 `network_domain`、`source_type`、`source_id` 等标签 | P0 |
| **限流与配额** | 按监控源限制写入 QPS / 样本数，防止单源打满中心 | P1 |
| **写入路由** | 将不同监控源数据路由到不同 VictoriaMetrics 租户或存储实例 | P2 |
| **mTLS 接入** | 高安全场景下使用双向 TLS 认证 | P2 |

### 3.4 标签归一化与清洗管道（Label Normalization Pipeline）

在 Remote Write 数据写入 VictoriaMetrics 前，网关执行标签归一化，将异构监控系统的常用标签统一为标准标签集。

标准标签集：`instance`、`app`、`env`、`cluster`、`network_domain`。

归一化映射示例：

| 常见外部 Label | 归一化后 Label | 规则说明 |
|----------------|----------------|----------|
| `host`、`hostname`、`node` | `instance` | 若同时存在，优先级：`instance` > `hostname` > `host` > `node` |
| `ip`、`ip_address` | `instance` | 若未携带端口，保留 IP；若原 `instance` 已存在则保留原值 |
| `application`、`service`、`app_name` | `app` | 优先级：`app` > `app_name` > `application` > `service` |
| `environment`、`stage` | `env` | 优先级：`env` > `environment` > `stage` |

不可归一化标签默认保留。

```mermaid
flowchart LR
    RW[Remote Write]
    AUTH[鉴权]
    INJ[标签注入]
    NORM[标签归一化]
    FILTER[指标过滤]
    VM[VictoriaMetrics]
    RW --> AUTH --> INJ --> NORM --> FILTER --> VM
```

### 3.5 指标丢弃与丢包防护（Metric Drop Rules）

支持按 `MonitoringSource` 配置指标白名单/黑名单，防止单源高基数或无用指标打满中心存储。

规则类型：

| 规则类型 | 说明 |
|----------|------|
| `metric_name` | 精确匹配指标名 |
| `metric_prefix` | 前缀匹配指标名 |
| `label_match` | 按标签条件匹配 |
| `cardinality_limit` | 单指标 series 基数限制 |

动作：`keep` / `drop` / `sample`。

高基数防护：当某指标在 1 分钟内 series 数超过阈值（默认 10000）时，自动采样或丢弃，并记录事件。

### 3.6 接入源健康诊断

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **最后推送时间** | 展示每个监控源最近一次 Remote Write 时间 | P0 |
| **推送速率** | 展示样本数/秒、请求数/分钟 | P1 |
| **错误率** | 展示 4xx/5xx 错误比例 | P1 |
| **离线告警** | 监控源超过阈值未推送时触发告警 | P1 |

---

## 4. 数据模型

### 4.1 监控源（MonitoringSource）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | string | ✅ | 唯一标识 |
| name | string | ✅ | 监控源展示名 |
| source_type | enum | ✅ | `edge_agent` / `external_prometheus` / `zabbix` / `cloud_monitor` / `opentelemetry` |
| network_domain_id | string | ✅ | 所属网域 |
| status | enum | ✅ | online / offline / disabled / unknown |
| ingest_method | enum | ✅ | `remote_write_push` / `adapter_pull` / `api_sync` |
| ingest_endpoint | string | 条件必填 | Remote Write URL / Adapter URL / API Endpoint |
| auth_type | enum | ✅ | `token` / `mtls` / `basic_auth` |
| auth_config | JSON | 条件必填 | Token、证书、用户名密码等 |
| remote_write_url | string | 条件必填 | 对于 Push 类型，中心提供的写入地址 |
| labels | map | ❌ | 附加 external_labels |
| normalization_enabled | bool | ✅ | 是否启用标签归一化，默认 `true` |
| normalization_rules | JSON | ❌ | 自定义归一化规则（覆盖默认规则） |
| metric_drop_rules | []MetricDropRule | ❌ | 指标丢弃/白名单规则 |
| max_series_per_metric | int | ❌ | 单指标最大 series 数，默认 10000 |
| last_heartbeat | datetime | ❌ | 最后活跃时间 |
| last_error | string | ❌ | 最后错误信息 |
| created_at | datetime | ✅ | 创建时间 |
| updated_at | datetime | ✅ | 更新时间 |

### 4.2 接入统计（IngestionStats）

| 字段 | 类型 | 说明 |
|------|------|------|
| source_id | string | 监控源 ID |
| network_domain_id | string | 所属网域 |
| samples_per_second | float | 每秒样本数 |
| requests_per_minute | int | 每分钟请求数 |
| error_rate | float | 错误率 |
| last_sample_timestamp | datetime | 最近样本时间戳 |

### 4.3 MetricDropRule

```go
type MetricDropRule struct {
    RuleID        string            // 规则唯一标识
    SourceID      string            // 归属 MonitoringSource
    RuleType      string            // metric_name / metric_prefix / label_match / cardinality_limit
    MatchValue    string            // 匹配值或前缀
    LabelMatchers map[string]string // label_match 时使用
    Action        string            // keep / drop / sample
    Priority      int               // 规则优先级，数值越小越优先
    Enabled       bool
    CreatedAt     datetime
    UpdatedAt     datetime
}
```

---

## 5. 集成模式详细设计

### 5.1 外部 Prometheus Remote Write 接入

客户已有 Prometheus，MetricCenter 提供一段可复制的 `remote_write` 配置：

```yaml
remote_write:
  - url: "https://metriccenter.example.com/api/v2/ingest/prometheus/<monitoring_source_id>"
    bearer_token: "<MonitoringSource.token>"
    queue_config:
      capacity: 10000
      max_samples_per_send: 2000
      max_shards: 10
      retry_on_rate_limit: true
```

MetricCenter 收到数据后：
1. 从 URL path 提取 `source_id`，校验 Token 与 Source ID 是否匹配。
2. 从 Token/Claims 推导 `network_domain`，自动注入 `network_domain`、`source_type="external_prometheus"`、`source_id`。
3. 写入 VictoriaMetrics。
4. 进入标签归一化管道，重写 `host/hostname/ip` 等标签。
5. 经过 Metric Drop Rules 过滤后写入 VictoriaMetrics。

### 5.2 Zabbix 接入

部署 `zabbix_exporter` 或自研 Adapter：

```
Zabbix Server
    │
    ▼
zabbix_exporter（拉取 Zabbix 历史数据 / 实时数据）
    │
    ├──► 转换为 Prometheus 指标格式
    │
    └──► Remote Write ──► Ingestion Gateway ──► VictoriaMetrics
```

建议 Adapter 部署在网域 C 内部或中心 DMZ，通过 HTTPS 443 出站。

### 5.3 云监控接入

部署 `cloud-monitor-puller`：

```
Cloud Monitor API
    │
    ▼
cloud-monitor-puller（定时拉取，如 60s）
    │
    ├──► 指标名映射为 Prometheus 格式
    │
    └──► Remote Write ──► Ingestion Gateway ──► VictoriaMetrics
```

需要处理：指标命名空间转换、维度标签映射、配额与限流。

---

## 6. API 接口

### 6.1 监控源管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v2/platform/sources` | 列表监控源 |
| POST | `/api/v2/platform/sources` | 创建监控源 |
| GET | `/api/v2/platform/sources/{id}` | 查看监控源详情 |
| PUT | `/api/v2/platform/sources/{id}` | 更新监控源 |
| DELETE | `/api/v2/platform/sources/{id}` | 删除监控源 |
| POST | `/api/v2/platform/sources/{id}/reset-token` | 重置 Token |

### 6.2 Remote Write 接收 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v2/ingest/prometheus/{source_id}` | Prometheus Remote Write 接收点，从 URL path 识别监控源 |

---

## 7. 与 Module_09 的边界

| 职责 | Module_09（网域与边缘 Agent） | Module 10（监控源登记册） |
|------|-------------------------------|---------------------------|
| 网域生命周期管理 | ✅ | ❌ |
| Edge Agent 配置拉取 | ✅ | ❌ |
| Edge Agent 心跳与状态 | ✅ | ❌ |
| 外部 Prometheus 接入 | ❌ | ✅ |
| Zabbix / 云监控 Adapter 接入 | ❌ | ✅ |
| Ingestion Gateway 业务逻辑 | ❌ | ✅ |
| 网关框架/统一入口 | ✅（Module_03 提供框架） | ❌ |
| 统一 Remote Write 接收点 | ❌ | ✅ |

> 当 `source_type=edge_agent` 时，MonitoringSource 与 EdgeAgent 是一对一关系，由 Module_09 负责创建和维护，Module 10 只读展示。

---

## 8. 依赖

- `platform/ingestion/`
- `platform/edge/`（Edge Agent 关联）
- `platform/gateway/`（统一入口、鉴权）
- `platform/config/`（标签注入配置）
- VictoriaMetrics / Mimir（中心存储）
- zabbix_exporter / cloud-monitor-puller（可选 Adapter）

---

## 9. 验收标准

- [ ] 可以创建/编辑/删除 MonitoringSource
- [ ] 可以为外部 Prometheus 生成可复制的 `remote_write` 配置片段
- [ ] 外部 Prometheus Remote Write 数据成功写入 VictoriaMetrics 并可通过 PromQL 查询
- [ ] 查询结果自动附带 `network_domain`、`source_type`、`source_id` 标签
- [ ] 可以查看各监控源的最后活跃时间、推送速率、错误率
- [ ] 监控源离线超过阈值时触发告警
- [ ] Ingestion Gateway 支持 Token 鉴权和按监控源限流
- [ ] 外部 Prometheus 上报的 `hostname`/`host` 标签可被归一化为 `instance`
- [ ] 支持按 MonitoringSource 配置指标白名单/黑名单
- [ ] 高基数指标触发阈值后可被丢弃或采样，并记录事件
- [ ] Zabbix Adapter 架构设计文档完成（v0.4 实现可选）
- [ ] 云监控 Puller 架构设计文档完成（v0.4 实现可选）
