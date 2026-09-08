# dev-feedback 登记单 — Module_09 网域与边缘配置中心

> 归属：backend-developer（Agent 可写区 `docs/05-execution-records/module-09/`）
> 登记原则：① PRD 未规定的空白/细节判决策、③ 原型纯技术优化在此留痕；② PRD 已规定但实现发现矛盾需实现前报告 Orchestrator，禁止事后当既成事实塞入。

## 格式约定

| 字段 | 说明 |
|------|------|
| 类别 | ① 空白判定 / ③ 技术优化 / 契约口径确认 |
| PRD 章节 / 文件位置 | 来源 |
| 现状 | 实现当前行为 |
| 建议 / 结论 | 判定或建议 |
| 影响模块 | 前端 / 后端 |
| 发现场景 | 何时定位 |

---

## 1. 契约口径确认：list 接口不返回明文 token

- **类别**：契约口径确认（回应 frontend-reviewer 询问）
- **PRD 章节 / 文件位置**：`docs/05-execution-records/module-09/api-contract-snapshot.md` §3 NetworkDomain 字段表（`token`/`token_masked`）、§9 必填口径「Token」；源码 `platform/models/network_domain.go`
- **现状**：`NetworkDomain.Token` 序列化标签为 `json:"-"`，明文 token **不会**进入任何 list / detail 响应；`token_masked` 由 `AfterFind` 钩子从库中读出时派生。明文仅两处单次返回：`POST /api/v2/platform/network-domains/{id}/monitor`（MonitorOutcome 携带 `token`）与 `POST /api/v2/platform/network-domains/{id}/reset-token`（`TokenResult{token, token_masked}`）。
- **结论**：**list（GET /network-domains）不返回明文 token，仅携带 `token_masked`（完全脱敏）**；明文只在 /monitor 与 /reset-token 单次返回。该口径已满足契约 §3/§9，无需改动网络域序列化。
- **影响模块**：前端（确认消费 `token_masked` 做展示；明文仅从 /monitor 与 /reset-token 响应取）
- **发现场景**：golang-reviewer 审查时前端 reviewer 提出「list 是否返回明文 token」之疑，后端核对模型序列化后确认。

---

## 2. 部署路由 param 名统一

- **类别**：③ 技术优化（内部实现）
- **PRD 章节 / 文件位置**：契约 §5 `POST /deployments/{deployment_id}/retry`、`POST /deployments/{config_version_id}/rollback`
- **现状**：gin 同一路径段 `:id` 的通配符名必须一致，故 retry/rollback 统一用 `:id`（语义由 handler 依请求区分）。
- **结论**：URL 形态对前端不受影响，`retry` 仍走 deployment_id、`rollback` 仍走 config_version_id。
- **影响模块**：前端（无感知）
- **发现场景**：T09-06 实现期。

---

## 3. promtool / blackbox 校验态

- **类别**：① 空白判定（MVP 硬约束第 11 条）
- **PRD 章节 / 文件位置**：PRD §3.4 / 决策 42-2
- **现状（2026-08-26 更新）**：Makefile 新增 `build-promtool` 目标（`upstream/prometheus/promtool`，GOPROXY 走国内代理），`run-metric-center` 依赖它并在 PATH 注入 `upstream/prometheus`，校验改为真实执行 `promtool check config`；生成草稿校验在 promtool 可用时返回 `passed`。本环境无 blackbox_exporter 时其校验仍走 pending（决策 42-2）。
- **结论**：MVP 不阻断；生产需随中心 Prometheus 部署具备 promtool 才走真实校验（已由 `make run-metric-center` 自动保证）。
- **影响模块**：后端
- **发现场景**：T09 测试/验收环境。

---

## 4. 契约口径确认：source_version 语义与版本查询兼容

- **类别**：契约口径确认（回应定向复审残留缺陷）
- **PRD 章节 / 文件位置**：契约 `api-contract-snapshot.md` §4 ConfigDraftDetail.`source_version`、§5 `GET /config-versions/{id}`；源码 `platform/configcenter/draft/service.go` GenerateDraft/ConfirmDraft、`platform/configcenter/deployment/history.go` GetVersion
- **现状修复**：此前 GenerateDraft 从不设置 `source_version`，仅 ConfirmDraft 把它置为草稿自身 `change_no`（错误）；前端按数字主键 id 调 `GET /config-versions/{id}` 拉基线不命中 → diff Tab 降级。
- **结论 / 口径**：
  1. `source_version` = 生成草稿时回填**上一已确认 ConfigVersion 的 change_no**（该网域按 created_at 取最近 confirm 生成的版本）；无历史版本为空。
  2. `GET /config-versions/{id}` 的 `{id}` 兼容两种 ref：纯数字按主键 id 命中，否则按 `change_no` 命中；`source_version`（change_no）透传直接命中。
  3. ConfirmDraft 不再覆盖 `source_version`（确认不改变基线指向）。
