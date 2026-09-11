# M01 规则挂载：独立「检查」与提交按钮状态机（决策 69）

> **定位**：设计落版记录（决策依据 + 影响面 + 验收口径），供后续开发分支落地与 zhangwq 对齐。
> **状态**：设计已确认，本轮落档 + 落地代码。
> **日期**：2026-09-10
> **决策号**：决策 69（69-1 / 69-2 / 69-3；登记于 `docs/05-execution-records/module-09/design-decisions.md`）
> **关联**：决策 **66**（规则 job 引用双层校验模型）、决策 **67-2**（提交生效分级门 + 逃生门，本决策在其上做交互重排）、决策 67-3（「前往修改」按来源路由）、决策 45-1 / 45-2（校验失败三态出口与 M01 引导）、决策 43（变更单口径：提交 ≠ 直接生效）
> **落地分支**：`feat/module-08-alert-dispatch`（本轮在开发分支直接落地）

---

## 1. 触发：为什么要在已落地的逃生门上再做交互重排

决策 67-2 已把「error 级 job 引用默认阻断 + 显式覆盖逃生门」落地为**提交期**行为（`RuleMountDrawer.tsx:126` 拦截、`:140/:153` 上送 `ack_job_ref_errors`）。但现场试用暴露出这条路走得不顺：

1. 用户在抽屉里粘贴 rules.yml，点「提交生效」——**按钮文案承诺了「生效」，实际是进 M09 确认流程**（决策 43 口径），文案与事实不符；
2. 点下去才做校验：校验失败 → 报错；error 级 job 引用 → 报错 + 出现逃生门。**用户是在「已经点过一次提交」之后才被告知要先去检查**；
3. 校验结论与提交动作耦合在同一个 handler 里，导致「校验通过」不是一个用户可见、可复用的状态——**想单独验一遍规则内容，没有入口**；
4. 错误 Alert 位于抽屉 body 顶部（表单**上方**），而用户的目光焦点在刚编辑的文本框上，报错与内容割裂。

**结论：67-2 的判定逻辑是对的，缺的是「检查」这个显式动作与由此驱动的按钮状态机。**本决策只做交互重排，**不动 67-2 的后端判定逻辑**（`checkRuleJobRefGate` / `ErrorTypeJobRefUnresolved` / `ack_job_ref_errors` 全部保持原样）。

---

## 2. 证据核对（代码级）

### 2.1 现状：校验只发生在提交瞬间

