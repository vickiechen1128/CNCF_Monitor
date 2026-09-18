# Module_05 前端「原型 ↔ 生产」映射与偏离清单

> 依 `frontend-developer.md` Step 3.5 六项核对，补齐 module-05 长期缺失的映射基线（前批审查已登记为遗留风险，见 `design-proposals/homepage-mvp-content-restructure.md` §8.3）。
>
> - 权威基底（只读，不修改）：`docs/prototypes/module-05/src/**`（**原型 v1.2.1**，已按 PRD v1.5 修订）
> - 生产实现（只读，不修改）：`ui-custom/web/src/pages/home/**`、`ui-custom/web/src/pages/query/QueryPage.tsx`、`ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`、`ui-custom/web/src/api/dashboard.ts`、`platform/dashboard/summary.go`
> - 契约（前端第一权威）：`api-contract-snapshot.md`
> - 决策基线：`design-decisions.md` 决策 72 / 72-1 / 72-2 / 72-3、决策 51（v0.3 大屏）、决策 68-2（AM 投递接线）
> - 生成日期：2026-09-14；分支：`design/module-mvp-demo`（原型与文档）/ `feat/module-05-homepage-mvp`（生产）
> - 现状字段含义：✅对齐 = 生产已完成且与原型一致或为合理生产替代；⚠️偏离 = 存在差异（见 §5）；❌缺失 = 原型有生产无；➕生产新增 = 原型无生产有。

---

## 1. 决策落版

| 编号 | 决策点 | 原型表现 | 生产采纳态 | 状态 |
|------|--------|----------|------------|------|
| D1 | 视觉 Token | 火山引擎 Token：主色 `#0ECDEB`、头部 `#0B1B2A`、内容背景 `#F7F8FA`；卡片圆角 8px | `src/skins.ts` 全局注入（**默认皮肤 `volcengine`**，取值逐字保真）；卡片圆角/阴影/间距按决策 72-2 规范 | ✅ 采纳（决策 88 在其上叠加皮肤层，见 D11） |
| D2 | 页面结构 | 标题区 → 指标卡网格 → 双列区（左：告警状态卡；右：快速入口 → 最近下发 → **使用指引**）（决策 72-2 / 73） | 同序落 `HomePage.tsx`；**使用指引移出右列 → 双列下方整宽一行**（决策 89） | ⚠️ 偏离（见 §5.3 C-4） |
| D3 | 指标卡口径 | 6 张纯资产/治理进度卡 + `ⓘ` 中文口径注释 + 6 列网格 + 卡内横向排版（决策 72-3） | 同款；卡内改**纵向**排版（标签 12px 在上 / 数字 30px·800 / 44px 圆角图标容器右下，决策 73）；`MetricCard` + `SurfaceCard` 承载 | ✅ 采纳（决策 73 修订排版） |
| D4 | 告警卡承载 | 告警状态卡 = 首页**唯一**告警入口：主数字「通知中」+ 已静默/已抑制 + 最新 **10** 条告警（表头 + 单行五列）+ Prom 11px 参考行 | `AlertStatusCard.tsx`；主数字改**四格统计条**（当日 / 近 7 天为主数字，决策 73）；列表改 **8 条两行制**（`LATEST_ALERT_LIMIT = 8`）、`ALERT_COL_WIDTH`、`LatestAlertHeader` | ✅ 采纳（决策 73 修订口径与形态） |
| D5 | 分页与深链 | 首页**不放分页器**；两卡标题右侧「查看全部 →」（`/alert-status`、`/deployments`）；告警中心入口不重复 | 下发表 `pagination={false}` + 标题 `extra` 深链；**告警卡改为卡内分页**（每页 5 行，`homeLayout.ALERT_PAGE_SIZE`，决策 89） | ⚠️ 偏离（见 §5.3 C-4） |
| D6 | 六步指引 | 登记网域 → 导入资源 → 建采集 Job → 下发 → **配置告警通知** → 查指标/看告警（决策 72-1） | `OnboardingSteps.tsx`（`/alert-config` + `/query`/`/alert-status`）；位置偏离见 D2 | ✅ 采纳（位置见 §5.3 C-4） |
| D7 | QueryPage | 自定义轻量 PromQL 查询（输入框 + 表格/JSON），走 M02 `/api/v1/query` 代理，**禁止复用 Prometheus UI** | `pages/query/QueryPage.tsx`（`queryApi`） | ✅ 采纳 |
| D8 | `unprocessed` | 不计数、不进列表；仅 N>0 时一行 11px 灰字附注；页面不出现「待处理」 | 同款；Prom pending 用本地常量 `PROM_EVAL_LABEL` 展示「求值中」 | ✅ 采纳（裁剪登记见 §4） |
| D9 | 大屏入口 | **MVP 首页不含**「进入可视化大屏」入口（决策 72 豁免，延至 v0.3） | 同款；`GrafanaDashboardPage` / 一级菜单为 v0.3 能力 | ✅ 采纳（原型 v1.2.1 已移除首页大屏卡） |
| D10 | 导航层级（v0.3） | 首页（第 1 位）+ 可视化大屏（第 2 位）+ 系统设置 | v0.3 范围，本期不实现 | 已决策·未实施 |
| D11 | 皮肤与外观配置 | 原型**无**（单一火山青 Token，无换肤能力） | `src/skins.ts`（`volcengine` 默认 / `inesa` 可切换）+ `skinContext.ts` + `SkinProvider.tsx` + `skinPreference.ts`；开关页 `/admin/appearance`（系统与平台管理，**不放顶栏**） | ➕生产新增（决策 88；原型按产品决策「甲」不改） |
| D12 | 产品名称自定义 | 原型**无**（品牌文案写死） | `productNamePreference.ts`；注入顶栏品牌区 / 登录页 / 首页引导语 / `document.title`；`/admin/appearance` 可编辑与恢复默认 | ➕生产新增（决策 88） |

