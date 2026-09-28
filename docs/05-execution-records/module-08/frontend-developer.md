# frontend-developer 执行记录:module-08

## 任务 T08-排列对齐：告警收敛排版对齐

- 角色:frontend-developer
- 任务 ID:T08-排版对齐(M08 告警收敛与通知管理:页面头统一模式 + 当前生效配置结构化 + 共享组件复用)
- 分支:`feat/module-08-alert-dispatch`
- 日期:2026-09-02

## 输入文档

- PRD:`docs/02-product-requirements/Modules/Module_08_Alert_Dispatch.md`(告警收敛与通知管理)
- 工程标准:`docs/03-engineering-standards/02_Frontend_Standard.md`(页面头统一模式、复用 FilterBar / tablePresets / EllipsisText)
- 参照:`src/pages/resources/ResourcesPage.tsx` / 配置中心页头部结构(页面头 Card 统一模式)

## 改动文件列表

- 修改 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`(页面头 Card 统一模式;「当前生效配置」由裸 `<pre>` 改结构化 Descriptions + 只读 pre;保留查看/挂载动线)
- 修改 `ui-custom/web/src/pages/alerts/SilencesPage.tsx`(页面头 Card extra「创建静默」;移除未用 Title)
- 修改 `ui-custom/web/src/pages/alerts/AlertsPage.tsx`(占位页对齐 MainLayout + Card 页面头)
- 修改测试 `AlertConfigPage.test.tsx` / `SilencesPage.test.tsx` / `alertSmoke.test.tsx`(适配页面自带 MainLayout 后的渲染与重复文案)

## 关键实现说明

- 与告警模块页面文案/功能保持一致,仅排版与组件复用;页面组件自带 `MainLayout`(与其他模块一致),路由层不再包裹
- `AlertConfigPage`:「当前生效配置」用 `Descriptions`(版本 ID/状态/生效时间/应用人/M09 变更单/校验和)+ 只读 pre;版本 ID 缺陷文案 `acv-1` 在生效区与历史表各出现一次,测试改 `findAllByText`
- `SilencesPage`:`Title` 未用告警消除;渲染归入 `MainLayout` + `MemoryRouter`
- 复用 `tablePresets`(TABLE_PAGINATION/TABLE_SCROLL_X)、静默页复用 `FilterBar` / `EllipsisText`

## 遇到的问题与解决

- **SilencesPage 全部单测失败**:页面加入 `MainLayout` 后依赖 react-router 上下文,原测试仅 `<App>` 包裹缺 `MemoryRouter`,补包后通过
- **alertSmoke 双 MainLayout**:页面自身带 `MainLayout`,测试又包裹一层导致「告警配置」menuitem 重复;移除测试侧外层 MainLayout,页面自带布局生效
- **「静默管理」文案重复**:侧边栏二级菜单 + 页面 Card 标题各出现一次,断言改 `getAllByText(...).length > 0`

## 验证结果

- `pnpm vitest run`(AlertConfigPage / SilencesPage / alertSmoke / alertmanagerConstants)32 用例通过;`pnpm lint`(`--max-warnings 0`)通过
- dev server 验证 /alert-config、/silences 均 200(`curl --noproxy '*'`),验证后已停服

## 遗留风险 / 待确认

- `AlertsPage`(告警状态)目前为占位页且未挂路由,仅对齐排版;告警列表实际接入见后续任务

## 任务 T08-F8:规则编辑跨模块联动入口 + D-1b 菜单副标题(PL-1)

- 角色:frontend-developer
- 任务 ID:T08-F8(M08 告警配置口径与通知渲染桥·迭代一 PL-1)
- 分支:`feat/module-08-alert-dispatch`
- commit:`165588b`
- 日期:2026-09-28

### 输入文档

- 设计提案(设计空间,只读):`CNCF_Monitor-worktree/docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md`(§2/§3.1/§3.2/§4.1/§6 迭代一)
- 裁决:决策 D-1=方案丙(导航完全不动)、D-1b=ⓐ(「规则编辑」名称与归属不变,补副标题/定位文案)

### 改动文件列表

- 新增 `ui-custom/web/src/components/RuleGuideLink.tsx`(共享引导组件:导出 `RULES_PATH`/`RULE_GUIDE_TEXT`/`RULE_GUIDE_PREFIX`、`RuleGuideLink`、`RuleGuideEmpty`)
- 新增测试 `ui-custom/web/src/components/RuleGuideLink.test.tsx`(2 例)
- 修改 `ui-custom/web/src/pages/alerts/AlertStatusPage.tsx`(PromAlertsView Table `locale.emptyText` 四分支,空态挂 `RuleGuideEmpty`)
- 修改 `ui-custom/web/src/pages/alerts/HistoryAlertsPage.tsx`(Table `locale.emptyText` 四分支,空态挂 `RuleGuideEmpty`)
- 修改 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`(配置说明卡补跨模块说明 + `RuleGuideLink`)
- 修改 `ui-custom/web/src/layouts/MainLayout.tsx`(「规则编辑」菜单项补副标题结构,归属判定未动)
- 修改 `ui-custom/web/src/App.css`(新增 `.app-sider-label-stacked` / `.app-sider-sub-label`)
- 修改 `ui-custom/web/src/pages/strategy/RulesPage.tsx`(顶部定位文案)
- 修改测试 `MainLayout.test.tsx`(新增 D-1b 用例)、`RulesPage.test.tsx`(新增定位文案用例)、`AlertStatusPage.test.tsx`(新增 3 例)、`HistoryAlertsPage.test.tsx`(新增 2 例)、`AlertConfigPage.test.tsx`(新增 1 例)
- 修改 `docs/04-source-architecture/repo-map.md`(新增 RuleGuideLink.tsx 符号,pre-commit 门禁强制)