- **影响模块**：前端（`deploymentApi.getConfigVersion(source_version)` → `/config-versions/:id` 传 change_no 字符串，后端已兼容，前端无需改动）
- **发现场景**：T09-05 定向复审确认版本对比 Diff 永不渲染真实 diff。

---

## 5. 契约口径空白：禁用网域后纳管状态保持不变

- **类别**：① 空白判定 / 契约口径确认
- **PRD 章节 / 文件位置**：Module_09 §3.1 字段语义（行政区状态由 M06 维护、纳管状态由 M09 维护）；Module_06「网域管理」；源码 `platform/models/network_domain.go`（`Status` vs `IsMonitored`）
- **现状**：在「网域管理」（M06）将边缘域禁用（`Status=disabled`）后，M09「网域纳管」页该域**仍显示「已纳管」**并保留监控参数 / Token。根因：`NetworkDomain.Status`（M06 行政启用状态）与 `IsMonitored`（M09 监控纳管状态）是**独立字段**，M06 禁用操作不联动取消 M09 纳管，且 PRD 未对「禁用是否应取消纳管 / 冻结 Token」作出规定。
- **建议 / 结论**：认定为契约口径空白（用户判定其违反契约，属产品口径待决），先登记后评审，暂不改动。候选口径——① 禁用即取消纳管并冻结 Token；② 禁用仅行政停用、纳管与 Token 保留（当前行为）。
- **决策（2026-09-05，chenrt 拍板）**：**MVP 保持现状，采用口径②**（禁用仅行政停用，`IsMonitored` 与 Token 保留）；口径①（禁用联动取消纳管并冻结 Token）纳入 **v0.2 多网域版本**实现并届时评审。已落档：M09 PRD §1「MVP 阶段」注记（v1.57）+ module-09 design-decisions 决策 62。
- **影响模块**：前端（网域管理 → 网域纳管状态联动）、后端（M06 网域状态变更钩子）
- **发现场景**：M09 测试，禁用边缘域后观察网域纳管状态

---

## 6. MVP 缺漏：自动变更检测（§3.3.3 30s 轮询）+ 保存后跳转动线

- **类别**：① 空白判定 / MVP 缺漏（联调期跨模块闭环缺口）
- **PRD 章节 / 文件位置**：PRD §3.3.3（源数据版本触发检测，30s 轮询，P0）、§9.1（确认动线）；决策 42-1（活 pending 保活）、42-4（生成失败可观测）、42-5（MVP 子集含「配置生成→变更检测→确认→diff→reload」全链路）；源码 `platform/configcenter/generator/change_detect.go`（SourceDataVersion / NeedsRegeneration）、`draft/service.go`
- **现状缺漏**：`NeedsRegeneration` 全仓库**无调用方**——仅有 `GenerateDraft` 内部用 `SourceDataVersion` 给草稿 metadata 打版本戳，没有「用版本比对来触发重新生成」的链路；且 `ScrapeJobFormDrawer` 成功提示注释声明「前往配置变更确认」跳转但**未实现**、配置确认页（`useConfigDrafts.ts`）也无调 `createDraft` 的入口。净效果：用户保存采集 Job / 改资源后，UI 上没有任何途径让变更单出现，超出 30s 也不会自动生成。
- **结论（联调落地）**：**方案 A 为主 + 吸收方案 B**。
  - 后端：新增 `ConfigChangeBaseline` 持久化检测基线（DB 派生，重启/首启不误判不误生成），`configcenter/change` 包提供 30s 轮询 goroutine（`--change-detect.interval` / `CONFIG_CHANGE_DETECT_INTERVAL_SECONDS`），单域裁决后复用 `GenerateDraft`；失败记 failed 可观测状态、不推进版本、下轮重试。
  - 前端：`ScrapeJobFormDrawer` 保存后提供「前往配置变更确认」跳转并 best-effort 即时触发一次 `createDraft`（保活保证不重复，仅即时性优化）。
- **是否需设计侧确认**：~~需在 PRD 明确「保存即时生成 vs 30s 轮询」的即时性表述~~ **已收割于 v1.50**（PRD §3.3.3 已明确「保存后即时触发 + 前往配置变更确认跳转」的即时性表述，与轮询双通道并存）；该条目定位为 MVP 欠账补足，非 v0.2 新功能。
- **影响模块**：后端（新增 watcher + 基线表）、前端（跳转动线）
- **发现场景**：M09 联调，新增采集 Job 后配置确认页仍为「当前无待确认变更」。

---

## 7. M09 实现口径修正（2026-08-25）

### F-13：活 pending 草稿被后续源变更取代（PRD §3.3.3 / 决策 42-1 实现口径修正）

- **类别**：② 实现偏差修正
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.3.3、决策 42-1；源码 `platform/configcenter/draft/service.go`
- **现状**：`GenerateDraft` 检测到同域已有 pending 草稿时直接幂等返回，导致新增/修改 job 后配置预览不更新，直到旧草稿被确认/废弃。
- **结论**：按 PRD「后单取代前单」修正——当前源数据产物 checksum 与旧 pending 不一致时，生成新 pending 并将旧单置 `discarded`，`metadata` 互记 `superseded_by_change_no` / `supersedes_change_no` 便于审计；checksum 相同时才幂等返回。
- **影响模块**：后端（`draft/service.go`、`models/config_center_rules.go`）
- **发现场景**：用户实测「新增 job1 生成预览后未确认，再新增 job2 预览不更新」。

