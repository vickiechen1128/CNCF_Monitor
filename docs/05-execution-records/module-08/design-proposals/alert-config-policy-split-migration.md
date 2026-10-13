# 设计提案：告警配置页 IA 收敛 + 路由设置迁移（M08）

> 类型：feat 分支设计提案（落 `feat/module-08-alert-dispatch`）
> 作者：Orchestrator / chenrt
> 日期：2026-10-13
> 状态：**draft（用户已拍板方案，待 PRD 版本 +1 合并）**
> 关联：`alert-config-three-layer-model.md`（§6.3 两个开关独立性 / §7.1 方案 B 否决理由 / §7.6 不改清单 C1–C4）、`alert-route-frontend-editor.md` §4.4（根路由锁定规则）/ §4.8（逃生门承诺）、决策 113（口径 C 最小运行骨架自动布缆）、决策 74（receiver 命名空间）、决策 42-1（抑制空变更单）、决策 39（版本历史移出高级区）
> 决策归属：M08 设计侧（PRD 回写需由 prototype-designer 或用户在 `design/module-mvp-demo` 分支完成）

---

## 0. 约束声明

本提案**不修改** `docs/02-product-requirements/` 下任何 PRD 文件（frontend-developer 无权、且需走版本化迭代）。所有结论落 design-proposals，作为 PRD 版本 +1 的输入。

§6「与现有 PRD 差异点」已逐条列出需回写位置，合并动作由 prototype-designer 或 chenrt 在 design 分支执行。

---

## 1. 需求背景

2026-10-13 用户提出 IA 调整思路：

> 告警配置里面的「路由与收敛策略」，是否可以迁移到「路由规则」、「通知渠道」？用户在编辑「通知渠道」、「路由规则」的时候，就知道了平台是有兜底的渠道和根路由。「告警配置」页面主要做的就是告警查看，并且引导希望直接挂载「告警配置文件」的高级用户直接操作。

拆为三点诉求：

1. 把「路由与收敛策略」卡（实际含**两个独立控件**）拆散迁移到「路由规则」页与「通知渠道」页；
2. 迁移后用户在编辑渠道 / 路由时能自然感知「平台有一个兜底渠道」和「有一个根路由」；
3. 「告警配置」页收敛为「当前生效 + 版本历史」查看 + 引导高级用户直接挂载整份 `alertmanager.yml`。

### 1.1 为什么「整块搬运」不可行

「路由与收敛策略」卡内两个控件在数据层**平级**，不存在从属关系：

- 兜底渠道 = `default_receiver_channel_id`
- 维护模式 = `mode`

后端生成配置的工序顺序（`platform/configcenter/draft/service.go` `buildArtifacts` L282–L296）：

```
materializeNotifyReceivers → materializeRootRouteReceiver → seedManagedRoutePreset → Checksum
```

`materializeRootRouteReceiver`（L338–L352）**不判 mode**：只要 `DefaultReceiverChannelID != nil` 且目标渠道可用，平台每次生成配置都会替换根 `route.receiver` 单键 —— 手写模式下同样如此。`generator/notify_route_skeleton.go` 的四条红线（不触碰根 route 的 group_by / group_wait / group_interval / repeat_interval / continue；不写 `route.routes[]`；不为根 route 增删 matchers；不新增/删除根 route 其它键）同样不判 mode。

**结论**：兜底不是「模式的下游项」，两个控件必须分别落到不同语义位，**不可合并为同一张卡、不可放进同一组控件**。

---

## 2. 设计范围

### 2.1 落点映射

