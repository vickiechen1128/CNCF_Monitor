# Module 02: 查询中心

> **PRD 状态**: `设计中`（尚未经原型验证）
> **PRD 版本**: v1.3
> **产品版本覆盖**: MVP / v0.2 / v0.3
> **原型版本**: v1.2
> **更新日期**: 2026-08-07
> **对应原型**: `docs/prototypes/module-02/`
> **副标题**: 带租户/网域上下文注入的 Prometheus Query API 代理 + 采集目标状态展示

> **模块类型**: 核心能力模块
> **依赖文档**: [00_Global_Architecture.md](../00_Global_Architecture.md)、[03_Functional_Architecture.md](../03_Functional_Architecture.md)、[02_Product_Roadmap.md](../02_Product_Roadmap.md)、[Module_06_Multi_Tenant.md](Module_06_Multi_Tenant.md)、[Module_09_Network_Domain_and_Edge_Config_Center.md](Module_09_Network_Domain_and_Edge_Config_Center.md)、[Module_01_Metric_Collection_Center.md](Module_01_Metric_Collection_Center.md)、[Module_07_Monitoring_Object_Management.md](Module_07_Monitoring_Object_Management.md)、[Module_08_Alerting_Rule_Management.md](Module_08_Alerting_Rule_Management.md)
> **目标用户**: 运维工程师、业务研发工程师、AI 应用开发工程师

---

## 1. 模块目标

Module_02 提供统一的指标查询入口，定位为**带租户/网域上下文注入的 Prometheus Query API 代理**，并**承接 [Module_01](Module_01_Metric_Collection_Center.md) 移交的采集运行时状态展示**。在将查询转发给中心 Prometheus 之前，必须根据当前认证用户的身份自动注入 `tenant_id` 与有权限的网域标签，以保证多租户数据隔离。

**按产品版本的功能分布（与 [02_Product_Roadmap.md](../02_Product_Roadmap.md) 1.5 功能-版本矩阵对齐）**：

| 版本 | 交付能力 |
|------|----------|
| **MVP** | PromQL 查询代理（含注入骨架）；采集目标状态展示（代理 `/api/v1/targets`）；响应 envelope |
| **v0.2** | 租户/网域上下文注入（多租户 + 多网域语义）；labels/series 租户隔离；采集健康度/覆盖率查询 API；批量查询语义预留；envelope 多网域/多数据源细化 |
| **v0.3** | 告警状态代理（`/api/v1/alerts`）；PromQL 校验与指标实时预览（支撑规则编辑 UI）；查询辅助；首页 Dashboard 数据；Open API 完善 |

> **版本决策（v1.2）**：
> - `/api/v1/alerts` 代理由 MVP 移至 **v0.3**：与 Module_08（v0.3 落地规则分组/静默/Alertmanager 配置）对齐，避免 M08 未就绪时 alerts 代理空转；
> - 租户/网域注入**机制在 MVP 落地**（恒 `default` 网域 + `platform_admin` 租户），**多租户/多网域语义在 v0.2 启用**（M06 租户模型、M09 租户-网域关联均为 v0.2）；
> - PromQL 校验/指标预览接口随 Module_01 规则编辑 UI 一同移至 **v0.3**（路线图 2.4：MVP 不做告警规则编辑 UI，规则手写 `rules.yml` + Alertmanager）。

### 与周边模块的边界

- **与 Module_09 的边界**：Module_02 查询的是**被监控对象**的指标与 exporter 采集健康度（例如 `up` 指标）；Module_09 负责**监控基础设施自身**的健康度，包括 Edge Agent 在线状态、最后心跳、WAL 积压、配置同步等。Module_02 的数据新鲜度信息源（`edge_remote_write` 延迟、网域断网程度）读取 Module_09 心跳/EdgeAgent 状态。
- **与 Module_08 的边界**：Module_02 在 v0.3 代理 Prometheus `/api/v1/alerts`（返回当前 firing/pending 告警实例）；Alertmanager 的通知状态（分组、静默、抑制、接收人）由 Module_08 负责。v0.4+ 边缘自治告警（`scope=edge`/`both`）在边缘 vmalert 本地求值，不在中心 Prometheus 内，alerts 代理只反映**中心聚合告警**。
- **与 Module_01 的边界**：`ScrapeTarget` / `ScrapeLog` 数据模型由 Module_01 定义（Module_01 5.7 / 5.8），Module_02 **只读展示**，不维护其定义；MVP 直接代理 Prometheus 原生 `/api/v1/targets`（含 `health` / `lastScrape` / `lastError`），`ScrapeLog` 独立日志存储与展示放 v0.3（Prometheus 无原生 ScrapeLog API，MVP 不实现独立存储，避免过度设计）。
- **与 Module_07 的边界**：Module_07 的「已监控/未监控」badge 在 MVP 保持二元（数据来源 Module_01 的 `is_monitored` 选中关系）；v0.2 由 Module_02 提供基于 `up` 指标的**采集健康度/覆盖率查询 API**，Module_07 只读消费做三态增强（已监控且 up / 已监控但 down / 未监控）。Module_07 不直连时序数据。
- **与 Module_10 的边界（v0.2+ 预留）**：外部异构监控源数据经 Module_10 标签归一化后写入中心，Module_02 查询需覆盖外部源数据，并支持按监控源筛选（v0.3 告警状态支持按网域/监控源筛选）；标签语义对齐由 Module_10 负责。

