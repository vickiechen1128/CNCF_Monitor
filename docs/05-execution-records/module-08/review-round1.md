# Module 08 原型评审报告（Round 1：任务闭环走查 + PRD v1.7 技术核对）

> **评审对象**：`docs/prototypes/module-08/`（用户用外部模型完成的 v1.7 对齐优化版，未提交）
> **评审依据**：`docs/02-product-requirements/Modules/Module_08_Alertmanager_Notification_Management.md` v1.7（决策 49/55/56/59/60）
> **评审方式**：只读评审（源码逐页核读 + 跨模块跳转目标核查），未修改任何原型文件
> **评审日期**：2026-09-01

---

## 结论：**有条件通过**

原型已正确吸收决策 59（文件挂载为 MVP 形态、表单 UI 显式标注「演示」）与决策 60（提交 → M09 变更单 → change_status 回写）的核心动线，数据模型覆盖完整，用户可见文案无决策编号 / PRD / 版本号泄漏。但有 **4 项阻塞 ready 的必须修复项**（1 个真实动线断点、1 个 P0 验收缺口、2 项工程卫生），修复后可进入 ready。

---

## 第一段：任务闭环走查（动线断点列表）

目标动线：挂载 alertmanager.yml（校验失败行级报错 / 成功提交）→ M09 变更单确认 → 下发 reload → 告警状态页双视图 → 静默管理（创建/列表/删除）。

| # | 动线段 | 走查结果 |
|---|--------|----------|
| 1 | 挂载入口 → 校验 | ✅ `ConfigPage` 抽屉支持上传 / 粘贴，`handleValidate` 校验失败时红色 Alert 报错且阻止提交（`mountChecked` 门禁），符合「校验失败不提交」。**缺口**：mock 校验错误为「receiver "x" 未定义」式语义错误，**不含行号**，与 PRD §5.1/§9.1「行级错误」有差距（代码注释已声明「仅示意行级错误定位」，属可接受的原型简化，建议补一行示例行号文案）。 |
| 2 | 提交 → M09 变更单 | ⚠️ **断点（必须修复）**：提交后 toast「点击本条前往配置变更确认」与「前往配置变更确认（M09）」按钮均跳转 `../module-09/dist/index.html`（`ConfigPage.tsx:37-39`），**未带 `#/config-preview` hash**，实际落在 M09 默认路由「网域纳管」页（`module-09/src/App.tsx:17`），用户看不到任何 alertmanager 变更单，动线在此断裂。 |
| 3 | M09 侧确认 → 下发 reload | ⚠️ **跨模块口径冲突（记录，修复归 module-09）**：M09 原型「配置变更确认」页仍是 v1.32 旧口径——「alertmanager.yml 由 Module_08 直接管理并触发 reload，**不进入本模块变更确认流程**」（`module-09/src/pages/ConfigPreviewPage.tsx:1349`、README 多处），与决策 60 直接矛盾。M08 侧动线表达本身正确（pending → 跳 M09 → change_status 回写列），但跳转目标页在讲相反的话，评审/演示时会被一眼看穿。 |
| 4 | 下发后状态回写 | ✅ `change_status` 列（待确认 / 已确认待下发 / 已下发 / 已拒绝）+ 当前生效配置卡的「变更待确认 / 已下发生效」Tag，回写语义表达完整。 |
| 5 | 告警状态页 | ⚠️ 仅呈现 Alertmanager 通知状态单视图（4 态 + 网域筛选 + 接收人列，质量好）；PRD §3.2 建议的「Prometheus 触发告警 + AM 通知状态」**双视图缺失**，仅有一段文字指向 M02。firing/pending 视图 PRD 标 v0.3，缺视图本身可接受，但页面未出现任何「后续版本」标注（M02 代理、授权过滤提示也未呈现，见第二段决策 56）。 |
| 6 | 静默管理 | ✅ 创建 / 列表 / 删除三动作闭环，API 直调说明清晰。**可理解性缺口**：matchers 要求手写裸 JSON（`[{"name":...}]`），与 PRD §5.2「选择标签键/值（可从活跃告警联想）」的表单封装有差距；缺相对时间快捷选项（PRD 举例「1 小时后」）。 |
| 7 | 历史版本回滚 | ❌ **断点（必须修复）**：PRD §5.1-3 / §9.1 P0 要求「历史版本回滚 = 重新挂载该版本内容」，`ConfigPage` 版本列表仅有「查看」抽屉，**无「重新挂载此版本」入口**，回滚动线不存在。 |