| 控件 / 事实 | 迁入位置 | 形态 |
|---|---|---|
| 兜底渠道选择（`default_receiver_channel_id`） | 路由规则页 · 常驻区 | Select，首项恒为「不接管」 |
| 路由维护模式（`mode`） | 路由规则页 · 常驻区 | 与兜底同一常驻区但**分栏分述**，各自独立 Select / Segmented |
| 根路由存在性与锁定事实 | 路由规则页（已在） | 保持 `ROUTE_ROOT_LOCK_TIP` / `ROUTE_ROOT_PARENT_LABEL='顶层路由（兜底）'` |
| 「哪个渠道是兜底渠道」 | 通知渠道页 · **新增列** | Tag「兜底」；无兜底时不渲染该 Tag |
| 当前生效配置 + 版本历史 | 告警配置页（保留） | 不变 |
| 导入整份配置文件 | 告警配置页 · **提为常驻卡** | 从高级 Collapse 提为独立卡 |

### 2.2 页面收敛后结构

**`/routes` 路由规则页**（自上而下）：

1. PageIntro（副标改为「维护告警路由：谁产出路由规则、没匹配到规则的告警发给谁」）
2. **路由设置常驻卡**（新，从告警配置页迁入）
   - 控件 A：路由规则由谁维护（Segmented，保留二次确认 Modal）
   - 控件 B：没匹配到具体规则的告警，发给哪个渠道（Select）
   - 两者之间的「开关关系结论」提示（原 `policy-mode-tip` + `policy-summary`）
3. 模式徽标 + 只读/可写常驻 Alert（**删除「前往告警配置」反向链接**，改为就地切换指引）
4. 路由树表格（顶层路由行内展示兜底结论 Tag）
5. 路由编辑抽屉（顶层路由的 `receiver` 字段改为只读，见 §3.1）
6. 高级：导入整份配置文件（Escape 门，仍在路由规则页或告警配置页，见 §6 差异点 D4）

**`/notify-channels` 通知渠道页**：新增「兜底渠道」标识列。

**`/alert-config` 告警配置页**（收敛后）：

1. PageIntro（副标改为「查看当前生效的告警配置与历史版本」）
2. 卡 ① 当前生效（只读 YAML，保留默认折叠）
3. 卡 ② 版本历史（保留；「重新挂载」已按决策 39 删除，不恢复）
4. 卡 ③ 引导：希望直接编辑整份 `alertmanager.yml`？→ 导入整份配置文件（从高级 Collapse 提为常驻卡）
5. **删除**：策略卡（`alert-policy-card`）、动线卡（`alert-guide-card`，4 个 GuideLink）

### 2.3 不改清单（沿用 `alert-config-three-layer-model.md` §7.6）

- **C1**：`POST /config` admin-only 语义不变
- **C2**：`notify-N` receiver 命名空间不变
- **C3**：手写 / 平台两块的**豁免**规则不变
- **C4**：派生预览口径文案不变

**本次后端改动量：零。** 所有改动落在 `ui-custom/web/`。

---

## 3. 关键设计决策

### 3.1 决策一：平台生成模式下，顶层路由的 `receiver` 抽屉只读（用户已拍板，取「方案 A」）

**问题**：`RouteEditorDrawer.tsx` 的 `isRoot` 仅禁用 `parent_id`（L353）与排序，`receiver` 字段（L418–L437）对根路由**仍可写**。而保存链路为 `generateRouteSection(tree)` → `GET /config/current` → `mergeRouteSection` → `POST /config`，用户改的 receiver 会进草稿，随后被 `materializeRootRouteReceiver` 用兜底控件的值覆盖 —— **用户改动静默丢失，无任何提示**。

现状下该坑不明显（兜底控件在另一页面）；迁移后两者同屏，撞车概率显著上升。

**决策**：平台生成模式下，顶层路由的「接收人」Select **只读**，兜底控件是唯一可改入口。理由：与后端实际行为一一对应，无需在前端造「两入口必须同步」的约束。

补充：手写模式下路由页本就只读（`isRouteEditable('handwritten') === false`），抽屉不出现，不存在冲突。

### 3.2 决策二：切到「我来编辑」时，兜底**自动置为「不接管」**（用户已拍板）