### F-14：watcher 在 skipped_pending 分支不应推进基线（PRD §3.3.3）

- **类别**：② 实现偏差修正
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.3.3；源码 `platform/configcenter/change/watcher.go`
- **现状**：源数据推进但已有活 pending 时，watcher 跳过生成但把 `ConfigChangeBaseline.SourceVersion` 推进到了当前版本，导致确认旧草稿后 watcher 不再为积压变更补生成。
- **结论**：`skipped_pending` 状态仅更新检测状态与下次检测时间，不推进基线 `SourceVersion`。确认/废弃旧草稿后，源数据版本必然大于基线，下一轮检测自然生成新草稿（配合 F-13 的取代语义）。
- **影响模块**：后端（`change/watcher.go`）
- **发现场景**：M09 联调确认旧草稿后新 job 未自动出变更单。

### F-15：变更检测间隔自适应退避（PRD §3.3.3 更新建议）

- **类别**：① PRD 空白判定 / ③ 技术优化
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.3.3「30s 轮询」
- **现状**：固定 30s 间隔；单网域场景下用户感知延迟过长，多网域场景下持续空转。
- **建议**：将固定间隔改为「自适应退避」——最近源数据有活动时按短间隔（默认 5s）检测，持续无变化时指数退避至最大间隔（默认 120s）。保留环境变量 `CONFIG_CHANGE_DETECT_MIN_INTERVAL_SECONDS` / `CONFIG_CHANGE_DETECT_MAX_INTERVAL_SECONDS`（并兼容旧的 `CONFIG_CHANGE_DETECT_INTERVAL_SECONDS` 作为最大间隔）供运维调整。
- **影响模块**：后端（`change/watcher.go`、`models/config_change_baseline.go`、`cmd/metric-center/main.go`）
- **发现场景**：用户反馈单网域下 30s 轮询偏长，希望兼顾实时性与多网域资源开销。

### F-17：变更单废弃缺少源数据回写语义（PRD §3.5 / §8 空白，决策 43 系列）

- **类别**：① PRD 空白判定 / ② 实现偏差修正
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.5（下发）/ §8 ConfigDraft 状态机；源码 `platform/configcenter/draft/service.go` `DiscardDraft`
- **现状缺漏**：PRD 只定义了变更单「确认/废弃」按钮，**未定义废弃对源数据（ScrapeJob 等）的回写语义**。当前 `DiscardDraft` 仅把变更单置 `discarded`：不回写 job 的 `change_status`（pending 永久残留）、不处理 job 数据、不推进 watcher 基线——下一轮轮询会因「源版本 > 基线」重新生成内容相同的变更单，废弃等于无效操作。
- **结论（用户拍板，详见 design-decisions 决策 43-1~43-7）**：废弃必须伴随源数据处理（full-render 模型下「数据不动只废单」必然鬼影复现）——新建未生效 job 随单回退 `draft`；已生效 job 的修改 MVP 选「提示+复现」（2a），`deployed_snapshot` + 「随单回滚」备注 v0.3；删除/停用型自动恢复；`change_status` 统一回写不允许 pending 残留；废弃弹窗分类知情告知。job 表不引入 rejected/discarded 终态，废弃审计历史归 M09 变更单承载。
- **实现落库**：
  - 后端 `platform/configcenter/draft/service.go`：新增 `DiscardImpact` 结构、`GetDiscardImpact` / `computeDiscardImpact`、从生效版本 `prometheus.yml` 解析 `job_name` 的辅助函数；`DiscardDraft` 返回 `(draft, impact)`，事务内完成分类回写（新建回 draft / 已生效修改保留并清除 pending / 已生效删除·停用·草稿化自动恢复）。MonitoringRule 的自动快照回滚按决策备注至 v0.3 `deployed_snapshot`。
  - 后端 `platform/configcenter/draft/handler.go`：新增 `GET /config-drafts/:change_no/discard-impact` 端点；`discard` 返回 `{draft, impact}`。
  - 后端单测：`platform/configcenter/draft/draft_test.go` 覆盖分类回写、首次部署回退、discard-impact HTTP 端点。
  - 前端 `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`：废弃前先调 `discardImpact`，Modal 按 `new_reverted / modified_kept / deleted_restored / missing` 分类展示后再确认。
