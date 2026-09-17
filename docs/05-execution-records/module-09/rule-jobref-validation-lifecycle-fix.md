# M01 规则 job 引用校验：失败单解锁与「提交生效」分级门（决策 67）

> **定位**：设计落版记录（决策依据 + 影响面 + 验收口径），供后续开发分支落地与 zhangwq 对齐。
> **状态**：设计已确认，**本轮不改代码**（代码改动在开发分支按本记录的落地设计执行）。
> **日期**：2026-09-10
> **决策号**：决策 67（登记于 `docs/05-execution-records/module-09/design-decisions.md`）
> **关联**：决策 42-1（同域 pending 取代）、决策 42-2 / 45-1（校验失败三态出口）、决策 42-4（生成失败）、决策 43 系列（废弃回写）、决策 44-1（pending 期锁定）、决策 45-2（失败引导回 M01）、决策 45-3（失败归因）、决策 54（v0.2 多网域 Job）、决策 63（回滚语义边界）、**决策 66（双层校验模型，本决策修订其第 2 / 4 条）**
> **落地分支**：`feat/module-09-config-center`（M01 侧改动随 M01 分支；本记录列出双侧文件）

---

## 1. 触发：现场的动线死锁

MVP 试用中的一次真实操作，走到无出口：

1. 用户在 M01「规则编辑」挂载规则并点「提交生效」→ M01 行内提示 **job 引用问题**（校验未通过）；
2. 用户仍点击「提交生效」→ 规则落库（`draft_status=ready`、`change_status=pending`），立即触发 M09 变更检测；
3. M09 生成 `ConfigDraft`，发布期 job 引用门禁判 `error` → 草稿落 `validation_status=failed` / `validation_cause=user_config`；
4. 用户回 M01 想改规则 → 报「规则存在待确认变更单，禁止编辑」（409）；
5. 用户去 M09 点「返回修改」→ 因 `validation_status=failed` 不可确认，唯一出路是「废弃」；
6. 废弃 → 规则解锁 → 改 → 再存 → 若仍未修好，回到第 1 步。

**结论：用户被卡在「报错了还能提交」与「提交失败了却锁死」之间，只能靠「废弃」反复解锁。**

---

## 2. 证据核对（代码级）

### 2.1 死锁三步链（逐条坐实）

