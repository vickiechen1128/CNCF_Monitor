# Module_05 前端「原型 ↔ 生产」映射与偏离清单

> 依 `frontend-developer.md` Step 3.5 六项核对，补齐 module-05 长期缺失的映射基线（前批审查已登记为遗留风险，见 `design-proposals/homepage-mvp-content-restructure.md` §8.3）。
>
> - 权威基底（只读，不修改）：`docs/prototypes/module-05/src/**`（**原型 v1.4.0**，已按 PRD v1.7 修订）
> - 生产实现（只读，不修改）：`ui-custom/web/src/pages/home/**`、`ui-custom/web/src/pages/query/QueryPage.tsx`、`ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`、`ui-custom/web/src/api/dashboard.ts`、`platform/dashboard/summary.go`
> - 契约（前端第一权威）：`api-contract-snapshot.md`
> - 决策基线：`design-decisions.md` 决策 72 / 72-1 / 72-2 / 72-3、决策 73、决策 88（皮肤与产品名）、决策 89（首页版式方案乙）、**决策 91（首页三层信息架构重构 + 拨测口径，本版新增）**、决策 51（v0.3 大屏）、决策 68-2（AM 投递接线）
> - 生成日期：2026-09-14；**本版重出：2026-09-19（按 PRD v1.7 / 原型 v1.4.0 全量刷新）**；分支：`design/module-mvp-demo`（原型与文档）/ `feat/module-05-homepage-mvp`（生产）
> - 现状字段含义：✅对齐 = 生产已完成且与原型一致或为合理生产替代；⚠️偏离 = 存在差异（见 §5）；❌缺失 = 原型有生产无；➕生产新增 = 原型无生产有；**✅落地 = PRD v1.7 已定版且生产已实现（2026-09-19 本轮 orchestrator 驱动落地，见 §5.5）**；🔧待改造 = 已定版但生产尚未实现（本轮已清空）。

---

## 1. 决策落版

