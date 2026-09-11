# 设计决策记录：module-08

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-08/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- `docs/prototypes/module-08/`

---

## 补充对齐：2026-08-15（M01/M08/M09 告警规则职责三轴重构）

- **参与 Agent**：用户、backend-developer
- **触发原因**：用户发现 M01「规则编辑」与 M08「告警规则管理」命名重叠、`MonitoringRule` 与 `AlertingRule`/`RecordingRule` 字段重复、M08 与 M09 均声明生成 `rules.yml`、入口不统一，确认按三轴重构边界。
- **关联模块**：Module_01、Module_08、Module_09、Module_02。

### 关键决策

#### 决策 4：M08 收缩为「告警收敛与通知管理」

- **问题**：M08 同时负责规则编辑 UI、规则生命周期管理、`rules.yml` 生成与 Alertmanager 配置，与 M01 规则内容创作、M09 配置唯一生成者冲突；用户原意是 M08 复用 Alertmanager 更适合做告警收敛、分发工作。
- **结论**：
  1. M08 模块名称由「告警规则管理」改为 **「告警收敛与通知管理」**；
  2. M08 只负责 **Alertmanager 域**：接收人/路由/静默/抑制/通知状态；不再负责规则内容创作、规则分组、`rules.yml` 生成与下发；
  3. 规则内容创作归 M01（`MonitoringRule` 单一权威记录），规则按网域分组生成 `rules.yml` 归 M09；
  4. `alertmanager.yml` 由 M08 直接写文件并触发 reload，MVP 单域阶段不进入 M09 配置变更确认流程（调整频繁、风险低）。
- **依据**：单一职责原则；M09 已是配置唯一生成者；M08 复用 Alertmanager 更适合收敛/分发；用户原意。
- **影响范围**：M08 PRD v1.3 全部重写；M01 PRD 5.5 / 1 / 3.2 / 6 边界表；M09 PRD 3.3 / 3.4 / 6.2 / 配置包结构；全局 Roadmap/术语映射/依赖文档链接。

### 已确认项

- [x] M08 收缩为「告警收敛与通知管理」，规则相关职责移交 M01/M09（用户确认）。
- [x] `alertmanager.yml` 由 M08 直写 reload，MVP 单域不进入 M09 审批（用户确认）。
- [x] M08 数据模型由 `AlertingRule`/`RuleGroup`/`RecordingRule` 改为 `Receiver`/`Route`/`Silence`/`InhibitionRule`/`AlertmanagerConfigVersion`（用户确认）。

### 仍待确认项

- [ ] PRD 状态推进：保持「设计中」（待原型验证）。
- [ ] v0.4+ 多网域边缘 Alertmanager 配置分发方式（由 M08 直接推还是随 M09 配置包下发）。

### 关联文档

- `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`
- `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`
- `docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`
- `docs/05-execution-records/module-01/design-decisions.md`（决策 3.57）
- `docs/05-execution-records/module-09/design-decisions.md`

---

## 补充对齐：2026-08-31（告警收敛与派发组件选型锁定，决策 49）

- **触发**：MVP 收口评估中用户提出「告警的收敛与派发」是 Prometheus 原生不具备的缺口，选型未定，候选为 Alertmanager / Grafana Alerting / 夜莺（Nightingale），需锁定方向再排原型与开发。
- **结论**：告警收敛与派发组件**锁定 Alertmanager**，不引入 Grafana Alerting 或夜莺：
  1. **配置模型匹配**：Alertmanager 为声明式文件配置（`alertmanager.yml`），与 M08「UI 配置 → 生成文件 → reload」及 M09 配置生成流水线天然兼容；Grafana Alerting 的规则与通知策略存于 Grafana 自身 DB、由 UI 驱动，无法纳入平台配置生成闭环；夜莺是完整监控平台（自采/自存/自告警/自带 UI），引入等于整体替换架构，且其告警规则同样为 DB 驱动。
  2. **租户/网域隔离**：Grafana / 夜莺自带独立查询与告警路径，会绕开 Module_02 的注入代理，v0.2 多租户启用后构成隔离缺口。
  3. **易用性诉求由 M08 承接**：「Alertmanager 手写 YAML 难用」的痛点正是 M08 的价值——接收人/路由/静默/抑制的 UI 化管理，用户不接触 YAML，无需为此换组件。
  4. **已有工程资产**：`upstream/alertmanager/` 子模块已入库，`make build-center` 已纳入一体化交付包，推翻选型将废弃这部分资产。
- **范围确认**：M08 职责边界不变（Alertmanager 域：接收人/路由/静默/抑制/通知状态；规则创作归 M01、`rules.yml` 生成下发归 M09）；MVP 落地范围按 PRD §3.1 功能表执行。
- **影响范围**：Module_08 PRD v1.4（§1 新增「组件选型决策」、Change Log）。
- **关联决策**：决策 50（可视化方案：大屏走 Grafana iframe 嵌入、数据源必须指向 M02 查询代理，全文见 module-02 design-decisions）——同一轮缺口的另一部分。

---

## 补充对齐：2026-08-31（M02/M08 告警状态边界 + 授权集合过滤，决策 55/56/57 交叉引用）

- **触发与结论**：全文见 module-02 design-decisions「决策 9」；设计思路分析见 `docs/05-execution-records/module-02/m02-vs-m08-boundary-and-injection-design.md`。
- **本模块落点**：
  - **决策 55（告警状态归属切分）**：「告警状态页」归属**本模块**（告警域工作台，用户动线为告警处理连续任务链）；M02 只交付注入代理 API（Prometheus `/api/v1/alerts`），本模块只读消费。落点：PRD §5.4。
  - **决策 56（注入三层语义 + AM 侧授权约束）**：本模块直连 Alertmanager 维持不变，但补两条服务端约束——①读路径：代理 AM `/api/v1/alerts` 时服务端强制注入当前用户授权网域集合 filter（不信任前端传参，授权=全部网域时不附加）；②写路径：静默全局生效，创建静默时服务端校验 matcher 收敛于授权集合，越权拒绝（防跨租户写武器）。落点：PRD §5.2 / §5.4 / §9.2。
  - **决策 57（扁平拓扑 + 存储可替换）**：本模块无直接改动；告警分发前期维持「UI 生成 `alertmanager.yml` + reload」文件化形态（与决策 49 一致），不引入 DB 驱动方案。
