# MetricCenter 产品愿景

> 文档类型：产品需求文档  
> 产品名称：MetricCenter（企业级多网域指标集成与管控中心）  
> 目标读者：产品经理、技术架构师、AI 应用开发工程师、运维专家  
> 版本：v3.0  
> 更新日期：2026-07-24

---

## 1. 产品定位

**MetricCenter** 是基于 Prometheus 开源生态构建的**企业级多网域指标集成与管控中心（Multi-Domain Integrated Monitoring Orchestrator）**，采用**控制面（Control Plane）与数据面（Data Plane）分离**的架构：

- **控制面（MetricCenter）**：负责跨网域资源管理、采集规则下发、配置生命周期管理、异构监控源汇聚、统一 PromQL 查询门户。
- **数据面（Prometheus 生态 + 异构 Adapter）**：
  - 自部署网域：Edge Agent（vmagent / Prometheus Agent Mode）负责局域网抓取，通过 Remote Write 推送至中心。
  - 客户现有 Prometheus：通过 Remote Write 借道汇聚。
  - 其他监控系统（Zabbix / 云监控）：通过 Adapter 转换接入。
  - 中心存储：VictoriaMetrics / Mimir 作为统一时序存储，提供全局 PromQL 查询。

> **核心原则**：不硬 Fork Prometheus，以 Prometheus 为数据面引擎，在其上构建企业级控制面。所有二次开发代码与上游源码隔离。MetricCenter 不替换客户现有监控产品，而是通过 Remote Write / Adapter 实现统一汇聚与查询。

---

## 2. 核心价值

| 价值点 | 说明 |
|--------|------|
| **降低 Prometheus 使用门槛** | 通过门户化 UI 和预置模板，让非专家用户也能管理采集目标和查询指标 |
| **统一采集管理** | 集中管理主机、中间件、应用服务的采集配置与拨测 |
| **跨物理隔离网域采集** | 通过 Edge Agent + Remote Write，穿透政务网/专网等隔离网域，支持弱网/断网续传 |
| **异构监控汇聚** | 不替换客户现有 Prometheus / Zabbix / 云监控，通过 Remote Write / Adapter 统一汇聚 |
| **统一 PromQL 查询门户** | 无论数据来自自部署 Agent、客户 Prometheus 还是 Zabbix，均可通过统一 PromQL 查询 |
| **可演进架构** | 与 Prometheus 源码隔离，便于跟进上游版本升级；控制面与数据面可独立扩展 |
| **数据面能力复用** | 充分利用 Prometheus、Blackbox Exporter、Alertmanager 的原生能力，避免重复造轮子 |

---

## 3. 目标用户

| 角色 | 职责 | 核心需求 |
|------|------|----------|
| **运维工程师** | 负责系统监控、采集配置 | 快速接入新目标、查看指标、配置采集规则 |
| **运维架构师** | 负责监控平台规划 | 统一管理多集群、规划数据留存与存储演进 |
| **AI 应用开发工程师** | 基于指标数据开发 AIOps 应用 | 稳定获取指标数据、统一 API |
| **业务研发工程师** | 需要查看自身服务指标 | 自助查询、简单拨测结果查看 |

---

## 4. 产品边界

### 4.1 包含范围

- 三类资源管理：主机、中间件、应用服务（必须归属网域/站点，单机模式下自动归属 `default`）
- 网域与站点管理：网域注册、Token 管理、边缘 Agent 接入、异构监控源登记
- 采集配置管理：采集 Job、标签模板、采集模板、拨测配置
- 配置生成与下发：`prometheus.yml` 生成、校验、reload；多网域场景下支持 Edge Sync Agent 拉取
- 指标汇聚：自部署 Edge Agent、外部 Prometheus Remote Write、Zabbix / 云监控 Adapter
- 指标查询门户：统一 PromQL 查询代理与结果展示
- 采集状态查看：Target 状态、拨测结果、边缘 Agent 健康诊断

### 4.2 不包含范围（MVP）

- 动态资源模型与自定义字段扩展
- 告警规则编辑 UI（MVP 手写 `rules.yml`）
- 告警收敛/静默/通知管理 UI（MVP 借助 Alertmanager 原生能力）
- 复杂 Dashboard 编辑器
- 多租户与权限控制 UI（租户/网域数据模型在 v0.2 预留，MVP 以 `default` 网域单租户运行）
- 外部 CMDB 自动同步（MVP 通过 Excel 导入，v0.4+ 接入 BlueKing/HTTP/Nacos Provider）
- 日志与链路追踪

### 4.3 产品化平衡

- **单机模式（默认）**：隐藏「网域/站点」概念，用户只看到资源、Job、查询。后台自动使用 `default` 站点。
- **多站点模式**：开启后展示「采集站点」，支持边缘 Agent 接入与跨站点查询。
- **集成模式**：进一步展示「监控源登记册」，支持外部 Prometheus / Zabbix / 云监控异构汇聚。

> 多站点与集成模式通过特性开关 `feature_flags.multi_site_enabled` 和 `feature_flags.heterogeneous_ingestion_enabled` 控制，避免对单机用户造成认知负担。

---

## 5. 关键成功指标

| 指标 | 目标 |
|------|------|
| 新目标接入时间 | 从小时级降低到分钟级 |
| 查询响应时间 | P99 < 2s |
| 采集成功率 | > 99.5% |
| 跨网域断网续传 | 断网 24 小时内数据可自动补齐 |
| 异构监控接入成本 | 现有 Prometheus 接入配置时间 < 10 分钟 |
| 代码与上游隔离度 | 业务代码 100% 位于 `platform/`，源码修改 100% patch 化 |

---

## 6. 控制面与数据面分层

MetricCenter 在 Prometheus 生态之上构建控制面，详细架构见 [00_Global_Architecture.md](00_Global_Architecture.md)。

核心边界：

| 职责 | 控制面（MetricCenter） | 数据面（Prometheus 生态） |
|------|------------------------|---------------------------|
| 资源管理 | ✅ | ❌ |
| 采集规则下发 | ✅ | ❌ |
| 标签模板与字段映射 | ✅ | ❌ |
| 指标抓取 / 时序存储 / PromQL | ❌（可代理） | ✅ |
| 告警规则求值 | ❌（MVP 阶段） | ✅ |
| 拨测执行 | ❌（生成配置） | ✅（Blackbox Exporter） |
| 告警收敛 / 静默 / 通知 | ❌（MVP 阶段） | ✅（Alertmanager） |

---

## 7. 演进路径（摘要）

详细里程碑与技术演进见 [02_Product_Roadmap.md](02_Product_Roadmap.md)，实施难度分析见 [04_Implementation_Map.md](04_Implementation_Map.md)。

- **MVP**：三类资源管理 + 默认站点 + 标签模板（`system` / `user` label）+ 采集 Job + 拨测 + 配置下发 + 指标查询（单机模式无感知）
- **v0.2**：多站点模式 + Edge Agent + Remote Write + VictoriaMetrics 中心汇聚 + 边缘 Agent 诊断；租户数据模型与租户-网域关联落地
- **v0.3 ~ v0.4**：异构监控源登记册、外部 Prometheus / Zabbix 接入、查询门户、告警状态查看、Open API；外部 CMDB 同步（BlueKing/HTTP/Nacos）与 `cmdb` 来源 label
- **v1.0 及以后**：告警规则 UI、Alertmanager 配置生成、边缘自治告警、多租户权限 UI、长期存储、ITSM/ITIL 事件对接