| 编号 | 决策点 | 原型表现 | 生产采纳态 | 状态 |
|------|--------|----------|------------|------|
| D1 | 视觉 Token | 火山引擎 Token：主色 `#0ECDEB`、头部 `#0B1B2A`、内容背景 `#F7F8FA`；卡片圆角 8px（资源类型卡 12px） | `src/skins.ts` 全局注入（**默认皮肤 `volcengine`**，取值逐字保真）；卡片圆角/阴影/间距按决策 72-2 规范 | ✅ 采纳（决策 88 在其上叠加皮肤层，见 D11） |
| D2 | 页面结构 | 标题区 → **L0 全局态势四卡** → **L1 资源类型三列网格（5 类卡 + 按应用入口卡）** → **L2 应用明细表** → 整宽告警状态卡 → 整宽使用指引（决策 91，原型 v1.4） | `HomePage.tsx` 已按 v1.7 重排：页头行 → `l0-section`（4 卡 `xl=6`）→ `ResourceTypeGrid`（`l1-grid`，6 格 `xl=8`）→ `AppDetailTable`（`l2-app-table`）→ 告警状态卡**整宽** → `OnboardingSteps` 整宽 | ✅ 落地（见 §5.5 W-1） |
| D3 | L0 指标卡口径 | **4 张**：资源总数 / 已纳入监控 / 整体覆盖率 / **当前未恢复告警**，每张右上角 `ⓘ` 中文口径注释、4 列网格、卡内纵向排版（决策 91 收敛） | 已收敛为 **4 张**（资源总数 / 已纳入监控 / 整体覆盖率 / 当前未恢复告警），第 4 卡取 `/api/v1/alerts` 的 `firing` 条数；仍由 `MetricCard` + `SurfaceCard` 承载 | ✅ 落地（见 §5.5 W-2） |
| D4 | 告警卡承载 | 告警状态卡 = 首页**唯一**告警入口：四格统计条（当日 / 近 7 天为主数字 + 通知中 + 已静默·已抑制）+ 最新 **8** 条两行制列表 + **卡内分页每页 5 行**（决策 73 / 89） | `AlertStatusCard.tsx` 同款（`LATEST_ALERT_LIMIT = 8`、`ALERT_COL_WIDTH`、`LatestAlertHeader`、`homeLayout.ALERT_PAGE_SIZE = 5`） | ✅ 采纳 |
| D5 | 分页与深链 | 首页**不放分页器**；告警卡**卡内分页每页 5 行**；资源类型卡 / 应用明细行深链资源清单并预筛（决策 91） | 告警卡分页（`ALERT_PAGE_SIZE = 5`）已采纳；下发表与 `/deployments` 深链**已移除**；资源类型卡子类行 / 应用明细行深链已实现（`/resources?resource_category=&subtype=`、`?app_code=`），`ResourcesPage` 支持三参数预筛 + 「已按首页下钻条件预筛选」提示 + 一键清除 | ✅ 落地（原 C-4 分页偏离已闭合；W-3 / W-4 已落地） |
| D6 | 六步指引 | 登记网域 → 导入资源 → 建采集 Job → 下发 → **配置告警通知** → 查指标/看告警（决策 72-1）；**整宽一行**铺开 | `OnboardingSteps.tsx`（`/alert-config` + `/query`/`/alert-status`），已位于整宽一行 | ✅ 采纳（已随新版式重排，见 §5.5 W-1） |
| D7 | QueryPage | 自定义轻量 PromQL 查询（输入框 + 表格/JSON），走 M02 `/api/v1/query` 代理，**禁止复用 Prometheus UI** | `pages/query/QueryPage.tsx`（`queryApi`） | ✅ 采纳 |
| D8 | `unprocessed` | 不计数、不进列表；仅 N>0 时一行 11px 灰字附注；页面不出现「待处理」 | 同款；Prom pending 用本地常量 `PROM_EVAL_LABEL` 展示「求值中」 | ✅ 采纳（裁剪登记见 §4） |
| D9 | 大屏入口 | **MVP 首页不含**「进入可视化大屏」入口（决策 72 豁免，延至 v0.3） | 同款；`GrafanaDashboardPage` / 一级菜单为 v0.3 能力 | ✅ 采纳 |
| D10 | 导航层级（v0.3） | 首页（第 1 位）+ 可视化大屏（第 2 位）+ 系统设置 | v0.3 范围，本期不实现 | 已决策·未实施 |
| D11 | 皮肤与外观配置 | 原型**无**（单一火山青 Token，无换肤能力） | `src/skins.ts`（`volcengine` 默认 / `inesa` 可切换）+ `skinContext.ts` + `SkinProvider.tsx` + `skinPreference.ts`；开关页 `/admin/appearance`（系统与平台管理，**不放顶栏**） | ➕生产新增（决策 88；原型按产品决策「甲」不改） |
| D12 | 产品名称自定义 | 原型**无**（品牌文案写死） | `productNamePreference.ts`；注入顶栏品牌区 / 登录页 / 首页引导语 / `document.title`；`/admin/appearance` 可编辑与恢复默认 | ➕生产新增（决策 88） |
| D13 | **首页三层信息架构 + 拨测口径** | ①L0 四卡（资源总数 / 已纳入监控 / 整体覆盖率 / 当前未恢复告警）；②L1 资源类型区 5 类卡 + 1 张「按应用查看」入口卡、3 列网格（200×228px）、卡内嵌采集类型子类明细（**应用服务不设子类**，统一归 `application_http`）与右上角「未恢复 N」胶囊；③L2 应用明细表按覆盖率升序 + 「未归类应用」行置底；④**移除系统快速入口区与「最近下发记录」表**；⑤**拨测（Blackbox）目标不计入资源总数与覆盖率**，其告警因无 `resource_category` 落入 L1 入口卡下方附注；⑥「未恢复」计数由 `/api/v1/alerts` 按 `resource_category` 前端分组（后端零改动）；⑦概览接口新增 `by_category`（含 `by_subtype`）/ `by_app` / `unclassified_*` / `probe_target_*` | 生产**尚未实现**（仍为 v1.6 六指标卡 + 双列区 + 快速入口 + 下发表；后端 `summary.go` 尚无分组聚合字段） | 🔧 待改造（决策 91，见 §5.5 W-1~W-5） |

---

## 2. 首页组件 ↔ PRD 条目映射（PRD §3.1 v1.7「首页（MVP 子集）交互契约」）

> 覆盖范围：PRD §3.1 的五段页面结构 + L0 关键指标卡口径表 + L1/L2 口径 + 告警数字分层表达 + 拨测口径 + 视觉 Token 规范。

