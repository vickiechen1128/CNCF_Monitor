# 原型 ↔ 生产 映射表：Module_06 网域管理

> 依据 `frontend-developer.md` Step 3.5 六项核对（v1.30 起，原型定位 = 实现基底）。本表是逐项勾验载体，解决「原型视觉 / 列 / 入口与生产实现断层」问题。
> 决策：D1 视觉还原（a 强制）、D2 原型定位（a 实现基底）、D3 banner 模块入口（a 临时方案，待 M05 收口）、D4 缺列（b 逐列核对 PRD MVP 后补）、D5 顶部 tab 模块名（a 用 PRD 模块名）、D6 共享组件复用（a 强制）。

## 一、决策落版

| 决策 | 选择 | 落地说明 |
|------|------|----------|
| D1 视觉还原 | **a 强制** | `ui-custom/web` 必须复用原型 theme Token；禁止沿用 antd 默认 `#1677ff` |
| D2 原型定位 | **a 实现基底** | 复制页面结构 / 列集合 / 视觉 Token，再裁剪（见映射） |
| D3 banner 模块入口 | **a 临时版** | 首页/banner 加模块入口，标注临时性，等 M05 评审收口 |
| D4 缺列补法 | **b 逐列核对** | 「监控纳管」涉 M09 跨模块语义，改前先核对 PRD MVP |
| D5 顶部 tab 模块名 | **a PRD 模块名** | 顶部一级 tab 用 PRD 模块名「系统与平台管理」而非功能页名「网域管理」；「网域管理」下沉为 Sider 二级页面（对应 frontend-developer.md v1.31 第 7 项） |
| D6 共享组件复用 | **a 强制** | 筛选区 / 表格 / 长文本复用原型 `FilterBar` / `FilterItem` / `tablePresets` / `EllipsisText`，禁止散点 `<Space wrap>`（对应 v1.31 第 8 项） |

## 二、文件级映射

| 原型文件（docs/prototypes/module-06/src/） | 生产对应 / 目标（ui-custom/web/） | 处理 | 核对项 | 说明 / 理由 |
|---|---|---|---|---|
| `theme.ts` | 新建 `src/theme.ts` + `App`/`main` 根 `ConfigProvider theme=` | **复制** | 5 视觉还原 | D1。迁移火山引擎 Token（主色 `#0ECDEB`、深色头部 `#0B1B2A`、状态色、背景 `#F7F8FA`），删除 `App.css` 手写 `#1677ff` |
| `App.css`（深色头部 / 背景 / text/bg 辅助色） | `src/App.css` | **复制**（并入） | 5 视觉还原 | 头部 `#0B1B2A`、内容背景 `#F7F8FA`、`text-*`/`bg-*-light` 辅助类 |
| `pages/NetworkDomainsPage.tsx` | `src/pages/admin/domains/DomainsPage.tsx` | **复制 + 裁剪** | 2 / 6 列完整性 | 列集合对齐 = 原型 ∩ MVP（见下方列对照）；裁剪原型折叠区/评审说明 |
| `components/FilterBar.tsx` / `tablePresets.ts` / `EllipsisText.tsx` | `src/components/`（已落地 3 件） | **复制** | 3 / 8 | 复用以满足横滚固定列 / 长文本规范；`DomainsPage` 筛选区已由 `<Space wrap>` 收敛为 `FilterBar/FilterItem`，`scroll` 用 `TABLE_SCROLL_X`，分页用 `TABLE_PAGINATION`（D6） |
| `components/ReviewNote.tsx` / `ReviewNoteSwitch.tsx` / `contexts/ReviewNotesContext.tsx` | — | **删除** | 实现基底裁剪 | 原型评审脚手架，不进入生产 |
| `layouts/MainLayout.tsx`（顶栏角色切换 / 评审开关） | `src/layouts/MainLayout.tsx`（含 banner 模块入口） | **复制 + 裁剪** | 3 / D3 / D5 | MVP 单租户不保留角色切换；banner 顶部一级 tab 为「首页 + 系统与平台管理（PRD 模块名）」，「网域管理」下沉 Sider 二级（临时，待 M05） |
| `mocks/module-06.ts` | `src/api/domain.ts` + `src/types/domain.ts` | **替换** | 4 冲突报告 | 删 mock，接真实 API，类型以 PRD + API 标准为准 |
| `App.tsx`（路由） | `src/App.tsx` | 覆盖/扩展 | 1 UI 展示名 | 挂 `/admin/domains`，配全局主题，去评审态 |

## 三、表格列对照（D4）

| # | 原型列 | 生产现状 | 处理 | 理由 |
|---|--------|----------|------|------|
| 1 | 网域 ID | ✅ 已有 | — | — |
| 2 | 网域名称 | ✅ 已有 | — | — |
| 3 | 登记归属 | ✅ 已有 | — | — |
| 4 | 授权租户 | ✅ 已有 | — | — |
| 5 | 类型（domain_type） | ✅ 已有 | — | — |
| 6 | 网络区域类型（zone_type） | ✅ 已有 | — | — |
| 7 | **监控纳管**（registration_status） | ❌ 缺失 | **补**（先核对 MVP） | 后端 DTO 已返回；涉 M09 语义，开工前核对 PRD §11 是否 MVP |
| 8 | 状态（status） | ✅ 已有 | 对齐色值 | 启用 `#00B578`、禁用 `#86909C` 需与原型一致（D1 边界在表内） |
| 9 | **创建时间**（created_at） | ❌ 缺失 | **补** | 后端 DTO 已返回 |
| 10 | 操作（配置纳管 M09/编辑/禁用/删除） | ✅ 已有 | 对齐 | 文案/图标与原型一致 |

> 删列原则（Step 3.5 项 6）：任何删减必须在本表「理由」列标注「非 MVP / 依赖 MXX」，未标注视为偏离。

## 四、待办（改动代码前逐项勾验）

- [x] D1：`src/theme.ts` 落地并全局注入，确认无 `#1677ff`（header 改 `#0B1B2A`，body `#F7F8FA`）
- [x] D4：「监控纳管」「创建时间」两列，先逐列核对 PRD MVP 后补渲染（后端 DTO 已返回 `is_monitored` / `created_at`；状态色对齐原型）
- [x] D3：banner 模块入口（临时版，`MainLayout` 头部按钮，标注 M05 收口）
- [x] D5：顶部一级 tab 文案改用 PRD 模块名「系统与平台管理」，「网域管理」下沉 Sider 二级（`MainLayout.tsx` MODULES）
- [x] D6：复制 `FilterBar`/`FilterItem`/`tablePresets`/`EllipsisText` 到 `src/components/`，收敛 `DomainsPage` 筛选区 / scroll / 分页
- [ ] 工作流注册：本表已在本模块执行记录内，其余模块复制本表为模板