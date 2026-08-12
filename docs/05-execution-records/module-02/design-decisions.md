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
- `docs/02-product-requirements/Modules/Module_08_Alerting_Rule_Management.md`（v0.3 alerts 对齐，版本面待同步）

---

## Change Log（完整历史）

> v1.3 起主 PRD Change Log 精简为最近 3 版一句话摘要；本小节承载 v1.1 及以前的逐版完整变更详情（业务沟通决策记录）。

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.1 | 2026-08-03 | 修改 | PRD 状态从 ready 修正为 设计中：尚未完成原型验证 | PRD 状态 | 文档自身 | 设计中 |
| v1.1 | 2026-08-02 | 新增 | 完成 Volcengine 风格原型验证，输出独立可点击原型 | PRD 状态、UI/UX、原型目录 | 文档自身 | 设计中 |
| v1.0 | 2026-07-31 | 初始 | 模块 PRD 初始版本 | 全部 | MVP / v0.2 / v0.3 | draft |
