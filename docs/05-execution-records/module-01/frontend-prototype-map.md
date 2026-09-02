# Module_01 前端「原型 ↔ 生产」映射与偏离清单

> 本文档是 code-sequence-planner 为 M01「采集策略」落盘的真实状态基线（轻量版，非完美交付）。
> - 权威基底（只读，不修改）：`docs/prototypes/module-01/src/**`（原型）
> - 生产实现（只读，不修改）：`ui-custom/web/src/pages/strategy/**`、`ui-custom/web/src/layouts/MainLayout.tsx`、`ui-custom/web/src/App.tsx`
> - 契约（前端第一权威）：`api-contract-snapshot.md`（下文简称「契约」）
> - 记录裁剪：`dev-feedback.md` F-01~F-07（F-XX 为 dev-feedback 编号；A-xx/B-xx/C-xx/D-xx/E-xx/F-xx 为偏离合集中的偏离编号，见 §6）
> - 生成日期：2026-08-23；分支：feat/module-01-strategy
>
> 现状字段含义：✅对齐=生产已完成且与原型一致或为合理生产替代；⚠️偏离=存在差异（见 §6）；❌缺失=原型有生产无；➕生产新增=原型无生产有。

---

## 1. 决策落版 D1~D6（采纳态基线）

> 原型采用「Sider 全站分组 + 折叠子菜单」模型；生产采用「Header 一级功能模块 tab + Sider 二级」（`MainLayout.tsx:35-62`）。以下为当前采纳态中快速过一遍 D1~D6。

| 编号 | 决策点 | 原型表现 | 生产采纳态 | 状态 |
|------|--------|----------|------------|------|
| **D1** | 导航模型 | Sider 分组菜单（采集/指标库/规则编辑 分组 + 全局导航 disabled） | Header 一级 tab「首页/系统与平台管理/监控对象管理/采集策略」+ Sider 二级（采集策略下：采集 Job / 规则编辑 / 指标库） | **已决策·采纳**（生产实现） |
| **D2** | 采集器管理承载方式 | 原型作 Sider「采集」分组折叠子项，`?view=collectors` | 生产作「采集 Job」页内 Tab（`?tab=collectors`，`ScrapeJobListPage.tsx:326`） | **已决策·采纳**（生产 Tab） |
| **D3** | 指标库分组 | Sider「指标库」父组（技术指标库 / 业务指标库 / 业务视图） | 生产仅「指标库」一个 Sider 二级子项（业务指标库 / 业务视图属本期 P2 范围外，无 API/UI） | **部分采纳**（业务两页裁剪 P2） |
| **D4** | 折叠子菜单 | 原型用父菜单折叠（采集/指标库各含子项） | **不采用**折叠子菜单；一级 tab + Sider 二级拍平（见 §4 导航 IA 与偏离 F1） | **已决策·不采纳**（F1） |
| **D5** | 规则编辑视图形态 | 原型页内 Segmented「文件挂载（MVP）/ 字段化编辑（v0.3 预览）」 | 生产仅「文件挂载」列表 + RuleMountDrawer；字段化编辑为 v0.3 不入本期 | **已决策·裁剪 v0.3** |
| **D6** | 「前往配置变更确认」跳转 | 原型 `window.open(M09)` 相对路径 | 生产 toast 文案占位，无真实跳转（M09 未落地） | **已决策·占位**（dev-feedback F-05） |
| **D47-2** | Job 实例采集状态回显 | 原型「实例采集状态」列 + 详情抽屉聚合（在线 X / 总数 Y · 待采集 Z，决策 47-2） | Job 编辑/详情抽屉（`ExporterInstallationPanel`）实例列表「采集状态」列 + 顶部「实例总数 / 在线 n / 待采集 n」汇总；只读消费 M02 `GET /api/v1/targets`（`useScrapeJobStatus`，不直连 Prometheus、不回持久化）。`down` 实例不计入在线与待采集；变更未确认下发时全部「待采集」 | **已实现**（T01-47-F1，commit `b6157ebc` 前端 / `5c86b6e0` 后端，T01-47-B1） |

> 需用户决策项（详见 §8）：D6 占位是否接受（等 M09）；生产「编辑态网域 disabled」与契约 §5/§10「PUT 允许改网域」（仅冻结域禁止新增实例）是否存在冲突。

---

## 2. 文件级映射表

