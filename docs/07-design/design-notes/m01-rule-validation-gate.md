# 设计专题：规则检查与提交门禁

> 所属模块：M01 监控策略与指标管理
> 对应 SRS：FR-14 ~ FR-16、NFR-08
> 关联代码：`platform/modules/m01/service/rule.go`、`service/promtool.go`、`domain/rule.go`、`handler/rule.go`、`ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`、`api/monitoringRules.ts`
> 状态：已实现（指标存在性校验、标签/注解预览未实现）

---

## 1. 为什么单独设计

规则是「用户粘贴的完整 YAML」，错误半径大：语法错误会让整份 `rules.yml` 无法加载；组名冲突会让多个规则互相覆盖；引用不存在的 job 会让存活类告警恒触发。因此规则保存不能只做「YAML 能解析」，需要**检查 → 提交**两段式，并且**检查与提交同口径**。

约束（D35/D36）：规则由中心 Prometheus 集中求值，`scope` 仅 `central`；规则为平台级对象，`job` 引用按全平台生效 Job 并集校验。

---

## 2. 校验分层

`RuleService.evaluate` 是检查与保存共用的唯一入口：

| 层 | 内容 | 失败语义 |
|---|---|---|
| 1. 内容 | 非空、≤1MB、YAML 可解析、`groups` 为非空数组 | 硬失败（400） |
| 2. 结构 | 组名必填且文件内不重复；每组至少一条规则；`expr` 必填；`alert`/`record` 二选一 | 硬失败（400） |
| 3. 组名全局唯一 | 与其它「`enabled=true AND draft_status=ready`」规则的组名比对（检查时排除自身） | 硬失败（`valid=false`） |
| 4. job 引用 | 扫描表达式中 `job="..."` / `job=~"..."`，与全平台 `ready+enabled` Job 名比对 | 分级：存活类 error / 其它 warning |
| 5. PromQL 语义 | 子进程 `promtool check rules` | `failed` 硬失败；`unavailable` 仅提示 |

判定细节：

- **存活类规则**：表达式含 `up` 词元（如 `up == 0`、`absent(up{...})`）时，引用不存在的 job 判 `error`，因为这类规则会对「不存在的 job」持续为真，导致误告警；
- 其它规则判 `warning`（可能是有意先建规则后建 Job）；
- `=~` 正则匹配时，能确定命中即通过；无法判定（正则能力之外）时跳过，不误报。

---

## 3. PromQL 三态

| 状态 | 触发 | 门禁影响 | 前端展示 |
|---|---|---|---|
| `passed` | promtool 退出码 0 | 通过 | 「PromQL 通过」 |
| `failed` | promtool 退出码非 0 | 硬失败 | 错误详情（promtool 输出尾部 ≤1500 字符） |
| `unavailable` | promtool 不存在/不可执行/临时文件失败 | **不阻断** | 「未执行 PromQL 语义校验」+ 原因 |

> `unavailable` 不阻断是刻意的环境降级：避免开发/测试环境缺少 promtool 时完全无法保存。代价是无效表达式可能被保存——部署必须保证 `promtool` 在 PATH（Makefile 已将 `upstream/prometheus` 加入 PATH）。

---

## 4. 提交门禁与逃生门

- 保存（POST/PUT）同样调用 `evaluate`，不复用检查结果，防 TOCTOU；
- 存在 `error` 级 job 引用且未确认 → 400，`errorType=job_ref_unresolved`；
- 前端勾选「已知晓：先挂规则，稍后补建 Job」后提交，携带 `ack_job_ref_errors=true`（与 `ack_reason`），服务端放行并落库留痕；
- `warning` 级不阻断，仅提示；
- 停用规则不参与组名唯一性校验与下发，组名在停用后释放。

---

## 5. 前端状态机

```text
idle ──点击「检查」──▶ checking ──valid=true──▶ passed ──提交──▶ 保存
  ▲                        │                      │
  │                        └──valid=false──▶ failed
  └──── 规则内容变更（rule_content）────────────────┘（作废检查与 ack）
```

- 「检查」常驻；**提交按钮条件渲染**：`passed && (!jobRefBlocked || ack)`，未检查时按钮不存在（状态机而非 disabled）；
- 只有 `rule_content` 变更才作废检查结论与 ack；规则名/监控对象类型等非内容字段变更不重置，避免无效重检；
- 检查接口不可用（网络/旧后端）时回落本地 `validateYamlClient`（仅 YAML 语法），提交时由后端门禁兜底并给出专用逃生门面板。

---

## 6. 校验结果明细（本次补齐）

检查响应包含 `groups` / `rules` / `promql{status,error}`；前端在结果面板展示：

- 通过：`N 个组 / M 条规则 · PromQL 校验通过`；`unavailable` 时显示「未执行」与原因；
- 失败：后端错误文本（已包含组名/规则索引，如 `groups[0].rules[1].expr is required`、`duplicate group name "x"`、`group "x" conflicts with rule "y"`）+ 已解析的组数/规则数，便于定位；
- job 引用与逃生门保持既有分级面板。

**限制**：`promtool` 的报错是 `文件:行` 粒度，后端未把行号映射回组/规则；需要更精确定位时，后续可按 YAML AST 位置映射。

---

## 7. 已知限制

| 限制 | 影响 | 计划 |
|---|---|---|
| 未校验 `expr` 中指标名是否存在（指标库 / Prometheus） | 拼错指标名不会被检查发现 | 后续用 `/api/v1/label/__name__/values` 或指标库做 warning 级校验 |
| 标签/注解实时预览在 v3 为空实现（`inspectRuleLabels` 返回空数组） | 「预览可用标签与注解」无数据 | 接回只读接口（Prometheus `/api/v1/series` + 模板渲染）后开放 |
| promtool 输出未映射到组/规则行号 | 失败定位依赖后端错误文本 | 后续按 AST 位置映射 |
| 检查通过后组名可能被他人占用 | 保存仍可能 400 | 保存侧复核；错误文案点名占用方 |

---

## 8. 测试点

- 结构：空内容、非 YAML、空 `groups`、组名缺失/重复、组无规则、`expr` 缺失、`alert`/`record` 同时存在/都缺失；
- 组名：与其它生效规则冲突（排除自身）、停用规则不参与、检查与保存同结论；
- job 引用：字面量/正则、存活类 error、普通 warning、逃生门放行与留痕、`ack=false` 阻断 `job_ref_unresolved`；
- PromQL：passed / failed / unavailable 三态与展示；
- 前端：未检查无提交按钮、检查失败展示原因、内容变更作废检查、ack 后提交、结果明细文案。
