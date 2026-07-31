# Module 08: 告警规则管理

> **模块类型**: 扩展能力模块  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[Module_01 监控策略与指标管理](Module_01_Metric_Collection_Center.md)、[Module_02 查询中心](Module_02_Query_Center.md)、[Module_09 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)  
> **目标用户**: 运维工程师、运维架构师  
> **版本**: v1.3  
> **更新日期**: 2026-07-31

---

## 1. 模块目标

管理 Prometheus 告警规则（Alerting Rules / Recording Rules）的生命周期、规则分组与下发，以及 Alertmanager 的静默、抑制、通知路由能力。

> **范围调整说明**：本模块保留「告警规则管理」名称，但规则编辑 UI 已移交 [Module_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md)。Module_01 负责提供规则编辑 UI（类 YAML 表单 + PromQL 校验 + 指标实时预览）并产出规则记录；Module_08 负责消费规则记录，完成规则分组、启用/禁用、生命周期管理、`rules.yml` 生成、Alertmanager 配置生成及下发协同。
>
> **告警状态查询边界说明**：
> - [Module_02: 查询中心](Module_02_Query_Center.md) 负责代理 **Prometheus `/api/v1/alerts`**，展示当前由 Prometheus 规则求值产生的 firing/pending 告警实例，回答「当前触发了哪些规则、哪些对象有问题」。
> - **Module_08 负责 Alertmanager 集成**：通知路由、分组、静默、抑制、接收人及通知状态，回答「告警正在通知给谁、是否被静默/抑制」。
> - Module_08 可暴露自身的 Alertmanager `/api/v1/alerts` 代理或通知状态 API，供 UI 展示「通知状态」。
> - 多网域场景下，**边缘本地告警**（断网场景，P2）由边缘本地 Alertmanager 处理，其状态通过 [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 的 EdgeHeartbeat 上报，并在 Module_09 Agent 状态页或 Module_08 边缘告警视图中展示，不归 Module_02 代理。
>
> **MVP 阶段**：告警规则优先通过 Module_01 的编辑 UI 生成并持久化，Module_08 按网域/规则组聚合后生成 `rules.yml`，同时允许高级工程师对生成的文件进行手工兜底修改；Alertmanager 配置直接维护 `alertmanager.yml`，Module_08 提供基于模板的生成能力。MetricCenter 通过 [Module_02](Module_02_Query_Center.md) 代理 Prometheus `/api/v1/alerts` 查看**当前触发告警状态**，Module_08 负责 Alertmanager 通知状态与静默/抑制配置。  
> **v0.4+ 阶段**：支持边缘告警规则按 `scope=edge` / `scope=both` 下发到边缘 Agent，实现网域内自治告警。  
> **v1.0 阶段**：提供静默管理 UI、通知渠道与接收人配置，生成 `alertmanager.yml`；对接 ITSM/ITIL 事件字段映射。

---

## 2. 用户故事

- OPS-07：查看当前告警状态
- OPS-09：通过 Module_01 创建/编辑告警规则，由 Module_08 完成分组、持久化与下发
- OPS-10：未来配置告警静默与通知接收人
- ARCH-06：统一管理告警规则版本与下发
- ARCH-09：按网域配置告警规则（未来）
- ARCH-10：配置中心/边缘告警规则求值范围（未来）

---

## 3. 核心功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| **告警状态查看（Prometheus）** | 通过 [Module_02](Module_02_Query_Center.md) 代理 Prometheus `/api/v1/alerts`，展示当前由 Prometheus 规则求值产生的 firing/pending 告警实例，支持按网域筛选 | P1 |
| **Alertmanager 通知状态** | Module_08 代理 Alertmanager `/api/v1/alerts` 或提供通知状态 API，展示告警经过路由、静默、抑制后的通知状态 | P1 |
| **告警规则编辑 UI** | UI 由 [Module_01](Module_01_Metric_Collection_Center.md) 提供；Module_08 负责规则记录的持久化、分组与下发 | P1 |
| **告警规则生命周期管理** | 规则分组（RuleGroup）、启用/禁用、版本管理、按网域聚合 | P1 |
| **基于指标目录自动生成规则 {v0.4+}** | 根据 CI 类型、Exporter、指标模板自动推荐/生成告警规则（CI→Exporter→Metric→Rule 闭环） | P2 |
| **规则求值范围（Scope）** | 规则求值位置：`central`（中心，适用于跨网域、全局预聚合、复杂环比/同比告警） / `edge`（边缘自治，适用于网域内死活告警，由边缘 Agent 本地评估，断网时独立存活） / `both`（中心与边缘同时求值，中心负责全局视角，边缘负责断网自治） | P2 |
| **按网域下发规则** | 规则按 `network_domain_id` 分组下发，边缘网域仅下发 `edge`/`both` 规则 | P2 |
| **Recording Rules** | 预聚合规则 CRUD、启用/禁用 | P2 |
| **规则组管理** | 分组（group）、评估间隔、规则排序 | P2 |
| **静默管理** | 创建/删除静默规则（调用 Alertmanager API） | P2 |
| **通知渠道** | 飞书/钉钉/邮件/企业微信 Webhook、通知模板、告警收敛 | P2 |
| **告警升级** | 升级策略、值班组、告警降噪 | P2 |

### 3.1 Prometheus 告警 vs Alertmanager 通知状态

| 维度 | Prometheus `/api/v1/alerts` | Alertmanager `/api/v1/alerts` / 通知状态 API |
|------|----------------------------|-----------------------------------------------|
| 语义 | 「什么出了问题」—— 告警规则求值状态 | 「谁正在被通知」—— 路由、静默、抑制后的通知状态 |
| 数据来源 | Prometheus 规则管理器求值结果 | Alertmanager 接收到的告警及处理结果 |
| 包含状态 | firing / pending | active / suppressed / silenced / unprocessed |
| 模块归属 | 由 [Module_02](Module_02_Query_Center.md) 代理 | 由 Module_08 负责集成与展示 |
| 适用场景 | 查看当前有哪些规则被触发、影响哪些对象 | 查看告警是否已路由、是否被静默、通知发送情况 |

> UI 设计建议：告警状态页可同时展示「Prometheus 当前触发告警」与「Alertmanager 通知状态」两个视图，并在图例/说明中明确区分二者语义，避免用户混淆。

### 3.2 中心/边缘告警灾备边界

| 维度 | 中心告警（Central） | 边缘自治告警（Edge） |
|------|---------------------|----------------------|
| 适用场景 | 跨网域聚合、复杂环比、全局 SLA | 网域内死活、本地服务宕机 |
| 求值组件 | 中心 Prometheus / vmalert | 边缘 vmagent 内置 rules / 边缘 vmalert |
| 通知通道 | 中心 Alertmanager → 企业 webhook | 边缘本地 Alertmanager → 本地飞书/钉钉 webhook |
| 断网行为 | 无法感知边缘本地指标 | 独立存活，继续告警 |
| 状态上报 | 通过 Module_02 代理 Prometheus `/api/v1/alerts` | 通过 Module_09 EdgeHeartbeat 上报，展示在 Module_09 Agent 状态页或 Module_08 边缘告警视图 |

> **第一阶段决策**：MVP ~ v0.3 只实现 `scope=central` 的中心告警求值；`edge` / `both` 在边缘 Agent 支持本地 rules 评估后实现（v0.4+）。

---

## 4. 与 Module_01 的职责边界

| 职责 | Module_01：监控策略与指标管理 | Module_08：告警规则管理 |
|------|------------------------------|------------------------|
| 规则编辑 UI | 提供类 YAML 表单、PromQL 校验、指标实时预览 | 不提供 |
| 规则记录产出 | 作为规则权威来源写入规则记录 | 消费规则记录 |
| 规则持久化 | 不直接负责 | 负责规则记录的持久化存储与版本管理 |
| 规则分组 / 求值范围 / 启用禁用 | 不参与 | 负责 RuleGroup 管理与规则生命周期控制 |
| `rules.yml` 生成 | 不参与 | 按 RuleGroup 与 `network_domain_id` 聚合生成 |
| Alertmanager 配置 | 不参与 | 生成 `alertmanager.yml`、静默、抑制规则、通知渠道 |
| Prometheus 告警状态查看 | 不参与 | 由 [Module_02](Module_02_Query_Center.md) 代理 Prometheus `/api/v1/alerts` 展示 |
| Alertmanager 通知状态查看 | 不参与 | 由 Module_08 提供 Alertmanager 代理或通知状态 API |

> **数据流**：Module_01 编辑 UI → 规则记录 → Module_08 规则生命周期管理 → Module_09 网域与边缘配置中心生成/预览/下发 `rules.yml`。

---

## 5. MVP 阶段实现方式

### 5.1 告警规则

MVP 阶段告警规则优先由 [Module_01](Module_01_Metric_Collection_Center.md) 的规则编辑 UI 产出，Module_08 按规则组与网域聚合后生成 `upstream/prometheus/rules.yml`。

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

> **手工兜底**：针对高级场景（复杂模板、原生 PromQL 高级语法），允许运维工程师直接修改 `upstream/prometheus/rules.yml`。平台只保证「通过 UI 下发的配置」一致，手工修改作为本地兜底，不强制 reconcile。

### 5.2 Alertmanager 配置

MVP 阶段直接维护 `upstream/prometheus/alertmanager.yml`，Module_08 提供基于通知渠道与接收人模板的生成辅助：

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

### 5.3 告警状态查看

- **Prometheus 当前触发告警**：由 [Module 02: 查询中心](Module_02_Query_Center.md) 代理 `/api/v1/alerts`，前端展示当前 firing/pending 告警列表，支持按 `network_domain` 筛选。
- **Alertmanager 通知状态**：由 Module_08 直接代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API，展示告警经过路由、静默、抑制后的通知状态。
- **边缘本地告警状态**（P2）：通过 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) EdgeHeartbeat 上报，展示在 Module_09 Agent 状态页或 Module_08 边缘告警视图，不归 Module_02 代理。

