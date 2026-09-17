# 前端审查报告（Round 1）：Module_08 告警收敛与通知管理（含 M02/M01/M07/M09 回显）

## 审查结果

### 摘要

- **审查范围**：`ui-custom/web/` 相对 `origin/develop` 的全部改动（约 40 个源/测试文件）；跨 M02 目标状态页 + targets/coverage API、M01 Job 实例采集状态回显、M07 资源三态 badge、M08 告警配置/静默、M09 配置变更确认（决策 60 alertmanager 预览/联动）。
- **审查方式**：只读；以 M08 契约快照（`api-contract-snapshot.md`）为第一权威，`frontend-prototype-map`（M08/M02/M01/M07）逐项勾验，前端标准 `02_Frontend_Standard.md` 复核。
- **结论**：**APPROVE**
- **最高级别**：MEDIUM（无 CRITICAL / HIGH）
- **执行度量**：约 40 个文件 · 抽查 MainLayout/App.tsx/theme 全量 + alerts 6 文件 + query/resources/strategy/config-center 核心 8 文件 + api/constants/types 全量；`pnpm test`（442 全过）、`pnpm lint`、`pnpm tsc --noEmit`、coverage/api 契约核对均未复核失败（信任边界采信）。
- **核心结论**：六项核对（导航/列区块/UI 展示名/用户文案/交互组件/裁剪留痕）逐项通过（见「对照结论」）；未发现数据安全 / XSS / 契约不一致的阻断项。存在 2 处「服务端分页 + 前端筛选」耦合导致翻页越界的可用性缺陷、若干低危项，建议在接入真实大列表前处理。

### 逐项核对结论（high-risk 预标注 1~8）

1. ✅ 顶级 tab 用 PRD 模块名「告警收敛与通知管理」（`MainLayout.tsx:118-120`）、`首页` 为第一个 tab、Sider 二级「告警配置/静默管理」与路由联动（`resolveActiveModule` `:181` 含 `/alert-config`、`/silences`）。
2. ✅ `App.css:49-90` AWS 式横向文字 tab + 选中下划线（`.app-module-tab-underline`），主色 `#0ECDEB`。
3. ✅ `pages/alerts/*` 对 M08 契约快照字段（snake_case）一致（`types/alertmanager.ts` 全量）；UI 文案基本用用户语言；发现 2 处轻量术语下沉（见 LOW）。
4. ✅ `TargetStatusPage.tsx` 决策 47-4 P1 极简列表，无超范围（含 Badge 三态、health/网域后端式过滤）；coverage 三态在 `useResourceCoverage` / `MonitorStatusBadge` 落地。
5. ✅ `ResourcesPage.tsx:289-306` D47-3 三态 badge + `:535-547` 三态筛选含「未监控」。
6. ✅ `ExporterInstallationPanel.tsx` + `useScrapeJobStatus.ts` D47-2 实例采集状态列 + 在线/总数/待采集汇总，只读消费 M02 targets。
7. ✅ `configPreviewYaml.ts`/`ConfigPreviewPage.tsx` M09 决策 60 alertmanager.yml 条件预览 + 版本对比 + 确认提示均已纳入。
8. ⚠️ `FilterBar/tablePresets/EllipsisText` 复用良好，无散点重复实现；但 YAML 预览内联 `style` 类 `.page-header/.page-card/.yaml-preview` 全仓无 CSS 定义（见 LOW-2）。

---

### CRITICAL

无。

### HIGH

无。

### MEDIUM

- [ ] **M-1 分页与前端筛选耦合导致翻页越界** — `ui-custom/web/src/pages/alerts/SilencesPage.tsx:48-55`（客户端 `filtered`）+ `:206-213`（`pagination={{...TABLE_PAGINATION, total}}` 无 `onChange`） + `useSilences.ts:42`（恒 `page:1, page_size:20`）
  问题：**过滤（状态/关键词）仅作用于已加载的 1 页 20 条**；分页 `total` 用服务端全量数、但数据源只有本地 20 条，且未挂分页回调——点击第 2 页会出现空页，且筛选后 total 与展示不符。功能可用性缺陷。
  建议：将 `status`（页面支持 `active=true` 服务端过滤）与关键词作为 query 参数透传后端；或 Table 分页改用 `filtered.length` 驱动并对全量本地可分页（当前数据量下两者择一即可）。至少应将 `total` 修正为 `filtered.length` 并补 `onChange`。

- [ ] **M-2 版本历史分页同样不可达** — `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx:280-287` + `useAlertConfig.ts:49-52`（仅取 `page:1, page_size:20`，分页无 `onChange`）
  问题：`GET /config/versions` 超 20 条后第 2 页不可达（total 大于实际展示），用户看不到更早版本、无从回滚。
  建议：在 `useAlertConfig` 暴露 `page`/`setPage` 传入 `getVersions({page, page_size})`；或对 `versions` 本地分页并同步修正 `total`。同时给分页加 `onChange`。

- [ ] **M-3 硬编码 mock 身份替代真实登录用户作提交人** — `src/pages/alerts/alertmanagerConstants.ts:14`、`src/pages/config-center/configCenterConstants.ts:21`（`CURRENT_USER = '张伟（运维）'`）；消费点 `AlertConfigPage.tsx:62/95`、`ConfigPreviewPage.tsx:185/214`
  问题：`MainLayout` 已由 M06 `getStoredUser()` 展示真实登录用户，但 M08/M09 提交/回滚/确认的 `uploaded_by`/`confirmed_by` 却传入硬编码「张伟（运维）」，既**未沿用当前登录账号**，又造成本地化伪造审计人。契约 §7（`uploaded_by` 可选、默认当前登录用户）及「静默沿用当前登录账号」的裁剪说明均有偏离。
  说明：`decision 19` MVP 预置确认人为文档化妥协，故评 MEDIUM 而非 HIGH。
  建议：优先改为 `getStoredUser()?.username`（无则省略）；若坚持 MVP 预置，应显式注释挂账并在 M06 用户管理接入后移除硬编码。

