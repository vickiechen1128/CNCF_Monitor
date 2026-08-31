# Module 08: 告警收敛与通知管理

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.5
> **产品版本覆盖**: MVP / v0.2 / v0.3 / v1.0
> **原型版本**: v1.2（v1.4 修订后待升级对齐）
> **更新日期**: 2026-08-31
> **对应原型**: `docs/prototypes/module-08/`

> **模块类型**: 扩展能力模块
> **依赖文档**: [00\_Global\_Architecture.md](../00_Global_Architecture.md)、[03\_Functional\_Architecture.md](../03_Functional_Architecture.md)、[Module\_01\_Metric\_Collection\_Center.md](Module_01_Metric_Collection_Center.md)、[Module\_02\_Query\_Center.md](Module_02_Query_Center.md)、[Module\_09\_Network\_Domain\_and\_Edge\_Config\_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)
> **目标用户**: 运维工程师、运维架构师

---

## 1. 模块目标

本模块对应 **告警收敛与通知管理域**，回答「告警如何通知、通知给谁、是否收敛、是否静默」的问题：

1. **通知路由与接收人管理（MVP / v1.0）**：维护 Alertmanager 的 `route` / `receiver` 配置，按告警标签（如 `severity`、`team`、`network_domain`）决定通知渠道与接收人。
2. **静默与抑制管理（MVP / v1.0）**：提供静默规则 UI（创建/查询/删除）和自动抑制规则（如网域离线时抑制该网域 `inhibitable=true` 的可达性风暴），调用 Alertmanager API 生效。
3. **告警状态查看（v0.3 起）**：
   - 通过 [Module\_02: 查询中心](Module_02_Query_Center.md) 代理 Prometheus `/api/v1/alerts`，展示当前由 Prometheus 规则求值产生的 firing/pending 告警实例（回答「当前触发了哪些规则」）。
   - 本模块直接代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API，展示告警经过路由、静默、抑制后的通知状态（回答「告警正在通知给谁、是否被静默/抑制」）。
4. **通知渠道与模板（v1.0）**：维护飞书/钉钉/邮件/企业微信/Webhook 等接收人模板，支撑告警通知内容格式化。