---

## 6. 数据模型

### 6.1 告警规则（AlertingRule）

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
| source_module | string | 规则来源，默认 `module_01`；手工兜底场景可标记为 `manual` |

### 6.2 规则组（RuleGroup）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 规则组名称 |
| network_domain_id | string | 所属网域 ID；同组规则归属同一网域 |
| interval | duration | 评估间隔 |
| rules | []AlertingRule / []RecordingRule | 规则列表 |

### 6.3 Recording Rule（RecordingRule）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| group_id | string | 所属规则组 |
| record_name | string | 预聚合指标名 |
| expr | string | PromQL 表达式 |
| enabled | bool | 是否启用 |

### 6.4 静默规则（Silence）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | Alertmanager silence ID |
| matchers | []Matcher | 标签匹配条件 |
| starts_at | datetime | 开始时间 |
| ends_at | datetime | 结束时间 |
| comment | string | 静默原因 |
| created_by | string | 创建人 |

### 6.5 通知渠道（Notifier）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 渠道名称 |
| type | enum | feishu / dingtalk / email / wecom / webhook |
| config | map | 渠道特定配置（Webhook URL、邮箱地址等） |

### 6.6 告警抑制引擎（Alert Inhibition Engine）

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

- **源告警（Source）**：`EdgeSiteOffline`，由 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 在边缘 Agent 失联超过阈值（默认 5 分钟）时触发。
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

