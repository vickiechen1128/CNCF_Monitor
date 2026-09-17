# 任务卡：M06 网域管理原型对齐（Track A）

> **轨道**：Track A（原型为第一参照）  
> **派生日期**：2026-09-17  
> **派生依据**：前端实现差异分析（按轨道读基线发现）  
> **dev-feedback**：#8（接入进度四步态裁剪为两步态）

---

## 1. 基线差异矩阵（S/A/B 分级）

| # | 级别 | 差异项 | 原型位置 | 当前实现现状 | 数据源可用性 | 处置 |
|---|------|--------|---------|-------------|-------------|------|
| S#4 | S | 登记弹窗「中心能否直接访问」自检引导 | 原型 `DomainForm.tsx` L120-145 | 无此引导，纯表单 | ✅ 纯前端，无后端依赖 | **必实现** |
| S#2 | S | 列表「接入进度」列（四步态） | 原型 `NetworkDomainsPage.tsx` L85-95 | 无此列 | ⚠️ MVP 裁剪为两步态（已登记/已纳管），数据源 = `IsMonitored` + `Status` | **必实现（两步态）** |
| A#1 | A | 列表「接入方式」列（Tag：中心直连域/采集节点域） | 原型 `NetworkDomainsPage.tsx` L75-85 | 用「类型/网络区域类型」列展示 management/edge | ✅ 纯前端，数据源已有 | **应实现** |
| A#5 | A | 登记弹窗判断口径文案（VPC对等/CEN 可直连；K8s overlay/隔离网段需建域） | 原型 `DomainForm.tsx` L130-140 | 仅有 extra「登记只支持边缘域」+ 成功提示「前往 M09」 | ✅ 纯前端文案 | **应实现** |
| A#6 | A | 列表页顶部「什么是网域？」FieldGuide（可折叠：两路决策 + 四步流程） | 原型 `NetworkDomainsPage.tsx` L45-65 | 无此引导面板 | ✅ 纯前端，无后端依赖 | **应实现** |
| A#3 | A | 操作列按接入进度联动（安装采集节点/去配置采集/查看采集任务） | 原型 `NetworkDomainsPage.tsx` L105-115 | 只有 编辑/删除/禁用，无进度联动按钮 | ⚠️ 随 S#2 裁剪收敛为「安装采集节点」+「去配置采集」 | **应实现（收敛后）** |

---

## 2. 输入文档清单

### 必读（按优先级）

1. **原型页面**（Track A 第一参照）：
   - `docs/prototypes/module-06/src/pages/NetworkDomainsPage.tsx`（列表页，L45-115：FieldGuide + 接入方式/接入进度列 + 操作联动）
   - `docs/prototypes/module-06/src/pages/DomainForm.tsx`（登记表单，L120-145：登记自检引导 + 判断口径文案）
   - `docs/prototypes/module-06/src/mocks/module-06.ts`（mock 数据结构）

2. **前端原型映射表**：
   - `docs/05-execution-records/module-06/frontend-prototype-map.md`（核对原型符合度的第一靶子）

3. **契约快照**：
   - `docs/05-execution-records/module-06/api-contract-snapshot.md`（核对接口字段与响应结构）

4. **PRD**（契约快照缺失或矛盾时补读）：
   - `docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` §11（前端交互契约）

5. **工程标准**：
   - `docs/03-engineering-standards/02_Frontend_Standard.md`（组件选型 + 文案规范）

### 参考（非必读）

- `docs/05-execution-records/module-06/task-sequence.yaml`（了解已完成的任务）
- `docs/05-execution-records/module-06/dev-feedback.md`（#8 接入进度裁剪决策）

---

## 3. 任务清单（按优先级）

### P0（S 级，必实现）

#### T1：登记弹窗「中心能否直接访问」自检引导（S#4）

**目标**：在网域登记表单中新增「中心能否直接访问」自检选择，帮助用户判断是否需要创建网域。

**实现要点**：
- 在 `DomainForm.tsx` 的「登记归属」字段前新增「中心能否直接访问」选择区
- 两态卡片：「可以直连（VPC 对等 / CEN 互联）」vs「不能直连（K8s overlay / 隔离网段）」
- 选择后展示判断口径文案（A#5 合并实现）：
  - 可以直连 → 「无需创建网域，中心可直接访问目标资源」
  - 不能直连 → 「需要创建网域，由配置中心-网域纳管完成凭据与节点安装」
- 副标题文案：「凭据与节点安装由配置中心-网域纳管完成」

**文件**：`ui-custom/web/src/pages/admin/domains/DomainFormDrawer.tsx`（或等效登记表单组件）

**验收**：
- [ ] 登记表单包含「中心能否直接访问」两态卡片选择
- [ ] 选择后展示对应判断口径文案
- [ ] 副标题包含「凭据与节点安装由配置中心-网域纳管完成」

---

#### T2：列表「接入进度」列（两步态裁剪）（S#2）

**目标**：在网域列表中新增「接入进度」列，展示两步态（已登记/已纳管）。

**数据源**：
- 已登记：`NetworkDomain.Status = 'enabled'`
- 已纳管：`NetworkDomain.IsMonitored = true` 或存在 `EdgeAgent.Status = 'online'`

**实现要点**：
- 新增列「接入进度」，使用 Steps 组件展示两步态
- Step 1：已登记（Status=enabled 时点亮）
- Step 2：已纳管（IsMonitored=true 或存在 online EdgeAgent 时点亮）
- 列位置：在「接入方式」列之后

**文件**：`ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`（或等效网域列表组件）

