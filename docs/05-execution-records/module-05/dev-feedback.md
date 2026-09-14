# Module 05 首页 MVP 子集设计反馈记录

> **记录日期**: 2026-09-14  
> **反馈来源**: 产品负责人（用户）在 feat/module-05-homepage-mvp 代码审查后提出的设计层面意见  
> **关联 PRD**: `docs/02-product-requirements/Modules/Module_05_Custom_UI.md`（原始记录基线 v1.3；回填时 PRD 已至 v1.5）  
> **关联决策**: 决策 72（首页 MVP 子集）、决策 72-1（六步指引 + 自定义 QueryPage）、决策 72-2（Dashboard 布局 + 视觉 Token）、决策 72-3（首页内容重构）、决策 51（可视化三层归属）、决策 68-2（Prometheus→AM 投递接线）  
> **处理原则**: 本文件仅登记意见与可行性分析，**不动代码**；已由 prototype-designer 逐轮评估并纳入 PRD v1.4 / v1.5 与原型 1.2.1 修订（见文末「文档回填留痕」）。

---

## 反馈 1：使用指引缺少「配置告警」动线；`/query` 页面为空，建议复用 Prometheus 前端页面

### 问题描述
当前使用指引五步动线为：登记网域 → 导入资源 → 建采集 Job → 下发 → 查指标。用户完成配置后想看到告警，但指引中缺少「配置告警通知」环节，导致「看到告警」这一核心闭环未被显式引导。

同时 `/query` 页面目前为空，点击「查指标」后无实际可用内容，体验断层。

### 可行性分析

#### 1.1 在指引中增加「配置告警」步骤
- **可行性**：高。M08 已提供 `/alert-config` 告警配置挂载页与 `/alert-status` 告警状态页，只需在 PRD §3.1 使用指引区增加一步或一个分支步骤。
- **建议方案**：
  - 最小改动：将五步扩展为六步——登记网域 → 导入资源 → 建采集 Job → 下发 → **配置告警** → 查指标。第 5 步深链 `/alert-config`，第 6 步深链 `/query`。
  - 或采用「主线 + 支线」结构：主线仍为五步，在最后一步提示「若要接收告警，可前往配置告警通知」。
- **影响面**：HomePage `OnboardingSteps.tsx` 文案与深链；PRD §3.1、§6 验收标准；原型 UsageGuidePage。

#### 1.2 复用 Prometheus 前端页面作为 `/query`
- **可行性**：低，且与现有架构红线冲突。
  - **选项 A：iframe 嵌入 Prometheus `/graph`**：
    - 问题 1：直接绕过 M02 查询代理，用户可直连 Prometheus，破坏 Module_02 §1「数据源必须指向 M02 代理，禁止直连 Prometheus」的可视化边界红线。
    - 问题 2：租户 / 网域上下文注入失效，存在跨租户数据泄露风险。
    - 问题 3：样式割裂（Prometheus UI 视觉与 Ant Design 门户不一致）。
    - **结论**：不可行。
  - **选项 B：从 `upstream/prometheus/web/ui` 抽取 React 组件复用**：
    - Prometheus Web UI 未作为独立 npm 包发布，组件与 Prometheus 构建流程、状态管理、API 路径强耦合。
    - 引入会污染 `ui-custom/web/` 的依赖边界，且需要持续同步上游子模块变更，违背 `upstream/` 禁止直接修改 / 重用的隔离原则。
    - **结论**：成本过高，不建议。
  - **选项 C：在现有 `QueryPage.tsx` 中实现轻量 PromQL 查询（推荐）**：
    - 调用 M02 已上线的 `/api/v1/query` 与 `/api/v1/query_range` 代理接口（`src/api/query.ts` 已封装或可按 Module_02 契约补齐）。
    - 保持数据源走 M02 代理、租户/网域注入生效、视觉统一。
    - 工作量可控：PromQL 输入框 + 结果表格/JSON + 简单折线；MVP 阶段无需复杂图表。
    - **结论**：应优先补齐自定义 QueryPage，而非复用 Prometheus UI。

