# 原型 ↔ 生产 映射表：Module_07 监控对象管理

> 依据 `frontend-developer.md` Step 3.5 六项核对，解决「原型视觉 / 列 / 入口与生产实现断层」问题。
> 本表作为 L3 规划与前端代码 review 的逐项勾验载体，反向从 `docs/prototypes/module-07` 与 `ui-custom/web/src/pages/{resources,label-templates}` 生成。

## 一、决策落版

| 决策 | 选择 | 落地说明 |
|------|------|----------|
| D1 视觉还原 | **a 强制** | `ui-custom/web` 必须复用原型 theme Token；禁止沿用 antd 默认 `#1677ff`。头部 `#0B1B2A`、内容背景 `#F7F8FA`、主色 `#0ECDEB`。 |
| D2 原型定位 | **a 实现基底** | 复制页面结构 / 列集合 / 视觉 Token，再按 MVP 裁剪（见下方「裁剪清单」）。 |
| D3 banner 模块入口 | **a 临时版** | `MainLayout` 顶部一级 tab 用 PRD 模块名「监控对象管理」；Sider 二级目标为「资源管理 / 标签模板 / 导入记录」。当前生产仅落地前两个，`导入记录` 内嵌在资源页弹窗/面板中（非独立页面），待 M05 统一导航收口。 |
| D4 缺列补法 | **b 逐列核对** | 任何列删减必须在「理由」列标注。例如「采集状态」列因后端列表暂不返回 `is_monitored` 而裁剪，仅保留「未监控」筛选器。 |
| D5 顶部 tab 模块名 | **a PRD 模块名** | 顶部一级 tab 用「监控对象管理」，不用功能页名「资源管理」；功能页名下沉为 Sider 二级。 |
| D6 共享组件复用 | **a 强制** | 筛选区 / 表格 / 长文本复用原型 `FilterBar` / `FilterItem` / `tablePresets` / `EllipsisText`，禁止散点手写 `<Space wrap>` 与 `style={{ maxWidth }}`。 |
| **D47-3 采集状态三态** | **a 已实现（修订）** | **修订决策 31-M1 的『未监控二元筛选』为『三态 badge + 三态筛选器』**：资源列表「采集状态」列由 v1.24 期「裁剪（仅筛选器）」改为**已实现三态 badge（采集中 / 已下发未采到 / 未监控）**。数据源为 M02 `GET /api/v1/health/coverage`（决策 47-3，commit `59e93fd1` 后端稳定返回 `resource_id` + `monitored.go` 三态标注），前端 `useResourceCoverage` Map by resource_id 行合并 + `MonitorStatusBadge` 渲染，并新增三态筛选器（前端按 `monitor_state` 过滤）。前端实现 commit `f9d7f53f`（T07-47-F1）。 |

## 二、文件级映射