### 关键实现说明

- 空态引导复用既有「Empty + Link」同构模式(参照 `pages/home/AlertStatusCard.tsx` / `ProbePanel.tsx` / `pages/config-center/nodes/EdgeAgentsPage.tsx`),并抽成共享组件三处引用,统一落点 `/rules` 与文案
- 空态四分支(loading / error / 无数据 / 筛选后无匹配):仅「无数据」展示「去写规则」引导;error 不把失败伪装成无数据,筛选无匹配不误导为「没有规则」
- D-1 方案丙导航零变更:`/rules` 路由、页面文件、`resolveActiveModule` 归属判定均未改动,仅菜单 label 结构 + 页面顶部文案
- D-1b ⓐ:菜单项文本 = 主标题「规则编辑」+ 副标题「含告警规则、记录规则」

### 遇到的问题与解决

- `AlertStatusPage.test.tsx` 新增用例 `within(promPane).getByRole('combobox')` 报 `getMultipleElementsFoundError`(面板内状态 + 网域两个下拉):改为 `getAllByRole('combobox')[0]`(第一个=状态筛选)
- 任务书锚点「M09 生成巡检的空态引导」在 `ui-custom/web/src` 无字面命中:改用既有 `Empty + Link` 同构模式并抽共享组件

### 验证结果

- `vitest run src/components/RuleGuideLink.test.tsx src/layouts/MainLayout.test.tsx src/pages/strategy/RulesPage.test.tsx src/pages/alerts`:10 文件 / 110 用例全通过
- `pnpm lint`(`eslint . --ext ts,tsx`):0 告警
- dev server(`./node_modules/.bin/vite --host`):`/`、`/alert-status`、`/alert-history`、`/alert-config`、`/rules` 均 200;验证后已停服,端口 5173 释放
- `make check-repo-map`:与当前业务代码一致(commit 时 pre-commit hook 通过)

### 遗留风险 / 待确认

- 无;导航归属零变更,未发现契约/原型矛盾

## 任务 T08-F9:告警配置口径澄清(三块必写/两块豁免 + 最小骨架示例)(PL-2)

- 角色:frontend-developer
- 任务 ID:T08-F9(M08 告警配置口径与通知渲染桥·迭代一 PL-2)
- 分支:`feat/module-08-alert-dispatch`
- commit:`0807b3b`
- 日期:2026-09-28

### 输入文档

- 设计提案(设计空间,只读):`CNCF_Monitor-worktree/docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md`(§2/§3.2 全节/§4.2/§6 迭代一)
- 只读参考服务端校验口径:`platform/alertmanager/config/validate.go`(amtool check-config 等价校验)

### 改动文件列表

