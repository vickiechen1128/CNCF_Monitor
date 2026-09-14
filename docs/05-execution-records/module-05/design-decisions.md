# 设计决策记录：module-05

## 会议/对齐信息

- 日期：2026-08-02
- 参与 Agent：prototype-designer、orchestrator
- 触发原因：基于现有 PRD 生成可点击原型并验证设计理解

## 关键决策

### 决策 1：原型风格与呈现方式

- 问题：原型采用何种视觉风格以便领导/业务方快速理解产品形态？
- 结论：采用火山引擎 Volcengine 设计 Token（主色 #0ECDEB、头部 #0B1B2A）作为原型风格，保持企业级云产品观感。
- 依据：用户需求 / 火山引擎品牌色参考
- 影响范围：docs/prototypes/module-05/ 全部页面

### 决策 2：模块原型独立拆分

- 问题：全模块统一原型还是按模块独立原型？
- 结论：按 prototype-designer 规范，每个模块产出独立的 Vite + React 原型项目，便于后续按模块评审、冻结与开发。
- 依据：`.kimi/agents/prototype-designer.md` 目录规则
- 影响范围：docs/prototypes/module-01/ ~ module-10/

### 决策 3：当前 PRD 范围确认

- 问题：当前 PRD 是否足以支撑原型验证？
- 结论：PRD v1.0 已覆盖本模块核心数据模型、页面与 MVP 边界，原型按 PRD 实现，未发现 [待验证] 技术缺口。
- 依据：docs/02-product-requirements/Modules/Module_05_Custom_UI.md
- 影响范围：原型页面范围

## 待确认项

- [ ] 领导评审后对页面信息架构的反馈
- [ ] 是否需要针对 MVP 范围进一步裁剪页面字段

## 关联文档

- `docs/02-product-requirements/Modules/Module_05_Custom_UI.md`
- `docs/prototypes/module-05/`

---

## 补充对齐：2026-08-31（Grafana 集成三层归属与用户自由度边界，决策 51）

- **触发**：MVP 收口评估确认「可视化大屏」缺口走 Grafana iframe 嵌入（决策 50，全文见 module-02 design-decisions）；需明确嵌入能力的模块归属与控制面边界。
- **结论（决策 51）**：Grafana 集成按三层归属——
  1. **M05（本模块）**：门户嵌入入口（「监控大屏」页 iframe）、新用户引导操作指南（登记网域 → 导入资源 → 建采集 Job → 下发 → 查指标）、预置仪表盘模板展示与「配置告警」深链回 M08；首页轻量实时图表用 ECharts/AntV 消费 M02 `query_range`；
  2. **一体化交付包**：Grafana 自身配置（datasource 指向 M02 查询代理、anonymous/auth、provisioning 目录、预置模板文件）安装期静态下发，不进运行态模块；
  3. **M11 预留**：Dashboard-as-Code 治理（API 管 dashboard、版本化、按租户分发）v0.4+ 评估，v0.3 不实现。
- **自由度边界**：控制面只守两条线——数据源红线（必须指向 M02 代理，禁止直连 Prometheus）不可改；预置模板只读（升级覆盖，用户克隆后自由编辑）。不锁 Grafana UI，用户自建业务面板完全自由。
- **版面引导**：预置模板按平台治理标签组织下钻层级——网域（`network_domain`）→ 业务（`biz`）→ 应用（`app`）→ 实例（`resource_id`/`instance`），dashboard variables 的 `label_values()` 查询走 M02 代理。
- **告警不引向 Grafana**：告警规则与通知配置由 M01/M08/M09 承接（决策 49，全文见 module-08 design-decisions），大屏页提供深链衔接动线。
- **影响范围**：Module_05 PRD v1.2（§1 / §3 / §3.1 新增交互契约 / §4 / §6）；Module_02 PRD v1.6（可视化边界三层归属交叉引用）。
- **关联决策**：决策 50（可视化方案收敛）；决策 52（网域「消费隐藏」——看板默认不感知网域）。