---

## 第二段：技术核对覆盖表

### §6 数据模型

| PRD 条目 | 原型覆盖 | 差距 |
|----------|----------|------|
| 6.1 Receiver | ✅ `Notifier`（id/name/type/config/enabled/created_at/updated_at），5 渠道枚举齐全 | 无 |
| 6.2 Route | ✅ `Route` 全字段（parent_id/matchers/receiver_id/group_by/三组时间/continue/order/enabled），路由树缩进展示 | 无 |
| 6.3 Silence | ✅ 全字段含 status 三态 | 无 |
| 6.4 InhibitionRule | ✅ source/target/equal/is_builtin/enabled + 内置规则生成逻辑说明 | 无 |
| 6.5 Matcher | ⚠️ 有 name/value/isRegex | **缺 `is_equal`（取反）字段**（建议项，原型简化可接受） |
| 6.6 AlertmanagerConfigVersion | ✅ content/checksum/applied_at/applied_by/status/error_msg + 决策 60 扩展 change_status | ⚠️ mock `acv-001` 以「校验失败」落库留痕，与 §9.2「校验失败……不落库」存在口径张力（§6.6 留痕含校验结果 vs §9.2 不落库）——**PRD 内部需澄清，原型按 §6.6 实现不算错** |

### §9 验收标准

**9.1 用户验收**

| 条目 | 覆盖 | 说明 |
|------|------|------|
| 模块名称更新 | ✅ | Header「告警收敛与通知管理」 |
| 文件挂载 + 行级错误 + M09 变更单 + 只读视图 + 回滚 | ⚠️ | 除**回滚入口缺失**（必须修复）与行号缺失（建议）外均覆盖 |
| 端到端告警链路（触发→路由→Webhook 收到） | ➖ | 后端验收项，原型以 mock `an-001`（active + receiver）示意，可接受 |
| 接收人至少一种渠道 | ✅ | 文件挂载承载 + mock 4 渠道 |
| {v0.3} 表单化 UI | ✅ | 表单存在且全部标注「演示」徽章 + 顶部 Alert 声明「当前版本以文件挂载为准」——**符合决策 59「原型通用表单不作为 MVP 呈现依据」的要求** |
| 静默 CRUD | ✅ | 三动作 + 状态同步说明 |
| 网域离线自动 inhibit_rules | ✅ | 内置规则卡 + EdgeSiteOffline 源告警 + inhibitable 建议表 |
| 通知状态 4 态 | ✅ | active/silenced/inhibited/unprocessed 统计卡 + 列表 |
| {决策 60} 管理域 scope、不扇出、change_status 回写 | ✅ | 「管理域 scope」文案 + 回写列；**跨模块落点见第一段 #2/#3** |
| {v0.3} M02 firing/pending | ⚠️ | 未呈现、未标注（建议加占位或折叠区说明） |
| {v1.0} 模板/升级、{v0.4+} 边缘通道 | ➖ | 未呈现，README 缺失导致无「版本边界」声明（随 README 补齐） |

**9.2 技术验收**：amtool 等价校验、挂载契约（校验通过→留痕→进变更单）、静默 API 直调不进流水线、inhibit_rules 生成逻辑、4 态映射、M08 不碰 rules.yml（ConfigPage Alert 明确声明）——均在 UI 行为层覆盖；授权过滤与静默 matcher 校验两条（决策 56）未呈现（见下）。

### 决策覆盖

