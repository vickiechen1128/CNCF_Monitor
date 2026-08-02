# Module 00: 模块职责矩阵与集成关系

> **PRD 状态**: `draft`
> **PRD 版本**: v1.3
> **更新日期**: 2026-07-31
> **对应原型**: 暂无（待原型验证后补充）

> **模块类型**: 全局索引文档
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[00_Product_Vision.md](../00_Product_Vision.md)
> **目标用户**: 产品经理、技术架构师、AI 应用开发工程师、SRE

---

## 1. 文档目的

本文件是 MetricCenter 各模块 PRD 的**单一职责索引**，用于：

1. 明确每个功能/数据模型/接口的唯一 Owner，避免模块间重复描述。
2. 给出跨模块引用关系，便于快速定位权威定义。
3. 作为 AI Agent 进行模块级规划时的必读索引，减少上下文冲突。

> **维护规则**：当新增模块或调整功能边界时，必须同步更新本文件；模块 PRD 中不再重复建立完整数据模型，统一引用本矩阵或对应模块 PRD。
>
> **阶段标签约定**：本文件中的 `{MVP}`、`{v0.2}`、`{v0.4+}`、`{v1.0+}` 标注表示该能力预计落地的阶段；未标注的默认属于当前讨论范围。

---

## 2. 模块职责矩阵

| 模块 | 功能 Owner | 数据/模型 Owner | MVP 实现者 | 主要依赖模块 | 核心输出物 |
|------|------------|-----------------|------------|--------------|------------|
| **Module_01 监控策略与指标管理** | 监控策略配置层：CI 类型 ↔ Exporter 模板绑定、ScrapeJob 配置、实例选择、规则编辑 UI、指标元数据管理 {P1} | `CITypeExporterMapping`、`ExporterTemplate`、`ScrapeJob`、`MonitoringRule`、`ExporterMetricLibrary` | Module_01 | Module_07、Module_09、Module_02、Module_08 | 策略配置 API、规则编辑 UI、指标元数据 API |
| **Module_02 查询中心** | Prometheus Query API 代理（instant / range / labels / series / alerts）、租户/网域标签自动注入、响应 envelope 元数据（`data_source` / `freshness_at` / `network_domain`） | 查询结果代理、多租户注入规则 | Module_02 | Prometheus、Module_03、Module_06、Module_09、Module_08 | `/api/v1/query*` 代理、`/api/v1/alerts` 代理 |
| **Module_03 网关与认证** | 统一入口、网关层认证鉴权、多租户路由、请求级审计 | 路由/中间件配置 | Module_03 | Module_06（用户/角色/租户数据） | Gateway、Auth 中间件 |
| **Module_04 自定义服务发现与外部 CMDB 生命周期管理** {v0.4+} | 外部 CMDB/K8s/Nacos Provider 扩展；CMDB 同步策略、失败容错、7 天保留、孤儿虚拟 CI 管理 | Provider 接口实现（遵循 Module_07 接口）、CMDB 同步任务、孤儿分组模型 | Module_07（MVP Provider） | Module_07 | BlueKing/HTTP/Nacos Provider、 orphans 视图 |
| **Module_05 自定义前端门户** | UI 页面组织、交互设计 | 前端组件/页面 | Module_05 | Module_01/02/07/08/09/10 | Web 门户 |
| **Module_06 租户与平台管理（含多租户）** | 租户生命周期 {v0.2}、租户-网域关联 {v0.2}、平台全局策略、数据存储管理；**不存在跨租户全局管理员**；用户/角色/权限可能由外部 IAM/SSO 承接 | `Tenant`、`User`、`Role`、审计记录 | Module_06 | Module_03、Module_09 | 平台管理 API |
| **Module_07 监控对象管理** {MVP 核心} | 四类资源管理、标签模板、资源标签、Excel 导入、Resource「已监控 / 未监控」badge；不再负责 ScrapeJob / 配置生成 / 配置下发 | `Resource`（含 `generic_target`）、`LabelTemplate`、`ResourceLabel`、`CMDBProvider` | Module_07 | Module_09（NetworkDomain 引用）、Module_01 | Resource / LabelTemplate / ResourceLabel API |
| **Module_08 告警规则管理** | 告警规则生命周期（分组、静默、Alertmanager 配置）、Alertmanager 集成、通知状态、边缘本地告警心跳 {P2}；规则编辑 UI 由 Module_01 提供 | `AlertingRule`、`RuleGroup`、`Silence`、`Notifier` | Module_08 | Module_01（规则来源）、Module_02（告警代理）、Module_09（`EdgeSiteOffline` 触发条件、边缘心跳） | `rules.yml`、`alertmanager.yml` |
| **Module_09 网域与边缘配置中心** | NetworkDomain / EdgeAgent 生命周期、配置生成 / 预览 / 下发、配置拉取接口、Token 安全、`external_labels` 注入、Agent 状态列表页 {MVP}、边缘诊断看板 {P1/P2} | `NetworkDomain`、`EdgeAgent`、`EdgeHeartbeat`、`ConfigDraft`、`ConfigVersion`、`ConfigDeployment`、`Tenant-NetworkDomain` 关系 | Module_09 | Module_01（策略数据）、Module_07（对象数据）、Module_06（Tenant）、Module_08（规则） | `/api/v2/platform/edge/*`、配置生成服务 |
| **Module_10 监控源登记册与异构接入** | 监控源登记、外部 Prometheus/Zabbix/云监控接入、Ingestion Gateway 业务逻辑 | `MonitoringSource`、`IngestionStats`、`LabelNormalizationRule`、`MetricDropRule` | Module_10 | Module_09（网域引用）、Module_03（网关框架） | `/api/v2/ingest/*`、Remote Write 配置片段 |