- **是否需设计侧确认**：~~需——PRD §3.5 / §8 需补废弃回写语义~~ **已收割于 v1.50**（PRD §3.5 / §8 已按决策 43 系列补废弃回写语义 + 废弃弹窗分类知情告知）；M01 PRD §5.4 `draft_status` 单向流转「系统随单回退例外」注记由 M01 design 侧收割；v0.3 规划需收割 `deployed_snapshot` 长期项（见 design-decisions 43-4 长期备注）。
- **影响模块**：后端（`draft/service.go` DiscardDraft 重构 + 单测）、前端（废弃确认弹窗分类告知）
- **发现场景**：用户讨论方案 C 时追问「pending 变更单被驳回后 job 状态是什么」，并明确产品原则「采集 job 不做日志记录，只保留干净的生效 job」。

### F-18：校验失败态变更单废弃报 404（未能复现，已补端到端单测）

- **类别**：② 实现偏差 / 待复现
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.5 变更单废弃；源码 `platform/configcenter/draft/service.go` `DiscardDraft`、`platform/configcenter/draft/handler.go`
- **问题**：用户反馈当变更单 `validation_status=failed` 时，点击「废弃变更」按钮报 404。
- **代码层面核查**：
  - 后端 `DiscardDraft` 仅校验 `status == pending`，不拒绝 `validation_status=failed` 的草稿；
  - 404 只可能来自 `GetDraftDetail` 找不到记录（`change_no` 不存在或已被取代）。
- **已补测试**：
  - `platform/configcenter/draft/draft_test.go` 新增 `TestDraftHandlerDiscardValidationFailed`：直接写入 `status=pending, validation_status=failed` 的草稿，断言 `GET /config-drafts/:change_no/discard-impact` 与 `POST /config-drafts/:change_no/discard` 均返回 200，且草稿最终状态为 `discarded`。测试通过。
  - `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.test.tsx` 新增「校验失败态草稿仍可废弃」用例，覆盖前端弹窗路径。测试通过。
- **当前结论**：当前代码与测试均无法复现 404；用户现场若仍复现，最可能原因是旧构建/前后端版本不一致、或请求时 `change_no` 已被后单取代/删除。
- **待用户补充**：~~浏览器 Network 面板截图或后端 `DiscardDraft` 日志，以进一步定位~~ **已闭环（2026-09-05）**：用户确认当时系旧构建 / 前后端版本不一致，非代码缺陷；防护单测保留。


### F-19：pending 期间源数据锁定 / watcher 取代时机 / 空变更单抑制（决策 44 系列）

- **类别**：② 实现偏差修正 / ① PRD 空白判定
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.3.3 / §3.4；`Module_01_Metric_Collection_Center.md` §5.4；源码 `platform/configcenter/change/watcher.go`、`platform/configcenter/draft/service.go`、`platform/strategy/scrapejob/update.go`、`platform/strategy/scrapejob/delete.go`
- **问题（联调实测）**：
  1. job「待生效」时仍可编辑，保存报内部错误——pending 期间源数据可变动，变更单内容与现实脱节；
  2.「待生效」job 可删除，变更单不联动 → 幽灵单；
  3. 草稿态 job 触发 watcher 生成「配置无变化」的空变更单。
- **结论（用户拍板，决策 44-1~44-4）**：
  - pending 期间禁止编辑/启停/删除 job（后端 409 + 前端禁用 & Tooltip）；
  - watcher 遇活 pending 先比较产物 checksum：相同保持 `skipped_pending` 不推进基线（沿用 F-14），不同则生成新 pending 取代旧单，metadata 互记 supersede 关系，前端旧单详情页 Alert「已被新变更单取代」；
  - 抑制「配置无变化」空变更单（`ErrNoChanges`：watcher 推进基线不落库；手动触发生成返回 200 + `no_changes`）。
- **实现落库**：
  - 后端：`scrapejob/update.go` / `delete.go` pending 409 守卫；`draft/service.go` 新增 `ErrNoChanges`、`ShouldSupersedePending`；`draft/handler.go` `no_changes` 分支；`change/watcher.go` skipped_pending 分支改为 checksum 比较 + 取代。
  - 单测：`draft/service_test.go`（抑制 / checksum 比较 / 损坏 metadata）；`draft/draft_test.go`（存量用例补 ready job 种子）；`change/watcher_test.go`（checksum 相同跳过 / 不同取代 / 空变更抑制；修正种子 job 时间戳盖过 host 版本推进的问题）；`scrapejob/scrape_job_test.go`（pending 409 用例 + 存量用例种子改 `change_status=none`）。
  - 前端：`ScrapeJobListPage.tsx` pending 行禁用编辑/启停/删除 + Tooltip；`ConfigPreviewPage.tsx` 详情页 superseded_by Alert；对应测试用例各 1 个。
- **是否需设计侧确认**：~~需——M09 PRD §3.3.3 按「checksum 比较取代」修订（取代 F-14 的纯跳过描述）；§3.4 补空变更单抑制与 superseded_by 提示~~ **已收割于 v1.50**（M09 PRD §3.3.3 / §3.4 已按 checksum 取代 + 空变更抑制 + superseded_by 提示同步）；M01 PRD 补 pending 锁定语义——已同步（M01 PRD §5.4「pending 期锁定」）。
- **发现场景**：用户对「job 状态 / 生效状态 / 配置变更单」三者关系与数据流转的联调测试。