| 原型文件 | 生产文件 | 现状 | 说明 |
|----------|----------|------|------|
| `src/layouts/MainLayout.tsx` | `ui-custom/web/src/layouts/MainLayout.tsx` | ⚠️偏离 | 导航模型不同（D1/D4）；原型含 ReviewNote/角色切换/全局导航，生产 Header 一级 tab 化 |
| `src/pages/ScrapeJobsPage.tsx`（≈160KB，含采集器管理视图 + 采集 Job 列表/抽屉/实例/安装确认） | `ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`、`CollectorTemplatesTab.tsx`、`ScrapeJobFormDrawer.tsx`、`InstanceSelector.tsx`、`ExporterInstallationPanel.tsx`、`ExporterTemplateDrawer.tsx`、`MappingDrawer.tsx`、`jobStatus.ts`、`useScrapeJobs.ts`、`strategyConstants.ts` | ⚠️偏离 | 单文件拆分多组件：生产为采集 Job 页内 Tab 承载；列/区块差异见 §3、偏离见 §6 |
| `src/pages/RulesPage.tsx` | `ui-custom/web/src/pages/strategy/RulesPage.tsx`、`RuleMountDrawer.tsx`、`rulesYaml.ts` | ⚠️偏离 | 原型含 Statistic 卡 / V02Badge / Segmented 字段化预览；生产仅文件挂载列表 |
| `src/pages/MetricLibraryPage.tsx` | `ui-custom/web/src/pages/strategy/MetricLibraryPage.tsx` | ⚠️偏离 | 原型可新增/编辑/删除 + 按 CI 分组 + 语义域筛选；生产只读扁平列表 |
| `src/pages/BusinessMetricsPage.tsx`、`BusinessViewPage.tsx` | —（无） | ❌缺失 | 业务指标库 / 业务视图，本期 P2 范围外（契约 §0） |
| `src/components/FieldGuide.tsx` | —（无独立组件；`ExporterInstallationPanel` 内联 Alert 等） | ⚠️偏离 | 表单字段说明轻量提示组件未生产统一复用（B2） |
| `src/components/ReviewNote.tsx` / `ReviewNotesContext.tsx` / `ReviewNoteSwitch.tsx` | —（无） | ❌缺失 | 评审说明开关为原型演示态，不进入生产（合理裁剪） |
| `src/mocks/module-01.ts` / `module-01.test.ts` | `src/api/*.ts` + `src/types/strategy.ts` + `strategyConstants.ts` + `*.test.ts(x)` | ✅对齐 | mock → API client + 类型契约映射（一致） |
| `src/components/EllipsisText.tsx` / `FilterBar.tsx` / `tablePresets.ts` | 同名 `ui-custom/web/src/components/*` | ✅对齐 | 通用组件已复用 |
| — | `ui-custom/web/src/pages/strategy/{CollectorTemplatesTab,MappingDrawer,ExporterTemplateDrawer,...}.test.tsx`、`jobStatus.ts`、`rulesYaml.ts`、`useScrapeJobStatus.ts` | ➕生产新增 | 生产新增测试与工具文件（原型无对应）。`useScrapeJobStatus` 为 D47-2 采集状态回显 Hook（T01-47-F1，commit `b6157ebc`）。 |

---

## 3. 列 / 区块对照（按页，⚠️重点差异标红）

> 记号：⚠️=偏差已在 §6 编号；`-`=生产无该内容。

### 3.1 采集 Job 列表（原型 columns:1191-1433 vs 生产 `ScrapeJobListPage.tsx` columns）

