# Module 02: 查询中心

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.7
> **产品版本覆盖**: MVP / v0.2 / v0.3
> **原型版本**: v1.2（未对齐，待按 v1.6 修订）
> **更新日期**: 2026-08-31
> **对应原型**: `docs/prototypes/module-02/`
> **副标题**: 带租户/网域上下文注入的 Prometheus Query API 代理 + 采集目标状态展示

> **模块类型**: 核心能力模块
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[02_Product_Roadmap.md](../02_Product_Roadmap.md)、[Module_06_Multi_Tenant.md](Module_06_Multi_Tenant.md)、[Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)、[Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)、[Module_08_Alertmanager_Notification_Management.md](Module_08_Alertmanager_Notification_Management.md)
> **目标用户**: 运维工程师、业务研发工程师、AI 应用开发工程师

---

## 1. 模块目标

Module_02 提供统一的指标查询入口，定位为**带租户/网域上下文注入的 Prometheus Query API 代理**，并**承接 [Module_01](Module_01_Metric_Collection_Center.md) 移交的采集运行时状态展示**。在将查询转发给中心 Prometheus 之前，必须根据当前认证用户的身份自动注入 `tenant_id` 与有权限的网域标签，以保证多租户数据隔离。

**按产品版本的功能分布（与 [02_Product_Roadmap.md](../02_Product_Roadmap.md) 1.5 功能-版本矩阵对齐）**：

| 版本 | 交付能力 |
|------|----------|
| **MVP** | PromQL 查询代理（含注入骨架）；采集目标状态 API（代理 `/api/v1/targets`，为 M01 Job 回显与 M07 badge 的共同数据源，决策 47-4）；采集健康度/覆盖率查询 API（三态，供 M07 badge 消费，由 v0.2 提前，决策 47-3）；响应 envelope；**独立目标状态页降为 P1（极简列表，决策 47-4）** |
| **v0.2** | 租户/网域上下文注入（多租户 + 多网域语义）；labels/series 租户隔离；批量查询语义预留；envelope 多网域/多数据源细化 |
| **v0.3** | 告警状态代理（`/api/v1/alerts`）；PromQL 校验与指标实时预览（支撑规则编辑 UI）；查询辅助；首页 Dashboard 数据；Open API 完善 |

> **版本决策（v1.2）**：
> - `/api/v1/alerts` 代理由 MVP 移至 **v0.3**：与 Module_08（v0.3 落地规则分组/静默/Alertmanager 配置）对齐，避免 M08 未就绪时 alerts 代理空转；
> - 租户/网域注入**机制在 MVP 落地**（恒 `default` 网域 + `platform_admin` 租户），**多租户/多网域语义在 v0.2 启用**（M06 租户模型、M09 租户-网域关联均为 v0.2）；
> - PromQL 校验/指标预览接口随 Module_01 规则编辑 UI 一同移至 **v0.3**（路线图 2.4：MVP 不做告警规则编辑 UI，规则手写 `rules.yml` + Alertmanager）。

> **存储可替换性决策点（v1.7，决策 57）**：部署拓扑锁定为「1 控制面 + N 采集节点」扁平形态；中心存储预留从 Prometheus 替换为 VictoriaMetrics 的可能——本模块代理作为防腐层保证替换时消费方（UI / Grafana / Open API）零改动。**隔离契约保持标签制**（`tenant_id` / `network_domain` 由 M09 `external_labels` 写入侧打标、本模块查询侧校验，Prometheus 与 VM 通吃）；VM 集群版原生多租户（vmauth + accountID）作为 v0.2 开启多租户语义前的评审选项，暂定不采用（契约单一、可回切 Prometheus）。

### 与周边模块的边界