## 8. instance 校验口径与校验信息透传（2026-08-25，方案 A 落地）

- **类别**：② 实现偏差修正 / ① 空白判定（校验口径对齐）+ ③ 技术优化（vMsg 透传）
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.5.1（禁止覆盖 `__address__` 等内置标签）、`Module_07_Monitoring_Object_Management.md` §3.2 / §5.12C / §5.13（组合字段 `instance_ip:port → instance` 为默认模板内置映射、`instance` 为采集目标身份标识）；源码 `platform/configcenter/generator/validate.go` `validateLabelName`、`platform/models/label_rules.go`、`platform/config/label/mappings.go`
- **问题定性**：默认模板生成 `instance` 标签（PRD M07 §5.12C 标准映射），但 M09 产物校验器 `validateLabelName` 无条件复用 `IsProtectedLabel` 拒绝 `instance`，导致系统默认模板的合法产物被自身校验器打回。M07 映射层 `mappings.go` 已实现 `composite→instance` 例外（设计决策 3.4），M09 校验器未同步该例外——同型缺口（决策 3.26 已有一次）。
- **结论（决策）**：**方案 A**——
  1. `validateLabelName` 对 `instance` 放行（`instance` 是 Prometheus 约定标签，`static_configs[].labels` 中为标准用法，且 PRD M09 §3.5.1 仅禁 `__address__` 等 `__` 前缀保留标签）；`job`/`scheme`/`__*` 仍拦截。PRD 无需改动。
  2. **vMsg 透传**：`ConfigDraft` 新增 `validation_message` 持久化字段（生成 / supersede 取代 / revalidate 时写入），契约 detail 与 revalidate 失败响应均回传具体校验信息，替代「draft validation still failed」无具象文案。
- **实现落库**：
  - 后端：`generator/validate.go` `validateLabelName` 放行 `instance`；`models/config.go` `ConfigDraft` 加 `ValidationMessage`；`draft/service.go` `GenerateDraft` / supersede 建单置 `ValidationMessage`，`RevalidateDraft` 持久化并 `fmt.Errorf("%w: %s", ErrValidationStillFailed, vMsg)` 透出。
  - 后端单测：`generator/validate_test.go` 放行 `instance`、仍拦 `job` 用例；`draft` 增加校验信息落库/透传用例。
  - 前端：`types/config-center.ts` `ConfigDraft` 加 `validation_message?`；`ConfigPreviewPage.tsx` 详情页在 failed 时展示校验信息。
- **影响模块**：后端（validate.go / models / draft service）、前端（详情展示）
- **发现场景**：用户实测配置中心「重校验」报 400 且无具体错误；深度核实 `instance` 默认模板与校验器口径冲突。

## 9. pending 态无操作出口 + 校验失败归因缺失（2026-08-25，决策 45 系列）

- **类别**：② 实现偏差修正（pending 态按钮逻辑）+ ③ 技术优化与原型对齐（validation_cause / validation_details）
- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.5.1（`ValidationStatus` 三态：passed 可确认 / failed 阻止确认 / pending 未校验或生成中）；原型 `docs/prototypes/module-09/src/pages/ConfigPreviewPage.tsx`（v1.39 决策 39-1/39-3 的 `validation_cause` / `validation_details` 归因 UI）；源码 `ui-custom/web/src/pages/config-center/preview/ConfigPreviewPage.tsx`
- **问题 1（pending 态无操作出口）**：当前详情抽屉操作区按钮逻辑用 `validationFailed = status === 'failed'` 硬编码：
  - `pending` 态「确认发布」**未禁用**（违反 §3.5.1 三态语义——promtool 不可用等未校验态不应可发布）；
  - `pending` 态**不展示「重新校验」**（promtool 不可用的 pending 态依赖重校来自愈，却没有入口）。
- **问题 2（校验失败归因缺失）**：原型已定义 `validation_cause`（`user_config`=用户配置问题，可修复并展示「重新校验+前往修改」/ `platform_fault`=平台技术故障，自动重试、不展示「重新校验」）与 `validation_details`（`[{file,line,message}]` 结构化定位 + 行内 Popover + 跳转 M01），当前实现均未落地，`failed` 与 `pending` 无法在 UI 区分，用户拿到的是无操作指向的错误文案。
  - **45-3 修订（2026-08-26）**：`platform_fault` 亦展示「重新校验」手动自愈出口（后端自动重试未落地，隐藏按钮会死锁）——**已收割于 v1.50**（原型失败详情 Popover 补「重新校验」按钮，行内按钮对所有 `failed` 归因展示）。
- **结论（决策 45 系列，详见 design-decisions.md）**：
  1. 操作区三态语义按 `ValidationStatus !== 'passed'` 判定可靠出口：`passed`→可「确认发布」；`failed`/`pending`→禁「确认发布」、给「重新校验 + 废弃」；
  2. 校验信息 Alert 按 status 分色：`failed`→error、`pending`→warning（promtool 不可用属待环境就绪，非失败）；
  3. 后端补 `validation_cause` / `validation_details` 归因字段，契约与前端展示对齐原型（MVP 落 `user_config` 判定：targets schema 类失败归 user_config，promtool/blackbox 不可用归平台故障）。