| 原型列 | 生产列 | 对齐 | 备注 |
|--------|--------|------|------|
| Job 名称（ellipsis+Tooltip，名称内不放类型 Tag） | Job 名称（EllipsisText） | ✅ | 生产用公共 EllipsisText 等价 |
| Job 类型（Tag：标准采集/拨测） | 类型（纯文本 JOB_TYPE_MAP） | ⚠️ D15 | 生产未用 Tag 着色，弱化了类型辨识 |
| 状态（四态聚合：草稿灰显/待下发/已生效/已停用） | 状态（jobStatus.ts 聚合 Badge） | ✅ | 生产 jobStatus.ts 等价实现四态 |
| 监控对象类型（blackbox 显 `-`） | 监控类型（MONITOR_TYPE_MAP） | ✅ | blackbox 生产显示 `-`；语义一致 |
| 默认采集器 / Module（真实采集器名 / blackbox_module / 手填参数） | 采集器（按 exporter_template_id 反查真实模板名；blackbox 显拨测模块；查无回退「默认采集器」占位） | ✅（F1-1，T01-F9） | 生产已接入名称解析，不再静态占位 |
| 网域（Tag） | 网域（domainById 映射名） | ✅ | 等价 |
| 实例选择 / 拨测目标（standard「手动·N实例」、blackbox「N个目标」） | 已选实例（数组长度计数） | ⚠️ D15 | 生产简化：无「手动/过滤」模式合并、blackbox 无目标数专列 |
| 参数同步（异常驱动：映射默认值已变更/已同步+Tooltip） | 参数同步（三态：已覆盖 n 项蓝 / 待同步橙 / 已同步；Backblk 显「同步」） | ✅（F1-2，T01-F12） | 生产实现异常驱动三态；后端不落 mapping_overrides 时按默认映射快照对比（dev F-03） |
| 下发状态（待确认=可点击跳 M09 / 已确认 / 无变更） | 下发状态（CHANGE_STATUS_MAP 纯文本） | ⚠️ F5（dev F-05） | 生产无「待确认→跳配置变更确认」点击入口 |
| 标签模板（模板名+待配置橙 Tag 可点击补配 / 未关联） | 标签模板（label_template_id 命中→模板名 + 待配置橙 Tag 可点击补配引导；未关联渲染 '-'） | ✅（F1-1，T01-F9） | 生产已补该列 |
| 启用（Switch） | 操作用启停 Switch | ✅ | 生产并入操作列 |
| 操作（编辑/克隆 v0.2/详情/删除） | 操作（编辑/启停 Switch/删除） | ⚠️ A2 | 生产无「克隆」（v0.2）与「详情」；启停以 Switch 呈现 |
| — | 间隔（scrape_interval）独立列 | ➕新增 | 生产新增，原型行内未单列 |
| — | 刷新按钮 | ➕新增 | 生产工具栏新增刷新 |

### 3.2 采集 Job 编辑抽屉（原型 vs `ScrapeJobFormDrawer.tsx`）

| 原型 | 生产 | 对齐 | 备注 |
|------|------|------|------|
| 资源类别 + 监控对象类型 两个独立字段（两级级联，Col12/Col12，原型 L2001-2021） | 「资源类别」+「监控对象类型」两个独立 Form.Item 两级级联（提交载荷仍为 single monitor_type） | ✅（F1-8，T01-F13） | 已由单 Select 拆回还原（偏离 F1-8 修复） |
| 默认采集器「使用默认/手填」二选一（D2） | 同款 Radio「使用默认/手填」 | ✅ | 契约 §5.4 exporter_template_id 可空=手填 |
| 选择后自动带出默认映射参数（可覆盖） | handleMonitorTypeChange 调 ciExporterMappingApi 带默认值 | ✅ | 等价 |
| 采集器空态「未找到？前往登记」inline + 登记后回选（D17/C1） | 登记入口 + 登记成功后回选到来源表单字段（onSuccess 回填） | ✅（C1，T01-F11） | 生产实现 inline 登记 + ExporterTemplateDrawer 回选联动 |
| 网域冻结域「显示但置灰不可选」 | 网域下拉=仅已纳管非冻结 `enabled`；编辑态放开可改网域（选定后校验非冻结） | ✅（FIX-2，T01-F11） | 按契约 §5/§10 放开编辑态改网域（决策①）；冻结过滤见 M07 |
| 认证与 TLS 折叠面板（决策31） | 同款 Collapse「认证与 TLS」 | ✅ | auth_type 三选一 + basic/bearer 密文 ✓；密文不回显 ✓ |
| 标签模板卡片式（选择器按类别过滤+补配跳转） | 卡片式 Radio 选择（按资源类别过滤）+ 空态「前往补配标签模板」引导 | ✅（F1-4，T01-F11） | 生产还原卡片选择 + 补配跳转 + 网域空态引导（A7） |
| 实例选择（原型 Transfer + offline 置灰 + 全选/反选 + 关键字） | InstanceSelector（Table+Checkbox + offline disabled + 全选/反选当前页 + 关键字） | ✅ | 表选替代 Transfer，语义等价（决策29 offline 置灰 ✓） |
| Exporter 安装确认（勾选确认/取消） | ExporterInstallationPanel（仅编辑态，confirm/unconfirm） | ✅ | 契约 §6.2.5 对齐；新建未保存引导 `Alert`（生产 `!jobId` 分支） |
| blackbox 拨测模块 + 目标 | blackbox_module Select + blackbox_targets Form.List | ✅ | 等价 |
| 实例采集状态（决策 47-2：在线 X / 总数 Y · 待采集 Z；每实例 采集中/已下发未采到/待采集 状态） | `ExporterInstallationPanel` 顶部「实例总数 n · 在线 n · 待采集 n」汇总 + 每行 `SCRAPE_STATUS_META`（采集中=绿 / 已下发未采到=橙 Tooltip 显原因 / 待采集=灰）badge；数据源 `useScrapeJobStatus` 只读消费 M02 `GET /api/v1/targets?job=` | **➕ 新增（D47-2，T01-47-F1）** | 生产实例采集状态列与汇总落在安装确认面板（编辑态）；原型放 Job 列表列 + 详情抽屉。仅已确认下发时拉取 targets；未下发时全部「待采集」。 |

