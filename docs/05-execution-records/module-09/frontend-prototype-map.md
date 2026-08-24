# Module_09 前端「原型 ↔ 生产」映射与偏离清单

> 本文档是 code-sequence-planner 为 M09「网域与边缘配置中心」落盘的前端原型映射表（Phase 4，MVP 规划态，非交付基线）。
> - 权威基底（只读，不修改）：`docs/prototypes/module-09/src/**`（原型 v1.49）
> - 生产实现（本分支将新建）：`ui-custom/web/src/pages/config-center/**`、`ui-custom/web/src/layouts/MainLayout.tsx`、`ui-custom/web/src/App.tsx`
> - 契约（前端第一权威）：`api-contract-snapshot.md`（下文简称「契约」）
> - 范围边界：MVP = `default` 域 + `local` 通道的配置生成/预览/Diff/确认/reload 全链路 + 网域纳管 UI + 采集节点状态**空态占位**；`agent_pull` 网域仅 UI 字段与占位，Edge Sync Agent 拉包/心跳为 v0.2（`feat/module-09-edge-cloud`）。
> - 生成日期：2026-08-23；分支：feat/module-09-config-center
>
> 状态列含义（规划态，用于指导实施）：✅保留=原型要素进入 MVP 生产；⚠️作业=存在 MVP 偏离（见 §6）；⛔裁剪=不进入 MVP 生产（登记 §5）。

---

## 1. 导航结构决策落版

> 生产主布局 `MainLayout.tsx` 采用「Header 一级功能模块 tab + Sider 二级」；原型 module-09 为独立演示壳（自己的 MainLayout）。以下为 M09 页面在统一门户中的导航落版。

| 决策点 | 原型表现 | 生产采纳态 | 状态 |
|--------|----------|------------|------|
| **N1 一级 tab** | 无（原型独立壳） | M09 页面挂到现有「**系统与平台管理**」一级 tab 下（该 tab 已含 M06「网域管理」`/admin/domains`）；沿用 PRD 模块名作 tab 文案 | ✅ 决策·采纳 |
| **N2 一级菜单组（Sider 分组）** | 原型 Sider：「配置变更确认」「下发记录」等平铺 | 「系统与平台管理」tab 的 Sider 需支持**一级菜单组**（antd SubMenu）：组「**网域与节点管理**」（子项：网域纳管、采集节点状态）、组「**配置下发**」（子项：配置变更确认、下发记录） | ⚠️ 作业（N2-1） |
| **N3 采集节点状态入口常驻** | 常驻菜单 | 子菜单常驻，无 `EdgeAgent` 实例时进入空态引导页（不隐藏入口） | ✅ |
| **N4 M06 网域管理与 M09 网域纳管并存** | 原型无 M06 | 同 tab 下京两个入口：M06「网域管理」（行政 CRUD）+ M09「网域纳管」（监控纳管），页面/菜单名区分（PRD §10 术语） | ✅ 决策·采纳 |

---

## 2. 文件级映射表

| 原型文件 | 生产文件（规划） | 状态 | 说明 |
|----------|------------------|------|------|
| `src/pages/NetworkDomainsPage.tsx`（网域纳管） | `ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`、`OnboardDomainDrawer.tsx`、`NetworkDomainDetailDrawer.tsx`、`domainConstants.ts`、`useNetworkDomains.ts` | ⚠️ 作业 | 7 列收敛 + 详情抽屉 + 行内纳管/编辑 + 安装指引占位；agent_pull 字段裁剪占位 |
| `src/pages/EdgeAgentsPage.tsx`（采集节点状态） | `ui-custom/web/src/pages/config-center/nodes/EdgeAgentsPage.tsx`（MVP 空态）、`nodesConstants.ts`、`useEdgeAgents.ts` | ⚠️ 作业 | MVP 仅空态引导页；列表/抽屉/组件分区为 v0.2 |
| `src/pages/ConfigPreviewPage.tsx`（配置变更确认） | `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`、`useConfigDrafts.ts`、`configPreviewYaml.ts` | ⚠️ 作业 | 变更摘要/清单/预览/Diff 四 Tab + 网域切换 + 确认/废弃/重校验；metadata.json 占位 |
| `src/pages/DeploymentsPage.tsx`（下发记录） | `ui-custom/web/src/pages/config-center/deployments/DeploymentsPage.tsx`、`useDeployments.ts` | ⚠️ 作业 | 列表 + 详情 + 回滚 + local 重试 + 定位参数 |
| `src/layouts/MainLayout.tsx` | `ui-custom/web/src/layouts/MainLayout.tsx` | ⚠️ 作业 | Sider 支持一级菜单组；「系统与平台管理」下挂两组菜单（N2） |
| `src/App.tsx` | `ui-custom/web/src/App.tsx` | ⚠️ 作业 | 注册四个 M09 路由 |
| `src/mocks/module-09.ts` | `src/api/configCenter.ts` + `src/types/config-center.ts` + `config-center/domainConstants.ts` | ⚠️ 作业 | mock → API client + 类型契约映射 |
| `src/components/EllipsisText.tsx` / `FilterBar.tsx` / `tablePresets.ts` | 同名 `ui-custom/web/src/components/*` | ✅ | 通用组件复用 |