### 6.7 ITIL 事件字段映射

> MVP 阶段**不做 ITSM/ITIL 事件对接**，本节规范在 v1.0+ ITSM 产品选型确定后落地。

当告警需要同步到 ITSM/ITIL 事件系统时，MetricCenter 按下表规则将 Prometheus 告警字段映射为 ITIL 事件字段。ITSM 服务目录必须通过显式 CMDB 业务/模块路径与监控对象关联，禁止绕过 CMDB 直接定义业务归属。

| ITIL 事件字段 | 来源 | 说明 |
|---------------|------|------|
| **严重等级（Severity）** | Prometheus 告警 label `severity` | 如 `critical` / `warning` / `info`；告警规则必须保留或注入该 label |
| **影响范围（Impact Scope）** | CMDB 拓扑 | 取自告警对象关联的 `cmdb_business_path` / `cmdb_module_path` / `network_domain_id`，由 [Module_07](Module_07_Monitoring_Object_Management.md#52-%E8%B5%84%E6%BA%90%E5%9F%BA%E7%A1%80%E7%BB%93%E6%9E%84resource) 提供 |
| **接收人（Receiver）** | 告警规则 `receiver` | Alertmanager 路由命中后的 receiver 名称；未来扩展为 ITSM 通知人 |
| **负责人（Owner）** | CMDB 维护人 + ITSM 值班组 | 优先取 `cmdb_maintainer`；若为空或需升级，则按 ITSM 值班策略叠加 |
| **服务目录（Service Catalog）** | ITSM 服务目录 ↔ CMDB 业务/模块路径显式映射 | 服务目录项必须绑定到 `cmdb_business_path` 或 `cmdb_module_path`；告警时通过路径匹配定位服务目录 |

> **约束**：
> - 告警规则的 labels/annotations 中应保留 `severity`、`network_domain`、`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer`。
> - ITSM 侧禁止独立维护一套业务树；服务目录条目必须显式映射到 CMDB 路径。

---

## 7. 与 Alertmanager 的边界

| 能力 | MetricCenter 职责 | Alertmanager 职责 |
|------|-------------------|-------------------|
| 告警规则求值 | 生成/编辑规则 | Prometheus Rule Manager 执行 |
| 告警收敛 | 通过 UI 配置生成 | 原生 group、inhibit |
| **告警抑制规则生成** | **自动生成 `inhibit_rules`（网域离线场景）** | 原生执行抑制 |
| 静默 | 调用 Alertmanager API | 原生 silence 管理 |
| 通知路由 | 生成 alertmanager.yml | 原生 route、receiver |
| 通知发送 | 可扩展 Webhook 接收器 | 飞书/钉钉/邮件等实际发送 |
| 通知状态查询 | Module_08 代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API | 原生提供告警处理状态 |

---

## 8. 依赖

- [Module_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md)（规则编辑 UI 与规则记录来源）
- [Module_02: 查询中心](Module_02_Query_Center.md)（代理 Prometheus `/api/v1/alerts`，展示当前 firing/pending 告警实例）
- [Module_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)（配置生成 / 预览 / 下发；边缘 Agent 心跳上报边缘本地 Alertmanager 状态）
- `upstream/prometheus/rules/`
- `upstream/prometheus/promql/`
- `platform/config/rules/`
- `platform/gateway/proxy/`
- `platform/models/`

---

## 9. 验收标准

- [ ] MVP 阶段可通过 [Module_02](Module_02_Query_Center.md) 查看当前 Prometheus 触发告警状态
- [ ] Prometheus 告警状态列表支持按网域（`network_domain`）筛选
- [ ] Module_08 提供 Alertmanager 通知状态查询能力（代理 `/api/v1/alerts` 或封装通知状态 API）
- [ ] 告警规则编辑 UI 由 [Module_01](Module_01_Metric_Collection_Center.md) 提供，Module_08 负责规则记录的持久化、分组与下发
- [ ] Module_08 可按 RuleGroup 与 `network_domain_id` 聚合生成 `rules.yml`
- [ ] 支持手工兜底修改 `rules.yml`，平台不强制 reconcile 但标识 `source_module=manual`
- [ ] Alerting Rule 数据模型包含 `network_domain_id`、`scope` 与 `inhibitable` 字段
- [ ] 生成的 `rules.yml` 按网域分组，第一阶段默认 `scope=central`
- [ ] 网域离线时，自动生成 Alertmanager `inhibit_rules` 抑制该网域的 `inhibitable=true` 告警
- [ ] 资源类告警（如 disk_full、cpu_high）默认 `inhibitable=false`，不被网域离线抑制
- [ ] v1.0 阶段可通过 UI 创建/编辑 Recording Rules
- [ ] v1.0 阶段可管理规则组与评估间隔
- [ ] v1.0 阶段可通过 UI 创建/删除静默规则
- [ ] v1.0 阶段可配置通知渠道并生成 `alertmanager.yml`
- [ ] `AlertingRule` 数据模型对 `scope` 字段的说明包含 central/edge/both 三类定义
- [ ] {v0.4+} 支持基于 CI/Exporter/指标模板自动生成告警规则
- [ ] v0.4+ 阶段文档明确边缘自治告警的组件边界与通知通道，以及边缘本地告警状态通过 Module_09 心跳上报
- [ ] {v1.0+} 告警字段可按 6.7 节规则映射为 ITIL 事件字段