| PRD §3.1 条目 | 原型实现（`docs/prototypes/module-05`） | 生产实现（`ui-custom/web/src`） | 对齐 |
|---|---|---|---|
| ① 标题区（主标题 + 中性副标题，不写「按下方指引」） | `pages/DashboardPage.tsx`：`Title level={3}` + 中性副标题 | `pages/home/HomePage.tsx` 标题区 | ✅ |
| ② **L0 全局态势区（4 张 KPI 卡，4 列网格）** | `GlobalStatCard` × 4（资源总数 / 已纳入监控 / 整体覆盖率 / 当前未恢复告警） | 仍为 `MetricCard` × 6（含采集 Job / 已纳管网域 / 待确认草稿） | ✅ 落地（W-2） |
| ②-a 每张右上角 `ⓘ` 中文口径注释 | `Tooltip` + `InfoCircleOutlined` | 同款 | ✅ |
| ②-b 卡内纵向排版（标签 12px 在上 / 数字 30px·800 / 44px 图标容器右下，决策 73） | flex 纵向排版 | 同款（`styles.body.padding = '14px 16px'`） | ✅ |
| ②-c 「当前未恢复告警」卡（数据源 `/api/v1/alerts`，红色语义） | 第 4 卡 `valueColor={DANGER}`，`tip` 说明含非台账对象告警 | 首页**无**此卡（告警数字仅在告警状态卡） | ✅ 落地（W-2） |
| ③ **L1 资源类型区（5 类卡 + 1 张按应用入口卡，3 列网格）** | `ResourceTypeCard` × 5 + `AppEntryCard`（虚线边框，`xl=8`） | `ResourceTypeGrid.tsx`（5 类卡 + `AppEntryCard` 内联，3 列网格 `xl=8`） | ✅ 落地（W-3） |
| ③-a 资源类型卡形态（类型名 + 26px 图标容器 + 右上角告警胶囊 → 已采数 28px/800 + `/ N 台` → 覆盖率进度条 + 未采数 → 子类明细行） | `ResourceTypeCard`（高度 228px、圆角 12px、`CATEGORY_UNIT` 量词主机「台」其余「个」） | **无** | ✅ 落地（W-3） |
| ③-b 「未恢复 N」胶囊（零告警显示「无未恢复」，红色语义） | `AlertPill`（正数红底深字 / 零值灰底灰字） | **无** | ✅ 落地（W-3） |
| ③-c 采集类型子类行（主机按 OS、数据库按 `database_type`、中间件按 `middleware_type`、其他监控目标按端点类型；**应用服务不设子类**，显示单一采集类型 `application_http`） | `mockResourceTypes[].subtypes`；应用服务 `subtypes: []` 走单行分支，子类覆盖率 <70% 橙色底 | **无** | ✅ 落地（W-3） |
| ③-d 子类行 / 应用行点击下钻资源清单并按条件预筛 | `Link to="/resources"` + Tooltip | **无** | ✅ 落地（W-4） |
| ③-e 拨测目标附注（L1 入口卡下方：拨测目标数 / 异常数 + 「另有 N 条未恢复告警不属于资源台账对象」） | `mockProbeSummary` + `mockUnclassifiedAlertCount` | **无** | ✅ 落地（W-5） |
| ④ **L2 应用明细表（按覆盖率升序 + 未归类行置底）** | `Table` 7 列（应用名称 / 业务域 / 实例 / 已采 / 覆盖率 / 未恢复 / 操作），`appRows` = `mockAppSummaries` + 未归类行 | **无** | ✅ 落地（W-4） |
| ⑤ 告警状态卡（四格统计条 + 最新 8 条两行制 + 每页 5 行） | `AlertStatStrip` + `AlertRow`（沿用 `AlertRow` 两行制） | `AlertStatusCard.tsx` 同款 | ✅ |
| ⑤-a 告警列表每页 5 行（首页 5 行 + 第 2 页 3 行） | 原型 v1.4 已实现卡内分页（`ALERT_PAGE_SIZE = 5`） | `homeLayout.ALERT_PAGE_SIZE = 5` | ✅（原 C-4② 偏离闭合） |
| ⑥ 使用指引区（整宽一行，六步 Steps 横排，每步配深链） | 整宽一行 Steps | `OnboardingSteps.tsx` 整宽一行 | ✅ |
| ⑦ **系统快速入口区（已移除）** | 原型 v1.4 已删除 `mockQuickAccess` 消费与渲染 | 生产**仍在**（`QuickAccess.tsx`，`HomePage.tsx` 右列第一张卡） | ✅ 落地（W-1） |
| ⑧ **最近下发记录表（已移除）** | 原型 v1.4 已删除该表与 `/deployments` 深链 | 生产**仍在**（`DEPLOYMENT_ROW_LIMIT = 6`、`deploymentStatusBadge()`、`/deployments` 深链） | ✅ 落地（W-1） |
| 视觉 Token 规范（色彩收敛 / 卡片 8px（类型卡 12px）/ 间距 / 字体层级 / 图标尺寸 / 自然文档流滚动） | 原型 Token 一致；资源类型卡 26px 图标容器 | `src/skins.ts`（默认皮肤 `volcengine`）+ 组件内 styles；新增自绘色值须走 `useSkin().tokens` | ✅（`ResourceTypeGrid` 复用 `SurfaceCard` + `theme.useToken()` 语义色，L1 类型卡圆角 12px） |
| 空态引导（未挂载 AM 通知配置 → 「尚未挂载通知配置，去配置 →」`/alert-config`；空库 → 类型卡 0 + 「去导入资源 →」） | 原型为静态 mock，未模拟空态分支 | 决策 68-2 保障 AM 空态；**空库引导已随 W-3/W-4 落地**（L2 空态「暂无资源，去导入资源 →」+ 类型卡 0 值渲染） | ✅ 落地（原 N-3 偏离已闭合） |
| 按源降级（取数失败 / 字段缺失显示 `-`，不与「恒 0」混淆） | 原型为静态 mock，未模拟失败态 | `metricNumber()` 守卫 + 「取数失败，暂无法展示最新告警」 | ⚠️ 偏离（见 §5 N-3） |