---

## 3. 列 / 区块对照（按页）

### 3.1 网域纳管页（原型 `NetworkDomainsPage` columns vs 生产规划）

| 原型列 | 生产列（规划） | 状态 | 备注 |
|--------|---------------|------|------|
| 网域（名称+ID 两行合并） | 网域（同，`name` + `id`） | ✅ | |
| 网络区域类型（zone_type Tag） | 网络区域类型（zone_type Tag，政务云/公有云按网域身份维度） | ✅ | zone_type 为 M06 行政字典，M09 只读展示 |
| 纳管状态（registration_status Tag） | 纳管状态（由 `is_monitored` 派生 `monitored`/`created`） | ✅ | 契约 GET network-domains 返回 `is_monitored`；前端派生注册态 |
| 下发通道（channel Tag：local 中性 / agent_pull 蓝） | 下发通道（同） | ✅ | `default` 固定 local |
| 运行状态（状态+心跳合并，仅 agent_pull） | 运行状态（`agent_pull && status` 时展示状态+心跳；local 显 `-`） | ⚠️ C1 | 运行态字段 agent_pull 心跳为 v0.2 占位，MVP local 恒显 `-` |
| 凭据（脱敏 Token+复制，仅 agent_pull） | 凭据（`agent_pull && token` 时脱敏+复制；local 显 `-`） | ⚠️ C2 | Token 生成为 agent_pull v0.2；MVP local 行不展示 |
| 操作（纳管/编辑 + 详情 + 更多[重置 Token]） | 操作（三槽位：主操作=纳管/编辑文本链接 + 详情常驻 + 更多仅 agent_pull 已纳管显示重置 Token） | ⚠️ C3 | 重置 Token 为 v0.2 占位；MVP local 行仅 编辑/详情 |
| 顶部「新网域接入操作流程」提示区（3 步） | 顶部常驻提示区（3 步人工步骤 + 组件构成 + 凭据获取；纳管成功滚动高亮） | ⚠️ C4 | 安装指引仅在纳管 agent_pull 域后引导；MVP local 域裁剪提示强度 |
| 详情抽屉（中心接入地址/Remote Write URL/Agent 类型/描述） | 右侧详情 Drawer（同口径） | ✅ | 配置字段进 Drawer |
| 纳管表单（填写监控参数、Token 自动签发、RW URL 自动推导） | 纳管 Drawer/Drawer 表单：agent_type（MVP 仅 vmagent）、remote_write_url（可覆盖）、description | ⚠️ C2/C5 | default 固定 local 直接可确认纳管，无需 Token；agent_pull 表单字段保 UI |

### 3.2 采集节点状态页（原型 `EdgeAgentsPage` vs 生产规划）

| 原型列 | 生产列（规划） | 状态 | 备注 |
|--------|---------------|------|------|
| 节点（主机名/IP）、网域、整体状态（三档）、Edge Sync Agent、采集器状态、拨测器状态、配置同步、WAL 积压、最后心跳、操作 | —（MVP 空态） | ⛔ C6 | 整页列表/抽屉/组件分区为 v0.2；MVP `default`/local 无 EdgeAgent，恒空态 |
| 多网域/演示场景切换器 | —（无） | ⛔ C7 | 原型演示态，不进入生产 |
| 采集节点状态空态引导 | 空态引导卡片（「尚未接入采集节点」引导 → 网域纳管按指引接入） | ✅ | MVP 保留空态引导（PRD §11.1） |

### 3.3 配置变更确认页（原型 `ConfigPreviewPage` vs 生产规划）