**问题**：`materializeRootRouteReceiver` 不判 mode（决策 113 口径 C），手写模式下平台仍会替换根 `route.receiver`。用户误以为「切到手写 = 交出全部控制权」，实际不是。

**候选方案对比**：

| 方案 | 做法 | 结论 |
|---|---|---|
| A. 禁用兜底渠道 | 把渠道置 `enabled=false` | **否决** —— 见下方风险 |
| B. 兜底置「不接管」 | 复用已有 `NONE_RECEIVER_VALUE` | **采纳** |
| C. 兜底跟随 mode | 改后端让 `materializeRootRouteReceiver` 判 mode | **否决** —— 违反决策 113 口径 C，波及 `RevalidateDraft` 重校路径，风险高一个量级 |

**方案 A 的具体危害**（这是本次评估否决它的核心理由）：

1. 渠道停用 ⇒ `MaterializeNotifyReceivers`（`notify_receivers.go` L76–L78，`len(in.Channels) == 0` 或渠道不在 `LoadEnabledNotifyChannels` 结果中）不再为该渠道生成 receiver；
2. 但**根路由里上一轮平台写入的 `receiver: notify-1` 仍在文件里** —— `materializeRootRouteReceiver` 的「护栏③：关闭 = 停止替换，不删最后写入的值」保证它不会被清理；
3. 结果：根路由指向一个**已不存在的 receiver** ⇒ 悬空引用 ⇒ `amtool check-config` 失败 / Alertmanager 拒绝加载 ⇒ **整份配置挂载失败、告警整体失效** —— 正是用户想防的那件事；
4. 附带损伤：渠道列表出现「被莫名停用」的渠道；切回平台生成模式时兜底控件无法选中已停用渠道（`setting_handler.go` 拒绝），用户须额外记得重新启用，状态机复杂度上升。

**方案 B 的正确性**：`DefaultReceiverChannelID == nil` 时 `materializeRootRouteReceiver` 直接 return（`service.go` L350–L352），产物**字节级不变**。不删任何 receiver 定义 ⇒ 根路由中已有的 `notify-N` 仍可达 ⇒ 无悬空引用。渠道与模板原样保留，随时可切回。

**决策**：切到「我来编辑」时，**自动把兜底设定改为「不接管」**。不新增开关，只给已有的「不接管」状态补一个自动入口。后端零改动。

### 3.3 决策三：切换的伴随声明必须合并进同一次 PUT

**问题**：自动改兜底会写库（`default_receiver_channel_id = NULL`）。若与模式切换、文件导入分成多次请求，会产生用户未主动发起的独立变更单，违反决策 42-1（抑制空变更单）与「每条变更项须自解释」。

**决策**：自动改兜底**不单独发请求**，作为模式切换的伴随声明合并进**同一次 `PUT /api/v2/platform/alertmanager/route-setting`**。变更项文案须明示用户交出了什么，例如：

> 「路由模式切为『我来编辑』，平台不再接管根路由兜底接收人（原有：运维告警飞书群）」

### 3.4 决策四：切回「平台生成」**不自动接管**（用户已拍板）

**决策**：反向切换时兜底**保持「不接管」**，由用户显式选择。理由：兜底是高危变更（`setting_handler.go` 注释记录 2026-10-09 用户裁决立场 1：改兜底接收人属高危变更须人工复核，`PUT` 为 `RequireAdmin`），平台不得擅自接管。

### 3.5 决策五：「手写整份文件 ≠ 交出兜底」必须明写

即使兜底为「不接管」，渠道与模板仍在，通知渠道页的「平台接收人」列仍应展示 `notify-N`（可复制到 yml 中手写引用）。

兜底控件旁**必须常驻**一句：

> 「即使你选择自己手写整份配置，只要这里选定了渠道，平台仍会用它替换顶层路由的接收人。想完全自己控制，请选『不接管』。」

该句原在告警配置页 PageIntro 第 5 条，迁移时须一并落位。

### 3.6 决策六：根路由必填 vs 平台接管的语义区分