---

## 决策登记：2026-09-14（首页 MVP 子集提前，决策 72）

- **触发**：用户要求在 MVP 完善首页——系统快速入口、使用指引、告警状态数字；明确不做可视化大屏（v0.3 豁免大屏快捷入口）。DeepSeek 方案经 Orchestrator 事实核查修正后确认（核查要点：决策 68-2 已落地，`alerting:` 段在 AM 配置挂载后自动生成，「AM 通知数字恒为 0」风险已消除，残余前置条件转化为空态引导）。
- **结论（决策 72）**：
  1. **首页 MVP 子集提前**：原决策 51 首页（概览 Dashboard + 新用户引导，P1/v0.3）拆为两阶段——MVP 交付「系统快速入口 + 使用指引（五步开箱动线）+ 告警状态数字」，保留既有平台统计卡与最近下发表；轻量实时图表 / 采集覆盖率卡片 / 「进入可视化大屏」快捷入口豁免至 v0.3。
  2. **告警数字实现路径（方案 A）**：前端直调既有只读接口取数组长度计数（`GET /api/v1/alerts`、`GET /api/v2/platform/alertmanager/alerts`，均无分页，`alertStatusApi` 已封装），**零后端改动**；`platform/dashboard/summary` 保持纯 GORM 聚合单一职责，不引入 Prometheus 代理调用（否决方案 B）。
  3. **数字口径**：主数字 = AM 治理态「通知中」（红色语义），次要行 = 已静默 / 已抑制，Prom firing/pending 并列小字——治理层是用户主视图；未挂载 AM 通知配置时数字为 0，卡片展示「尚未挂载通知配置，去配置 →」空态引导（决策 68-2 前置条件的产品化承接）。
  4. **配套项**：`QueryPage` 挂入 `/query` 路由，使用指引第 5 步「查指标」深链落地（否决暂指 `/targets`——targets 是排障入口而非查询入口）。
  5. **联动预留**：若后续采纳「告警中心（治理视图） vs 触发排障」拆菜单方案，首页告警卡跳转目标指向治理视图，设计提案层对齐避免二次改动。
- **影响范围**：Module_05 PRD v1.3（头部 / §1 / §3 首页行 / §3.1 新增交互契约 / §6 验收）；前端 HomePage 重构 + App.tsx 挂 `/query` 路由 + HomePage.test.tsx 同步；`02_Product_Roadmap.md` §1.5 M05 行 MVP 列同步。
- **关联决策**：决策 51（可视化三层归属与大屏导航，v0.3 部分不变）；决策 68-2（Prometheus→AM 投递接线，空态引导的依据）。
- **用户确认**：2026-09-14 用户拍板「按修正后口径执行——方案 A + AM 治理态作主数字（带空态引导）+ 顺手挂 /query 路由」。

---

## Track B 豁免记录（M05 首页 MVP 子集 v1.3）

- **分轨判定**：本模块首页 MVP 子集为 **Track B**（轻量规格直派开发）。
  - 五问结论：① 有成熟模式（统计卡 / 快捷入口 / 步骤指引 / 数字徽章为后台系统通用模式）；② 无新交互范式（Ant Design 标准组件即可承载）；③ 不推翻已落版契约（仅新增首页内部动线，不影响模块间 API/数据模型）；④ 不涉及认证/鉴权/密钥等安全敏感面（只读消费既有告警接口）；⑤ 可用一页「字段表 + 接口清单 + 验收清单」表达。
  - 豁免项：高保真原型验证；MVP 阶段可免原型对齐，以 PRD §3.1 交互契约 + §6 验收清单为开发基准。
- **用户书面确认**：2026-09-14，用户原话「我想直派开发，需按 Track B 走书面确认 + 豁免记录，可派 plan-maintainer 派生 L2/L3」——视为对 Track B 分轨、原型豁免、直接进入 L2/L3 派生的书面确认。
- **状态变更**：Module_05 PRD 由 `设计中` 推进为 `dev-ready`（Track B 增量 v1.3）。
- **落版约束**：开发验收通过后，需按 Track B 回填要求把 PRD 反向同步为 as-built，状态补登 `ready`；原型对齐顺延至 v0.3 可视化增强阶段前完成。