| 原型区块 | 生产区块（规划） | 状态 | 备注 |
|----------|------------------|------|------|
| 网域切换器（按网域组织确认视图） | 网域切换器（Select，行内保留 channel Tag） | ✅ | |
| 变更检测状态（待确认 N 项 + 高风险 / 无变更提示 + 上次检测时间折叠） | 检测状态区 + 待确认列表联动 | ✅ | 30s 轮询（§11.2） |
| 列表（变更单：change_no/网关风险/确认人 + 状态筛选 pending/confirmed/discarded/all） | 列表 + 状态筛选 + 分页 | ✅ | 默认 pending |
| 变更摘要 Tab（Descriptions：change_no/网域/状态/下发通道/生成时间/摘要/校验状态） | 变更摘要 Tab | ✅ | |
| 变更清单 Tab（结构化 change_items：类型/对象/说明/影响的配置文件/风险等级） | 变更清单 Tab | ✅ | |
| 配置预览 Tab（package tree + prometheus.yml/targets/rules.yml/blackbox.yml + metadata.json 条件 Tab） | 配置预览 Tab + **受影响文件高亮**（本次变更影响 N/M）+ 默认聚焦首受影响 | ✅（受影响文件高亮见 PRD §9.1） | metadata.json Tab 仅 agent_pull → v0.2 占位 |
| 版本对比 Tab（diff，当前版本 vs 草稿） | 版本对比 Tab | ✅ | ruby 版本对比 source_version 可空时 Empty |
| 确认 / 废弃 / 重新校验动作 | Modal 二次确认 + loading 防重复 | ✅ | 校验失败草稿不可确认，提供「重新校验」/「废弃」 |
| 技术信息（源数据版本/生成器版本/联合 checksum/触发摘要）折叠 | 折叠区 | ✅ | 仅排障 |

### 3.4 下发记录页（原型 `DeploymentsPage` vs 生产规划）

| 原型列 | 生产列（规划） | 状态 | 备注 |
|--------|---------------|------|------|
| 部署 ID（EllipsisText code） | 部署 ID | ✅ | |
| 网域（domainMap 名） | 网域 | ✅ | |
| 下发通道（local 中性 / agent_pull 蓝） | 下发通道 | ✅ | |
| 配置版本（cv-xxx） | 配置版本 | ✅ | |
| 来源变更单号（code） | 来源变更单号 | ✅ | |
| 状态（pending/running/success/failed/rolled_back） | 状态（failed 带错误 Tooltip） | ✅ | |
| 开始时间 triggered_at | 开始时间 | ✅ | |
| 操作：详情 + 重试(local failed) + 回滚 | 操作：详情 + 重试（仅 local）+ 回滚（非 pending/rolled_back 可点） | ✅ | agent_pull 无重试按钮 |

---

## 4. 导航 IA：生产导航落版（N2）

| 顶部 tab | Sider 一级菜单组 | Sider 二级 | 路由 | 说明 |
|----------|------------------|-----------|------|------|
| **系统与平台管理**（既有一级 tab） | —（平铺） | 网域管理（M06，既有） | `/admin/domains` | 既有，保留 |
| 〃 | **网域与节点管理** | 网域纳管 | `/domain-onboarding` | 新增 M09 |
| 〃 | 〃 | 采集节点状态 | `/node-status` | 新增 M09（MVP 空态） |
| 〃 | **配置下发** | 配置变更确认 | `/config-preview` | 新增 M09 |
| 〃 | 〃 | 下发记录 | `/deployments` | 新增 M09 |

> 生产侧 **N2-1 作业**：`MainLayout.tsx` 当前 `subItems` 为扁平数组，需支持「一级菜单组 + 二级子项」（antd `Menu` items 中嵌套 `children`），并将 `resolveActiveModule` 的 `/domain-onboarding`、`/node-status`、`/config-preview`、`/deployments` 归入「系统与平台管理」模块。

---

## 5. 裁剪清单 clipping（MVP 可登记裁剪 + 用户验收补漏）

### 5.1 MVP 可登记裁剪（agent_pull / Edge Agent 相关，v0.2 承接）