> **范围调整说明（v1.3）**：
> 
> - 本模块**不再负责**告警规则内容创作（expr / for / labels / annotations）、规则分组（RuleGroup）、`rules.yml` 生成与下发。这些职责已移交至：
>   - [Module\_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md) 负责规则编辑 UI 与规则内容记录（`MonitoringRule`）；
>   - [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md) 负责按网域分组规则、生成并下发 `rules.yml`。
> - 本模块**不再负责**告警规则生命周期管理（启用/禁用、版本、按网域聚合）。规则启用状态由 M09 在生成 `rules.yml` 时消费；规则按网域/分组聚合由 M09 内部自动完成。
> - 本模块聚焦 **Alertmanager 域**：`alertmanager.yml` 的接收人、路由、静默、抑制、通知状态。
> - `alertmanager.yml` 由本模块直接管理并触发 Alertmanager reload；MVP 单域阶段**不进入** M09 配置变更确认流程（调整频繁、风险低，详见 [5.1 节](#51-alertmanager-配置管理)）。

> **组件选型决策（v1.4，决策 49）**：告警收敛与派发组件**锁定 Alertmanager**，不引入 Grafana Alerting 或夜莺（Nightingale）：
>
> - **配置模型匹配**：Alertmanager 为声明式文件配置（`alertmanager.yml`），与本模块「UI 配置 → 生成文件 → reload」以及 M09 的配置生成流水线天然兼容；Grafana Alerting 的规则与通知策略存于 Grafana 自身 DB、由 UI 驱动，无法纳入平台配置生成闭环；夜莺是完整监控平台（自采/自存/自告警/自带 UI），引入等于整体替换架构，且其告警规则同样为 DB 驱动、不兼容文件化配置下发。
> - **租户/网域隔离**：Grafana / 夜莺自带独立查询与告警路径，会绕开 Module_02 的注入代理，v0.2 多租户启用后构成隔离缺口。
> - **易用性诉求由本模块承接**：「Alertmanager 手写 YAML 难用」的痛点正是 M08 的价值——接收人 / 路由 / 静默 / 抑制的 UI 化管理（见第 3 章），用户不接触 YAML。
> - **已有工程资产**：`upstream/alertmanager/` 子模块已入库，`make build-center` 已将其纳入一体化交付包。

---

## 2. 用户故事

> {v1.3} 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.8 节**；本模块用户故事使用模块命名空间编码（`M08-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- M08-OPS-01：配置 Alertmanager 接收人（飞书/钉钉/邮件/企业微信/Webhook），指定不同渠道名称与参数（MVP 起通过配置文件或简单 UI，v1.0 完整 UI）。
- M08-OPS-02：配置告警路由规则，按 `severity`、`team`、`network_domain` 等标签决定告警通知到哪个接收人（MVP 起）。
- M08-OPS-03：查看当前被 Alertmanager 处理的告警通知状态（active / silenced / inhibited / unprocessed），判断告警是否已路由、是否被静默/抑制（v0.3 起）。
- M08-OPS-04：创建临时静默规则，避免计划内变更或已知故障引发告警轰炸（MVP 起）。
- M08-OPS-05：查看并删除正在生效的静默规则（MVP 起）。
- M08-OPS-06：配置告警通知模板（summary / description 格式），使通知内容清晰可读（v1.0）。
- M08-OPS-07：配置告警升级策略（如 5 分钟未确认升级给主管）（v1.0）。
- M08-ARCH-01：当某个网域整体离线时，自动抑制该网域内 `inhibitable=true` 的可达性告警风暴，只保留 `EdgeSiteOffline` 根因告警（MVP 起，通过 Alertmanager `inhibit_rules` 自动生成）。
- M08-ARCH-02：在边缘网域断网场景下，边缘本地 Alertmanager 继续通过本地通知通道（本地飞书/钉钉 webhook）发送自治告警（v0.4+，与 M09 边缘配置下发配合）。

---

## 3. 核心功能

### 3.1 功能表

| 功能 | 说明 | 优先级 / 版本 |
|------|------|---------------|
| **Alertmanager 配置管理** | 维护 `alertmanager.yml`：全局参数、`route` 路由树、`receivers` 接收人、通知模板；MVP 单域阶段由 M08 直接写文件并 reload，不进入 M09 变更确认 | P0 / MVP |
| **接收人管理** | 增删改查 Alertmanager `receiver`：飞书/钉钉/邮件/企业微信/Webhook；参数校验（URL/邮箱/Token 等） | P0 / MVP（基础配置），v1.0（完整 UI） |
| **路由规则管理** | 按标签匹配条件（`severity=critical`、`team=sre`、`network_domain=gov-cloud-a` 等）配置路由，指定接收人、分组、等待/间隔/重复时间 | P0 / MVP（基础配置），v1.0（完整 UI） |
| **静默管理** | 创建/查询/删除 Alertmanager 静默规则；支持按标签匹配、起止时间、原因说明；调用 Alertmanager API 生效 | P0 / MVP |
| **告警抑制规则** | 自动生成 `inhibit_rules`：当网域整体离线时，抑制该网域 `inhibitable=true` 的告警风暴；支持手动调整抑制策略 | P0 / MVP |
| **Alertmanager 通知状态** | 代理 Alertmanager `/api/v1/alerts`，展示告警经过路由、静默、抑制后的通知状态 | P0 / v0.3 |
| **Prometheus 触发告警状态** | 由 [Module\_02: 查询中心](Module_02_Query_Center.md) 代理 Prometheus `/api/v1/alerts`，本模块不重复实现 | —（依赖 M02） |
| **通知模板管理** | 管理告警通知的 title / body 模板，支持变量（`{{ $labels }}`、`{{ $value }}`、`{{ $annotations }}`） | P2 / v1.0 |
| **告警升级与降噪** | 升级策略（未确认超时升级）、值班组、告警降噪（合并相似告警） | P2 / v1.0 |
| **边缘本地通知通道** | 断网场景下边缘 Alertmanager 使用本地 webhook 通知（v0.4+ 多网域） | P2 / v0.4+ |

### 3.2 Prometheus 告警状态 vs Alertmanager 通知状态

| 维度 | Prometheus `/api/v1/alerts` | Alertmanager `/api/v1/alerts` / 通知状态 API |
|------|------------------------------|-----------------------------------------------|
| 语义 | 「什么出了问题」—— 告警规则求值状态 | 「谁正在被通知」—— 路由、静默、抑制后的通知状态 |
| 数据来源 | Prometheus 规则管理器求值结果 | Alertmanager 接收到的告警及处理结果 |
| 包含状态 | firing / pending | active / suppressed / silenced / unprocessed |
| 模块归属 | 由 [Module\_02](Module_02_Query_Center.md) 代理 | 由 Module_08 负责集成与展示 |
| 适用场景 | 查看当前有哪些规则被触发、影响哪些对象 | 查看告警是否已路由、是否被静默、通知发送情况 |

> UI 设计建议：告警状态页可同时展示「Prometheus 当前触发告警」与「Alertmanager 通知状态」两个视图，并在图例/说明中明确区分二者语义，避免用户混淆。

### 3.3 中心/边缘告警灾备边界

| 维度 | 中心告警通知（Central） | 边缘自治告警通知（Edge，v0.4+） |
|------|-----------------------|-----------------------------------|
| 适用场景 | 跨网域聚合、复杂环比、全局 SLA | 网域内死活、本地服务宕机 |
| 求值组件 | 中心 Prometheus | 边缘 vmalert（由 M09 随配置包下发 `rules.yml`） |
| 通知组件 | 中心 Alertmanager → 企业 webhook | 边缘本地 Alertmanager → 本地飞书/钉钉 webhook |
| 断网行为 | 无法感知边缘本地指标 | 独立存活，继续通知 |
| 状态上报 | 通过 M02 代理 Prometheus `/api/v1/alerts` | 通过 M09 EdgeHeartbeat 上报，展示在 M09 Agent 状态页或 M08 边缘告警视图 |

> **第一阶段决策**：MVP ~ v0.3 只实现中心 Alertmanager 通知；`edge` 自治告警与本地通知在边缘 Agent 支持本地 rules 评估后实现（v0.4+）。

---

## 4. 与 Module_01 / Module_09 的职责边界

| 职责 | Module_01：监控策略与指标管理 | Module_09：网域与边缘配置中心 | Module_08：告警收敛与通知管理 |
|------|------------------------------|------------------------------|------------------------------|
| 规则内容创作（expr / for / labels / annotations） | ✅ | ❌ | ❌ |
| 规则记录持久化（`MonitoringRule`） | ✅ | ❌ | ❌ |
| 规则启用/禁用状态 | ✅（字段） | ✅（参与配置生成） | ❌ |
| 规则按网域分组 / `rules.yml` 生成与下发 | ❌ | ✅ | ❌ |
| 规则求值 | ❌ | ❌ | ❌（Prometheus / vmalert 原生执行） |
| Alertmanager 配置（`alertmanager.yml`） | ❌ | ❌ | ✅ |
| 静默规则管理 | ❌ | ❌ | ✅ |
| 告警抑制规则（`inhibit_rules`） | ❌ | ❌ | ✅（自动生成 + 手动策略） |
| 通知接收人管理 | ❌ | ❌ | ✅ |
| 通知状态查询（Alertmanager） | ❌ | ❌ | ✅ |
| Prometheus 触发告警状态查询 | ❌ | ❌ | ❌（由 M02 代理） |
| 边缘告警组件状态展示 | ❌ | ✅（Agent 状态页） | ✅（边缘告警视图，可选） |

> **数据流**：
> 1. Module_01 编辑 UI → `MonitoringRule` 记录 → Module_09 按网域分组/生成 `rules.yml` → Prometheus / 边缘 vmalert 求值。
> 2. Prometheus 告警 → Module_08 管理的 Alertmanager → 按路由/静默/抑制 → 通知接收人。
> 3. `alertmanager.yml` 由 Module_08 直接管理并触发 reload；MVP 单域阶段不进入 Module_09 配置变更确认流程。

---

## 5. 实现方式

### 5.1 Alertmanager 配置管理

MVP 阶段直接维护 `upstream/prometheus/alertmanager.yml`（或中心 Alertmanager 实例的指定配置路径），Module_08 提供基于接收人/路由/静默/抑制策略的生成能力：

```yaml
global:
  smtp_smarthost: 'localhost:587'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'sre-critical'
      group_by: ['alertname', 'network_domain']
      continue: true
    - match_re:
        network_domain: gov-cloud-a|gov-cloud-b
      receiver: 'gov-ops'

receivers:
  - name: 'default'
    webhook_configs:
      - url: 'http://metric-center:8080/api/v1/webhooks/feishu'
  - name: 'sre-critical'
    webhook_configs:
      - url: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx'
  - name: 'gov-ops'
    dingtalk_configs:
      - webhook_url: 'https://oapi.dingtalk.com/robot/send?access_token=xxx'

inhibit_rules:
  - source_matchers:
      - alertname = "EdgeSiteOffline"
    target_matchers:
      - network_domain = "gov-cloud-a"
      - inhibitable = "true"
    equal:
      - network_domain
```

> **MVP 单域直接 reload**：
> - `alertmanager.yml` 由 Module_08 写文件后通过 SIGHUP 或 HTTP `POST /-/reload` 触发 Alertmanager 重载；
> - 该文件**不进入** Module_09 的 `ConfigDraft → 人工确认 → ConfigVersion` 流程；
> - 原因：通知路由/接收人/静默调整频繁、影响面可控（仅影响告警体验，不影响采集/规则求值），且 M08 是 Alertmanager 配置的唯一 Owner。

> **v0.4+ 多网域边缘**：
> - 中心 Alertmanager 配置仍由 M08 直接管理；
> - 边缘 Alertmanager 配置文件（如各网域独立 `alertmanager.yml`）可由 M08 生成后，通过 M09 配置包下发到边缘，或边缘首次部署时由 M08 初始化脚本推送；
> - 边缘静默由边缘 Alertmanager 本地处理，M08 提供静默管理代理（P2）。

### 5.2 静默规则管理

静默规则通过调用 Alertmanager API 创建/删除：

```http
POST /api/v1/silences
Content-Type: application/json

{
  "matchers": [
    {"name": "alertname", "value": "HighCPUUsage", "isRegex": false},
    {"name": "instance", "value": "10.0.1.11:9100", "isRegex": false}
  ],
  "startsAt": "2026-08-15T10:00:00Z",
  "endsAt": "2026-08-15T12:00:00Z",
  "createdBy": "ops-chen",
  "comment": "计划内变更：数据库迁移"
}
```

M08 提供 UI 表单封装：
- 选择告警标签键/值（可从当前 Alertmanager 活跃告警中联想）；
- 选择起止时间（支持相对时间如「1 小时后」）；
- 填写原因；
- 列表展示活跃静默，支持删除。

> **静默 matcher 授权校验（v1.5，决策 56）**：Alertmanager 静默**全局生效**——租户 A 的宽 matcher 静默会摁掉租户 B 的告警，构成跨租户写武器。因此创建静默时 M08 必须在**服务端校验** matcher 收敛于当前用户的授权网域集合（越权 matcher 直接拒绝），不得依赖前端表单约束。MVP 单租户单网域阶段校验恒通过（机制骨架保留）。

### 5.3 告警抑制规则

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

- **源告警（Source）**：`EdgeSiteOffline`，由 [Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 在边缘 Agent 失联超过阈值（默认 5 分钟）时触发。
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

> `inhibitable` 字段来自 Module_01 的 `MonitoringRule.labels` 或 `annotations` 约定（建议在规则编辑 UI 中默认提供并允许用户覆盖）。M08 生成 `inhibit_rules` 时消费该字段。

### 5.4 告警状态查看

- **页面归属（v1.5，决策 55）**：「告警状态页」归属**本模块**（告警域工作台），用户动线为「什么出了问题 → 通知了谁/是否被静默 → 加静默/调路由」的连续任务链；Module_02 只交付注入代理 API，不出告警相关页面。
- **Prometheus 当前触发告警（v0.3 起）**：由 [Module\_02: 查询中心](Module_02_Query_Center.md) 代理 `/api/v1/alerts`（已注入租户/网域上下文），本模块告警状态页只读消费，展示当前 firing/pending 告警列表，支持按 `network_domain` 筛选。
- **Alertmanager 通知状态**：由 Module_08 直接代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API，展示告警经过路由、静默、抑制后的通知状态。**授权过滤（v1.5，决策 56）**：代理时必须在**服务端**强制注入当前用户的授权网域集合 filter（不信任前端传参）；授权集合 = 全部网域时不附加 filter。前端筛选只承担 UX，不构成权限。
- **边缘本地告警状态（P2）**：通过 [Module\_09](Module_09_Network_Domain_and_Edge_Config_Center.md) EdgeHeartbeat 上报，展示在 Module_09 Agent 状态页或 Module_08 边缘告警视图，不归 Module_02 代理。

---

## 6. 数据模型

### 6.1 通知接收人（Receiver）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| id | string | 接收人 ID | 唯一标识 |
| name | string | 接收人名称 | Alertmanager `receiver` name，如 `sre-critical`、`default` |
| type | enum | 渠道类型 | feishu / dingtalk / email / wecom / webhook |
| config | map | 渠道配置 | 渠道特定配置：URL、Token、邮箱地址、签名密钥等 |
| enabled | bool | 启用状态 | 是否启用 |
| created\_at / updated\_at | datetime | 仅技术信息 | 创建/更新时间 |

### 6.2 路由规则（Route）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| id | string | 路由 ID | 唯一标识 |
| parent\_id | string | 父路由 | 路由树父节点；根路由为空 |
| name | string | 路由名称 | 展示名称 |
| matchers | []Matcher | 匹配条件 | 标签匹配条件，如 `severity=critical`、`team=sre` |
| receiver\_id | string | 接收人 | 命中后通知的 Receiver |
| group\_by | []string | 分组键 | 如 `alertname`、`severity`、`network_domain` |
| group\_wait | duration | 初次等待 | 告警分组后首次发送等待时间 |
| group\_interval | duration | 分组间隔 | 同一组告警发送间隔 |
| repeat\_interval | duration | 重复间隔 | 同一告警重复通知间隔 |
| continue | bool | 继续匹配 | 命中后是否继续匹配子路由 |
| order | int | 排序 | 同层级路由优先级 |
| enabled | bool | 启用状态 | 是否启用 |

### 6.3 静默规则（Silence）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| id | string | 静默 ID | Alertmanager silence ID |
| matchers | []Matcher | 匹配条件 | 标签匹配条件 |
| starts\_at | datetime | 开始时间 | 静默生效时间 |
| ends\_at | datetime | 结束时间 | 静默失效时间 |
| comment | string | 静默原因 | 创建原因 |
| created\_by | string | 创建人 | 创建人 |
| status | enum | 状态 | active / expired / pending |

### 6.4 抑制规则（InhibitionRule）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| id | string | 抑制规则 ID | 唯一标识 |
| source\_matchers | []Matcher | 源告警匹配 | 触发抑制的根因告警匹配条件 |
| target\_matchers | []Matcher | 目标告警匹配 | 被抑制的目标告警匹配条件 |
| equal | []string | 等同标签 | 源与目标必须相同的标签键，如 `network_domain` |
| is\_builtin | bool | 内置规则 | 是否平台自动生成（如 EdgeSiteOffline 抑制规则） |
| enabled | bool | 启用状态 | 是否启用 |

### 6.5 Matcher 结构

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | 标签名 |
| value | string | 标签值 |
| is\_regex | bool | 是否正则匹配 |
| is\_equal | bool | 是否等于（false 表示取反） |

### 6.6 Alertmanager 配置版本（AlertmanagerConfigVersion）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| id | string | 版本 ID | 唯一标识 |
| content | text | 配置内容 | 生成的 `alertmanager.yml` 完整内容 |
| checksum | string | 校验和 | 配置内容 sha256 |
| applied\_at | datetime | 生效时间 | 写入并 reload 成功时间 |
| applied\_by | string | 操作人 | 应用人 |
| status | enum | 状态 | applied / failed |
| error\_msg | string | 错误信息 | reload 失败原因 |

> 说明：M08 自身维护 `alertmanager.yml` 配置版本，用于审计与回滚；MVP 阶段不接入 M09 的 `ConfigVersion` 流程。

---

## 7. 与 Alertmanager 的边界

| 能力 | MetricCenter 职责 | Alertmanager 职责 |
|------|-------------------|-------------------|
| 告警规则求值 | 不介入 | Prometheus Rule Manager / vmalert 执行 |
| 告警收敛 | 通过 UI 配置生成 `route` / `group_by` | 原生 group 执行 |
| 告警抑制规则生成 | **自动生成 `inhibit_rules`（网域离线场景）** | 原生执行抑制 |
| 静默 | 调用 Alertmanager API 创建/删除/查询 | 原生 silence 管理 |
| 通知路由 | 生成 `alertmanager.yml` 的 `route` / `receiver` | 原生 route 执行 |
| 通知发送 | 可扩展 Webhook 接收器 | 飞书/钉钉/邮件等实际发送 |
| 通知状态查询 | Module_08 代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API | 原生提供告警处理状态 |
| `rules.yml` 生成与下发 | 不介入 | 不介入 |

---

## 8. 依赖

- [Module\_01: 监控策略与指标管理](Module_01_Metric_Collection_Center.md)（规则内容来源；`inhibitable` 等标签约定来自规则编辑）
- [Module\_02: 查询中心](Module_02_Query_Center.md)（v0.3 起代理 Prometheus `/api/v1/alerts`，展示当前 firing/pending 告警实例）
- [Module\_09: 网域与边缘配置中心](Module_09_Network_Domain_and_Edge_Config_Center.md)（v0.4+ 边缘 Alertmanager 配置分发；EdgeAgent 心跳上报边缘本地告警状态）
- `upstream/prometheus/alertmanager/`（Alertmanager 二进制与配置）
- `platform/config/alertmanager/`（Alertmanager 配置生成与版本管理）
- `platform/gateway/proxy/`（代理 Alertmanager API）
- `platform/models/`

---

## 9. 验收标准

### 9.1 用户验收（用户可在 UI 感知/操作）

- [ ] {P0} 模块名称与文档目录已更新为「告警收敛与通知管理」。
- [ ] {P0} 可配置 Alertmanager 接收人（至少支持 webhook / 飞书 / 钉钉 / 邮件 / 企业微信中的一种）。
- [ ] {P0} 可配置告警路由规则，按标签匹配并指定接收人、分组、等待/间隔/重复时间。
- [ ] {P0} 可创建/查询/删除静默规则，并查看静默规则生效状态。
- [ ] {P0} 当网域整体离线时，自动生成 `inhibit_rules` 抑制该网域 `inhibitable=true` 的告警风暴（只保留根因告警）。
- [ ] {P0} 可查看 Alertmanager 通知状态（active / silenced / inhibited / unprocessed）。
- [ ] {P0} `alertmanager.yml` 由 M08 直接写文件并 reload，MVP 单域阶段不进入 M09 配置变更确认流程。
- [ ] {v0.3} 可通过 [Module\_02](Module_02_Query_Center.md) 查看当前 Prometheus 触发告警状态（firing / pending）。
- [ ] {v1.0} 可配置通知模板与告警升级策略。
- [ ] {v0.4+} 支持边缘本地 Alertmanager 通知通道配置（P2）。

### 9.2 技术验收（后端/契约可验证）

- [ ] {P0} M08 生成的 `alertmanager.yml` 通过 `amtool check-config` 校验。
- [ ] {P0} 修改接收人/路由/静默/抑制策略后，M08 触发 Alertmanager reload 成功。
- [ ] {P0} 静默规则通过 Alertmanager API 创建/删除，状态同步正确。
- [ ] {P0} `inhibit_rules` 生成逻辑正确：源告警 `EdgeSiteOffline` 抑制同 `network_domain` 下 `inhibitable=true` 的目标告警。
- [ ] {P0} Alertmanager `/api/v1/alerts` 代理接口返回通知状态，并正确映射为 active / silenced / inhibited / unprocessed。
- [ ] {P0} M08 不生成 `rules.yml`、不管理 `MonitoringRule` 内容；规则相关数据由 M01 写入、M09 生成配置。
- [ ] {P0} M08 配置版本 `AlertmanagerConfigVersion` 记录每次 `alertmanager.yml` 变更，支持审计与回滚。
- [ ] {P0} Alertmanager `/api/v1/alerts` 代理在服务端强制注入当前用户授权网域集合 filter（授权=全部网域时不附加），不信任前端传参（决策 56）。
- [ ] {P0} 创建静默规则时服务端校验 matcher 收敛于当前用户授权网域集合，越权 matcher 拒绝（决策 56）。
- [ ] {v0.4+} 边缘 Alertmanager 配置可随 M09 配置包下发或由 M08 初始化脚本推送（P2）。

---

## 10. 术语映射（用户词汇表）

| 后端术语 | 用户语言 | 说明 |
|----------|----------|------|
| `Receiver` | 接收人 / 通知渠道 | Alertmanager 通知目标，如飞书机器人、钉钉机器人、邮件组 |
| `Route` | 路由规则 | 按告警标签决定通知到哪个接收人、如何分组、何时重复 |
| `Silence` | 静默规则 | 临时屏蔽匹配告警的通知，常用于计划内变更 |
| `InhibitionRule` | 抑制规则 | 当根因告警存在时，自动抑制相关次生告警，减少告警风暴 |
| `AlertmanagerConfigVersion` | 配置版本 | M08 自身维护的 `alertmanager.yml` 版本记录，用于审计回滚 |
| `alertmanager.yml` | Alertmanager 配置 | 由 M08 管理，包含路由、接收人、抑制、静默模板等 |
| `active` / `silenced` / `inhibited` / `unprocessed` | 通知状态 | Alertmanager 对告警的处理状态 |
| `MonitoringRule` | 告警 / 记录规则 | 由 M01 负责内容创作，M08 不直接管理 |
| `rules.yml` | 告警规则文件 | 由 M09 按网域分组生成并下发，M08 不生成 |

---

## Change Log

> **Change Log 定位**：本表记录业务侧沟通决策与文档变更（保留最近 3 版一句话摘要；v1.2 及以前逐版详情已迁移至 `docs/05-execution-records/module-08/design-decisions.md`「Change Log（完整历史）」小节）；开发契约见 6.x 数据模型 / 9 验收标准 / 10 术语映射。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
| v1.5 | 2026-08-31 | 修改 | 决策 55/56 落版（M02/M08 告警状态边界 + 授权集合过滤）：①§5.4 明确**告警状态页归属本模块**（告警域工作台，M02 只交付注入代理 API）；②§5.4 补 Alertmanager 通知状态代理**服务端授权集合过滤**（不信任前端传参，授权=全部网域时不附加 filter）；③§5.2 补**静默 matcher 授权校验**（静默全局生效，越权 matcher 服务端拒绝，防跨租户写武器）；④§9.2 技术验收补对应两条；⑤Change Log 去章节编号并收敛至 3 版（v1.2 及以前迁移 design-decisions.md）；设计思路全文见 `docs/05-execution-records/module-02/m02-vs-m08-boundary-and-injection-design.md`；原型待对齐 | MVP / v0.3 | 设计中 |
| v1.4 | 2026-08-31 | 新增 | 决策 49 落版（告警收敛与派发组件选型锁定）：§1 新增「组件选型决策」——锁定 Alertmanager，明确不引入 Grafana Alerting（规则/通知策略 DB 驱动、UI 管理，不兼容配置生成流水线）与夜莺（完整监控平台，引入即整体替换架构，规则同样 DB 驱动）；两者自带独立查询路径会绕开 M02 注入代理，构成租户隔离缺口；「Alertmanager 难用」的易用性诉求由 M08 UI 化管理承接；原型待对齐 | 模块目标 | 无版本变更 | 设计中 |
| v1.3 | 2026-08-15 | 重大修改 | M01/M08/M09 告警规则职责三轴重构：①模块名称由「告警规则管理」改为「告警收敛与通知管理」；②规则内容创作、规则记录、`rules.yml` 生成与下发全部剥离给 M01/M09；③M08 聚焦 Alertmanager 配置（路由/接收人/静默/抑制）、通知状态查询、告警抑制；④`alertmanager.yml` 由 M08 直接写文件并 reload，MVP 单域不进入 M09 配置变更确认；⑤重写 1/2/3/4/5/6/8/9/10/11 章节；⑥数据模型由 `AlertingRule`/`RuleGroup`/`RecordingRule` 改为 `Receiver`/`Route`/`Silence`/`InhibitionRule`/`AlertmanagerConfigVersion` | MVP / v0.3 / v1.0 | 设计中 |