- **与 Module_09 的边界**：Module_02 查询的是**被监控对象**的指标与 exporter 采集健康度（例如 `up` 指标）；Module_09 负责**监控基础设施自身**的健康度，包括 Edge Agent 在线状态、最后心跳、WAL 积压、配置同步等。Module_02 的数据新鲜度信息源（`edge_remote_write` 延迟、网域断网程度）读取 Module_09 心跳/EdgeAgent 状态。
- **与 Module_08 的边界**：Module_02 在 v0.3 代理 Prometheus `/api/v1/alerts`（返回当前 firing/pending 告警实例）；Alertmanager 的通知状态（分组、静默、抑制、接收人）由 Module_08 负责。v0.4+ 边缘自治告警（`scope=edge`/`both`）在边缘 vmalert 本地求值，不在中心 Prometheus 内，alerts 代理只反映**中心聚合告警**。
- **与 Module_01 的边界**：`ScrapeTarget` / `ScrapeLog` 数据模型由 Module_01 定义（Module_01 5.7 / 5.8），Module_02 **只读展示**，不维护其定义；MVP 直接代理 Prometheus 原生 `/api/v1/targets`（含 `health` / `lastScrape` / `lastError`），**同时作为 M01 Job 详情/编辑抽屉实例采集状态回显的数据源**（M01 只读消费、按 Job 过滤，决策 47-2），`ScrapeLog` 独立日志存储与展示放 v0.3（Prometheus 无原生 ScrapeLog API，MVP 不实现独立存储，避免过度设计）。
- **与 Module_07 的边界**：M07 资源列表「采集状态」badge 为**三态**（采集中 / 已下发未采到 / 未监控，决策 47-3）：`is_monitored` 选中关系由 Module_01 维护，up/down 聚合由 Module_02 **采集健康度/覆盖率查询 API**（MVP 起提供，按 `resource_id` 标签回连资源）输出，Module_07 只读消费。Module_07 不直连时序数据。
- **与 Module_10 的边界（v0.2+ 预留）**：外部异构监控源数据经 Module_10 标签归一化后写入中心，Module_02 查询需覆盖外部源数据，并支持按监控源筛选（v0.3 告警状态支持按网域/监控源筛选）；标签语义对齐由 Module_10 负责。
- **与可视化组件的边界（决策 50，v1.5 新增）**：MetricCenter **不自研**拖拽式面板编辑器与可视化大屏；大屏/复杂看板需求通过 **Grafana iframe 嵌入**满足，但 Grafana 的数据源**必须配置为 M02 查询代理地址**（`/api/v1/query*`），禁止直连 Prometheus——否则租户/网域注入被绕过，v0.2 多租户启用后构成跨租户数据泄露。门户内轻量实时图表（首屏指标卡、资源详情趋势图）使用 ECharts/AntV 消费本模块 `query_range` 接口，与 v0.3「首页 Dashboard 数据」共用查询链路。**三层归属（决策 51，v1.6 补充）**：嵌入入口 / 新用户引导 / 预置模板展示归 Module_05；Grafana 自身配置（datasource、anonymous/auth、provisioning 目录）由一体化交付包在安装期静态下发，不进运行态模块；Dashboard-as-Code 治理（API 管 dashboard、版本化、按租户分发）预留 M11，v0.4+ 评估。**跨网域业务看板不受网域注入影响**：注入语义为「授权集合收敛」（§7.2），用户 PromQL 不含网域 matcher 时默认覆盖全部授权网域，跨网域聚合（如 `sum by (biz)`）天然成立，网域仅作可选下钻维度（dashboard variable）。
- **blackbox 拨测的网域语义（决策 52，v1.6 新增）**：拨测指标（`probe_success` 等）上的 `network_domain` 标签表示「**从哪个网域发起拨测**」（探测路径），而非「目标在哪」；查询与看板筛选拨测数据时按发起侧网域聚合，目标归属不参与网域推导（M07 四级解析链不适用于 blackbox target）。

---

## 2. 用户故事

