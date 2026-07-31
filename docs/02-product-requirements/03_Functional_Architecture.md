# MetricCenter 功能架构全景图

> 文档类型：产品需求文档 / 功能架构  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[00_Global_Architecture.md](00_Global_Architecture.md)  
> 更新日期：2026-07-31

---

## 1. 设计原则

1. **控制面与数据面分离**：MetricCenter 负责管理侧，Prometheus 负责执行侧
2. **不硬 Fork Prometheus**：复用其成熟能力，通过标准接口（HTTP API、配置下发、Remote Write）交互
3. **MVP 聚焦**：先跑通「对象 → 策略 → 配置 → 采集 → 查询 → 告警状态」主链路
4. **对象-策略-配置解耦**：监控对象（Module_07）、监控策略（Module_01）、配置中心（Module_09）三层独立演进
5. **资源管理最小化**：MVP 仅保留必要字段，后续接入腾讯蓝鲸等外部 CMDB

---

## 2. 控制面 vs 数据面分层

```
┌─────────────────────────────────────────────────────────────────┐
│                     控制面（Control Plane）                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              MetricCenter 平台层                          │  │
│  │  · Web 门户（ui-custom/）                                  │  │
│  │  · API Gateway / 查询代理（platform/gateway/）             │  │
│  │  · 监控对象管理（platform/resource/）                      │  │
│  │  · 监控策略与指标管理（platform/strategy/）                │  │
│  │  · 网域与边缘配置中心（platform/edge/、platform/configgen/）│  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼ 生成 prometheus.yml / rules.yml
┌─────────────────────────────────────────────────────────────────┐
│                      数据面（Data Plane）                        │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Prometheus      │  │ Blackbox        │  │ Alertmanager    │ │
│  │ Server          │  │ Exporter        │  │                 │ │
│  │ · 服务发现      │  │ · HTTP/TCP 拨测 │  │ · 告警收敛      │ │
│  │ · 指标抓取      │  │ · 存活性探测    │  │ · 静默/抑制     │ │
│  │ · TSDB 存储     │  │                 │  │ · 通知路由      │ │
│  │ · PromQL 查询   │  │                 │  │                 │ │
│  │ · 告警规则求值  │  │                 │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Prometheus 原生能力映射

| Prometheus 生态能力 | 在 MetricCenter 中的归属 | 控制面/数据面 |
|---------------------|--------------------------|---------------|
| `scrape_configs` / `static_configs` | 监控策略与指标管理 → ScrapeJob 管理 | 控制面生成，数据面执行 |
| `relabel_configs` / `metric_relabel_configs` | 监控对象管理 → 标签模板 | 控制面生成，数据面执行 |
| Service Discovery（file_sd/k8s_sd/...） | 监控对象管理 → CMDB 接入源 | 控制面扩展，数据面执行 |
| TSDB 存储 / PromQL 执行 | 查询中心 → Query 代理 | 数据面执行，控制面代理 |
| `/api/v1/targets` / `service discovery` 状态 | 查询中心 → 采集状态与诊断 | 数据面暴露，控制面聚合 |
| Alerting Rules / Recording Rules | 监控策略与指标管理（编辑 UI）+ 告警规则管理（生命周期） | 控制面编辑，数据面求值 |
| Alertmanager 集成 | 告警规则管理 → 通知/静默/抑制 | MVP 复用原生链路 |
| Remote Write / Remote Read | 网域与边缘配置中心 → 数据存储 | 控制面配置，数据面执行 |
| `prometheus.yml` / `/-/reload` | 网域与边缘配置中心 | 控制面核心 |
| Blackbox Exporter | 监控策略与指标管理 → 拨测配置 | 控制面生成配置，数据面执行 |

---

## 4. 功能架构全景图

### 01 监控对象管理（Module_07）

> 对应 Prometheus `static_configs` / `file_sd` 的目标来源，解决"监控对象是谁"的问题。
> 本模块是 [Module_01](Modules/Module_01_Metric_Collection_Center.md) 与 [Module_09](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 的**被动数据提供方**，不生成或下发 Prometheus 配置。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **资源类型管理** | 主机（Host）、中间件（Middleware）、应用服务（Application）、通用指标目标（Generic Target）类型定义 | P0 |
| **主机资源管理** | 主机列表、新增/编辑/删除、Excel 导入、`instance_name` / `hostname` / IP / OS 管理 | P0 |
| **中间件资源管理** | 中间件列表、类型选择（MySQL/Redis/Kafka/...）、连接信息、Excel 导入 | P0 |
| **应用服务资源管理** | 应用服务列表、拨测 URL、协议、端点、Excel 导入 | P0 |
| **通用指标目标管理** | 通用/自定义 Exporter 目标管理，支持自定义 IP、端口、metrics_path 与 Label | P0 |
| **展示字段控制** | 按资源类型固定展示列；列表以 `instance_name` / `hostname` 作为可读名 | P0 |
| **资源状态管理** | `online` / `offline` / `maintenance` 状态维护；Excel/CMDB 状态通过可配置字典映射 | P0 |
| **资源 Label 管理** | `ResourceLabel` CRUD；来源分层 `system` / `user` / `cmdb {v0.4+}`；同 key 优先级 `cmdb` > `user` > `system` | P0 |
| **标签模板管理** | 按资源类型定义字段 → Label 映射；字段来源支持 `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}`；transform 规则 | P0 |
| **已监控 / 未监控 badge** | 在 Resource 列表展示该资源是否被任意 ScrapeJob 选中；由 Module_01 写入关联关系，Module_07 只读展示 | P0 |
| **网域归属** | 资源按 `network_domain_id` 分组；网域生命周期由 [Module_09](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 负责 | P0 |
| **CMDB 接入源** | Excel 接入（MVP）、HTTP API、Nacos、Kubernetes、腾讯蓝鲸（v0.4+） | P1/P2 |
| **资源关系** | 应用-实例-集群关系、依赖拓扑（未来） | P2 |

> **核心字段约定**：
> - `resource_id`：稳定唯一键，不用于展示；MVP 取自 `server_id` / `instance_name`；v0.4+ 复用 CMDB `cmdb_ci_id`。
> - `instance_name` / `hostname`：可读展示名；Prometheus `instance` label 仍为目标地址，不用于展示。
> - `network_domain_id`：资源必须归属网域；MVP 默认 `default`，v0.2+ 按租户上下文填充。
> - `source_type`：数据来源 `manual` / `import` / `cmdb {v0.4+}`。
> - `is_monitored`：是否已被至少一个 ScrapeJob 选中；由 Module_01 维护，Module_07 只读展示。
>
> **网域化说明**：所有资源必须归属到一个网域。MVP 阶段系统预置 `default` 网域，多网域场景下按 `network_domain_id` 隔离资源视图与配置。

---

### 02 监控策略与指标管理（Module_01）

> 对应 Prometheus 的 Scrape、Target、Relabel、Instrumentation 与 Alerting Rules，解决"怎么采、采什么、怎么判"的问题。
> 本模块持有 `ScrapeJob`、`MonitoringRule`、`CITypeExporterMapping` 等策略数据模型，但**不生成或下发配置**，也不负责运行时状态展示。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **CI 类型 ↔ Exporter 模板绑定** | 每种 `resource_type` 映射到一个 ExporterTemplate，包含默认端口、metrics_path、scheme、scrape_interval、scrape_timeout 等 | P0 |
| **采集 Job 管理** | Job 创建/编辑、命名、启用/禁用、关联 CI 类型与 ExporterTemplate、实例选择模式、标签模板引用 | P0 |
| **实例选择** | MVP 支持「手动勾选」；v0.3+ 支持按网域 / 环境 / 应用 / 标签等条件筛选并预览匹配结果 | P0 / v0.3+ |
| **Exporter 安装/注册确认** | 在 Resource 或 Target 上标记 exporter 是否已安装/已注册，生成配置前必须确认 | P0 |
| **拨测配置管理** | Blackbox Exporter 的 probe 模板与拨测目标配置，作为监控策略的一部分由本模块编辑 | P0 |
| **指标元数据管理** | 指标名注册、类型标记（counter/gauge/histogram/summary）、HELP/UNIT | P1 |
| **Exporter 指标库** | 静态内置库覆盖常见 Exporter（node-exporter、mysqld-exporter、redis-exporter 等），并提供用户扩展入口；完整管理页面放 P1/P2 | P1 / P2 |
| **规则编辑 UI** | 类 YAML 表单（expr / for / labels / annotations），支持 PromQL 校验与指标实时预览；规则保存后由 Module_08 管理生命周期 | P0 |
| **高级 Relabel 管理** | 标签丢弃/保留/重写、正则替换、hashmod（未来） | P2 |
| **Exporter 市场** | Exporter 登记、版本管理、部署指南（未来） | P2 |

> **边界说明**：
> - Resource / LabelTemplate / ResourceLabel 由 [Module_07](Modules/Module_07_Monitoring_Object_Management.md) 维护，本模块只读消费。
> - `prometheus.yml` / `rules.yml` 的生成、预览、下发由 [Module_09](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 负责。
> - 运行时目标状态、拨测结果、采集诊断由 [Module_02](Modules/Module_02_Query_Center.md) 负责展示。
> - 告警规则生命周期（分组、静默、Alertmanager 配置、告警状态展示）由 [Module_08](Modules/Module_08_Alerting_Rule_Management.md) 负责。

---

### 03 网域与边缘配置中心（Module_09）

> 对应 Prometheus 的 `prometheus.yml` / `rules.yml` 生命周期管理，以及多网域场景下的边缘 Agent 接入，解决"配置怎么生成、怎么预览、怎么下发"的问题。
> 本模块同时负责**监控基础设施自身健康度**（Edge Agent 在线、WAL、配置同步），与被监控对象的采集健康度（Module_02）区分。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **网域管理** | 网域注册、编辑、删除、Token 生成与重置、默认网域 `default` | P0 |
| **Token 鉴权** | Edge Sync Agent 使用 Token 拉取配置和推送心跳 | **P0（v0.2）** |
| **边缘 Agent 管理** | 注册边缘 Agent、查看 Agent 类型（vmagent / prometheus-agent）、版本、状态 | **P0（v0.2）** |
| **配置生成服务** | 定时轮询 Module_01（ScrapeJobs、Rules）与 Module_07（Resources、LabelTemplates），按网域生成 `prometheus.yml` 与 `rules.yml` 草稿；在 `global.external_labels` 中注入 `network_domain`、`tenant_id` | **P0（v0.2）** |
| **配置预览与确认** | 以 YAML 高亮预览、与当前生效版本 diff、人工确认后转为待下发版本 | **P0（v0.2）** |
| **配置下发** | 单网域：手动下发、SIGHUP / `/-/reload`；多网域：Edge Sync Agent 轮询拉取配置包 | P0 / P1 |
| **配置版本** | 下发历史、版本对比、一键回滚 | P1 |
| **配置审计** | 变更记录、操作人、Diff 展示 | P2 |
| **心跳与在线状态** | 接收 Edge Sync Agent 心跳，展示最后在线时间、配置拉取时间 | **P0（v0.2）** |
| **配置同步状态** | 展示中心配置版本与边缘实际生效版本是否一致 | **P0（v0.2）** |
| **Agent 状态列表页** | 分页表格展示各网域 Agent 在线状态、最后心跳、配置版本、WAL 积压、最近错误；MVP 以此替代图表/趋势看板 | **P0（v0.2）** |
| **边缘诊断看板** | 心跳 RTT、WAL 积压、Remote Write 队列状态、最近错误等可视化图表 | P1/P2 |
| **边缘 Agent 告警** | 边缘 Agent 失联超过阈值时触发"采集端失联"告警 | **P0（v0.2）** |
| **证书与安全管理** | mTLS 证书下发、Token 轮换、拉取接口鉴权 | P2 |
| **边缘自治告警** | 边缘本地 vmalert + Alertmanager 规则下发（未来阶段） | P2 |

> **本地手工兜底声明**：平台只保证「通过 UI 下发并成功 reload 的配置」与数据库期望态一致，允许运维工程师在紧急情况下直接修改本地磁盘配置进行手工兜底；平台不会自动强制 reconcile，UI 中将展示 `out_of_sync` 或 `manual_override` 状态。

---

### 04 查询中心（Module_02）

> 定位为**带租户/网域上下文注入的 Prometheus Query API 代理**，不是透明代理。
> 转发查询前，根据当前认证用户自动注入 `tenant_id` 与有权限的 `network_domain` 标签，保证多租户数据隔离；返回结果外层包裹 envelope 元数据（`data_source`、`freshness_at`、`network_domain`），以区分中心实时 scrape 与边缘异步 Remote Write 数据。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **PromQL 代理（含租户/网域注入）** | 代理 instant / range 查询，自动注入 `tenant_id` 与有权限的网域标签 | P0 |
| **`/api/v1/alerts` 代理** | 代理 Prometheus 当前触发/待处理告警实例，注入租户/网域上下文 | P0 |
| **查询辅助** | 指标名补全、Label 键值建议、常用查询模板、语法校验 | P1 |
| **结果展示** | 表格视图、JSON 视图、简单折线图、数据导出（CSV/JSON） | P1 |
| **采集目标状态** | Up/Down 列表、按 Job/环境/应用/状态筛选、最后抓取时间 | P0 |
| **采集诊断** | HTTP 状态码、错误信息、抓取耗时、样本数 | P1 |
| **拨测结果** | Blackbox probe_success、probe_duration 等指标展示 | P1 |
| **Job 健康度** | Job 维度成功率、目标覆盖率 | P1 |
| **Open API** | RESTful 指标查询接口、API Key、限流、批量查询 | P1 |
| **查询权限** | 按应用/环境/指标范围授权 | P2 |
| **Trace 级诊断** | 抓取请求详情、响应体预览 | P2 |

> **边界说明**：
> - 本模块负责**被监控对象**的指标与 exporter 采集健康度（例如 `up` 指标）；Edge Agent 在线、WAL、配置同步等**监控基础设施健康度**由 [Module_09](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) 负责。
> - 告警状态查看能力：Module_02 在 MVP 阶段仅作为查询代理暴露 Prometheus `/api/v1/alerts`；Alertmanager 通知状态（分组、静默、抑制、接收人）由 [Module_08](Modules/Module_08_Alerting_Rule_Management.md) 负责。

---

### 05 告警规则管理（Module_08）

> 对应 Prometheus Alerting Rules / Recording Rules / Rule Manager / Alertmanager。
> 规则编辑 UI 已移交 [Module_01](Modules/Module_01_Metric_Collection_Center.md)，本模块聚焦规则生命周期、分组、静默、抑制、通知路由与下发协同。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **Prometheus 告警状态查看** | 当前告警、告警历史、告警详情；由 [Module_02](Modules/Module_02_Query_Center.md) 代理 `/api/v1/alerts` 提供 | P1 |
| **Alertmanager 通知状态** | 代理 Alertmanager `/api/v1/alerts` 或封装通知状态 API，展示告警经过路由、静默、抑制后的通知状态 | P1 |
| **告警规则生命周期管理** | 规则分组（RuleGroup）、启用/禁用、版本管理、按网域聚合 | P1 |
| **Recording Rules** | 预聚合规则 CRUD、启用/禁用 | P2 |
| **规则组管理** | 分组、评估间隔、规则排序 | P2 |
| **静默管理** | 创建/删除静默规则（调用 Alertmanager API） | P2 |
| **通知渠道** | 飞书/钉钉/邮件/企业微信 Webhook、通知模板、告警收敛 | P2 |
| **告警升级** | 升级策略、值班组、告警降噪 | P2 |
| **抑制规则生成** | 网域离线时自动生成 Alertmanager `inhibit_rules`，抑制可达性/网络类次生告警 | P1 |
| **规则求值范围（Scope）** | `central` / `edge` / `both`，控制规则在中心或边缘 Agent 上求值 | P2 |

> **告警状态分层**：
> - **Prometheus `/api/v1/alerts`**：回答"当前触发了哪些规则、哪些对象有问题"，由 Module_02 代理。
> - **Alertmanager 通知状态**：回答"告警正在通知给谁、是否被静默/抑制"，由 Module_08 负责集成与展示。
> - **边缘本地告警**（断网场景，P2）：由边缘本地 Alertmanager 处理，状态通过 Module_09 EdgeHeartbeat 上报，在 Module_09 Agent 状态页或 Module_08 边缘告警视图中展示，不归 Module_02 代理。

> **MVP 决策**：告警规则通过 [Module_01](Modules/Module_01_Metric_Collection_Center.md) 的类 YAML 表单 UI 产出；告警收敛/静默/通知借助 Alertmanager 原生能力；本模块负责规则记录的持久化、分组与 `rules.yml` 生成协同。

---

### 06 系统与平台管理（Module_06）

> 提供租户与平台级管理能力，重点是租户生命周期、租户-网域关联、平台全局策略与数据存储管理。
> **关键约束**：MetricCenter 不存在跨租户的全局平台管理员身份。`platform_admin` 是系统预置的默认租户，拥有 `default` 网域，用于承载平台级默认配置与未显式分配租户的资源；其用户与其他租户用户一样，只能访问本租户及其拥有的网域内的资源。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **租户与权限** | 租户创建/编辑/禁用、租户-网域关联（1 租户 : N 网域，禁止跨租户共享）；用户/角色/权限可由外部 IAM/SSO 承接 | P0/P1（v0.2） |
| **数据存储管理** | TSDB 状态、Retention、Remote Write 转发开关、中心时序存储（VictoriaMetrics） | P2 |
| **审计日志** | 操作记录、变更追踪、登录日志 | P2 |
| **平台配置** | `platform_admin` 租户内的全局 scrape 默认值、通知默认配置 | P2 |

---

### 07 监控源管理（Module_10）

> 对应异构监控汇聚场景，解决"客户现场已有 Prometheus / Zabbix / 云监控，如何不替换而统一汇聚"的问题。属于集成模式，通过特性开关控制。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **监控源登记册** | 注册/编辑/删除监控源，指定类型、归属网域、接入方式 | P0（集成模式） |
| **外部 Prometheus 接入** | 生成 Remote Write 配置片段，客户 Prometheus 借道汇聚 | P0（集成模式） |
| **Ingestion Gateway** | 统一 Remote Write 接收点、Token 鉴权、标签注入、限流 | P0（集成模式） |
| **接入源健康状态** | 最后推送时间、推送速率、错误率、离线告警 | P1（集成模式） |
| **Zabbix Adapter 接入** | 通过 zabbix_exporter 转换接入 | P2（集成模式） |
| **云监控 Adapter 接入** | 通过 cloud-monitor-puller 拉取接入 | P2（集成模式） |

---

## 5. MVP 范围边界

| 模块 | MVP 必须（P0/P1） | MVP 不做（P2/未来） |
|------|-------------------|---------------------|
| 监控对象管理（Module_07） | 四类资源固定字段、Excel 导入（含可选 `network_domain_id` 与 `cmdb_*` 预留列）、默认网域 `default`、状态映射字典、LabelTemplate、ResourceLabel、「已监控 / 未监控」badge | 动态字段、ScrapeJob、配置生成下发、腾讯蓝鲸 CMDB 同步 |
| 监控策略与指标管理（Module_01） | CI 类型 ↔ Exporter 模板绑定、ScrapeJob 编辑、手动勾选实例、Exporter 安装/注册确认、Blackbox 拨测配置、规则编辑 UI（类 YAML + PromQL 校验 + 指标预览） | 高级 Relabel、Exporter 市场、指标元数据管理页（P1）、自动筛选实例（v0.3+） |
| 网域与边缘配置中心（Module_09） | 默认网域 `default`、配置生成草稿、配置预览 / diff、人工确认后中心 Prometheus reload、Agent 状态列表页、`external_labels` 注入 | 多网域 Edge Sync Agent 拉取（v0.2+）、版本回滚、自动下发、Token 轮换、mTLS、图表/趋势诊断看板 |
| 查询中心（Module_02） | 带租户/网域注入的 PromQL 代理、`/api/v1/alerts` 代理、响应 envelope 元数据（`data_source` / `freshness_at` / `network_domain`）、目标状态列表 | 复杂 Dashboard、图表库、深度采集诊断、覆盖率分析、批量查询 |
| 告警规则管理（Module_08） | 规则记录持久化与分组、抑制规则生成；Prometheus 告警状态由 Module_02 代理展示；Alertmanager 通知状态由 Module_08 提供 | 规则编辑 UI（在 Module_01）、Recording Rules UI、静默管理 UI、通知渠道配置 |
| 监控源管理（Module_10） | 无（集成模式关闭） | 外部 Prometheus / Zabbix / 云监控接入（集成模式 P0） |
| 系统与平台管理（Module_06） | 无 | 多租户完整功能、审计、Remote Write 全局配置；不存在跨租户全局管理员 |

> **说明**：MVP 阶段网域与边缘配置中心、监控源管理的功能处于关闭或隐藏状态，数据模型已预留。v0.2 开启多站点模式后，网域与边缘配置中心功能激活；集成项目中开启集成模式后，监控源管理功能激活。

---

## 6. 数据流闭环（MVP）

```
监控对象管理（Module_07）
    │
    ├──► Resource ──► LabelTemplate ──► ResourceLabel
    │
    ▼