| 原型文件（`docs/prototypes/module-07/src/`） | 生产对应（`ui-custom/web/src/`） | 处理 | 核对项 | 说明 / 理由 |
|---|---|---|---|---|
| `theme.ts` | `src/theme.ts` | **复制** | D1 视觉还原 | 火山引擎 Token 已整体迁移：`colorPrimary #0ECDEB`、`colorHeaderBg #0B1B2A`、`colorBgBase #F7F8FA` 等。 |
| `App.css` | `src/App.css` | **复制 + 裁剪** | D1 / D3 | 深色头部、内容背景、辅助色类保留；移除原型的 `.page-header`/`.page-card` 等页面级样式（改由组件内联/Card 默认）。新增 AWS 式顶部 tab 下划线样式。 |
| `pages/ResourcesPage.tsx` | `src/pages/resources/ResourcesPage.tsx` + `ResourceFormDrawer.tsx` + `ResourceDetailDrawer.tsx` + `ImportModal.tsx` + `ImportRecordsPanel.tsx` + `useResources.ts` | **复制 + 拆分** | 2 / 3 / 6 | 原型单文件 1700+ 行按 L3 任务拆分为：列表页（T07-F3）、新增/编辑抽屉（T07-F4）、Excel 导入弹窗（T07-F5）、导入记录面板（T07-F5）、详情抽屉（T07-F6）、列表数据 Hook。 |
| `pages/LabelTemplatesPage.tsx` | `src/pages/label-templates/LabelTemplatesPage.tsx` + `TemplateList.tsx` + `TemplateDetailTabs.tsx` + `MappingDrawer.tsx` | **复制 + 拆分** | 2 / 3 / 6 | 原型单文件按 L3 任务拆分为：页面壳（T07-F7）、左栏列表（T07-F7）、右栏三 Tab（T07-F8）、映射抽屉（T07-F8）。新增 `labelTemplateConstants.ts` 承载来源/字段/转换选项。 |
| `pages/ImportHistoryPage.tsx` | —（功能并入 `ResourcesPage` 的 `ImportModal` / `ImportRecordsPanel`） | **删除（独立页）** | 3 导航 IA | 原型独立页面在生产中内嵌为资源列表的「导入记录」弹窗/面板，无独立路由。 |
| `layouts/MainLayout.tsx` | `src/layouts/MainLayout.tsx` | **复制 + 裁剪** | D3 / D5 | 移除原型「评审说明开关」「角色切换」等原型脚手架；保留顶部一级模块 tab + Sider 二级导航。当前模块组：首页 / 系统与平台管理 / 监控对象管理 / 采集策略。 |
| `App.tsx` | `src/App.tsx` | **复制 + 裁剪** | 1 路由 | 生产注册 `/resources`、`/label-templates`；未注册 `/import-history`（导入记录为资源页内嵌）。 |
| `components/FilterBar.tsx` / `FilterItem` | `src/components/FilterBar.tsx` | **复制** | D6 | 与原文件基本一致，仅注释调整。 |
| `components/tablePresets.ts` | `src/components/tablePresets.ts` | **复制** | D6 | `TABLE_SCROLL_X` / `TABLE_PAGINATION` 复用。资源列表实际分页改用 `pageSize=50`（PRD §11.2），但仍以 `TABLE_PAGINATION` 为基线扩展。 |
| `components/EllipsisText.tsx` | `src/components/EllipsisText.tsx` | **复制** | D6 | 与原文件一致。 |
| `components/ReviewNote.tsx` / `ReviewNoteSwitch.tsx` | — | **删除** | 实现基底裁剪 | 原型评审脚手架，不进入生产。 |
| `contexts/ReviewNotesContext.tsx` | — | **删除** | 实现基底裁剪 | 同上。 |
| `mocks/module-07.ts` | `src/api/resources.ts` / `labelTemplates.ts` / `domain.ts` / `types/resource.ts` / `types/label.ts` 等 | **替换** | 4 数据契约 | mock 数据替换为真实 API 调用；类型以 PRD + API 标准为准。 |

## 三、表格列 / 区块对照

### 3.1 资源列表（ResourcesPage）列

> 共享列定义：网域 / 业务 / 来源 / 运行状态 / 操作在五类资源中均存在。

| # | 原型列 | 生产现状 | 处理 | 理由 |
|---|--------|----------|------|------|
| 1 | 实例名 / 主机名（host） | ✅ 已有 | — | 渲染为上下两行的 `Space` + `EllipsisText`。 |
| 2 | IP 地址 | ✅ 已有 | — | `instance_ip` 平铺字段。 |
| 3 | 操作系统（host） | ✅ 已有 | — | `os_type`。 |
| 4 | 应用 / 环境 / 集群（host） | ✅ 已有 | — | 原型用 `Tag` 组合，生产对齐。 |
| 5 | 实例名（database / middleware） | ✅ 已有 | — | — |
| 6 | 数据库类型 / 中间件类型 | ✅ 已有 | — | 颜色略有差异（prototype 用 `green`/`geekblue`，生产对齐）。 |
| 7 | 端口（database / middleware / application / generic_target） | ✅ 已有 | — | `port` 平铺字段。 |
| 8 | 版本（database / middleware） | ✅ 已有 | — | — |
| 9 | 服务名（application） | ✅ 已有 | — | `service_name`。 |
| 10 | 健康检查 URL（application） | ✅ 已有 | — | 启用 `ellipsis`。 |
| 11 | 协议 / 端点（application） | ✅ 已有 | — | — |
| 12 | 目标名称（generic_target） | ✅ 已有 | — | `target_name`。 |
| 13 | Exporter 类型（generic_target） | ✅ 已有 | — | — |
| 14 | 采集路径 / 协议 / 自定义标签（generic_target） | ✅ 已有 | — | 自定义标签用 `Text code` 展示。 |
| 15 | 网域 | ✅ 已有 | — | 原型展示 `network_domain_id` Tag；生产通过 M06 接口解析为域名，未匹配时兜底显示 ID。 |
| 16 | 业务 | ✅ 已有 | — | 原型本地 mock `biz_name`；生产通过 `businessDomainApi.list` 解析，停用业务显示「业务名（已停用）」。 |
| 17 | 来源 | ✅ 已有 | — | `source_type` → `手动录入 / Excel 导入 / CMDB 同步`。 |
| 18 | **采集状态**（is_monitored） | ✅ 已实现（三态 badge + 三态筛选） | **由「暂裁」修订为已实现** | **D47-3 修订决策 31-M1**：后端 `list.go` 稳定返回 `resource_id`（commit `59e93fd1`），前端 `useResourceCoverage` 一次拉取 M02 coverage Map by resource_id 行合并，`MonitorStatusBadge` 渲染三态（采集中=绿 / 已下发未采到=橙，Tooltip 显 health/last_error / 未监控=灰）；并新增三态筛选器（前端按 `monitor_state` 过滤，coverage 失败降级 `-`）。实现 commit `f9d7f53f`（T07-47-F1）。 |
| 19 | 运行状态 | ✅ 已有 | 对齐列头 | 列头 hover 提示数据来源，UI 展示名「运行状态」（PRD 决策 32）。 |
| 20 | 操作（详情 / 编辑 / 删除） | ✅ 已有 | 对齐 | 生产用 `Popconfirm` 二次确认；原型用 `Modal.confirm`。 |
| 21 | Tab 标题计数（含未监控数） | ❌ 缺失 | **裁剪** | 原型 Tab 显示「主机（N · 未监控 M）」；生产仅显示类别名。后端未返回聚合计数，MVP 可接受。 |