### 建议处理
- **prototype-designer 动作**：
  1. 修订 PRD v1.3 §3.1 使用指引，增加「配置告警」步骤（决策 72 补丁）。
  2. 明确 `/query` 页面不采用 Prometheus UI iframe/组件复用，而是走 M02 代理的自定义查询页；若 QueryPage 实现不在本次 scope，则使用指引第 6 步深链可临时指向 `/targets` 或先隐藏「查指标」步骤，待 QueryPage 实现后再启用。
- **前端动作**（待 PRD 修订后）：同步修改 `OnboardingSteps.tsx` 步骤文案与深链；`QueryPage.tsx` 按选项 C 补齐（可独立 task）。

---

## 反馈 2：Dashboard 概览设计简陋

### 问题描述
当前首页 MVP 子集以信息卡片 + 列表为主，缺乏 Dashboard 应有的「概览感」，用户难以一眼感知平台整体健康度。

### 分析与建议
- **现状**：已实现统计卡（资源 / 草稿 / 网域）、告警数字卡、快速入口、使用指引、最近下发表。这些本质是「入口页」而非「Dashboard」。
- **PRD 定位**：决策 51 中「概览 Dashboard（轻量实时图表、采集覆盖率聚合卡片）」原本归属 v0.3。MVP 子集明确豁免了轻量图表与采集覆盖率卡片。
- **可行方向**（由 prototype-designer 判定版本归属）：
  1. **MVP 纯 UI 增强（推荐）**：在不引入后端改动与图表库的前提下，优化现有卡片的视觉层级——例如：
     - 给统计卡增加趋势图标 / 环比占位；
     - 给告警卡增加颜色块 / 状态条；
     - 给最近下发表增加状态色点；
     - 统一卡片圆角、阴影、间距、图标风格。
     这些可在本次 feat 分支通过视觉 Token 调整完成，不超出 MVP scope。
  2. **提前部分 v0.3 Dashboard 能力**：若产品坚持 Dashboard 感，可将「采集覆盖率聚合卡片」或「最近告警 mini 列表」提前到 MVP。需评估是否引入后端改动：
     - 覆盖率卡片：可基于 `dashboard/summary` 已有数据 + 资源总数简单计算，零后端改动。
     - 最近告警 mini 列表：可基于本次新增的告警接口取前 N 条展示，零后端改动。
     - 轻量图表：需要引入 ECharts/AntV 并消费 `query_range`，PRD 原定为 v0.3；若提前则属于 scope 扩大，需 PRD v1.4 明确。
  3. **保持当前 scope，v0.3 再做 Dashboard 升级**：如果产品接受 MVP 以「入口 + 引导」为主，Dashboard 感在 v0.3 通过 Grafana/轻量图表补齐。

### 建议处理
- **prototype-designer 动作**：在原型 v1.2 中给出 2~3 版 Dashboard 视觉方案（低保真即可），明确哪些视觉增强纳入当前 feat、哪些归入 v0.3。
- **不直接动代码**：当前先记录反馈，待视觉方案确定后再行修改。

---

## 反馈 3：整体样式和排版不够美观

### 问题描述
首页各区域在间距、对齐、色彩、图标搭配上显得松散，整体不够精致，与企业级监控门户的预期有差距。

### 分析与建议
- **原因**：MVP 阶段重点验证功能闭环，视觉 Token（主色、卡片、间距、字体层级）沿用项目早期原型，未经过系统性的 Design Token 收敛。
- **可行改进（不动后端）**：
  - **统一间距体系**：使用 Ant Design 的 `theme.token.padding`、`margin` 规范，避免硬编码像素。
  - **卡片风格**：统一圆角、阴影、hover 态；统计卡与告警卡采用不同权重（告警卡可略带色底或左侧色条）。
  - **图标**：为快速入口卡片配置语义化图标，保持尺寸/颜色一致。
  - **字体层级**：标题、数字、辅助文案严格区分 `Typography.Title/Text` 级别。
  - **空态与错误态**：统一骨架屏、空图片、错误提示组件。
- **关联标准**：参考 `docs/03-engineering-standards/02_Frontend_Standard.md` 中关于页面状态、长文本与横向滚动的规范。

### 建议处理
- **prototype-designer 动作**：输出一份「Module 05 首页视觉 Token 规范」或直接在原型中给出高保真首页样式（即使 Track B 免原型，视觉规范仍可作为开发依据）。
- **前端动作**（待规范后）：按规范调整 `HomePage.tsx`、`AlertStatusCard.tsx`、`QuickAccess.tsx`、`OnboardingSteps.tsx` 的样式，不改动交互逻辑与数据流。