**验收**：
- [ ] 列表包含「接入进度」列
- [ ] 已登记网域展示 Step 1 点亮
- [ ] 已纳管网域展示 Step 1 + Step 2 点亮
- [ ] 数据源正确（IsMonitored / EdgeAgent.Status）

---

### P1（A 级，应实现）

#### T3：列表「接入方式」列（Tag）（A#1）

**目标**：在网域列表中新增「接入方式」列，使用 Tag 展示「中心直连域/采集节点域」。

**数据源**：
- 中心直连域：`NetworkDomain.DomainType = 'management'`
- 采集节点域：`NetworkDomain.DomainType = 'edge'`

**实现要点**：
- 新增列「接入方式」，使用 Tag 组件
- management → 「中心直连域」（蓝色 Tag）
- edge → 「采集节点域」（绿色 Tag）
- 列位置：在「名称」列之后

**文件**：`ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`

**验收**：
- [ ] 列表包含「接入方式」列
- [ ] management 域展示蓝色「中心直连域」Tag
- [ ] edge 域展示绿色「采集节点域」Tag

---

#### T4：操作列按接入进度联动（A#3，收敛后）

**目标**：根据接入进度展示不同的操作按钮。

**实现要点**：
- 已登记（未纳管）：展示「安装采集节点」按钮（跳转 M09 网域纳管页）
- 已纳管：展示「去配置采集」按钮（跳转 M01 采集 Job 页）
- 所有网域：保留「编辑」「删除」「禁用」按钮

**文件**：`ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`

**验收**：
- [ ] 已登记网域展示「安装采集节点」按钮
- [ ] 已纳管网域展示「去配置采集」按钮
- [ ] 所有网域保留「编辑」「删除」「禁用」按钮

---

#### T5：列表页顶部「什么是网域？」FieldGuide（A#6）

**目标**：在网域列表页顶部新增可折叠的 FieldGuide 面板，帮助用户理解网域概念与决策流程。

**实现要点**：
- 使用 Collapse 组件，默认折叠
- 标题：「什么是网域？」
- 内容：两路决策 + 两步流程（MVP 裁剪后）
  - 两路决策：「中心能否直接访问？」→ 可以直连（无需建域）vs 不能直连（需要建域）
  - 两步流程：「登记网域」→「纳管监控」
- 样式：浅灰背景，左侧图标，右侧文案

**文件**：`ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`

**验收**：
- [ ] 列表页顶部包含「什么是网域？」FieldGuide
- [ ] 默认折叠，可展开查看
- [ ] 内容包含两路决策 + 两步流程

---

#### T6：登记弹窗判断口径文案（A#5，已与 T1 合并）

**说明**：已在 T1 中合并实现，无需单独任务。

---

## 4. 验收清单

### 功能验收

- [ ] 登记表单包含「中心能否直接访问」自检引导（T1）
- [ ] 登记表单展示判断口径文案（T1）
- [ ] 列表包含「接入方式」列（T3）
- [ ] 列表包含「接入进度」列（两步态）（T2）
- [ ] 操作列按接入进度联动（T4）
- [ ] 列表页顶部包含「什么是网域？」FieldGuide（T5）

### 原型符合度验收（Track A）

- [ ] 对照 `frontend-prototype-map.md` 逐项核对，无 S 级偏离
- [ ] 表格列集合 = 原型列集合 ∩ MVP（对照原型 `NetworkDomainsPage.tsx` L75-95）
- [ ] 导航文案与 `nav_contract` 一致（无偏离）
- [ ] UI 展示名使用 PRD 字段表「UI 展示名」+ 原型用户语言（无 snake_case 字段名当文案）

### 契约一致性验收

- [ ] 前端类型 / 字段名 / 枚举值与 `api-contract-snapshot.md` 一致
- [ ] 响应结构与契约快照一致（无字段缺失/多余）

### 测试验收

- [ ] `pnpm test` 通过（新增/修改组件的单元测试）
- [ ] `pnpm lint` 通过（无新增 lint 错误）

---

## 5. 停止规则

发现以下情况时，**必须停止并报告 Orchestrator**：

1. **原型已改但前端未同步**：发现原型页面与当前实现存在 S 级偏离，且偏离未在基线差异矩阵中登记
2. **契约快照与代码冲突**：发现接口字段/响应结构与 `api-contract-snapshot.md` 不一致
3. **数据源不可用**：发现「接入进度」两步态的数据源（`IsMonitored` / `EdgeAgent.Status`）无法派生
4. **跨模块依赖缺失**：发现需要 M09/M02 数据源但 MVP 无数据源

---

## 6. 交付物

1. **代码变更**：
   - `ui-custom/web/src/pages/admin/domains/DomainFormDrawer.tsx`（T1）
   - `ui-custom/web/src/pages/admin/domains/DomainsPage.tsx`（T2/T3/T4/T5）

2. **测试变更**：
   - 新增/修改组件的单元测试

3. **执行记录**：
   - `docs/05-execution-records/module-06/frontend-developer.md`（记录实现过程与问题）

---

## 7. 参考链接

- 原型页面：`docs/prototypes/module-06/src/pages/NetworkDomainsPage.tsx` / `DomainForm.tsx`
- 前端原型映射表：`docs/05-execution-records/module-06/frontend-prototype-map.md`
- 契约快照：`docs/05-execution-records/module-06/api-contract-snapshot.md`
- dev-feedback #8：`docs/05-execution-records/module-06/dev-feedback.md`
- 工程标准：`docs/03-engineering-standards/02_Frontend_Standard.md`