监控策略与指标管理（Module_01）
    │
    ├──► CI 类型 ↔ Exporter 模板绑定
    ├──► ScrapeJob 配置 + 手动勾选实例
    ├──► Blackbox 拨测配置
    └──► 规则编辑 UI（类 YAML 表单）
              │
              ▼
        策略写入 DB（ScrapeJob / MonitoringRule / ...）
              │
              ▼
网域与边缘配置中心（Module_09）
    │
    ├──► 轮询策略数据与对象数据
    ├──► 生成 ConfigDraft
    ├──► 配置预览 / Diff
    ├──► 人工确认
    └──► 生成 ConfigVersion 并下发
              │
              ▼
    Prometheus / Edge Agent（数据面）
              │
    ┌─────────┼─────────┐
    │         │         │
    ▼         ▼         ▼
 查询中心  告警规则管理  边缘状态
（Module_02）（Module_08）（Module_09）
```

### 6.1 关键数据流说明

- **Edge Agent → Remote Write → Central TSDB → Module_02（注入）**
  - 边缘 Agent 在隔离网域抓取指标，通过 Remote Write 回写到中心 TSDB；Module_02 查询时自动注入 `tenant_id` / `network_domain` 并返回 envelope 元数据。
- **Edge Agent → Heartbeat → Module_09（Agent 状态列表）**
  - Edge Sync Agent 周期性上报心跳、配置版本、WAL 积压；Module_09 以 Agent 状态列表页形式展示基础设施健康。
- **Prometheus → `/api/v1/alerts` → Module_02 → UI**
  - Prometheus 规则求值产生的 firing/pending 告警实例由 Module_02 代理展示，回答"当前触发了哪些规则"。
- **Alertmanager → 通知状态 → Module_08**
  - Alertmanager 路由、静默、抑制后的通知状态由 Module_08 负责集成与展示，回答"告警正在通知给谁"。

> **数据流说明**：
> - Module_07 负责维护对象数据（Resource、LabelTemplate、ResourceLabel），作为被动数据提供方。
> - Module_01 消费对象数据，产出 CI 类型 ↔ Exporter 绑定、ScrapeJob、MonitoringRule 等策略记录。
> - Module_09 轮询 Module_01 与 Module_07 的数据，生成按网域的 `prometheus.yml` / `rules.yml` 草稿，经人工确认后下发到中心 Prometheus 或 Edge Agent；同时在 Edge Agent 配置中注入 `external_labels`。
> - Module_02 负责 PromQL 查询与运行时目标状态展示；Module_08 负责告警规则生命周期、Alertmanager 通知状态与配置；Module_09 负责 Edge Agent 基础设施健康状态。

---

## 7. `external_labels` 说明

`external_labels` 是 Prometheus / vmagent 在 `global` 段配置的一组全局标签，采集器在抓取每条时间序列后会自动把这些标签附加到 series 上，因此所有从该 Agent 回写的指标都会统一携带这些标签。

### 7.1 作用

- **标识指标来源**：通过 `network_domain`、`tenant_id` 等标签，明确每条时间序列来自哪个网域、哪个租户。
- **支撑租户隔离**：Module_02 查询时基于 `tenant_id` / `network_domain` 自动注入选择器，实现多租户数据隔离。
- **区分数据新鲜度**：Module_02 返回的 envelope 元数据中的 `network_domain` 与 `data_source` 字段，依赖 `external_labels` 中的来源信息。

### 7.2 Module_09 的职责：内部 Edge Agent 注入

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

### 7.3 Module_10 的职责：外部监控源标签归一化

- Module_10 负责**外部异构监控源**（第三方 Prometheus、Zabbix、云监控等）接入时的标签归一化、映射与补全。
- 外部来源可能已自带 `network_domain`、`tenant_id` 等标签，Module_10 通过 Ingestion Gateway 在数据入平台时进行校验、改写或补全，使其与 MetricCenter 的网域/租户模型对齐。
- Module_10 **不**负责为内部 Edge Agent 生成 `external_labels`；该职责专属 Module_09。

### 7.4 职责边界总结

| 职责 | Module_09（网域与边缘配置中心） | Module_10（监控源管理） |
|------|--------------------------------|------------------------|
| 内部 Edge Agent 的 `external_labels` 注入 | ✅ 在生成 `prometheus.yml` 时注入 `network_domain`、`tenant_id` | ❌ |
| 外部异构监控源接入 | ❌ | ✅ 负责标签归一化、映射、补全 |
| 外部来源的 `network_domain` / `tenant_id` 标签对齐 | ❌ 可提供网域/租户定义供引用 | ✅ 负责将外部指标映射到本网域模型 |

> **原则**：Module_09 管「内部 Agent 出身标签」，Module_10 管「外部来源入场标签」。两者都可能在指标上产生 `network_domain` 等标签，但生成时机和 responsibility 不同：Module_09 通过 Agent 配置注入，Module_10 通过接入网关/转换器在数据入平台时打标或改写。

---

## 8. 与现有模块文档的对应关系

| 本文档模块 | 对应模块文档 |
|------------|--------------|
| 监控对象管理 | [Module_07_Monitoring_Object_Management.md](Modules/Module_07_Monitoring_Object_Management.md) |
| 监控策略与指标管理 | [Module_01_Metric_Collection_Center.md](Modules/Module_01_Metric_Collection_Center.md) |
| 网域与边缘配置中心 | [Module_09_Network_Domain_and_Edge_Config_Center.md](Modules/Module_09_Network_Domain_and_Edge_Config_Center.md) |
| 查询中心 | [Module_02_Query_Center.md](Modules/Module_02_Query_Center.md) |
| 告警规则管理 | [Module_08_Alerting_Rule_Management.md](Modules/Module_08_Alerting_Rule_Management.md) |
| 监控源管理 | [Module_10_Monitoring_Source_Registry.md](Modules/Module_10_Monitoring_Source_Registry.md) |
| 系统与平台管理 | [Module_06_Multi_Tenant.md](Modules/Module_06_Multi_Tenant.md) |

> **说明**：模块文件名保持历史命名不变；模块显示名称以本文档及对应 PRD 标题为准。

---

## 9. 变更日志

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-07-31 | v3.1 | 按《监控策略管理方案设计》决策重构模块边界：Module_01 改为「监控策略与指标管理」、Module_07 改为「监控对象管理」、Module_09 改为「网域与边缘配置中心」；重新划分 ScrapeJob、配置生成/下发、运行时目标状态、告警生命周期等职责；更新数据流图、MVP 边界表与模块对应关系表。 | 产品架构 |
| 2026-07-31 | v3.2 | 按 grill-2026-07-31-query-center 决策与 Module_02/06/08/09 PRD 更新：Module_02 改为带租户/网域注入的 Prometheus Query API 代理并补充响应 envelope 元数据；Module_09 明确 MVP 诊断降级为 Agent 状态列表页、配置生成注入 `external_labels`、区分基础设施健康与被监控对象健康；Module_08 区分 Prometheus 告警状态与 Alertmanager 通知状态；Module_06 明确不存在跨租户全局管理员；新增数据流关键链路说明与 `external_labels` 专节；更新 MVP 边界表与模块对应关系表。 | 产品架构 |