迁移后同屏出现两套机制，须在文案上区分：

| 机制 | 层级 | 文案口径 |
|---|---|---|
| `rootReceiverRequired`（`route/validate.go` L131–L139） | YAML 格式校验 | 「根路由必须指定兜底接收人（Alertmanager 要求）」 |
| `default_receiver_channel_id` | 平台接管开关 | 「这个接收人由谁来定（平台接管 / 你手写）」 |

---

## 4. 交互细节

### 4.1 模式切换确认 Modal 文案

- 切到「我来编辑」：确认框须说明「平台将不再接管根路由兜底接收人（当前：{渠道名} → 不接管）。你的整份配置会被原样保留。」
- 切到「平台生成」：确认框维持现有文案，**不提及自动接管**。

### 4.2 通知渠道页「兜底渠道」列

- 列位置：紧邻现有「平台接收人」列（`CHANNEL_DERIVED_RECEIVER_COLUMN_TITLE`）之前，便于对照。
- 内容：`effective_source === 'explicit'` 时渲染 Tag「兜底」；`auto_first_enabled` 渲染 Tag「建议兜底」（次级色）；`none` 不渲染。
- 数据来源：`useRouteSetting` 的 `setting.effective_receiver_name` 与渠道派生名比对，或直接用 `setting.default_receiver_channel_id === channel.id` 判定（**推荐后者**，避免名称反查歧义）。

### 4.3 文案方向防呆

`alertmanagerConstants.ts` 注释记录：commit 86331a0 曾把 `ALERT_POLICY_MODE_HANDWRITTEN` / `ALERT_POLICY_MODE_MANAGED` 文案整体写反（门禁 `isRouteEditable` 未动），后按门禁 + PRD §11.7 修正。**迁移改写文案时必须逐条对齐 `useRoutes.ts` 的 `isRouteEditable` 语义，禁止凭语感书写。**

---

## 5. 验收标准

| # | 验收项 | 判据 |
|---|---|---|
| A1 | 告警配置页不再有策略卡 | `/alert-config` 无 `alert-policy-card`；页面仅剩「当前生效」「版本历史」「导入整份配置文件」三卡 |
| A2 | 告警配置页不再有动线卡 | 无 `alert-guide-card` |
| A3 | 兜底控件在路由规则页可用 | `/routes` 可改兜底渠道，改动经变更单确认后生效（不即时生效提示保留） |
| A4 | 模式控件在路由规则页可用 | `/routes` 可就地切换模式，二次确认 Modal 保留 |
| A5 | 反向链接消除 | `/routes` 手写模式 Alert 中不再出现「前往告警配置」 |
| A6 | 顶层路由 receiver 只读 | 平台生成模式下打开顶层路由编辑抽屉，「接收人」Select disabled，并有说明文案 |
| A7 | 切手写自动置不接管 | 平台生成（兜底=A）→ 切「我来编辑」→ 兜底显示「不接管」，且变更单含明示项 |
| A8 | 渠道不停用 | 执行 A7 后，渠道 A 的 `enabled` 仍为 true，`notify-A` 仍出现在 receivers 段 |
| A9 | 切回不自动接管 | 手写模式 → 切「平台生成」→ 兜底仍为「不接管」，需用户显式选择 |
| A10 | 渠道页兜底标识 | `/notify-channels` 兜底渠道行显示 Tag「兜底」；切换兜底后 Tag 跟随 |
| A11 | 逃生门不受损 | 任何模式下均可在告警配置页导入整份配置文件（决策 113 / §7.6 C3） |
| A12 | 无悬空引用 | 手写模式下平台仍物化已启用渠道的 receiver，根路由 `notify-N` 可达 |

---

## 6. 与现有 PRD 差异点（需 PRD 版本 +1 回写）

> 以下均为**已冻结 PRD 的现有口径**与本提案的冲突项。回写由 prototype-designer 或 chenrt 在 `design/module-mvp-demo` 分支执行，PRD 版本 +1，Change Log 记「吸收 design-proposal alert-config-policy-split-migration」。

