# Module 05 首页 MVP 子集设计反馈记录

> **记录日期**: 2026-09-14（首轮）/ 2026-09-18（追加反馈 4~6）  
> **反馈来源**: 产品负责人（用户）在 feat/module-05-homepage-mvp 代码审查后提出的设计层面意见  
> **关联 PRD**: `docs/02-product-requirements/Modules/Module_05_Custom_UI.md`（原始记录基线 v1.3；回填时 PRD 已至 v1.5）  
> **关联决策**: 决策 72（首页 MVP 子集）、决策 72-1（六步指引 + 自定义 QueryPage）、决策 72-2（Dashboard 布局 + 视觉 Token）、决策 72-3（首页内容重构）、决策 51（可视化三层归属）、决策 68-2（Prometheus→AM 投递接线）、决策 88（客户专属皮肤与外观配置）、决策 89（首页版式方案乙与使用指引下移）  
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

## 反馈 4：客户专属配色（上海仪电品牌蓝）需与现网火山青共存，建议以「可切换皮肤」承载

### 问题描述
客户侧提出专属品牌蓝（Logo 主色 `#1B5BA3`），要求整体观感简约；同时希望**保留现网火山引擎青绿配色**，不因单一客户需求改变产品既有视觉基调。追问落点：该改的是顶栏颜色，还是主色？是否要走「两套风格 + 皮肤开关」。

### 分析与建议

#### 4.1 现状（实测，非推测）
- 全站视觉由 `ui-custom/web/src/theme.ts` 的 `volcengineTokens` **加** `App.css` 手写色值共同决定；全站**唯一**主题注入点只有根 `<ConfigProvider theme={...}>`（`src/main.tsx`），其余页面级 `ConfigProvider` 仅传 `locale`。
- `theme.ts` 之外**仍有 24 处 / 15 个非测试文件**的散落品牌色与语义色（`#0ECDEB` / `#0B1B2A` / `#1481FD` / `#FF4C3A` 等），**antd token 完全管不到**——顶栏背景、模块 tab 选中态与下划线、toggle focus 环、协议色点、失败红、选中边框、页面底色均属此类。

#### 4.2 关键阻碍：模块级 Token 快照
- `src/pages/alerts/alertmanagerConstants.ts` 在**模块顶层**读取 token 生成 `SEVERITY_BG` / `SEVERITY_TEXT` 常量，属**模块加载时快照** → 运行时切皮肤时**不会更新**，告警级别 Tag 会停留在旧皮肤色，形成「半新半旧」混合态。
- 同类模块级色表另有 5 处：`ResourceDetailDrawer.STATUS_COLOR` / `LABEL_SOURCE_BORDER`、`ResourcesPage.STATUS_COLOR`、`DomainsPage.ACCESS_STEP_COLORS`、`Callout.CALLOUT_TONES`、`ScrapeJobDetailDrawer` 协议色表。**必须一并改为按当前 token 取值的函数**。

#### 4.3 可行性
- **高**。antd 5 的 `ConfigProvider theme` 是响应式的，开关挂在根 Provider 即可全站即时生效；皮肤偏好可照抄既有 `src/layouts/siderPreference.ts` 范式（localStorage 键 + 隐私模式/存储禁用降级），无需新开页面。

#### 4.4 口径（已获产品确认，2026-09-18）
| 决策点 | 结论 |
|---|---|
| 默认皮肤 | **火山青**（零视觉回归） |
| 作用域 | **全站**（否则首页与内页串色） |
| 语义红 | **随皮肤切换**（`#FF4C3A` ↔ `#C0392B`） |
| 开关落位 | **系统与平台管理 · 外观设置**，**不放顶栏**（实施/客户侧配置入口，契合「简约」诉求，避免顶栏出现高频外观控件） |
| 客户专属边界 | INESA 蓝属**客户专属交付配置**，**不进入产品基础视觉规范** |

> 客户专属边界是本条的核心：因此 **PRD §5.2 视觉 Token 规范与 `docs/prototypes/module-05/` 原型均无需修改**，交付期开启对应皮肤即可。产品已明确「原型不用改动」。

### 建议处理
- **前端动作**：新增皮肤机制（`skins.ts` 双皮肤 token 集 / `skinContext` / `SkinProvider` / `skinPreference`），并**一次性**完成散落色值收敛 + 模块级色表去快照——两者不做则必然残留混合态。另新增「系统与平台管理 · 外观设置」承载开关。
- **PRD 动作（待 v1.7）**：§5.2 视觉 Token 规范补一句「默认火山青；客户专属皮肤由皮肤机制承载，本节规范不受影响」。
- **原型动作**：**无**（零改动）。

---

## 反馈 5：产品名称应支持自定义（交付时可不叫 MetricCenter）

