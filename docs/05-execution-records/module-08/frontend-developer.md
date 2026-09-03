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