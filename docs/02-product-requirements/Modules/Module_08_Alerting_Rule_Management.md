# Module 08: 告警规则管理

> **模块类型**: 扩展能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_02_Query_Center.md](Module_02_Query_Center.md)  
> **目标用户**: 运维工程师、运维架构师  
> **版本**: v1.0  
> **更新日期**: 2026-07-20

---

## 1. 模块目标

管理 Prometheus 告警规则（Alerting Rules / Recording Rules）的生命周期，以及 Alertmanager 的静默、通知路由能力。

> **MVP 阶段**：本模块**不写规则编辑 UI**。告警规则直接编辑 `rules.yml`，Alertmanager 配置直接编辑 `alertmanager.yml`。MetricCenter 仅通过查询中心提供**告警状态查看**能力（代理 `/api/v1/alerts`）。  
> **v1.0 阶段**：提供规则编辑器、静默管理 UI、通知渠道配置，生成 `rules.yml` 与 `alertmanager.yml`。

---

## 2. 用户故事

- OPS-07：查看当前告警状态
- OPS-09：未来通过 UI 创建/编辑告警规则
- OPS-10：未来配置告警静默与通知接收人
- ARCH-06：统一管理告警规则版本与下发
- ARCH-09：按网域配置告警规则（未来）
- ARCH-10：配置中心/边缘告警规则求值范围（未来）

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **告警状态查看** | 代理 Prometheus `/api/v1/alerts`，展示当前触发的告警列表，支持按网域筛选 | P1 |
| **告警规则编辑** | UI 化编辑 Alerting Rules：PromQL 条件、`for` 持续时间、告警级别、labels、annotations | P2 |
| **规则求值范围（Scope）** | 规则求值位置：`central`（中心，适用于跨网域、全局预聚合、复杂环比/同比告警）/ `edge`（边缘自治，适用于网域内死活告警，由边缘 Agent 本地评估，断网时独立存活）/ `both`（中心与边缘同时求值，中心负责全局视角，边缘负责断网自治） | P2 |
| **按网域下发规则** | 规则按 `network_domain_id` 分组下发，边缘网域仅下发 `edge`/`both` 规则 | P2 |
| **Recording Rules** | 预聚合规则 CRUD、启用/禁用 | P2 |
| **规则组管理** | 分组（group）、评估间隔、规则排序 | P2 |
| **静默管理** | 创建/删除静默规则（调用 Alertmanager API） | P2 |
| **通知渠道** | 飞书/钉钉/邮件/企业微信 Webhook、通知模板、告警收敛 | P2 |
| **告警升级** | 升级策略、值班组、告警降噪 | P2 |

### 3.1 中心/边缘告警灾备边界

| 维度 | 中心告警（Central） | 边缘自治告警（Edge） |
|------|---------------------|----------------------|
| 适用场景 | 跨网域聚合、复杂环比、全局 SLA | 网域内死活、本地服务宕机 |
| 求值组件 | 中心 Prometheus / vmalert | 边缘 vmagent 内置 rules / 边缘 vmalert |
| 通知通道 | 中心 Alertmanager → 企业 webhook | 边缘本地 Alertmanager → 本地飞书/钉钉 webhook |
| 断网行为 | 无法感知边缘本地指标 | 独立存活，继续告警 |

> **第一阶段决策**：MVP ~ v0.3 只实现 `scope=central` 的中心告警求值；`edge` / `both` 在边缘 Agent 支持本地 rules 评估后实现（v0.4+）。

---

## 4. MVP 阶段实现方式

### 4.1 告警规则

直接维护 `upstream/prometheus/rules.yml`：

```yaml
groups:
  - name: service-availability
    interval: 15s
    rules:
      - alert: ServiceDown
        expr: up{job="simple-agent-prod"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "服务 {{ $labels.instance }} 不可用"
```

### 4.2 Alertmanager 配置

直接维护 `upstream/prometheus/alertmanager.yml`：

```yaml
global:
  smtp_smarthost: 'localhost:587'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://metric-center:8080/api/v1/webhooks/feishu'
```

### 4.3 告警状态查看

通过 [Module 02: 查询中心](Module_02_Query_Center.md) 代理 `/api/v1/alerts`，前端展示当前告警列表。

---

## 5. 数据模型

### 5.1 告警规则（AlertingRule）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| group_id | string | 所属规则组 |
| network_domain_id | string | 所属网域 ID；`default` 表示默认网域，`*` 表示全局规则 |
| alert_name | string | 告警名称 |
| expr | string | PromQL 表达式 |
| duration | duration | `for` 持续时间 |
| severity | string | 告警级别：critical / warning / info |
| scope | enum | 求值范围：`central`（中心求值，适用于跨网域、全局预聚合、复杂环比/同比告警） / `edge`（边缘自治求值，适用于网域内死活告警，由边缘 vmagent 内置 rules / 边缘 vmalert 本地评估，断网时独立存活） / `both`（中心与边缘同时求值，中心负责全局视角，边缘负责断网自治）；第一阶段默认 `central` |
| inhibitable | bool | 是否可被网域离线抑制规则抑制；默认 `true`（针对 up/down、网络类告警），资源类告警建议 `false` |
| labels | map | 附加标签 |
| annotations | map | 告警标题与详情模板 |
| enabled | bool | 是否启用 |