- 修改 `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`(新增 `SILENCES_PATH`、`AlertConfigScopeBlock` 接口、`ALERT_CONFIG_REQUIRED_BLOCKS`、`ALERT_CONFIG_EXEMPT_BLOCKS`、`ALERTMANAGER_MIN_SKELETON`)
- 修改 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`(配置说明卡:三块必写 + 两块豁免 + 最小骨架展示)
- 修改 `ui-custom/web/src/pages/alerts/AlertConfigDrawer.tsx`(新增「插入骨架示例」按钮 + 提示)
- 新增测试 `ui-custom/web/src/pages/alerts/AlertConfigDrawer.test.tsx`(2 例)
- 修改测试 `ui-custom/web/src/pages/alerts/AlertConfigPage.test.tsx`(新增 PL-2 说明卡用例;既有「生效配置」用例的 `resolve_timeout` 断言改 `getAllByText` 以适配骨架新增命中)
- 修改 `docs/04-source-architecture/repo-map.md`(新增口径常量符号)

### 关键实现说明

- 口径与服务端 amtool 校验一致:说明卡只承诺 `receivers` / `route`+`routes` / `inhibit_rules` 三块必写,不承诺校验器不校验的字段;`global` 标注「按需最简(邮件渠道才需 smtp_*)」,不列为必写块
- 最小骨架以 `amtool check-config` 实测校验通过(SUCCESS:语法 + route/receiver 引用闭合 + receiver 字段类型),使用合法的 `webhook_configs`(含 `send_resolved`),弃用原型 mock 中非法的 `dingtalk_configs`(dev-feedback #1 已记录)
- 抑制示例用中性「critical 抑制 warning(equal network_domain)」,与平台已自动生成的网域离线抑制规则(§3.2.2)区分,避免误导用户以为需手写该条
- 豁免项 ④ 静默给出 `/silences` 入口;豁免项 ⑤ 通知模板 `path=null` 只出文案、不渲染链接(迭代一不制造死链);已登记 dev-feedback #14
- 抽屉「插入骨架示例」对齐 M01 规则挂载读序(说明 → 选文件 → 编辑框),插入后清空上一次校验结论,用户可直接「本地大小检查 → 提交」

### 遇到的问题与解决

- `AlertConfigPage.test.tsx` 既有用例 `getByText(/resolve_timeout/)` 因说明卡骨架新增命中而变多元素:改 `getAllByText(...).length > 0`
- 全量 `pnpm test` 有 4~5 个非本模块失败文件(resources 抽屉、产品名偏好、外观设置等,见「验证结果」):经隔离复现确认为**存量失败**(资源模块测试的 `vi.mock` 未提供新导出 `serviceDictApi`、jsdom localStorage 环境问题),与本迭代无关,不在本次改动范围

### 验证结果

- `vitest run src/pages/alerts`:8 文件 / 84 用例全通过
- `pnpm lint`(`eslint . --ext ts,tsx`):0 告警
- `make check-repo-map`:与当前业务代码一致(commit 时 pre-commit hook 通过)
- `amtool check-config`(上游 `upstream/alertmanager/amtool`)对骨架校验 SUCCESS(生产用例已断言骨架内容)
- **全量 `pnpm test` 未全绿**:88 文件 / 806 用例中 5 文件 / 58 用例失败,全部为**存量失败且均不属 M08**(`pages/resources/ResourceDetailDrawer`、`pages/resources/ResourceFormDrawer`、`pages/admin/appearance/AppearanceSettingsPage`、`productNamePreference`、偶发 `pages/admin/domains/DeleteDomainModal`);隔离复现同样失败,根因为资源模块测试 mock 缺 `serviceDictApi` 导出 + jsdom localStorage 环境问题,与本次改动零关联(未 import 任何改动文件)

### 遗留风险 / 待确认

- 迭代一不制造死链:豁免项 ⑤ 通知模板待 PL-3 落地后回补入口(dev-feedback #14,open)
- 全量测试存量为红(resources 等 5 文件),非本迭代引入,建议另行派单修复

## 本迭代(迭代一 PL-1 + PL-2)收尾

- 输入文档:设计提案 `.../module-08/design-proposals/alert-config-scope-and-notification-bridge.md`(迭代一 PL-1 + PL-2)、`platform/alertmanager/config/validate.go`(只读校验口径)、`docs/03-engineering-standards/02_Frontend_Standard.md`
- 交付:2 个 commit(`165588b` T08-F8 / `0807b3b` T08-F9),均只动 `ui-custom/web/src/**` 与 `docs/04-source-architecture/repo-map.md`;PL-3(通知渲染桥)按裁决不在本迭代
- 裁决落地:D-1 方案丙(导航零变更,`/rules` 归属/路由/页面文件未动)、D-1b ⓐ(「规则编辑」菜单副标题 + 规则页定位文案)
- 遗留风险:全量 `pnpm test` 存量红(非本模块,见 T08-F9 验证结果);豁免项 ⑤ 前向引用待 PL-3 回补
- 下一步:交 frontend-reviewer 审查 → Orchestrator 合并 `develop`;PL-3(迭代二)独立派单(前端通知渠道/模板管理页)