---

## 2. 首页组件 ↔ PRD 条目映射（PRD §3.1 v1.6；生产实现 as-built 已含决策 88 / 89）

> 覆盖范围：PRD §3.1「首页（MVP 子集）交互契约」6 项页面结构 + 关键指标卡口径表 + 告警状态数字 + 视觉 Token 规范。

| PRD §3.1 条目 | 原型实现（`docs/prototypes/module-05`） | 生产实现（`ui-custom/web/src`） | 对齐 |
|---|---|---|---|
| ① 标题区（主标题 + 中性副标题，不写「按下方指引」） | `pages/DashboardPage.tsx`：`Title level={3}` + 中性副标题 | `pages/home/HomePage.tsx` 标题区 | ✅ |
| ② 关键指标卡区（6 张资产/治理进度卡，无告警数字） | `DashboardPage.tsx` `metricCards`（6 项） | `HomePage.tsx` `MetricCard` × 6（`data-testid="metric-*"`） | ✅ |
| ②-a 每张右上角 `ⓘ` 中文口径注释 | `Tooltip` + `InfoCircleOutlined`（`aria-label` 可聚焦） | 同款（悬浮/聚焦读出中文口径） | ✅ |
| ②-b 6 列网格 + 卡内**纵向**排版（标签 12px 在上 / 数字 30px·800 中下 / 44px 图标容器右下，决策 73） | `Col xl={4}` + flex 纵向排版 | 同款；`styles.body.padding = '14px 16px'`，无 `minHeight` | ✅ |
| ②-c 移除「活跃告警」卡，「监控源」不进首页 | 原型 v1.2.1 已移除 | 同款 | ✅（裁剪 §4 clipping-1） |
| ③ 告警状态卡（**四格统计条**：当日 / 近 7 天为主数字 + 通知中 + 已静默·已抑制，决策 73） | `DashboardPage.tsx` 告警卡数字区 | `AlertStatusCard.tsx` 四格统计条 | ✅ |
| ③-a 最新告警列表（**两行制**：行 1 级别浅底 Tag + 告警名 + 相对时间 + 状态；行 2 实例名 · 告警内容 `summary`，决策 73） | `AlertListHeader` + `AlertRow`（共用 `ALERT_COL_WIDTH`） | `LatestAlertHeader` + `LatestAlertRow`（共用 `ALERT_COL_WIDTH`） | ✅ |
| ③-b 最新告警条数 = **8**（`starts_at` 倒序，剔除 `unprocessed`，`resource_name` 空显 `-`）；卡内**每页 5 行**分页 | `LATEST_ALERT_LIMIT = 8`（原型 v1.3）+ 8 条 mock | `LATEST_ALERT_LIMIT = 8` + `homeLayout.ALERT_PAGE_SIZE = 5` | ⚠️ 分页偏离（见 §5.3 C-4） |
| ③-c Prom 求值态仅 11px 灰字参考行（触发中 / 求值中） | 底栏 11px 灰字 + `PROM_EVAL_LABEL` | 同款 | ✅ |
| ③-d 标题右侧「查看全部 →」`/alert-status`；卡内不重复；底部仅「配置告警通知 →」 | `extra={<Link to="/alert-status">}` + 底部 `/alert-config` | 同款（页脚 `margin-top:auto` 贴底，决策 89） | ✅ |
| ③-e `unprocessed` 不计数不进列表，仅 N>0 灰字附注 | 灰字附注 + `Tooltip` 说明 | 同款 | ✅（裁剪 §4 clipping-2） |
| ④ 系统快速入口区（5 张快捷卡，**一行五列压扁**、28px 图标容器，决策 73） | `mockQuickAccess` 5 项 | `QuickAccess.tsx` | ✅ |
| ⑤ 使用指引区（六步 Steps，逐步深链；第 5 步 `/alert-config`，第 6 步 `/query` 或 `/alert-status`） | `DashboardPage` **右列第三张卡**（v1.3）+ 独立页 `UsageGuidePage.tsx` | `OnboardingSteps.tsx`，位于**双列下方整宽一行**（决策 89） | ⚠️ 位置偏离（见 §5.3 C-4） |
| ⑥ 最近下发记录表（前 **6** 条，标题右侧「查看全部 →」`/deployments`，不放分页器） | `Table` 4 列 + `pagination={false}` + `extra` 深链 | 同款（`DEPLOYMENT_COLUMNS` / `DEPLOYMENT_ROW_LIMIT = 6`，决策 89） | ⚠️ 条数偏离（见 §5.3 C-4） |
| 视觉 Token 规范（色彩收敛 / 卡片 8px / 间距 / 字体层级 / 图标尺寸） | 原型 Token 一致；指标卡装饰图标统一品牌青、无红色 | `src/skins.ts`（默认皮肤 `volcengine`）+ 组件内 styles；新增自绘色值须走 `useSkin().tokens` | ✅ |
| 空态引导（未挂载 AM 通知配置 → 「尚未挂载通知配置，去配置 →」`/alert-config`） | 原型为静态 mock，未模拟空态分支 | 决策 68-2 保障；`AlertStatusCard` 空态引导 | ⚠️ 偏离（见 §5 N-3） |
| 按源降级（取数失败 / 字段缺失显示 `-`，不与「恒 0」混淆） | 原型为静态 mock，未模拟失败态 | `metricNumber()` 守卫 + 「取数失败，暂无法展示最新告警」 | ⚠️ 偏离（见 §5 N-3） |

