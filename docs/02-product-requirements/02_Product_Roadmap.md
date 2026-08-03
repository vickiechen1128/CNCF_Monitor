# MetricCenter 产品路线图

> 文档类型：产品需求文档  
> 版本：v1.1
> 依赖文档：[00_Product_Vision.md](00_Product_Vision.md)、[03_Functional_Architecture.md](03_Functional_Architecture.md)、[04_Implementation_Map.md](04_Implementation_Map.md)  
> 更新日期：2026-08-03

---

## 0. 版本分层定义

MetricCenter 使用三层版本体系，避免 PRD 迭代号与产品里程碑混淆：

| 层级 | 示例 | 含义 | 维护位置 |
|------|------|------|----------|
| **产品版本** | MVP、v0.2、v0.3、v0.4、v1.0 | 对外发布的里程碑，决定用户可见功能集合 | 本文档 |
| **PRD 版本** | Module_09 v1.2 | 单个模块 PRD 的文档迭代号，记录需求变更历史 | `docs/02-product-requirements/Modules/Module_XX_*.md` |
| **原型版本** | v1.2 | 验证某版 PRD 的可点击原型版本，**必须与 PRD 版本保持一致** | `docs/prototypes/module-XX/` |

**关联规则**：

- 每个模块 PRD 顶部必须标注：PRD 状态、PRD 版本、**产品版本覆盖**、**原型版本**、**对应原型路径**。
- 原型 `README.md` / `package.json` 必须声明：验证的 PRD 版本、覆盖的产品版本。
- 模块 PRD 的 Change Log 必须包含 **「产品版本影响」** 列。
- 本文档的「功能-版本矩阵」是跨模块统一视图；各模块 PRD 仍保留 `{MVP}`、`{v0.2}`、`{v0.4+}` 等阶段标签作为细节标注。

---

## 1. 里程碑规划

| 里程碑 | 目标 | 核心交付 | 技术栈 | 时间（预估） |
|--------|------|----------|--------|-------------|
| **MVP** | 三类资源管理 + 网域模型预留 + 采集/拨测配置 + 配置下发 + 指标查询（单机模式） | 可运行的配置管理中心；网域模型（默认 `default`，单机模式隐藏）；主机/中间件/应用服务资源管理（`resource_id` 稳定唯一键，`instance_name` / `hostname` 可读展示名）；`ResourceLabel` 标签体系（`system` / `user` 来源，CMDB 来源预留）；标签模板；采集 Job；Blackbox 拨测；prometheus.yml 生成与下发；PromQL 查询代理 | SQLite + Prometheus TSDB + Prometheus Server + Blackbox Exporter | 3 ~ 4 周 |
| **v0.2** | 多网域 Edge-Cloud 架构落地 + 租户-网域关联 | 网域生命周期与 Token 管理；租户数据模型与租户-网域关联；Edge Sync Agent、按网域配置拉取、vmagent / Prometheus Agent Mode 接入；中心 VictoriaMetrics 汇聚；边缘 Agent 状态监控与诊断；外部 Prometheus Remote Write 接入；监控源登记册 | SQLite + VictoriaMetrics + vmagent/Prometheus Agent + Edge Sync Agent + Ingestion Gateway | 4 ~ 5 周 |
| **v0.3** | 门户化查询与告警状态 | Custom UI 门户、PromQL 查询页、告警状态查看（代理 `/api/v1/alerts`）、按网域/监控源筛选、告警抑制引擎 | 保持 v0.2 技术栈 | 2 ~ 3 周 |
| **v0.4** | 外部 CMDB 集成与异构监控接入 | 外部 CMDB 同步（BlueKing / HTTP / Nacos）：事件触发 + 15 分钟轮询、CI 类型映射表、待分类 CI 队列；`ResourceLabel.source=cmdb` 注入；异构监控源登记册；Zabbix / 云监控 Adapter；mTLS、证书轮转、Token 轮换 | PostgreSQL / MySQL 预研 | 3 ~ 4 周 |
| **v1.0** | 企业级可用 | 告警规则 UI、Alertmanager 配置生成、多租户、权限、边缘自治告警（vmalert） | PostgreSQL / MySQL + VictoriaMetrics/Mimir + vmagent + vmalert | 4 ~ 6 周 |

> 各功能落地难度、Prometheus 复用度、前后端工作量详见 [04_Implementation_Map.md](04_Implementation_Map.md)。

---

## 1.5 功能-版本矩阵

> 跨模块统一视图：每个单元格列出该模块在对应产品版本下交付的核心能力。详细功能范围、UI/UX、API、数据模型以各模块 PRD 为准。