### 3.3 采集器管理（原型 collectors 视图 vs `CollectorTemplatesTab.tsx`）

| 原型 | 生产 | 对齐 | 备注 |
|------|------|------|------|
| Steps 三步动线（登记采集器→配置默认采集→创建 Job 确认安装） | Steps 三步动线（可跳转直连登记/默认采集配置/Job 创建） | ✅（A4，T01-F10） | 生产已补动线引导 |
| HTTP 应用 / 业务指标采集 FieldGuide | —（无） | ⚠️ B2 | 生产无该轻量说明 |
| 合并行：默认映射行 + 「未被引用」采集器模板行 | 映射行 + 未被引用模板行并入行（is_referenced=false 标记 + 去配置动作） | ✅（F1-5，T01-F10） | 生产未引用行并入并标记 |
| 标签模板两行卡片 + Popover 预览 / Dropdown 更换 / 补配 | 标签模板列（查看/更换/补配按钮 + 待配置橙 Tag） | ✅ | 生产简化但动作齐全 |
| Endpoint（端口/路径/协议合并 compact 文本） | 默认端口/采集路径/协议三列分开 | ⚠️ D15 | 生产未合并 |
| 安装指南 / 下载 / 文档（Popover+图标链） | 安装指南 / 下载 / 文档（Popover 图标链） | ✅（F1-6，T01-F10） | 生产已补该列 |
| 平台 / 架构（os/arch Tag） | —（无列） | ⚠️ D15 | 生产无该列 |
| 操作：mapping→编辑/删除；template→去配置 | 操作：编辑 | ⚠️ F1-5 | 生产无删除（契约支持软删）与 template「去配置」快捷动作 |
| 空态内联登记（「池中没有需要的采集器？→登记自研/第三方」） | 空态内联登记按钮「池中没有需要的采集器？登记自研/第三方」 | ✅（A9，T01-F10） | 生产空态提供登记入口并打开 ExporterTemplateDrawer |
| 顶部「共 n 行（映射 m · 池中 t，未引用 u）」计数 | —（无） | ⚠️ D15 | 生产无池全貌计数 |

### 3.4 规则编辑（原型 RulesPage vs `RulesPage.tsx`）

| 原型 | 生产 | 对齐 | 备注 |
|------|------|------|------|
| 文件挂载 FileMountView（上传/粘贴 + groups 校验） | RulesPage 列表 + RuleMountDrawer | ✅ | 上传/粘贴 + `validateYamlClient` 本地预检（dev F-04 新建态无 id） |
| Statistic 卡（已挂载文件/规则条数/已启用） | —（无） | ⚠️ **D1** | 生产无统计卡 |
| 字段化编辑 Segmented（v0.3 预览） | —（无） | ⚠️ D3 | v0.3 裁剪 |
| 列表列：规则文件名/规则条数/更新时间/下发状态(M09可点)/启用/操作 | 列表列：规则名/内容形态/规则条数/更新时间/启用状态/下发状态/操作 | ✅（下发状态见 F5） | 生产多「内容形态」列（➕合理增强）；下发状态生产为纯文本（F5） |
| V02Badge（克隆/批量等 v0.2 角标） | —（无） | ❌ A1/A2 | v0.2 能力角标生产全部去除 |

### 3.5 技术指标库（原型 MetricLibraryPage vs `MetricLibraryPage.tsx`）

