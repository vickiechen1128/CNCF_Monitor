# 设计决策记录：module-02

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-02/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_02_Query_Center.md
- 影响范围：原型页面范围

### 决策 4：Module_02 v1.2 版本对齐与周边边界修订（2026-08-06）

- 问题：Module_02 v1.1 与路线图（02_Product_Roadmap.md）及 M01/M07/M08/M09 边界存在版本与契约不一致，需按产品大版本落位并交叉确认。
- 触发：用户要求基于 M01/M07/M09 PRD 提出 Module_02 优化意见，并对照产品路线图确认开发版本。
- 参与 Agent：orchestrator（chenrt 的 AI）；关键版本决策经用户确认。

| # | 决策 | 版本落位 | 依据 |
|---|------|----------|------|
| 4.1 | `/api/v1/alerts` 代理 | MVP P0 → **v0.3** | 与 M08（v0.3 落地规则分组/静默/Alertmanager 配置）对齐，避免 M08 未就绪时 alerts 代理空转；**用户已确认** |
| 4.2 | PromQL 校验 / 指标实时预览（`validate` / `preview`） | MVP → **v0.3** | M01 规则编辑 UI 随路线图 2.4「MVP 不做告警规则编辑 UI」挪至 v0.3；**用户已确认** |
| 4.3 | 租户/网域上下文注入 | 机制 MVP（恒 `default` + `platform_admin`），多租户/多网域语义 **v0.2** | M06 租户模型、M09 租户-网域关联均为 v0.2 |
| 4.4 | 注入标签 key 契约 | **MVP 修复**：统一 `network_domain` / `tenant_id` | 与 M09 3.3.1 `external_labels` 对齐；v1.1 的 `network_domain_id` 会导致注入匹配不到数据（权限隔离失效） |
| 4.5 | 目标状态展示（`/api/v1/targets` 代理） | **新增 MVP** | 承接 M01 3.3 移交（目标列表/拨测结果/采集诊断）；路线图 MVP 已含「目标状态展示」 |
| 4.6 | envelope：`network_domain` 单值 → `network_domains` 数组、`data_source` 细化到网域 | MVP 结构 / v0.2 语义 | 多网域聚合查询需表达来源网域集合 |
| 4.7 | 采集健康度/覆盖率查询 API（M07 三态 badge） | **v0.2** | M07 `is_monitored` badge MVP 保持二元（M01 选中关系）；v0.2 由 M02 提供 `up` 聚合，M07 只读消费 |
| 4.8 | 批量查询语义固定 / 查询辅助 / Dashboard 数据 / Open API 鉴权 | v0.2 预留 / **v0.3** | 路线图 Phase 7（v0.3~v0.4 指标 Open API） |
| 4.9 | 目标详情 ScrapeLog 独立日志存储 | MVP 不做（`/api/v1/targets` 已含 lastError），**v0.3** 落地 | Prometheus 无原生 ScrapeLog API，避免过度设计 |