| 环节 | 位置 | 实测行为 |
|---|---|---|
| 抽屉无独立检查按钮 | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:181-202` | footer 只有「取消」+「提交生效 / 保存变更」两个按钮 |
| 校验内嵌在提交里 | `RuleMountDrawer.tsx:100-129` | `handleSubmit` 内先 `monitoringRuleApi.validateYaml(...)`，再按结果决定 `return` 或继续提交；校验结果不落到独立状态 |
| 提交按钮恒可点 | `RuleMountDrawer.tsx:197` | `disabled={submitting}`——**不含任何校验态**，与 M08 的 `disabled={!validated \|\| hasErrors}` 相反 |
| 错误 Alert 在表单上方 | `RuleMountDrawer.tsx:204-212` | `{submitError && <Alert .../>}` 位于 `<Form>` **之前** |
| 逃生门只在阻断态出现 | `RuleMountDrawer.tsx:69,257-268` | `showJobRefEscapeHatch = jobRefBlocked`，而 `jobRefBlocked` 由提交/后端兜底结果驱动 |
| ack 失效机制已存在 | `RuleMountDrawer.tsx:278-283` | `onValuesChange` 内 `setAckJobRefErrors(false)`（防「确认 A 内容、提交 B 内容」）——本决策扩展其覆盖范围 |

### 2.2 关键事实：`validate-yaml` 不是「提交校验的全量」

这是决定 69-1 的直接依据：

| 侧 | 校验内容 | 位置 |
|---|---|---|
| `validate-yaml`（预检） | ① YAML 语法 + `groups` 非空数组；② job 引用语义（`job_ref`，含 `severity`） | `platform/strategy/rule/update.go:129-146` |
| 提交（create / update） | ① 同上；**② 组名全局唯一性** `validateGroupNamesAvailable`；③ job 引用门禁 `checkRuleJobRefGate` | `create.go:63-75`、`update.go:63-84` |

`validateGroupNamesAvailable`（`validate.go:72`）**只在 create/update 被调用**（`create.go:66` / `update.go:72`），预检路径完全没有它。

⇒ 若「检查」直接复用 `validate-yaml` 现状，会出现 **「检查全绿 → 提交被 400 组名冲突打回」** 的最坏组合：比现在更糟（现在至少用户是点提交才知道，不会有虚假的安全感）。

### 2.3 参照物 M08：为什么它可以是浅检，规则侧不能

`ui-custom/web/src/pages/alerts/AlertConfigDrawer.tsx:156-200` 是本次交互的对标实现：

- 检查按钮文案是「**本地大小检查**」（`:178`），且只做非空 + 100KB 上限（`:160-174`），**不解析语法**；
- 通过后渲染绿色 Alert，并**显式列出免责边界**：「仅完成本地非空与大小检查，提交后由服务端执行 amtool 等价校验」（`:193-200`）；
- 提交按钮 `disabled={!validated || hasErrors}`（`:185`），文案已经是「提交并进入变更确认」（`:187`）。

规则侧**学不了这个浅度**：规则要承载 job 引用（`up` / `absent(up)` 缺 job 会导致告警恒触发）这个真正的硬约束，且组名唯一性是提交侧已存在的硬门。因此规则侧的「检查」必须是**服务端口径的检查**，而不是本地一行的正则。

> 补充：前端本地兜底 `validateYamlClient`（`rulesYaml.ts:5-13`）只有一条 `/^\s*groups\s*:/m` 正则，**连 YAML 语法都不真解析**，且不返回 `job_ref`。它只能作为「后端不可用时的降级」，不能作为「检查」的实现。

### 2.4 ③ 的现场：pending 期页面内无入口

- M08 版本历史列表的「M09 变更单」列已展示 `source_change_no`（`ui-custom/web/src/pages/alerts/AlertConfigPage.tsx:148-154`，纯 `<Text code>`）；
- 挂载成功后的引导只有一个 message toast（`AlertConfigPage.tsx:70,99`）→ `navigate(CONFIG_PREVIEW_PATH)`，**toast 数秒后消失，pending 期间页面内再无任何入口**；
- M09 配置变更确认页的「查看发布记录」已经在用 query 深链（`ConfigPreviewPage.tsx:712` → `/deployments?change_no=...&network_domain=...`），`DeploymentsPage.tsx:54` 已把 `?change_no` 深链写进注释作为既有约定——**③ 沿用同一约定，不新增路由**。

---

## 3. 用户可见的现状动线 vs 目标动线

```text
现状（提交期校验）
  粘贴内容 → [提交生效] → （内部校验）
      ├─ 语法失败 → 顶部报错（内容与报错分离）
      ├─ error job 引用 → 报错 + 出现逃生门 → 勾选 → 再点一次提交
      └─ 组名冲突 → 不做预检 → 提交被 400 打回

目标（检查 → 提交两段）
  粘贴内容 → [检查] → 结果面板（内容下方、按钮上方）
      ├─ 未通过（语法 / 组名冲突）→ 红 Alert + 提交按钮不出现
      ├─ error job 引用 → 红面板 + 逃生门；勾选 → 提交按钮出现
      ├─ warning job 引用 → 黄面板；提交按钮直接出现
      └─ 通过 → 绿提示「检查通过」+ 提交按钮出现
  内容一改 → 检查结论与 ack 一并作废、提交按钮重新隐藏
