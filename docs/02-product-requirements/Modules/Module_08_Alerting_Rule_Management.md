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

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **告警状态查看** | 代理 Prometheus `/api/v1/alerts`，展示当前触发的告警列表 | P1 |
| **告警规则编辑** | UI 化编辑 Alerting Rules：PromQL 条件、`for` 持续时间、告警级别、labels、annotations | P2 |
| **Recording Rules** | 预聚合规则 CRUD、启用/禁用 | P2 |
| **规则组管理** | 分组（group）、评估间隔、规则排序 | P2 |
| **静默管理** | 创建/删除静默规则（调用 Alertmanager API） | P2 |
| **通知渠道** | 飞书/钉钉/邮件/企业微信 Webhook、通知模板、告警收敛 | P2 |
| **告警升级** | 升级策略、值班组、告警降噪 | P2 |

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
| alert_name | string | 告警名称 |
| expr | string | PromQL 表达式 |
| duration | duration | `for` 持续时间 |
| severity | string | 告警级别：critical / warning / info |
| labels | map | 附加标签 |
| annotations | map | 告警标题与详情模板 |
| enabled | bool | 是否启用 |

### 5.2 规则组（RuleGroup）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 规则组名称 |
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

---

## 6. 与 Alertmanager 的边界

| 能力 | MetricCenter 职责 | Alertmanager 职责 |
|------|-------------------|-------------------|
| 告警规则求值 | 生成/编辑规则 | Prometheus Rule Manager 执行 |
| 告警收敛 | 未来通过 UI 配置 | 原生 group、inhibit |
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
- [ ] v1.0 阶段可通过 UI 创建/编辑 Alerting Rules 并生成 `rules.yml`
- [ ] v1.0 阶段可通过 UI 创建/编辑 Recording Rules
- [ ] v1.0 阶段可管理规则组与评估间隔
- [ ] v1.0 阶段可通过 UI 创建/删除静默规则
- [ ] v1.0 阶段可配置通知渠道并生成 `alertmanager.yml`
