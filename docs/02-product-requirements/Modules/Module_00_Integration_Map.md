# Module 00: 模块职责矩阵与集成关系

> **模块类型**: 全局索引文档  
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[00_Product_Vision.md](../00_Product_Vision.md)  
> **目标用户**: 产品经理、技术架构师、AI 应用开发工程师、SRE  
> **版本**: v1.0  
> **更新日期**: 2026-07-27

---

## 1. 文档目的

本文件是 MetricCenter 各模块 PRD 的**单一职责索引**，用于：

1. 明确每个功能/数据模型/接口的唯一 Owner，避免模块间重复描述。
2. 给出跨模块引用关系，便于快速定位权威定义。
3. 作为 AI Agent 进行模块级规划时的必读索引，减少上下文冲突。

> **维护规则**：当新增模块或调整功能边界时，必须同步更新本文件；模块 PRD 中不再重复建立完整数据模型，统一引用本矩阵或对应模块 PRD。

---

## 2. 模块职责矩阵

| 模块 | 功能 Owner | 数据/模型 Owner | MVP 实现者 | 主要依赖模块 | 核心输出物 |
|------|------------|-----------------|------------|--------------|------------|
| **Module_01 指标管理与采集状态中心** | 指标管理数据契约、采集目标/拨测/诊断运行时展示 | `ScrapeTarget`、`ScrapeLog`、指标元数据 | Module_07（MVP 编辑入口） | Module_07、Prometheus | 采集状态 API、诊断视图 |
| **Module_02 查询中心** | PromQL 查询代理、标签/series API | 查询结果代理 | Module_02 | Prometheus、Module_03 | `/api/v1/query*` 代理 |
| **Module_03 网关与认证** | 统一入口、网关层认证鉴权、多租户路由、请求级审计 | 路由/中间件配置 | Module_03 | Module_06（用户/角色/租户数据） | Gateway、Auth 中间件 |
| **Module_04 自定义服务发现** | 外部 CMDB/K8s/Nacos Provider 扩展 | Provider 接口实现（遵循 Module_07 接口） | Module_07（MVP Provider） | Module_07 | BlueKing/HTTP/Nacos Provider |
| **Module_05 自定义前端门户** | UI 页面组织、交互设计 | 前端组件/页面 | Module_05 | Module_01/02/07/08/09/10 | Web 门户 |
| **Module_06 系统与平台管理（含多租户）** | 租户/用户/角色生命周期、权限策略、审计日志展示与归档、平台全局策略 | `Tenant`、`User`、`Role`、审计记录 | Module_06 | Module_03 | 平台管理 API |
| **Module_07 配置管理** | 三类资源管理、配置生成与下发、MVP 指标管理配置实现 | `Resource`、`ScrapeJob`、`LabelTemplate`、`BlackboxProbeConfig`、`CMDBProvider` | Module_07 | Module_09（NetworkDomain 引用） | `prometheus.yml`、配置包内容 |
| **Module_08 告警规则管理** | 告警规则生命周期、告警状态查看、抑制规则 | `AlertingRule`、`RuleGroup`、`Silence`、`Notifier` | MVP 手写 YML；未来 Module_08 | Module_02（告警代理）、Module_09（`EdgeSiteOffline` 触发条件） | `rules.yml`、`alertmanager.yml` |
| **Module_09 网域与边缘 Agent 管理** | NetworkDomain 生命周期、Edge Agent 生命周期、配置拉取接口、Token 安全 | `NetworkDomain`、`EdgeAgent`、`EdgeHeartbeat` | Module_09 | Module_07（配置内容） | `/api/v2/platform/edge/*` |
| **Module_10 监控源登记册与异构接入** | 监控源登记、外部 Prometheus/Zabbix/云监控接入、Ingestion Gateway 业务逻辑 | `MonitoringSource`、`IngestionStats` | Module_10 | Module_09（网域引用）、Module_03（网关框架） | `/api/v2/ingest/*`、Remote Write 配置片段 |

---

## 3. 关键跨模块引用关系

### 3.1 NetworkDomain

