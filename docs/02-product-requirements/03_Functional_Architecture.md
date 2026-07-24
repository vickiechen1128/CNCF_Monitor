# MetricCenter 功能架构全景图

> 文档类型：产品需求文档 / 功能架构  
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[00_Global_Architecture.md](00_Global_Architecture.md)  
> 更新日期：2026-07-20

---

## 1. 设计原则

1. **控制面与数据面分离**：MetricCenter 负责管理侧，Prometheus 负责执行侧
2. **不硬 Fork Prometheus**：复用其成熟能力，通过标准接口（HTTP API、配置下发、Remote Write）交互
3. **MVP 聚焦**：先跑通「资源 → 标签 → 采集 → 查询 → 告警状态」主链路
4. **资源管理最小化**：MVP 仅保留必要字段，后续接入腾讯蓝鲸等外部 CMDB

---

## 2. 控制面 vs 数据面分层

```
┌─────────────────────────────────────────────────────────────────┐
│                     控制面（Control Plane）                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              MetricCenter 平台层                          │  │
│  │  · Web 门户（ui-custom/）                                  │  │
│  │  · API Gateway / 查询代理（platform/gateway/）             │  │
│  │  · 资源管理 / 标签模板 / 采集 Job（platform/config/）       │  │
│  │  · 配置生成与下发（platform/config/）                      │  │
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
| `scrape_configs` / `static_configs` | 指标管理 → 采集 Job 管理 | 控制面生成，数据面执行 |
| `relabel_configs` / `metric_relabel_configs` | 指标管理 → 标签模板 | 控制面生成，数据面执行 |
| Service Discovery（file_sd/k8s_sd/...） | 资源管理 → CMDB 接入源 | 控制面扩展，数据面执行 |
| TSDB 存储 / PromQL 执行 | 指标查询 → Query 代理 | 数据面执行，控制面代理 |
| `/api/v1/targets` / `service discovery` 状态 | 采集状态与诊断 | 数据面暴露，控制面聚合 |
| Alerting Rules / Recording Rules | 告警规则管理 | 控制面编辑，数据面求值 |
| Alertmanager 集成 | 告警规则管理 → 通知/静默 | MVP 复用原生链路 |
| Remote Write / Remote Read | 平台管理 → 数据存储 | 控制面配置，数据面执行 |
| `prometheus.yml` / `/-/reload` | 配置中心 | 控制面核心 |
| Blackbox Exporter | 指标管理 → 应用服务拨测 | 控制面生成配置，数据面执行 |

---

## 4. 功能架构全景图

### 01 资源管理（Asset / CMDB）

> 对应 Prometheus `static_configs` / `file_sd` 的目标来源，解决"监控对象是谁"的问题

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **资源类型管理** | 主机（Host）、中间件（Middleware）、应用服务（Application）类型定义 | P0 |
| **主机资源管理** | 主机列表、新增/编辑/删除、Excel 导入、hostname/IP/OS 管理 | P0 |
| **中间件资源管理** | 中间件列表、类型选择（MySQL/Redis/Kafka/...）、连接信息、Excel 导入 | P0 |
| **应用服务资源管理** | 应用服务列表、拨测 URL、协议、端点、Excel 导入 | P0 |
| **展示字段控制** | 按资源类型固定展示列、默认排序 | P0 |
| **资源状态管理** | online / offline / maintenance 状态维护 | P0 |
| **网域管理** | 网域注册、Token 管理、边缘 Agent 关联、默认网域 `default` | P0 |
| **CMDB 接入源** | Excel 接入（MVP）、HTTP API、Nacos、Kubernetes、腾讯蓝鲸（未来） | P1/P2 |
| **资源关系** | 应用-实例-集群关系、依赖拓扑（未来） | P2 |

> **网域化说明**：所有资源必须归属到一个网域。MVP 阶段系统预置 `default` 网域，多网域场景下按 `network_domain_id` 隔离资源视图与配置。

---

### 02 指标管理（Metric Management）

> 对应 Prometheus 的 Scrape、Target、Relabel、Instrumentation，解决"怎么采、采什么"的问题

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **采集 Job 管理** | Job 创建/编辑、所属网域、scrape_interval、scrape_timeout、metrics_path、scheme、启用/禁用 | P0 |
| **标签模板管理** | CMDB 字段映射、Prometheus 内置字段、组合字段、transform 规则、按资源类型区分 | P0 |
| **目标筛选规则** | 按网域、资源类型、env、app、cluster 等字段筛选、多条件组合、预览匹配结果 | P0 |
| **边缘采集器类型** | 按网域配置 `vmagent`（默认）或 `prometheus-agent` | P1/P2 |
| **采集模板管理** | 预置模板（node-exporter、mysqld-exporter、simple-agent、blackbox）、自定义模板 | P0/P1 |
| **拨测配置管理** | Blackbox Exporter 配置生成、HTTP/TCP 拨测目标、probe 模板 | P0 |
| **采集目标管理** | 目标列表、目标状态、目标详情、临时目标（用于验证） | P1 |
| **指标元数据管理** | 指标名注册、类型标记（counter/gauge/histogram/summary）、HELP/UNIT | P1 |
| **Relabel 高级管理** | 标签丢弃/保留/重写、正则替换、hashmod（未来） | P2 |
| **Exporter 市场** | Exporter 登记、版本管理、部署指南（未来） | P2 |

---

### 03 配置中心（Config Center）

> 对应 Prometheus 的 `prometheus.yml` 生命周期管理，解决"配置怎么生成、怎么下发"的问题

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **配置生成** | 根据网域+资源+Job+标签模板生成 `prometheus.yml`、实时预览 | P0 |
| **按网域生成配置** | 每个网域生成独立配置包，自动注入 `external_labels.network_domain` | P1 |
| **配置校验** | YAML 语法校验、Prometheus 语义校验（调用 `promtool`）、冲突检测 | P0/P1 |
| **配置下发** | 单网域：手动下发、SIGHUP / `/-/reload` / 文件监听 | P0 |
| **配置拉取** | 多网域：Edge Sync Agent 轮询拉取本域配置包并触发 reload | P1 |
| **配置版本** | 下发历史、版本对比、一键回滚 | P1 |
| **配置审计** | 变更记录、操作人、Diff 展示 | P2 |

---

### 04 指标查询（Query Center）

> 对应 Prometheus PromQL / Query API，解决"查什么、怎么看"的问题

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **PromQL 查询** | Instant Query、Range Query、查询历史、收藏查询 | P0 |
| **查询辅助** | 指标名补全、Label 键值建议、常用查询模板、语法校验 | P1 |
| **结果展示** | 表格视图、JSON 视图、简单折线图、数据导出（CSV/JSON） | P1 |
| **Open API** | RESTful 指标查询接口、API Key、限流、批量查询 | P1 |
| **查询权限** | 按应用/环境/指标范围授权 | P2 |

---

### 05 告警规则管理（Alerting Rule Management）

> 对应 Prometheus Alerting Rules / Recording Rules / Rule Manager / Alertmanager

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **告警规则编辑** | 规则 CRUD、PromQL 条件、for 持续时间、告警级别、labels、annotations | P2 |
| **Recording Rules** | 预聚合规则 CRUD、启用/禁用 | P2 |
| **规则组管理** | 分组、评估间隔、规则排序 | P2 |
| **告警状态查看** | 当前告警、告警历史、告警详情（代理 `/api/v1/alerts`） | P1 |
| **静默管理** | 创建/删除静默规则（调用 Alertmanager API） | P2 |
| **通知渠道** | 飞书/钉钉/邮件/企业微信 Webhook、通知模板、告警收敛 | P2 |
| **告警升级** | 升级策略、值班组、告警降噪 | P2 |

> **MVP 决策**：告警规则不写 UI，直接编辑 `rules.yml`；告警收敛/静默/通知借助 Alertmanager 原生能力。

---

### 06 采集状态与诊断（Collection Observability）

> 对应 Prometheus `/api/v1/targets`、Scrape Manager 状态

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **采集目标状态** | Up/Down 列表、按 Job/环境/应用/状态筛选、最后抓取时间 | P0 |
| **采集诊断** | HTTP 状态码、错误信息、抓取耗时、样本数 | P1 |
| **Job 健康度** | Job 维度成功率、目标覆盖率 | P1 |
| **拨测结果** | Blackbox probe_success、probe_duration 等指标展示 | P1 |
| **采集覆盖率** | 按环境/应用统计已接入/未接入资源 | P1 |
| **Trace 级诊断** | 抓取请求详情、响应体预览 | P2 |

---

### 07 系统与平台管理（Platform Admin）

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **租户与权限** | 用户管理、角色、权限、资源隔离 | P2 |
| **数据存储管理** | TSDB 状态、Retention、Remote Write 配置、中心时序存储（VictoriaMetrics） | P2 |
| **审计日志** | 操作记录、变更追踪、登录日志 | P2 |
| **平台配置** | 全局 scrape 默认值、通知默认配置 | P2 |

---

### 08 网域与边缘管理（Network Domain & Edge Agent）

> 对应多网域物理隔离场景下的边缘节点生命周期管理，解决"隔离网域如何接入中心"的问题。v0.2 起提升为 P0。

| 一级功能 | 二级功能 | MVP 范围 |
|----------|----------|----------|
| **网域管理** | 网域注册、编辑、删除、Token 生成与重置、默认网域 `default` | P0 |
| **Token 鉴权** | Edge Sync Agent 使用 Token 拉取配置和推送心跳 | **P0（v0.2）** |
| **边缘 Agent 管理** | 注册边缘 Agent、查看 Agent 类型（vmagent / prometheus-agent）、版本、状态 | **P0（v0.2）** |
| **心跳与在线状态** | 接收 Edge Sync Agent 心跳，展示最后在线时间、配置拉取时间 | **P0（v0.2）** |
| **配置同步状态** | 展示中心配置版本与边缘实际生效版本是否一致 | **P0（v0.2）** |
| **边缘诊断看板** | 心跳 RTT、WAL 积压、Remote Write 队列状态、最近错误 | P1（v0.2） |
| **边缘 Agent 告警** | 边缘 Agent 失联超过阈值时触发"采集端失联"告警 | **P0（v0.2）** |
| **证书与安全管理** | mTLS 证书下发、Token 轮换、拉取接口鉴权 | P2 |
| **边缘自治告警** | 边缘本地 vmalert + Alertmanager 规则下发（未来阶段） | P2 |

---

### 09 监控源管理（Monitoring Source Registry）

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
| 资源管理 | 三类资源固定字段、Excel 导入、默认网域 `default` | 动态字段、腾讯蓝鲸接入 |
| 指标管理 | 采集 Job、标签模板、目标筛选、采集模板、拨测配置 | 高级 Relabel、Exporter 市场 |
| 配置中心 | 配置生成（兼容单网域）、预览、手动下发 | 自动下发、版本回滚、Edge Sync Agent 拉取 |
| 指标查询 | 基础 PromQL 查询、结果展示 | 复杂 Dashboard、图表库 |
| 告警规则 | 告警状态查看 | 规则 UI、Recording Rules UI、通知渠道 |
| 采集诊断 | 目标状态列表、拨测结果 | 深度诊断、覆盖率分析 |
| 网域与边缘管理 | 网域管理、默认网域 | 边缘 Agent 在线状态、Edge Sync Agent、边缘自治告警 |
| 监控源管理 | 无（集成模式关闭） | 外部 Prometheus / Zabbix / 云监控接入（集成模式 P0） |
| 平台管理 | 无 | 多租户、审计 |

> **说明**：MVP 阶段网域与边缘管理、监控源管理的功能处于关闭或隐藏状态，数据模型已预留。v0.2 开启多站点模式后，网域与边缘管理功能激活；集成项目中开启集成模式后，监控源管理功能激活。

---

## 6. 数据流闭环（MVP）

```
资源管理（三类对象）
    │
    ├──► 主机 ──► node-exporter 模板
    ├──► 中间件 ──► mysqld/redis/kafka-exporter 模板
    └──► 应用服务 ──► simple-agent / blackbox probe 模板
              │
              ▼
        标签模板（字段 → Label）
              │
              ▼
        采集 Job + 目标筛选
              │
              ▼
        配置中心（生成 prometheus.yml）
              │
              ▼
        Prometheus 数据面（抓取 / 存储 / 告警求值）
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
 采集状态   指标查询   告警状态