| 原型 | 生产 | 对齐 | 备注 |
|------|------|------|------|
| 按 CI 类型分组 Card + Badge 计数 | 扁平只读列表（分页） | ⚠️ F1-7 | 生产无分组浏览 |
| 新增/编辑/删除（is_builtin 内置禁改删） | —（只读，无编辑） | ⚠️ F1-7 | 契约 §8 支持用户扩展 POST；MVP 前端只读（契约 §8.3 POST/PUT 已实现后端，前端 UI 裁剪 P1） |
| 语义域筛选（category 下拉） | —（无） | ⚠️ **E2** | 契约 category P1 可选，生产未做 |
| 语义域列（category Tag） | —（无列） | ⚠️ E2 | |
| 内置 / 用户扩展列（Tag） | —（无列） | ⚠️ F1-7 | 生产无 is_builtin 标注列 |
| 来源采集器 / 标签列 | 来源采集器 / HELP/单位（无标签列） | ⚠️ | 生产无「标签」列与「内置」列 |
| 顶部统计（共 n 个，内置/用户扩展，按 n 个 CI 类型组织） | 顶部说明段落（两库定位） | ⚠️ | 生产改为定位说明，无统计 |
| — | 资源类别 → 监控类型两级筛选（CATEGORY_MAP） | ➕新增 | 生产新增类别级筛选，对齐契约 §8 monitor_type 维度 |

---

## 4. 导航 IA：原型分组 vs 生产导航

| 原型（Sider 分组 + 折叠） | 生产（Header 一级 tab + Sider 二级） | 偏差 |
|-----------------------------|---------------------------------------|------|
| 采集器管理（**Sider 一级**，/collectors）<br/>采集 Job（**Sider 一级**，/scrape-jobs）<br/>（2026-08-23 裁定：取消「采集策略」分组，两页提升为一级） | 「采集策略」一级 tab<br/>　Sider 二级：采集 Job（内含 采集器管理 Tab） | ⚠️ **F1/F-09 折叠子菜单→独立两页**：原型已取消「采集」折叠父组与「采集策略」分组，两页独立一级；生产「采集器管理」由页内 Tab 拆独立 /collectors 路由待 T01-F17 实施，「采集策略」分组是否保留以生产实施时最新裁定为准 |
| 「指标库」父组（折叠）（技术/业务/视图） | 「采集策略」> Sider 二级「指标库」单一子项 | ⚠️ F1/D3：业务指标库与业务视图为 P2 不在本期 |
| 「规则编辑」独立项（位于「指标库」之后，PRD §3.1） | Sider 二级「规则编辑」 | ✅（语义词义一致；层级差异随 F-09 生产实施对齐） |
| 「全局导航」disabled 占位（含监控策略/配置中心/指标查询/告警/系统设置） | Header 一级 tab：首页/系统与平台管理/监控对象管理/采集策略（前两个为 M06/M07 已落地，跨模块真实可达） | ➕生产新增跨模块一级 tab（更真实，替代原型 disabled 占位） |

> 折叠子菜单偏差结论（2026-08-23 修订）：原型已取消「采集」折叠父组与「采集策略」分组——采集器管理（/collectors）与采集 Job（/scrape-jobs）提升为 Sider 一级项，规则编辑为独立一级项（位于「指标库」之后）；生产侧「采集器管理」由页内 Tab 拆为独立 /collectors 路由（F-09，T01-F17 待实施），「采集策略」分组是否保留以生产实施时最新裁定为准。

---

## 5. 裁剪清单 clipping（应修复 bug vs 可登记 MVP 裁剪）

### 5.1 应修复 bug（生产行为缺陷 / 契约冲突，需修）

| 编号 | 位置 | 问题 | 依据 |
|------|------|------|------|
| FIX-1 | `ScrapeJobListPage` 采集器列 | 列渲染静态「默认采集器」占位，未按 exporter_template_id 解析名称 | ✅ 已修（T01-F9）：exporter_template_id→真实模板名解析 + 标签模板列补全 |
| FIX-2 | `ScrapeJobFormDrawer` instance 查询 | 网域下拉已过滤+编辑态 `disabled`，若契约允许改网域则被收紧 | ✅ 已修（T01-F11）：按契约 §5/§10 放开编辑态改网域（决策①）；冻结过滤见 M07 |
| FIX-3 | `ScrapeJobListPage` 参数同步列 | 数据源 `mapping_overrides` 提交未持久化（dev F-03）→「已覆盖 n 项」回显不准 | ✅ 已修（T01-F12）：异常驱动三态 + 默认映射快照对比（dev F-03 口径） |

### 5.2 可登记 MVP 裁剪（合理裁剪，PD/PM 确认）