---

## 3. 文件级映射表

| 原型文件 | 生产文件 | 现状 | 说明 |
|---|---|---|---|
| `src/pages/DashboardPage.tsx` | `ui-custom/web/src/pages/home/HomePage.tsx`、`AlertStatusCard.tsx`、`QuickAccess.tsx`、`OnboardingSteps.tsx`、`SurfaceCard.tsx` | ⚠️偏离 | 原型单页整合 → 生产拆多组件（合理拆分）；区块与列见 §2 |
| `src/pages/UsageGuidePage.tsx` | `ui-custom/web/src/pages/home/OnboardingSteps.tsx` | ⚠️偏离 | 原型保留独立「使用引导」页；生产以首页内嵌 Steps 承载（PRD 保留「使用引导」子页，v0.3 评估） |
| `src/pages/GrafanaDashboardPage.tsx` | —— | ❌缺失 | 决策 51 可视化大屏属 **v0.3**，本期不实现 |
| `src/pages/SettingsPage.tsx` | —— | ❌缺失 | 系统设置页 P2（PRD §3「系统设置页」行 P2 不做） |
| `src/mocks/module-05.ts` | `src/api/dashboard.ts`、`src/pages/alerts/alertmanagerConstants.ts`、`src/types/alertmanager.ts` | ✅对齐 | mock → API client + 类型契约（一致） |
| `src/theme.ts` / `App.css` | `ui-custom/web/src/skins.ts`（默认皮肤 `SKINS.volcengine`）+ `SkinProvider.tsx` 注入 + 全局样式 | ✅对齐 | 火山青为默认皮肤，Token 值逐字保真；双皮肤与注入链见 D11 |
| —— | `platform/dashboard/summary.go`、`summary_test.go` | ➕生产新增 | 决策 72-3 新增 3 计数字段（原型无后端对应） |
| —— | `ui-custom/web/src/pages/home/HomePage.test.tsx`、`QueryPage.test.tsx`、`platform/dashboard/summary_test.go` | ➕生产新增 | 生产测试文件（原型无对应） |
| —— | `ui-custom/web/src/skins.ts`、`skinContext.ts`、`SkinProvider.tsx`、`skinPreference.ts` | ➕生产新增 | 双皮肤机制：`src/theme.ts` **已删除**，token 集与主题注入能力并入 `skins.ts` + `SkinProvider.tsx`（决策 88，见 D11） |
| —— | `ui-custom/web/src/productNamePreference.ts` | ➕生产新增 | 产品名称偏好（localStorage，键独立于皮肤）（决策 88，见 D12） |
| —— | `ui-custom/web/src/pages/admin/appearance/AppearanceSettingsPage.tsx` | ➕生产新增 | 外观设置页：皮肤切换 + 产品名称编辑/恢复默认；入口在「系统与平台管理」（决策 88） |
| —— | `ui-custom/web/src/pages/home/homeLayout.ts` | ➕生产新增 | 首页版式常量：告警卡单页行数 `ALERT_PAGE_SIZE = 5`（决策 89） |