- **影响范围**：Module_08 PRD v1.5（§5.2 / §5.4 / §9.2 / Change Log）；Change Log 同步去章节编号并收敛至 3 版（v1.2 及以前迁入本文件「Change Log（完整历史）」）。

---

## 补充对齐：2026-09-04（静默管理 API v1 → v2 迁移，决策 61）

- **触发**：`feat/module-08-alert-dispatch` 分支开发实测中，静默列表/创建/删除均返回 502；排查后发现 Alertmanager（≥0.27）已移除 v1 silence 端点（`GET/POST /api/v1/silences`、`GET/DELETE /api/v1/silence/{id}`），调用即返回 **410 Gone**；此前 PRD/契约快照仍按 v1 书写。
- **结论**：
  1. MVP 静默代理必须统一迁移到 **Alertmanager v2 silence API**：List/Create 走 `/api/v2/silences`，Get/Delete 单条走 `/api/v2/silence/{id}`；
  2. v2 响应形状与 v1 不同——列表为裸数组、单条为裸对象、创建成功返回 `{"silenceID": "..."}`，服务端 DTO 与测试 fake 同步调整；
  3. 通知状态查询（`/api/v1/alerts`）不受影响，仍维持 v1；
  4. 本决策作为开发期技术修正，纳入 design-decisions 决策序列 61。
- **影响范围**：
  - `docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md`（v1.8）：§5.2 示例与说明、§7 边界表、§9.2 技术验收；
  - `docs/05-execution-records/module-08/api-contract-snapshot.md`（v2026-09-04）：§1.1 前缀说明、§4 静默 API 路径与响应形状；
  - 源码 `platform/alertmanager/silence/proxy.go`、`silence/service.go`、`silence_test.go`、`platform/cmd/metric-center/main_test.go` fake Alertmanager（已在开发分支完成修复）。
- **验证**：`go test ./platform/alertmanager/silence/...`、`go test ./platform/cmd/metric-center/... -run TestEndToEndAlertmanagerSmoke`、`go test ./platform/...` 全量通过。

---

## Change Log（完整历史）