| 决策 | 覆盖情况 |
|------|----------|
| 49（锁定 Alertmanager） | ✅ 全原型 AM 语义，无 Grafana/夜莺痕迹 |
| 55（告警状态页归 M08） | ✅ AlertStatusPage 在 M08，M02 仅文字引用 |
| 56（授权集合过滤 + 静默 matcher 校验） | ❌ **未呈现**：告警状态页无「数据已按授权网域过滤」提示，静默创建无 matcher 授权校验说明。PRD 明确 MVP 单租户恒通过、机制骨架保留——**建议项**：在页面折叠说明 / README 标注即可 |
| 59（MVP=文件挂载，表单挪 v0.3） | ✅ 三个表单页（接收人/路由/抑制）均有「演示」徽章 + 用户可见 Alert 声明「当前版本以文件挂载 + 配置中心确认为准」，未作为 MVP 呈现依据 |
| 60（M09 流水线、管理域 scope、不扇出、回写） | ✅ M08 侧表达完整；⚠️ 跳转落点错误（断点 #2）+ M09 原型旧口径冲突（断点 #3） |

---

## 必须修复项（阻塞 ready）

1. **M09 跳转落点错误**：`ConfigPage.tsx` `MODULE_LINKS.module09` 改为 `../module-09/dist/index.html#/config-preview`（当前落在网域纳管页，变更确认动线断裂）。
2. **补历史版本回滚入口**：`ConfigPage` 版本「查看」抽屉或行内增加「重新挂载此版本」动作（= 将该版本内容填入挂载抽屉重新走校验 + 提交），对应 §9.1 P0 验收。
3. **`package.json` version 对齐**：`0.1.0` → `1.7.0`（其他模块均按 PRD 版本对齐，如 module-09 为 `1.51.0`）。
4. **补 `README.md`**：参照 module-09 README 结构，含验证的 PRD 版本（v1.7）、本地启动命令、**全局导航映射表**、**模块边界标注**（M01 规则创作 / M02 firing 代理 / M09 下发管道 / 本模块 AM 域）、已知限制（mock、决策 56 骨架、v0.3/v1.0 未呈现项）。

## 建议项（不阻塞）

- amtool 校验失败 mock 文案补行号示例（对齐「行级错误」表述）。
- AlertStatusPage 增加 firing/pending 双视图占位（标注后续版本）或折叠说明；补「通知状态已按授权网域过滤（授权=全部时不附加）」提示（决策 56 数据源红线）。
- SilencesPage：matchers 由裸 JSON 改为键/值行编辑（PRD §5.2 表单封装 + 活跃告警联想）；时间范围补「1 小时后 / 2 小时后」快捷选项；补 matcher 授权校验说明（MVP 恒通过，机制骨架）。
- `Matcher` 类型补 `is_equal` 字段（PRD 6.5）。
- **跨模块对齐（另派任务，非本原型改动）**：M09 原型 ConfigPreviewPage 及 README 仍是 v1.32「alertmanager.yml 不进 M09 变更确认」旧口径，需按决策 60 升级为「管理域 default scope、不扇出」并支持 alertmanager.yml 变更单演示。
- **PRD 侧澄清**：§9.2「校验失败不落库」与 §6.6「留痕含校验结果 + status=failed」口径矛盾，建议在 PRD 中统一（原型 mock `acv-001` 按后者实现）。
- `docs/prototypes/index.html` 门户条目仍为「Module 08：告警规则管理 / 告警规则、规则组…」（v1.3 前旧口径），建议更新为「告警收敛与通知管理」及新描述。

---

## 工程卫生检查

| 检查项 | 结果 |
|--------|------|
| package.json version 对齐 PRD v1.7 | ❌ 当前 `0.1.0`（必须修复 #3） |
| README.md（导航映射 + 模块边界） | ❌ 缺失（必须修复 #4；module-01/07/09 均有） |
| 用户可见文案泄漏「决策 N / PRD / vX.Y」 | ✅ 通过——所有决策/PRD/版本引用均在代码注释（`{v1.7}`、`[DEV]` 注释块）中；渲染文案经全量 grep 确认干净。跨模块引用使用「配置中心（M09）」「Module_02 查询中心」形式，与 module-09 原型既有约定（用户可见文案允许模块名、禁止决策号/PRD/版本标记）一致 |
| 提示分区规范 | ⚠️ 基本遵守（技术信息在注释），但无 module-09 式「原型与实现说明」折叠区——README 补齐后可接受 |
| dist 构建产物 | ⚠️ 存在 `dist/`，但源码本轮改动后未验证是否重新构建（跳转修复后需 `pnpm build` 同步） |