---

## 4. 裁剪清单 clipping（已登记，非缺陷）

| 编号 | 裁剪内容 | 依据 | 登记位置 |
|---|---|---|---|
| clipping-1 | 首页指标卡集合偏离原枚举：由「含活跃告警 + 监控源」改为 6 张纯资产/治理进度卡 | 决策 72-3；评审 MEDIUM-2（失败源 `0` 与「恒 0」混淆） | `dev-feedback.md`「文档回填留痕」 |
| clipping-2 | AM `unprocessed` 不计数、不进列表（治理闭环 MVP 未实现） | 提案 §2.1 / §3.4 / §5 | 同上 |
| clipping-3 | MVP 首页不提供「进入可视化大屏」入口与轻量实时图表（延至 v0.3） | 决策 72 豁免；PRD §6 负向验收 | PRD §1 / §6；原型 v1.2.1 已移除首页大屏卡 |
| clipping-4 | 首页不含 Edge Agent 状态表（原型旧版有，PRD v1.5 §3.1 页面结构未含） | PRD §3.1 v1.5 六项结构 | 原型 v1.2.1 已移除 |
| clipping-5 | 告警卡轮询 / 自动刷新不做（一次性快照） | 与 v1.4 一致（提案 §5） | 提案 §5 |
| clipping-6 | 告警配置不在 Grafana 侧进行；Dashboard-as-Code 属 M11（v0.4+） | 决策 51 | PRD §3.1 |
| clipping-7 | 系统设置页 P2 不做 | PRD §3 功能表 | PRD §3 |

---

## 5. 偏离清单

### 5.1 缺失（原型有、生产无）

| 偏离ID | 内容 | 影响 | 处置 |
|---|---|---|---|
| M-1 | 可视化大屏页（Grafana 嵌入）原型有、生产无 | — | v0.3 范围（决策 51），非缺陷 |
| M-2 | 系统设置页原型有、生产无 | — | P2 范围，非缺陷 |

> 注：原型旧版的「首页大屏入口卡」「Edge Agent 状态表」已在 **原型 v1.2.1** 主动移除以对齐 PRD v1.5（见 §4 clipping-3 / clipping-4），不再计为偏离。

### 5.2 新增（原型无、生产有）

| 偏离ID | 内容 | 影响 | 处置 |
|---|---|---|---|
| N-1 | `platform/dashboard/summary` 3 计数字段（`monitored_count` / `scrape_job_count` / `scrape_job_enabled_count`） | — | 采纳（决策 72-3）；契约登记见 `api-contract-snapshot.md` §1.1 |
| N-2 | `alertmanagerConstants.severityLabel()` / `severityColor()` 级别字典 | — | 采纳（决策 72-3 §3.4） |
| N-3 | 生产实现「按源降级 `-`」「空态引导」「单/双链路失败 warning/error + 重试」等状态机 | **P2** | 原型为静态 mock 未模拟；不阻塞（Track B 以 PRD §3.1 + §6 为基准）。如需原型演示失败态可另起一轮 |
| N-4 | **双皮肤机制**：`skins.ts`（`volcengine` 默认 / `inesa` 客户专属）+ `skinContext.ts` + `SkinProvider.tsx` + `skinPreference.ts`；`src/theme.ts` 删除 | — | 采纳（决策 88）。原型无换肤能力且**按产品决策不改**；INESA 属客户专属交付配置，不进基础视觉规范 |
| N-5 | **外观设置页** `/admin/appearance`（左侧「系统与平台管理」子项）：皮肤二选一 + 产品名称编辑/恢复默认 | — | 采纳（决策 88）。开关刻意**不放顶栏** |
| N-6 | **产品名称自定义**：注入顶栏品牌区 / 登录页 / 首页引导语 / `document.title`；`index.html` 静态 `<title>` 仅作 JS 未执行兜底 | — | 采纳（决策 88）。原型文案为写死演示值，无需对应 |