| 编号 | 裁剪内容 | 理由 | 归类 |
|------|----------|------|------|
| A1 | 多选 + 批量提交生效（v0.2） | dev-feedback 已登记 v0.2 范围外 | 裁剪 |
| A2 | 克隆 Job（v0.2） | v0.2 范围外 | 裁剪 |
| A4 | 采集器管理 Steps 三步动线 | MVP 以按钮主次 + Tooltip 替代，动线可后补 | P1 缺失（可修） |
| A7 | 网域选择器空态引导（M06/M09） | 网域下拉已仅已纳管非冻结；空态无跨模块跳转 | P1 缺失（可修） |
| A9 | 采集器空态内联登记入口 | 生产空态 `Empty` 无登记按钮 | P1 缺失（可修） |
| B2 | FieldGuide 字段说明轻量提示组件 | 生产仅个别内联 Alert，未统一组件 | P2 裁剪 |
| C1 | 采集器登记回选联动（D17） | 空态登记 + 保存后回选到来源表单 | P1 缺失（可修） |
| D1 | 规则页 Statistic 卡（已挂载/规则数/已启用） | 统计卡为增强信息，非主链路 | P2 裁剪 |
| D3 | 字段化编辑 Segmented（v0.3 预览） | v0.3 范围外，契约明确 | 裁剪 |
| E2 | 指标库语义域筛选 | 契约 category P1 可选 | P2 裁剪 |
| E3 | 指标库按 CI 类型分组浏览 | 生产扁平列表可满足，分组为浏览增强 | P2 裁剪 |
| F1 | 折叠子菜单（采集/指标库父菜单） | 已决策以 Header tab + 页内 Tab 替代 | 已决策裁剪 |
| F2 | 指标库编辑/新增/删除 UI | 契约前端本期只读，MVP 开口 P1 | 裁剪（契约 P1） |
| F3 | Job/规则下发状态「待确认→跳 M09」 | dev F-05 占位，M09 未落地 | 裁剪（dev F-05） |
| F4 | 指标库「内置/用户扩展」/「标签」列 | 信息增强列，非验证必需 | P2 裁剪 |
| F5 | D15 列收敛（Job 类型 Tag、Endpoint 合并、平台/架构） | 视觉一致性问题，非功能缺陷 | P2 |

---

## 6. 偏离清单（Step2 正式偏离）

三类：**缺失（原型有生产无）/ 新增（原型无生产有）/ 列文案不一致**；影响 ⚠️ **P0 阻塞 / P1 体验·验收 / P2 可延后**。

> 说明：P0/P1 项将映射到任务序列新增修复任务（T01-F9~，见 task-sequence.yaml）；P2 项登记裁剪（§5）。

### 6.1 缺失（原型有、生产无）

| 偏离ID | 内容 | 影响 | 关联原型/生产 | 处置 |
|--------|------|------|---------------|------|
| F1-1 | Job 列表缺「标签模板」列 + 采集器列占位未解析名称 | **P1** | 原型 labels/采集器列；生产缺列/占位 | ✅ T01-F9（2026-08-23） |
| F1-4 | Job 编辑抽屉标签模板退化为输入 ID（原卡片选择/补配） | **P1** | 原型卡片式；生产裸 Input | ✅ T01-F11（2026-08-23） |
| A4 | 采集器管理 Steps 三步动线缺失 | **P1** | 原型 collectors Steps；生产无 | ✅ T01-F10（2026-08-23） |
| F1-6 | 采集器管理「安装指南 / 下载 / 文档」列缺失 | **P1** | 原型 Popover 图标链；生产无 | ✅ T01-F10（2026-08-23） |
| A9 | 采集器空态内联登记入口缺失 | **P1** | 原型空态「池中没有？登记」；生产 Empty | ✅ T01-F10（2026-08-23） |
| A7 | 网域选择器空态引导（M06/M09 跨模块）缺失 | **P1** | 原型 D1 空态统一规范 | ✅ T01-F11（2026-08-23） |
| C1 | 采集器登记回选联动（D17）未实现 | **P1** | 原型 registerCtx 回选；生产无 | ✅ T01-F11（2026-08-23） |
| F1-5 | 采集器管理「未被引用」模板行并入 + 模板「去配置」动作缺失 | **P1** | 原型 CollectorRow template；生产仅映射行 | T01-F10 |
| F1-8 | 采集 Job 表单 / 默认采集配置表单「资源类别+监控对象类型」两字段被合并成单个监控类型 Select | **P1** | 原型 L2001-2021 两 Col 字段；生产 ScrapeJobFormDrawer L281 / MappingDrawer L130 单 Select（OptGroup） | ✅ T01-F13（2026-08-23）拆回「资源类别 + 监控对象类型」两字段两级级联，提交载荷仍为 single monitor_type |
| D1 | 规则页 Statistic 卡缺失 | P2 | 原型 Statistic 三卡 | 裁剪 |
| E2 | 指标库语义域筛选缺失 | P2 | 原型 category 下拉 | 裁剪 |
| F1-7 | 指标库分组 / 编辑 / 内置标注 缺失 | P2 | 原型 CI 分组 + 编辑 | 裁剪（契约 P1） |
| B2 | FieldGuide 字段说明未统一 | P2 | 原型轻量提示组件 | 裁剪 |