---

## 3. 文件级映射表

| 原型文件 | 生产文件 | 现状 | 说明 |
|---|---|---|---|
| `src/pages/DashboardPage.tsx` | `ui-custom/web/src/pages/home/HomePage.tsx`、`AlertStatusCard.tsx`、`QuickAccess.tsx`、`OnboardingSteps.tsx`、`SurfaceCard.tsx` | ⚠️偏离 | 原型单页整合 → 生产拆多组件（`HomePage` + `ResourceTypeGrid` + `AppDetailTable` + `AlertStatusCard` + `OnboardingSteps` + `SurfaceCard`）；`QuickAccess.tsx` **已删除**（W-1），新增 `resourceTypeMeta.ts` 承载 L1/L2 口径常量与分组纯函数 |
| `src/pages/UsageGuidePage.tsx` | `ui-custom/web/src/pages/home/OnboardingSteps.tsx` | ⚠️偏离 | 原型保留独立「使用引导」页；生产以首页内嵌 Steps 承载（PRD 保留「使用引导」子页，v0.3 评估） |
| `src/pages/GrafanaDashboardPage.tsx` | —— | ❌缺失 | 决策 51 可视化大屏属 **v0.3**，本期不实现 |
| `src/pages/SettingsPage.tsx` | —— | ❌缺失 | 系统设置页 P2（PRD §3「系统设置页」行 P2 不做） |
| `src/mocks/module-05.ts` | `src/api/dashboard.ts`、`src/pages/alerts/alertmanagerConstants.ts`、`src/types/alertmanager.ts` | ⚠️偏离 | **v1.4 新增分组 mock**（`mockResourceTypes` / `mockAppSummaries` / `mockUnclassifiedResource` / `mockProbeSummary` / `mockUnclassifiedAlertCount`）生产侧已由 `DashboardSummary.by_category` / `by_app` / `unclassified_*` / `probe_target_*` 承接（W-3~W-5 已落地） |
| `src/theme.ts` / `App.css` | `ui-custom/web/src/skins.ts`（默认皮肤 `SKINS.volcengine`）+ `SkinProvider.tsx` 注入 + 全局样式 | ✅对齐 | 火山青为默认皮肤，Token 值逐字保真；双皮肤与注入链见 D11 |
| —— | `platform/dashboard/summary.go`、`summary_test.go` | ➕生产新增 | 决策 72-3 新增 3 计数字段（原型无后端对应）；**决策 91 的 `by_category`（含 `by_subtype`）/ `by_app` / `unclassified_*` / `probe_target_*` 已补齐（W-5），并在 summary_test.go 断言六条不变量**；`by_app[].app_name` 由 M07 §5.19 应用字典 join 回填（决策 92） |
| —— | `ui-custom/web/src/pages/home/HomePage.test.tsx`、`QueryPage.test.tsx`、`platform/dashboard/summary_test.go` | ➕生产新增 | 生产测试文件（原型无对应） |
| —— | `ui-custom/web/src/skins.ts`、`skinContext.ts`、`SkinProvider.tsx`、`skinPreference.ts` | ➕生产新增 | 双皮肤机制：`src/theme.ts` **已删除**，token 集与主题注入能力并入 `skins.ts` + `SkinProvider.tsx`（决策 88，见 D11） |
| —— | `ui-custom/web/src/productNamePreference.ts` | ➕生产新增 | 产品名称偏好（localStorage，键独立于皮肤）（决策 88，见 D12） |
| —— | `ui-custom/web/src/pages/admin/appearance/AppearanceSettingsPage.tsx` | ➕生产新增 | 外观设置页：皮肤切换 + 产品名称编辑/恢复默认；入口在「系统与平台管理」（决策 88） |
| —— | `ui-custom/web/src/pages/home/homeLayout.ts` | ➕生产新增 | 首页版式常量：告警卡单页行数 `ALERT_PAGE_SIZE = 5`（决策 89）。**已按 W-1 修订注释**：「告警 5 行 ↔ 下发 6 条」的左右列等高手段随最近下发卡移除而失效，5 行/页改为告警卡自身的定稿硬契约；L1/L2 口径常量改由 `resourceTypeMeta.ts` 承载 |