---

## 2. 用户故事

> {v1.3} 完整用户故事条目（角色 / 我希望 / 以便于）见**全局用户故事库 [01_User_Stories.md](../01_User_Stories.md) 4.2 节**；本模块用户故事使用模块命名空间编码（`M02-ROLE-NN`，全局唯一），仅在此列出编码与一句话摘要。

- M02-OPS-07：查看当前告警状态（v0.3，经代理 Prometheus `/api/v1/alerts`）
- M02-OPS-08：查看目标列表与采集状态（health up/down、最后抓取时间、抓取错误），按网域 / Job 筛选（MVP）

> 被监控对象的采集健康度（如 exporter `up/down`）通过 PromQL 查询 `up` 等指标及 `/api/v1/targets` 代理查看，不通过独立模块提供。

---

## 3. 核心功能

### 3.1 功能清单（按版本）

| 功能 | 说明 | 优先级 / 版本 |
|------|------|----------------|
| **PromQL 代理**（含租户/网域注入骨架） | 代理 instant / range 查询，自动注入 `tenant_id` 与有权限的网域标签 | **P0 / MVP** |
| **目标状态展示** | 代理 `/api/v1/targets`，展示目标 health（up/down/unknown）、lastScrape、lastError、所属网域/Job，支持按网域/Job 筛选；承接 Module_01 移交的目标列表职责 | **P0 / MVP** |
| **响应 envelope** | 统一包裹 Prometheus 原始响应，暴露数据来源与新鲜度（结构见第 8 节） | **P0 / MVP** |
| **租户/网域上下文注入（多租户语义）** | 多租户 + 多网域场景下基于 PromQL AST 解析注入；用户显式网域 matcher 收敛于授权集合；labels/series 接口租户隔离 | **P0 / v0.2** |
| **采集健康度/覆盖率查询 API** | 基于 `up` 指标聚合，输出「已监控且 up / 已监控但 down / 未监控」三态数据，供 Module_07 badge 三态增强 | **P1 / v0.2** |
| **批量查询** | 一次查询多个表达式（多表达式、统一时间窗、单次响应聚合）；v0.2 固定接口语义，v0.3 完善 | P2 预留 / **P1 / v0.3** |
| **`/api/v1/alerts` 代理** | 代理 Prometheus 当前触发/待处理告警实例，注入租户/网域上下文，支持按网域/监控源筛选；与 Module_08（v0.3）对齐 | **P0 / v0.3** |
| **`/api/v1/rules` 只读代理** | 代理 Prometheus 规则求值状态（只读），供 Module_08 展示，避免其直连 Prometheus 绕过租户隔离 | **P1 / v0.3** |
| **PromQL 校验 + 指标实时预览** | 提供 `validate` 接口（语法校验）与带默认时间窗的指标预览；支撑 Module_01 规则编辑 UI（随规则编辑 UI 移至 v0.3） | **P0 / v0.3** |
| **查询辅助** | 指标名补全（联动 Module_01 指标库 + `/api/v1/label/__name__/values`）、标签建议（叠加 Module_07 LabelTemplate 预置标签）、常用查询模板 | **P1 / v0.3** |
| **首页 Dashboard 数据** | 为 Custom UI 门户（Module_05）首页提供聚合数据接口 | **P1 / v0.3** |
| **Open API** | RESTful API 供外部系统/AI 应用调用，v0.3 完善 API Key 鉴权与限流配额 | **P1 / v0.3** |
| **临时目标验证** | 对临时目标执行抓取并查看结果（Module_01 移交） | P2 / v0.3+ |
| **复杂 Dashboard** | 拖拽式面板编辑器 | P2（不做） |