### 6.2 新增（原型无、生产有）

| 偏离ID | 内容 | 影响 | 处置 |
|--------|------|------|------|
| N-1 | Header 一级功能模块 tab（跨模块真实可达，替代原型 disabled 全局导航占位） | — | 采纳（D1） |
| N-2 | 采集 Job / 规则 / 指标库三个独立路由（原型为一页多子路由） | — | 采纳 |
| N-3 | Job 列表「间隔」独立列、刷新按钮；规则页「内容形态」列 | — | 采纳（合理增强） |
| N-4 | 指标库「资源类别→监控类型」两级筛选 | — | 采纳（契约 §8 维度） |

### 6.3 列 / 文案不一致（视觉·措辞）

| 偏离ID | 内容 | 影响 | 处置 |
|--------|------|------|------|
| F1-2 | 参数同步列：原型「映射默认值已变更/已同步」异常驱动 vs 生产「已覆盖 n 项/同步」，且数据源 mapping_overrides 未持久化 | **P1** | ✅ T01-F12（2026-08-23）三态回显：已覆盖 n 项（蓝）/待同步（橙）/已同步；后端不落库 mapping_overrides 时按默认映射快照异常驱动对比（dev F-03 口径） |
| F3 | 下发状态：原型「待确认」可点击跳 M09 vs 生产纯文本 | P2 | 裁剪（dev F-05） |
| F5 | Job 类型 / Endpoint 合并 / 平台架构：（D15 列收敛）未跟随 | P2 | 裁剪 |
| D15 | 采集器来源：原型行内来源 Tag vs 生产独立「来源」下拉筛选（行内无 Tag） | P2 | 裁剪（可用下拉达成等价） |
| F4 | 指标库 top 统计 vs 生产定位说明段落 | P2 | 裁剪 |

### 6.4 P0/P1/P2 计数

- **P0 阻塞 = 0**：未发现阻塞主采集链路 / 契约验收通过的硬缺陷；FIX-2（网域编辑态 disabled 与契约冲突）先列「需确认」不计 P0。
- **P1 体验·验收 = 9（F1-1/F1-2/F1-4/A4/A7/A9/C1/F1-5/F1-6/F1-8 已修复 ✅ T01-F9~F13，2026-08-23）**：其中 F1-1、F1-4、F1-8（监控类型两字段合并）较重要。→ 映射修复任务 T01-F9~F13。
- **P2 可延后 = 12**：D1 / E2 / F1-7 / B2 / F3 / F5 / D15 / F4 / E3 / A1 / A2 / D3 等（登记裁剪或迭代）。O1/O2/O3 已由用户裁定从裁剪改为待修复（见 §6.5，T01-F14~F16），不计入 P2 裁剪。

### 6.5 复审新增观察项（P2 → 用户裁定待修复，2026-08-23）

> 定向复审发现的行为差异，原登记 P2 裁剪；用户裁定 O1/O2/O3 由「已裁剪」改为「待修复」（T01-F14~F16）。

| 偏离ID | 内容 | 影响 | 处置 |
|--------|------|------|------|
| O1 | Job 列表「标签模板」列「待配置」橙 Tag 在 `label_template_id` 命中时恒显；原型为「异常驱动」（仅 Job 未关联但默认映射已挂标签时显待配置，正常继承不给标记） | P2 | ✅ T01-F14（2026-08-23）：改异常驱动 |
| O2 | `ExporterTemplateDrawer` 登记表单未预填「发起上下文」（当前监控对象类型 → supported_monitor_types）；原型有预填（L3475-3480） | P2 | ✅ T01-F15（2026-08-23）：Job 表单发起登记时预填 supported_monitor_types |
| O3 | 网域空态引导生产为文字指引（指向 M07）；原型为 M06/M09 双链接跳转（L2336-2347） | P2 | ✅ T01-F16（2026-08-23）：按用户口径改指向 M06「网域管理」（默认域自动同步已纳管，未纳管→M06，M06 纳管跳 M09） |