```

---

## 4. 决策 69（2026-09-10，chenrt 拍板）

### 69-1 `validate-yaml` 并入组名全局唯一性（P0，前置条件）

**结论**：`POST /api/v2/platform/monitoring-rules/:id/validate-yaml` 在 YAML 语法通过后、job 引用校验之前，**追加组名全局唯一性校验**，与提交侧 `validateGroupNamesAvailable` 同实现、同输入集。

- **同口径（关键）**：仅当目标规则**生效**（`enabled=true AND draft_status='ready'`）时才校验，与 `update.go:71` 的提交侧条件完全一致；**停用规则不校验**（停用规则不下发，其内容不参与合并）。`RuleMountDrawer` 允许编辑停用规则（`RulesPage.tsx:130`），若预检无条件校验而提交侧跳过，会出现「检查红、提交能过」的**反向不一致**，用户将失去唯一出口。
- **`:id` 用途**：新建场景前端传 `0`（无自身可排除）；编辑场景传真实 ID，**排除自身**（`validateGroupNamesAvailable` 的 `excludeID` 参数已支持，`validate.go:72`）。新建按 `enabled=true` 处理（与 `create.go:59-62` 的默认启用对齐）。
- **响应语义变更（已获用户确认）**：组名冲突**折叠进 `valid=false` + `error`**（响应形状 `{valid, error?, job_ref?}` 不变）。即 `valid` 的语义由「仅反映 YAML 语法」（决策 67-2 第 5 条口径）扩展为「**预检是否可提交**」：
  - `valid=false` = **不可覆盖的硬失败**（YAML 语法 / `groups` 结构 / 组名冲突）；
  - `job_ref.severity=error` = **可经逃生门覆盖的阻断**（不改写 `valid`，形状向后兼容）。
  - 该划分把门禁收敛成**两根轴**：硬失败一根（`valid`）、可覆盖一根（`job_ref` + `ack`），前端状态机因此可以直接由这两个信号驱动。
- **不做**：不把 job 引用的 error 折叠进 `valid`（保持决策 66/67-2 的 `job_ref` 分级语义与逃生门）。

### 69-2 提交按钮改为「检查通过后出现」的状态机（P0，交互重排）

**结论**：抽屉改为**两段式**——「检查」按钮常驻，提交按钮按状态**出现**（非 disabled）。

```text
canSubmit = 检查通过(valid=true) 且（无 error 级 job 引用 或 已勾选逃生门）
```

- **不采纳 67-2 讨论期的 A/B 二选一**（「勾选即解锁」vs「勾选后仍需点击」）：本方案里勾选框**不提交任何东西**，只参与「提交按钮是否出现」的计算，且物理上仍是两次点击（检查 → 提交）。因此 A 的「勾选动作语义变重、可能误触发」风险不适用，B 的「知情与下令分离」完整保留。
- **适用范围**：新建与编辑**同一套状态机**；提交按钮文案统一为「**提交并进入变更确认**」（原新建「提交生效」、编辑「保存变更」），与决策 43 口径、M08（`AlertConfigDrawer.tsx:187`）一致。
- **重置规则（扩展 `RuleMountDrawer.tsx:278-283` 的既有 ack 重置）**：**规则内容变更**时，`检查结论 + ack` 一并作废、提交按钮重新隐藏、须重新检查。非内容字段（规则名 / 资源类别 / 监控对象类型）不影响检查结论，不触发重置——避免「填完名字还要重检」的无效劳动。
- **逃生门提前**：error 级 job 引用在**检查阶段**即展示（不再等提交被拦），勾选后提交按钮出现。
- **后端兜底路径保留**：`validate-yaml` 不可用时回落本地 `validateYamlClient`（无 `job_ref`），此时检查通过、提交按钮出现；提交若被后端以 `errorType=job_ref_unresolved` 拒绝，仍在面板中给出逃生门并隐藏提交按钮，勾选后按钮重新出现、重试携带 `ack_job_ref_errors=true`。

### 69-3 错误与结果面板位置（P1，布局调整）

- 检查结果面板从表单**上方**移到表单**下方、操作按钮上方**（`Drawer` body 末尾），与用户刚编辑的内容保持视线连续；
- 三类面板互斥呈现：**检查未通过（红）** / **检查通过（绿，含「服务端复核」边界说明）** / **job 引用提示（红=阻断、黄=仅提示）**；
- 「检查通过」的绿提示必须写清边界：**服务端校验覆盖语法 + 组名唯一性 + job 引用；提交时服务端仍会复核**——本地兜底（无 `job_ref`）时这条说明即是 67-2「提交可能仍被拦」的知情来源。
- **「从本地选择 rules.yml」入口上移到编辑框上方**（与字段 label 同区，2026-09-10 补充）：16 行文本域会把原先位于其**下方**的文件选择按钮顶到抽屉折叠线以下，用户须先滚动才能发现该入口；上移后「字段说明 → 选文件 → 编辑框」成一条垂直读序。表单结构为外层 `Form.Item`（仅 label 布局）包 `noStyle` 内层字段，字段绑定与校验语义不变。

### 明确不做

- ❌ **不改后端判定逻辑**：`checkRuleJobRefGate`、`ErrorTypeJobRefUnresolved`、`ack_job_ref_errors` 的语义与触发条件一律不变；本轮前端只是「提前调用同一个 `validate-yaml` 并据此排布按钮」。
- ❌ 不引入「保存草稿」（v0.3 能力），不改变 67-2「v0.3 草稿保存不受门禁」的约定。
- ❌ 不做字段化规则编辑 / PromQL 语义校验（v0.3 / M02）。

---

## 5. 落地设计（文件级）

### 5.1 后端

| 文件 | 改动 |
|---|---|
| `platform/strategy/rule/validate.go` | 新增 `validateGroupNamesForCheck(db, rawID, content)`：容错解析 `:id`（空/非数字/0 → 不排除自身），`id>0` 时读取目标规则的 `enabled` / `draft_status` 镜像提交侧条件，命中则回落 `validateGroupNamesAvailable(db, content, excludeID)` |
| `platform/strategy/rule/update.go` | `ValidateRuleYAML`（`:129`）在 `validateRuleYAML` 通过后插入组名校验；冲突 → `valid=false + error`（`job_ref: []`）；注释同步 69-1 的语义变更 |
| `platform/strategy/rule/monitoring_rule_test.go` | 新增 `TestValidateYamlGroupNameConflict`：① 与他人生效规则组名冲突 → `valid=false` + error；② 与自己（`:id` 命中）同名 → `valid=true`（自排除）；③ 停用规则（`:id` 命中禁用态）同名 → `valid=true`（镜像提交侧） |

### 5.2 前端

| 文件 | 改动 |
|---|---|
| `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx` | 新增 `checkState` / `checkOutcome` 状态与 `handleCheck`；footer 改为「取消 + 检查 + 条件出现的提交」；结果面板移至表单下方；`onValuesChange` 按 `rule_content` 变更触发重置；`Upload.beforeUpload` 走同一重置；提交按钮文案统一 |
| `ui-custom/web/src/pages/strategy/RuleMountDrawer.test.tsx` | 现有 12 条用例改为「先检查、后提交」；新增：初始无提交按钮、检查未通过无提交按钮、组名冲突（`valid=false`）呈现、内容变更后检查结论作废 |

### 5.3 文档

| 文件 | 改动 |
|---|---|
| `docs/05-execution-records/module-01/api-contract-snapshot.md` | §7 `validate-yaml` 响应语义（`valid` 由「语法」扩展为「预检可提交」）+ 组名唯一性注记 |
| `docs/05-execution-records/module-09/design-decisions.md` | 决策 69 登记 + 决策 67-2 指针 |
| `docs/05-execution-records/module-08/design-decisions.md` | 决策 60 补充块（③） |
| `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md` | **待办**：v3.41 增量（独立「检查」+ 提交按钮状态机 + 文案），须与原型同步一并落地，见 §7 未决① |

---

## 6. 验收与验证清单

**功能验证（端到端）**

1. 打开抽屉 → footer 只有「取消」+「检查」，**没有提交按钮**；
2. 粘贴非法 YAML → 点「检查」→ 表单下方红 Alert「规则检查未通过」，提交按钮**不出现**；
3. 粘贴与既有生效规则**组名冲突**的内容 → 点「检查」→ 红 Alert（提示被哪条规则占用），提交按钮**不出现**（**69-1 的核心验收点**）；
4. 编辑该规则自身、内容组名不变 → 点「检查」→ **通过**（自排除生效）；
5. 编辑一条**停用**规则、组名与生效规则重复 → 点「检查」→ **通过**（镜像提交侧，避免无出路）；
6. 粘贴引用不存在 job 的**存活类**规则 → 点「检查」→ 红面板 + 逃生门，提交按钮不出现；勾选逃生门 → 提交按钮出现 → 提交成功、携带 `ack_job_ref_errors=true`、抽屉保持打开留痕；
7. 粘贴仅含 **warning** 级 job 引用的内容 → 点「检查」→ 黄面板 + 提交按钮直接出现；
8. **内容变更后**：已通过的检查结论与 ack 一并失效，提交按钮消失，须重新检查；
9. `validate-yaml` 不可用（断网/接口异常）→ 回落本地校验，检查通过、提交按钮出现；提交被 `job_ref_unresolved` 拦下 → 面板出现逃生门 + 提交按钮隐藏 → 勾选后按钮重新出现 → 重试成功；
10. 提交按钮文案在新建与编辑两种模式均为「提交并进入变更确认」。

**回归/技术验证**

- `go test ./platform/strategy/...`：`TestValidateYAMLEndpoint` / `TestValidateYamlJobRef` / `TestValidateYamlJobRefAllExisting` 保持通过（验证组名校验未误伤既有路径）；
- 后端判定逻辑零改动：`checkRuleJobRefGate` / `ack_job_ref_errors` / `errorType=job_ref_unresolved` 的测试用例（`TestCreateMonitoringRuleJobRefGate` / `TestUpdateMonitoringRuleJobRefGate`）**不应有任何断言变化**；
- 前端 `pnpm test`（vitest）中 `RuleMountDrawer.test.tsx` 全绿；`pnpm lint` 无新增告警；
- `make check-repo-map`：新增 `validateGroupNamesForCheck` 符号须刷新符号地图。

---

## 7. 边界、风险与未决

- **边界：检查通过 ≠ 提交必过**。69-1 把预检补到「与提交侧同门」，剩余差异只有 TOCTOU（检查与提交之间他人改了规则导致组名被占用）——用户已明确接受该竞态可忽略。此结论**仅在 69-1 落地后成立**；若 69-1 被回退，69-2 的「通过」必须重新定义为「语法通过」并在文案中降级说明。
- **边界：本地兜底路径仍是弱门**。后端不可用时 `validateYamlClient` 只做 `groups:` 正则，检查通过不代表语法正确；这条路径的兜底仍是提交侧后端门禁（与现状一致，不做加强）。
- **风险：停用规则镜像带来越权放行**。69-1 镜像提交侧的 `enabled` 条件，意味着停用规则的内容即使在预检期组名冲突也不会报错——这是**刻意的**（提交侧同样不报，保持可保存）；若后续要求「启用时预检先行」，须同时收紧提交侧，不能只改预检。
- **风险：两段式增加一次点击**。以「提交前必经一次检查」换取「错误早暴露 + 按钮有信息量」，用户已确认接受。
- **未决①（PRD 与原型同步）**：`Module_01_Metric_Collection_Center.md` 头部仍挂「⚠️ v3.40 待原型同步：规则挂载『提交生效』需按决策 67-2 呈现 error 默认阻断 + 显式覆盖逃生门」。本决策把该待办**扩大为**「67-2 + 69 一并同步」：原型需呈现独立「检查」按钮 + 提交按钮条件出现 + 面板下移 + 文案改为「提交并进入变更确认」。按 PRD 冻结门禁，v3.41 增量与原型同步须在同一轮完成，**本轮只落档与改码，不动 PRD 正文**。
- **未决②（`valid` 语义变更的下游影响）**：`valid` 语义扩展后，任何「把 `valid` 当作纯语法信号」的消费方都会受影响。经枚举，当前唯一消费方是 `RuleMountDrawer`（`monitoringRuleApi.validateYaml`）；M09 发布期校验不消费该接口。若后续有新的消费方，须在契约中显式声明「`valid=false` 不可覆盖」。
- **未决③（「检查」是否落审计留痕）**：当前「检查」是只读操作、不留痕（与决策 67-2「逃生门留痕」不同层级）。若后续需要「谁在什么时候验过」，须新建轻量审计表——本轮明确不做。

---

## 附录 A：决策 67-2 与本决策的边界

| 项 | 决策 67-2（已落地） | 决策 69（本决策） |
|---|---|---|
| 判定逻辑 | error 级 job 引用默认阻断、逃生门可覆盖 | **不变** |
| 后端接口 | `ack_job_ref_errors`、`errorType=job_ref_unresolved` | **不变** |
| 检查时机 | 提交时（`handleSubmit` 内） | **提前到独立「检查」动作** |
| 提交按钮 | 恒可点，提交时拦截 | **检查通过后才出现** |
| 组名唯一性 | 仅提交侧校验 | **并入预检（69-1）** |
| 错误位置 | 表单上方 | **表单下方、按钮上方（69-3）** |
| 文件选择入口 | 编辑框**下方**（随 16 行文本域被顶出视野） | **编辑框上方（69-3）** |
| ack 失效 | 任意字段变更即重置 | **仅内容变更重置（并同时作废检查结论）** |

## 附录 B：证据索引

| 结论 | 证据位置 |
|---|---|
| 抽屉无独立检查按钮、提交按钮恒可点 | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:181-202` |
| 校验内嵌在提交 handler | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:100-129` |
| 错误 Alert 在表单上方 | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:204-212` |
| ack 重置机制已存在 | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:278-283` |
| `validate-yaml` 不含组名唯一性 | `platform/strategy/rule/update.go:129-146` |
| 组名唯一性仅在 create/update 调用 | `platform/strategy/rule/create.go:66`、`update.go:72` |
| 提交侧生效门禁条件 | `platform/strategy/rule/update.go:71` |
| 本地兜底仅一条正则 | `ui-custom/web/src/pages/strategy/rulesYaml.ts:5-13` |
| M08 参照：浅检 + 免责文案 + disabled 提交 | `ui-custom/web/src/pages/alerts/AlertConfigDrawer.tsx:156-200` |
| pending 期页面内无入口 | `ui-custom/web/src/pages/alerts/AlertConfigPage.tsx:70,99,148-154` |
| `?change_no` 深链为既有约定 | `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx:712`；`DeploymentsPage.tsx:54` |