- 影响范围：
  - `docs/02-product-requirements/Modules/Module_02_Query_Center.md`（升 **v1.2**：功能清单、接口设计、注入规则、envelope、验收标准、新增「模块边界交叉确认」章节）
  - `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（升 **v2.2**：规则编辑 UI 版本调整同步）
  - 路线图 1.5 功能-版本矩阵核对一致
- 遗留事项：
  - [x] Module_08 PRD 版本面已同步（v1.2，alerts 代理 v0.3 对齐，2026-08-06）
  - [x] module-02 原型已升级对齐 PRD v1.2（v1.2，2026-08-06；含目标状态展示增强、envelope 多值、注入提示、覆盖率 v0.2、告警 v0.3 占位、模式开关）

### 决策 5：Module_02 PRD 按 prototype-designer 骨架规范补齐

- **问题**：prototype-designer 要求 PRD 包含模块目标、用户故事、核心功能、核心流程、数据模型（含「UI 展示名」列）、接口设计、依赖、数据模型状态机、验收标准（分用户/技术两层 + P0/P1 标注）、术语映射等章节；Module_01（v2.4）/ Module_07（v1.6）/ Module_09（v1.24）已按新骨架规范落地，Module_02 尚未对齐。
- **结论**：Module_02 PRD 升版 v1.3，落地以下骨架调整：
  1. 第 2 章用户故事改为引用全局用户故事库（`01_User_Stories.md` §4.2），仅列 `M02-ROLE-NN` 编码 + 一句话摘要，删除旧产品级编码（`OPS-03`、`AI-01`、`AI-02`、`DEV-01`）；
  2. 新增第 4 章「核心流程」（查询流程、多网域查询流程、数据新鲜度联动流程）；
  3. 新增第 5 章「数据模型」（查询请求参数、响应 Envelope、目标状态字段），字段表含「UI 展示名」列；
  4. 新增第 10 章「数据模型状态机」（采集目标健康状态、告警实例状态、数据来源状态）；
  5. 验收标准分层：11.1 用户验收（UI 可感知）/ 11.2 技术验收（后端/契约可验证），并补 P0/P1 标注；
  6. 新增第 13 章「术语映射（用户词汇表）」；
  7. Change Log 精简为最近 3 版一句话摘要，完整历史（v1.1 及以前逐版详情）迁移至本文件「Change Log（完整历史）」小节。
- **依据**：prototype-designer PRD 状态守护职责（Change Log 规范、骨架要求）；Module_09 design-decisions「第十三轮评审」遗留项：骨架规范（UI 展示名 / 术语映射 / 验收分层）需推广到 Module_01/02/07 等其他模块 PRD。
- **影响范围**：Module_02 PRD v1.3 正文各章节、`docs/05-execution-records/module-02/design-decisions.md`。

### 已确认项（2026-08-07）

- [x] 用户故事编码已全部统一为 `M02-ROLE-NN`，正文无旧编码（`OPS-03`、`AI-01`、`AI-02`、`DEV-01`）遗留。
- [x] Module_02 PRD 骨架调整落地（v1.3）：UI 展示名、核心流程、术语映射、验收分层、用户故事引用全局库、状态机、Change Log 精简。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（尚未完成原型验证，待领导/业务评审）。
- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_02_Query_Center.md`（v1.3）
- `docs/02-product-requirements/01_User_Stories.md`（§4.2）
- `docs/prototypes/module-02/`
- `docs/02-product-requirements/02_Product_Roadmap.md`（1.5 功能-版本矩阵、2.4 MVP 不做项）
- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（3.3 移交清单、5.5 MonitoringRule、v2.2 规则编辑 UI 版本调整）
- `docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md`（5.2 `is_monitored`、5.12 LabelTemplate）
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`（3.3.1 `external_labels`、4.2/4.3 EdgeAgent 心跳）
- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`（v0.3 alerts 对齐，版本面待同步）

### 决策 6：目标状态展示落点重估——API 保留 MVP、独立页面降 P1（2026-08-28，决策 47-4）

- **触发**：用户提出采集状态回显前置（决策 47，全文见 module-01 design-decisions）——M01 Job 配置上下文与 M07 资源台账都需要真实采集状态回显，M02 独立「目标状态页」不再是唯一知情入口。
- **结论**：
  1. `GET /api/v1/targets` 代理**保留 MVP P0**——是 M01 Job 回显与 M07 badge 的共同数据源，租户/网域注入职责不变；
  2. 独立「目标状态页」前端由 P0/MVP **降为 P1**（极简列表），定位收敛为「跨 Job 全局排障入口」；
  3. 「采集健康度/覆盖率查询 API」（三态，供 M07 badge 消费）由 **v0.2 提前到 MVP**（修订决策 4.7）。
- **影响范围**：Module_02 PRD v1.4（§1 版本分布、§3.1 功能清单、§3.2、§6 接口、§11 验收、§12 边界）。