---

## 3. 关键跨模块引用关系

### 3.1 NetworkDomain

- **数据模型 Owner**: Module_09
- **生命周期 UI/API Owner**: Module_09
- **引用方**: Module_07（资源分组）、Module_10（监控源归属）
- **权威定义**: [Module_09 4.1 节](Module_09_Network_Domain_and_Edge_Config_Center.md#41-%E7%BD%91%E5%9F%9Fnetworkdomain)

### 3.2 Edge Agent 状态

- **数据模型 Owner**: Module_09
- **心跳接收与状态展示 Owner**: Module_09
- **引用方**: Module_02（目标状态聚合）、Module_08（告警抑制场景）
- **权威定义**: [Module_09 4.2 节](Module_09_Network_Domain_and_Edge_Config_Center.md#42-%E8%BE%B9%E7%BC%98-agentedgeagent)

### 3.3 Edge Sync Agent 配置拉取

- **协议与接口 Owner**: Module_09
- **配置生成 / 预览 / 下发 Owner**: Module_09
- **配置数据消费方**: Module_01（ScrapeJob / Rule 策略）、Module_07（Resource / LabelTemplate）、Module_08（告警规则）
- **权威定义**: [Module_09 5.1 节](Module_09_Network_Domain_and_Edge_Config_Center.md#51-%E8%BD%AE%E8%AF%A2%E7%94%9F%E6%88%90%E6%B5%81%E7%A8%8B)、[Module_09 5.2 节](Module_09_Network_Domain_and_Edge_Config_Center.md#52-%E7%A1%AE%E8%AE%A4%E4%B8%8E%E4%B8%8B%E5%8F%91%E6%97%B6%E5%BA%8F)

### 3.4 指标管理配置

- **功能 Owner / 数据契约 / MVP 编辑入口**: Module_01
- **依赖数据**: Module_07 的 `Resource`、`ResourceType`、`LabelTemplate`
- **权威定义**: [Module_01 3.1 节](Module_01_Metric_Collection_Center.md#31-%E7%9B%91%E6%8E%A7%E7%AD%96%E7%95%A5%E9%85%8D%E7%BD%AEmvp)、[Module_01 3.2 节](Module_01_Metric_Collection_Center.md#32-%E8%A7%84%E5%88%99%E7%BC%96%E8%BE%91-uimvp)

### 3.5 CMDB Provider

- **接口定义与 MVP 实现 Owner**: Module_07
- **外部 Provider 扩展与 CMDB 生命周期管理 Owner**: Module_04 {v0.4+}
- **权威定义**:
  - Module_07: [10 节](Module_07_Monitoring_Object_Management.md#10-cmdb-provider-%E6%89%A9%E5%B1%95%E8%AE%BE%E8%AE%A1)
  - Module_04: [5 节](Module_04_Custom_Discovery.md#5-cmdb-%E5%90%8C%E6%AD%A5%E7%AD%96%E7%95%A5%E4%B8%8E%E5%A4%B1%E8%B4%A5%E5%A4%84%E7%90%86)、[6 节](Module_04_Custom_Discovery.md#6-%E5%AD%90%E5%84%BF%E8%99%9A%E6%8B%9F-ci-%E7%AE%A1%E7%90%86)

### 3.6 告警状态

- **业务功能 Owner**: Module_08
- **查询代理通道**: Module_02
- **UI 页面**: Module_05
- **权威定义**: [Module_08 3.1 节](Module_08_Alerting_Rule_Management.md#31-%E5%91%8A%E8%AD%A6%E8%A7%84%E5%88%99%E7%AE%A1%E7%90%86)

### 3.7 认证 / 多租户 / 权限 / 审计

- **网关层鉴权与请求级审计**: Module_03
- **租户生命周期、租户-网域关联 {v0.2}**: Module_06
- **用户/角色生命周期、权限策略、审计日志展示/归档**: Module_06 {P2 / 可能由外部 IAM/SSO 承接}
- **权威定义**:
  - Module_03: [Module_03 3 节](Module_03_Gateway_and_Auth.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)
  - Module_06: [Module_06 3 节](Module_06_Multi_Tenant.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)

### 3.8 Remote Write / 存储配置

- **Edge Agent Remote Write 参数**: Module_09（per-domain `remote_write_url`、WAL 参数）
- **Ingestion Gateway Remote Write 接收点 / 外部 Prometheus 接入**: Module_10
- **Ingestion Gateway 在写入前执行标签归一化与 Metric Drop Rules**: Module_10
- **平台级 TSDB 状态 / Retention / 转发开关**: Module_06
- **配置生成器引用并注入**: Module_09

### 3.9 Ingestion Gateway

- **通用网关框架 / 统一入口**: Module_03
- **异构接入业务逻辑（Remote Write 接收、鉴权、标签注入、限流）**: Module_10
- **权威定义**: [Module_10 3.3 节](Module_10_Monitoring_Source_Registry.md#33-ingestion-gateway)

### 3.10 外部 Prometheus Remote Write 标识

- **统一方式**: URL path `/api/v2/ingest/prometheus/<monitoring_source_id>`
- `network_domain` 从 Token/Claims 推导，不再依赖 `X-Network-Domain` 或 `X-MetricCenter-Source-ID` header
- **权威定义**: [Module_10 5.1 节](Module_10_Monitoring_Source_Registry.md#51-%E5%A4%96%E9%83%A8-prometheus-remote-write-%E6%8E%A5%E5%85%A5)

### 3.11 Tenant 与 NetworkDomain 关系 {v0.2}

- **Tenant 数据模型 Owner**: Module_06
- **NetworkDomain 数据模型 Owner**: Module_09
- **Tenant-NetworkDomain 关系 Owner**: Module_09（通过 `NetworkDomain.tenant_id`）
- **引用方**: Module_07（资源只读引用 `network_domain_id`，不感知租户）
- **权威定义**: [Module_09 4.1 节](Module_09_Network_Domain_and_Edge_Config_Center.md#41-%E7%BD%91%E5%9F%9Fnetworkdomain)、[Module_06 3.1 节](Module_06_Multi_Tenant.md#31-%E7%A7%9F%E6%88%B7%E4%B8%8E%E7%BD%91%E5%9F%9F%E5%85%B3%E7%B3%BB)

### 3.12 标签归一化

- **业务逻辑 Owner**: Module_10
- **引用方**: Module_07（标签模板作为归一化前的预定义映射参考）
- **权威定义**: [Module_10 3.4 节](Module_10_Monitoring_Source_Registry.md#34-%E6%A0%87%E7%AD%BE%E5%BD%92%E4%B8%80%E5%8C%96%E4%B8%8E%E6%B8%85%E6%B4%97%E7%AE%A1%E9%81%93)

### 3.13 指标丢弃规则

- **业务逻辑 Owner**: Module_10
- **引用方**: 无
- **权威定义**: [Module_10 3.5 节](Module_10_Monitoring_Source_Registry.md#35-%E6%8C%87%E6%A0%87%E4%B8%A2%E5%BC%83%E4%B8%8E%E4%B8%A2%E5%8C%85%E9%98%B2%E6%8A%A4)

### 3.14 CMDB 与 ITIL/ITSM 映射 {v1.0+}

- **CMDB 数据 Owner**: Module_07（`Resource` 模型、CMDB 字段注入）；**CMDB 同步与生命周期 Owner**: Module_04 {v0.4+}
- **ITIL 事件字段 Owner**: Module_08（告警转 ITIL 事件字段规则）
- **引用方**: Module_05（UI 展示）、Module_06（租户/网域映射）
- **权威定义**:
  - Module_04: [5 节](Module_04_Custom_Discovery.md#5-cmdb-%E5%90%8C%E6%AD%A5%E7%AD%96%E7%95%A5%E4%B8%8E%E5%A4%B1%E8%B4%A5%E5%A4%84%E7%90%86)、[6 节](Module_04_Custom_Discovery.md#6-%E5%AD%90%E5%84%BF%E8%99%9A%E6%8B%9F-ci-%E7%AE%A1%E7%90%86)、[7 节](Module_04_Custom_Discovery.md#7-blueking-cmdb-%E6%98%A0%E5%B0%84%E8%A7%84%E8%8C%83)
  - Module_07: [10 节](Module_07_Monitoring_Object_Management.md#10-cmdb-provider-%E6%89%A9%E5%B1%95%E8%AE%BE%E8%AE%A1)
  - Module_08: [5.7 节](Module_08_Alerting_Rule_Management.md#57-itil-%E4%BA%8B%E4%BB%B6%E5%AD%97%E6%AE%B5%E6%98%A0%E5%B0%84)
- **关键约束**:
  - **CMDB（腾讯蓝鲸）是监控对象的唯一数据源 {v0.4+}**；MetricCenter 本地资源是其只读/缓存镜像；同步策略与生命周期由 Module_04 负责。
  - ITSM 服务目录必须显式映射到 CMDB 业务/模块路径，禁止绕过 CMDB 直接定义业务归属 {v1.0+}。
  - ITIL 事件字段来源 {v1.0+}：严重等级来自 Prometheus label，影响范围来自 CMDB 拓扑，接收人来自告警规则 receiver，负责人来自 CMDB 维护人 + ITSM 值班，服务目录来自 ITSM 与 CMDB 的显式映射。

### 3.15 Tenant / NetworkDomain 与 BlueKing CMDB 映射

- **Tenant 数据模型 + 网域关联 Owner {v0.2}**: Module_06
- **NetworkDomain 数据模型 + 租户关联 Owner {v0.2}**: Module_09
- **Tenant/NetworkDomain → BlueKing 映射 Owner {v0.4+}**: Module_04（同步实现），映射关系由 Module_06/09 维护
- **引用方**: Module_07（资源字段注入）、Module_08（影响范围拓扑）
- **权威定义**:
  - Module_06: [3.1 节](Module_06_Multi_Tenant.md#31-%E7%A7%9F%E6%88%B7%E4%B8%8E%E7%BD%91%E5%9F%9F%E5%85%B3%E7%B3%BB)、[3.2 节](Module_06_Multi_Tenant.md#32-%E7%A7%9F%E6%88%B7%E4%B8%8E-blueking-cmdb-%E6%98%A0%E5%B0%84)
  - Module_09: [4.1 节](Module_09_Network_Domain_and_Edge_Config_Center.md#41-%E7%BD%91%E5%9F%9Fnetworkdomain)、[4.4 节](Module_09_Network_Domain_and_Edge_Config_Center.md#44-%E7%BD%91%E5%9F%9F%E4%B8%8E-blueking-cloud-area-%E6%98%A0%E5%B0%84)
  - Module_04: [7 节](Module_04_Custom_Discovery.md#7-blueking-cmdb-%E6%98%A0%E5%B0%84%E8%A7%84%E8%8C%83)
- **关键约束**:
  - **1 租户 : N 网域 {v0.2}**，禁止跨租户共享网域；`default` 网域归属 `platform_admin` 租户，仍遵循单一租户归属。
  - `network_domain_id` 必须全局唯一 {v0.2}，建议采用租户前缀（如 `<tenant_id>-<domain_code>`）。
  - **租户 → 蓝鲸业务（Business）{v0.4+ 同步}**；**网域 → 蓝鲸云区域（Cloud Area）{v0.4+ 同步}**。

### 3.16 Resource Label 生命周期 {MVP / v0.4+}

- **数据模型 Owner**: Module_07（`ResourceLabel` 单表 + `source` 字段）
- **模板规则 Owner**: Module_07（`LabelTemplate` 决定 Resource 字段 → Prometheus Label 的默认映射）
- **CMDB 来源 Label 写入 Owner {v0.4+}**: Module_04（BlueKing/HTTP/Nacos Provider 同步时写入 `source=cmdb`）
- **用户手动 Label UI Owner**: Module_05（P0 标签编辑页面）
- **引用方**: Module_01（策略配置时引用 `LabelTemplate` / `ResourceLabel`）、Module_09（配置生成时合并所有来源 label）、Module_10（标签归一化参考）
- **权威定义**:
  - Module_07: [5.2.2 节](Module_07_Monitoring_Object_Management.md#522-%E8%B5%84%E6%BA%90-label-resourcelabel)、[5.7 节](Module_07_Monitoring_Object_Management.md#57-%E6%A0%87%E7%AD%BE%E6%A8%A1%E6%9D%BF-labeltemplate)、[5.8 节](Module_07_Monitoring_Object_Management.md#58-%E5%AD%97%E6%AE%B5%E6%98%A0%E5%B0%84-mapping)、[5.9 节](Module_07_Monitoring_Object_Management.md#59-%E6%A0%87%E7%AD%BE%E6%A8%A1%E6%9D%BF%E5%AD%97%E6%AE%B5%E6%9D%A5%E6%BA%90)、[5.10 节](Module_07_Monitoring_Object_Management.md#510-%E9%BB%98%E8%AE%A4%E6%A0%87%E7%AD%BE%E6%A8%A1%E6%9D%BF)
  - Module_04: [7.1 节](Module_04_Custom_Discovery.md#71-cmdb-ci-%E7%B1%BB%E5%9E%8B%E6%98%A0%E5%B0%84%E8%A1%A8)、[7.2 节](Module_04_Custom_Discovery.md#72-%E5%BE%85%E5%88%86%E7%B1%BB-ci-%E9%98%9F%E5%88%97)
- **关键约束**:
  - Label 在 MetricCenter 内部按 `source` 分层：`system`（模板生成）/ `user`（用户手动）/ `cmdb {v0.4+}`（CMDB 同步）。
  - 生成 `prometheus.yml` 时统一打平；同 key 冲突优先级：`cmdb` > `user` > `system`。
  - 用户手动 label 禁止覆盖 Prometheus 内置 label（`instance`、`job`、`scheme`、`__address__` 等），key 强制小写/下划线、禁止 `__` 开头。
  - CMDB 字段（`cmdb_business_path`、`cmdb_module_path`、`cmdb_maintainer`）作为 `source=cmdb` label 在 v0.4+ 由 Module_04 注入；MVP 阶段仅预留字段，不生成 label。
  - Excel 导入的 `instance_name`、`hostname`、`os_type` 等字段在 MVP 通过 `LabelTemplate` 生成 `source=system` label。

### 3.17 监控策略生命周期 {MVP}

- **CI 类型 ↔ Exporter 模板绑定 Owner**: Module_01
- **ScrapeJob 配置与实例选择 Owner**: Module_01
- **规则编辑 UI Owner**: Module_01
- **Exporter 安装/注册确认 Owner**: Module_01
- **配置生成 / 预览 / 人工确认 / 下发 Owner**: Module_09
- **数据依赖**: Module_07 的 `Resource`、`ResourceType`、`LabelTemplate`、`ResourceLabel`
- **关键流程**:
  1. Module_01 基于 `CITypeExporterMapping` 与 `ExporterTemplate` 创建 `ScrapeJob`，手动勾选实例并确认 Exporter 安装状态。
  2. Module_01 将 `ScrapeJob` 与 `MonitoringRule` 写入数据库（期望态）。
  3. Module_09 定时轮询 Module_01 / Module_07 / Module_08 数据，按 `network_domain_id` 生成 `ConfigDraft`。
  4. UI 提供配置预览与 diff，工程师人工确认后 `ConfigDraft` 转为 `ConfigVersion`。
  5. Module_09 执行下发：中心 Prometheus reload 或 Edge Sync Agent 拉取配置包。
- **权威定义**:
  - Module_01: [3.1 节](Module_01_Metric_Collection_Center.md#31-%E7%9B%91%E6%8E%A7%E7%AD%96%E7%95%A5%E9%85%8D%E7%BD%AEmvp)
  - Module_09: [5.1 节](Module_09_Network_Domain_and_Edge_Config_Center.md#51-%E8%BD%AE%E8%AF%A2%E7%94%9F%E6%88%90%E6%B5%81%E7%A8%8B)、[5.2 节](Module_09_Network_Domain_and_Edge_Config_Center.md#52-%E7%A1%AE%E8%AE%A4%E4%B8%8E%E4%B8%8B%E5%8F%91%E6%97%B6%E5%BA%8F)

### 3.18 运行时目标状态展示 {MVP}

- **原属 Module_01 的运行时展示职责已拆分**:
  - 目标列表、目标详情、状态筛选、拨测结果、采集诊断、Job 健康度、覆盖率：移交 **Module_02**（查询中心）。
  - 告警状态展示：由 **Module_08** 拥有业务功能，**Module_02** 提供查询代理通道。
  - 边缘 Agent 状态展示：由 **Module_09** 负责。
- **权威定义**:
  - Module_01: [3.3 节](Module_01_Metric_Collection_Center.md#33-%E8%BF%90%E8%A1%8C%E6%97%B6%E9%87%87%E9%9B%86%E7%8A%B6%E6%80%81%E5%B1%95%E7%A4%BA%E5%B7%B2%E7%A7%BB%E5%87%BA)
  - Module_02: [3 节](Module_02_Query_Center.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)

### 3.19 查询中心

- **功能 Owner**: Module_02
- **核心职责**: 代理 Prometheus Query API，按认证用户自动注入 `tenant_id` 与有权限的 `network_domain` 标签；在返回结果外层包裹 envelope 元数据（`data_source`、`freshness_at`、`network_domain`），不污染 PromQL series 标签。
- **依赖模块**:
  - Module_06：租户-网域模型、用户权限与隔离策略（不存在跨租户全局管理员）。
  - Module_09：Edge Agent `external_labels` 注入，为按网域查询与租户隔离提供标签基础。
  - Module_08：Alertmanager 通知状态由 Module_08 负责，Module_02 仅代理 Prometheus `/api/v1/alerts`。
- **权威定义**:
  - Module_02: [3 节](Module_02_Query_Center.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)、[4 节](Module_02_Query_Center.md#4-%E6%8E%A5%E5%8F%A3%E8%AE%BE%E8%AE%A1)、[5 节](Module_02_Query_Center.md#5-%E8%87%AA%E5%8A%A8%E6%B3%A8%E5%85%A5%E8%A7%84%E5%88%99)、[6 节](Module_02_Query_Center.md#6-%E5%93%8D%E5%BA%94-envelope-%E4%B8%8E%E6%95%B0%E6%8D%AE%E6%96%B0%E9%B2%9C%E5%BA%A6)

### 3.20 Edge Agent 状态

- **数据模型 Owner**: Module_09（`EdgeAgent`、`EdgeHeartbeat`）
- **心跳接收与状态展示 Owner**: Module_09
- **UI 消费方**: Module_05（Agent 状态列表页、边缘诊断看板）
- **引用方**: Module_02（展示被监控对象采集健康度时不直接依赖 Agent 状态，但可在 UI 上做来源提示）、Module_08（`EdgeSiteOffline` 抑制规则、边缘本地告警状态）
- **关键约束**:
  - MVP 阶段以「Agent 状态列表页」满足基本可观测需求，展示在线状态、最后心跳、配置版本、WAL 积压、最近错误。
  - 图表/趋势类边缘诊断看板（心跳 RTT 趋势、WAL 积压趋势、24h 断网时长等）延后至 P1/P2。
- **权威定义**:
  - Module_09: [3.2 节](Module_09_Network_Domain_and_Edge_Config_Center.md#32-%E8%BE%B9%E7%BC%98-agent-%E7%AE%A1%E7%90%86)、[3.8 节](Module_09_Network_Domain_and_Edge_Config_Center.md#38-agent-%E7%8A%B6%E6%80%81%E5%88%97%E8%A1%A8%E4%B8%8E%E8%BE%B9%E7%BC%98%E8%AF%8A%E6%96%AD%E7%9C%8B%E6%9D%BF)、[4.2 节](Module_09_Network_Domain_and_Edge_Config_Center.md#42-%E8%BE%B9%E7%BC%98-agentedgeagent)、[4.3 节](Module_09_Network_Domain_and_Edge_Config_Center.md#43-%E5%BF%83%E8%B7%B3%E4%B8%8A%E6%8A%A5edgeheartbeat)

### 3.21 告警状态

- **Prometheus 当前触发告警**: 由 Module_02 代理 Prometheus `/api/v1/alerts`，展示 firing/pending 告警实例，回答「当前触发了哪些规则、哪些对象有问题」。
- **Alertmanager 通知状态**: 由 Module_08 负责集成与展示，回答「告警正在通知给谁、是否被静默/抑制」。
- **边缘本地告警（断网场景）{P2}**: 由边缘本地 Alertmanager 处理，状态通过 Module_09 EdgeHeartbeat 上报，展示在 Module_09 Agent 状态页或 Module_08 边缘告警视图，不归 Module_02 代理。
- **权威定义**:
  - Module_02: [3 节](Module_02_Query_Center.md#3-%E6%A0%B8%E5%BF%83%E5%8A%9F%E8%83%BD)、[4 节](Module_02_Query_Center.md#4-%E6%8E%A5%E5%8F%A3%E8%AE%BE%E8%AE%A1)、[6 节](Module_02_Query_Center.md#6-%E5%93%8D%E5%BA%94-envelope-%E4%B8%8E%E6%95%B0%E6%8D%AE%E6%96%B0%E9%B2%9C%E5%BA%A6)
  - Module_08: [3.1 节](Module_08_Alerting_Rule_Management.md#31-prometheus-%E5%91%8A%E8%AD%A6-vs-alertmanager-%E9%80%9A%E7%9F%A5%E7%8A%B6%E6%80%81)、[3.2 节](Module_08_Alerting_Rule_Management.md#32-%E4%B8%AD%E5%BF%83%E8%BE%B9%E7%BC%98%E5%91%8A%E8%AD%A6%E7%81%BE%E5%A4%87%E8%BE%B9%E7%95%8C)、[5.3 节](Module_08_Alerting_Rule_Management.md#53-%E5%91%8A%E8%AD%A6%E7%8A%B6%E6%80%81%E6%9F%A5%E7%9C%8B)
  - Module_09: [3.2 节](Module_09_Network_Domain_and_Edge_Config_Center.md#32-%E8%BE%B9%E7%BC%98-agent-%E7%AE%A1%E7%90%86)、[3.8 节](Module_09_Network_Domain_and_Edge_Config_Center.md#38-agent-%E7%8A%B6%E6%80%81%E5%88%97%E8%A1%A8%E4%B8%8E%E8%BE%B9%E7%BC%98%E8%AF%8A%E6%96%AD%E7%9C%8B%E6%9D%BF)、[4.3 节](Module_09_Network_Domain_and_Edge_Config_Center.md#43-%E5%BF%83%E8%B7%B3%E4%B8%8A%E6%8A%A5edgeheartbeat)

---

## 4. 常见重叠禁区

| 禁止行为 | 正确做法 |
|----------|----------|
| 在 Module_07 中重新定义 NetworkDomain 完整数据模型 | Module_07 仅引用 `id/name/status`；完整模型在 Module_09 |
| 在 Module_01 中定义 EdgeAgent 数据模型 | Module_01 仅引用 Module_09 提供的状态 |
| 在 Module_03 中定义用户/角色/租户 CRUD | Module_03 只做网关层鉴权；CRUD 在 Module_06 |
| 在 Module_04 中修改 CMDBProvider 接口签名 | 接口签名由 Module_07 定义，Module_04 遵循 |
| 在 Module_07 中实现 CMDB 同步策略/孤儿资源生命周期 | 外部数据源生命周期由 Module_04 负责；Module_07 只消费同步后的 `Resource` |
| 在 Module_07 中维护 `ScrapeJob` 或生成 `prometheus.yml` | `ScrapeJob` 由 Module_01 负责；配置生成与下发由 Module_09 负责 |
| 在 Module_01 中生成 / 下发 `prometheus.yml` 或配置包 | 配置生成 / 预览 / 下发由 Module_09 负责 |
| 在 Module_09 中定义 CI / Job / Rule 策略 | CI 类型 ↔ Exporter 绑定、ScrapeJob、规则编辑 UI 由 Module_01 负责 |
| 在 Module_08 中提供规则编辑 UI | 规则编辑 UI 由 Module_01 提供；Module_08 负责规则生命周期与下发 |
| 在 Module_01 中展示运行时目标状态 / 拨测结果 / 采集诊断 | 运行时展示由 Module_02 负责；告警状态由 Module_08 负责 |
| 在 Module_07 中独立维护 Remote Write 配置 | 引用 Module_09（Edge Agent）与 Module_10（Ingestion Gateway）配置 |
| 在 Module_05 中重新定义业务规则 | Module_05 只做 UI 聚合，规则以后端模块为准 |
| 在 Module_02 中生成配置或管理 Edge Agent 健康 | 配置生成与 Edge Agent 基础设施健康由 Module_09 负责；Module_02 只查询被监控对象指标与告警 |
| 在 Module_09 中执行 PromQL 查询 | PromQL 查询由 Module_02 代理；Module_09 只负责配置生成 / 分发与 Agent 状态 |
| 在 Module_08 中代理 Prometheus `/api/v1/alerts` | Prometheus 告警状态代理由 Module_02 负责；Module_08 负责 Alertmanager 通知状态 |

---

## Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 状态 |
|------|------|----------|----------|----------|------|
| v1.0 | 2026-07-27 | 初始 | 整合 Module_01 ~ Module_10 职责矩阵与跨模块引用关系 | 全部 | ready |
| v1.1 | 2026-07-28 | 修改 | 根据产品优化建议更新：标签归一化、Generic Target、边缘自治告警、Metric Drop Rules、Tenant-NetworkDomain 关系 | 全部 | ready |
| v1.2 | 2026-07-30 | 修改 | 根据 CMDB-ITIL 映射优化：补充 CMDB 与 ITIL/ITSM 映射、Tenant/NetworkDomain 与 BlueKing CMDB 映射 | 全部 | ready |
| v1.2 | 2026-07-30 | 修改 | 根据 grilling 收敛方案调整：CMDB 同步/孤儿生命周期迁到 Module_04；租户-网域关联提前到 v0.2；增加阶段标签约定 | 全部 | ready |
| v1.2 | 2026-07-30 | 修改 | 根据 grilling（CMDB-Resource-Label）新增：Resource Label 生命周期、CI 类型映射、待分类队列、状态映射字典 | 全部 | ready |
| v1.3 | 2026-07-31 | 修改 | 根据监控策略管理 grilling 调整：Module_01/07/09/02/08 职责重新划分；新增 3.17/3.18 章节；更新禁区表 | 全部 | ready |
| v1.3 | 2026-07-31 | 修改 | 根据查询中心 grilling 调整：Module_02 明确 Query API 代理；Module_09/08/06 能力细化；新增 3.19/3.20/3.21 章节；更新禁区表 | 全部 | ready |