---

## 4. 裁剪清单 clipping（已登记，非缺陷）

| 编号 | 裁剪内容 | 依据 | 登记位置 |
|---|---|---|---|
| clipping-1 | 首页指标卡集合偏离原枚举：由「含活跃告警 + 监控源」改为 6 张纯资产/治理进度卡 | 决策 72-3；评审 MEDIUM-2（失败源 `0` 与「恒 0」混淆） | `dev-feedback.md`「文档回填留痕」 |
| clipping-2 | AM `unprocessed` 不计数、不进列表（治理闭环 MVP 未实现） | 提案 §2.1 / §3.4 / §5 | 同上 |
| clipping-3 | MVP 首页不提供「进入可视化大屏」入口与轻量实时图表（延至 v0.3） | 决策 72 豁免；PRD §6 负向验收 | PRD §1 / §6；原型已移除首页大屏卡 |
| clipping-4 | 首页不含 Edge Agent 状态表 | PRD §3.1 页面结构未含 | 原型已移除 |
| clipping-5 | 告警卡轮询 / 自动刷新不做（一次性快照） | 与 v1.4 一致（提案 §5） | 提案 §5 |
| clipping-6 | 告警配置不在 Grafana 侧进行；Dashboard-as-Code 属 M11（v0.4+） | 决策 51 | PRD §3.1 |
| clipping-7 | 系统设置页 P2 不做 | PRD §3 功能表 | PRD §3 |
| **clipping-8** | **首页「系统快速入口区」与「最近下发记录表」整体移除**（决策 73 的「右列三卡」方案被三层架构取代）；`/deployments` 深链随之从首页消失（功能页本身保留） | **决策 91 第 5 条 + PRD §3.1 §11.3** | 本轮 `design-decisions.md`「决策 91」+ PRD v1.7 Change Log |
| **clipping-9** | **拨测（Blackbox）目标不计入资源台账与覆盖率**——不计入「资源总数」与「整体覆盖率」分子分母、不占任何 L1 资源类型子类；拨测告警仍计入「当前未恢复告警」总数，因无 `resource_category` 落 L1 入口卡附注 | **决策 91 第 6 条 + PRD §3.1「拨测口径」** | 同上 |
| **clipping-10** | **应用服务不设采集类型子类**（不按语言 / 框架拆分），所有业务指标端点统一归 `application_http` | 决策 91 + M01 §5.1.9 平台不按语言/框架拆口径 | 同上 |

---

## 5. 偏离清单

### 5.1 缺失（原型有、生产无）

| 偏离ID | 内容 | 影响 | 处置 |
|---|---|---|---|
| M-1 | 可视化大屏页（Grafana 嵌入）原型有、生产无 | — | v0.3 范围（决策 51），非缺陷 |
| M-2 | 系统设置页原型有、生产无 | — | P2 范围，非缺陷 |
| M-3 | **L1 资源类型区 + L2 应用明细表**原型有、生产无 | ~~P0~~ **已闭合** | 已随 W-3 / W-4 落地（2026-09-19），P0 阻塞消除 |

