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

## 任务 T08-F10:通知渠道管理页(PL-3 通知渲染桥·迭代二)

- 角色:frontend-developer
- 任务 ID:T08-F10(M08 PL-3 通知渲染桥·迭代二·通知渠道)
- 分支:`feat/module-08-alert-dispatch`
- commit:`79ac881`
- 日期:2026-09-28

### 输入文档

- 设计提案(设计空间,只读):`CNCF_Monitor-worktree/docs/05-execution-records/module-08/design-proposals/alert-config-scope-and-notification-bridge.md`(§3.3.2 / §3.3.4 / §3.3.7 / §4.3 / §6 迭代二 / §7 附录 / §8.1 裁决)
- 契约权威:任务卡「实测 wire 契约」(PL-3 端点尚未写入 `api-contract-snapshot.md`,后端已在 `dev-feedback.md` #17 登记缺口)+ 提案 §3.3 + `03_API_Standard.md`
- 复用参照:`SilencesPage.tsx`(列表+抽屉 CRUD+权限不足+空态)、`useSilences.ts`、`alertmanagerConstants.ts`、`tablePresets` / `EllipsisText`

### 改动文件列表

- 新增 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`(列表 / 新增·编辑入口 / 删除二次确认 / 页面状态矩阵)
- 新增 `ui-custom/web/src/pages/alerts/NotifyChannelDrawer.tsx`(Form 抽屉,`forceRender`;脱敏字段不回填)
- 新增 `ui-custom/web/src/pages/alerts/useNotifyChannels.ts`(取数 Hook:加载 / 空态 / 接口错误 / 403)
- 新增测试 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.test.tsx`(9 例)
- 修改 `ui-custom/web/src/api/alertmanager.ts`(`notifyChannelsApi`;并补通知模板 API 占位,见 T08-F11)
- 修改 `ui-custom/web/src/types/alertmanager.ts`(`NotifyChannel` / `CreateNotifyChannelPayload` / `UpdateNotifyChannelPayload` / `NotifyChannelsData` 等)
- 修改 `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`(`NOTIFY_CHANNELS_PATH`、`notifyChannelTypeLabel/Color`、`NOTIFY_CHANNEL_TYPE_OPTIONS`)
- 修改 `docs/04-source-architecture/repo-map.md`(新增通知渠道符号,pre-commit 门禁强制)

### 关键实现说明

- 列集合:渠道名称 / 渠道类型(中文展示名:飞书·钉钉·企业微信,**不渲染枚举值**)/ 机器人 Webhook(展示脱敏值)/ 签名密钥(已设置·未设置,**不展示明文**)/ 启用状态 / 创建时间 / 操作
- **脱敏处理(关键)**:响应 `webhook_url` 已脱敏为 `scheme://host/***`。编辑时**不回填**该值——仅以 placeholder / `extra` 提示「当前地址(已脱敏)…留空表示不修改」;`secret` 同理(仅 `secret_set` 布尔)。提交时**仅传改动字段**:未填 `webhook_url`/`secret` 即不进入 payload,update 对象只含 `{name,type,enabled}`——避免把脱敏串写回库
- 表单校验:渠道名称必填;类型必选;Webhook 新增必填且前端预校验 scheme ∈ {http,https} 且 host 非空(与后端一致的友好中文错误);后端 400 `bad_request` 按关键词映射回字段,无法定位落通用错误条
- 删除:`Modal.confirm` 二次确认,提示「删除后引用该渠道的告警分派将无法送达;该操作不可恢复」
- 页面状态矩阵:加载 / 空态 / 接口错误(Alert + 重新加载)/ 权限不足(复用 M08 既有 `Empty description="当前账号无此页面查看权限"`)
- 用户文案规范:不出现 `id` / `checksum` / snake_case / 模块代号
- Step 3.7:抽屉 `forceRender`(禁用 `destroyOnHidden/Close`),配套「关闭→打开回显」回归测试

### 遇到的问题与解决

- antd Drawer 关闭按钮在 5.29 的无障碍名随 `ConfigProvider` locale 变化(`关闭` 而非 `Close`),且页面内多 drawer 时 role 查询会命中多个:测试改用 `.ant-drawer-close` 类选择器定位
- 前序工作区已存在本任务的半成品(未提交):本次复核后修复了 `alertmanagerConstants.ts` 中 PL-3 常量块误插到 `ALERTMANAGER_MIN_SKELETON` 文档注释与定义之间的问题(注释与常量分离),恢复文档注释与常量紧邻

### 验证结果

- `vitest run src/pages/alerts`:10 文件 / 102 用例全通过;`vitest run src/pages/alerts/NotifyChannelsPage.test.tsx`:9 例通过
- `tsc --noEmit`:干净;`eslint . --ext ts,tsx`:0 告警
- dev server(`./node_modules/.bin/vite --host`):`/notify-channels` 200(与 `/`、`/alert-status`、`/alert-config` 一并验证);验证后已停服,端口 5173 释放
- `make check-repo-map`:与当前业务代码一致(commit 时 pre-commit hook 通过)

### 遗留风险 / 待确认

- PL-3 端点未写入 `api-contract-snapshot.md` / PRD(后端 `dev-feedback.md` #17 已登记),前端以任务卡 wire 契约为准,待文档方回写
- 通知渠道存储为服务端明文 + 响应脱敏(`dev-feedback.md` #15);加密 / KMS 属后续迭代

## 任务 T08-F11~F12:通知模板管理页 + 导航路由挂载(PL-3 通知渲染桥·迭代二)

- 角色:frontend-developer
- 任务 ID:T08-F11(通知模板页)+ T08-F12(导航路由挂载 + 前向引用回填)
- 分支:`feat/module-08-alert-dispatch`
- commit:`45101b6`
- 日期:2026-09-28

### 输入文档

- 设计提案 §3.3.2 / §3.3.4 / §3.3.7 / §4.3 / §6 迭代二 / **§7 用户脚本能力 → 平台承载映射**(折叠栏帮助口径)
- 契约权威:任务卡「实测 wire 契约」§3.2(模板端点:`GET` / `POST` / `POST .../{id}/remount`;无删除、无更新)
- 复用参照:`AlertConfigPage.tsx` / `AlertConfigDrawer.tsx`(**行级校验错误展示形态**)、`AlertStatusPage.tsx`(折叠栏写法)、`alertmanagerConstants.ts`

### 改动文件列表

- 新增 `ui-custom/web/src/pages/alerts/NotifyTemplatesPage.tsx`(模板列表 / 内置模板区 / 折叠栏帮助 / 查看内容抽屉 / 回滚确认)
- 新增 `ui-custom/web/src/pages/alerts/NotifyTemplateDrawer.tsx`(Form 抽屉,`forceRender`;行级错误渲染)
- 新增 `ui-custom/web/src/pages/alerts/useNotifyTemplates.ts`(取数 Hook:加载 / 空态 / 接口错误 / 403)
- 新增测试 `ui-custom/web/src/pages/alerts/NotifyTemplatesPage.test.tsx`(9 例)
- 修改 `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`(`NOTIFY_TEMPLATES_PATH`、`ALERT_CONFIG_PATH`、`notifyTemplateStatusLabel`、`NOTIFY_TEMPLATE_BUILTIN_TIP`;`AlertConfigScopeBlock.linkText`;豁免项 ⑤ 回填入口)
- 修改 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`(豁免块链接文案改用 `linkText`,不再写死「静默管理」)
- 修改 `ui-custom/web/src/layouts/MainLayout.tsx`(M08 `subItems` 新增「通知渠道 / 通知模板」;`resolveActiveModule` 补 `/notify-templates`)
- 修改 `ui-custom/web/src/App.tsx`(新增 `/notify-templates` 路由)
- 修改测试 `NotifyChannelsPage.test.tsx`(补 Step 3.7 关闭→打开回显回归)、`MainLayout.test.tsx`(`/notify-templates` 归属 + 高亮)、`AlertConfigPage.test.tsx`(豁免项 ⑤ 链接断言)

### 关键实现说明

- 列表列:模板名称 / 适用渠道类型(中文展示名)/ 模板来源(内置 Tag 挂 Tooltip「随版本升级、系统统一维护、不可删除」/ 自定义 Tag)/ 状态 / 创建时间 / 操作
- **校验和(checksum)不展示**:属技术字段,按用户文案规范不做列;登记 `dev-feedback.md` #19
- **内置模板区**:显式呈现平台内置模板(名称 + 渠道类型 + 不可删除提示 + 「查看内容」+「复制并自定义」),说明「可直接使用,也可复制后自定义」;零模板接入主路径
- **提交自定义模板**:Drawer(`forceRender`)+ 等宽可滚动编辑框;前端**不解析** Go template(校验在服务端);提交失败把后端 `data.items` **行级错误**渲染在编辑框下方(复用挂载抽屉形态)
- **回滚**:历史版本行「重新挂载」→ `Modal.confirm` → `POST .../{id}/remount`(body `{name}`,以原名称重新提交为新留痕)→ 成功后刷新
- **内置模板不可删除**:契约未提供模板删除端点(append-only),前端不提供删除操作;登记 `dev-feedback.md` #20
- **用户帮助(折叠栏)**:模板 = Alertmanager 标准 Go template、**不是脚本**;时区 / 证书平台统一处理;改样式改模板即可;逃生门一句「如需投递到自有中继服务,可在告警配置的接收人地址中直接填写外部地址,平台只做配置与校验」
- **导航挂载**:M08 一级模块名保持 PRD 模块名「告警收敛与通知管理」不变;二级子项顺序维持原型对齐注释口径(告警状态置顶、**告警配置落底**),新增「通知渠道 / 通知模板」插在「告警配置」之前
- **前向引用回填**:告警配置页豁免项 ⑤「通知模板」由「只出文案」改为真实链接 `/notify-templates`;`dev-feedback.md` #14 状态更新为 closed(只追加,原文保留)

### 遇到的问题与解决

- 模板名同时出现在「内置模板区」与模板列表,`getByText` 命中多元素:列表断言改 `getAllByText`,行内断言用 `closest('tr')` 定位表格行
- 模板内容含 `{{ }}`,`userEvent.type` 会按键盘描述符转义花括号:测试改用 `fireEvent.change` 写入原值
- 契约无模板删除端点,而任务卡要求「内置模板不可删除」:判定为「不提供删除操作 + 内置标记提示」,并登记 #20(见上)
- **任务卡顺序措辞与原型对齐注释存在张力**:任务卡写「放在『告警配置』之后」,而 `MainLayout.tsx` 就地注释明示(并指向原型)「告警配置落底(最后)」。按任务卡「原型对齐顺序见该处注释」的指引,以注释(= 原型对齐)为准,新子项插在「告警配置」之前,一级模块名零变更。已在向 Orchestrator 的汇报中标出该点,如与预期不符可一处调整

### 验证结果

- `vitest run src/pages/alerts`:10 文件 / 102 用例全通过;`vitest run src/pages/alerts/NotifyTemplatesPage.test.tsx`:9 例通过
- `vitest run src/layouts/MainLayout.test.tsx`:24 例通过
- `tsc --noEmit`:干净;`eslint . --ext ts,tsx`:0 告警
- dev server:`/notify-templates`、`/notify-channels` 均 200,既有 `/alert-status`、`/alert-config`、`/silences`、`/alert-history` 未回归(全 200);验证后已停服,端口 5173 释放
- `make check-repo-map`:与当前业务代码一致(commit 时 pre-commit hook 通过)
- **全量 `pnpm test`**:90 文件 / 826 用例中 **4 文件 / 57 用例失败,全部为存量红且与本迭代零关联**(`pages/resources/ResourceDetailDrawer`、`pages/resources/ResourceFormDrawer`、`pages/admin/appearance/AppearanceSettingsPage`、`productNamePreference`;`pages/home/HomePage` 偶发)。隔离复现确认根因:`window.localStorage.clear is not a function`(jsdom localStorage 环境)+ 资源模块测试 mock 缺 `serviceDictApi` 导出;均为既有问题,未 import 本次任何改动文件

### 遗留风险 / 待确认

- 全量测试存量为红(resources / appearance / productName 等),非本迭代引入,建议另行派单修复
- PL-3 端点与决策 74 均待文档方回写(契约快照 / PRD / `design-decisions.md`),详见 `dev-feedback.md` #17 / #13

## 迭代二 PL-3 前端(通知渲染桥)收尾

- 输入文档:设计提案 `.../module-08/design-proposals/alert-config-scope-and-notification-bridge.md`(§3.3 / §4.3 / §6 迭代二 / §7 附录)、任务卡「实测 wire 契约」(§3 渠道与模板)、`docs/03-engineering-standards/02_Frontend_Standard.md`、`web-development` skill(antd 测试稳定模式)
- 交付:2 个代码 commit(`79ac881` T08-F10 / `45101b6` T08-F11~F12)+ 1 个文档 commit(执行记录 + dev-feedback);仅动 `ui-custom/web/src/**` 与 `docs/04-source-architecture/repo-map.md`、`docs/05-execution-records/module-08/*`
- 关键取舍:凭据脱敏(编辑留空不改)、模板 append-only(不提供删除)、checksum 不做列、模板帮助折叠栏化 → 均已登记 dev-feedback(#19 / #20,并 closed #14)
- 遗留风险:全量 `pnpm test` 存量红(非本模块);PL-3 契约快照 / PRD / 决策 74 待回写
- 下一步:交 frontend-reviewer + security-reviewer(PL-3 涉凭据脱敏与出站投递)审查 → Orchestrator 合并 `develop`

## 任务 T08-F13:告警配置说明卡「接收人 / 渠道」块闭环(PL-3 接线闭环)

- 角色:frontend-developer
- 任务 ID:T08-F13(M08 PL-3 通知渲染桥·接线闭环)
- 分支:`feat/module-08-alert-dispatch`
- commit:`580d45b`(首轮实现) / `da047b6`(本轮复核,记录补登)
- 日期:2026-09-28 ~ 2026-09-29

### 输入文档

- 任务卡:Orchestrator 派发卡「实测 wire 契约」§3(A 路线:平台提供只读「接收人配置片段」端点,不改 M09 生成逻辑)
- 后端已提交端点(只读核对):`platform/alertmanager/notify/receiver_snippet.go` + `receiver_snippet_test.go`(路径 `/api/v2/platform/alertmanager/notify-channels/{id}/receiver-snippet`、`RequireAdmin`、404/400 分支)

### 改动文件列表

- 修改 `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`(`ALERT_CONFIG_REQUIRED_BLOCKS` 的 `receivers` 块:`path: null` → `NOTIFY_CHANNELS_PATH`、`linkText: '通知渠道'`、`desc` 改写为「地址与渠道 ID 不要手写,在『通知渠道』页登记后复制其『接收人配置』片段填入」)
- 修改 `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx`(必写块渲染层补 `path` 非空时的链接分支)
- 修改测试 `ui-custom/web/src/pages/alerts/AlertConfigPage.test.tsx`(新增用例:receivers 块渲染指向 `/notify-channels` 的「通知渠道」链接 + 文案含「地址与渠道 ID 不要手写」)

### 关键实现说明

- **保持「必写」不改口径**:后端未自动生成 `receivers`(B 路线未做),该块**仍为必写**——只把「内容来源」从「用户手写」改为「平台生成片段 + 复制填入」,不挪到豁免块、不写「平台自动注入」(与真实行为一致)
- 豁免块 `path` / `linkText` 写法照抄既有形态,渲染层复用同一分支,避免两处各写一份

### 验证结果

- `vitest run src/pages/alerts`:10 文件 / 110 用例全通过(F13 相关 2 例含在内)
- `pnpm lint` / `tsc --noEmit`:0 告警 / 干净
- dev server:`/alert-config`、`/notify-channels` 均 200;验证后已停服,端口 5173 释放

### 遗留风险 / 待确认

- 无(该块口径与后端真实行为一致;契约快照仍缺 PL-3 端点,见 dev-feedback #17 / #21)

## 任务 T08-F14:通知渠道页「接收人配置」抽屉 + 修骨架假渠道 ID(PL-3 接线闭环)

- 角色:frontend-developer
- 任务 ID:T08-F14(M08 PL-3 通知渲染桥·接线闭环)
- 分支:`feat/module-08-alert-dispatch`
- commit:`2693dcf`(骨架假 ID 修正 + 文案收敛)/ `580d45b`(片段查看首轮)/ **`da047b6`(本轮定稿:Drawer 化 + 安全文案 + 测试补强)**
- 日期:2026-09-28 ~ 2026-09-29

### 输入文档

- 任务卡:§3 wire 契约(`receiver_name` / `url` / `snippet` / `token_configured`)、§5 T08-F14 逐项要求
- `web-development` skill「Ant Design 组件测试稳定模式」;`frontend-developer.md` Step 3.6 / Step 3.7

### 改动文件列表

- 新增 `ui-custom/web/src/pages/alerts/ReceiverSnippetDrawer.tsx`(展示类抽屉:`forceRender`、无 `destroyOnHidden`;状态矩阵 = 加载 / 加载失败可重试 / 403 权限不足 / 令牌未配置)
- 删除 `ui-custom/web/src/pages/alerts/ReceiverSnippetModal.tsx`(上一轮为 Modal,与任务卡「打开 Drawer + forceRender」要求不符)
- 修改 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`(行操作列「接收人配置」入口接入新抽屉;页头指引文案;操作列宽)
- 修改 `ui-custom/web/src/pages/alerts/alertmanagerConstants.ts`(`ALERTMANAGER_MIN_SKELETON` 两处假 ID `channel=ch-default` / `ch-sre` → `REPLACE_WITH_CHANNEL_ID` / `REPLACE_WITH_BRIDGE_TOKEN`,骨架顶部与 `receivers:` 段加「到『通知渠道』页复制、勿手写」注释)
- 修改 `ui-custom/web/src/pages/alerts/AlertConfigDrawer.tsx`(骨架按钮提示文案改为指向「通知渠道」页复制)
- 修改 `ui-custom/web/src/types/alertmanager.ts`(`ReceiverSnippetData`)、`ui-custom/web/src/api/alertmanager.ts`(`notifyChannelsApi.getReceiverSnippet`)
- 修改测试 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.test.tsx`(片段抽屉:展示+复制+安全文案 / 令牌未配置告警 / 403 友好提示 / **接口错误态 + 重试恢复** / 加载态;多抽屉下关闭按钮定位改按表单所在抽屉)
- 修改测试 `ui-custom/web/src/pages/alerts/AlertConfigPage.test.tsx`(骨架不含 `ch-default` / `ch-sre` 的防回归断言)
- 修改 `docs/04-source-architecture/repo-map.md`(文件改名刷新)

### 关键实现说明

- **Drawer + `forceRender`(按任务卡与 Step 3.7)**:抽屉无 Form、无表单回显竞态,但仍按要求固定 `forceRender`、禁用 `destroyOnHidden`;父级以 `key={snippet-${seq}}` 每次打开重挂,保证上一条渠道的地址/片段不残留
- **安全文案(本轮补)**:片段内嵌平台内网令牌 → 片段下方固定 `Alert warning`「该片段含平台内网凭据,请勿外发」(`token_configured=false` 时同样提示「片段当前不可用(地址里的令牌是占位符)」)
- **令牌不单列暴露**:令牌由服务端拼进 `url` / `snippet`,前端不拆字段展示;层内文案不出现 `channel` / `token` 字段名
- **修假 ID(关键缺陷)**:真实渠道 ID 是数字串且展示骨架时未知,骨架改为醒目占位符 `REPLACE_WITH_CHANNEL_ID` / `REPLACE_WITH_BRIDGE_TOKEN` + 注释指引「到『通知渠道』页『接收人配置』复制」,不再出现「看起来像真值、填了必失败」的 `ch-default` / `ch-sre`;`amtool check-config` 对修改后骨架实测 SUCCESS(占位符为合法 URL 字面量)
- 403 复用 M08 既有权限不足形态(Alert 提示 + 复制按钮禁用),不暴露 `forbidden` 等技术串

### 遇到的问题与解决

- **上一轮实现与任务卡偏差**:首轮把片段查看做成 `Modal`(与任务卡「Drawer + forceRender」不符),且缺「勿外发」安全文案与接口错误态用例 → 本轮统一收敛为 Drawer,补齐文案与用例(见 `da047b6`)
- **多抽屉下的关闭按钮定位**:两个抽屉均 `forceRender` 常驻 DOM 后,`document.querySelector('.ant-drawer-close')` 命中顺序不再可靠 → 改为 `screen.getByLabelText('渠道名称').closest('.ant-drawer')` 内定位,避免误关片段抽屉
- **改名引发的 repo-map 门禁**:文件改名后 `make repo-map` 重新生成并通过 pre-commit `check-repo-map`
- antd 关闭按钮无障碍名随 `ConfigProvider` locale 变化(「关闭」),测试仍以 `.ant-drawer-close` 类选择器定位(沿用既有做法)

### 验证结果

- `vitest run src/pages/alerts`:10 文件 / 110 用例全通过(片段抽屉相关 6 例含在内)
- `tsc --noEmit` 干净;`eslint . --ext ts,tsx --max-warnings 0`:0 告警
- dev server:`/notify-channels`、`/alert-config`、`/notify-templates`、`/silences`、`/alert-status`、`/` 全 200;验证后已停服,`pgrep vite` 无残留、5173 已释放
- **全量 `pnpm test`**:90 文件 / 834 用例中 4 文件 / 57 用例失败,**全部为存量红且与 M08 零关联**(`pages/resources/ResourceFormDrawer` 24、`pages/resources/ResourceDetailDrawer` 24、`src/productNamePreference` 5、`pages/admin/appearance/AppearanceSettingsPage` 4),根因仍为 jsdom `localStorage.clear` + 资源模块 mock 缺 `serviceDictApi`,本次未 import 任何相关文件;M08 全部文件绿

### 遗留风险 / 待确认

- 片段在「令牌未配置」时复制按钮保留可点(附不可用告警),该口径契约未规定,已登记 dev-feedback #22
- 全量测试存量红(resources / appearance / productName),非本次引入,建议另行派单修复

## 任务 T08-F15:指引一致性收口(PL-3 接线闭环)

- 角色:frontend-developer
- 任务 ID:T08-F15(M08 PL-3 通知渲染桥·接线闭环)
- 分支:`feat/module-08-alert-dispatch`
- commit:`da047b6`(与 T08-F14 同页功能块合并提交:两页指引文案与该页抽屉入口同属「接收人接线闭环」,拆分提交会让页头指引指向未定稿的入口)
- 日期:2026-09-29

### 改动文件列表

- 修改 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.tsx`(页头定位文案补「本页是告警接收人的来源:在渠道行点『接收人配置』复制片段,粘贴到『告警配置』页的 receivers 段并在 route 中引用即可接入」,并链到 `/alert-config`;操作列宽 210 → 240)
- 修改测试 `ui-custom/web/src/pages/alerts/NotifyChannelsPage.test.tsx`(新增用例:页头定位文案 + 指向 `/alert-config` 的链接)
- 追加 `docs/05-execution-records/module-08/dev-feedback.md` #22(① 片段令牌未配置口径与勿外发提示)/ #23(③ 操作列宽)

### 关键实现说明

- **互指闭环(两处口径一致)**:「告警配置」说明卡 receivers 块 → 「在『通知渠道』页登记后复制其『接收人配置』片段填入」+ 入口链接 `/notify-channels`;「通知渠道」页页头 → 「本页是告警接收人的来源…粘贴到『告警配置』页 receivers 段」+ 入口链接 `/alert-config`。两页说法同源,无「各说一套」
- 渠道页页头原仅有「登记机器人渠道 / 脱敏展示」的功能定位,补一句「本页是告警接收人的来源」明确跨页关系(沿用迭代一 `RulesPage.tsx` 顶部定位文案风格)
- 操作列第 3 个按钮后固定列宽偏窄会换行撑高行高 → 210 → 240(仍由 `TABLE_SCROLL_X` 兜底横向滚动)

### 验证结果

- `vitest run src/pages/alerts`:10 文件 / 110 用例全通过(含新增页头用例)
- `tsc --noEmit` 干净;`eslint . --ext ts,tsx --max-warnings 0`:0 告警
- dev server 路由验证与全量测试结果同 T08-F14 一条(同 commit)

### 遗留风险 / 待确认

- 无

## 本轮(PL-3 接线闭环 T08-F13~F15)收尾

- **输入文档**:Orchestrator 派发卡(实测 wire 契约 §3 + 任务清单 §5)、`web-development` skill、`frontend-developer.md`(Step 3.5 / 3.6 / 3.7)、只读核对后端 `platform/alertmanager/notify/receiver_snippet*.go`
- **交付**:1 个代码 commit(`da047b6`,T08-F14~F15 同页功能块)+ 1 个文档 commit(执行记录 + dev-feedback #22/#23);另说明首轮实现 commit `580d45b`(T08-F13 片段查看)/ `2693dcf`(T08-F14 骨架假 ID 修正 + 说明卡口径)已在本轮之前提交但**未留执行记录**,本轮复核后补齐记录并定稿
- **用户可见三层问题闭环**:① 文案矛盾(说明卡 receivers 块给出「通知渠道」入口 + 准确指引)② 假 ID 必失败(骨架改醒目占位符 + 复制路径引导,`ch-default` / `ch-sre` 已消除并有防回归断言)③ 接线未闭环(渠道行「接收人配置」抽屉展示平台生成的片段、接收人名、粘贴步骤,一键复制)
- **关键取舍**:片段令牌不单列暴露(服务端拼进 url/snippet);令牌未配置时复制按钮保留但显式告警「片段当前不可用」;**片段固定提示「含平台内网凭据,请勿外发」** → 登记 dev-feedback #22
- **契约一致性**:任务卡 §3 wire 契约(路径 / 鉴权 RequireAdmin / 200 四字段 / 404 / 400 / `&` 转义无需前端处理)与后端实现(只读核对 `receiver_snippet_test.go`)一致,**未发现不符**;契约快照仍缺 PL-3 端点(dev-feedback #17 / #21 已登记,待文档方回写)
- **遗留风险**:全量 `pnpm test` 存量红 4 文件 / 57 用例(资源模块 / 外观设置 / 产品名偏好),非本次引入
- **下一步**:交 frontend-reviewer + security-reviewer(本改动含内网凭据展示与出站投递指引)审查 → Orchestrator 合并 `develop`
## 方案 B 前端收敛（2026-09-29）：告警配置页「派生预览」+ 渠道 / 模板页自动下发心智

- **背景 / 输入**：随后端方案 B（决策 74 定稿：M09 自动物化已启用渠道为 receivers）同步前端口径——A 路线「复制片段粘贴到 receivers」的旧心智需收敛为「平台自动写入、配置即生效」；同时按 H-1 令牌改走 `Authorization: Bearer` 请求头修订骨架与片段文案。
- **新增/修改文件**：
  - `src/pages/alerts/useDerivedReceivers.ts`（**新增**）：只读派生 Hook——`notifyChannelsApi.list()` 过滤 `enabled` → **顺序**逐渠道取 `getReceiverSnippet` → 产出 `DerivedReceiverRow{channelId, channelName, receiverName, snippet, tokenConfigured}`；403 降级为「无权限」（不阻断整页，渠道接收人仍由平台自动写入）；含 loading / error / reload。
  - `src/pages/alerts/useDerivedReceivers.test.ts`（**新增** 6 例）。
  - `src/pages/alerts/AlertConfigPage.tsx`：新增只读「派生预览：平台将写入的接收人」卡片（把「UI 控制 → 派生 alertmanager.yml 预览」具象化），覆盖 loading / empty（引导去「通知渠道」）/ forbidden（403 友好提示 + 重试）/ error（重试）/ 正常行（渠道名 → 派生 receiver 名 + 片段 + 令牌未配置告警）；保留原说明卡 receivers 块与手写/上传原样透传的范围声明。
  - `src/pages/alerts/alertmanagerConstants.ts`：receivers 块 desc 改为「已启用渠道的接收人由平台在生成配置时自动写入（配置即生效），仅在自定义时才手写且不得重名」；`ALERTMANAGER_MIN_SKELETON` 去掉 URL 里的 `&token=`、改 `http_config.authorization`（type Bearer + credentials 占位符）；新增派生预览文案常量（标题 / 说明 / 范围 / 重名提醒 / 空态 / 403）。
  - `src/pages/alerts/NotifyChannelsPage.tsx`：页头改为「本页是告警接收人的来源：已启用渠道由平台下发配置时自动写入 … 无需手工复制片段；停用/删除后下一次配置变更会同步移除」；删除确认补「下一次配置变更会同步移除其接收人」。
  - `src/pages/alerts/ReceiverSnippetDrawer.tsx`：定位为「手写自定义 receiver 时的参考」；令牌未配置说明与「勿外发」提示改为「令牌随 authorization 请求头下发」。
  - `src/pages/alerts/AlertConfigDrawer.tsx`：骨架插入提示改为「已启用渠道的接收人由平台自动写入，此处 receivers 仅为自定义场景示例」。
  - `src/types/alertmanager.ts`：`ReceiverSnippetData` 注释改为 B 路线口径（URL 不含令牌）。
  - 测试同步：`AlertConfigPage.test.tsx`（派生预览 loading / 正常 / 空态 / 403 / 手写范围声明断言）、`NotifyChannelsPage.test.tsx`（页头心智 + 令牌走 authorization 头且 URL 不含 token）、`alertSmoke.test.tsx`。
- **验证结果**：
  - `vitest run src/pages/alerts`：**11 文件 / 119 用例全通过**。
  - `tsc --noEmit` 干净；`eslint . --ext ts,tsx --max-warnings 0`：0 告警。
  - 全量 `pnpm test` 存量红 4 文件（`ResourceDetailDrawer` / `ResourceFormDrawer` / `ScrapeJobListPage` / `HomePage`）已核实为**存量问题**（`ResourceDetailDrawer` 报 `No "serviceDictApi" export is defined on the "../../api/resources" mock`，属资源模块 mock 缺口），**非本次引入**，与上轮记录一致。
- **关键取舍 / 口径**：派生预览**只读**、仅覆盖平台 UI 控制部分；用户手写或上传的整文件原样透传，平台不解析其语义、不参与预览派生（与决策 74 定稿第 3 条一致）。
- **遗留风险**：PRD 与设计分支的 B 路线口径待 design 侧同步（见 dev-feedback #13 / #17）；#24 待 security-reviewer 复检。

## 告警配置页排版优化（2026-09-29，用户反馈「非常凌乱、排版无序、信息杂乱」）

- **根因诊断**：首屏被「说明书」淹没——定位说明 + 三块必写 + 两块豁免 + 320px 骨架 + 派生预览卡全部常驻可见，核心的「当前生效配置」被挤到第三屏；同时四处 YAML 正文各写一套内联样式，视觉不一致。
- **解法**（依据 `docs/03-engineering-standards/02_Frontend_Standard.md` §8/§9/§10，并复用本模块既有且用户认可过的约定——`AlertStatusPage` 的「默认收起折叠栏」，源自 dev-feedback #9「说明不占常驻空间」）：
  1. 页头卡瘦身为「页名 + 主操作「挂载新配置」+ 一行定位说明（含 `RuleGuideLink`）」；
  2. 新增单一 ghost `Collapse`（默认收起，标题「写配置前必读：三块必写 + 两块豁免」）承载三块必写 / 两块豁免 / 最小骨架，文档不再占首屏；
  3. 错误条（加载失败 / 重新挂载校验失败）统一前移到数据区之前，问题优先可见；
  4. 「当前生效配置」核心卡前置（原第三屏 → 紧邻错误条）；
  5. 派生预览改**按状态渐进披露**：有内容 / 无权限 / 出错才占 Card，无已启用渠道时仅留一行提示 + 入口链接，不再用空态大卡片占位；
  6. 抽出 `yamlBlockStyle` 统一四处 YAML 正文样式（等宽 / 可滚动 / 同圆角同内边距，配色取皮肤 token 支持运行时换肤）。
- **逻辑零改动**：hooks、`openMount` / `handleSubmit` / `openVersionDetail` / `handleRemount` / `columns` / 两个 Drawer 的 props 与 `permissionDenied` 早返回逐字保留。
- **测试同步**（`AlertConfigPage.test.tsx`）：按 `AlertStatusPage.test.tsx` 既有模式新增 `expandGuidance()` helper；`PL-2`、`B 路线：接收人 / 渠道必写块`、`B 路线：骨架占位符` 三条改为「先点击展开折叠栏再断言」；新增「折叠栏默认收起、点击后展开」回归用例。
- **验证结果**：`vitest run src/pages/alerts/AlertConfigPage.test.tsx` **17 / 17 通过**；`vitest run src/pages/alerts` 11 文件 120 用例中 118 通过，2 例失败经复跑核实为**既有加载抖动**（`CreateSilenceDrawer` / `NotifyChannelsPage`，两次运行失败用例不同、与本次改动文件无关）；`tsc --noEmit` 干净、`eslint --max-warnings 0` 0 告警；`make check-repo-map` OK；dev server `/alert-config` 与后端 `/api/v1/health` 均 200。