### 决策 7：可视化方案收敛——大屏走 Grafana 嵌入、门户轻量图表自研（2026-08-31，决策 50）

- **触发**：MVP 收口评估中发现两个非 Prometheus 原生的能力缺口，其中「可视化大屏进行指标实时展示」需要明确方案与边界，避免与 M02「不自研拖拽面板编辑器」的既有结论冲突。
- **结论**：
  1. **不自研**拖拽式面板编辑器与可视化大屏（维持 P2 不做）；
  2. 大屏/复杂看板需求通过 **Grafana iframe 嵌入**满足（anonymous 模式 + share/embed 链接；AGPL 对嵌入使用无限制）；
  3. **红线**：Grafana 的数据源必须配置为 M02 查询代理地址（`/api/v1/query*`），**禁止直连 Prometheus**——否则租户/网域注入被绕过，v0.2 多租户启用后构成跨租户数据泄露；
  4. 门户内轻量实时图表（首屏指标卡、资源详情趋势图）使用 ECharts/AntV 消费 M02 `query_range`，与 v0.3「首页 Dashboard 数据」共用查询链路。
- **配套澄清**：MVP envelope 按最小集落地（`data_source` 恒 `central_scrape`、`network_domains` 恒 `["default"]`、`freshness_at` 取最新样本时间戳），结构在 MVP 即固定，v0.2 只做取值细化不改结构。
- **依据**：Grafana/夜莺等外部组件自带独立查询路径，只有强制其走 M02 代理，M02 的注入隔离才对全部查询消费方生效；自研面板编辑器投入产出比低。
- **影响范围**：Module_02 PRD v1.5（§1 新增可视化组件边界、§3.1「复杂 Dashboard / 可视化大屏」行、§8.2 envelope MVP 口径）。
- **关联决策**：决策 49（告警组件选型锁定 Alertmanager，全文见 module-08 design-decisions）——同一轮缺口的另一部分。

---

## Change Log（完整历史）