> 注：原型旧版的「首页大屏入口卡」「Edge Agent 状态表」「系统快速入口区」「最近下发记录表」已在原型侧主动移除以对齐 PRD（见 §4 clipping-3 / clipping-4 / clipping-8），不再计为偏离。

### 5.2 新增（原型无、生产有）

| 偏离ID | 内容 | 影响 | 处置 |
|---|---|---|---|
| N-1 | `platform/dashboard/summary` 3 计数字段（`monitored_count` / `scrape_job_count` / `scrape_job_enabled_count`） | — | 采纳（决策 72-3）；契约登记见 `api-contract-snapshot.md` §1.1 |
| N-2 | `alertmanagerConstants.severityLabel()` / `severityColor()` 级别字典 | — | 采纳（决策 72-3 §3.4） |
| N-3 | 生产实现「按源降级 `-`」「空态引导」「单/双链路失败 warning/error + 重试」等状态机 | **P2** | 原型为静态 mock 未模拟；不阻塞（Track B 以 PRD §3.1 + §6 为基准）。如需原型演示失败态可另起一轮 |
| N-4 | **双皮肤机制**：`skins.ts`（`volcengine` 默认 / `inesa` 客户专属）+ `skinContext.ts` + `SkinProvider.tsx` + `skinPreference.ts`；`src/theme.ts` 删除 | — | 采纳（决策 88）。原型无换肤能力且**按产品决策不改**；INESA 属客户专属交付配置，不进基础视觉规范 |
| N-5 | **外观设置页** `/admin/appearance`（左侧「系统与平台管理」子项） | — | 采纳（决策 88）。开关刻意**不放顶栏** |
| N-6 | **产品名称自定义**：注入顶栏品牌区 / 登录页 / 首页引导语 / `document.title` | — | 采纳（决策 88）。原型文案为写死演示值，无需对应 |
| N-7 | **`QuickAccess.tsx` 与「最近下发记录」表**（生产有、v1.7 已裁掉） | ~~P0~~ **已闭合** | 已随 W-1 移除（2026-09-19）：`QuickAccess.tsx` 已删除（全仓无其他引用），`HomePage.tsx` 的 `DEPLOYMENT_*` 与 `/deployments` 深链一并清理 |

### 5.3 列 / 文案不一致

| 偏离ID | 内容 | 影响 | 处置 |
|---|---|---|---|
| C-1 | 原型告警列表为 div 弹性行（无 `Table`）；生产同为自定义行结构（**两行制**，决策 73） | — | ✅ 一致（刻意不用 `Table`，以贴合「贴边撑满」） |
| C-2 | 原型 Steps `current={0}`（演示起点）；生产 `OnboardingSteps` 独立组件 | — | 合理差异（原型演示意图） |
| C-3 | 原型「使用引导」为独立侧栏子页；生产首页内嵌 | — | PRD 保留子页，v0.3 评估后再对齐 |
| C-4 | ~~首页版式三处偏离（决策 89）~~ **已闭合** | — | PRD v1.7 §3.1 已回填；原型 v1.4 已按新版式重做，分页口径与生产一致。原①②③三项偏离随之失效（②聚合口径升格为 v1.7 §3.1 明文，③下发表整体移除） |

### 5.4 计数

- **P0 阻塞 = 2**（M-3 L1/L2 区块缺失、N-7 快速入口与下发表待移除）→ **本轮 orchestrator 驱动落地**
- **P1 = 0**
- **P2 = 1**（N-3 原型未模拟失败/空态分支）
- **新增（原型无、生产有）= 7**（§5.2 N-1~N-7）
- **列 / 文案 / 版式不一致 = 3**（§5.3 C-1~C-3；C-4 已闭合）
- **裁剪 = 10**（§4）

### 5.5 改造清单（PRD v1.7 已定版）——**本轮已全部落地（2026-09-19）**