---

## 7. 开发验证待办清单

- [x] Job 列表：采集器列按 exporter_template_id 解析真实名称（F1-1，T01-F9）
- [x] Job 列表：补「标签模板」列（模板名 + 待配置/未关联）（F1-1，T01-F9）
- [x] Job 列表参数同步列：确认 mapping_overrides 持久化后回显口径（F1-2 / T01-F12）→ 后端不落库，按默认映射快照异常驱动三态
- [x] 采集器管理：补 Steps 三步动线（A4，T01-F10）
- [x] 采集器管理：补「安装指南 / 下载 / 文档」列（F1-6，T01-F10）
- [x] 采集器管理：空态内联登记入口 + 未被引用行并入（A9 / F1-5，T01-F10）
- [x] Job 表单：标签模板卡片选择（按资源类别过滤）+ 空态登记入口（F1-4 / A7，T01-F11）
- [x] Job 表单：采集器登记回选联动（C1，T01-F11）
- [x] 网域编辑态 disabled 与契约 §5/§10「可改网域」对齐（FIX-2，T01-F11）→ 按决策①放开编辑态改网域
- [x] 采集 Job 表单 / 默认采集配置表单：「资源类别+监控对象类型」由单 Select 拆回两字段两级级联（F1-8，T01-F13）
- [x] 标签模板列「待配置」橙 Tag 改异常驱动（正常继承不显示，仅 Job 未关联但映射已挂标签时显示）（O1，T01-F14）
- [x] 采集器登记表单从 Job 表单发起时预填「支持监控类型=当前监控对象类型」（O2，T01-F15）
- [x] 网域空态引导改指向 M06「网域管理」可点击链接（未纳管→M06，M06 纳管跳 M09）（O3，T01-F16）
- [x] Job 编辑/详情抽屉实例「采集状态」回显（D47-2，T01-47-F1）：`ExporterInstallationPanel` 顶部在线/待采集汇总 + 每实例三态 badge，`useScrapeJobStatus` 只读消费 M02 `/api/v1/targets`；变更未确认下发时全部待采集
- [ ] 规则页下发状态「待确认→配置变更确认」占位待 M09（dev F-05）
- [ ] 全局：`make test-platform` + 前端 `pnpm test` / `pnpm lint` 通过
- [ ] 全局：后端 run + 前端 dev 200，采集主链路（创建 Job → 选实例 → 安装确认 → preview）走通

---

## 8. 需用户决策的点（无法判定）

1. **编辑态网域 `disabled`**：~~生产 `ScrapeJobFormDrawer` 网域 `disabled={isEdit}`，禁止编辑态改网域；契约 §5/§10 写明 `PUT /scrape-jobs/:id` 可改 network_domain_id（仅约束冻结域禁止新增该域实例）。二者冲突——是否按契约放开编辑态改网域？（关系到 FIX-2/T01-F5 验收口径）~~ **已定（2026-08-23）：按契约放开编辑态改网域**（T01-F11 实现，见 §6/§7；对应 dev-feedback F-07）。
2. **D6「前往配置变更确认」占位**：生产以 toast 文案占位、无真实跳转，是否接受直到 M09 落地？（dev F-05）
3. **P1 修复范围**：§6.1 P1 共 8 项，是否本期全部修复，还是按「契约验收必需（F1-1/F1-4/F1-2）」优先、其余（A4/A7/A9/C1/F1-5/F1-6）登记为 MVP 裁剪？
4. **E3/D2/D3/F3/F4 裁剪码**：任务引用的大部分审计码（A1/A2/A4/A7/A9/B2/C1/D1/E2/F1）已在仓库设计决策对齐；E3/D2/D3/F3/F4 在本仓库 module-01 文档未检索到原始定义，本文按语义推定归类（§5/§6.4），需 PM 复核是否与既有审查编号一致。
5. **指标库编辑 UI**：后端契约 §8 支持用户扩展 POST/PUT，但生产前端只读（F2）。是否本期补「新增指标」入口，还是维持只读、P1 开口？

---

> 契约快照再生成条件触发（含本映射变更）时，本映射与 task-sequence 的 prototype_pages/ui_contract/nav_contract/clipping 需同步复核。