- **实现落库**：M09 前端操作区 Predicate 修正 + Alert 分色；后端 `ConfigDraft` 增 `validation_cause` / `validation_details`，`ValidateArtifacts` 返回归因；前端类型/详情/列表展示对齐。
- **影响模块**：后端（draft/generator）、前端（ConfigPreviewPage.tsx、config-center.ts）
- **发现场景**：方案 A 修复后 `instance` 不再误拦，重校验回到 `pending`，但详情页 pending 态「无操作按钮」且只剩无归因的错误 Tag。

## 10. target 抓取地址缺 exporter 端口（2026-08-26，决策 46）

- **类别**：② 实现偏差修正（target 端口语义错误）
- **PRD 章节 / 文件位置**：`Module_07_Monitoring_Object_Management.md` §5.12C（target/instance 端口取 `CITypeExporterMapping.default_port`，对 `selected_instance_ids` 逐个拼接 `instance_ip:default_port`）；`Module_01` §5.1 端口一致性说明；源码 `platform/configcenter/generator/targets.go`、`data_source.go`、`draft/service.go`
- **问题（联调实测）**：Host 类采集 Job 生成 targets 为 `["1.15.94.116"]`（无端口），Prometheus 默认 80 端口抓取报 `connection refused`；node_exporter 实际监听 9100。Database/Middleware 分支虽拼端口，但用的是**资源业务端口**（3306/6379）而非 exporter 监听端口（9104/9121），同样违反 §5.12C。
- **根因**：`resolveResource` 未感知采集策略层端口；Host 分支只取 `PrivateIP`，Database/Middleware 分支取资源业务端口；`ScrapeJob` 无 port 字段、生成器也未解析映射/采集器 default_port。
- **结论（决策 46，用户拍板最小方案）**：新增 `generator.LoadExporterPort`——优先 `CITypeExporterMapping.default_port`（monitor_type 默认映射），回落 `ExporterTemplate.default_port`（exporter_template_id）；`resolveResource` 对 Host/Database/Middleware 统一拼接 exporter 端口（Database/Middleware 在 exporter 端口为 0 时回落业务端口）；Application（健康检查 URL）/ GenericTarget（登记服务端口）不变；`instance` 组合标签随地址自动带端口。
- **实现落库**：`generator/targets.go`（`exporterPortOr` / `resolveResource` 签名 + 端口拼接）、`generator/data_source.go`（`LoadExporterPort`）、`draft/service.go`（buildArtifacts 传 exporterPort）；单测 `TestResolveTargetsExporterPort` / `TestLoadExporterPortPriority`，存量 host 断言改为带端口。
- **是否需设计侧确认**：~~需——PRD M01 §5.4 统一「端口是否进 ScrapeJob 字段 / mapping_overrides」口径（当前 416 行与字段表冲突，已列 M01 F-20）~~ **已收割于 v1.50**（M01 PRD §5.4「端口不在 Job 层的理由」已按决策 46 统一：MVP 端口**不进 `ScrapeJob` 快照**、`mapping_overrides` 亦**不含 `port`**，由 M09 生成器按 `CITypeExporterMapping.default_port` → 回落 `ExporterTemplate.default_port` 解析，见 M01 dev-feedback F-20 收割注记）；v0.2+ 若做 Job 级端口快照则补 `ScrapeJob.port` 与前端表单端口输入——仍待 v0.2+ 评估。
- **影响模块**：M09 配置生成、M01 采集 Job（端口快照规划）、M07 §5.12C（已按 default_port 对齐）
- **发现场景**：用户对「配置生成 targets 与实例实际 exporter 端口」一致性的联调测试。

## 收割状态

> **2026-08-26 已收割于 v1.50**（design 分支 `design/module-mvp-demo`）：design 侧已按本轮一次性收割——M09 PRD 正文同步实现口径（**版本号保持 v1.50 不动**，Change Log 追加 v1.50 同步概括行），原型 `ConfigPreviewPage.tsx` 同步「废弃分类告知 Modal（决策 43）+ platform_fault 手动重校（决策 45-3 修订）」；验证：原型 `tsc` / `eslint` / `vitest` / `check-prototype` 通过。