> v1.3 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.4 及以前的逐版完整变更详情（业务沟通决策记录）。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.4 | 2026-08-28 | 修改 | 决策 47 落版（采集状态回显前置）：①目标状态能力拆层——`/api/v1/targets` 代理 API 保留 P0/MVP 并明确为 M01 Job 回显（47-2）与 M07 badge（47-3）的共同数据源；**独立目标状态页由 P0 降为 P1**（极简列表，定位收敛为跨 Job 全局排障入口，47-4）；②**采集健康度/覆盖率查询 API 由 v0.2 提前到 MVP**（三态，按 `resource_id` 回连资源，供 M07 badge）；③§1 版本分布 / §2 M02-OPS-08 / §3.1 功能清单 / §3.2 说明 / §6 接口（coverage 移入 6.1）/ §11 验收（拆 3 / 3a，#11 改 P0/MVP）/ §12 边界（M01/M07 行）同步；原型待对齐（头部原型版本标注未对齐） | 模块目标、功能清单、接口设计、验收标准、模块边界 | MVP | 设计中 |
| v1.3 | 2026-08-07 | 新增 | 按 prototype-designer PRD 骨架规范补齐：第 2 章用户故事引用全局库（M02- 编码）、新增 4.x 核心流程、5.x 数据模型加「UI 展示名」列、10.x 数据模型状态机、验收标准分层（11.1 用户 / 11.2 技术）+ P0/P1 标注、新增第 13 章「术语映射」、Change Log 精简（完整历史迁移 design-decisions.md） | 文档自身 | 文档自身 | 设计中 |
| v1.2 | 2026-08-06 | 新增 | 原型升级对齐 PRD v1.2（docs/prototypes/module-02/）：目标状态展示增强（采集时长 / 拨测结果 / 采集诊断 Drawer / 覆盖率统计卡 v0.2）；envelope 多值 `network_domains` 展示；自动注入提示（单/多网域）；数据来源与新鲜度演示（v0.2 联动 Module_09）；告警状态页 v0.3 占位标注；查询辅助 v0.3 标注；全局导航壳与 `Tenant.multi_site_enabled` 模式开关；原型版本 v1.1 → v1.2，package.json version 1.2.0，新增 README.md（含导航映射表与模块边界标注） | 原型目录、UI/UX、文档自身 | 文档自身 | 设计中 |
| v1.2 | 2026-08-06 | 修改 | 版本对齐路线图与 M01/M07/M08/M09 边界交叉确认：① `/api/v1/alerts` 代理由 MVP 移至 **v0.3**（与 Module_08 对齐）；② 租户/网域注入机制 MVP 落地、多租户/多网域语义 v0.2 启用；③ PromQL 校验/指标预览接口随 Module_01 规则编辑 UI 移至 **v0.3**（路线图 2.4 MVP 不做告警规则编辑 UI）；④ **修复注入标签 key 契约**：统一为 `network_domain` / `tenant_id`（与 Module_09 3.3.1 external_labels 对齐），删除 v1.1 的 `network_domain_id` 表述，并区分对象字段与 Prometheus 标签；⑤ 新增 MVP「目标状态展示」（代理 `/api/v1/targets`，承接 Module_01 3.3 移交）；⑥ envelope 修订：`network_domain` 单值 → `network_domains` 多值、`data_source` 细化到网域、v0.2 联动 Module_09 心跳/WAL 提示数据延迟；⑦ 新增 v0.2：采集健康度/覆盖率查询 API（Module_07 三态 badge 联动）、批量查询语义预留、labels/series 租户隔离、AST 解析注入；⑧ 新增 v0.3：`/api/v1/rules` 只读代理、`validate`/`preview` 接口、查询辅助（联动 M01 指标库 + M07 LabelTemplate）、Open API 鉴权限流、Dashboard 数据；⑨ 新增「模块边界交叉确认」章节 | 模块目标、功能清单、接口设计、注入规则、envelope、验收标准、模块边界 | MVP / v0.2 / v0.3 | 设计中 |
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | MVP / v0.2 / v0.3 | draft |
### 决策 8：跨模块决策交叉引用（2026-08-31，决策 51/52/53/54）

- **决策 51（Grafana 集成三层归属）**：全文见 module-05 design-decisions。本模块落点：可视化边界补充三层归属（M05 嵌入 / 交付包 provisioning / M11 预留），并明确**跨网域业务看板不受网域注入影响**——注入语义为「授权集合收敛」（PRD §7.2），`sum by (biz)` 跨域聚合天然成立，网域仅作可选下钻维度。
- **决策 52（网域归属解析链）**：全文见 module-07 design-decisions。本模块落点：blackbox 拨测网域语义——拨测指标 `network_domain` 表示**发起侧网域**（探测路径），目标归属不参与推导。
- **决策 53/54（filter 模式 + Job 网域扇出）**：全文见 module-01 design-decisions。本模块无直接改动；采集状态回显（决策 47-2）对 filter 模式自动纳入的新实例同样生效（「待采集」语义不变）。
- **影响范围**：Module_02 PRD v1.6（§1 边界两条）。

### 决策 9：M02/M08 告警状态归属切分 + 注入三层语义 + 存储可替换性（2026-08-31，决策 55/56/57）

- **触发**：用户评审提出四问——①M02「当前告警」与 M08「告警状态」是否重复；②M02 偏后台 API、为全局排障做准备，是否应单独成模块；③注入代理的必要性，M08 直连 Alertmanager 是否可以，去掉注入是否利于未来对接夜莺；④`tenant_id` 强制注入可接受，但 `network_domain` 是部署拓扑、业务通常跨网域，不应强制注入，安全场景能否由前端筛选承担。**全部结论经用户确认**。
- **设计思路全文**：`docs/05-execution-records/module-02/m02-vs-m08-boundary-and-injection-design.md`（含功能异同对照表、用户动线分析、被否备选方案）。

**决策 55（告警状态归属切分）**：

