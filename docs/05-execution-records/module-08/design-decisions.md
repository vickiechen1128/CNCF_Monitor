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

## Change Log（完整历史）

> v1.5 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.4 及以前的逐版完整变更详情（业务沟通决策记录）。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
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

---

## 评审记录：2026-08-31（M08 PRD v1.7 两段评审 → ready 回归）

- **评审对象**：PRD v1.7（决策 49/55/56/59/60）+ 原型（用户外部模型优化版）。
- **评审报告**：`docs/05-execution-records/module-08/review-round1.md`，结论「有条件通过」。
- **阻塞项修复闭环**：①M09 跳转落点补 `#/config-preview`；②版本历史补「重新挂载此版本」入口（§9.1 P0 回滚动线）；③原型 package.json 0.1.0 → 1.7.0；④补 README.md（导航映射 + 模块边界 + 已知限制）。附带完成：校验失败 mock 补行号示例、告警状态页补授权过滤提示（决策 56 骨架）、M09 原型决策 60 口径对齐（变更单 draft-default-am-001 + 审批分级文案）、原型门户 index.html M08 条目更名。
- **遗留（不阻塞）**：M09 抽屉多文件预览 Tab 不含 alertmanager.yml 内容预览（ConfigDraft 模型无字段，后续版本评估）；ConfigPage Alert 计数超阈为既有结构债；M09 mocks 存量测试断言已顺手修正（draft-finance-002 pending）。
- **PRD 内部待澄清（已闭环，2026-09-02）**：§9.2「校验失败不落库」与 §6.6「留痕含校验结果 + status=failed」的口径张力源于 v1.6 旧版 §6.6；PRD v1.7 已将 §6.6 说明 1 修订为「校验失败不落库、`status` 恒 `applied`、不存 `error_msg`」，与 §9.2 / 契约快照一致，无需再统一。失败留痕由 M09 管道侧承担（`ConfigDraft.validation_status=failed` + `validation_cause/details`，决策 45），M08 内容表不重复。原型 mock 已对齐（`acv-*` 均为 `applied`），README 旧措辞本次一并订正。
- **状态变更**：M08 PRD `设计中` → `ready`（用户授权两段评审通过后回归，2026-08-31）。