> v1.5 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载主 PRD 轮转迁出的历史版本逐版完整变更详情（业务沟通决策记录）。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
| v1.13 | 2026-09-09 | 新增 | 历史告警 MVP 增量（Track B，用户书面确认）：新增独立页面「历史告警」——基于 Prometheus `ALERTS` 时间序列重建规则级触发/恢复区间（恢复时间为求值近似值），展示触发时间/恢复时间/持续时长/实例/网域/摘要，支持按网域/告警名/实例/状态/时间范围筛选（默认 24h、最大 7d）；数据由 Module_02 新增 `/api/v1/alerts/history` 提供；§1 目标 3、§2 M08-OPS-08、§3.1 功能表、§5.4、§9.1/§9.2 验收、§10 术语同步；免高保真原型（豁免记录见 design-decisions.md）（自 PRD Change Log 轮转迁入，v1.16） | 1 / 2 / 3.1 / 5.4 / 9 / 10 | MVP | ready |
| v1.12 | 2026-09-08 | 修改 | 范围调整（MVP 试用反馈：前台缺少查看当前告警入口）：告警状态查看由 v0.3 提前至 MVP——§1 目标 3、§2 M08-OPS-03、§3.1 功能表、§5.4、§8 依赖、§9.1 验收同步调整；「告警状态页」MVP 交付（Prometheus firing/pending 视图依赖 M02 代理 `/api/v1/alerts` 同步提前，见 Module_02 对应版本口径）；顺手修正 Alertmanager 告警代理端点为 `/api/v2/alerts`（对齐决策 61 的 v2 API 口径，v1 端点在 AM ≥0.27 已移除）（随 v1.15 增量自 PRD Change Log 轮转迁入） | 0 | 功能提前至 MVP | ready |
| v1.11 | 2026-09-04 | 修改 | §0「需求背景与典型场景」结构优化：删除与 §2 重复的「涉及的用户故事」小节，改为结尾交叉引用「本模块覆盖的用户故事详见 §2」；§2 保持为用户故事唯一权威入口，避免双处维护漂移（自 PRD Change Log 轮转迁入） | 0 | 文档自身 | 设计中 |
| v1.10 | 2026-09-04 | 修改 | §0「需求背景与典型场景」深化：基于 dev-feedback 与 design-decisions 真实记录，新增「用户需求的演进过程」（通知接入→变更管控→静默管理→风暴抑制→状态可视化）与「不同技术背景用户的痛点分层」（4 类用户）；典型场景从 3 个扩展为 6 个，补充「告警配置变更确认」「静默 API 版本迁移」「查看告警通知状态」真实场景（自 PRD Change Log 轮转迁入） | 0 | 文档自身 | 设计中 |
| v1.9 | 2026-09-04 | 新增 | 补充 §0「需求背景与典型场景」：面向产品经理/新工程师的业务叙事层，包含模块痛点、3 个典型场景（通知渠道配置/临时静默/告警风暴抑制）与涉及用户故事编码索引；不改变技术契约（自 PRD Change Log 轮转迁入） | 0 | 文档自身 | 设计中 |
| v1.8 | 2026-09-04 | 修改 | 决策 61 落版（静默 API v1→v2 迁移）：Alertmanager ≥0.27 已移除 `/api/v1/silences` 等 v1 silence 端点（返回 410 Gone），MVP 必须调用 `/api/v2/silences` / `/api/v2/silence/{id}`；同步更新 §5.2 示例与说明、§7 边界表、§9.2 技术验收；v2 响应结构（裸数组/裸对象/`silenceID`）与 v1 不同，实现已按 v2 落地 | 5.2 / 7 / 9.2 | MVP | 设计中 |
| v1.7 | 2026-08-31 | 修改 | 决策 60 落版（alertmanager.yml 纳入 M09 变更确认）：①修订 v1.3「MVP 单域直接 reload、不进 M09」口径——`alertmanager.yml` 作为**管理域（`default`）scope** 配置产物进入 M09 `ConfigDraft → 人工确认 → 下发 → reload` 流水线，`change_status` 回写 M08；M08/M09 关系对齐 M01/M09（M08 内容 Owner、M09 管道 Owner）；②明确**不参与按网域扇出**（中心 Alertmanager 全局单例；仅 v0.4+ 边缘自治告警的边缘配置才按域下发）；③「低风险自动通过」降级为后续版本预留（M09 按配置类型风险分级），MVP 统一人工确认；④§1 范围说明、§3.1 功能表、§4 边界表（新增下发行）、§5.1 文件挂载契约、§6.6 版本留痕口径、§9.1/§9.2 验收同步；⑤决策 59 维持：MVP 交付形态仍为文件挂载（原型中的通用表单设计缺少业务流程支撑，不作为 MVP 依据），表单化 UI 仍归 v0.3 | 1 / 3.1 / 4 / 5.1 / 6.6 / 9 | MVP | 设计中 |
| v1.6 | 2026-08-31 | 新增 | 决策 59 落版（MVP 告警分发最小闭环 = 文件挂载 + 静默 UI）：①§1 新增「MVP 交付形态」——按操作频率拆分：低频一次性配置（接收人 / 路由 / 抑制）MVP 走文件挂载（整文件上传/粘贴 + `amtool check-config` 校验 + 版本留痕 + 直接 reload，与 M01 规则挂载决策 38-1 同构），表单化 UI 挪 v0.3；高频静默 MVP 提供极简 UI（API 直调，文件挂载承载不了运行时状态）；②§2 M08-OPS-01/02、§3.1 功能表同步形态标注；③§5.1 新增文件挂载契约（校验失败不落库不 reload、只读视图 + 历史版本回滚）；④§9.1 新增文件挂载验收与端到端告警链路验收（触发规则 → 路由 → Webhook 实际收到通知）、表单 UI 验收挪 v0.3；⑤§9.2 补挂载接口契约验收；解决 MVP 前台「采集配置 → 规则下发」之后告警分发无操作步骤的闭环断裂；原型待对齐 | 1 / 2 / 3.1 / 5.1 / 9 | MVP / v0.3 | 设计中 |
| v1.4 | 2026-08-31 | 新增 | 决策 49 落版（告警收敛与派发组件选型锁定）：§1 新增「组件选型决策」——锁定 Alertmanager，明确不引入 Grafana Alerting（规则/通知策略 DB 驱动、UI 管理，不兼容配置生成流水线）与夜莺（完整监控平台，引入即整体替换架构，规则同样 DB 驱动）；两者自带独立查询路径会绕开 M02 注入代理，构成租户隔离缺口；「Alertmanager 难用」的易用性诉求由 M08 UI 化管理承接；原型待对齐 | 模块目标 | 无版本变更 | 设计中 |
| v1.3 | 2026-08-15 | 重大修改 | M01/M08/M09 告警规则职责三轴重构：①模块名称由「告警规则管理」改为「告警收敛与通知管理」；②规则内容创作、规则记录、`rules.yml` 生成与下发全部剥离给 M01/M09；③M08 聚焦 Alertmanager 配置（路由/接收人/静默/抑制）、通知状态查询、告警抑制；④`alertmanager.yml` 由 M08 直接写文件并 reload，MVP 单域不进入 M09 配置变更确认；⑤重写 1/2/3/4/5/6/8/9/10/11 章节；⑥数据模型由 `AlertingRule`/`RuleGroup`/`RecordingRule` 改为 `Receiver`/`Route`/`Silence`/`InhibitionRule`/`AlertmanagerConfigVersion` | MVP / v0.3 / v1.0 | 设计中 |
| v1.2 | 2026-08-06 | 修改 | 版本对齐：告警状态查看（Prometheus `/api/v1/alerts`）由 M02 代理的启用版本统一标注为 v0.3；「5. 实现方式」章节标题及 5.1/5.2/5.3 内「MVP 阶段」统一改为 v0.3 交付；范围调整说明、边界说明、用户故事、3.1 功能表、8 依赖、9 验收标准同步标注 v0.3 | v0.3 / v1.0 | 设计中 |
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本（彼时仍为「告警规则管理」定位） | 全部 | draft |

---

## 补充对齐：2026-08-31（MVP 告警分发最小闭环 = 文件挂载 + 静默 UI，决策 59）

- **触发**：用户复盘 MVP 范围——前台已有采集规则与任务下发（M01/M09），但告警分发在前台没有任何操作步骤；告警触发后无处可去（Alertmanager 无 route/receiver），产品闭环在最后一环断裂。且 M08 PRD（功能表标 P0/MVP）与 Roadmap §1.5 矩阵（M08 MVP 列为「-」）存在不一致，需要拍板。
- **结论（决策 59）**：
  1. **MVP 必须纳入告警分发最小闭环**：监控 MVP 的最小价值闭环是「采得到 → 查得到 → 告得出」；缺通知渠道时用户配完规则后收不到任何告警，试点/演示场景第一印象崩塌，且 Alertmanager 能力（路由/静默/抑制）无法得到真实验证。
  2. **按操作频率拆分交付形态**：
     - **低频一次性配置（接收人 / 路由 / 抑制规则）**：MVP 走「**文件挂载**」——整文件上传/粘贴 `alertmanager.yml`，经 `amtool check-config` 等价校验 + `AlertmanagerConfigVersion` 版本留痕后直接 reload，与 M01 规则文件挂载（决策 38-1）同构；接收人 / 路由的**表单化 UI 挪 v0.3**。
     - **高频临时操作（静默）**：静默是 Alertmanager **运行时 API 状态**、文件挂载承载不了，MVP 提供**极简静默 UI**（创建 / 列表 / 删除，API 直调 Alertmanager）。
  3. **MVP 前台告警动线闭环**：「部署期挂载 `alertmanager.yml`（一次性）→ 日常静默管理（高频，UI）」，用户全程不碰 YAML 除非初始化。
  4. **不变项**：`alertmanager.yml` 由 M08 直接管理并 reload、MVP 单域不进 M09 变更确认（v1.3 决策不变）；告警状态页归属与授权过滤（决策 55/56）不变；组件选型锁定 Alertmanager（决策 49）不变。