| 模块 | MVP | v0.2 | v0.3 | v0.4 | v1.0 |
|------|-----|------|------|------|------|
| **Module_07 监控对象管理** | 四类资源 CRUD；Excel 导入；状态映射；标签模板；`ResourceLabel` 体系；`is_monitored` badge | - | - | CMDB 同步（BlueKing/HTTP/Nacos）；CI 类型映射；待分类队列；孤儿资源 | CMDB-ITIL/ITSM 映射 |
| **Module_01 监控策略与指标管理** | CI↔Exporter 模板绑定；ScrapeJob；实例选择；Blackbox 拨测；规则编辑 UI；静态指标库 | - | - | - | Recording Rules；指标库管理增强 |
| **Module_09 网域与边缘配置中心** | 默认网域 `default`；单/多网域模式切换；配置生成/预览/Diff/下发；`external_labels` 注入 | 网域生命周期与 Token；Edge Sync Agent；按网域配置拉取；Agent 状态列表；Remote Write 参数 | - | - | mTLS 证书轮转；Token 轮换；边缘自治告警配置包 |
| **Module_02 查询中心** | PromQL 查询代理；目标状态展示；响应 envelope | 租户/网域上下文注入 | 告警状态代理；查询辅助；首页 Dashboard 数据 | - | - |
| **Module_08 告警规则管理** | - | - | 规则分组；静默管理；Alertmanager 配置生成 | - | 完整告警规则 UI；通知渠道；边缘本地告警状态展示 |
| **Module_06 系统与平台管理** | 单租户默认模式（`platform_admin`） | 租户数据模型；租户-网域关联；`Tenant.multi_site_enabled` | - | CMDB 业务/模块路径映射 | 用户/角色/权限；审计日志；平台配置；元数据迁移 PostgreSQL/MySQL |
| **Module_10 监控源登记册** | - | 监控源 CRUD；外部 Prometheus Remote Write；Ingestion Gateway；标签注入 | - | Zabbix / 云监控 Adapter；标签归一化；Metric Drop Rules | 长期存储路由 VictoriaMetrics/Mimir |
| **Module_04 自定义服务发现** | Excel Provider（由 Module_07 承载） | - | - | BlueKing / HTTP / Nacos Provider；CI 类型映射；待分类队列；孤儿资源 | - |
| **Module_03 网关与认证** | - | 统一入口路由；Ingestion 路由 | - | - | 认证鉴权中间件；请求级审计；多租户路由 |
| **Module_05 自定义前端门户** | - | - | Custom UI 门户；PromQL 查询页；告警状态页 | - | 复杂图表/看板编辑器 |

> **P0/P1/P2 说明**：本矩阵只标注该版本是否包含某模块能力；模块内部的优先级（P0/P1/P2）详见各模块 PRD 功能范围表。

---

## 2. MVP 范围

### 2.1 目标

MVP 聚焦 **"三类资源管理 + 采集/拨测配置 + prometheus.yml 下发 + 指标查询"**，验证监控数据源从资源到 Prometheus 的完整闭环。MVP 以**单机模式**运行，隐藏「网域/站点」与「监控源」概念，后台自动使用默认网域 `default`。

### 2.2 部署模式与特性开关

| 模式 | 开启条件 | 用户感知 | 数据模型 |
|---|---|---|---|
| **单网域模式（默认）** | `Tenant.multi_site_enabled=false` | 无网域/站点概念；隐藏「网域管理」与「Agent 状态」入口 | 仅存在 `default` 管理域 |
| **多网域模式** | `Tenant.multi_site_enabled=true` | 展示「网域管理」、Edge Agent、边缘诊断、按网域配置下发 | 多网域 |
| **集成模式** | `Tenant.heterogeneous_ingestion_enabled=true` {v0.2} | 展示「监控源登记册」、外部 Prometheus / Zabbix 接入 | 多网域 + MonitoringSource |

> 多站点模式与集成模式在 MVP 阶段默认关闭，数据模型已预留，避免对单机用户造成认知负担。

### 2.3 交付物

- **配置管理**（[Module 07](Modules/Module_07_Monitoring_Object_Management.md)）：
  - 网域模型：预置默认网域 `default`，资源必须归属网域
  - 主机 / 中间件 / 应用服务三类资源管理；`resource_id` 为稳定唯一键，`instance_name` / `hostname` 作为可读展示名
  - 按资源类型的固定列 Excel 导入（含可选 `network_domain_id` 列，留空默认 `default`；预留 `cmdb_*` 可选列）
  - Excel 中文状态通过可配置字典映射到 `Resource.status`（`online` / `offline` / `maintenance`）
  - `ResourceLabel` 标签体系：`system`（标签模板生成）、`user`（用户手动）、`cmdb`（v0.4+ 预留）；同 key 冲突优先级 `cmdb` > `user` > `system`
  - 标签模板（按资源类型区分；字段来源支持 `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}`）
  - 采集 Job 管理 + 目标筛选
  - 应用服务 Blackbox 拨测配置
  - 预置采集模板（node-exporter、mysqld-exporter、simple-agent、blackbox）
  - `prometheus.yml` 自动生成与下发（单网域行为）