### 问题描述
产品名 `MetricCenter` 在多个位置硬编码（顶栏品牌区标题、登录页标题、首页引导语、浏览器标签页标题），交付给客户时无法改名。

### 分析与建议
- **可行性**：高且成本低。产品名与皮肤同属「外观 / 交付配置」，建议并入**同一处**「外观设置」承载，持久化键独立于皮肤，避免改皮肤顺带重置名称。
- **注入点（4 处）**：顶栏品牌区标题、登录页标题、首页引导语、`document.title`；`index.html` 静态 `<title>` 保留为 **JS 未执行时的兜底**。
- **原型**：原型无品牌名注入点（文案为写死演示值），**无需改动原型**，仅在原型映射登记为「生产新增」。

### 建议处理
- **前端动作**：新增 `productNamePreference.ts`，在「外观设置」页提供编辑与「恢复默认」；空值与纯空白视为恢复默认。
- **文档动作**：`frontend-prototype-map.md` §5.2「生产新增」登记 1 行。

---

## 反馈 6：首页版式改为「两列等高 + 使用指引下移 + 告警 5 行分页」

### 问题描述
①左右两列内容量天然不等，观感上底部参差；②告警条数少（如 2 条）时左列下方留大片空白；③希望「使用指引」移到双列**下方**整宽一行。附带澄清：此前「整页不出现下拉进度条」的硬约束被产品**自我撤回**——不同电脑尺寸下强制单屏铺满会导致版式随分辨率漂移，该约束不成立。

### 分析与建议

#### 6.1 绝对等高不可达
两列内容量天然不等（告警条目数 vs 快速入口 + 下发表），**强制等高只能把空白从卡外挪进卡内**。故只能以「内容行数对齐为主 + 弹性兜底为辅」逼近，并接受少量残余落差。

#### 6.2 采纳方案乙
| 项 | 取值 | 依据 |
|---|---|---|
| 告警卡每页行数 | **5 行**（`homeLayout.ALERT_PAGE_SIZE`） | 产品明确「我更在意『最近只显示 5 条』这个契约」；数据池仍为最新 8 条（决策 73），满池即「5 行 + 第 2 页 3 行」 |
| 最近下发记录条数 | **6 条**（`DEPLOYMENT_ROW_LIMIT`） | 与告警 5 行配套，满数据时两列高度最接近 |
| 双列兜底 | `alignItems:'stretch'` + `minHeight:420` | 告警极少时两列仍有基本体量 |
| 残余落差落点 | 告警卡页脚 `margin-top:auto` 贴底 | 落差落在列表下方白底，而非两列底边参差 |

> **实现注意**：antd `Row` 的 `align` 仅支持 `top` / `middle` / `bottom`，**不支持 `stretch`**，等高须走内联 `style={{alignItems:'stretch'}}`。

#### 6.3 决策 73 第 6 条判定不再成立
「使用指引移入右列」的原目的是解决「告警状态右侧高度太空」；两列等高后该诉求已由版式机制解决，指引移至双列**下方整宽一行**反而更易读（六步横排铺开）。故决策 73 第 6 条被本决策修订。

#### 6.4 原型处置（产品决策「甲」，2026-09-18）
**原型与 PRD 描述均不改动**，本项登记为**生产侧版式偏离**：原型侧在 `frontend-prototype-map.md` §5.3 登记偏离行；PRD 侧回填待 v1.7 版本化迭代（当前 feat 未收尾，遵守 PRD 冻结门禁）。代价是过渡期 PRD §3.1 列描述仍为旧写法，以偏离清单 + 本节为口径依据。

### 建议处理
- **前端动作**：按 6.2 落地版式；使用指引改为双列下方整宽一行。
- **文档动作**：`design-decisions.md` 登记决策 89；`frontend-prototype-map.md` §5.3 登记偏离行、§5.4 更新计数。
- **PRD 动作（待 v1.7）**：§3.1 第 4/5/6 项与「布局与列设计」段、§6 验收项按决策 89 修订。

---

## 反馈 7：首页「当日 / 近 7 天告警」恒为 0 —— 取数缺 `step` 撞上 query_range 点数上限（② 缺陷，已修复，决策 90）

### 问题描述

用户实测：卡片「当日告警 0」「近 7 天告警 0」，但同一时刻「通知中」有当日告警；追问「什么原因，是否要调整后端代码」。

### 根因（实证）

首页告警卡的历史链路 `alertStatusApi.getAlertHistory(historyQuery())` **恒取满 7d 窗口且未传 `step`**（决策 73 原实现），服务端按 PRD 默认 `step=30s` 展开 → `7d ÷ 30s = 20160` 点 > Prometheus `query_range` 单序列上限 `11000` → 上游 400 → 本接口 500 → `historyError` 置位 → 两格按既有降级规则显示 `-`／计数恒 `0`。即**该链路必然失败**，与告警是否真的发生无关。