### 3.2 标签模板页 → 映射明细列

| # | 原型列 | 生产现状 | 处理 | 理由 |
|---|--------|----------|------|------|
| 1 | 来源字段 | ✅ 已有 | — | `source_field`，以 `Text code` 展示。 |
| 2 | 来源类型 | ✅ 已有 | — | 颜色 Tag 对齐原型 `SOURCE_TYPE_COLOR/LABEL`。 |
| 3 | 目标标签 | ✅ 已有 | — | 目标标签高亮。 |
| 4 | 转换规则 | ✅ 已有 | — | `transform` 为空显示 `-`。 |
| 5 | 启用 | ✅ 已有 | — | `Badge` 展示启用/禁用。 |
| 6 | 操作（编辑 / 删除） | ⏭️ 部分实现 | **默认模板只读** | 生产对 `is_default=true` 的模板隐藏操作列，符合 PRD「默认模板不可删改映射」。原型未做此保护，生产更严格。 |

### 3.3 标签模板页 → 关联实例列

| # | 原型列 | 生产现状 | 处理 | 理由 |
|---|--------|----------|------|------|
| 1 | 实例名 | ✅ 已有 | — | — |
| 2 | 目标 IP | ❌ 缺失 | **待补** | 后端 `TemplateInstanceItem` 类型未暴露 `instance_ip`，或生产列集合未包含。 |
| 3 | 环境 | ❌ 缺失 | **待补** | 同上。 |
| 4 | 应用 | ❌ 缺失 | **待补** | 同上。 |
| 5 | 状态 | ✅ 已有 | — | `Badge` 状态展示。 |
| 6 | 资源 ID | ✅ 新增 | — | 生产新增列，便于与资源列表联动。 |

### 3.4 导入记录列

> 原型：`pages/ImportHistoryPage.tsx`；生产：`resources/ImportRecordsPanel.tsx`（内嵌弹窗）。

| # | 原型列 | 生产现状 | 处理 | 理由 |
|---|--------|----------|------|------|
| 1 | 导入文件名 | ❌ 缺失 | **替换为导入编号** | 生产以 `import_no` + 导入时间标识记录，未展示原始文件名。 |
| 2 | 资源类别 | ✅ 已有 | — | — |
| 3 | 导入模式 | ✅ 新增 | — | 生产新增 `mode` 列（仅新增 / 新增或更新），原型无此列。 |
| 4 | 总数 | ✅ 已有 | — | — |
| 5 | 成功 / 失败 | ✅ 已有 | — | — |
| 6 | 成功率 | ❌ 缺失 | **裁剪** | 生产未计算进度条，以后续迭代评估是否需要。 |
| 7 | 状态 | ✅ 已有 | — | — |
| 8 | 导入时间 | ✅ 已有 | — | — |
| 9 | 操作（查看） | ✅ 已有 | — | 生产点击打开详情 Modal，原型同。 |