- **版本归属**：MVP（文件挂载 + 静默极简 UI）；v0.3（接收人/路由表单化 UI、告警状态页、告警抑制引擎）；v1.0（通知模板、升级策略）。
- **影响范围**：Module_08 PRD v1.6（§1 MVP 交付形态说明、§2 用户故事、§3.1 功能表形态标注、§5.1 文件挂载契约、§9.1/§9.2 验收新增文件挂载与端到端告警链路条目）；Roadmap v2.0（§1.5 矩阵 M08 MVP 列补齐、§4.5 告警行同步）。
- **关联决策**：决策 49（Alertmanager 选型）、决策 38-1（M01 规则文件挂载同构模式）、决策 55/56（告警状态归属与授权过滤）。

---

## 补充对齐：2026-08-31（alertmanager.yml 纳入 M09 变更确认，决策 60）

- **触发**：用户评审决策 59 落版后指出架构纪律割裂——采集与规则配置走「M09 变更检测 → ConfigDraft → 人工确认 → 下发」，而 `alertmanager.yml` 按 v1.3 口径由 M08 直接写文件 reload、绕过 M09，导致配置中心看不到告警通知配置的变更单，审计断档、回滚口径不一、用户要学两套变更纪律。
- **结论（决策 60）**：
  1. **统一进 M09 变更确认**：`alertmanager.yml` 内容由 M08 生成（文件挂载 + `amtool check-config` 校验，决策 59 不变），提交后进入 M09 `ConfigDraft → 人工确认 → 下发 → reload` 流水线，`change_status` 回写 M08。M08/M09 关系对齐 M01/M09：**M08 是内容 Owner，M09 是变更确认与下发管道 Owner**。
  2. **网域维度：管理域 scope，不扇出**：中心 Alertmanager 是全局单例，`alertmanager.yml` 在 M09 中建模为**管理域（`default`）scope** 配置产物，变更单网域恒为 `default`；**不参与按网域拆分扇出**（决策 54 仅适用采集配置）、**不进入 `agent_pull` 配置包**。仅 v0.4+ 边缘自治告警的边缘本地 `alertmanager.yml` 才进入按域下发。
  3. **低风险自动通过（预留，不进 MVP）**：通知路由/接收人调整频繁、风险低；MVP 统一人工确认，后续版本由 M09 按配置类型风险分级，将告警配置降为低风险自动确认。
  4. **决策 59 维持不变**：MVP 交付形态仍为文件挂载 + 静默极简 UI；M08 原型中已有的通用表单化配置 UI 缺少业务流程支撑与确认，不作为 MVP 依据，表单化 UI 仍归 v0.3。
- **影响范围**：Module_08 PRD v1.7（§1 范围说明、§3.1 功能表、§4 边界表新增下发行、§5.1 文件挂载契约、§6.6 版本留痕口径、§9.1/§9.2 验收）；Module_09 PRD v1.52（§1 草稿与预览、§3.3 生成配置行、§3.4 审批分级策略、§3.11 配置产物形态、§6.5 边缘流程、§9.2 验收）；Roadmap v2.1（§1.5 矩阵 M08/M09 MVP 列）。
- **关联决策**：决策 59（文件挂载形态）、决策 49（Alertmanager 选型）、决策 38-1（M01 规则挂载同构）、决策 54（按域扇出——告警配置为例外）。

### 决策 60 补充块：跨模块跳转（M08 变更单号 → M09 详情深链），2026-09-10（决策 69-③）

> **定位**：决策 60 的**边界补充**，不新开编号、不修改决策 60 任何结论（尤其「M08 不驱动下发状态」的冻结口径）。

- **触发**：决策 69 讨论 M08 操作列路由时确认——挂载/重新挂载成功后，**pending 期间页面内没有任何入口**能跳到刚生成的那张变更单：引导只存在于一个数秒后消失的 message toast（`AlertConfigPage.tsx:70,99` → `navigate(CONFIG_PREVIEW_PATH)`），用户要自己去 M09 列表里翻。
- **排除的方案（2B）**：按 `change_status` 在操作列/状态列做**两态路由**（`pending` → 「前往配置确认」）。**不采纳**——它要求 `AlertConfigPage` 重新引入 `change_status` 依赖，直接触碰决策 60 的冻结口径（下发状态以 M09 为准、M08 不驱动）；且 M09 侧只有 `/config-preview` 一个路由（`App.tsx:94`），「跳到具体那一单」仍需新增 query/子路由，改动面远大于收益。
- **结论（决策 69-③）**：
  1. **列表侧**：`AlertConfigPage` 版本历史「M09 变更单」列的 `source_change_no` 由纯 `<Text code>` 渲染为**跳转链接** → `/config-preview?change_no=xxx`（`AlertConfigPage.tsx:148-154`）。该字段**已存在且已展示**，属**纯展示层增强**：不新增状态依赖、不新增路由、不触碰决策 60 语义。
  2. **落地侧**：`ConfigPreviewPage` 支持 `?change_no=` query 参数，挂载后自动调用既有的 `openDetail` 拉取并展开该变更单详情抽屉（`ConfigPreviewPage.tsx:144-168` 已有实现），**消费后立即清除参数**（`replace`），避免关闭抽屉或刷新时反复自动弹出。
  3. **约定复用**：`?change_no=` 是既有深链约定——`ConfigPreviewPage.tsx:712` 已用 `/deployments?change_no=...&network_domain=...` 跳转，`DeploymentsPage.tsx:54` 已把该约定写入注释。本次是**同一约定的反向使用**（M09 → M08 方向已有，本次补 M08 → M09 方向）。
  4. **「新增配置」场景同等覆盖**：挂载成功即生成变更单，`source_change_no` 随即有值，无需另设入口。
- **影响范围**：Module_08 PRD **待办**——§5 版本历史「M09 变更单」列表述由文本升级为链接（可随下一轮 PRD 增量登记）；Module_09 PRD 不修改（深链为既有约定）。
- **实现落点**：`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`（`source_change_no` 列 → `Link`）、`ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`（`useSearchParams` 消费 `change_no`）+ 两页测试。
- **关联决策**：决策 60（本补充块的母决策，结论不变）、决策 69（①② 属 M01 规则挂载交互重排，③ 为本补充块）、决策 59（文件挂载形态）、决策 45 系列（校验失败三态出口——本次仅补「正向动线」的入口，不改失败态动线）。

