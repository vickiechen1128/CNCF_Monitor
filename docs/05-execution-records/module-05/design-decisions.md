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

## Change Log（完整历史）

> v1.2 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.0 的完整变更详情。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | v0.3 / v1.0 | draft |