> 注：卡片自身的降级链路（失败不显示 0、`list` 缺失降级 `-`）工作正常；问题在取数参数与服务端默认值互斥，属后端口径问题（修复主体在 M02，见 `module-02/design-decisions.md` 决策 90）。

### 结论（决策 90，A + B 双管）

1. **B（本模块）：取数显式传 `step`** —— 新增常量 `ALERT_HISTORY_STEP_SECONDS = 30`（`ui-custom/web/src/api/alertmanager.ts`），`historyQuery()` 透传 `step`。取值 30s = PRD §5.4 默认步长：**调用侧只表达期望粒度（细粒度），宽窗口的上限保护交给服务端兜底**（7d 下由服务端抬到 55s）。原「统一 60s」会让默认 24h 窗口的估算粒度由 30s 劣化为 60s，故按用户 2026-09-18 口径改定为 30s（`module-02/design-decisions.md` 决策 90 同日补充）。
2. **A（M02 服务端）：按窗口自动抬高步长** + 响应回显 `data.step`，保证任何调用方（含未传 `step` 的旧调用）都不会再踩上限。
3. **顺带修订计数口径（修订决策 73 §1 的实现方式，产品口径不变）**：`computeHistoryCounts` 原以「服务端 `total` 与前端**按渲染时刻**重算边界的 `inWindow` 取大」计算「近 7 天」，两个边界不同源、会与卡片文案「近 7 天」不符；现**直接取服务端窗口总量 `total`**（窗口与「近 7 天」严格同口径），`total` 缺失时回落为页内条目数。`today` 仍由当前页统计（列表按触发时间倒序，单页上限丢的是最旧记录 —— 该边界已在代码注释中写明）。
4. **取数窗口由「7d + 1h 容差」改为整 7d**：服务端会把 `> 7d` 的窗口压缩为 `[end-7d, end]`，容差被服务端丢弃、从未生效，却让「窗口 = 近 7 天」的推理失效。

### 影响与验证

- **改动文件**：`src/api/alertmanager.ts`、`src/types/alertmanager.ts`、`src/pages/home/HomePage.tsx`、`src/pages/home/HomePage.test.tsx`（新增 2 例：取数参数含 `step` 且常量 = PRD 默认 30s / 窗口恰 7d；`week` 取服务端 `total`）。
- **验证**：`tsc --noEmit` 通过；`eslint` 0 告警；`HomePage.test.tsx` 全过（口径改 30s 后重跑通过）。
- **运维**：属后端行为变更 + 前端参数变更，需 `make run-metric-center` 重启后端、`pnpm build` 重新构建前端。

### PRD 待回填（遵守 PRD 冻结门禁）

| 项 | 目标 | 状态 |
|---|---|---|
| PRD §5.4 / §6.1 / §11.2 补「步长按窗口抬高 + 响应回显 `step`」与新增验收 | `Module_02_Query_Center.md`（v1.17） | ⏳ 待 M02 下版迭代 |
| 首页「近 7 天」计数口径注明「取服务端窗口总量」 | `Module_05_Custom_UI.md`（v1.7） | ⏳ 与决策 88/89 待回填项同批 |

---

## 反馈 8：首页 L3「拨测态势」除 URL 外字段恒空（② 缺陷，已修复）

- **现象**：M05 首页 L3「拨测态势」面板在实连环境下，状态列恒为「未知」、业务域 / 应用 / 最近拨测三列恒为 `-`；L0「拨测」卡的「当前拨测异常数」亦恒为 0，用户误以为拨测未运行。
- **根因（后端取数未实现，非前端缺陷）**：`GET /api/v2/platform/dashboard/summary` 的 `probe_targets[]` 在 `platform/dashboard/summary.go` 中仅填充 `url`，`status` 硬编码空串、`last_probe_at` 硬编码 `nil`、`probe_target_abnormal_count` 硬编码 0，注释理由为「无实时拨测数据源」。该理由已过时——blackbox 拨测结果现经 vmagent → remote_write 落到中心 Prometheus 的 `probe_success` 指标（1=通过 / 0=失败，样本自带采样时间戳）。PRD §5.1 与决策 93 第 8 条本就要求 `probe_status` / `last_probe_time` 由 M01 承载、M05 只消费。
- **修复（本批，后端）**：
  1. 新增 `platform/dashboard/probe.go`：`ProbeQuerier` 抽象 + `PromProbeQuerier`（GET 中心 Prometheus `/api/v1/query?query=probe_success`，按 job → instance 建二级索引）。
  2. `summary.go`：`Build(db, opts...)` 新增 `WithProbeQuerier` Option；拨测段落按 `job_name` + 拨测目标地址匹配样本，填充 `status`（1→`up` / 0→`down` / 无样本→`''` 未知）、`last_probe_at`（样本时间戳），并据此计算 `probe_target_abnormal_count`（仅 `down` 计入，未知不误报为异常）。
  3. `main.go`：`registerPlatformConfigRoutes` 接收 `promURL`，注入 `NewPromProbeQuerier(promURL, nil)`。
  4. **降级策略**：拨测查询失败不阻断聚合接口，字段回落「未知」、异常计数为 0。