### 5.3 列 / 文案不一致

| 偏离ID | 内容 | 影响 | 处置 |
|---|---|---|---|
| C-1 | 原型告警列表为 div 弹性行（无 `Table`）；生产同为自定义行结构（**两行制**，决策 73） | — | ✅ 一致（刻意不用 `Table`，以贴合「贴边撑满」） |
| C-2 | 原型 Steps `current={0}`（演示起点）；生产 `OnboardingSteps` 独立组件 | — | 合理差异（原型演示意图） |
| C-3 | 原型「使用引导」为独立侧栏子页；生产首页内嵌 | — | PRD §3.1 v0.3 保留子页，v0.3 评估后再对齐 |
| C-4 | **首页版式三处偏离**（决策 89）：① 使用指引由**右列第三张卡** → **双列下方整宽一行**；② 告警卡由「首页不放分页器」→ **卡内分页，每页 5 行**（`homeLayout.ALERT_PAGE_SIZE = 5`）；③ 最近下发记录由「前 5 条」→ **6 条**（`DEPLOYMENT_ROW_LIMIT = 6`），与告警 5 行配套使两列近似等高 | **P2** | 产品决策「甲」（2026-09-18）：**原型不改**，登记为本表偏离；PRD §3.1 第 4/5/6 项 + 「布局与列设计」段 + §6 验收待 **v1.7** 回填（当前遵守 PRD 冻结门禁）。过渡期以本行 + `dev-feedback.md` 反馈 6 为口径依据 |

### 5.4 计数

- **P0 阻塞 = 0**
- **P1 = 0**
- **P2 = 2**（N-3 原型未模拟失败/空态分支；C-4 版式三处偏离待 PRD v1.7 回填）→ 均不阻塞验收
- **新增（原型无、生产有）= 6**（§5.2 N-1~N-6）
- **列 / 文案 / 版式不一致 = 4**（§5.3 C-1~C-4）
- **裁剪 = 7**（§4）

---

## 6. 开发验证待办清单

- [x] 指标卡回归 6 张资产/治理进度口径 + `ⓘ` 中文口径注释（决策 72-3，T13）
- [x] 告警状态卡承载最新告警列表（表头 + 单行五列）+ 近 10 条（T13 / T16 / T17）
- [x] `dashboard/summary` 新增 3 计数字段（T14）
- [x] 前端 / 后端测试同步 + 变异验证（T15）
- [x] 「查看全部 →」深链（`/alert-status`、`/deployments`）+ 首页不放分页器（T16）
- [x] 副标题改中性文案 + 指标卡卡内横向排版（T16）
- [x] 原型 v1.2.1 按 PRD v1.5 修订（DashboardPage / UsageGuidePage / mocks / package.json）
- [ ] 原型失败态与空态分支演示（N-3，可选）
- [ ] M07 `platform/query/coverage.go` 补 `job_type='standard'` 过滤，与首页「已监控」口径收敛（M07 认领）
- [ ] M01 改型 blackbox 时清空 `selected_instance_ids`（M01 认领）
- [ ] M08 `promAlertStateLabel.pending` 展示名是否改「求值中」（M08 认领，消除共享字典歧义）

---

## 7. 需用户决策的点

1. **「使用引导」独立子页**：PRD §3.1 保留「使用引导」为首页子页（v0.3 口径），生产当前未落地该独立页（仅首页内嵌 Steps）。是否本期补独立页，还是维持内嵌至 v0.3？
2. **N-3 原型失败态**：原型是否需演示「按源降级 `-`」与「未挂载 AM 通知配置」空态？（当前为静态 mock）
3. **`monitored_count` 计数口径 owner**：新增字段涉及 M01（ScrapeJob 选区）与 M07（资源表 / 覆盖率）数据，需在后续 PRD 明确归属与同步责任（提案 §8.4 遗留）。