---

## 决策登记：2026-09-14（首页 MVP 子集设计补丁，决策 72-1 / 72-2）

- **触发**：产品负责人在 `feat/module-05-homepage-mvp` 代码审查后提出三点设计意见（详见 `dev-feedback.md` 与 `design-proposals/homepage-mvp-feedback-design-opinion.md`），并书面确认采用设计意见。
- **结论（决策 72-1，指引与查询页）**：
  1. 使用指引由五步扩展为六步开箱动线：登记网域 → 导入资源 → 建采集 Job → 下发 → **配置告警通知** → 查指标/看告警；第 5 步深链 `/alert-config`，第 6 步深链 `/query` 或 `/alert-status`。
  2. `QueryPage` 采用**自定义轻量实现**：PromQL 输入框 + 结果表格/JSON，调用 M02 `/api/v1/query` 代理接口；**禁止复用 Prometheus UI**（iframe 会绕过 M02 查询代理、破坏租户/网域注入；抽取组件成本过高且违反 upstream 隔离）。
- **结论（决策 72-2，视觉与信息架构）**：
  1. 首页页面结构调整为：标题区 → 关键指标卡网格（2×3）→ 告警治理态大卡片（左侧约 40%）+ 系统快速入口/最近下发（右侧）→ 六步使用指引区。
  2. 视觉 Token 规范：色彩收敛（品牌青 `#0ECDEB` 仅用于主按钮/关键图标/链接；功能色仅用于状态语义）、卡片圆角 8px、统一阴影与间距、字体层级、图标尺寸统一（快捷入口 40px / 指标卡 32px）。
- **用户确认**：2026-09-14 用户书面确认——「1.我同意 2.推荐在 QueryPage.tsx 内实现最小自定义 PromQL 查询页 3. 我同意采用 4.直接按意见让前端调整样式，同样不要做全量测试以节约token」。
- **影响范围**：Module_05 PRD v1.4（头部 / §1 / §3 首页行 / §3.1 交互契约 / §6 验收）；前端 `feat/module-05-homepage-mvp` 样式与结构精修 + QueryPage 最小实现；原型对齐顺延。
- **关联文档**：`dev-feedback.md`、`design-proposals/homepage-mvp-feedback-design-opinion.md`。

---

## 决策登记：2026-09-14（首页内容重构 as-built 回填，决策 72-3）

- **触发**：产品负责人对 `feat/module-05-homepage-mvp` 首页实现的第二、三轮设计评审（详见 `dev-feedback.md` 与 `design-proposals/homepage-mvp-content-restructure.md`），代码落地后回填 PRD v1.5 与执行记录。
- **结论（决策 72-3，指标卡回归资产口径 + 告警卡承载最新告警）**：
  1. **指标卡回归资产/治理进度口径（6 张）**：资源总数 / 已监控 / 采集 Job / 已纳管网域 / 待确认草稿 / 采集覆盖率；**移除「活跃告警」卡**（告警表达全部收敛到告警状态卡）；每张卡右上角 `ⓘ` 中文口径注释（禁止字段名），6 列网格（`Row gutter={[16,16]}`、`xl=4`），卡内横向排版（图标 32px 在左、数字 24px/700 与标签 13px 在右）。
  2. **告警状态卡 = 首页唯一告警入口**：主数字「通知中」（AM `active`，红色语义）+ 状态分布「已静默 / 已抑制」+ 最新 **10 条**告警列表（表头 级别/告警名/实例名/相对时间/状态，单行五列左右贴边撑满，行间细分隔线，`resource_name` 为空显示 `-`）+ Prom 求值态仅 11px 灰字参考行（触发中 / 求值中）。
  3. **「查看全部 →」深链 + 首页无分页器**：告警卡与最近下发记录标题右侧各加「查看全部 →」，分别深链 `/alert-status` 与 `/deployments`；两块列表均不引入分页器（M08 告警接口无分页能力）；告警中心入口只保留标题右侧「查看全部 →」，卡内不重复。
  4. **放宽「零后端改动」约束**：`dashboard/summary` 新增 3 个计数字段——`monitored_count`（已监控资源数，口径 B：被 ≥1 个 `enabled=true` 且 `draft_status='ready'` 且 `job_type=standard` 的采集 Job 覆盖的资源数，去重）、`scrape_job_count`、`scrape_job_enabled_count`；接口增字段、向后兼容。
  5. **`unprocessed` 裁剪**：AM `unprocessed` 不计数、不进列表；仅当 N>0 时显示一行 11px 灰字「另有 N 条告警仍在计算通知状态」；页面任何位置不出现「待处理」字样（`promAlertStateLabel.pending` 展示为「求值中」）。
  6. **副标题与排版**：副标题改为描述本页视野的中性文案（如「欢迎回到 MetricCenter，这里汇总监控资源、采集任务与告警的整体运行情况」），不再写「按下方指引」等与实际内容不符的指代。