| 编号 | 裁剪内容 | 归属 | 理由 | 承接 |
|------|----------|------|------|------|
| C1 | 运行态字段（状态/最后心跳/Agent 版本）实际展示 | 网域纳管/采集节点状态 | `channel=agent_pull` 心跳由 Edge Sync Agent 上报，MVP 无此链路；`default`/local 恒显 `-` | v0.2 |
| C2 | Token 生成/重置/复制（agent_pull）真实读取 | 网域纳管 | Token 签发在纳管 agent_pull 域时触发，MVP 仅保留 UI 字段与脱敏占位 | v0.2 |
| C3 | 「更多」下拉（重置 Token、二次确认） | 网域纳管 | 仅 agent_pull 已纳管行；MVP local 行隐藏 | v0.2 |
| C4 | 安装指引真实步骤/下载离线包（agent_pull） | 网域纳管 | 一体化离线包交付 + systemd 部署为 v0.2；MVP local 域仅顶部提示区占位 | v0.2 |
| C6 | 采集节点状态列表/组件分区抽屉/错误详情 Modal/五维筛选 | 采集节点状态 | `EdgeAgent` 实例 MVP 不存在（default/local 无 Agent），整页列表为 v0.2 | v0.2 |
| C7 | 演示场景切换器 | 采集节点状态 | 原型演示态，非用户界面 | 裁剪 |
| C8 | metadata.json Tab（agent_pull 配置包） | 配置变更确认 | 配置包 + metadata.json 为 agent_pull v0.2；local 不落 metadata | v0.2 |
| C9 | 跨模块跳转（「去配置采集 Job」→M01、节点状态实时由 Agent 驱动） | 采集节点状态 | MVP 空态无行数据，跨模块跳转随 v0.2 列表落地 | v0.2 |

### 5.2 需要前端实现的主要验收补漏（非裁剪，见 task-sequence 验收项）

- 受影响配置文件高亮 + 变更标记 + 默认聚焦（PRD §9.1）
- 变更检测状态引导 + 30s 轮询（配置变更确认页）
- 回滚异步提示、rolling 本地重试、确认/废弃/回滚二次确认与 loading 防重复（§11.2）
- 变更单号展示（CHG-YYYYMMDD-NNN）、风险等级、确认人列
- 网域切换器 + 行内 channel Tag、驳回 Agent_pull 提示语「发布为配置包，待心跳拉取」

---

## 6. 偏离清单（规划态，实施后按 module-01 示例逐项更新实际状态）

> 本表以「生产 vs 原型」描述预期偏离；P0=契约/验收必需、P1=体验·验收、P2=可延后。实施后由 frontend-developer 在完成时更新状态并登记 new-deviation。

| 缺失（原型有、边规划生产处理） | 影响 |
|------|------|
| 采集节点状态页完整列表/抽屉/组件分区未入 MVP（C6） | P1（v0.2 承接，PRD 标注 v0.2） |
| Token 真实签发/复制未入 MVP（C2） | P1（本地占位，v0.2） |
| 安装指引离线包下载/部署指引未入 MVP（C4） | P1（v0.2） |
| 运行态心跳展示未入 MVP（C1） | P2（local 恒 `-`） |

| 新增（原型无、生产规划实现/沿用） | 说明 |
|------|------|
| M06 网域管理 + M09 网域纳管同 tab 并存入口 | 符合 PRD §10 术语区分 |
| 一级 tab「系统与平台管理」+ Sider 一级菜单组 | 生产统一门户导航落版（N2） |

---

## 7. 开发验证待办清单（规划）

- [ ] `MainLayout.tsx` Sider 支持一级菜单组，M09 四路由挂「系统与平台管理」tab（N2-1）
- [ ] `App.tsx` 注册 `/domain-onboarding` `/node-status` `/config-preview` `/deployments`
- [ ] 网域纳管页 7 列 + 详情抽屉 + 行内纳管/编辑 + 顶部提示区（agent_pull 字段占位）
- [ ] 采集节点状态页 MVP 空态引导
- [ ] 配置变更确认页四 Tab + 网域切换 + 受影响文件高亮 + 确认/废弃/重校验
- [ ] 下发记录页列表 + 详情 + local 重试 + 回滚 + 定位参数
- [ ] 全局：前端 `pnpm test` / `pnpm lint` / `tsc --noEmit` 通过
- [ ] 全局：后端 run + 前端 dev 200，default/local 配置生成→确认→reload→下发记录走通

---

> 契约快照再生成条件触发（PRD 第 5/6 章、`03_API_Standard.md`、后端模型、进入新 Phase）时，本映射与 task-sequence 的 prototype_pages/ui_contract/nav_contract/clipping 需同步复核。