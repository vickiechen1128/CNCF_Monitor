# Module 02 查询中心 — 开发侧反馈记录

> 本文记录 M02 开发阶段（feat/module-08-alert-dispatch，决策 47 批次）发现的 PRD/原型空白、契约缺口与技术决策，
> 供产品/设计侧收割。依据项目约定：开发发现 PRD/原型空白或纯技术优化问题时须在此记录，PR 描述中附本链接。

| 字段     | 值                                               |
| ------ | ----------------------------------------------- |
| 模块     | Module 02：查询中心                                  |
| 分支     | feat/module-08-alert-dispatch（决策 47 采集状态回显批次先行） |
| 记录时间   | 2026-09-03                                      |
| PRD 版本 | v1.8                                            |

***

## 1. 需产品/设计确认（与 PRD / 决策 47-4 不符）

### F-1. 「目标状态页」前端暂挂到 M09「网域与节点管理」下，与决策 47-4「不新增导航入口」冲突

- **背景**：决策 47-4 将 M02「独立目标状态页」降为 **P1**，task-sequence T02-F1 的 `nav_contract` 明确「本期仅注册 API client 与可选极简页，**不新增顶部一级 tab / 不占导航位**」（状态知情入口由 M01 Job 回显 47-2、M07 资源三态 badge 47-3 承担）。按此，`TargetStatusPage`（路由 `/targets`）已实现但**无任何导航入口**，界面不可直达（仅 URL 可达）。

- **前端取值（开发侧）**：为便于 MVP 演示期可达，临时在 **M09「网域与边缘配置中心 → 网域与节点管理」组**下新增二级菜单「**监控目标状态**」（图标 RadarChart、路由 `/targets`），与「采集节点状态」同级。已同步 `COLLAPSIBLE_GROUPS` 与 `resolveActiveModule`（/targets 并入 access-plane 自动展开、激活 M09 tab）。

- **矛盾点**：该入口归属 **M09** 而非 M02，且与决策 47-4「独立页不纳入本期导航」的既定契约**不符**——属**前端为可达性做的临时挂载**，非正式导航规划。

- **请求结论 / 已决策**：采用 **方案 B**——维持 M09 临时挂载作为 MVP 占位，并在 `docs/05-execution-records/module-02/design-decisions.md` 补决策 10 豁免记录；PRD Module_02 当前不新增正式导航描述，维持决策 47-4「独立目标状态页 P1、无强制导航入口」口径。

- **影响面**：`ui-custom/web/src/layouts/MainLayout.tsx`（导航菜单 + 路由分组，M09 组下二级菜单「监控目标状态」保留）；`docs/05-execution-records/module-02/design-decisions.md` 决策 10。

## 2. 遗留风险 / P1 记账（评审建议，非本轮缺陷）

| 编号  | 项                                                   | 说明                                                                                                                             |
| --- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R-1 | M-2 coverage 上游不可达错误语义与同族代理不一致                      | `/targets`、`/health/coverage` 上游失败返回 500 `internal`，而同族 `/query*` 代理返回 502 `bad_gateway`；按契约快照 §2.1/§2.2 未违约，但同族行为不一致，已提议统一或留档 |
| R-2 | M-2 coverage 无条件拉上游                                 | 资源为空时应短路返回空集、避免上游故障掩蔽空数据 —— **已在本批次修复**（coverage.go 空集短路）                                                                      |
| R-3 | `/targets` 透传 `targetsByJob`/`droppedTargets` 未同步过滤 | 仅 `activeTargets` 被过滤补全；建议契约/前端约束只消费 `data.activeTargets`                                                                      |
| R-4 | L-4 coverage 全量加载 + 内存排序，无分页下推                      | MVP 可接受，建议后续下推分页到 DB 或缓存                                                                                                       |

> 注：R-1、R-3、R-4 为评审 MEDIUM/LOW 记账项，MVP 可接受，交由产品侧评估是否本轮列入修订。


---

## 3. `/api/v1/alerts/history` 点数上限与步长口径：PRD 空白 + 缺失的服务端兜底（① 空白判定 / ② 缺陷，已修复，决策 90）

- **类别**：① 空白判定（PRD 未规定「窗口 × 步长」的点数约束与超限处置）+ ② 实现缺陷（服务端无兜底、消费侧未传 step）
- **PRD 章节 / 文件位置**：`Module_02_Query_Center.md` §5.4（重建口径）/ §6.1（请求参数）/ §11.2（验收 14a）；源码 `platform/query/alerts_history.go`、`platform/query/alerts_history_test.go`
- **现状 / 根因**：`step` 与时间窗独立解析，二者在「用满窗口」时互斥——服务端默认 `step=30s`，最大窗口 `7d`，`20160` 点 > Prometheus `query_range` 单序列上限 `11000` → 上游 400 → 本接口 500。PRD 只写了「`step` 默认 30s、最小 15s」「窗口默认 24h、最大 7d」，**未声明两者必须满足点数约束**，即「最大窗口 + 默认步长」是 PRD 许可而实现必然失败的组合（空白判定）。
- **结论（决策 90）**：
  1. **服务端兜底（A）**：新增 `maxHistoryPoints = 11000` 与 `normalizeHistoryStep(step, window)`，窗口裁剪后归一化步长，使 `floor(window/step) + 1 ≤ maxHistoryPoints` 恒成立；**只抬高、不压低**，默认 24h 窗口零行为变化，7d 窗口由 30s 抬高到 55s。
  2. **响应回显 `data.step`**：附加字段，供消费方披露估算精度与线上自查（无破坏性变更）。
  3. **调用侧显式传参（B，M05/M08 前端）**：`ALERT_HISTORY_STEP_SECONDS = 30`（= PRD 默认步长；口径由「统一 60s」改定为 30s，见 `design-decisions.md` 决策 90 同日补充），两处调用点均显式透传。