- **口径细化（相对提案原始表述，代码落地时收敛）**：
  - 已监控收严为 `enabled=true` **且** `draft_status='ready'`（与 `platform/query/coverage.go` 覆盖率三态「未监控」判定的补集同源，避免与 M07 覆盖率页口径不一致）。
  - 指标卡失败态收严为**按源降级**：请求失败或字段缺失时显示 `-`（禁止 `NaN%` / `启用 undefined`）；告警卡在 AM 失败时主数字与状态分布显示 `-`、Prom 失败时参考行显示 `-`，最新告警区显示「取数失败，暂无法展示最新告警」。
  - 最新告警排序用 `starts_at` 倒序取前 10；超长告警名省略并悬浮显示全文。
  - Prom 参考行文案用首页本地常量（`pending` = 「求值中」），不复用 M08 字典（避免把「待处理」歧义词带回首页）。
- **遗留（本轮不改跨模块代码）**：
  - M07 侧：`platform/query/coverage.go` 的 `loadSelectedInstances` 缺 `job_type='standard'` 过滤，叠加 M01 改型 blackbox 不清空 `selected_instance_ids`，会使 M07 覆盖率页把残留 `resource_id` 计为已监控，与首页「已监控」存在偏差，需 M07 认领后收敛。
  - M01 侧建议：改型为 blackbox 时清空 `selected_instance_ids`，从源头消除残留选区。
- **影响范围**：Module_05 PRD v1.5（头部 / §1 / §3 首页行 / §3.1 首页交互契约 / §6 验收）；前端 `feat/module-05-homepage-mvp` 指标卡集合 + 告警卡列表 + 后端 `dashboard/summary` 三字段；原型对齐顺延（待 1.2.1）。
- **关联文档**：`design-proposals/homepage-mvp-content-restructure.md`、`dev-feedback.md`、`api-contract-snapshot.md`（`dashboard/summary` 三字段登记，待补）、`frontend-prototype-map.md`（待补建）。

---

## Change Log（完整历史）

> v1.2 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.0 ~ v1.2 早期的完整变更详情。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.2 | 2026-08-31 | 新增 | 决策 51 落版（Grafana 集成三层归属与导航层级）：①§1 补 v0.3 两类可视化能力——可视化大屏页（Grafana iframe 嵌入 + 预置模板，一级导航第 2 位）与首页（概览 Dashboard + 新用户引导）；②§3 功能表「首页 / Dashboard」行拆分并补大屏快捷入口；③§3.1 新增「首页与可视化大屏导航层级」；④§6 验收同步导航与双入口；⑤§4 技术方案补 Grafana 嵌入与 provisioning（自 PRD Change Log 轮转迁入） | 首页/可视化大屏信息架构、导航 | MVP/v0.3 | dev-ready |
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | v0.3 / v1.0 | draft |