### 5.2 规则组（RuleGroup）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 规则组名称 |
| network_domain_id | string | 所属网域 ID；同组规则归属同一网域 |
| interval | duration | 评估间隔 |
| rules | []AlertingRule / []RecordingRule | 规则列表 |

### 5.3 Recording Rule（RecordingRule）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| group_id | string | 所属规则组 |
| record_name | string | 预聚合指标名 |
| expr | string | PromQL 表达式 |
| enabled | bool | 是否启用 |

### 5.4 静默规则（Silence）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | Alertmanager silence ID |
| matchers | []Matcher | 标签匹配条件 |
| starts_at | datetime | 开始时间 |
| ends_at | datetime | 结束时间 |
| comment | string | 静默原因 |
| created_by | string | 创建人 |

### 5.5 通知渠道（Notifier）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 渠道名称 |
| type | enum | feishu / dingtalk / email / wecom / webhook |
| config | map | 渠道特定配置（Webhook URL、邮箱地址等） |

### 5.6 告警抑制引擎（Alert Inhibition Engine）

当某个网域整体离线时，该网域内数百台主机的 `up=0` 告警会瞬间形成告警风暴。MetricCenter 通过自动生成 Alertmanager `inhibit_rules` 来抑制此类次生告警。

**抑制规则生成逻辑：**

```yaml
inhibit_rules:
  - source_matchers:
      - alertname = "EdgeSiteOffline"
    target_matchers:
      - network_domain = "gov-cloud-a"
      - inhibitable = "true"
    equal:
      - network_domain
```

**规则说明：**

- **源告警（Source）**：`EdgeSiteOffline`，由 [Module_09](Module_09_Network_Domain_and_Edge_Agent.md) 在边缘 Agent 失联超过阈值（默认 5 分钟）时触发。
- **目标告警（Target）**：同一 `network_domain` 下且 `inhibitable=true` 的告警。
- **抑制条件**：`network_domain` 必须相同。
- **抑制范围**：只抑制可达性/网络类告警，不抑制资源类告警（如 `disk_full`、`cpu_high`）。

**设计原则：**

| 告警类型 | `inhibitable` 建议 | 示例 |
|----------|-------------------|------|
| 目标不可达 / 服务宕机 | `true` | `up == 0`、`probe_success == 0` |
| 网络连接失败 | `true` | `prometheus_target_scrape_exceeded_sample_limit` |
| 资源使用率高 | `false` | `disk_full`、`cpu_high`、`memory_high` |
| 业务自定义告警 | `false` | 应用层 SLA 告警 |

---

## 6. 与 Alertmanager 的边界

| 能力 | MetricCenter 职责 | Alertmanager 职责 |
|------|-------------------|-------------------|
| 告警规则求值 | 生成/编辑规则 | Prometheus Rule Manager 执行 |
| 告警收敛 | 未来通过 UI 配置 | 原生 group、inhibit |
| **告警抑制规则生成** | **自动生成 `inhibit_rules`（网域离线场景）** | 原生执行抑制 |
| 静默 | 未来调用 Alertmanager API | 原生 silence 管理 |
| 通知路由 | 未来生成 alertmanager.yml | 原生 route、receiver |
| 通知发送 | 可扩展 Webhook 接收器 | 飞书/钉钉/邮件等实际发送 |

---

## 7. 依赖

- `upstream/prometheus/rules/`
- `upstream/prometheus/promql/`
- `platform/config/rules/`
- `platform/gateway/proxy/`
- `platform/models/`

---

## 8. 验收标准

- [ ] MVP 阶段可通过查询中心查看当前告警状态
- [ ] 告警状态列表支持按网域（`network_domain`）筛选
- [ ] v1.0 阶段可通过 UI 创建/编辑 Alerting Rules 并生成 `rules.yml`
- [ ] Alerting Rule 数据模型包含 `network_domain_id`、`scope` 与 `inhibitable` 字段
- [ ] 生成的 `rules.yml` 按网域分组，第一阶段默认 `scope=central`
- [ ] 网域离线时，自动生成 Alertmanager `inhibit_rules` 抑制该网域的 `inhibitable=true` 告警
- [ ] 资源类告警（如 disk_full、cpu_high）默认 `inhibitable=false`，不被网域离线抑制
- [ ] v1.0 阶段可通过 UI 创建/编辑 Recording Rules
- [ ] v1.0 阶段可管理规则组与评估间隔
- [ ] v1.0 阶段可通过 UI 创建/删除静默规则
- [ ] v1.0 阶段可配置通知渠道并生成 `alertmanager.yml`
- [ ] `AlertingRule` 数据模型对 `scope` 字段的说明包含 central/edge/both 三类定义
- [ ] v0.4+ 阶段文档明确边缘自治告警的组件边界与通知通道