- **指标查询**：Gateway 代理 Prometheus Query API
- **采集状态**：代理 `/api/v1/targets` 查看 Target 状态
- **代码入口**：
  - `platform/cmd/metric-center/main.go`
  - `platform/config/`（配置管理）
  - `platform/examples/simple-agent/`（标准采集端模板）
  - `ui-custom/web/`（配置管理前端页面）
- **本地运行**：`Makefile` + Docker Compose（Prometheus + Blackbox Exporter）
- **平台元数据**：SQLite，开发环境零运维

### 2.4 明确不做

- 动态资源模型与自定义字段扩展
- 告警规则编辑 UI（手写 `rules.yml`）
- Alertmanager 配置生成与静默管理 UI
- 多租户与持久化权限
- 复杂 Dashboard / 图表库
- Remote Write 转发
- K8s/Consul/Nacos 自动服务发现
- Redis 缓存

---

## 3. 模块开发顺序

```
Phase 1: 基础底座
├── 工程标准建立
├── 目录结构与 Makefile 完善
├── Prometheus + Blackbox Exporter 本地运行
└── platform 入口包装（metric-center）

Phase 2: MVP 核心 — 配置管理（Module 07）
├── 网域模型：预置默认网域 `default`，资源归属网域
├── 三类资源模型（Host / Middleware / Application）；`resource_id` 稳定唯一键，`instance_name` / `hostname` 可读展示名
├── 固定列 Excel 导入与校验（含可选 `network_domain_id` 列；预留 `cmdb_*` 可选列）
├── Excel 状态 → `Resource.status` 映射字典（默认 + 可配置）
├── `ResourceLabel` 数据模型与 CRUD（`system` / `user` 来源；CMDB 来源预留）
├── 标签模板管理（按资源类型；字段来源 `resource_field` / `composite` / `prometheus_builtin` / `cmdb_field {v0.4+}`）
├── 采集 Job 管理 + 目标筛选
├── 拨测配置（Blackbox Exporter）
├── prometheus.yml 生成（单网域行为；合并所有来源 label，同 key 优先级 `cmdb` > `user` > `system`）
├── 配置下发与重载
└── 平台元数据使用 SQLite

Phase 3: 指标采集状态（Module 01）
├── Target 列表与状态展示（含网域）
├── 拨测结果展示
├── 采集诊断
└── simple-agent 验证端到端链路

Phase 4: 网域与边缘 Agent（Module 09）— v0.2
├── 网域注册、Token 管理
├── Edge Sync Agent 配置拉取协议
├── vmagent / Prometheus Agent Mode 接入
├── 中心 VictoriaMetrics Remote Write 汇聚
├── 边缘 Agent 在线状态、配置同步、WAL 积压监控
└── 边缘诊断看板（RTT、队列状态、最近错误）

Phase 5: 监控源登记册与异构接入（Module 10）— v0.2
├── MonitoringSource 数据模型
├── Ingestion Gateway（鉴权、限流、标签注入）
├── 外部 Prometheus Remote Write 接入
└── 接入源健康状态监控

Phase 6: 查询与可视化（Module 02 / Module 05）
├── Gateway 查询代理
├── Custom UI 门户
└── 简单 PromQL 查询页

Phase 7: 告警状态与 Open API（v0.3 ~ v0.4）
├── 告警状态查看（代理 /api/v1/alerts），支持按网域/监控源筛选
├── 告警规则数据模型预留 `scope` 与 `inhibitable` 字段
├── 告警抑制引擎（网域离线时自动抑制次生告警）
├── 指标 Open API
└── 外部 CMDB 接入实现：BlueKing / HTTP / Nacos Provider、CI 类型映射表、待分类队列、事件触发 + 15 分钟轮询

Phase 8: 企业级能力（v1.0）
├── 告警规则 UI + Alertmanager 配置生成
├── 边缘自治告警（vmalert + 本地 Alertmanager）
├── Zabbix / 云监控 Adapter 接入
├── 多租户与权限（Module 03 / Module 06）
├── 元数据迁移至 PostgreSQL / MySQL
├── 长期存储：VictoriaMetrics / Mimir（Remote Write）
├── mTLS 证书自动轮转与 Token 轮换
└── 部署与运维文档
```