### 3.2 目标状态展示说明（MVP）

- 数据来源：直接代理中心 Prometheus `/api/v1/targets`，按认证用户注入租户/网域上下文后返回；
- 展示字段：`job`、`instance`、所属网域（`network_domain` 标签）、health（up/down/unknown）、`lastScrape`、`lastError`、`scrapeDuration`；
- 筛选：按网域（v0.2+ 多网域生效）、按 Job、按 health 状态；
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
| /api/v1/targets | GET | **代理目标状态列表（新增，承接 Module_01 移交）**，注入租户/网域上下文 |
| /api/v1/labels | GET | 获取所有 label names（注入租户/网域上下文） |
| /api/v1/label/:name/values | GET | 获取 label 所有值（注入租户/网域上下文） |
| /api/v1/series | GET | 查询匹配的 series（注入租户/网域上下文） |

### 6.2 v0.2 新增/增强

| 接口 | 方法 | 说明 |
|------|------|------|
| /api/v1/batch_query | POST | 批量查询（多表达式、统一时间窗），固定接口语义供 AI/外部系统使用 |
| /api/v1/health/coverage | GET | 采集健康度/覆盖率聚合（三态数据），供 Module_07 badge 消费 |
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

## 7. 自动注入规则

### 7.1 注入标签 key 契约（v1.2 修订，关键）

**注入的标签 key 必须与 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 3.3.1 `external_labels` 注入的 key 完全一致**：

| 标签 key | 取值 | 来源 |
|----------|------|------|
| `network_domain` | `NetworkDomain.id` | Module_09 生成 `prometheus.yml` 时通过 `external_labels` 注入，采集端附加到每条 series |
| `tenant_id` | `NetworkDomain.tenant_id` | 同上 |

> **v1.2 修复说明**：v1.1 曾以 `network_domain_id` 作为查询注入标签（「决策中记为」），与 Module_09 实际注入的 `network_domain` 不一致，会导致注入匹配不到数据（模块注入 = 权限隔离，失效即跨租户数据泄露或全空）。v1.2 起统一为 `network_domain`。注意区分：**对象属性** `Resource.network_domain_id`（Module_07 数据字段）与 **Prometheus 标签** `network_domain`（Module_09 external_labels 注入）是两回事，不得混用。

### 7.2 注入规则

Module_02 在代理查询时，必须根据认证用户从 [Module_06](Module_06_Multi_Tenant.md) 与 [Module_09](Module_09_Network_Domain_and_Edge_Config_Center.md) 获取的租户-网域关联，自动注入以下标签选择器：

1. **自动注入 `tenant_id`**
   选择器为 `tenant_id="<用户所属租户 ID>"`。Module_02 不暴露跨租户查询能力，平台管理员也按租户维度管理。MVP 恒为 `tenant_id="platform_admin"`。

2. **自动注入网域标签 `network_domain`**
   值为该用户有权限的全部网域 ID。多网域时使用正则匹配：
   ```promql
   network_domain=~"domain-a|domain-b|domain-c"
   ```

3. **单网域场景（MVP）**
   若租户仅拥有 `default` 网域，Module_02 自动注入 `network_domain="default"`，对用户完全透明，无需在 PromQL 中显式写网域过滤。