## 四、导航与 IA 模型

### 4.1 顶部一级 tab（Header）

| 原型 / PRD 模块名 | 生产实现 | 备注 |
|---|---|---|
| 首页 | `home` → `/` | 占位，待 M05 统一门户。 |
| 系统与平台管理 | `platform-admin` → `/admin/domains` | M06 网域管理入口。 |
| **监控对象管理** | `monitoring-object` → `/resources` | **D5：使用 PRD 模块名**。 |
| 采集策略 | `monitoring-strategy` → `/scrape-jobs` | M01 入口。 |

### 4.2 Sider 二级入口（当前模块：监控对象管理）

| 目标入口 | 路径 | 生产现状 | 备注 |
|---|---|---|---|
| 资源管理 | `/resources` | ✅ 已实现 | Sider 选中态与路由联动。 |
| 标签模板 | `/label-templates` | ✅ 已实现 | — |
| 导入记录 | `/import-history` | ❌ 未作为独立页面 | 功能并入资源页「导入记录」按钮打开的 Modal/Panel。若后续需要独立页面，需新增路由并调整 `MainLayout` 的 `subItems`。 |

### 4.3 跨模块占位

- **监控策略**：`采集 Job / 规则编辑 / 指标库`（M01，当前生产已注册路由 `/scrape-jobs`、`/rules`、`/metric-library`）。
- **配置中心 / 告警 / 系统设置**：当前未在顶部 tab 列出，待 M05 统一导航收口。

## 五、视觉 Token 清单

| Token | 值 | 用途 | 来源文件 |
|---|---|---|---|
| 主色（Primary） | `#0ECDEB` | 主按钮、选中态、链接高亮 | `src/theme.ts` `colorPrimary` |
| 主色背景浅 | `#E6FAFD` | 选中卡片背景、hover 背景 | `src/theme.ts` `colorPrimaryBg` |
| 头部深色 | `#0B1B2A` | `Header` 背景 | `src/theme.ts` `colorHeaderBg` / `src/App.css` `.app-header` |
| 成功色 | `#00B578` | 成功状态 / 成功标签 | `src/theme.ts` `colorSuccess` |
| 警告色 | `#FA8C16` | 维护中 / 警告提示 | `src/theme.ts` `colorWarning` |
| 错误色 | `#FF4C3A` | 离线 / 删除 / 错误 | `src/theme.ts` `colorError` |
| 信息蓝 | `#1481FD` | 链接 / 信息提示 | `src/theme.ts` `colorInfo` |
| 页面背景 | `#F7F8FA` | `Content` 背景 | `src/theme.ts` `colorBgBase` / `src/App.css` `.app-content` |
| 容器背景 | `#FFFFFF` | Card / Sider | `src/theme.ts` `colorBgContainer` |
| 主要文字 | `#1D2129` | 正文 | `src/theme.ts` `colorTextBase` |
| 次要文字 | `#4E5969` / `#86909C` | 辅助说明 | `src/theme.ts` `colorTextSecondary` / `colorTextTertiary` |
| 字体栈 | `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', ...` | 全局字体 | `src/App.css` `body` |

## 六、裁剪清单（原型中有但 MVP 生产未保留）

| 原型项 | 生产处理 | 理由 |
|---|---|---|
| `<ReviewNote>` / `<ReviewNoteSwitch>` / `ReviewNotesContext` | 删除 | 原型评审脚手架，不进入生产。 |
| `mock/module-07.ts` 全量 mock | 替换为 API 调用 | MVP 必须对接后端。 |
| `ImportHistoryPage` 独立页面 | 删除独立页，功能并入 `ImportModal` / `ImportRecordsPanel` | 减少导航层级，与资源导入动线保持一致。 |
| ~~资源列表「采集状态」列~~ | **已实现，移出裁剪清单** | **D47-3 修订**：该列由「列裁剪，仅保留筛选器」改为已实现三态 badge（采集中/已下发未采到/未监控）+ 三态筛选器（commit `59e93fd1` 后端 / `f9d7f53f` 前端），不再裁剪。 |
| Tab 标题中的资源总数 / 未监控数 | 裁剪 | 后端未提供聚合计数接口；MVP 先展示纯类别名。 |
| 被引用采集 Job 表格 | 空态占位 | 数据源为 M01 `GET /api/v1/scrape-jobs?label_template_id=`，尚未接入。 |
| 标签模板「克隆」成功后自动切换选中 | 保留功能 | 生产已实现，与原型一致。 |
| 详情页 CMDB 字段区块 | 占位提示 | `cmdb_ci_id` 等为 v0.4+ 预留，MVP 不在详情展示。 |
| database / middleware 详情「连接串」 | 未展示 | 生产 `ResourceDetailDrawer` 的类型字段未包含 `connection_string`，待评估是否需补。 |
| 资源详情「批量标签编辑」入口 | 裁剪 | PRD 标注「后续版本开放」。 |
| 资源列表「列设置」入口 | 裁剪 | PRD P1 功能，MVP 列固定展示。 |
| 顶部 Header 角色切换器（ops1 / ops2） | 裁剪 | MVP 单租户，角色切换后续由 M05/M06 统一权限入口承载。 |
| 全局折叠评审说明区 | 裁剪 | 原型产物，不进入生产。 |