---

## 4. 技术演进路线

> 本节只保留关键演进决策。每个功能的落地难度、自研 vs 复用分析见 [04_Implementation_Map.md](04_Implementation_Map.md)。

### 4.1 元数据存储

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **SQLite** | 开发期单机运行，零运维 |
| v0.4 ~ v1.0 | **PostgreSQL / MySQL** | 生产环境多实例、事务、审计需求 |

### 4.2 时序存储

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP | **Prometheus TSDB** | 本地开发、短期存储、单机模式 |
| v0.2 ~ v1.0 | **VictoriaMetrics（默认）/ Mimir / Thanos** | 多网域 Remote Write 汇聚、长期存储、集群查询 |

### 4.3 采集端

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP | **Prometheus Server** | 本地直接运行，便于调试 |
| v0.2 ~ v1.0 | **vmagent（默认）/ Prometheus Agent Mode + Edge Sync Agent** | 多网域物理隔离、弱网场景；可按网域配置采集器类型 |

### 4.4 拨测

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **Blackbox Exporter** | Prometheus 官方拨测组件，MetricCenter 只生成配置 |
| v1.0 | 保持 Blackbox / 或自研拨测网关 | 视企业定制需求决定 |

### 4.5 告警

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.3 | **手写 `rules.yml` + Alertmanager** | 规则手写，告警收敛/静默/通知走 Alertmanager；数据模型预留 `scope=central`、`inhibitable` |
| v0.3 | **告警状态查看** | 代理 `/api/v1/alerts` 到前端，支持按网域/监控源筛选 |
| v0.3 | **告警抑制引擎** | 网域离线时自动生成 `inhibit_rules`，抑制次生告警 |
| v0.4 ~ v1.0 | **告警规则 UI + 生成 `rules.yml` / `alertmanager.yml`** | 降低告警配置门槛；支持 `scope=central/edge/both` |
| v1.0 | **边缘自治告警** | 边缘 vmalert + 本地 Alertmanager，断网时仍可本域通知 |

### 4.6 前端可视化

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP ~ v0.2 | **无图表** | 聚焦配置管理，文本/表格展示 |
| v0.3 | **简单 PromQL 结果展示** | 表格 + 简单折线 |
| v0.4 ~ v1.0 | **uPlot / ECharts** | 高性能时序图表 |

### 4.7 异构监控接入

| 阶段 | 选型 | 说明 |
|------|------|------|
| MVP | **无** | 单机模式，不启用 |
| v0.2 | **Monitoring Source Registry + Ingestion Gateway + 外部 Prometheus Remote Write** | 客户现有 Prometheus 借道汇聚 |
| v0.4 ~ v1.0 | **Zabbix Adapter + 云监控 Puller** | Zabbix / 云监控统一接入 |

### 4.8 资源模型与 CMDB 集成

| 阶段 | 能力 | 说明 |
|------|------|------|
| **MVP** | 本地资源管理 + Excel 导入 | `resource_id` 稳定唯一键；`instance_name` / `hostname` 可读展示名；`ResourceLabel.source=system/user`；CMDB 字段仅预留，不生成 label |
| **v0.2** | 租户-网域关联 | `network_domain_id` 按租户上下文填充；`default` 网域归属 `platform_admin` 租户；禁止跨租户共享网域 |
| **v0.4** | 外部 CMDB 同步（BlueKing / HTTP / Nacos） | 事件触发 + 15 分钟轮询，轮询结果为准；CI 类型映射表；待分类队列；`ResourceLabel.source=cmdb` 注入；CMDB 是权威来源，本地资源为其只读/缓存镜像 |
| **v1.0+** | CMDB-ITIL/ITSM 映射 | 服务目录、影响范围、负责人等字段映射到告警事件 |

---

## 5. 核心原则

- **控制面与数据面严格分离**：无论底层存储和采集端如何演进，`platform/` 和 `ui-custom/` 保持稳定。
- **标准接口替换**：所有演进通过 Prometheus 生态标准接口（HTTP API、Remote Write、Service Discovery）完成。
- **MVP 不阻塞**：未来组件在 MVP 阶段只做架构预留，不影响当前开发节奏。

---

## 6. Change Log

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 |
|------|------|----------|----------|----------|
| v1.1 | 2026-08-03 | 修改 | 增加 0. 版本分层定义；新增 1.5 功能-版本矩阵；将多网域/集成模式开关从 `feature_flags.*` 调整为 `Tenant.*`；统一「单网域模式」表述 | 全文档、模块 PRD 模板 |
| v1.0 | 2026-07-31 | 初始 | 产品路线图初始版本 | 全部 |