| # | 位置 | 现口径 | 本提案 |
|---|---|---|---|
| D1 | PRD §11.6（L727 附近） | 告警配置页「另含两项路由相关设置：模式开关与默认接收人」 | 两项迁出至路由规则页 |
| D2 | PRD §11.7（L741/L751/L753 附近） | 手写模式下路由页只读，「前往告警配置」切换 | 改为路由页就地切换 |
| D3 | 术语映射表（L652 附近） | 「默认接收人 …… 在『告警配置』页配置（v1.18）」 | 改为「在『路由规则』页配置」 |
| D4 | 验收 `{v0.3-b}`（L610 附近） | 「关闭开关后用户可在**告警配置页**整份手写 route」 | 导入入口仍在告警配置页（**此项实际不变**，仅需补充「切手写时兜底自动置不接管」的行为说明） |
| D5 | 顶层路由 receiver 编辑权 | 未显式规定 | 明确：平台生成模式下顶层路由 receiver 抽屉只读 |
| D6 | 兜底自动交还语义 | 未规定 | 新增：切手写模式自动置兜底「不接管」，切回不自动接管 |

---

## 7. 影响面

### 7.1 前端文件

| 文件 | 改动 |
|---|---|
| `src/pages/alerts/AlertConfigPage.tsx` | 删策略卡 + 动线卡；高级 Collapse 提为常驻卡；PageIntro 重写；移除 `useRouteSetting` 引用与相关 testId |
| `src/pages/alerts/RoutesPage.tsx` | 接入 `useRouteSetting` + 两个控件；删反向链接；顶层路由行内兜底 Tag；模式切换合并 PUT |
| `src/pages/alerts/RouteEditorDrawer.tsx` | 顶层路由 `receiver` Select 禁用 + 说明文案 |
| `src/pages/alerts/NotifyChannelsPage.tsx` | 新增「兜底渠道」列 |
| `src/pages/alerts/alertmanagerConstants.ts` | `ALERT_POLICY_*` 常量迁移 / 重写；新增渠道页兜底 Tag 文案 |
| `src/pages/alerts/useRouteSetting.ts` | 位置保留（共享）；`save` 需支持模式 + 兜底合并提交 |
| `src/pages/alerts/useRoutes.ts` | 如需，按 §3.1 为顶层路由提供只读 receiver 判定 |

### 7.2 测试

`AlertConfigPage.test.tsx`（约 25 处命中 `alert-policy-card` / `policy-summary` / `fallback-conclusion` / `policy-mode-tip`）、`alertSmoke.test.tsx`（约 7 处）、`useRouteSetting.test.ts`（约 12 处）需同步迁移；`RoutesPage.test.tsx` / `NotifyChannelsPage.test.tsx` 需新增覆盖。

**测试范围控制**：按 `frontend-developer.md` v1.37，**禁止跑全量 `pnpm test`**（8 GB 机型实测约 17 min），改用：

```bash
cd ui-custom/web
pnpm run typecheck:test
pnpm vitest run src/pages/alerts
pnpm lint
```

### 7.3 门禁

涉及 `ui-custom/web/src/` 变更 ⇒ 提交前必须 `make repo-map`，pre-commit hook 与 CI 双重校验 `make check-repo-map`。

### 7.4 后端

**零改动。**

---

## 8. 合并计划

1. 本提案状态 `draft` → 用户 / Orchestrator 评审 → `reviewing` → `approved`；
2. 由 prototype-designer 或 chenrt 在 `design/module-mvp-demo` 分支按 §6 逐条回写 PRD，版本 +1，Change Log 记「吸收 design-proposal alert-config-policy-split-migration」；
3. 前端按本提案在 `feat/module-08-alert-dispatch` 实现；
4. 合并后本提案状态改 `merged`，保留归档作为历史追溯。