## 七、开发验证待办清单

- [ ] D1：确认 `src/theme.ts` 已全局注入，页面头部为 `#0B1B2A`、主按钮为 `#0ECDEB`，无 antd 默认 `#1677ff` 残留。
- [ ] D5：确认 `MainLayout` 顶部一级 tab 文案为「监控对象管理」；Sider 二级为「资源管理 / 标签模板」（导入记录当前内嵌，如需独立页面后续补路由）。
- [ ] D6：确认 `ResourcesPage`、`LabelTemplatesPage`、`ImportRecordsPanel` 的筛选区均使用 `FilterBar/FilterItem`；表格使用 `TABLE_SCROLL_X`，长文本使用 `EllipsisText`。
- [ ] 路由：确认 `src/App.tsx` 注册了 `/resources`、`/label-templates`，未注册 `/import-history`（与内嵌设计一致）。
- [ ] 资源列表：五类资源 Tab 切换时请求后端并刷新；列集合与上方「3.1」表一致；**「采集状态」三态筛选器（采集中 / 已下发未采到 / 未监控）按 `monitor_state` 过滤正确，`MonitorStatusBadge` 行渲染与 `useResourceCoverage` Map by resource_id 合并一致（D47-3，T07-47-F1）**。
- [ ] 资源新增/编辑抽屉：`ResourceFormDrawer` 按 `resource_category` 差异化渲染字段；`biz_code` 必填且下拉仅启用业务；编辑态展示只读 `resource_id / 资源类别 / 来源`。
- [ ] 资源详情抽屉：`ResourceDetailDrawer` 展示基础信息、类型字段、适用模板、标签管理；仅 `application` 资源开放 user 标签编辑入口；静态资源写标签返回 403 时提示正确。
- [ ] Excel 导入：`ImportModal` 模板下载、文件上传、导入模式选择、结果统计（total/success/updated/failed）、错误行表格正常。
- [ ] 导入记录：`ImportRecordsPanel` 支持按资源类别 / 状态筛选、分页；空态提供「下载模板 / 上传 Excel」引导；详情 Modal 展示错误明细。
- [ ] 标签模板左栏：`TemplateList` 搜索、默认/自定义筛选、克隆、删除（默认模板禁用删除）正常；点击卡片联动右栏。
- [ ] 标签模板右栏：`TemplateDetailTabs` 三 Tab（映射明细 / 关联实例 / 被引用 Job）切换正常；映射按来源类型分组；默认模板只读保护（无新增/编辑/删除操作入口）。
- [ ] 映射抽屉：`MappingDrawer` 来源字段联动、目标标签默认预填、保护 label 校验、同模板 target_label 唯一性校验、转换规则下拉（无/lower/upper，prefix/replace 置灰）正常。
- [ ] 缺失项跟踪：确认「关联实例」缺失的 IP/环境/应用列、「导入记录」缺失的文件名列/成功率列、「被引用 Job」表格是否在本次迭代补全或明确延后。
- [ ] 权限/错误状态：验证资源列表 / 模板列表 / 标签 / 导入记录的加载中、空态、接口错误、权限不足状态矩阵与 PRD §11.1 一致。
- [ ] TODO：确认 `ImportHistoryPage` 是否需要从 Sider 独立入口恢复；若 M05 统一导航决定保留内嵌，则更新本表并删除原型独立页引用。
- [ ] TODO：确认 `connection_string` 是否需要在资源详情中展示；若 PRD 要求展示，则在 `ResourceDetailDrawer` 的类型字段中补列。