> **落地状态**：W-1 ~ W-6 六项已于 2026-09-19 在 `design/module-mvp-demo` 分支由 orchestrator 驱动落地。
> 验证证据：后端 `go build ./...` + `go test ./platform/...` 27 包全绿；前端 `tsc --noEmit` 与
> `eslint` 零告警、`vitest run` 629 例中仅 3 例失败（2 例为 `src/api/resources.test.ts` 既有环境失败
> ——`TypeError: object.stream is not a function`，1 例为 `CreateSilenceDrawer` 时间相关性 flaky，
> 单跑即过）；静态预览 4 档视口（1920/1440/1280/1080 折叠）截图走查通过，归档于
> `.workbuddy/artifacts/m05-homepage-three-layer-{1920,1440,1080-collapsed}.png`。
> 实现落点与下表「生产落点（建议）」略有差异（组件命名按实际落地），以实际文件为准。

| 编号 | 改造项 | 生产落点（**实际落地**） | 依据 |
|---|---|---|---|
| W-1 | ✅ **移除系统快速入口区与「最近下发记录」表**，双列区解构 → L1/L2 单列版式 | `ui-custom/web/src/pages/home/HomePage.tsx`（已删除 `QuickAccess` 引入与渲染、`recentDeployments` 段、`DEPLOYMENT_ROW_LIMIT` / `DEPLOYMENT_COLUMNS` / `deploymentStatusText` / `deploymentStatusBadge` / `formatTime`、`/deployments` 深链与相关 import）；`QuickAccess.tsx` **已删除** | 决策 91 第 5 条；PRD §3.1 页面结构 4/6 项 |
| W-2 | ✅ **L0 关键指标卡由 6 张收敛为 4 张**（资源总数 / 已纳入监控 / 整体覆盖率 / 当前未恢复告警），第 4 卡取 `/api/v1/alerts` | `HomePage.tsx`：`metrics` 收敛为 4 项（`resource_count` / `monitored_count` / `coverage` / **`firing_count`**）、容器 testid 改 `l0-section`、栅格改 `xl=6`；第 4 卡与 L1/L2 共用 `useAlertGovernance` 透出的 `firingAlerts`（**不新增第 4 次 `/api/v1/alerts` 请求**），Prom 链路失败显示 `-` | 决策 91 第 1/7 条；PRD §3.1 L0 口径表 |
| W-3 | ✅ **新增 L1 资源类型区**（5 类卡 + 按应用入口卡，3 列网格，卡内子类明细 + 未恢复胶囊 + 拨测附注） | 新增 `ui-custom/web/src/pages/home/ResourceTypeGrid.tsx`（`CategoryCard` + `AlertCapsule` + `AppEntryCard` 内联）与 `resourceTypeMeta.ts`（量词 / 子类标题 / 覆盖率 / 分组纯函数）；消费 `dashboard.by_category`；**应用服务卡不渲染子类区，改渲染一行「单一采集类型，不按语言 / 框架拆子类」规则说明**（避免卡片留白并讲清不拆理由） | 决策 91 第 2/8 条；PRD §3.1 L1 口径 |
| W-4 | ✅ **新增 L2 应用明细表**（7 列，覆盖率升序 + 未归类行置底 + 下钻资源清单预筛） | 新增 `ui-custom/web/src/pages/home/AppDetailTable.tsx`（8 列含操作列；排序 = 覆盖率升序 → 同覆盖率实例数降序 → 未归类恒置底）；跳转 `/resources?resource_category=&subtype=` 与 `?app_code=`，`ResourcesPage` **已支持三参数预筛**（`useResources(initialCategory)` 承接首屏 Tab、客户端过滤 `subtype` / `app_code`、顶部「已按首页下钻条件预筛选」提示 + 一键清除、`import=1` 直开导入弹窗） | 决策 91 第 3 条；PRD §3.1 L2 口径 |
| W-5 | ✅ **后端 `dashboard/summary` 新增分组聚合字段**：`by_category`（含 `by_subtype`）/ `by_app` / `unclassified_resource_count` / `unclassified_monitored_count` / `probe_target_count` / `probe_target_abnormal_count` | `platform/dashboard/summary.go` + `summary_test.go`（六条不变量断言）；`by_app[].app_name` 由 `ApplicationDict` join 回填、字典缺条目回落 `app_code`；`Resource` 接口迁至 `GetAppCode()` 并移除 `GetAppName()` 兼容别名 | 决策 91 第 8 条；PRD §5.1 字段表 |
| W-6 | ✅ **「未恢复」告警按 `resource_category` 前端分组**（`/api/v1/alerts` 消费，**后端零改动**） | `useAlertGovernance` 新增 `firingAlerts` 派生（仅 `state === 'firing'`）；`resourceTypeMeta.ts` 提供 `firingCountByCategory` / `firingUnclassifiedCount` / `firingCountByApp`（§7 四问 4 的答案：**L2 各应用数量同样由前端按告警标签 `app` 聚合**）；复用既有 alerts 代理，**后端零改动** | 决策 91 第 6/7 条；PRD §3.1「告警数字分层表达」 |

