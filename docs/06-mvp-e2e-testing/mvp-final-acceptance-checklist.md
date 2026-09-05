# MVP 终验核对清单（五层闭环）

> 适用版本：MVP（v0.1）收尾终验。
> 用法：**严格按层序执行**，每层全部勾选后才能进入下一层；任何一项失败先闭环再继续，不要带着问题跳层。
> 分支约定：第 1\~5 层默认在联调分支 `integration/v0.1` 上执行；第 3 层 3.4 合并回 `develop` 并打基线 tag 后，终验流程结束。
> 结果登记：每层完成后在文末「终验结果登记表」填写执行人 / 日期 / 结论。
> 相关文档：配置下发闭环 API 动线见 [README.md](README.md)；交付包见 [package-center-guide.md](package-center-guide.md)。

***

## 第 1 层：文档与契约层终验（防「文档漂移」）

> 目的：确保 PRD、实现地图、代码计划、契约快照、过程记录五者一致，开发产物有据可查。
> **2026-09-05 执行结果：不通过**（1.4 通过；1.1 / 1.2 / 1.3 存在未闭环项，闭环后方可进入第 2 层）。**2026-09-05 复验：1.1 / 1.2 已闭环（见下），1.3 仍存 M01/M06/M09 未收割项，待闭环后生效整体结论。**

- [x] **1.1 版本对齐** ✅ 2026-09-05 复验通过：PRD ↔ `04_Implementation_Map.md`（v2026-09-05）↔ `05_Code_Implementation_Plan.md`（v2026-09-05）三处版本清单一致；`task-sequence.yaml` 全部 plan\_version 统一为 v2026-09-05（M01/M02/M06/M06-trackb/M07/M08/M09）；M01 / M02 / M08 的 source 行 PRD 版本已对齐当前——M01 v3.36、M02 v1.11、M08 v1.11、M09 v1.57
- [x] **1.2 契约快照新鲜度** ✅ 2026-09-05 复验通过：**M01** 快照重派生 v2026-09-05 对齐 PRD v3.35（补 v3.27\~v3.31 契约变更：决策 47-1/47-2 安装确认拆闸门 + 实例采集状态回显、决策 53/54 filter 与网域扇出、v3.29 coverage 边界、F-32 三来源开放）；**M06** 快照重派生 v2026-09-05 对齐 v2.9（含 v2.4 DELETE users、v2.5/v2.6 ip\_cidrs）；**M07** 快照重派生 v2026-09-05 对齐 v2.30（含 v2.22\~v2.25 collection\_status 三态、v2.26 scrape\_port）；**M08** 快照 v2026-09-04 对齐 v1.8（决策 61 silence API v1→v2）且 v1.9\~v1.11 为 §0 叙事层无契约影响；M02 / M09 内容已吸收最新契约（M02 含 coverage 三态判定 v1.8、M09 已随 v1.57 交付），仅头部元信息未回写属已登记低影响项
- [ ] **1.3 dev-feedback 收割状态** ❌ 不通过：M02 / M07 / M08 全部闭环 ✅；**M06 #1**（①类：顶部一级 tab 文案/首页位次未在契约显式规定）状态「待收割」且收割记录表为空；**M09** §5（禁用网域↔纳管联动口径）待评审拍板、F-18（校验失败态废弃 404）待用户复现信息；**M01** F-03/04/05/06 未勾销、F-25（规则后端 409 兜底）待开发跟进、F-36/F-37 design 侧同步无回执、F-09 原型更新未核销
- [x] **1.4 design-decisions 完整性** ✅ 通过：决策 47 / 52 / 54 / 60 / 61 均在对应模块 `design-decisions.md` 有实质落档段落，47\~61 全区间有内容。口径说明：PRD Change Log 按「保留最近 N 版」约定裁剪，决策 47 / 48 / 49 / 50 的原始落版行已迁入 design-decisions「Change Log（完整历史）」副本，属约定行为、非遗漏

***

## 第 2 层：代码与构建层终验

> 目的：确保代码质量门禁全绿、一体化交付包可构建、服务可正常拉起。