---

## 评审记录：2026-08-31（M08 PRD v1.7 两段评审 → ready 回归）

- **评审对象**：PRD v1.7（决策 49/55/56/59/60）+ 原型（用户外部模型优化版）。
- **评审报告**：`docs/05-execution-records/module-08/review-round1.md`，结论「有条件通过」。
- **阻塞项修复闭环**：①M09 跳转落点补 `#/config-preview`；②版本历史补「重新挂载此版本」入口（§9.1 P0 回滚动线）；③原型 package.json 0.1.0 → 1.7.0；④补 README.md（导航映射 + 模块边界 + 已知限制）。附带完成：校验失败 mock 补行号示例、告警状态页补授权过滤提示（决策 56 骨架）、M09 原型决策 60 口径对齐（变更单 draft-default-am-001 + 审批分级文案）、原型门户 index.html M08 条目更名。
- **遗留（不阻塞）**：M09 抽屉多文件预览 Tab 不含 alertmanager.yml 内容预览（ConfigDraft 模型无字段，后续版本评估）；ConfigPage Alert 计数超阈为既有结构债；M09 mocks 存量测试断言已顺手修正（draft-finance-002 pending）。
- **PRD 内部待澄清（已闭环，2026-09-02）**：§9.2「校验失败不落库」与 §6.6「留痕含校验结果 + status=failed」的口径张力源于 v1.6 旧版 §6.6；PRD v1.7 已将 §6.6 说明 1 修订为「校验失败不落库、`status` 恒 `applied`、不存 `error_msg`」，与 §9.2 / 契约快照一致，无需再统一。失败留痕由 M09 管道侧承担（`ConfigDraft.validation_status=failed` + `validation_cause/details`，决策 45），M08 内容表不重复。原型 mock 已对齐（`acv-*` 均为 `applied`），README 旧措辞本次一并订正。
- **状态变更**：M08 PRD `设计中` → `ready`（用户授权两段评审通过后回归，2026-08-31）。

---

## 分轨判定记录：2026-09-08（告警状态展示 MVP 提前，PRD v1.12）

- **需求**：「告警状态」展示功能 MVP 版本——告警状态页（M08 归属，菜单「告警收敛与通知管理 → 告警状态」）双视图：Prometheus 当前触发告警（firing/pending，经 M02 代理 `/api/v1/alerts`，v1.12 同步提前）+ Alertmanager 通知状态（active/silenced/inhibited/unprocessed，M08 代理 AM `/api/v2/alerts`），支持按 `network_domain` 筛选。
- **触发**：MVP 试用反馈「前台缺少查看当前告警入口」（PRD v1.12 Change Log），用户在设计空间将 PRD 直接推进至 ready（v1.12）并明确开工指令。
- **五问判定**：
  1. 模式成熟度：告警列表双视图为行业成熟模式（Prometheus/Alertmanager 原生 UI 即此形态）→ 偏 B。
  2. 交互范式：无新概念，标准表格 + Tab + 筛选即可承载；原型 `docs/prototypes/module-08/src/pages/AlertStatusPage.tsx` 既有资产已含该页（v1.7 评审遗留「告警状态页补授权过滤提示」已闭环）→ 偏 B。
  3. 契约影响面：不推翻已落版决策（49/55/56/59/60/61 均维持）；新增 M02 侧 `/api/v1/alerts` 代理与 M08 侧 AM `/api/v2/alerts` 代理两条**新增只读 API**，不改既有契约 → 单模块内闭环。
  4. 安全风险：读路径涉及决策 56 授权过滤骨架（服务端强制注入授权网域集合 filter，MVP 单租户恒通过）——**命中第 4 问（鉴权敏感面）→ 升级 B+，强制挂 security-reviewer**。
  5. 可表达性：能——字段表（Prometheus Alert / AM GettableAlert 子集）+ 接口清单（2 条只读代理）+ 验收清单（PRD §9.1/§9.2 已有对应条目）一页可表达。
- **最终轨道**：**Track B+**（轻量增量直派开发 + 强制 security-reviewer）。PRD 已由用户推进至 `ready` v1.12（完整骨架 + 既有原型资产），不走 dev-ready 豁免路径；本记录替代「免原型」豁免登记——原型资产在 v1.7 评审中已覆盖该页，无需补做。
- **用户确认**：2026-09-08，用户在开发空间 feat/module-08-alert-dispatch 直接下达「根据 PRD 要求进行告警状态展示功能 MVP 开发」指令，视为书面确认。
- **审查要求**：本轮收尾必须挂 security-reviewer（决策 56 授权过滤骨架 + 代理 SSRF 面核查）。

---

## 分轨判定记录：2026-09-09（历史告警 MVP 增量，PRD v1.13）

- **需求**：用户 MVP 试用反馈「机器恢复了，页面还在触发中，我想看到它什么时候恢复」——需要在 MVP 提供规则级告警历史（含已恢复），消除「当前触发」列表在告警恢复后记录消失造成的认知断层。
- **五问判定**：
  1. 模式成熟度：告警历史列表为行业成熟模式（Prometheus `ALERTS` 序列重建 / Grafana Alerting history 同构）→ 偏 B。
  2. 交互范式：无新概念，标准表格 + 筛选 + 时间范围即可承载 → 偏 B。
  3. 契约影响面：不推翻已落版决策（49/55/56/59/60/61 均维持）；新增 M02 侧 `/api/v1/alerts/history` 一条**新增只读 API**，M08 只读消费 → 跨模块契约清晰。
  4. 安全风险：读路径涉及决策 56 授权过滤（服务端强制注入授权网域集合，MVP 单租户恒通过）——命中鉴权敏感面 → 升级 B+，强制挂 security-reviewer。
  5. 可表达性：能——字段表（PRD §5.4 对应 M02）+ 接口清单（1 条只读 API）+ 验收清单（§9.1/§9.2 新增条目）一页可表达。