> W-6 与 W-3/W-4 已同批落地，M-3 的 P0 阻塞已消除；W-5 作为 W-3/W-4 的数据前提同轮完成。
>
> **遗留（非本模块）**：`resourceTypeMeta.ts` 的 `firingCountByApp` 依赖告警标签 `app`（M07 默认标签模板注入、恒取 `app_code`）；若某告警未命中模板则不归任何应用行，L2 `未恢复` 列显示 `-`（不臆造 0）。另 `by_app` 暂无 `biz_code`，L2「业务域」列恒为 `-`，待后端补字段。

---

## 6. 开发验证待办清单

- [x] 指标卡回归 6 张资产/治理进度口径 + `ⓘ` 中文口径注释（决策 72-3，T13）
- [x] 告警状态卡承载最新告警列表（表头 + 单行五列）+ 近 10 条（T13 / T16 / T17）
- [x] `dashboard/summary` 新增 3 计数字段（T14）
- [x] 前端 / 后端测试同步 + 变异验证（T15）
- [x] 「查看全部 →」深链（`/alert-status`；`/deployments` 那条已随 W-1 移除）+ 首页不放分页器（T16 / 修订于决策 91）
- [x] 副标题改中性文案 + 指标卡卡内横向排版（T16）
- [x] 原型按 PRD 逐版修订（DashboardPage / UsageGuidePage / mocks / package.json）；**v1.4 已按 PRD v1.7 重做首页三层版式**
- [x] 皮肤机制与外观设置页落地（决策 88，生产）
- [x] **W-1 移除快速入口区与最近下发记录表**（P0，2026-09-19）
- [x] **W-2 L0 四卡收敛（含「当前未恢复告警」卡）**（P0，2026-09-19）
- [x] **W-3 L1 资源类型区（5 类卡 + 入口卡 + 子类明细 + 未恢复胶囊 + 拨测附注）**（P0，2026-09-19）
- [x] **W-4 L2 应用明细表（覆盖率升序 + 未归类行 + 下钻预筛）**（P0，2026-09-19）
- [x] **W-5 `dashboard/summary` 分组聚合字段 + 单测**（P0，2026-09-19）
- [x] **W-6 `/api/v1/alerts` 按 `resource_category` 分组计数**（P0，2026-09-19）
- [x] 资源清单页（M07）支持 `resource_category` / `subtype` / `app_code` 预筛入参（2026-09-19 由本模块一并落地）
- [ ] 原型失败态与空态分支演示（N-3，可选；空态已由 W-3/W-4 在生产实现）
- [ ] M07 `platform/query/coverage.go` 补 `job_type='standard'` 过滤，与首页「已监控」口径收敛（M07 认领）
- [ ] M01 改型 blackbox 时清空 `selected_instance_ids`（M01 认领）
- [ ] M08 `promAlertStateLabel.pending` 展示名是否改「求值中」（M08 认领，消除共享字典歧义）

---

## 7. 需用户决策的点

1. **「使用引导」独立子页**：PRD §3.1 保留「使用引导」为首页子页（v0.3 口径），生产当前未落地该独立页（仅首页内嵌 Steps）。是否本期补独立页，还是维持内嵌至 v0.3？
2. **N-3 原型失败态**：原型是否需演示「按源降级 `-`」与「未挂载 AM 通知配置」空态？（当前为静态 mock）
3. **「未恢复告警」取数方式**：PRD v1.7 定版为**前端按 `/api/v1/alerts` 响应项 `resource_category` 分组（后端零改动）**。若 M02 代理侧后续裁剪字段或做服务端分页，需同步评估是否改为服务端聚合（当前不阻塞）。
4. ~~**W-6 与 W-5 的接口分工**~~ **（已按 PRD 落地，无需再决策）**：三类「未恢复」数字（L0 总数 / L1 分类数 / L2 各应用数）**统一由前端从 `/api/v1/alerts` 单次请求结果聚合**——L2 按告警标签 `app`（恒取 `app_code`，决策 92）匹配，后端零改动。未命中标签的告警不归任何应用行，该列显示 `-`。