> {v1.3} 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.2 节**；本模块用户故事使用模块命名空间编码（`M02-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- M02-OPS-07：查看当前告警状态（v0.3，经代理 Prometheus `/api/v1/alerts`）
- M02-OPS-08：查看目标列表与采集状态（health up/down、最后抓取时间、抓取错误），按网域 / Job 筛选（API MVP；独立目标状态页降为 P1，决策 47-4；MVP 起该 API 同时供 M01 Job 回显与 M07 badge 消费）

> 被监控对象的采集健康度（如 exporter `up/down`）通过 PromQL 查询 `up` 等指标及 `/api/v1/targets` 代理查看，不通过独立模块提供。

---

## 3. 核心功能

### 3.1 功能清单（按版本）

| 功能 | 说明 | 优先级 / 版本 |
|------|------|----------------|
| **PromQL 代理**（含租户/网域注入骨架） | 代理 instant / range 查询，自动注入 `tenant_id` 与有权限的网域标签 | **P0 / MVP** |
| **目标状态 API**（`/api/v1/targets` 代理） | 代理 `/api/v1/targets`，返回目标 health（up/down/unknown）、lastScrape、lastError、所属网域/Job，支持按网域/Job/health 过滤；承接 Module_01 移交的目标列表职责；**同时作为 M01 Job 回显（决策 47-2）与 M07 badge（决策 47-3）的数据源** | **P0 / MVP** |
| **目标状态页**（独立页面） | 跨 Job 全局排障视图：全部 target 列表 + 按网域/Job/health 筛选 + 采集诊断 Drawer；**由 P0 降为 P1（极简列表即可，决策 47-4）**——配置场景的知情权由 M01 回显、资产场景的知情权由 M07 badge 承接，本页不再是唯一状态入口 | **P1 / MVP** |
| **响应 envelope** | 统一包裹 Prometheus 原始响应，暴露数据来源与新鲜度（结构见第 8 节） | **P0 / MVP** |
| **租户/网域上下文注入（多租户语义）** | 多租户 + 多网域场景下基于 PromQL AST 解析注入；用户显式网域 matcher 收敛于授权集合；labels/series 接口租户隔离 | **P0 / v0.2** |
| **采集健康度/覆盖率查询 API** | 基于 `up` 指标聚合，输出「已监控且 up / 已监控但 down / 未监控」三态数据（按 `resource_id` 标签回连资源），供 Module_07 badge 三态展示（决策 47-3，由 v0.2 提前） | **P0 / MVP** |
| **批量查询** | 一次查询多个表达式（多表达式、统一时间窗、单次响应聚合）；v0.2 固定接口语义，v0.3 完善 | P2 预留 / **P1 / v0.3** |
| **`/api/v1/alerts` 代理** | 代理 Prometheus 当前触发/待处理告警实例，注入租户/网域上下文，支持按网域/监控源筛选；与 Module_08（v0.3）对齐 | **P0 / v0.3** |
| **`/api/v1/rules` 只读代理** | 代理 Prometheus 规则求值状态（只读），供 Module_08 展示，避免其直连 Prometheus 绕过租户隔离 | **P1 / v0.3** |
| **PromQL 校验 + 指标实时预览** | 提供 `validate` 接口（语法校验）与带默认时间窗的指标预览；支撑 Module_01 规则编辑 UI（随规则编辑 UI 移至 v0.3） | **P0 / v0.3** |
| **查询辅助** | 指标名补全（联动 Module_01 指标库 + `/api/v1/label/__name__/values`）、标签建议（叠加 Module_07 LabelTemplate 预置标签）、常用查询模板 | **P1 / v0.3** |
| **首页 Dashboard 数据** | 为 Custom UI 门户（Module_05）首页提供聚合数据接口 | **P1 / v0.3** |
| **Open API** | RESTful API 供外部系统/AI 应用调用，v0.3 完善 API Key 鉴权与限流配额 | **P1 / v0.3** |
| **临时目标验证** | 对临时目标执行抓取并查看结果（Module_01 移交） | P2 / v0.3+ |
| **复杂 Dashboard / 可视化大屏** | **不自研**拖拽式面板编辑器；可视化大屏走 Grafana iframe 嵌入（决策 50），Grafana 数据源必须指向本模块查询代理（`/api/v1/query*`），禁止直连 Prometheus；门户内轻量实时图表用 ECharts/AntV 消费 `query_range`（随 v0.3「首页 Dashboard 数据」落地） | P2（不自研）；轻量图表 v0.3 |

### 3.2 目标状态展示说明（MVP）

> **落点修订（决策 47）**：目标状态能力分为「API」与「独立页面」两层——**API（`/api/v1/targets` 代理）为 P0/MVP**，是 M01 Job 实例采集状态回显（M01 §5.10）与 M07 资源列表三态 badge（经健康度/覆盖率 API）的共同数据源；**独立「目标状态页」前端降为 P1**（极简列表），定位收敛为「跨 Job 全局排障入口」。

- 数据来源：直接代理中心 Prometheus `/api/v1/targets`，按认证用户注入租户/网域上下文后返回；
- 字段：`job`、`instance`、所属网域（`network_domain` 标签）、health（up/down/unknown）、`lastScrape`、`lastError`、`scrapeDuration`；
- 筛选：按网域（v0.2+ 多网域生效）、按 Job、按 health 状态；
- 消费方（MVP）：M01 Job 详情/编辑抽屉按 Job 过滤做实例级回显（待采集 / up / down / unknown + 在线数汇总）；M07 经健康度/覆盖率 API 获取三态 badge 数据；
- 拨测结果：blackbox Job 目标通过 `/api/v1/targets` 与 PromQL 查询 `probe_success` / `probe_duration_seconds` 展示；独立拨测结果视图放 v0.2+；
- 采集诊断：目标详情展示 `lastError`（抓取失败原因）与 HTTP 状态码（`lastError` 内含 `server returned HTTP status ...`）；完整采集日志（ScrapeLog）独立存储 v0.3。

---

## 4. 核心流程

Module_02 作为查询代理，核心流程覆盖从用户发起查询到获得响应的完整链路：

```
┌──────────┐   PromQL + 时间参数   ┌──────────────┐   注入后的查询     ┌──────────────┐
│  用户/UI  │ ──────────────────► │  Module_02   │ ──────────────► │  中心        │
│          │                      │  查询代理     │                  │  Prometheus  │
│          │ ◄────────────────── │              │ ◄────────────── │              │
└──────────┘    Envelope 响应      └──────────────┘  原始查询结果     └──────────────┘
                                          │
                                          │ 读取租户/网域权限
                                          ▼
                                   ┌──────────────┐
                                   │  Module_06   │
                                   │  租户模型     │
                                   └──────────────┘