- [x] F-13 已修正（后单取代前单 + supersede 审计字段）
- [x] F-14 已修正（skipped_pending 不推进基线）
- [x] F-15 已修正/实现（自适应退避已落库 + 启动参数）—— **已收割于 v1.50**（PRD §3.3.3 已按自适应退避 min 5s / max 120s + `--change-detect.min/max-interval` 可覆盖同步）
- [x] F-17 已修正/实现（DiscardDraft 分类回写 + 废弃弹窗分类告知）—— **已收割于 v1.50**（PRD §3.5 / §8 已按决策 43 系列补废弃回写语义；M01 PRD §5.4「系统随单回退例外」由 M01 design 侧收割）
- [x] F-18 已闭环（2026-09-05 用户确认：当时 404 系旧构建 / 前后端版本不一致所致；前后端「校验失败态可正常废弃」防护单测保留，本条关闭）
- [x] F-19 已修正/实现（决策 44 系列）—— **已收割于 v1.50**（M09 PRD §3.3.3 改「checksum 比较取代」、§3.4 补空变更单抑制与 superseded_by 提示；M01 PRD §5.4「pending 期锁定」已同步）
- [x] §6 自动变更检测（30s 轮询 + 保存后跳转）—— **已收割于 v1.50**（PRD §3.3.3 已补「保存后即时触发 + 前往配置变更确认跳转」即时性表述）
- [x] §8 instance 放行 + vMsg 透传 已修正/实现（方案 A；PRD 无需改动）
- [x] §5 禁用网域↔纳管联动口径 —— **已决策**（2026-09-05 chenrt 拍板：MVP 保持现状（口径②：禁用仅行政停用、`IsMonitored` 与 Token 保留）；口径①「禁用联动取消纳管并冻结 Token」纳入 v0.2 多网域版本实现并届时评审；PRD §1 v1.57 注记 + design-decisions 决策 62 已落档）
- [x] §9 pending 态操作出口 + 校验归因 已修正（决策 45 系列）—— **已收割于 v1.50**（PRD §3.5.1 补三态操作出口与 `validation_cause`/`validation_details` 归因；原型 platform_fault 手动重校同步）
  - [x] 45-1 操作区三态语义修正（非 passed 禁用确认，pending 也给出重新校验+废弃）
  - [x] 45-2 校验信息 Alert 分色（failed→error / pending→warning）
  - [x] 45-3 validation_cause / validation_details 归因字段（后端 + 契约 + 前端展示）
  - [x] 45-3 修订（2026-08-26）：platform_fault 也展示「重新校验」手动自愈出口（后端自动重试未落地，隐藏按钮会死锁；见 design-decisions.md 45-3 修订注记）—— **已收割于 v1.50**（原型失败详情 Popover 补「重新校验」按钮）
  - [ ] 45-4 M07 源数据输入层静态校验（单独列 M07 前端任务，本轮不涉及 M09）
- [x] §10 target 缺 exporter 端口（决策 46）—— **已收割于 v1.50**（M01 PRD §5.4「端口不在 Job 层的理由」已按决策 46 统一：MVP 端口**不进 `ScrapeJob` 快照**、`mapping_overrides` 不含 `port`，由 M09 生成器按 `CITypeExporterMapping.default_port` → 回落 `ExporterTemplate.default_port` 解析；Job 级端口快照留待 v0.2+ 评估，见 M01 dev-feedback F-20）

## 2026-08-26（M01/M09 联调：变更清单未按产物 diff 派生 + 规则挂载默认启用）

### F-21：禁用已生效 Job 后变更清单仍显示「本次无配置变更」（② 实现偏差，已修正）

- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.4（变更类型：新增/修改/移除，按产物差异派生）、§8（删除目标/告警规则变更=high）；源码 `platform/configcenter/draft/service.go`（原 `buildChangeItems`）、`platform/configcenter/draft/change_items.go`（新增）
- **问题（用户验收）**：在 Job 列表点击「停用」后，配置变更确认页摘要显示「本次配置无变化 / 无实际内容变化」，但「版本对比」Tab 能真实看到 scrape_config 被删除——两者自相矛盾，引发用户误解。
- **根因**：原 `buildChangeItems` 不做新旧产物 diff，只罗列当前仍启用的 Job/规则并全部写死标为「新增」；被禁用 Job 已被 `LoadJobs` 过滤，永远不会以「移除」出现在清单中。禁用唯一 Job 时清单为空 → `buildSummary` 返回「本次无配置变更」。
- **结论（PRD 无需改动）**：实现偏差，已修正。
  - 新增 `change_items.go`：按「上一已确认 ConfigVersion 产物 vs 本次草稿产物」diff 派生 add/update/delete；生效版本中存在但本次产物已摘除的 Job → delete/high「移除采集 Job（监控断点风险）」；规则按 group name diff，变更即 high。
  - `GenerateDraft` 前置 `lastConfirmedVersion` 作为 diff 基线；清单为空即 `ErrNoChanges`（抑制空跑噪声）。
  - 前端 `ScrapeJobListPage` 启停改为有文字按钮 + Popconfirm 二次确认，停用提示监控中断影响。
- **是否需设计侧确认**：否，PRD 口径已明确（§3.4/§8）。
- **影响模块**：M09 变更清单生成、M01 Job 列表启停交互。
- **发现场景**：用户禁用采集 Job 后查看配置变更确认页。

### F-22：规则挂载「保存并下发」后规则状态显示「停用」（② 实现偏差，已修正）