4. **多网域场景（v0.2+）**
   若用户拥有多个网域权限且未在 PromQL 中显式指定网域过滤，Module_02 默认查询其**所有有权限网域**的数据。前端 UI 应明确提示当前查询范围覆盖 N 个网域。

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
| 3 | 目标状态页展示 job / instance / 网域 / health / lastScrape / lastError，支持按网域、Job、health 筛选 | P0 | MVP |
| 4 | blackbox 拨测目标可通过目标状态页与 `probe_success` / `probe_duration_seconds` 查询查看结果 | P0 | MVP |
| 5 | 查询响应包含 envelope 元数据：`data_source`、`freshness_at`、`network_domains` | P0 | MVP |
| 6 | 多网域租户默认查询全部授权网域，UI 提示当前查询范围覆盖 N 个网域 | P0 | v0.2 |
| 7 | 用户显式指定 `network_domain` matcher 时，越权取值返回空结果 | P0 | v0.2 |
| 8 | 断网网域的数据在 UI 上标注延迟提示，区分「无数据」与「数据旧」 | P1 | v0.2 |
| 9 | 告警状态页展示当前 firing/pending 告警，支持按网域/监控源筛选（v0.3） | P0 | v0.3 |
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
| 11 | 采集健康度/覆盖率查询 API 输出三态数据，Module_07 可消费 | P1 | v0.2 |
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
| Module_01 | `ScrapeTarget` / `ScrapeLog` 模型由 M01 定义，M02 只读展示；MVP 用 `/api/v1/targets` 代理（health/lastScrape/lastError），ScrapeLog 独立存储 v0.3；validate/指标预览接口随 M01 规则编辑 UI 于 v0.3 启用 | MVP / v0.3 |
| Module_07 | MVP：`is_monitored` badge 保持二元（M01 关系）；v0.2：M02 提供 up 健康度/覆盖率查询 API，M07 只读消费做三态增强，M07 不直连时序数据 | MVP / v0.2 |
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

> **Change Log 定位（v1.3）**：本表为业务沟通决策的精简记录（保留最近 3 版一句话摘要）；**完整历史（v1.1 及以前逐版详情）已迁移至 `docs/04-execution-records/module-02/design-decisions.md`「Change Log（完整历史）」小节**。Change Log 主要记录业务侧沟通决策与文档变更，**不承载开发契约**（开发契约见 5.x 数据模型 / 6.x 接口 / 10.x 状态机 / 11 验收标准 / 13 术语映射）。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.3 | 2026-08-07 | 新增 | 按 prototype-designer PRD 骨架规范补齐：第 2 章用户故事引用全局库（M02- 编码）、新增 4.x 核心流程、5.x 数据模型加「UI 展示名」列、10.x 数据模型状态机、验收标准分层（11.1 用户 / 11.2 技术）+ P0/P1 标注、新增第 13 章「术语映射」、Change Log 精简（完整历史迁移 design-decisions.md） | 文档自身 | 文档自身 | 设计中 |
| v1.2 | 2026-08-06 | 新增 | 原型升级对齐 PRD v1.2（docs/prototypes/module-02/）：目标状态展示增强（采集时长 / 拨测结果 / 采集诊断 Drawer / 覆盖率统计卡 v0.2）；envelope 多值 `network_domains` 展示；自动注入提示（单/多网域）；数据来源与新鲜度演示（v0.2 联动 Module_09）；告警状态页 v0.3 占位标注；查询辅助 v0.3 标注；全局导航壳与 `Tenant.multi_site_enabled` 模式开关；原型版本 v1.1 → v1.2，package.json version 1.2.0，新增 README.md（含导航映射表与模块边界标注） | 原型目录、UI/UX、文档自身 | 文档自身 | 设计中 |
| v1.2 | 2026-08-06 | 修改 | 版本对齐路线图与 M01/M07/M08/M09 边界交叉确认：① `/api/v1/alerts` 代理由 MVP 移至 **v0.3**（与 Module_08 对齐）；② 租户/网域注入机制 MVP 落地、多租户/多网域语义 v0.2 启用；③ PromQL 校验/指标预览接口随 Module_01 规则编辑 UI 移至 **v0.3**（路线图 2.4 MVP 不做告警规则编辑 UI）；④ **修复注入标签 key 契约**：统一为 `network_domain` / `tenant_id`（与 Module_09 3.3.1 external_labels 对齐），删除 v1.1 的 `network_domain_id` 表述，并区分对象字段与 Prometheus 标签；⑤ 新增 MVP「目标状态展示」（代理 `/api/v1/targets`，承接 Module_01 3.3 移交）；⑥ envelope 修订：`network_domain` 单值 → `network_domains` 多值、`data_source` 细化到网域、v0.2 联动 Module_09 心跳/WAL 提示数据延迟；⑦ 新增 v0.2：采集健康度/覆盖率查询 API（Module_07 三态 badge 联动）、批量查询语义预留、labels/series 租户隔离、AST 解析注入；⑧ 新增 v0.3：`/api/v1/rules` 只读代理、`validate`/`preview` 接口、查询辅助（联动 M01 指标库 + M07 LabelTemplate）、Open API 鉴权限流、Dashboard 数据；⑨ 新增「模块边界交叉确认」章节 | 模块目标、功能清单、接口设计、注入规则、envelope、验收标准、模块边界 | MVP / v0.2 / v0.3 | 设计中 |