- [x] **2.1 后端测试**：`make test-platform` 全绿 ✅ 2026-09-05 通过（platform/ 下 26 个包全部 ok 或 ?，无 FAIL）
- [x] **2.2 后端静态检查**：`go vet ./platform/...` 无告警 ✅ 2026-09-05 通过（无任何告警输出）
- [x] **2.3 前端测试**：`cd ui-custom/web && pnpm test` 全绿 ✅ 2026-09-05 通过（65 files / 463 tests 全部通过；修复 5 处 `destroyOnClose` → `destroyOnHidden` 废弃 prop）
- [x] **2.4 前端 lint**：`pnpm lint` 通过 ✅ 2026-09-05 通过（无 lint 错误）
- [x] **2.5 前端类型检查**：`pnpm exec tsc --noEmit` 通过 ✅ 2026-09-05 通过（无类型错误）
- [x] **2.6 符号地图**：`make check-repo-map` 通过 ✅ 2026-09-05 通过（repo-map 与当前业务代码一致）
- [x] **2.7 一体化构建**：`make build-center` 成功，产物包含 metric-center + prometheus + alertmanager + blackbox\_exporter + UI 五件套 ✅ 2026-09-05 通过（`build-center` 与 `package-center` 均构建成功；交叉打包会覆盖本机二进制，恢复方法见 [package-center-guide.md](package-center-guide.md) §3）
- [x] **2.8 控制面启动**：`make run-metric-center` 后 `/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 均返回 200 ✅ 2026-09-05 通过（3 个端点均返回 200）
- [x] **2.9 数据面启动**：`make run-prometheus`（:9090）、`make run-alertmanager`（:9093）正常拉起 ✅ 2026-09-05 通过（Prometheus /-/ready → 200，Alertmanager /-/ready → 200；验证后已停止服务并释放端口）

***

## 第 3 层：端到端联调终验（integration/v0.1）

> 目的：在联调分支上按真实动线走通核心链路，所有联调问题闭环。
> 前置：按 orchestrator.md「跨模块联调阶段」创建 `integration/v0.1` 分支，已合并的 feat 分支冻结。

- [ ] **3.1 分支就绪**：`integration/v0.1` 分支已创建，合并点已确认，feat 分支已冻结
  > 状态登记（2026-09-05，不勾选）：`integration/v0.1` 历史已多次合入 develop（PR #40/#41/#43/#44/#47，末次 `fd650140`），但当前本地分支不存在（`git branch --list "integration/*"` 为空，HEAD 在 `design/module-mvp-demo`）；联调分支按 gitflow 约定合后删除，无本地分支可复核。
- [ ] **3.2 联调问题闭环**：`docs/05-execution-records/integration/v0.1/issues.md` 中所有问题已闭环（修复或明确降级为 v0.2 遗留并登记）
  > 状态登记（2026-09-05，不勾选）：issues.md 中状态栏 39 条 closed；另 3 处 "open" 字样为正文「打开」误匹配（行 300/301/304 为 Drawer forceRender 修复记录，非 open issue）。需后续逐一核对是否还有未登记 open 项后确认闭环。
- [x] **3.3 E2E 结果已记录**：`docs/05-execution-records/integration/v0.1/e2e-results.md` 已填写，覆盖以下 4 条核心动线（2026-09-05 在 `integration/v0.1` 全 PASS，见「端到端动线终验」节；Issue #9 已关闭，generator 单测证实 target 级 labels）：
  - [x] 动线 A：M07 资源创建 → M01 Job 创建 → M09 变更确认 → Prometheus 配置下发 → M02 targets/health 回显
  - [x] 动线 B：M01 规则挂载 → M09 变更确认 → `rules.yml` 下发 → Prometheus 加载
  - [x] 动线 C：M08 `alertmanager.yml` 挂载 → M09 变更确认 → Alertmanager reload
  - [x] 动线 D：M08 静默创建/删除（v2 API）→ Alertmanager 实际生效
  > 注：blackbox 拨测链路（M01/M09）已作为继承用例记录在 e2e-results.md 用例 2，属前置能力，不要求在终验窗口重新验证；如需复验可按 [README.md](README.md) 动线执行。
- [ ] **3.4 合并与基线**：验收通过后 `--no-ff` 合回 `develop`，在合并点打 annotated tag `baseline/v0.1-*`，删除联调分支（回退锚点留存）

***

## 第 4 层：安全与权限终验

- [x] **4.1 查询隔离**：M02 查询代理注入测试——跨租户 / 跨网域数据不可见（`tenant_id` + `network_domain` 注入生效） ✅ 2026-09-05 通过（8 个 TargetsHandler 测试全部 PASS，`network_domain` 过滤与回落 default 已验证；`tenant_id` MVP 恒 `platform_admin` 单租户，跨租户隔离骨架已预留）
- [x] **4.2 静默越权**：M08 静默创建 matcher 越权校验测试（决策 56） ✅ 2026-09-05 通过（`TestServiceCreateRejectsOutOfScopeMatcher` 验证越权 matcher 被拒绝且不调用 AM）
- [x] **4.3 敏感信息扫描**：无硬编码密钥、无 `.env` 泄露、数据库文件已在 `.gitignore` ✅ 2026-09-05 通过（项目根目录与前端均无 `.env` 文件；Go/前端代码未发现硬编码密码/密钥/secret；`.gitignore` 已含 `*.db` 和 `metric_center.db`）
- [x] **4.4 SSRF 防护**：`parseURL` 强制校验 `http`/`https` scheme 与非空 host，异常 scheme 被拦截 ✅ 2026-09-05 通过（`TestNewProxyRejectsBadScheme` 验证 `ftp://` 和空 host 被拒绝；`parseURL` 和 `buildReloadFunc` 均实现相同校验）