- **PRD 章节 / 文件位置**：`Module_01_Metric_Collection_Center.md` §5.5（`enabled=false` 规则从生成中摘除）、§8（创建默认启用）；源码 `platform/strategy/rule/create.go`、`ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`
- **问题（用户验收）**：规则挂载抽屉点击「保存并下发」后，规则列表显示「停用」，与「创建默认启用」及采集 Job 默认启用口径不一致。
- **根因**：前端创建请求漏传 `enabled`；后端 `CreateMonitoringRuleRequest.Enabled` 为非指针 bool，零值 false 直接落库。
- **结论（PRD 无需改动）**：
  - 后端 `Enabled` 改为 `*bool`，缺省默认 `true`；
  - 前端请求显式传 `enabled: true`，按钮文案「保存并下发」改为「提交生效」（实际需 M09 人工确认后下发，名实相符）。
- **是否需设计侧确认**：否。
- **影响模块**：M01 规则管理、M09 变更单生成。
- **发现场景**：用户新增规则后返回列表查看生效状态。

### F-23：Prometheus 不加载告警规则——prometheus.yml 缺 rule_files 引用（② 实现偏差，已修正）

- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.2（配置产物：prometheus.yml + rules.yml）；`Module_01_Metric_Collection_Center.md` §5.5（规则生成与 rules.yml 组装）；源码 `platform/configcenter/generator/render.go`（`cfgFile` 结构 / `Assemble`）、`platform/configcenter/deployment/service.go`（`writeStructural` 同目录写盘）
- **问题（用户验收）**：触发 Job 变更并挂载 rules.yaml 后，在配置文件中心确认下发，Prometheus 成功获取 targets 与 job，但 Rules 模块仍显示 "No rules found"。
- **根因**：`render.go` 生成的 prometheus.yml 仅含 `global` / `scrape_configs`，**未注入 `rule_files`** 引用同目录下发的 `rules.yml`；Prometheus 仅在显式配置 `rule_files` 时才加载规则文件，故 rules.yml 虽已写盘（`deployment/service.go` `writeStructural` 与 prometheus.yml 同目录）却不被加载。
- **结论（PRD 无需改动）**：实现偏差，已修正。`cfgFile` 增 `RuleFiles []string` 字段，渲染时「有规则内容才注入 `rule_files: ["rules.yml"]`，无规则不注入」——避免无规则时引用不存在的文件导致配置加载失败。
- **实现落库**：`generator/render.go`（`cfgFile.RuleFiles` + `Assemble` 注入逻辑）；单测 `TestAssembleRulesYAMLPassthrough` 增 rule_files 断言、新增 `TestAssembleRuleFilesOmittedWhenNoRules`。
- **是否需设计侧确认**：否。
- **影响模块**：M09 配置生成（prometheus.yml 产物）。
- **发现场景**：用户触发 Job 变更挂载 rules.yaml 下发后，查看 Prometheus Rules 模块发现 "No rules found"。

### F-24：promtool 校验误报——check config 缺 rules.yml 引用文件（② 实现偏差，已修正）

- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.2（配置产物：prometheus.yml + rules.yml）、§3.4（中心内容校验）；源码 `platform/configcenter/generator/validate.go`（`runPromtoolCheck` / `runToolChecks`）
- **问题（用户验收）**：新增规则文件后触发校验，配置变更确认报 `promtool check config 失败: Checking .../promcheck-*.yml FAILED: ".../T/rules.yml" does not point to an existing file`。
- **根因**：`runPromtoolCheck` 只把 `prometheus.yml` 写入临时文件就执行 `promtool check config`；F-23 修复后 `prometheus.yml` 通过 `rule_files: ["rules.yml"]`（相对路径）引用同目录规则文件，但校验临时目录中未写入 `rules.yml`（`file_sd` 引用的 `targets/*.json` 亦未写入），promtool 判定引用文件不存在而误报。属「生成器注入 rule_files 后，校验器未同步按真实下发目录结构落盘」的同型缺口（与 F-23 成对）。
- **结论（PRD 无需改动）**：实现偏差，已修正。`runPromtoolCheck` 改为接收 `*ConfigArtifacts`，按真实下发目录结构（与 `deployment.writeStructural` 一致）写入临时目录——`prometheus.yml` + `rules.yml` + `targets/*.json`——再执行 `promtool check config`；附带收益是 `rules.yml` 语法现在真正被 promtool 校验（此前仅逐条 YAML passthrough 拼接，未经 promtool 验证）。
- **实现落库**：`generator/validate.go`（`runPromtoolCheck` 签名改为 `*ConfigArtifacts` 并写齐被引用文件、`runToolChecks` / `toolCheckerFn` 同步改传 `*ConfigArtifacts`，新增 `path/filepath` 导入）；`generator/generator_test.go`（mock 签名同步）。
- **是否需设计侧确认**：否。
- **影响模块**：M09 配置校验（promtool 外部校验）。
- **发现场景**：用户新增规则文件后配置变更确认校验报 rules.yml 引用缺失；重编译重启后对失败草稿 `CHG-20260826-015` 重校通过（validation_status=passed）。