```

---

## 7. 与现有模块文档的对应关系

| 本文档模块 | 对应模块文档 |
|------------|--------------|
| 资源管理 | [Module_07_Config_Management.md](Modules/Module_07_Config_Management.md) |
| 指标管理 | [Module_01_Metric_Collection_Center.md](Modules/Module_01_Metric_Collection_Center.md) |
| 指标查询 | [Module_02_Query_Center.md](Modules/Module_02_Query_Center.md) |
| 配置中心 | [Module_07_Config_Management.md](Modules/Module_07_Config_Management.md) |
| 告警规则管理 | [Module_08_Alerting_Rule_Management.md](Modules/Module_08_Alerting_Rule_Management.md) |
| 采集状态与诊断 | [Module_01_Metric_Collection_Center.md](Modules/Module_01_Metric_Collection_Center.md) |
| 网域与边缘管理 | [Module_09_Network_Domain_and_Edge_Agent.md](Modules/Module_09_Network_Domain_and_Edge_Agent.md) |
| 监控源管理 | [Module_10_Monitoring_Source_Registry.md](Modules/Module_10_Monitoring_Source_Registry.md) |
| 系统与平台管理 | [Module_06_Multi_Tenant.md](Modules/Module_06_Multi_Tenant.md) |

> **说明**：MVP 阶段，Module 07 在实现资源管理与配置中心的同时，也承接了 Module 01 中指标管理相关配置（采集 Job、标签模板、拨测配置等）的编辑入口。