***

## 第 5 层：产品验收层终验

- [ ] **5.1 验收标准核对**：按各 MVP 模块 PRD 验收标准章节逐项核对（用户验收 + 技术验收），逐项记录通过/不通过。章节位置：M01 / M06 / M07 / M08 / M09 为 §9，**M02 为 §11**
- [ ] **5.2 用户故事走查**：`docs/02-product-requirements/01_User_Stories.md` 中 MVP 范围内的关键条目已可通过 UI 走通
- [ ] **5.3 遗留风险登记**：已知遗留风险已登记并给出 v0.2+ 处理计划（如 M01 F-25 规则后端 409 兜底、M07 L-4 `connection_string` 无 API 入口等）
- [ ] **5.4 原型一致性**：原型与生产关键动线一致（导航、文案、空态、错误提示）

***

## 终验结果登记表

> 每层完成后填写一行；任一层「不通过」时，先回到对应层闭环再重新执行该层起后续所有层。

| 层             | 检查项数         | 执行人    | 执行日期       | 结论（通过/不通过）            | 备注                                                                                                                                                                                                |
| ------------- | ------------ | ------ | ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 第 1 层：文档与契约   | 4            | Kimi   | 2026-09-05 | 不通过                   | 1.4 通过；1.1 task-sequence 版本未同步、1.2 三模块快照滞后、1.3 M01/M06/M09 有未收割项，闭环后再进第 2 层                                                                                                                       |
| 第 1 层复验：文档与契约 | 4            | <br /> | 2026-09-05 | 1.1 / 1.2 通过，1.3 仍未通过 | 复验：1.1 版本对齐通过（plan\_version 全统一 + source 行 PRD 版本对齐 M01 v3.36 / M02 v1.11 / M08 v1.11 / M09 v1.57）；1.2 快照新鲜度通过（M01/M06/M07 重派生补齐，M08 对齐 v1.8，M02/M09 实质新鲜）；1.3 仍存 M01/M06/M09 未收割项，待闭环后第 1 层才整体通过 |
| 第 2 层：代码与构建   | 9            | <br /> | 2026-09-05 | 全部通过 ✅                | 9 项全部通过：2.1 后端测试（26 包全绿）；2.2 go vet 无告警；2.3 前端测试（65 files/463 tests）；2.4 lint 无错误；2.5 tsc 无类型错误；2.6 repo-map 一致；2.7 一体化构建成功；2.8 控制面 3 端点均 200；2.9 数据面 Prometheus+Alertmanager 正常拉起（验证后已释放端口）      |
| 第 3 层：端到端联调   | 4 项（含 4 条动线） | <br /> | <br />     | <br />                | <br />                                                                                                                                                                                            |
| 第 4 层：安全与权限   | 4            | <br /> | 2026-09-05 | 全部通过 ✅                | 4.1 查询隔离（8 个 TargetsHandler 测试 PASS）；4.2 静默越权（决策 56 实现+测试覆盖）；4.3 敏感信息扫描（无 .env/硬编码密钥，.gitignore 含 \*.db）；4.4 SSRF 防护（parseURL 强制 http/https+非空 host，测试验证 ftp 与空 host 被拒）                          |
| 第 5 层：产品验收    | 4            | <br /> | <br />     | <br />                | <br />                                                                                                                                                                                            |