- **数据模型 Owner**: Module_09
- **生命周期 UI/API Owner**: Module_09
- **引用方**: Module_07（资源/Job/配置分组）、Module_10（监控源归属）
- **权威定义**: [Module_09 4.1 节](Module_09_Network_Domain_and_Edge_Agent.md#41-%E7%BD%91%E5%9F%9Fnetworkdomain)

### 3.2 Edge Agent 状态

- **数据模型 Owner**: Module_09
- **心跳接收与状态展示 Owner**: Module_09
- **引用方**: Module_01（采集诊断页面聚合展示）
- **权威定义**: [Module_09 4.2 节](Module_09_Network_Domain_and_Edge_Agent.md#42-%E8%BE%B9%E7%BC%98-agentedgeagent)

### 3.3 Edge Sync Agent 配置拉取

- **协议与接口 Owner**: Module_09
- **配置包内容生成 Owner**: Module_07
- **权威定义**: [Module_09 5.2 节](Module_09_Network_Domain_and_Edge_Agent.md#52-%E9%85%8D%E7%BD%AE%E5%8C%85%E6%8B%89%E5%8F%96%E6%8E%A5%E5%8F%A3)

### 3.4 指标管理配置

- **功能 Owner / 数据契约**: Module_01
- **MVP 编辑入口与实现**: Module_07
- **权威定义**: [Module_01 3.1 节](Module_01_Metric_Collection_Center.md#31-%E6%8C%87%E6%A0%87%E7%AE%A1%E7%90%86%E5%8A%9F%E8%83%BD-owner)

### 3.5 CMDB Provider

- **接口定义与 MVP 实现 Owner**: Module_07
- **未来外部 Provider 扩展 Owner**: Module_04
- **权威定义**: [Module_07 10 节](Module_07_Config_Management.md#10-cmdb-provider-%E6%89%A9%E5%B1%95%E8%AE%BE%E8%AE%A1)

### 3.6 告警状态

- **业务功能 Owner**: Module_08
- **查询代理通道**: Module_02
- **UI 页面**: Module_05
- **权威定义**: [Module_08 3.1 节](Module_08_Alerting_Rule_Management.md#31-%E5%91%8A%E8%AD%A6%E8%A7%84%E5%88%99%E7%AE%A1%E7%90%86)

### 3.7 认证 / 多租户 / 权限 / 审计

- **网关层鉴权与请求级审计**: Module_03
- **租户/用户/角色生命周期、权限策略、审计日志展示/归档**: Module_06
- **权威定义**:
  - Module_03: [Module_03 3 节](Module_03_Gateway_and_Auth.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)
  - Module_06: [Module_06 3 节](Module_06_Multi_Tenant.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)

### 3.8 Remote Write / 存储配置

- **Edge Agent Remote Write 参数**: Module_09（per-domain `remote_write_url`、WAL 参数）
- **Ingestion Gateway Remote Write 接收点 / 外部 Prometheus 接入**: Module_10
- **平台级 TSDB 状态 / Retention / 转发开关**: Module_06
- **配置生成器引用并注入**: Module_07

### 3.9 Ingestion Gateway

- **通用网关框架 / 统一入口**: Module_03
- **异构接入业务逻辑（Remote Write 接收、鉴权、标签注入、限流）**: Module_10
- **权威定义**: [Module_10 3.3 节](Module_10_Monitoring_Source_Registry.md#33-ingestion-gateway)

### 3.10 外部 Prometheus Remote Write 标识

- **统一方式**: URL path `/api/v2/ingest/prometheus/<monitoring_source_id>`
- `network_domain` 从 Token/Claims 推导，不再依赖 `X-Network-Domain` 或 `X-MetricCenter-Source-ID` header
- **权威定义**: [Module_10 5.1 节](Module_10_Monitoring_Source_Registry.md#51-%E5%A4%96%E9%83%A8-prometheus-remote-write-%E6%8E%A5%E5%85%A5)

---

## 4. 常见重叠禁区

| 禁止行为 | 正确做法 |
|----------|----------|
| 在 Module_07 中重新定义 NetworkDomain 完整数据模型 | Module_07 仅引用 `id/name/status`；完整模型在 Module_09 |
| 在 Module_01 中定义 EdgeAgent 数据模型 | Module_01 仅引用 Module_09 提供的状态 |
| 在 Module_03 中定义用户/角色/租户 CRUD | Module_03 只做网关层鉴权；CRUD 在 Module_06 |
| 在 Module_04 中修改 CMDBProvider 接口签名 | 接口签名由 Module_07 定义，Module_04 遵循 |
| 在 Module_07 中独立维护 Remote Write 配置 | 引用 Module_09（Edge Agent）与 Module_10（Ingestion Gateway）配置 |
| 在 Module_05 中重新定义业务规则 | Module_05 只做 UI 聚合，规则以后端模块为准 |

---

## 5. 变更日志

| 日期 | 变更内容 | 修改人 |
|------|----------|--------|
| 2026-07-27 | 初版：整合 Module_01 ~ Module_10 职责矩阵与跨模块引用关系 | chenrt |