---

### MEDIUM / LOW（合并 LOW 列表）
（M 级见上，`L-*` 为 LOW）

- [ ] **LOW-1 「前置校验（服务端 amtool）」按钮文案误导** — `AlertConfigDrawer.tsx:157-179`：该按钮实际仅做非空 + 100KB 大小本地检查并 `setValidated(true)`，**未调用服务端**；真正的 `amtool` 校验发生在提交（`onSubmit`→服务端）。文案宜改为「本地格式预检」，避免用户误以为已触发服务端校验。

- [ ] **LOW-2 死 CSS 类 `.page-header` / `.page-card` / `.yaml-preview`** — 全仓 grep 无这些类的样式定义（`App.css` 未含）；`AlertConfigPage.tsx:192/238/261`、`SilencesPage.tsx:143/161`、`ConfigPreviewPage.tsx:487` 仍引用。这些 className 为 no-op，视觉回退到 Card/内联默认。建议补全局类，或删除 className 改由 Card 默认 + 内联承载（避免后续维护者误以为有样式）。

- [ ] **LOW-3 同一成功态文案跨模块不一致** — `MonitorStatusBadge.tsx:14`（采集中）vs `ExporterInstallationPanel.tsx:18`（采集正常）：M07 与 M01 对「绿色采集正常」用词不同，建议统一（如统一「采集中」/「采集正常」任一套）。

- [ ] **LOW-4 技术术语下沉 UI / 原始串直显** — `CreateSilenceDrawer.tsx:130`「匹配条件（matchers）」标签含英文 `matchers`；`SilencesPage.tsx:90/97` 生效/失效时间直接渲染 ISO 原始串未格式化。建议将术语弱化（如括号文案去掉或换中文说明），时间列统一 `toLocaleString`/dayjs 格式化。

- [ ] **LOW-5 `shortChecksum` 重复实现** — `alertmanagerConstants.ts:42-45` 与 `configPreviewYaml.ts:94-97` 两份同逻辑且截断位不同。建议收敛到共享工具，避免跨 M08/M09 口径漂移。

---

### 对照校验补充（六项逐项结论）

| 六项 | 结论 |
|------|------|
| 1 导航/IA（D3/nav_contract） | ✅ 通过：PRD 模块名 tab、首页第一、Sider 二级联动、`/targets` 无一级 tab（D3）、四态/路由/渠道/抑制路由未注册（裁剪一致） |
| 2 列区块（告警配置/静默/目标状态/资源三态） | ✅ 通过：版本历史列=版本 ID/状态(M09 变更单)/校验和/操作，静默列=匹配条件/生效/失效/原因/状态/创建人等，均对齐映射表 |
| 3 UI 展示名（契约 §8） | ✅ 通过：cf「active=生效中」「applied=已生效」等，`applied_at→生效时间`、`applied_by→应用人` |
| 4 用户文案 | ✅ 基本通过；LOW-4、LOW-1 两处轻量术语/误导待修 |
| 5 交互组件（02_Frontend_Standard §8/§9/§10） | ✅ Modal 二次确认（回滚/删除/确认/废弃）、Drawer 多字段表单、FilterBar/EllipsisText/tablePresets 复用、错误 Alert 带重试、权限空态全路径覆盖 |
| 6 冲突留痕/裁剪 | ✅ 裁剪项（四态页/通知渠道/路由/抑制/前端正则校验→服务端行级）在映射表「六、裁剪清单」留痕；`AlertStatusPage`/`NotifiersPage` 等未进生产 |

**错误/加载/空态/权限矩阵**：告警配置页、静默页均覆盖 `loading`（骨架/Spin）、`error`（Alert+重载）、`permissionDenied`（Empty 页）、空态（Empty 引导）；hoook 层统一 `isApiError` + 403 判定。**安全**：全文无 `dangerouslySetInnerHTML`/`innerHTML`，YAML/错误串经 React 自动转义，无 XSS；无敏感信息硬编码泄露（唯一「张伟」为文档化 mock 身份，见 M-3）。**性能**：告警页并行 `Promise.all` 加载、资源页 coverage 一次性 Map 合并（非逐行查询），符合 TQ-6。

### 遗留风险

- **分页/筛选缺口（M-1/M-2）**：当前 MVP 数据量小可容忍，但一旦接入真实超 20 条列表，静默与版本历史的翻页/筛选会误导用户。建议接入大列表前按 M-1/M-2 建议收口，并在映射表/PRD 验证清单补「>20 条分页」用例。
- **M-3 硬编码身份**：随 M06 用户管理接入应移除，否则审计人记录恒为「张伟（运维）」，需在后续迭代清除并加回归断言。
- **LOW-3 术语统一**：M01/M07 两处「绿色采集正常」文案差异，建议在 M05 门户收口时统一术语字典。
- **资源页 monitorState 客户端筛选 + 服务端分页的近似**（`useResources.ts` 已声明「MVP 从简」）为既有已知项，本模块未引入但未修复；本次合并不阻塞。

---
*本报告仅审查 `ui-custom/web/`，未改任何被审查源码。后端/安全越界项见对应 reviewer 报告。*