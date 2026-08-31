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

> v1.5 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.2 及以前的逐版完整变更详情（业务沟通决策记录）。

| 版本 | 日期 | 变更类型 | 变更内容 | 产品版本影响 | 状态 |
|------|------|----------|----------|--------------|------|
| v1.2 | 2026-08-06 | 修改 | 版本对齐：告警状态查看（Prometheus `/api/v1/alerts`）由 M02 代理的启用版本统一标注为 v0.3；「5. 实现方式」章节标题及 5.1/5.2/5.3 内「MVP 阶段」统一改为 v0.3 交付；范围调整说明、边界说明、用户故事、3.1 功能表、8 依赖、9 验收标准同步标注 v0.3 | v0.3 / v1.0 | 设计中 |
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本（彼时仍为「告警规则管理」定位） | 全部 | draft |