---

## 文档回填留痕（2026-09-14，决策 72-3 首页内容重构）

> 本节对应 `design-proposals/homepage-mvp-content-restructure.md` §7 第 4 项（dev-feedback clipping 留痕），随 PRD v1.5 回填一并登记。**两条均为产品口径裁剪，非实现缺失**。

### clipping-1（关联评审 MEDIUM-2）：首页指标卡集合偏离原枚举

| 项 | 内容 |
|---|---|
| **原枚举** | 决策 72 / 72-2（PRD v1.3~v1.4 §3.1）：资源总数 / 已监控 / 采集 Job / **活跃告警** / 网域数量 / **监控源**——含告警维与监控源维 |
| **现口径** | 决策 72-3（PRD v1.5 §3.1）：资源总数 / 已监控 / 采集 Job / 已纳管网域 / 待确认草稿 / **采集覆盖率**——纯资产 / 治理进度六张，**不含任何告警数字** |
| **裁剪性质** | 产品口径收敛：告警表达全部收敛到告警状态卡（首页唯一告警入口）；「监控源」卡不在本期首页口径内（MVP 不做） |
| **留痕原因** | 评审 MEDIUM-2 指出「失败源仍渲染 `0`」与决策 68-2「取数失败必须与恒 0 区分」冲突；卡片集合收敛后，告警数字不再出现在指标卡，该类误读面随之消除 |
| **影响** | PRD v1.5 §3.1「关键指标卡口径」表 + §6 验收；`HomePage.test.tsx` 断言 6 张卡且「指标卡区域不含告警数字」；`frontend-prototype-map.md` 偏离清单 |

### clipping-2（本轮新增）：AM `unprocessed` 不计数、不进列表

| 项 | 内容 |
|---|---|
| **裁剪内容** | AM `unprocessed` 不进入首页告警状态卡的计数与最新告警列表 |
| **理由** | `unprocessed` 的治理闭环（指派人 / 工单）MVP 未实现，展示无对应动作（提案 §2.1 / §3.4 / §5） |
| **降级呈现** | 仅当 `unprocessed > 0` 时显示一行 11px 灰字「另有 N 条告警仍在计算通知状态」（Tooltip 说明告警刚进入通知队列、系统仍在计算是否通知及通知对象）；页面任何位置**不出现「待处理」字样** |
| **影响** | PRD v1.5 §3.1「告警状态数字」+ §6 验收；`AlertStatusCard.tsx` / `HomePage.test.tsx`（防误读用例） |
| **跨模块建议** | M08 `alertmanagerConstants.ts` 中 `promAlertStateLabel.pending` 与 `notifyStatusLabel.unprocessed` 同为「待处理」，歧义源仍在共享字典；建议 M08 侧后续把 `pending` 展示名调整为「求值中」（**本轮不改 M08 契约文案**，首页已用本地常量 `PROM_EVAL_LABEL` 规避） |

---

## 综合建议与下一步

1. **由 prototype-designer 在 `design/module-mvp-demo` 分支修订以下内容**：
   - PRD `Module_05_Custom_UI.md` v1.4：使用指引增加「配置告警」步骤；明确 `/query` 页面走自定义实现（不复用 Prometheus UI）；补充 Dashboard 视觉增强 scope。
   - 原型 `docs/prototypes/module-05/`：给出首页高保真/中保真视觉方案，重点解决反馈 2、3。
   - 更新 `docs/05-execution-records/module-05/design-decisions.md`：把上述结论登记为决策 72 补丁或独立决策 73。
2. **前端 feat 分支 `feat/module-05-homepage-mvp` 暂不动代码**，等待视觉方案和 PRD 补丁落版后再合并修改。
3. **QueryPage 空缺问题**：建议单独评估是否在本次或后续迭代补齐自定义 QueryPage；若本次不补，使用指引「查指标」步骤应隐藏或指向 `/targets`，避免空页体验。

---

## 变更控制

- 本反馈不涉及后端契约变更、不影响 decision 72 已落版的「告警数字方案 A」与「零后端改动」结论。
- 若后续 PRD 修订导致新增后端接口或推翻决策 72 核心结论，需重新走 Orchestrator 变更请求（CR）流程。