- **PRD 待回填（遵守 PRD 冻结门禁，不改动本版 PRD）**：
  - §5.4 重建口径补一句「**`step` 会被服务端按窗口抬高**，使单序列点数不超过上游上限；响应 `data.step` 回显实际生效值」；
  - §6.1 请求参数表补 `step` 行（当前只在 §5.4 正文提及）与响应 envelope 的 `step` 字段；
  - §11.2 验收 14a 补一条技术验收：「**7d 窗口 + 不传 step（或传 30s）→ 200 且 `data.step ≥ 55`**（不返回 500）」，并把「调用方应显式传 `step`（期望粒度 30s）」写入 §11.1 前端口径，避免后续新增消费方再次踩坑。
  - **补充（口径定为 30s 后）**：§6.1 的 `step` 行宜同时写明**语义**——「调用方传入的是**期望粒度**，服务端可按窗口抬高；实际生效值看响应 `data.step`」；前端取值 30s 与 §5.4「默认 30s、最小 15s」一致，无需为宽窗口单独标注取值。
  - **建议随 Module_02 v1.17 一并落版**。
- **对 PRD 现有表述的依据说明（无需改动但需知悉）**：现有「默认 30s / 最小 15s」是**入参解析语义**（未传时取 30、小于 15 时抬到 15），本决策未推翻该语义；新增的「按窗口抬高」发生在解析**之后**，属实现层保护，故写进 §5.4/§11.2 比写在参数语义处更准确。
- **影响模块**：M02（`/api/v1/alerts/history` 代理）、M05（首页告警卡取数）、M08（历史告警页取数）
- **验证**：`go test ./platform/query/...`（新增 `TestNormalizeHistoryStep` 7 例 + 3 例端到端步长用例）、`go test ./platform/...` 27 包全通过、`go vet` 干净
- **发现场景**：用户实测首页「当日 / 近 7 天告警」恒为 0，而「通知中」有当日告警（2026-09-18）；本地以 `step=60` 复测接口恢复正常返回
- **状态**：closed（后端代码 + 测试 + 决策 90 已落地；PRD 文本待 v1.17 回填）

---

## 4. 目标状态页「实例名 / 实例IP」搜索：PRD 与原型均空白（① 空白判定，已实现）

- **类别**：① 空白判定（PRD Module_02 §5.3 与 `docs/prototypes/module-02` 均未定义目标状态页的搜索/筛选能力与「实例名」列）
- **提出人 / 场景**：项目负责人实测 M09「监控目标状态」页（`/targets`，M02 目标状态页前端临时挂载，见本文件 F-1），要求「增加搜索用户手动填写监控对象的实例名、实例IP的功能」。
- **关键口径澄清（易踩坑）**：**采集 Job 名 ≠ 实例名**。
  - `job` 是用户在 M01 **自由填写**的抓取任务标识，平台不保证其等于实例名（实测数据：3 个 target 的 job 名均为 `tengxunyun-ceshi-host`，而对应台账实例名分别是 `tengxunyun-ceshi` / `GL_OPS_MONITOR_01_X86` / `monito2-02`）。
  - 真正的「实例名」在 **M07 资源台账**：host→`instance_name`、application→`service_name`、generic_target→`target_name`、database / middleware→`ip:port`；target 经 `resource_id` 标签（决策 47-3 强制注入）回连取值。
  - 「实例IP」取 target 的 `instance`（`host:port`）的 host 部分，Prometheus 直接透传，无需回连。
  - 因此**不得**用 job 名替代实例名，否则语义错误（用户判断正确）。
- **已实现（开发侧取值）**：
  1. 后端 `GET /api/v1/targets` 新增 `search` 参数，大小写不敏感 `contains`，同时匹配「M07 可读实例名」与「`instance`（IP）」；local targets 与 F-11 边缘快照统一生效；实例名映射复用 `coverage.go` 的 `queryCategoryResources` 口径（反 N+1，按网域一次拉取）。
  2. 响应 `activeTargets[]` 逐项新增 `instance_name` 字段（无 `resource_id` 或台账无此资源时为空串）。
  3. 前端 `TargetStatusPage` 筛选区新增单个「实例名/IP」搜索框（`Input.Search`，回车/点击触发、清空即复位），表格新增「实例名」列（原「实例地址」列保留）。
- **PRD / 原型待回填（遵守冻结门禁，不改动本版 PRD 与原型）**：
  - Module_02 §5.3 补「目标状态页支持按实例名 / 实例IP 模糊搜索」能力描述，并在字段表中补 `instance_name`；
  - `docs/prototypes/module-02` 目标状态页原型补搜索框与「实例名」列；
  - 明确「实例名」的权威来源是 M07 台账（经 `resource_id` 回连），非 job 名。
- **影响面**：`platform/query/targets.go`、`platform/query/targets_test.go`、`ui-custom/web/src/types/query.ts`、`ui-custom/web/src/api/targets.ts`、`ui-custom/web/src/pages/query/TargetStatusPage.tsx`、契约快照 §2.1 / §2.1.1。
- **已知边界**：边缘快照 / 部分 target 可能缺 `resource_id` 标签，此时实例名为空（前端降级 `-`），只能按 IP 命中。
- **验证**：`go test ./platform/...` 全通过（新增 7 例 search 用例）、`go vet` 干净、`vitest run src/pages/query/TargetStatusPage.test.tsx` 7 例通过、`tsc --noEmit` / `eslint` 干净、`make check-repo-map` 通过。
- **状态**：open（后端/前端/契约已落地；PRD 与原型文本待设计侧回填）