- **最终轨道**：**Track B+**（轻量增量直派开发 + 强制 security-reviewer）；免高保真原型（列表 + 筛选为标准 Ant Design 模式，参照告警状态页既有资产）。
- **关键决策**：
  1. **数据源选型（方案 B）**：基于 Prometheus `ALERTS{alertstate="firing"}` 时间序列 `query_range` 重建触发/恢复区间。理由：不依赖 Alertmanager 是否配置、与「Prometheus 当前触发告警」语义一致（同为规则求值视角）、复用 M02 查询代理链路、不新增存储。被否方案：①Alertmanager `/api/v2/alerts?active=false`——AM 内存态非持久历史，且当前部署未配置 `alerting.alertmanagers` 时完全无数据；②AM Webhook + SQLite 事件表——是完整「通知历史」的正确形态，但涉及新增接收端点、表结构与 AM 配置变更，超出本次 MVP 增量，列为后续版本候选。
  2. **入口形态**：独立页面「历史告警」（菜单「告警收敛与通知管理 → 历史告警」），**不做成告警状态页第三个 Tab**——用户已反馈 AM 通知状态与 Prometheus 触发告警两视图语义差异大，历史视图再并入会加剧混淆。
  3. **恢复时间口径**：`resolved_at` 为 Prometheus 求值视角近似值（最后一个 firing 样本时间 + 一个求值步长），UI 列名必须为「恢复时间（按 Prometheus 求值）」，不得表述为「故障恢复时间」；历史深度受 Prometheus TSDB 保留策略限制，页面需提示。
  4. **MVP 范围**：列表 + 筛选（网域/告警名/实例/状态/时间范围）+ 手动刷新；默认时间窗 24h、最大 7d。排除：告警确认/评论/认领、长期归档、通知发送历史（谁收到、成功失败）。
- **用户确认**：2026-09-09，用户在开发空间 `feat/module-09-config-center` 书面确认（「做成独立『历史告警』页面」「我同意可以在当前分支让 prototype-designer 出 PRD 增量（M08 v1.13 + M02 v1.13）」）。
- **影响范围**：Module_08 PRD v1.13（§1 目标 3、§2 M08-OPS-08、§3.1 功能表、§5.4、§9.1/§9.2、§10）；Module_02 PRD v1.13；全局用户故事库 `01_User_Stories.md` §4.8 新增 M08-OPS-08。
- **关联决策**：决策 55/56（告警状态归属与授权过滤）；M09 规则 job 引用校验口径（`up`/`absent(up)` 规则 job 不匹配 = error、其他 job 引用不匹配 = warning，用户 2026-09-09 确认，M09 PRD 增量另行落版）。

---

## 补充对齐：2026-09-11（告警实例列对齐 M01 资源清单，决策 70）

- **触发**：用户提问「M08 中历史告警和状态告警中的实例字段代表的是实例名还是实例的 IP+端口？建议与 M01 资源管理字段对齐，方便用户理解」。实测确认：M08「实例」= Prometheus `instance` 标签 = file_sd `targets[]` = `generator.instanceAddress(ip, exporterPort)`（`platform/configcenter/generator/targets.go:119`），即 **`ip:exporter端口`**（host/database/middleware 默认 `:9100`），**既不是实例名，端口也不是用户在 M01 里填的业务端口**。M01 里 MySQL 写 `10.0.0.1:3306`，M08 同一台机显示 `10.0.0.1:9100` —— 用户会当成两个东西；`:9100` 是从未填写过的采集器端口，会被误读为「监控配错了端口」。
- **方案评估（A / B / C 三选）**：
  - **A（采纳·主）：后端按 `resource_id` 回连 M01 回填实例名。** 钥匙已经存在——`resource_id` 由决策 47-3 强制注入为 system 层标签（`targets.go:167`、模板不可覆盖；本地实证 `config-output/targets/ceshi.json` 含该标签），而 M08 契约全文 `resource_id` **零引用**。A 是**唯一能覆盖存量告警**的方案（无需重新下发），且与 M01 改名**实时一致**；代价是三条 API + 契约要改、每次列表多一次批量 DB 查询（禁 N+1）。
  - **B（不单独采纳）：仅前端拆列 / 加 tooltip。** 零后端风险但**没解决用户诉求**（仍看不到实例名），且端口语义错位反而更醒目。仅采纳其「统一两个 Tab 口径」的副产品（现状 AM Tab 裸读 `instance` 无回落、Prom Tab 走回落链，本身不一致）。
  - **C（降为三期、范围收窄）：让标签真正带上 `instance_name`。** 这是**规格回归**——M07 PRD §5.12 A 明文写「通用 `instance_name → instance_name`，host 模板必填」，而 `DefaultMappingBuilders`（`platform/models/label_template.go:38-62`）从未实现该映射。**二轮修订（用户更正）**：原以「平台外可读性」（告警通知正文 / AM 原生 UI / Grafana 三条出口）论证 C 的必要性，**该论据撤回**——这三条通道由平台在 v0.2 统一完善，不存在「平台无法介入渲染」的前提。C 因此改为逐资源类型评估必要性，**范围收窄到 4 类静态资源**（host / database / middleware / generic_target）；**application 不加**（默认模板已有 `service_name → service_name`，再加是同义重复）、**拨测 URL 不加**（blackbox 生态口径本就要求把 `__param_target` relabel 成 `instance`，URL 自描述且 `BlackboxTarget` 无名称字段、`TargetGroup.Labels` 是空 map）、**容器不加**（Roadmap v0.2 明文「每虚机一个 exporter，平台不感知容器个体」；v0.3 K8s SD 的可读性由生态既有标签 `pod`/`namespace`/`container`/`node` 承担）。C 的剩余价值：①规格收口（PRD 写了要么实现要么改 PRD，不能悬空）；②历史留存（A 是实时回连，资源被删后查不到；标签值已固化进时序）；③v0.3 门户 PromQL 查询页 `by(instance_name)` 可读。