```

### 4.1 查询流程（MVP）

1. **用户输入查询**：用户在查询页面输入 PromQL 表达式，选择查询类型（instant / range）及时间范围；
2. **租户/网域注入**：Module_02 根据当前认证用户身份，从 Module_06 获取租户-网域关联，自动注入 `tenant_id` 与 `network_domain` 标签选择器；
3. **转发到 Prometheus**：将注入后的查询请求转发到中心 Prometheus Query API；
4. **响应封装**：将 Prometheus 原始响应包裹为统一 envelope 格式（含 `data_source`、`freshness_at`、`network_domains` 元数据）；
5. **返回结果**：将 envelope 响应返回给用户/UI。

### 4.2 多网域查询流程（v0.2+）

- 用户拥有多个网域权限时，Module_02 默认查询其所有授权网域的数据；
- 若用户 PromQL 已显式包含 `network_domain` matcher，Module_02 基于 AST 解析将其收敛于授权集合（越权取值返回空）；
- 响应 envelope 的 `network_domains` 字段以数组形式列出数据来源网域集合。

### 4.3 数据新鲜度联动流程（v0.2+）

- Module_02 在返回 envelope 前，读取 Module_09 EdgeAgent 心跳/WAL 积压状态；
- 若某网域 Edge Agent 失联或 WAL 积压严重，在响应中标注「该网域数据已延迟 X 分钟」；
- UI 侧据此区分「无数据」与「数据旧」两种状态。

---

## 5. 数据模型

### 5.1 查询请求参数

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| `query` | string | 查询语句 | PromQL 表达式 |
| `time` | timestamp | 查询时间点 | instant 查询的时间点（RFC3339），默认当前时间 |
| `start` | timestamp | 开始时间 | range 查询的开始时间 |
| `end` | timestamp | 结束时间 | range 查询的结束时间 |
| `step` | duration | 步长 | range 查询的解析步长，如 `15s` |

### 5.2 响应 Envelope

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| `status` | string | 状态 | `success` / `error` |
| `data` | object | 查询结果 | Prometheus 原始查询结果（`resultType` + `result`） |
| `meta.data_source` | string | 数据来源 | `central_scrape`（中心抓取）或 `edge_remote_write`（边缘异步写入）；v0.2+ 细化到网域维度 |
| `meta.freshness_at` | timestamp | 数据时间 | 该 series 最近一次样本的时间戳 |
| `meta.network_domains` | []string | 来源网域 | 数据涉及的网域集合（v1.2 由单值改为多值数组） |

### 5.3 目标状态字段（代理 Prometheus `/api/v1/targets`）

| 字段 | 类型 | UI 展示名 | 说明 |
|------|------|-----------|------|
| `job` | string | Job 名称 | 所属 ScrapeJob 名称 |
| `instance` | string | 实例地址 | 目标实例的 `host:port` |
| `network_domain` | string | 所属网域 | 目标归属的网域标签 |
| `health` | string | 采集状态 | `up`（正常）/ `down`（异常）/ `unknown`（未知） |
| `lastScrape` | timestamp | 最后采集时间 | 最近一次采集的时间戳 |
| `lastError` | string | 最后错误 | 最近一次采集的错误信息，空表示无错误 |
| `scrapeDuration` | duration | 采集耗时 | 单次采集的耗时 |

---

## 6. 接口设计

### 6.1 MVP 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/v1/query | POST | 执行 PromQL instant query |
| /api/v1/query_range | POST | 执行 PromQL range query |
| /api/v1/targets | GET | **代理目标状态列表（新增，承接 Module_01 移交）**，注入租户/网域上下文；同时供 M01 Job 回显与 M07 badge 消费（决策 47） |
| /api/v1/health/coverage | GET | 采集健康度/覆盖率聚合（三态数据，按 `resource_id` 回连资源），供 Module_07 badge 消费（决策 47-3，由 v0.2 提前） |
| /api/v1/labels | GET | 获取所有 label names（注入租户/网域上下文） |
| /api/v1/label/:name/values | GET | 获取 label 所有值（注入租户/网域上下文） |
| /api/v1/series | GET | 查询匹配的 series（注入租户/网域上下文） |

### 6.2 v0.2 新增/增强

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/v1/batch_query | POST | 批量查询（多表达式、统一时间窗），固定接口语义供 AI/外部系统使用 |
| labels / series | - | 基于 AST 注入租户/网域上下文，用户显式 matcher 收敛于授权集合 |

### 6.3 v0.3 新增

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/v1/alerts | GET | 获取当前告警状态（对齐 Module_08；支持按网域/监控源筛选） |
| /api/v1/rules | GET | 获取规则求值状态（只读，供 Module_08 展示） |
| /api/v1/query/validate | POST | PromQL 语法校验（支撑 Module_01 规则编辑 UI） |
| /api/v1/query/preview | POST | 指标实时预览（带默认时间窗的最近样本，支撑规则编辑 UI） |

> 以上接口均代理 Prometheus Query API 或基于其计算，但 Module_02 会在转发前自动注入租户/网域选择器，并在返回结果外层包裹 envelope 元数据（见第 8 节）。

---

## 7. 注入与授权校验规则

### 7.1 注入标签 key 契约（v1.2 修订，关键）

**注入的标签 key 必须与 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 3.3.1 `external_labels` 注入的 key 完全一致**：

| 标签 key | 取值 | 来源 |
|----------|------|------|
| `network_domain` | `NetworkDomain.id` | Module_09 生成 `prometheus.yml` 时通过 `external_labels` 注入，采集端附加到每条 series |
| `tenant_id` | `NetworkDomain.tenant_id` | 同上 |

> **v1.2 修复说明**：v1.1 曾以 `network_domain_id` 作为查询注入标签（「决策中记为」），与 Module_09 实际注入的 `network_domain` 不一致，会导致注入匹配不到数据（模块注入 = 权限隔离，失效即跨租户数据泄露或全空）。v1.2 起统一为 `network_domain`。注意区分：**对象属性** `Resource.network_domain_id`（Module_07 数据字段）与 **Prometheus 标签** `network_domain`（Module_09 external_labels 注入）是两回事，不得混用。

### 7.2 注入规则

Module_02 在代理查询时，必须根据认证用户从 [Module_06](Module_06_Multi_Tenant.md) 与 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 获取的租户-网域关联，执行以下注入/校验（v1.7 起按**三层语义**表述，决策 56）：

1. **硬隔离边界：`tenant_id` 强制注入**
   选择器为 `tenant_id="<用户所属租户 ID>"`，永远存在、用户不可见不可改。Module_02 不暴露跨租户查询能力，平台管理员也按租户维度管理。MVP 恒为 `tenant_id="platform_admin"`。

2. **软授权边界：`network_domain` 授权集合收敛（非"锁定单网域"）**
   `network_domain` 是部署拓扑维度，不是默认隔离边界——业务通常跨网域，跨网域聚合（如 `sum by (biz)`）必须天然成立。注入语义为**授权集合收敛**：
   - 用户授权集合 = 租户全部网域时，**不注入任何 `network_domain` matcher**（零感知，与裸查 Prometheus 一致）；
   - 用户授权集合为真子集时，注入授权集合 matcher，多网域使用正则匹配：
     ```promql
     network_domain=~"domain-a|domain-b|domain-c"
     ```

3. **单网域场景（MVP）**
   若租户仅拥有 `default` 网域，授权集合即单元素，Module_02 注入 `network_domain="default"`，对用户完全透明，无需在 PromQL 中显式写网域过滤。

4. **多网域默认行为（v0.2+）**
   用户拥有多个网域权限且未在 PromQL 中显式指定网域过滤时，Module_02 默认查询其**所有授权网域**的数据。前端 UI 应明确提示当前查询范围覆盖 N 个网域；网域筛选/下钻为纯 UX 行为，**不承担任何安全职责**（安全约束由本节制 2/5 条在服务端强制执行，前端筛选可被 curl 绕过，不构成权限）。

5. **用户显式 matcher 收敛（v0.2+，AST 解析）**
   用户 PromQL 已显式包含 `network_domain` matcher 时：
   - matcher 筛选范围必须**收敛于用户授权网域集合**，越权取值直接返回空；
   - 注入方式基于 **PromQL AST 解析**（定位/合并/校验 label matcher），**禁止字符串拼接替换**，避免误伤用户复杂表达式（聚合、subquery、`on()`/`ignoring()` 场景）。

> **设计原则**：系统注入 = 权限隔离；用户过滤 = 业务筛选。

---

## 8. 响应 envelope 与数据新鲜度

Module_02 将 Prometheus 原始响应包裹为统一 envelope，在不污染 PromQL series 标签的前提下，向用户暴露数据来源与新鲜度差异。

### 8.1 Envelope 结构

```json
{
  "status": "success",
  "data": { "resultType": "matrix", "result": [...] },
  "meta": {
    "data_source": "central_scrape | edge_remote_write",
    "freshness_at": "2026-07-31T12:00:00Z",
    "network_domains": ["default"]
  }
}
```

| 字段 | 说明 |
|------|------|
| `data_source` | 数据来源：`central_scrape`（中心 Prometheus 直接抓取）或 `edge_remote_write`（Edge Agent 异步 remote write 到中心）；**v0.2+ 细化到网域维度**（同一查询可混合两种来源） |
| `freshness_at` | 该 series 最近一次样本的时间戳；边缘断网时该时间会停止更新 |
| `network_domains` | 数据涉及的网域集合（v1.2 由单值 `network_domain` 调整为多值，适配多网域聚合查询；单网域场景等价于 `["default"]`） |

> **v1.2 修订说明**：原单值 `network_domain` 无法表达多网域聚合查询的结果来源，改为 `network_domains` 数组；MVP 单网域场景输出单元素数组，保持兼容。

### 8.2 数据来源说明

- **`central_scrape`**：中心 Prometheus 直接抓取目标。适用于单网域场景，或中心网络可达的目标，数据延迟低。
- **`edge_remote_write`（v0.2+）**：Edge Agent 在边缘网域抓取目标后，通过 remote write 异步回写到中心 Prometheus。适用于多网域/隔离网域场景，可能存在分钟级延迟。**MVP 恒为 `central_scrape`。**

> **MVP envelope 最小实现口径（v1.5 明确）**：MVP 阶段 envelope 元数据按最小集落地——`data_source` 恒为 `central_scrape`、`network_domains` 恒为 `["default"]`、`freshness_at` 取查询结果中最新样本的时间戳（结果为空时为 `null`）。envelope 结构在 MVP 即固定，避免 v0.2 细化（多网域/多数据源）时改动调用方。

### 8.3 数据新鲜度与 M09 联动（v0.2+）

- 当 `data_source` 为 `edge_remote_write` 时，UI 应提示用户数据为边缘异步写入，可能存在延迟；
- 当 `freshness_at` 明显滞后于当前时间时，UI 应区分「无数据」与「数据旧」两种状态（灰化 vs 延迟告警条，点击可查看最后样本时间）；
- **v0.2+ 联动 Module_09**：读取 M09 EdgeAgent 心跳/WAL 积压状态（M09 4.2 / 4.3），对断网网域标注「该网域数据已延迟 X 分钟」，形成「采集侧（M09）→ 查询侧（M02）」闭环。

---

## 9. 依赖

- [Module_06_Multi_Tenant.md](Module_06_Multi_Tenant.md)：租户-网域模型与用户权限（v0.2 多租户语义）
- [Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)：`external_labels` 注入（`network_domain` / `tenant_id` 契约）、EdgeAgent 心跳/WAL 状态（新鲜度信息源）
- [Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)：ScrapeTarget/ScrapeLog 模型（只读展示）、指标库 ExporterMetricLibrary（v0.3 查询辅助联动）
- [Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)：LabelTemplate 预置标签（v0.3 标签建议联动）、is_monitored badge（v0.2 三态增强消费方）
- `upstream/prometheus/promql/`
- `upstream/prometheus/web/api/`
- `platform/gateway/proxy/`

---

## 10. 数据模型状态机

Module_02 作为查询代理，**自身不持有状态ful 实体**，其核心状态来源于代理的 Prometheus 端点：

| 状态来源 | 状态值 | 说明 |
|----------|--------|------|
| 采集目标健康状态 | `up` / `down` / `unknown` | 来自 Prometheus `/api/v1/targets`，表示目标实例是否正常采集 |
| 告警实例状态 | `firing` / `pending` | 来自 Prometheus `/api/v1/alerts`（v0.3），表示告警规则当前求值状态 |
| 数据来源 | `central_scrape` / `edge_remote_write` | 由 Module_02 根据查询结果来源判定，v0.2+ 细化到网域维度 |

> 目标健康状态与告警实例状态由 Prometheus 维护，Module_02 仅做只读代理与租户/网域上下文注入，不修改状态定义。

---

## 11. 验收标准

### 11.1 用户验收（UI 可感知）

| # | 验收项 | 优先级 | 版本 |
|---|--------|--------|------|
| 1 | 用户在查询页面输入 PromQL 后可获得查询结果，无需感知租户/网域注入过程 | P0 | MVP |
| 2 | 单网域租户的查询结果与直接查 Prometheus 一致，无额外干扰信息 | P0 | MVP |
| 3 | 目标状态 API 返回 job / instance / 网域 / health / lastScrape / lastError，支持按网域、Job、health 过滤；M01 Job 详情/编辑抽屉与 M07 资源列表 badge 可消费该数据 | P0 | MVP |
| 3a | 独立目标状态页（跨 Job 全局排障视图，极简列表）展示上述字段并支持筛选 | P1 | MVP |
| 4 | blackbox 拨测目标可通过目标状态 API（及 M01 Job 回显）与 `probe_success` / `probe_duration_seconds` 查询查看结果 | P0 | MVP |
| 5 | 查询响应包含 envelope 元数据：`data_source`、`freshness_at`、`network_domains` | P0 | MVP |
| 6 | 多网域租户默认查询全部授权网域，UI 提示当前查询范围覆盖 N 个网域 | P0 | v0.2 |
| 7 | 用户显式指定 `network_domain` matcher 时，越权取值返回空结果 | P0 | v0.2 |
| 8 | 断网网域的数据在 UI 上标注延迟提示，区分「无数据」与「数据旧」 | P1 | v0.2 |
| 9 | `/api/v1/alerts` 代理返回注入租户/网域上下文后的 firing/pending 告警实例，支持按网域/监控源筛选，供 Module_08 告警状态页消费（**告警状态页归 M08**，本模块只交付 API，决策 55） | P0 | v0.3 |
| 10 | 查询辅助提供指标名补全、标签建议、常用查询模板（v0.3） | P1 | v0.3 |

### 11.2 技术验收（后端/契约可验证）

| # | 验收项 | 优先级 | 版本 |
|---|--------|--------|------|
| 1 | PromQL instant / range 查询自动注入 `tenant_id` 与 `network_domain`，key 与 Module_09 external_labels 对齐 | P0 | MVP |
| 2 | 未授权租户/网域的数据不可见（注入即权限隔离） | P0 | MVP |
| 3 | 代理 `/api/v1/targets` 返回目标列表，注入租户/网域上下文 | P0 | MVP |
| 4 | 查询响应包含完整 envelope 元数据 | P0 | MVP |
| 5 | 不代理 `/api/v1/alerts`（移至 v0.3） | P0 | MVP |
| 6 | Open API 返回与 Prometheus 兼容的数据格式 | P0 | MVP |
| 7 | 查询响应时间 P99 < 2s | P0 | MVP |
| 8 | 多网域注入基于 PromQL AST 解析，禁止字符串拼接替换 | P0 | v0.2 |
| 9 | `/api/v1/labels`、`/api/v1/series` 注入租户/网域上下文，不泄露跨租户 label 名 | P0 | v0.2 |
| 10 | envelope 支持多网域：`network_domains` 数组 + `data_source` 细化到网域维度 | P0 | v0.2 |
| 11 | 采集健康度/覆盖率查询 API 输出三态数据（按 `resource_id` 回连资源），Module_07 可消费（决策 47-3，由 v0.2 提前） | P0 | MVP |
| 12 | 与 Module_09 心跳/WAL 联动，对断网网域提示数据延迟 | P1 | v0.2 |
| 13 | 批量查询接口语义固定（多表达式、统一时间窗） | P1 | v0.2 |
| 14 | `/api/v1/alerts` 代理注入租户/网域上下文，不代理 Alertmanager 通知状态 | P0 | v0.3 |
| 15 | `/api/v1/rules` 只读代理规则求值状态 | P1 | v0.3 |
| 16 | `validate` 接口校验 PromQL 语法并返回错误定位；`preview` 接口返回最近样本 | P0 | v0.3 |
| 17 | 查询辅助联动 Module_01 指标库与 Module_07 LabelTemplate | P1 | v0.3 |
| 18 | Open API 支持 API Key 鉴权与限流配额 | P1 | v0.3 |
| 19 | ScrapeLog 采集日志独立存储与展示（duration_ms / http_status / error_msg） | P1 | v0.3 |

---

## 12. 模块边界交叉确认（v1.2 新增）

| 协作模块 | 边界约定 | 版本 |
|----------|----------|------|
| Module_01 | `ScrapeTarget` / `ScrapeLog` 模型由 M01 定义，M02 只读展示；MVP 用 `/api/v1/targets` 代理（health/lastScrape/lastError），**同时作为 M01 Job 实例采集状态回显的数据源（决策 47-2）**，ScrapeLog 独立存储 v0.3；validate/指标预览接口随 M01 规则编辑 UI 于 v0.3 启用 | MVP / v0.3 |
| Module_07 | MVP 起：M02 提供 up 健康度/覆盖率查询 API（决策 47-3 提前），M07 只读消费做三态 badge（采集中 / 已下发未采到 / 未监控），M07 不直连时序数据 | MVP |
| Module_08 | alerts 代理 v0.3 与 M08 对齐；M02 只代理中心求值告警实例，Alertmanager 通知状态（分组/静默/抑制/接收人）归 M08；v0.4+ `scope=edge`/`both` 边缘自治告警在边缘 vmalert 本地求值，不在中心 alerts 内 | v0.3 |
| Module_09 | 注入 key 契约对齐 `network_domain` / `tenant_id`（M09 external_labels）；M09 管监控基础设施健康（EdgeAgent/WAL/配置同步），M02 管被监控对象指标；M02 数据新鲜度信息源来自 M09 心跳 | MVP / v0.2 |
| Module_10 | v0.2+ 外部监控源数据经 M10 标签归一化后写入中心，M02 查询覆盖并按监控源筛选；标签语义对齐归 M10 | v0.2 / v0.3 |

---

## 13. 术语映射

| 后端术语 | 用户语言 | 说明 |
|----------|----------|------|
| PromQL | PromQL 查询语句 | Prometheus 查询语言，用于实时筛选和聚合指标数据 |
| instant query | 即时查询 | 查询当前时间点的指标值 |
| range query | 范围查询 | 查询一段时间范围内的指标值序列 |
| `tenant_id` | 租户 ID | 多租户隔离的租户标识，系统自动注入 |
| `network_domain` | 网域 | 网络隔离域标识，系统自动注入 |
| envelope | 响应元数据 | 查询结果的外层包装信息，包含数据来源与新鲜度 |
| `data_source` | 数据来源 | 指标数据的采集方式：中心抓取或边缘异步写入 |
| `freshness_at` | 数据时间 | 指标数据的最新样本时间戳 |
| target | 采集目标 | 被监控的实例端点（`host:port`） |
| health | 采集状态 | 采集目标是否正常：up（正常）/ down（异常）/ unknown（未知） |
| `lastScrape` | 最后采集时间 | 最近一次采集完成的时间 |
| `lastError` | 最后错误 | 最近一次采集遇到的错误信息 |
| `scrapeDuration` | 采集耗时 | 单次采集操作的耗时 |
| `central_scrape` | 中心抓取 | 中心 Prometheus 直接抓取目标，数据延迟低 |
| `edge_remote_write` | 边缘异步写入 | Edge Agent 在边缘网域抓取后异步回写，可能存在分钟级延迟 |
| `firing` | 触发中 | 告警规则当前处于触发状态 |
| `pending` | 待处理 | 告警规则已满足条件但尚未超过持续时间阈值 |
| `/api/v1/query` | 查询接口 | 执行 PromQL 即时查询的 API |
| `/api/v1/query_range` | 范围查询接口 | 执行 PromQL 范围查询的 API |
| `/api/v1/targets` | 目标状态接口 | 查看所有采集目标运行状态的 API |
| `/api/v1/alerts` | 告警状态接口 | 查看当前触发/待处理告警的 API（v0.3） |

---

## 提示分区规范

原型 / 产品页面中的提示按受众分三类，避免相互干扰——

1. **用户 UI 文案**：面向运维工程师，**不含「决策 X」「PRD X.X」等实现层引用**，讲人话；
2. **产品 / 技术评审说明**：设计决策依据与 PRD 引用**集中折叠在页面底部「原型与实现说明（面向产品 / 技术评审）」区**，默认折叠，用户无感知，产品评审与开发可展开；
3. **开发 / AI 注释**：代码注释与 PRD 数据模型 / 技术字段承载实现细节与决策引用，供后续代码开发（含 AI）理解。

此规范使**用户看到干净的"未来原型雏形"**，同时**开发侧（含 AI）可从代码注释与 PRD 获取完整设计依据**。本规范由 `.kimi/agents/prototype-designer.md`「提示分区规范」强制执行，原型 MainLayout 提供全局折叠区承载本模块决策清单。

---

## Change Log

> **Change Log 定位（v1.3）**：本表为业务沟通决策的精简记录（保留最近 3 版一句话摘要）；**完整历史（v1.3 及以前逐版详情）已迁移至 `docs/05-execution-records/module-02/design-decisions.md`「Change Log（完整历史）」小节**。Change Log 主要记录业务侧沟通决策与文档变更，**不承载开发契约**（开发契约见 5.x 数据模型 / 6.x 接口 / 10.x 状态机 / 11 验收标准 / 13 术语映射）。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.7 | 2026-08-31 | 修改 | 决策 55/56/57 落版（M02/M08 边界与注入语义澄清）：①§7 更名「注入与授权校验规则」，§7.2 改写为**三层语义**——`tenant_id` 硬隔离强制注入；`network_domain` **授权集合收敛**（授权=全部网域时不注入任何 matcher，跨网域业务聚合天然成立；授权为真子集时注入集合 matcher）；前端筛选纯 UX 不承担安全职责；②§11.1 验收项 9 收敛为 API 契约（**告警状态页归 M08**，本模块只交付注入代理 API）；③§1 新增**存储可替换性决策点**——1 控制面 + N 采集节点扁平拓扑、中心存储预留替换 VictoriaMetrics、隔离契约保持标签制（VM 原生多租户为 v0.2 评审选项）；设计思路全文见 `docs/05-execution-records/module-02/m02-vs-m08-boundary-and-injection-design.md`；原型待对齐 | 注入规则、验收标准、模块目标 | MVP / v0.2 / v0.3 | 设计中 |
| v1.6 | 2026-08-31 | 新增 | 决策 51/52 交叉落版：①§1 可视化边界补**三层归属**（决策 51）——嵌入入口/引导/模板归 M05、Grafana 自身配置归交付包安装期 provisioning、Dashboard-as-Code 治理预留 M11（v0.4+ 评估）；并明确**跨网域业务看板不受网域注入影响**（授权集合收敛语义下 `sum by (biz)` 跨域聚合天然成立，网域仅作可选下钻维度）；②§1 新增 **blackbox 拨测网域语义**（决策 52）——拨测指标的 `network_domain` 表示发起侧网域（探测路径），目标归属不参与网域推导；原型待对齐 | 模块边界 | v0.2 / v0.3 | 设计中 |
| v1.5 | 2026-08-31 | 修改 | 决策 50 落版（可视化方案收敛）：①§1 新增「与可视化组件的边界」——不自研拖拽面板编辑器/大屏，大屏走 Grafana iframe 嵌入且**数据源必须指向 M02 查询代理**（禁止直连 Prometheus，否则租户/网域注入失效），门户轻量图表用 ECharts/AntV 消费 `query_range`（随 v0.3 首页 Dashboard 数据）；②§3.1「复杂 Dashboard」行改写为「复杂 Dashboard / 可视化大屏」并承载决策 50；③§8.2 补 MVP envelope 最小实现口径（`data_source` 恒 `central_scrape`、`network_domains` 恒 `["default"]`、`freshness_at` 取最新样本时间戳），MVP 即固定 envelope 结构；④v1.2 两行 Change Log 迁移至 design-decisions.md 完整历史；原型待对齐 | 模块边界、功能清单、envelope | MVP / v0.3 | 设计中 |