| 环节 | 位置 | 实测行为 |
|---|---|---|
| ① 报错不阻断保存 | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:101-140` | `handleSubmit` 只在 `check.valid === false`（**YAML 语法**）时 `return`；`job_ref` 问题仅 `setJobRefIssues` 提示，**照常调用创建/更新接口**。前端现行为已被测试固化：`RuleMountDrawer.test.tsx:158-159` 断言「存在 error 级 job 引用时仍提示**已保存**」 |
| ② 后端同口径放行 | `platform/strategy/rule/update.go:117-119` | `validate-yaml` 的注释与实现均声明「**error/warning 均不改写 `valid`**（M01 编辑期不阻断）」；`platform/strategy/rule/jobref/jobref.go:7` 同口径，且提示文案写死「job 引用不影响保存」 |
| ③ 保存即写锁 | `platform/strategy/rule/create.go:77` | 创建时直接写 `ChangeStatus: models.ChangeStatusPending`（**不等 M09 回写**） |
| ④ 锁拦截编辑 | `platform/strategy/rule/update.go:43`（编辑）/ `:97`（删除） | `change_status == pending` → 409「存在待确认变更单，禁止编辑/删除」 |
| ⑤ 失败单不可确认 | `platform/configcenter/draft/service.go:548` | `ConfirmDraft` 要求 `ValidationStatus == passed`，否则 `ErrValidationNotPassed` |
| ⑥ 失败单仍算 pending | `platform/configcenter/draft/service.go:149` / `:331` | 草稿 `Status` 恒为 `DraftStatusPending`，**与 `validation_status` 无关**；失败只影响 `validation_status`，不影响 `status` |
| ⑦ 唯一清锁路径 | `platform/configcenter/draft/service.go:611-673` | 仅 `DiscardDraft` 会把规则 `change_status` 从 `pending` 复位（`:669-670`），并要求草稿 `status == pending`（`:616`） |

> **闭环成立**：锁由「存在 `pending` 草稿」施加（③④），而解锁要「废弃」（⑦）——**失败的草稿既确认不了（⑤），又是它（⑥）触发了锁**，只能废弃。

### 2.2 单域背景下 L1「口径漂移」不成立（对上一轮结论的修正）

上一轮曾把「M01 与 M09 的 job 名单口径不一致」列为 P0-1。**单域背景下该结论不成立**，本轮修正：

| 侧 | 名单来源 | 查询条件 |
|---|---|---|
| M01 编辑期 | `platform/strategy/rule/validate.go:105-115` `activeScrapeJobNames` | `enabled = true AND draft_status = 'ready'`（**全库，无网域过滤**） |
| M09 发布期 | `platform/configcenter/generator/data_source.go:41-51` `LoadJobs` | `network_domain_id = ? AND enabled = true AND draft_status = 'ready'`（**按域**） |

- **单域下两者是同一集合**（库里只有一个 `is_monitored` 域），因此不存在「M01 过、M09 挂」；
- 渲染链路不丢 job：`generator/render.go:85-95` 对**每个** job 都 `append` 进 `scrape_configs`（与是否有 targets 无关，targets 仅决定 `targets/*.json` 内容）；
- **故现场「M01 校验没成功」是报对了**——用户引用的 job 确实不存在 / 未 `ready` / 被禁用。M01 的提示是正确的，问题在于**它拦不住**（§2.1 ①）以及**拦不住之后把用户锁死**（§2.1 ④⑦）。

> 修正后的定性：L1 在 MVP 单域下是**潜伏问题**，不是本次事故原因；事故原因是 L2（报错可提交）+ L3（failed 锁死）。

### 2.3 v0.2 多域才是 L1 的爆发点

规划 v0.2 时 L1 会立刻变成生产事故：

- 规则是**全局资源**——`MonitoringRule` 无网域列（M01 PRD §5.5「网域无关性说明」），`LoadRules` 不按域过滤（`data_source.go:53-66`，条件仅 `enabled AND draft_status=ready AND scope IN (central,both)`）；生成时规则会**原样进每个域**的 `rules.yml`；
- 而 M09 目前用**本域**的 job 名单校验（`generator/validate.go:164` 起，名单来自本域 `prometheus.yml` 的 `scrape_configs[].job_name`）；
- ⇒ 引用 A 域 job 的规则，在 B 域的配置包里**必然被判 `error` → failed**。多域第一天就会集中爆发。

**但留口子的成本很低**（数据模型已埋钩子）：`MonitoringRule.Scope` 字段已存在（MVP~v0.3 固定 `central`，`edge`/`both` 为 v0.4+）；`jobref.Validate(content, jobNames)` 的名单本就是参数化的，**不需要改签名**。

---

## 3. 根因定性

| 层 | 性质 | 结论 |
|---|---|---|
| L1 名单口径 | **潜伏问题**（v0.2 爆发） | 单域下 M01/M09 同集，非本次事故原因；v0.2 需按 scope 感知 |
| **L2 校验不阻断** | 产品决策（决策 66 第 2/4 条）+ 落地缺陷 | 「先挂规则、后建 Job」是合法时序，故不阻断**是刻意的**；但对 **error 级**（存活类规则缺 job，发布期必阻断）放行，等于让用户必然撞墙——需要分级 |
| **L3 失败态锁死源数据** | **Bug** | 不可确认的 `failed` 单却按 `pending` 锁死规则，且解锁（废弃）会连带撤销用户内容，形成死循环 |
| L4 「前往修改」跳错页 | Bug | `ConfigPreviewPage.tsx` 硬编码 `navigate('/scrape-jobs')`，规则来源应跳 `/rules` |

---

## 4. 决策 67（2026-09-10，chenrt 拍板）

### 67-1 failed 单不再锁死源数据（P0，核心修复）

**结论**：草稿落到 `validation_status=failed AND validation_cause=user_config` 时，**自动清除** M01 源数据的 `pending` 锁（规则的 `change_status`）；**草稿本身保留**（可重校、可废弃，审计链不断）。

- **机制复用**：清锁口径与 `DiscardDraft` 的规则分支一致（`service.go:669-670`），落地位置在草稿生成路径（`GenerateDraft`）与重校路径（`RevalidateDraft`，`service.go:803` 附近）——即「**只要本轮结论是 `failed + user_config`，就清锁**」。
- **清 ≠ 废弃**：草稿仍在待确认列表（failed 态、不可确认、可重校/可废弃）；规则解锁后用户可直接在 M01 修改。
- **`platform_fault` 不清锁**：promtool / amtool 不可用属环境问题（决策 45-3），不是用户能修的，且环境就绪后重校即可通过；此时保持 `pending` 避免用户误改源数据。
- **修改后动线自愈**：用户改规则 → 保存触发 `GenerateDraft` → 已有 pending 单被 `reconcileWithExistingPending`（`service.go:251-360`）取代（`superseded`）→ 新单重校 → 通过 → 确认。**死循环消失**。

**两条实现红线（必须处理，否则引入新缺陷）**：

1. **清锁写入不得推进 `source_data_version`**。规则清锁若走 GORM 默认 `Update`，会顺带刷新 `updated_at`，而 `updated_at` 正是 M09「源数据版本触发预筛」的输入（M09 PRD §3.3.3）——会形成「清锁 → 版本前进 → 重算 → 再 failed → 再清锁」的自激循环。落地须用 `UpdateColumn` / 显式保留原 `updated_at`（同类问题也建议一并核对 `deployment/callback.go:31-44` 的既有回写）。
2. **清锁范围需与草稿内容对齐**。MVP 单域下 `LoadRules` 取全部 central 规则，与「清全部 `pending+ready` 规则」等价，可沿用 `DiscardDraft` 的现成 where 条件；**v0.2 多域**下需收敛为「本次草稿实际引用的规则」（见 67-4 的附带项）。
3. **清锁目标态建议 `none`（无在途变更）**，而非沿用废弃分支的 `deployed`。理由：该规则的内容**从未成功下发**，写 `deployed` 会让 M01 列表显示「已下发生效」，与事实相悖；`none` 表达「当前无在途可确认变更」，与 M09 PRD §3.4「`change_status` 统一回写、不允许 `pending` 残留」的既有原则一致，也符合「失败/废弃审计历史由 M09 变更单承载」的约定。若为最小改动而复用 `deployed`，须在 UI 注明其仅表示「无在途变更」，**不推荐**。

### 67-2 「提交生效」分级门 + 逃生门（P0，修订决策 66 第 2 / 4 条）

**结论**：M01 编辑期校验从「error/warning **一律不阻断**」改为「**error 默认阻断 + 显式覆盖逃生门**，warning 维持只提示」。

| 级别 | 场景 | 新行为 |
|---|---|---|
| `error` | 存活类（expr 含 `up`，如 `up{job="x"}` / `absent(up{job=~"x"})`）引用不存在的 job | **默认阻断「提交生效」/「保存变更」**，展示逐条问题清单（规则名 / matcher / 引用 job / 说明） |
| — | **逃生门** | 勾选「已知晓：先挂规则，稍后补建 Job」后放行；问题降级为 `warning` 落库并留痕（审计可见「用户显式覆盖」） |
| `warning` | 其他规则引用不存在的 job | 维持只提示、不阻断 |

- **适用范围**：`RuleMountDrawer` 的新建「提交生效」与编辑「保存变更」（`RuleMountDrawer.tsx:162`）**都适用**；YAML 语法失败仍按现状硬阻断。
- **不影响 v0.3 草稿态**：若 v0.3 引入「保存草稿」，草稿保存**不受**本门禁约束（草稿本就允许半成品）。
- **前后端双层落地**：前端门禁（体验）+ 后端兜底（防绕过）。`validate-yaml` 的 `valid` 语义**不变**（仍仅反映 YAML 语法，`job_ref` 问题不改写它，保持响应形状向后兼容）；`POST /monitoring-rules` 与 `PUT /monitoring-rules/:id` 请求体新增**可选** `ack_job_ref_errors`（bool，默认 `false`）——存在 error 级 job 引用且未置 `true` → `bad_request`（`errorType=job_ref_unresolved`）；置 `true` 表示用户显式覆盖，落库留痕。契约已写入 `docs/05-execution-records/module-01/api-contract-snapshot.md` §7。
- **修订决策 66**：决策 66 第 2 条「M01 编辑期 … **不阻止保存**」与第 4 条「仅触发 warning」被本决策修订为「error 默认阻断 + 显式覆盖」；**「先挂规则、后建 Job」的合法时序仍受保护**——逃生门即为其保留的通道，只是从「默认放行」变为「显式确认」。M09 发布期门禁（error 阻断确认）不变。
- **文案同步**：`jobref.go:125-127` 的提示语「job 引用不影响保存」需随门禁改写；前端 Alert 需按 `severity` 分级呈现（现为恒 `type="warning"`，`RuleMountDrawer.tsx:179`）。

### 67-3 「前往修改」按来源路由（P0）

- `validation_details` 增加**来源标识**（建议 `source`：`rule` / `scrape_job` / `targets`），前端据此分流：规则 job 引用 → `/rules`；Job / targets → `/scrape-jobs`。
- 现状：`ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx:681` 硬编码 `navigate('/scrape-jobs')`，规则场景跳错模块，违反决策 66 第 5 条与决策 45-2。
- MVP 最小实现即可满足规则单一来源；`source` 字段为后续多来源扩展预留。

### 67-4 v0.2 口径口子（P1，纯设计，不提前实现多域逻辑）

**结论**：把「校验用 job 名单」抽成唯一的 **scope 感知函数**（如 `effectiveJobNames(db, scope, domainID)`），M01 与 M09 **都调它**：

| 版本 / scope | 名单口径 |
|---|---|
| MVP（`central`，单域） | 全库 `enabled AND draft_status=ready`（= 现状，与 M09 本域集合等价） |
| v0.2 `central` | **全域 job 并集**（规则是全局资源，中心统一求值） |
| v0.2 `edge` / `both` | 本域 job 名单 |

- 这把决策 66 第 3 条的「**单一实现**」补完为「**单一实现 + 同一输入集**」——本次事故的教训本质就是：只统一了函数，没统一输入。
- **v0.2 口径约定**（写入 PRD）：
  1. central 规则的 job 引用门禁按**全域 job 并集**校验；
  2. 逐域配置包对 central 规则**单独**做 job 引用门禁，**不得**按单域名单直接判 failed（否则多域第一天即误报）；
  3. `change_status` **标量锁保留**——规则是全局资源，全局锁语义自洽，**不建逐域锁表**；多域下「A 域 failed、B 域 pending」的陈旧草稿由既有 reconcile-on-save（决策 42-1）兜底。

### 明确不做（相对上一轮方案的减法）

单域背景下以下均为过度设计，本轮明确不做：

- ❌ 逐域 UI 分组展示 job 引用问题；
- ❌ 逐域 `change_status` 锁表；
- ❌ M01 逐域校验改造（P0-1 的口径对齐降级为 v0.2 的 P1 设计动作）。

---

## 5. 落地设计（文件级）

> 本记录不改代码；以下是后续开发分支的执行清单。

### 5.1 后端

| 文件 | 改动 |
|---|---|
| `platform/configcenter/draft/service.go` | 新增 `unlockSourceDataOnFailed(db, tx, draft)`：当 `validation=failed && cause=user_config` 时清规则 `pending` 锁（目标态 `none`，`UpdateColumn` 不推进 `updated_at`）；在 `GenerateDraft`（`:44-159`）、`reconcileWithExistingPending`（`:251-360`）、`RevalidateDraft`（`:773-808`）三处落 failed 后调用 |
| `platform/configcenter/deployment/callback.go` | 核对既有 `writebackRuleChangeStatus`（`:31-44`）是否需同步「不推进 `updated_at`」；保持与 `draft` 侧清锁口径一致 |
| `platform/strategy/rule/validate.go` | 抽 `effectiveJobNames(db, scope, domainID)`（MVP 恒 central 单域 = 现状），`ValidateRuleJobRefs` 改调它 |
| `platform/strategy/rule/update.go` / `create.go` | `validate-yaml` 响应保持 `job_ref`（含 `severity`，`valid` 语义不变）；`CreateRule` / `UpdateRule` 增加后端兜底门禁：解析校验存在 `error` 级问题且请求未带 `ack_job_ref_errors=true` → `bad_request`（`errorType=job_ref_unresolved`） |
| `platform/strategy/rule/jobref/jobref.go` | 提示文案改写（去掉「不影响保存」）；`Issue` 增加 `network_domain_id` / `network_domain_name`（**v0.2 预留，MVP 可空**） |
| `platform/configcenter/generator/validate.go` | 发布期门禁保持（error → `failed(user_config)` 阻断确认）；v0.2 时改用 `effectiveJobNames(central)` |

### 5.2 前端

| 文件 | 改动 |
|---|---|
| `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx` | `handleSubmit`（`:83`）增加门禁：`jobRefIssues.some(i => i.severity === 'error')` 且未勾选逃生门 → 不提交、展示问题清单；Alert（`:177-182`）按 severity 分级（error 红 / warning 黄）；新增逃生门 Checkbox（文案「已知晓：先挂规则，稍后补建 Job」），勾选后随创建/更新请求提交 `ack_job_ref_errors=true` |
| `ui-custom/web/src/pages/strategy/RuleMountDrawer.test.tsx` | 更新 `:129-160` 现行断言（error 存在时应**阻断保存**；勾选逃生门后才保存并提示） |
| `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx` | 「前往修改」按 `validation_details[].source` 分流 `/rules` 或 `/scrape-jobs`（`:681` 去硬编码） |
| `ui-custom/web/src/pages/strategy/RulesPage.tsx` | pending 锁提示文案保持；若清锁后需刷新状态，保存/废弃后强制拉取列表 |

### 5.3 文档

| 文件 | 改动 |
|---|---|
| `docs/02-product-requirements/Modules/Module_01_*.md` | §3.1 / §3.2 / §5.5 / §11.2 + Change Log（v3.40） |
| `docs/02-product-requirements/Modules/Module_09_*.md` | §3.4 / §3.5.1 / §5.4 / §8 / §11.2 + Change Log（v1.63） |
| `docs/05-execution-records/module-09/design-decisions.md` | 决策 67 登记 + 决策 66 修订指针 |
| `docs/05-execution-records/module-0{1,9}/api-contract-snapshot.md` | validate-yaml 门禁语义、失败单解锁语义 |
| `docs/02-product-requirements/Modules/README.md` | 版本对齐总表同步 |

---

## 6. 验收与验证清单

**功能验证（端到端）**

1. 挂载引用不存在 job 的**存活类**规则 → 点「提交生效」→ **被阻断**，展示 error 清单；勾选逃生门后可保存；
2. 保存后 M09 生成 `failed(user_config)` 草稿 → **规则 `change_status` 被清除**（非 `pending`），M01 中该规则**可编辑**；
3. 在 M01 修改规则（补齐 job 或改正引用）→ 保存 → M09 旧单被 `superseded`、生成新单并 `passed` → 确认下发 → 规则回写 `deployed`；
4. 草稿因 **`platform_fault`** 失败（如 `promtool` 不可用）→ 规则**保持锁定**（不清锁），重校环境就绪后可恢复 `passed`；
5. 废弃 failed 草稿 → 规则清锁（保持现有行为）；
6. 规则 job 引用失败时，M09 详情「前往修改」→ 跳 `/rules`（不再跳 `/scrape-jobs`）。

**回归/技术验证**

- 清锁写入**不改变**规则 `updated_at`（SQL 层核对），且不触发额外重算；
- `RevalidateDraft` 仍 failed 时返回 `ErrValidationStillFailed` 不变（`service.go:803-804`）；
- `ConfirmDraft` 的 `validation_status=passed` 门禁不变（`:548`）；
- `DiscardDraft` 行为不变（`:611-673`）；
- `go test ./platform/configcenter/... ./platform/strategy/...` 通过；前端 `RuleMountDrawer.test.tsx` 更新后通过。

---

## 7. 边界、风险与未决

- **本决策不解除「发布期门禁」**：M09 侧 error 仍阻断确认，本次只是让 M01 侧不再「放行到必然失败」。
- **逃生门是显式覆盖，不是静默降级**：需在草稿/审计中可回溯「用户已知晓风险」。落库字段与展示位置待实现时定（可在 `MonitoringRule` 增轻量标记或在 M09 草稿 `metadata` 留痕）。
- **与 v0.3 草稿态的关系**：v0.3 规则「保存草稿 / 提交生效」双按钮落地时，门禁只作用于「提交生效」。
- **未决①（清锁目标态）**：67-1 清锁目标态最终取 `none`（推荐）还是 `deployed`（最小改动、复用现成 where），需实现时定稿并同步 `DiscardDraft` 口径，避免同一状态列出现两种语义。
- **未决②（采集 Job 是否同等覆盖）**：`ScrapeJob` 存在**结构同源**的死锁——targets schema 类 `user_config` 失败同样会生成不可确认的 failed 草稿并锁死 Job（`change_status=pending`），用户只能靠废弃解锁。本次 67-1 按用户决策**仅覆盖规则**（`MonitoringRule`），因为 Job 的废弃语义更复杂：`DiscardDraft` 对 Job 做**分类回写**（新建回退 `draft_status=draft`、删除/停用自动恢复、已生效修改保留），是「撤销源数据」而非单纯清锁；直接套用既有 where 清锁会与分类回写语义冲突，可能产生「删停型 job 被解锁但仍不参与生成」的中间态。**需单独评估**（建议方向：Job 侧按「失败类型」区分——纯 schema 修正类走清锁，涉及删除/停用的走既有分类回写），未决前保持现状。
- **未决③（逃生门落痕位置）**：`ack_job_ref_errors=true` 的显式覆盖需可审计——在 `MonitoringRule` 增轻量标记、还是在 M09 草稿 `metadata` 留痕，待实现时定。

---

## 附录 A：决策 66 修订对照

| 决策 66 原文 | 决策 67 修订后 |
|---|---|
| 第 2 条「M01 编辑期校验（fail-fast，提示不阻断）… error/warning 均行内提示，**不阻止保存**（兼容「先挂规则、后建 Job」合法时序）」 | M01 编辑期校验（fail-fast，**error 默认阻断**）：error 级（存活类缺 job）**默认阻断**「提交生效」/「保存变更」，提供**显式覆盖逃生门**（勾选「已知晓，先挂规则后补 Job」）后放行并降级为 warning 留痕；warning 级维持只提示、不阻断 |
| 第 4 条「推荐动线为先 Job 后规则，但不强制…「先挂规则、后建 Job」仍是合法流程，**仅触发 warning**，由 M09 发布期决定是否真正允许发布」 | 「先挂规则、后建 Job」仍是合法流程，但**默认路径被阻断，需显式覆盖**；M09 发布期门禁（error 阻断确认）不变 |
| 第 3 条「判定逻辑单一实现」 | **补充**为「单一实现 + **同一输入集**」：抽 `effectiveJobNames(db, scope, domainID)`（67-4） |
| 第 1 条（yaml 挂载入口长期保留）、第 5 条（失败回 M01 动线） | **不变**；第 5 条的「前往修改」按来源路由细化（67-3） |

## 附录 B：证据索引

| 结论 | 证据位置 |
|---|---|
| M09 按域取 job | `platform/configcenter/generator/data_source.go:41-51` |
| 规则全局、不按域过滤 | `platform/configcenter/generator/data_source.go:53-66`；M01 PRD §5.5「网域无关性说明」 |
| M01 全库取 job | `platform/strategy/rule/validate.go:105-115` |
| 渲染不丢 job | `platform/configcenter/generator/render.go:85-95` |
| 报错不阻断（前端） | `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx:101-140`；测试 `RuleMountDrawer.test.tsx:158-159` |
| 报错不阻断（后端） | `platform/strategy/rule/update.go:117-119`；`platform/strategy/rule/jobref/jobref.go:7,125-127` |
| 保存即写 pending 锁 | `platform/strategy/rule/create.go:77` |
| pending 禁编辑/删除 | `platform/strategy/rule/update.go:43,97` |
| 失败单不可确认 | `platform/configcenter/draft/service.go:548` |
| 失败单仍为 pending | `platform/configcenter/draft/service.go:149,331` |
| 唯一清锁路径 | `platform/configcenter/draft/service.go:611-673` |
| 取代式 reconcile | `platform/configcenter/draft/service.go:251-360` |
| 重校仍 failed 语义 | `platform/configcenter/draft/service.go:773-808` |
| 发布期门禁 | `platform/configcenter/generator/validate.go:160-184` |
| 下发成功回写 deployed | `platform/configcenter/deployment/callback.go:31-44` |
| 「前往修改」硬编码 | `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx:681` |