- **结论（决策 70）**：
  1. **主方案 A（本版落地）**：三条告警读取链路（M02 `/api/v1/alerts`、M02 `/api/v1/alerts/history`、M08 `/api/v2/platform/alertmanager/alerts`）由服务端按标签 `resource_id` **一次性批量**回连 M01 五类资源表，回填 `resource_id` / `resource_name` / `resource_category` / `resource_ip` / `resource_port` / `instance_address` 六个新增字段（**不删旧字段**，向后兼容）；`instance_display` 语义修订为「`resource_name` 非空取之，否则取 `instance_address`」。回连为**只读**跨表查询（与 M02 coverage 按 `resource_id` 读五表同族，不算开新口子）。
  2. **列形态：拆两列（非双行）**。「实例名」+「采集地址」两列，与 M01 各 Tab 的「名称列 + 地址列」多列结构**真同构**（M01 host/database/middleware/application/generic_target 五个 Tab 均为多列）；「双行」只对上了 M01 host 的**列内**写法，属局部同构。两列可分别排序 / 筛选，信息最全；代价是横向增宽约 150px（历史告警表固定列已 ≈1070px，须保留横向滚动）。
  3. **「采集地址」表头必须挂 tooltip「采集器地址，非业务端口」** —— 直接消解 `:9100` 的误导，这是本决策的成本最低、收益最直接的一环。
  4. **无 `resource_id` 时「实例名」显示 `-`，不回落成地址**：回落会让两列同值，复刻旧毛病。必须保留的例外：①blackbox Job 的 target 组 `Labels` 为空 map；②聚合 / 全局规则（`sum(...) by (...)` 抹掉 `instance` 与 `resource_id`）；③非 M01 来源的自写规则。
  5. **历史告警「实例」筛选同时匹配实例名与采集地址**：展示改造后若只匹配地址，用户看到 `ceshi` 却搜不到。
  6. **不做「点击实例跳 M01 资源详情」**（用户 2026-09-11 明确：没必要）。
  7. **不改 `instance` 标签本身的取值**：它是 Prometheus 标准语义，且中心 `alertmanager.yml` 的 `group_by: ['alertname','instance']`（分组）与 `equal: ['instance']`（抑制）直接依赖，改成可读名会连带破坏告警分组与抑制。因此「可读化」只能走**平行标签**（即三期 C）——这也是 C 严格限定开放范围的原因。
  8. **三期 C 范围收窄**（不阻塞本版）：`DefaultMappingBuilders` 仅对 4 类静态资源补 `instance_name → instance_name`（host 取 `InstanceName`、database/middleware 取 `InstanceIP`（模型无 `instance_name` 列，按 M07 §5.12 展示口径即取 IP）、generic_target 取 `TargetName`），`resolveResource` 字段视图同步补充；回落链同步扩项。交付判据：重新下发后 `targets/*.json` 的 4 类静态资源出现 `instance_name` 标签，application 产物**不出现**该标签。
- **顺带修复的 3 处既有偏差（同批修，用户拍板）**：修完后 M01 与 M08 的实例相关列收敛为同一结构（名称列 + 地址列），用户只适应一次。
  1. **M01 database / middleware Tab「实例名」列恒显示 `-`**：列绑 `instance_name`，但 `buildListItem`（`platform/config/resource/list.go:152-161`）对 Database / Middleware **不产出该键**，模型本身亦无 `instance_name` 字段 → 按 M07 §5.12 展示口径改绑 `instance_ip`（根因是模型无名称字段，故该列与相邻「IP 地址」列同值；已在 `dev-feedback.md` 留痕，供 PRD 后续迭代决定该列是否改为其他语义）。
  2. **M01 host Tab 副行重复显示同一值**：主行 `instance_name`、副行 `hostname`，而 `hostname` 即 `InstanceName`（`host.go`）→ 渲染为 `ceshi` / `ceshi` 两行同值。**直接删除副行**（host Tab 已有独立「IP 地址」列，副行无信息增量）；改完 host Tab 的实例名列只剩主行，与 M08「实例名」列逐字对应。
  3. **`instanceDisplayOf` 回落链含死键、漏真键**：`hostname` 是死键（默认标签模板从不产出；注意 M07 PRD §5.2 字段说明写「生成 `hostname` label」与 §5.12 A 写「生成 `instance_name` label」**自相矛盾**，本次以 §5.12 A 为准并已在 M07 PRD 修正该矛盾），`service_name`（application 实际产出）未纳入 → 修订为 `instance_name → instance → instance_ip → service_name → nodename → device`。**该处与三期 C 共用同一段代码，必须一起改**，否则 C 生效后回落链仍读不到新标签。
- **实现落点**：`platform/query/`（新增 M01 资源身份批量解析器 + `alerts.go` / `alerts_history.go`）、`platform/alertmanager/alerts/`（`service.go` / `handler.go` / `register.go` 需接入 `*gorm.DB`）、前端 `ui-custom/web/src/types/alertmanager.ts`、`pages/alerts/AlertStatusPage.tsx`（两个 Tab）、`pages/alerts/HistoryAlertsPage.tsx`、`pages/resources/ResourcesPage.tsx`。
- **影响范围**：Module_08 PRD v1.15（§1 目标 3、§3.1 功能表、§5.4、§9.1/§9.2、§10）；M08 `api-contract-snapshot.md` §10.1/§10.2/§10.3；Module_07 PRD §5.12 A 括注与 §5.2 矛盾修正；M02 契约快照交叉登记；M08 `dev-feedback.md`（M01 三处偏差）。
- **关联决策**：决策 47-3（`resource_id` 强制注入，本方案的回连钥匙）、决策 55/56（告警状态归属与授权过滤，不受影响）、决策 60（M08 不驱动下发状态，冻结口径不变——本决策只改展示层与只读回连）、决策 68-2（投递接线，本决策不改）、M07 §5.12 A / §5.13（标签映射权威口径）。
- **用户确认**：2026-09-11，用户在开发空间 `feat/module-08-alert-dispatch` 书面确认「我同意这个方案，请你完善到 M08 的 PRD 和 decision 等，然后进行代码开发工作」。

---

## 补充对齐：2026-09-11（静默 matcher 编写口径：可匹配标签四层并集 + 分组联想 + 实例级静默，决策 71）