- **结论**：「当前告警」能力按层切分——**API 层归 M02**（代理 Prometheus `/api/v1/alerts`，注入租户/网域上下文，v0.3）；**页面层归 M08**（告警状态页 = 告警域工作台，同页展示 Prometheus firing/pending + Alertmanager 通知状态）。
- **依据（用户动线/心智）**：告警处理链「什么出了问题 → 通知了谁/是否被静默 → 加静默/调路由」是连续任务，语境全在告警域，按数据源拆页会迫使用户来回跳转；M02 自有动线是「查询与排障链」（指标异常 → PromQL 验证 → target 采集状态），两类心智任务不应混在一个页面叙事里。
- **落点**：M02 PRD §11.1 验收项 9 收敛为 API 契约（删「页」）；M08 PRD §5.4 明确页面归属。

**决策 56（注入三层语义 + AM 侧授权约束）**：

- **结论**：注入语义明确为三层——
  1. `tenant_id`：**硬隔离边界**，服务端强制注入，永远存在、用户不可见不可改；
  2. `network_domain` 授权集合：**软授权边界**，服务端强制校验——授权集合 = 租户全部网域时**不注入任何 matcher**（零感知，`sum by (biz)` 跨网域聚合天然成立）；授权为真子集时注入集合 matcher；用户显式 matcher 收敛于授权集合、越权返回空；
  3. `network_domain` 筛选：**纯 UX**，授权集合内自由下钻，不承担安全职责。
- **红线**：安全必须服务端执行。「只被允许看某网域」是授权要求时，前端筛选 = 视觉遮蔽（curl 即绕过），不构成权限。用户已确认接受该约束。
- **AM 侧同步约束（M08 落点）**：M08 直连 Alertmanager 可以，但①读路径：代理 AM `/api/v1/alerts` 服务端强制注入授权集合 filter（不信任前端传参）；②写路径：静默全局生效，创建时服务端校验 matcher 收敛于授权集合，否则构成跨租户写武器。
- **依据**：`network_domain` 是部署拓扑维度而非默认隔离边界（业务通常跨网域，与决策 51 补充一致）；Prometheus/Alertmanager 原生零多租户，隔离必须外挂且服务端执行。
- **落点**：M02 PRD §7 更名「注入与授权校验规则」、§7.2 改写三层语义；M08 PRD §5.2 / §5.4 / §9.2 补授权约束。

**决策 57（扁平拓扑 + 中心存储可替换 + 隔离契约保持标签制）**：

- **结论**：
  1. 部署拓扑锁定「**1 控制面 + N 采集节点**」扁平形态（用户明确）；
  2. 中心存储**预留替换 VictoriaMetrics**——M02 代理作为防腐层保证替换时消费方（UI/Grafana/Open API）零改动；
  3. **隔离契约保持标签制**（`tenant_id`/`network_domain` 由 M09 `external_labels` 写入侧打标、M02 查询侧校验），Prometheus 与 VM 通吃、边缘 remote_write 已按此打标、换存储不改契约；
  4. VM 集群版原生多租户（vmauth + accountID 路由，M02 退化为 user→accountID 映射）列为 **v0.2 架构评审选项**，暂定不采用（契约单一、可回切 Prometheus）；
  5. 告警分发前期维持 M08「UI 生成 alertmanager.yml + reload」文件化形态（与决策 49 闭环一致），不引入 DB 驱动方案。
- **对「去代理对接夜莺」的回应**：代理不是对接夜莺的障碍（M09 文件化配置流水线 + Alertmanager 选型才是真正耦合点）；代理是防腐层，去掉反而把平台焊死在 Prometheus 上。
- **落点**：M02 PRD §1 新增「存储可替换性决策点」。

- **影响范围**：Module_02 PRD v1.7；Module_08 PRD v1.5（交叉引用见 module-08 design-decisions）；`docs/05-execution-records/module-02/m02-vs-m08-boundary-and-injection-design.md`（新建）；`Modules/README.md` 版本行同步。