- **前端零改动**：`ProbePanel.tsx` 已支持 `up` / `down` / 未知三态与相对时间渲染，字段有值即自动呈现绿 / 红 Badge 与「最近拨测」时间。
- **仍未闭合的缺口（需 PRD / M01 侧决策）**：
  1. **`biz_name` / `app_name` 恒空**：`models.BlackboxTarget` 仅有 `Target` / `Protocol` / `URL`，`ScrapeJob` 亦无业务域 / 应用归属字段，无法推断；而 PRD §5.1 明确「`biz_code` 必填」。需 M01 在 blackbox 采集 Job 上承载归属字段（PRD 决策 93 第 7 条「登记时挂业务域」），本批无法修。
  2. **字段命名与 PRD 不一致**：PRD 为 `target_url` / `probe_status` / `biz_code` / `biz_name` / `app_code` / `app_name` / `last_probe_time`；实现为 `url` / `status` / `biz_name` / `app_name` / `last_probe_at`，且缺 `biz_code` / `app_code`。建议由 prototype-designer 统一口径（改 PRD 或改实现）。
- **验证**：`go test ./platform/...` 全绿；新增 5 例覆盖「样本填充 / 无样本未知 / 查询失败降级 / 裸 target 回落匹配 / nil index 不 panic」。

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

## 文档回填留痕（2026-09-18，决策 88 / 89：客户专属皮肤 + 外观配置 + 首页版式方案乙）

> 本节对应反馈 4~6。**产品决策「甲」：原型零改动**——INESA 蓝属客户专属交付配置，不进入基础视觉规范。

| 项 | 目标文档 / 位置 | 状态 |
|---|---|---|
| 决策登记：客户专属皮肤与外观配置 | `design-decisions.md` 决策 88 | ✅ 本轮登记 |
| 决策登记：首页版式方案乙 + 使用指引下移 | `design-decisions.md` 决策 89 | ✅ 本轮登记 |
| 生产新增登记：皮肤机制 / 外观设置页 / 产品名自定义 | `frontend-prototype-map.md` §5.2 N-4~N-6 | ✅ 本轮登记 |
| 版式偏离登记：使用指引位置 / 告警 5 行 / 下发 6 条 | `frontend-prototype-map.md` §5.3 C-4 | ✅ 本轮登记 |
| 失效路径修正：`src/theme.ts` 已删除 → 改指 `src/skins.ts` | module-05 / 06 / 07 / 08 `frontend-prototype-map.md` | ✅ 本轮修正 |
| PRD §5.2 补「默认火山青；客户专属皮肤由皮肤机制承载」 | `Module_05_Custom_UI.md` | ⏳ 待 v1.7（PRD 冻结门禁） |
| PRD §3.1（第 4/5/6 项 + 布局与列设计段）与 §6 验收按决策 89 修订 | `Module_05_Custom_UI.md` | ⏳ 待 v1.7（PRD 冻结门禁） |
| 原型 `docs/prototypes/module-05/` | — | 🚫 按产品决策不改 |

**过渡期口径依据**：PRD 回填前，「使用指引位于双列下方」「告警 5 行/页」「最近下发 6 条」以本文件反馈 6 + `frontend-prototype-map.md` §5.3 C-4 为准。

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
- **追加（2026-09-18，反馈 4~6）**：皮肤与产品名均为**前端本地偏好**（localStorage），不新增接口，「零后端改动」结论保持。
- **客户专属配色边界**：INESA 蓝以皮肤机制承载，**不改动 PRD 基础视觉规范与原型**；若后续需将其固化为产品**默认**皮肤，须走版本化迭代并同步原型（届时升级为 design proposal）。
- **追加（2026-09-18，反馈 7）**：本条**涉及后端行为变更**（M02 `/api/v1/alerts/history` 服务端按窗口抬高 `step` + 响应新增 `data.step` 附加字段），「零后端改动」结论仅适用于反馈 4~6（皮肤 / 产品名 / 版式），不覆盖反馈 7。变更登记在 `module-02/design-decisions.md` 决策 90，前端侧为取数参数透传（`step=60`）+ 一处计数口径修订（不新增接口）。