- **触发**：用户试用发现创建静默抽屉「点击匹配条件无任何内容」（前端渲染死锁，见 dev-feedback 第 10 条）后连续追问：①可匹配的告警标签是否 = 当前所有已生效模板的集合？②是否还有其他来源？③能否做成便于用户筛选的框？④匹配条件除告警标签层外，是否允许到实例层？诊断确认根因后用户拍板「先落档 decision + PRD，然后修改代码」。
- **可匹配标签的精确口径（四层并集）**：AM 静默 matcher 匹配的是 **AM 收到告警时携带的标签全集**，逐层如下——
  1. **目标层（file_sd target labels，`configcenter/generator/targets.go` + `labels.go`）**：system 层 `resource_id`（决策 47-3 强制注入，不挂模板也在、模板不可覆盖）∪ **被 `enabled + draft_status=ready` 的 ScrapeJob（`data_source.go:44`）实际引用的标签模板中 enabled mappings** 展开的键（`instance`=composite `instance_ip:port`、`app`/`biz`/`env`/`cluster`/`service_name`/`health_check_url` 等；模板解析口径同 `LoadTemplateForJob`：显式挂载 → 类别默认模板）∪ Prometheus 自动附加的 `job`。**不是「所有已生效模板的集合」**——LabelTemplate 无独立状态字段（`label_template.go:28-34`），模板的「生效」是间接的（被生效 Job 引用且该网域配置已下发）；未被引用 / 未下发模板的键不可匹配。
  2. **采集机制层**：`job`（Prometheus job_name 自动附加）、`alertname`（规则求值自动附加）。
  3. **规则层（rules.yml labels）**：`severity` 及规则编辑自定义标签（`MonitoringRule.Labels` 自由 map；`enabled + draft_status=ready + scope central/both`，同 `LoadRules` 口径）。
  4. **external_labels（发往 AM 出口附加，upstream notifier `relabelAlerts`）**：`network_domain_id` / `zone_type`（M09 决策 19 键名，**不是** `network_domain`——M02 决策 4.4 消费键收敛未完成，键名双读口径见 `platform/models/network_domain_label.go`）。⚠️ 此层在 Prom `/api/v1/alerts`（ALERTS 序列）中**不可见**，但 AM 收到的告警携带 → **AM 静默可以按网域匹配，键为 `network_domain_id`**。
  - **例外**：blackbox Job 的 `TargetGroup.Labels` 为空 map（`targets.go:148`）→ 拨测类告警无目标层标签，仅规则层 + external 可匹配。
- **结论（决策 71）**：
  1. **标签名分组联想框（方案 A，采纳）**：新增只读聚合端点 `GET /api/v2/platform/alertmanager/silences/label-options`，服务端按上述四层口径聚合返回 `groups: [{source, label, items: [{name, description}]}]`（target_system / template / rule / external 四组，与口径逐层对应）；前端 matcher 标签名用按来源分组的 AutoComplete。被否方案：活跃告警实况聚合（当前无告警时选项为空，仅保留作后续「值联想」增量）；Prom `/api/v1/labels` 全 series 代理（含全部 metric 维度标签，噪声远大于告警标签集）。
  2. **正则预检**：`is_regex=true` 时前端以 `new RegExp(value)` 预校验（AM 侧 400 兜底保留）——正则非法属于「提交即失败」的低成本拦截，而「正则合法但永不匹配」靠联想框描述软引导，不做硬校验。
  3. **实例级静默：已天然支持，补 UX 一等入口**。`instance` / `resource_id` 均在标签全集内，matcher 直写即实例级，**无需新匹配机制**。UX 提供「按实例选择」：复用 M01 资源列表 API（`GET /api/v2/platform/resources`，keyword 搜索），选中后自动生成 **`resource_id` matcher**（UUID 稳定、不随 IP / 端口变化，与决策 70 实例名回连展示同源）；直接手填 `instance` 有「值 = ip:exporter端口，填业务端口 → 静默空集」陷阱（决策 70），表单对该键给出提示。
  4. **多 matcher AND 语义提示**：同一静默内多条 matcher 为 AND 关系，表单明示（`alertname + resource_id` = 静默某实例的某类告警；单 `resource_id` = 静默该实例全部告警）。
  5. **渲染死锁修复（F-26，本决策的前置 bug）**：`CreateSilenceDrawer` 原用 `Form.useWatch('matchers', form) || []` 驱动行渲染，而 rc-field-form `useWatch` 内部经 `getFieldsValue()` 取值（**只返回已挂载 Field 路径上的值**，`useForm.js` `cloneByNamePathList`）→ 行不渲染 → `['matchers', i, ...]` Field 永不挂载 → watch 恒空 → 点「添加」写 store 也不触发 re-render，永久卡死。改用 antd **`Form.List`** 官方动态行动线；顺带修复模块层 `initialValues`（含 `dayjs()`）冻结导致默认起止时间随 SPA 停留漂移的问题（移入组件内每次挂载重建）。
  6. **不做**：matcher 标签名硬校验（拼错键静默空集靠联想框 + 描述软引导，不阻塞——自定义键属合法能力）；方案 B 值联想暂缓，列为后续增量。
- **实现落点**：后端 `platform/alertmanager/silence/label_options.go`（聚合）+ `handler.go`（Handler）+ `register.go`（路由，只读挂根组）；前端 `ui-custom/web/src/api/alertmanager.ts`、`pages/alerts/CreateSilenceDrawer.tsx`；契约快照 §4 / §4 Matcher 小节；M08 PRD v1.16 §5.2。
- **影响范围**：Module_08 PRD v1.16（§5.2、§6.5、§9.1、§9.2、§10）；`api-contract-snapshot.md` §4 / §8；`dev-feedback.md` 第 10 条。
- **关联决策**：决策 47-3（resource_id 强制注入，实例级静默的钥匙）、决策 55/56（静默授权收敛，不变）、决策 59（静默 API 直调即时生效，不变）、决策 61（v2 API 口径，不变）、决策 70（instance 取值口径与 resource_id 实例名回连，实例选择器同源）、M02 决策 4.4 / M09 决策 19（网域键名双读，未收敛）。
- **用户确认**：2026-09-11，用户在开发空间 `feat/module-08-alert-dispatch` 书面确认「我同意可以，先把我这个需求落档 M08 的 decision（详细记录可匹配标签的精确口径是四层并集）和 prd，然后开始修改代码」。
