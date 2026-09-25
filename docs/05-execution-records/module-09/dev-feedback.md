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
  - [x] **跟进（2026-09-15，决策 82）**：口径② **维持不变**（M06 禁用仍不改 M09 两状态，已固化为 PRD §9.2 {P0} 验收）；口径① 已**具象化为「退纳管」动作定义**并立项 v0.2（PRD v1.72 §3.1 新增行 + §8 新增 ⑤ 状态机 + §9.1 验收），同时补齐 Module_06 §6.2 长期许诺却未定义的契约悬空；MVP 阶段的「停止采集」出口由 M06 删除网域的**级联清退**覆盖（决策 82-1）。详见 module-09 design-decisions 决策 62 段落的「经决策 82 复核并推进」标注
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

## 2026-09-11（决策 68-2 收口：仅 alerting 段变化被 ErrNoChanges 抑制，无法重新下发）

### F-25：alerting 段不参与变更清单 diff——生成器升级后带 alerting 的 prometheus.yml 永远无法通过 M09 下发（② 实现偏差，已修正）

- **PRD 章节 / 文件位置**：`Module_09_Network_Domain_and_Edge_Config_Center.md` §3.4（变更清单按产物 diff 派生 / 决策 44-3 空变更单抑制）、§3.2（prometheus.yml 产物）；决策 68-2（`alerting` 段由 M09 生成器注入，`design-decisions.md`）；源码 `platform/configcenter/draft/change_items.go`（`buildChangeItems`）
- **问题（本机实测复现，2026-09-11）**：决策 68-2 落地后，本机最后一次配置下发（09-10 16:49）早于 alerting 段代码提交（17:27），线上 prometheus.yml 无 `alerting:` 段 → Prometheus `activeAlertmanagers=[]`，告警不投递。此时源数据（Job/规则/alertmanager.yml）均无变化，用真实 DB 拷贝实测 `GenerateDraft` 返回 `ErrNoChanges` —— **M09 流程死锁**：alerting 段虽已会生成，但没有任何入口能把它带下去。
- **根因**：`buildChangeItems` 的产物 diff 仅覆盖 scrape_configs+targets（`diffJobItems`）、rules.yml 组（`diffRuleItems`）、alertmanager.yml 内容（`diffAlertmanagerItems`）；`alerting` 段由生成器注入、不来自 M01/M08 源数据，不在任何 diff 范围内 → 「仅 alerting 段变化」时清单为空，被决策 44-3 的 `ErrNoChanges` 抑制。同型潜在盲区：`global.external_labels` 等生成器注入的前导段同样不参与 diff（本期不改，留观）。
- **结论（PRD 无需改动）**：实现偏差，已修正。`change_items.go` 新增 `snapshotAlerting` + `diffPromAlertingItems`（按 alerting 段规范化内容键序无关对比，实质变化才产出项）；models 新增变更对象枚举 `prom_alerting`（risk=high、affected_files=prometheus）；前端 `ChangeTarget` / `changeTargetLabel` 同步追加（UI 展示名「告警投递」）。
- **实现落库**：`platform/models/config_center_rules.go`（`ChangeItemTargetPromAlerting` + `ValidChangeItemTargets`）；`platform/configcenter/draft/change_items.go`（`snapshotAlerting` / `diffPromAlertingItems`，两分支接线）；`draft_test.go` 新增 `TestGenerateDraftAlertingSectionChangeItem`（基线无 alerting → 重新生成必须产出 prom_alerting 变更项，不得被 ErrNoChanges 抑制）；`ui-custom/web/src/types/config-center.ts` + `configCenterConstants.ts`。
- **验证**：真实 DB 拷贝（`/tmp/live_check.db`）跑 `GenerateDraft("default")`，修复前 `ErrNoChanges`、修复后产出草稿 CHG-20260911-001 且 prometheus.yml 含 `alerting:` 段；`go test ./platform/configcenter/... ./platform/models/` 全绿。
- **是否需设计侧确认**：否（属决策 68-2 的收口补丁，契约增量见 `api-contract-snapshot.md` §14）。
- **影响模块**：M09 变更单生成与下发；消费方：M09 配置变更确认页（变更清单 Tag 新增一类）。
- **发现场景**：M08 页面 Prometheus 触发告警显示 firing、但 Alertmanager 告警状态恒为空，排查发现 Prometheus 运行时配置无 `alerting:` 段且 M09 无法重新生成变更单。

---

## 2026-09-17（M06 网域改造配合——用户反馈两点，纯前端修复）

### F-26：网域详情抽屉缺少「采集节点的情况」区块（① 空白 / 信息缺口，已实现）

- **PRD 章节 / 文件位置**：Module_09 PRD §11.1 网域纳管页详情；原型 `docs/prototypes/module-09/` 网域纳管详情；源码 `ui-custom/web/src/pages/config-center/domains/NetworkDomainDetailDrawer.tsx`
- **问题（用户反馈）**：网域「查看详情」里只有一行聚合「采集节点在线」，缺少该网域采集节点的具体情况展示。
- **结论（MVP 现有字段即可，PM 已确认）**：不做后端聚合字段（M06 list / NetworkDomain 现有字段不含节点计数）。详情抽屉新增独立「采集节点情况」Descriptions 区块（4 行）：采集节点在线（agent_pull 展示 / local 恒 `-`）、采集节点版本、最近心跳（复用 `formatRelativeTime`）、采集节点数量（MVP 无聚合字段，`-` 占位 + 注记「节点列表与计数为 v0.2 采集节点状态页范围」）。仅用 NetworkDomain 现有字段（`monitored_status` / `last_heartbeat` / `agent_version`），纯前端。
- **实现落库**：`ui-custom/web/src/pages/config-center/domains/NetworkDomainDetailDrawer.tsx`（新增区块 + `formatRelativeTime` 导入）；`NetworkDomainDetailDrawer.test.tsx`（新增 2 条断言：agent_pull 版本/相对心跳/数量注记出现；local 区块恒 `-`）。
- **是否需设计侧确认**：否（前端信息补全区，MVP 字段可覆盖）。
- **影响模块**：M09 网域纳管详情抽屉。
- **发现场景**：用户配合 M06 网域改造检查 M09 网域纳管页（2026-09-17）。

### F-27：安装指引对齐「中心直连域 vs 采集节点域」双分支 + Edge Sync Agent v0.2 口径（③ 优化 / 文案漂移，已实现）

- **PRD 章节 / 文件位置**：Module_09 PRD §11 安装指引；Module_06 决策 9（接入进度按场景分支：中心直连域无监控节点动线 / 采集节点域需装 Agent）；源码 `ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`（顶部 Collapse 安装指引）、`OnboardDomainDrawer.tsx`（底部提示）
- **问题（用户反馈）**：顶部「安装指引」仍按单一动线描述，未区分「中心直连域（default/local，无安装）」与「采集节点域（agent_pull，需装代理）」；且 Edge Sync Agent 交付物为 v0.2（MVP 未实现），旧文案让用户误以为 MVP 即可下载安装。
- **结论（PM 已确认对齐决策 9 分支 + edge-agent 现状）**：安装指引改为双分支——顶部 success Alert 明示「中心直连域无需部署代理、平台直接采集，可跳过」；下方为「采集节点域」4 步动线（下载安装包 → 解压部署 → 启动/守护 → 心跳回连），并明确标注「Edge Sync Agent 交付物为 v0.2，当前 MVP 仅展示接入动线，安装包另待发布」；OnboardDomainDrawer 底部 agent_pull 分支同步补同一 v0.2 口径。纯前端文案 + 步骤调整。
- **实现落库**：`ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`（新增 Alert + 重构 Steps 4 步 + v0.2 注记）、`OnboardDomainDrawer.tsx`（文案补 v0.2）。测试：`NetworkDomainsPage.test.tsx` 通过（未新增断言，文案渲染无逻辑分支变化）。
- **是否需设计侧确认**：否（文案口径对齐既有决策，无规格变更）。
- **影响模块**：M09 网域纳管页安装指引 + 纳管抽屉文案。
- **发现场景**：用户配合 M06 网域改造检查 M09 安装指引（2026-09-17）。

---

## 2026-09-24（网域纳管：通道展示错位 + token/下载入口体验）

### F-28：网域创建 Channel 硬编码 local，未按 domain_type 预置 → 未纳管边缘域被误判为 local 通道（② 实现偏差）

- **类别**：② 实现偏差修正
- **PRD 章节 / 文件位置**：Module_09 §3.1（下发通道语义：management↔local 中心直连 / edge↔agent_pull 采集节点）；源码 `platform/admin/networkdomain/create.go`（L137 `Channel: models.ChannelTypeLocal`）、`platform/configcenter/domain/service.go` `MonitorDomain`（L83 按 `id==default` 判 local / 否则 agent_pull）、前端 `ui-custom/web/src/pages/config-center/domains/OnboardDomainDrawer.tsx`（L44 `isLocal = domain?.channel === 'local'`）、`NetworkDomainsPage.tsx`（L134 `onboardDomain.channel === 'agent_pull'` 才弹 token Modal）
- **现状（根因）**：`Channel` 是独立持久化字段，M06 创建网域时**无条件硬编码 `local`**（不看 `domain_type`）；后端纳管时却按 `id == default` 分派（default→local、其余→agent_pull）；前端抽屉分支依据是 **`channel` 字段值**。三处基准不一致。
- **问题（截图 3/4 实测，`test-a` 域 domain_type=edge 但 channel=local）**：未纳管边缘域被前端误判为 local，连锁出现——
  1. 详情抽屉「域类型=边缘域」+「下发通道=local」自相矛盾；
  2. 纳管抽屉展示「default 网域固定 local 通道…无需 Token / 安装指引」错位文案；
  3. 纳管提交 `isLocal=true` → `remote_write_url` 置 `undefined` 不传；
  4. `handleMonitorSubmit` 判定 `channel==='agent_pull'` 不成立 → **后端已签发 token 但前端不弹 `PlainTokenModal`**，用户看不到也复制不到 token（与用户「安装无 token 环节」反馈互为印证）。
- **结论 / 解决措施**：`channel` 本质是 `domain_type` 的派生字段（MVP 固定映射 management↔local / edge↔agent_pull）。二选一，**推荐方案 A**：
  - **A（数据源修正）**：`create.go` 创建网域时按 `domain_type` 预置 channel（management→local、edge→agent_pull）；存量脏数据（`test-a`、`测试` 等 channel=local 但 domain_type=edge）一次性迁移。
  - B（前端判断修正）：前端 `isLocal` 改用 `domain_type`（`IsManagement()`）而非 `channel`，`handleMonitorSubmit` 同步按 `domain_type` 判 token 弹窗。
  - A 优：列表/详情/纳管/后端四处口径一次统一，无需各消费方各自兜底。
- **影响模块**：后端（`create.go` + 存量迁移）、前端（`OnboardDomainDrawer` / `NetworkDomainsPage` / `NetworkDomainDetailDrawer` 渠道展示已自动跟随正确值）
- **发现场景**：用户核对 test-a（边缘域）网域详情与纳管抽屉，发现「下发通道=local」与「域类型=边缘域」矛盾（2026-09-24）
- **处置（2026-09-24 已实现，方案 A，分支 `feat/module-09-config-center`）**：

  1. **单一事实来源**：`platform/models/network_domain.go` 新增 `ChannelForDomainType(dt)`（管理域→local、边缘域/未知→agent_pull），作为通道口径唯一派生点；注释明确「未知域类型不得落回 local」（历史 bug 正错在此）。
  2. **登记接口修正**：`platform/admin/networkdomain/create.go` 的 `Channel` 由硬编码 `ChannelTypeLocal` 改为 `models.ChannelForDomainType(req.DomainType)`（该接口只收边缘域，故恒为 agent_pull）。
  3. **存量回填（幂等）**：新增 `platform/db/seed/domain_channel.go` 的 `runDomainChannelBackfill`，在 `seed.Run` 中于 `runTenantAndDomain` 之后执行；按 `domain_type` 双向对齐（edge→agent_pull、management→local），仅命中不一致行，`domain_type` 为空的兼容 / 历史记录不动。
  4. **纳管口径统一**：`platform/configcenter/domain/service.go` 的 `MonitorDomain` 分支依据由 `id == DefaultDomainID` 改为 `dom.IsManagement()`，通道赋值改走 `ChannelForDomainType`；包注释同步更新。`ten_domain.go` 的 default 域预置值改走同一 helper。
  5. **前端零改动**：`OnboardDomainDrawer` / `NetworkDomainsPage` / `NetworkDomainDetailDrawer` 的 `channel === 'local' | 'agent_pull'` 分支全部 key 在 `channel`，通道值修正后自动对齐（`remote_write_url` 会正常随 `agent_pull` 提交、纳管成功会正常弹 `PlainTokenModal`），符合方案 A「无需各消费方各自兜底」的预期。
  6. **测试**：新增 `models` 的 `TestChannelForDomainType`（含未知类型不落回 local）、`seed` 的 3 个回填用例（正向对齐 / 反向对齐 / `domain_type` 为空不动 + 幂等）、`configcenter/domain` 的 `TestMonitorDomainManagementNonDefaultIDForcesLocal`、`admin/networkdomain` 的 `create_test.go` 补 channel 断言。
  7. **验证**：`go vet ./platform/...` 通过；全量 `go test ./platform/...` 全绿；`make check-repo-map` 通过（已重新生成 `repo-map.md`）。
  8. **生效方式**：控制面重启后 `seed.Run` 自动回填存量网域；此后新登记网域即刻带正确通道，无需人工干预。

### F-29：网域纳管页下载入口隐蔽，列表无显性下载按钮（③ 技术优化/体验）

- **类别**：③ 技术优化
- **PRD 章节 / 文件位置**：Module_09 §11 安装指引；源码 `ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`（L96 `guideOpen` 默认 false、`<EdgePackageDownloadPanel active={guideOpen} />`）、`EdgePackageDownloadPanel.tsx`（T11-22 已实连 `/edge-packages` + 真实下载）
- **现状**：下载功能**已真实实现**（T11-22 实连，非 v0.2 占位），但挂载在页面顶部「安装指引」折叠区内部，`active={guideOpen}` 懒加载 + `guideOpen` 默认收起，需手动展开 → 滚动到底部才显示「离线安装包 → 下载安装包」按钮。用户（负责人）感知为「没有下载按钮」。
- **结论 / 解决措施**：下载入口显性化——列表页工具栏加「下载安装包」主按钮（或对 agent_pull 网域行内提供）；折叠指引内保留当前下载清单，二者共用同一 `EdgePackageDownloadPanel`。
- **影响模块**：前端 `NetworkDomainsPage.tsx`
- **发现场景**：用户按安装指引找不下载按钮（2026-09-24）
- **处置（2026-09-24 已实现，分支 `feat/module-09-config-center`）**：

  1. **工具栏显性化**：`NetworkDomainsPage.tsx` 的 `<Card title="网域纳管">` 增加 `extra` 主按钮「下载安装包」（`type="primary"` + `DownloadOutlined`），点击打开「离线安装包下载」Modal（`footer={null}`、`width={640}`、`destroyOnHidden`），内嵌 `<EdgePackageDownloadPanel active={downloadOpen} />`。
  2. **共用同一组件**：折叠指引内原 `<EdgePackageDownloadPanel active={guideOpen} />` 保持不动；两处共用同一面板组件、同一份版本清单，各自的 `active` 跟随所属容器开合，关闭时不发请求（面板内已有懒加载守卫）。
  3. **测试**：`NetworkDomainsPage.test.tsx` 新增「工具栏『下载安装包』→ 点击后渲染面板（点击前不渲染）」用例。
- **后续调整（2026-09-24，用户复测后裁决，**取代**上条第 1、2 项的工具栏方案）**：用户实测后指出两处动线错配——① 「中心直连域无需部署代理」这句提示被放在**默认收起**的安装指引**内部**，而页面级主按钮却对**所有网域**显眼，信息与入口的可见性正好反了：直连域用户要么白点一次指引、要么被顶部按钮引导去下载用不上的包；② 下载入口不该做在页面最上方。据此调整为「提示前置 + 行内按需」：

  1. **提示前置**：原折叠区**内**的 `Alert`（「中心直连域（如 default / local 通道）无需部署代理，平台直接采集，可跳过下方采集节点安装步骤」）**移出**折叠区，常驻在折叠面板**之上**，文案改为「中心直连域（如 default / local 通道）：无需部署采集节点，平台直接采集；仅登记新增的边缘域需要安装采集节点。」——直连域用户无需展开任何折叠区即可确认自己不用操作。
  2. **折叠标题限定为边缘域**：「新网域接入操作流程（安装指引）」→「边缘域接入操作流程（安装指引）」，副标题「点击展开（中心直接采集的网域无需查看）」→「点击展开」；消除直连域用户因标题错配点进来的可能。折叠区内原 `Alert` 删除，改为一句引导段「边缘域（agent_pull）需部署 Edge Sync Agent 才能回连平台，按下方步骤接入。」
  3. **下载入口改为行内按需**：移除 Card 顶部的「下载安装包」主按钮；改为**边缘域（agent_pull）行**的「更多」下拉内新增「下载安装包」菜单项（与「重置 Token」并列，「重置 Token」仍仅已纳管域出现）。中心直连域（local）行不出现任何下载入口；直连域-only 列表整页无下载入口（无边缘域即无需安装包）。
  4. **折叠指引内面板保留**：作为兜底入口（`active={guideOpen}`），与行内入口共用同一 `EdgePackageDownloadPanel` 与同一 Modal。
  5. **指引文案错位修正**：第 1 步原写「把 Token 填入 systemd 的 `TOKEN` 环境变量（**见下一步**）」——实际填 `Environment=` 是在第 4 步「启动 / 守护」，第 2 步是下载安装包，指向错误；已改为「（见下方『启动 / 守护』步骤）」。
  6. **测试**：`NetworkDomainsPage.test.tsx` 原「工具栏按钮 → 弹面板」用例改写为「边缘域行『更多 → 下载安装包』→ 弹面板」；新增「local 行不出现『更多』与任何下载入口」「常驻提示在折叠区外可见（折叠内容未渲染）+ 折叠标题已限定边缘域 + 旧标题不再出现」两个用例。
  7. **验证**：`pnpm vitest run src/pages/config-center/domains/` 4 文件 34 用例全绿；`pnpm lint` 零错误；`make repo-map` + `make check-repo-map` 通过。

### F-30：token 可用入口不足 + 指引缺「复制 Token」步骤 + 无「安全重新查看」出口（① 空白/③ 优化）

- **类别**：① 空白判定 + ③ 技术优化
- **PRD 章节 / 文件位置**：Module_09 §3.1（token 单次可见）、§11 安装指引 Steps；源码 `PlainTokenModal.tsx`（一次性展示）、`NetworkDomainsPage.tsx`（Steps 四步无 token、L259-270 凭据列只显脱敏无复制）
- **现状**：明文 token 仅「纳管（agent_pull）/ 重置」两处一次性弹窗；顶部指引 Steps（下载→解压→启动→回连）**无「复制 Token」步骤**；列表「凭据」列只显 `token_masked` 脱敏、无复制按钮；重新需要 token 只能「更多→重置 Token」，旧 token 立即失效。
- **结论 / 解决措施**：
  1. 安装指引 Steps 增补「复制 Token」步骤（明示 token 仅在纳管/重置时一次性展示，需立即复制保存）；
  2. 提供令牌「安全二次查看」出口（如二次确认后明文仅展示限时 / 复制到剪贴板），替代「只能重置」的单行道；
  3. token 相关提示用普通用户易懂语言（文案见下）。
- **用户易懂提示文案（供 UI Tooltip / 指引 / Modal 直接采用）**：

  > 出于安全考虑，网域的接入 Token 只在**第一次纳管成功**或**主动重置**时会完整显示一次，页面列表里只保留脱敏 Token（如 `ab****89`），无法再次查看原文。
  > 请务必在弹窗出现时立即复制并妥善保存 Token——它等同于该网域的「接入密码」。
  > 如果之后需要用到 Token（例如换机重装采集节点），却没有保存，可点击网域的「更多 → 重置 Token」重新生成；但需注意：**重置后旧 Token 立即失效**，已在运行的采集节点必须同步换成新 Token，否则会掉线。

- **影响模块**：前端 `NetworkDomainsPage.tsx`（Steps）、token Modal / 详情抽屉
- **发现场景**：用户重新部署收集节点时找不到 token 复制环节，且列表凭据列无复制按钮（2026-09-24）
- **用户裁决（2026-09-24，chenrt）**：**不做**第 2 条「安全二次查看出口」——明文 Token 严格保持「仅纳管 / 重置单次展示」，不新增任何可再次获取明文的接口或入口；**一切以 PRD 为准**。本条据此收敛为第 1、3 条执行。
- **处置（2026-09-24 已实现，分支 `feat/module-09-config-center`）**：

  1. **文案单一事实来源**：`configCenterConstants.ts` 新增导出常量 `TOKEN_USER_GUIDE`（完整指引，含三要素：原文仅纳管/重置显示一次 → 务必立即复制保存、等同该网域「接入密码」→ 忘了只能重置且旧 Token 立即失效、已装节点会掉线）与 `TOKEN_CREDENTIAL_TIP`（凭据列 Tooltip 精简版，口径一致）。
  2. **安装指引 Steps 增补**：`NetworkDomainsPage.tsx` 的 `<Steps>` 由 4 步扩为 5 步，「复制并保存接入 Token」置于**第 1 步**（描述 = `TOKEN_USER_GUIDE` + 部署时填入 systemd `TOKEN` 环境变量的提示）。
  3. **易懂文案落地三处**：Steps 第 1 步描述、凭据列 `Tooltip`（脱敏串为触发器）、`PlainTokenModal` 危险色提示；措辞全部改为普通用户语言，不含「决策 X」「PRD X.X」等实现层引用（遵 PRD 提示分区规范）。
  4. **安全行为不变**：未新增任何明文查看 / 导出入口，「列表行不提供复制明文」（HIGH-1）行为保持原样。
  5. **契约同步修正**：`api-contract-snapshot.md` §10 的 `NetworkDomain.token_masked` 行原写「完全脱敏 **+ 复制按钮**」，与该文件 §9「明文仅签发 / 重置单次返回」及实现 HIGH-1 冲突；已按「以 PRD 为准」的用户裁决修正为「完全脱敏，不提供复制明文（明文仅 `/monitor` 与 `/reset-token` 单次返回）」。
  6. **测试**：`NetworkDomainsPage.test.tsx` 新增「展开安装指引后含『复制并保存接入 Token』步骤 + 指引文案关键短语」用例；`PlainTokenModal.test.tsx` 断言同步更新为新文案。
  7. **验证**：`pnpm vitest run`（两个测试文件）18 用例全通过；`pnpm lint` 零错误；`make check-repo-map` OK。

---

## 2026-09-24（配置生成侧：空 targets 静默产出 → 边缘应用失败卡死）

### F-31：解析不出地址的实例被静默跳过 → 产出空 targets 文件，生成侧校验漏放行，边缘拒收导致配置永久卡死（② 实现偏差，2026-09-24 落档，2026-09-25 订正为已实现）

- **类别**：② 实现偏差（生成侧校验与边缘校验口径不对称）
- **现象**：边缘域采集节点「配置同步」列长期停留「同步中」（M11 dev-feedback F-17），中心侧主机采集 / 拨测采集在线数全为 0，而节点在线、边缘本地抓取正常。
- **根因（已实测证实；下列行号为 C 落地前快照，实现后已移位，现址见下方「实施说明」）**：
  1. **静默跳过**：[targets.go `resolveResource` L82-L98](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L82-L98) 对 application 取 `Address = application.HealthCheckURL`；当资源健康检查地址为空时，[`ResolveJobTargets` L161-L163](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L161-L163) `if rt.Address == "" { continue }` **静默跳过**（同样静默的还有 `rt == nil` 的 `resource_not_found`）→ 若该 Job 全部已选实例都被跳过 → 目标组为 0 → [render.go L123-L127](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/render.go#L123-L127) 落盘 `targets/<job>.json` 内容为 **`[]`**。
  2. **校验漏放**：[`ValidateTargetGroups`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L33-L50) 遍历 0 组即返回 nil → **空数组被判合法**；promtool 不校验 file_sd 内容 → 草稿 `passed`、可确认下发。
  3. **边缘拒收**：Agent [`ValidateTargetsJSON`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/edge-sync-agent/internal/deployer/extract.go#L83-L85) 对空数组报 `empty array` → `Deployer.Apply` 失败 + 回滚 → Agent 持续上报旧版本（v31 = `20260922-091425`）→ `config_deployments` #35/#36/#37 永久 `pending` → 中心判 `out_of_sync` + `pull_pending` → 前端「同步中」**永不自愈**。
- **定性**：**中心生成侧实现偏差**——生成侧放行了边缘必然拒收的产物，两侧校验口径不对称。边缘拒收空数组是**正确防御**，不属缺陷（**不做「放宽边缘校验」（方案 B）**）。
- **实测证据**：配置包解包 `targets/test-app-01.json` 内容为 `[]` 且 checksum 与 metadata 一致；源资源 `33a8dfc8-ee15-45bf-9e8c-f43cba0c5f43`（service_name=test1）`health_check_url` 为空；中心配置接口 200、metadata `remote_write_url` 正确（排除中心接口 / 隧道问题）。
- **方案（详见设计提案）**：C-1 `ResolveJobTargets` 增加跳过归因（`resource_not_found` / `address_empty` / `offline` 三类，精确到 `ResourceID` + 原因）；C-2 [`ValidateTargetGroups`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L40-L43) 增加零组判定（空数组非法，与边缘同口径）→ `ValidateArtifacts` 自然产出 `failed` + `cause=user_config` + 文件 / Job / 资源级 `validation_details`，前端配置确认页按既有 `validation_cause` 驱动自动禁用确认 + 「前往修改」，**前端零改动**。
- **落档（2026-09-24）**：`docs/05-execution-records/module-11/design-proposals/config-sync-stall-and-empty-targets-guard.md`（C-1 / C-2 已按提案原设计实施；提案头部状态已于 2026-09-25 订正为 `approved`，**仅 §6 的 PRD / 契约回写待设计条线**）。
- **决策落地（2026-09-25 订正：C 已实现，原「待确认 / 待实施」已过期）**：
  - **决策 ①（归因返回形式）**：按提案 §7 建议采纳「**新增第三返回值**」——[`ResolveJobTargets`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L178) 现签名为 `([]TargetGroup, []SkippedInstance, error)`，调用点仅 `buildArtifacts` 与测试，与提案评估一致。
  - **决策 ②（全部 offline 亦判 failed）**：按 chenrt 2026-09-24 裁决实施，**两类成因文案分离**——[`TargetDiagnostics.anyOfflineOnly`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/generator.go#L51) 判定归因构成，[`emptyTargetsMessage`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L228) 分别输出「实例全部下线」（引导移除该 Job 或恢复实例）与「地址解析不出」（引导补齐地址）。
- **实施说明（2026-09-25 复核）**：
  - **C-1**：[`targets.go`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L25-L30) 新增 `SkippedInstance`（`ResourceID` / `Category` / `Reason` / `Detail`）与三类 Reason 常量（`resource_not_found` / `address_empty` / `offline`），[三类跳过](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/targets.go#L196-L220) 全部记录归因；归因经 `JobBuild.Skipped` 传入 [`Assemble`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/render.go#L132-L140) 聚合为 `ConfigArtifacts.TargetDiagnostics`（`FileName` 与落盘 key 同源 `normalizeJobFilename`），由 [`buildArtifacts`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/draft/service.go#L207) 填充。
  - **C-2**：[`ValidateTargetGroups`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L40-L43) 增加零组判定（`targets 文件为空：未解析出任何有效采集目标`），与边缘 `ValidateTargetsJSON` 的 `empty array` 口径对称；[`ValidateArtifacts`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/validate.go#L150-L166) 的 targets 分支**置于 promtool 检查之前**，命中空数组 → `failed` + `user_config` + `Source=targets` 的 `validation_details`，文案按归因升级为 Job / 资源级（无归因路径如「重新校验」回落通用文案，**判定结果不依赖归因**）。前端零改动：既有「仅 `passed` 可确认下发 + `user_config` 展示『前往修改』」路径自动生效。
  - **实施口径澄清（与提案措辞的差异）**：空数组产物**仍会生成**（`Assemble` 对每个 Job 都落 `targets/<job>.json`，`[]` 亦然），治本点在**校验层不再放行**——草稿无法达到 `passed`、确认下发被阻断，即「缺陷配置到不了边缘」，而**不是**在生成阶段就不产出该文件。`TargetDiagnostics` 为非产物字段，不参与 checksum、不进 metadata（由测试守卫）。
- **测试（`generator_test.go`）**：[`TestValidateTargetGroupsRejectsEmpty`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/generator_test.go#L355)（空数组判非法，与边缘对称）、[`TestApplicationEmptyAddressGuarded`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/generator_test.go#L371)（application 地址为空 → `failed` + `user_config` + 资源级定位）、[`TestAllInstancesOfflineMessageDiffersFromAddressEmpty`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/generator_test.go#L427)（决策 ② 两类成因文案分离）、[`TestChecksumUnaffectedByTargetDiagnostics`](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/platform/configcenter/generator/generator_test.go#L498)（非产物字段不影响 checksum）。
- **验证（2026-09-25 复核）**：`go test ./platform/...` 全绿（含上述 4 例）、`go vet ./platform/...` 通过、`make check-repo-map` 通过。
- **影响模块**：后端 `platform/configcenter/generator`（`targets.go` / `validate.go` / `render.go` / `generator.go` 的 `ConfigArtifacts` 新增非产物归因字段）+ `platform/configcenter/draft`（`buildArtifacts` 填充归因）
- **发现场景**：2026-09-24 边缘域（腾讯云）采集节点配置同步卡死、在线数为 0 的线上故障定位
- **PRD 回写修订建议（供 design 条线合入 M09 PRD；实施已完成，仅余回写）**：§3.5.1 下发前校验需明确「targets 空数组非法」并与边缘拒收口径**对称**（消除两侧不对称）；§3.3 配置生成需明确「实例地址解析不出时不得**静默放行**空 targets，须以校验失败（`failed` + `user_config`）+ 资源级定位暴露」——措辞按实施口径修正（产物仍生成，治本点在生成侧校验不放行，见上方「实施口径澄清」）。

---

## 2026-09-24（前端：离线包下载面板永久转圈 → StrictMode 与一次性守卫冲突）

### F-32：`EdgePackageDownloadPanel` 在 StrictMode 下永久转圈，清单永不落地（② 实现偏差，2026-09-24，已修复）

- **类别**：② 实现偏差（React 18 StrictMode 双调用与 `useRef` 一次性守卫语义冲突）
- **现象（用户实测截图）**：M11 交付的两处入口——工具栏「下载安装包」打开的「离线安装包下载」Modal 内、以及折叠「安装指引」底部——**均永久显示 loading 转圈**，版本清单与下载按钮始终不出现。两处共用同一 `EdgePackageDownloadPanel`，故一同失效。
- **排查结论（先证伪两个初步猜测）**：用户初判为「包大所以加载慢」或「还没打包 edge agent」，**均不成立**——① `/edge-packages` 只回元数据，curl 实测 `HTTP 401 time=0.013139s`（13ms，接口不慢）；② 面板拉的是清单接口，与 64MB tar.gz 体积无关；③ 后端虽原为硬编码占位（见 M11 F-18），但**接口能正常返回**，不是「没有包」导致挂起。
- **根因**：面板用 `fetchedRef`（`useRef(false)`）做「只拉一次」的一次性守卫。React 18 `<React.StrictMode>`（[main.tsx L8/L14](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/main.tsx#L8-L14)）在开发态把 effect 跑成「执行 → 清理 → 再执行」两轮，而 `useRef.current` **在同一次挂载的两轮 effect 之间保持不变**：第 1 轮发请求后被清理函数置 `cancelled=true`（响应回来被丢弃、`setLoading(false)` 被跳过），第 2 轮因 `fetchedRef.current === true` **直接 return** → 再无人把 `loading` 落回 false，面板永久转圈。
- **定性**：前端实现偏差（懒加载守卫写法与 StrictMode 语义冲突）。生产构建（StrictMode 不双调用）不一定复现，但**开发态与测试态必现**，属真实缺陷而非环境噪声。
- **处置（2026-09-24 已实现）**：
  1. **去掉一次性守卫**：[EdgePackageDownloadPanel.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/domains/EdgePackageDownloadPanel.tsx) 删除 `useRef` 导入与 `fetchedRef`，`useEffect` 依赖改为 `[active]`——每次 `active` 由 false 转 true 都重新拉取，既修好 StrictMode 双调用，也顺带让「关闭 Modal 后再打开」能刷新清单（懒加载语义保持：`active=false` 时不发请求）。
  2. **保留 cancelled 标志**：清理函数仍置 `cancelled=true`，仅用于**避免组件卸载 / active 翻转后回写过期响应**，不再承担「只拉一次」职责。
  3. **lint 约定**：`setLoading(true)` 在 effect 内同步调用会命中 `react-hooks/set-state-in-effect`，按本模块既有约定加 block 级 disable + 理由注释（分页/懒加载面板的既定写法）。
  4. **StrictMode 回归用例**：[EdgePackageDownloadPanel.test.tsx](file:///Users/chenrt/S-03Python/03%20AIopsAgent-study/CNCF_Monitor-feature/ui-custom/web/src/pages/config-center/domains/EdgePackageDownloadPanel.test.tsx) 新增 `render(<React.StrictMode>...)` 用例，断言清单版本号渲染出来。**修复前实测该用例失败**（DOM 里只剩 `ant-spin-dot ant-spin-dot-spin`，`findByText('v1.2.0')` 超时），修复后通过——可作回归护栏。
  5. **下载文件名同步**：面板 `offlineFilename(pkg)` 改为优先取清单 `file` 字段（tarball 真实文件名带构建时间戳，无法由 version 推导），缺失时才回落 `edge-sync-agent-<version>-linux-amd64.tar.gz`；`EdgePackage` 类型补可选 `file?: string`。与 M11 F-18 的后端「清单新增 `file` 字段」配套。
- **影响模块**：前端 `ui-custom/web/src/pages/config-center/domains/EdgePackageDownloadPanel.tsx`（+ `src/types/config-center.ts`）
- **发现场景**：用户实测两处下载入口永久转圈（2026-09-24）
- **验证**：`pnpm vitest run`（`EdgePackageDownloadPanel` / `NetworkDomainsPage` / `PlainTokenModal` 三文件 27 用例）全绿；`pnpm lint` 零错误；`make repo-map` + `make check-repo-map` 通过。
- **备注**：该缺陷与 M11 F-18（后端清单占位改真包）是同一次用户实测暴露的**两个独立问题**——即便后端已接真包，只要面板守卫逻辑不改，前端仍会永久转圈。

### F-33：中心一体化交付包不支持安装期自定义端口（③ 交付可用性，2026-09-24，已实现）

- **发现场景**：用户在 edge agent 打包脚本上要求「安装脚本要指导用户怎么修改默认端口」，并追加「同理，现在中心控制节点的打包脚本中，也要允许用户安装的时候，自定义端口」。
- **原现状**：`env/env.sh.example` 已定义 `PROM_PORT` / `AM_PORT` / `BB_PORT` / `MC_PORT` / `AM_CLUSTER_PORT`，`start.sh` 也全部引用，**但 `install.sh` 只做 `cp env.sh.example → env.sh`**——安装期无任何参数可指定端口，运维只能装完再手工改文件；README 亦未给出端口自定义入口，端口冲突时只能事后排查。
- **处置（2026-09-24 已实现）**：
  1. **安装期参数**：`install.sh` 新增 `--mc-port` / `--prom-port` / `--am-port` / `--bb-port` / `--am-cluster-port`（与同名环境变量等价，优先级：命令行参数 > 环境变量 > 模板默认值），并支持 `-h/--help`；参数解析放在 root 校验**之前**，`--help` 无需提权即可查看。
  2. **写回 env.sh**：`port_assign` 用 sed 只替换对应 `export X=${X:-<n>}` 行的数字，**保留行尾注释**；未传参的端口不改写（不覆盖运维手工调整），仅打印生效值。
  3. **默认值单一来源**：端口默认值由 `port_default` 从 `env/env.sh.example` 解析，不在 `install.sh` 再写一份常量——沿用 M11 F-19「文档/默认值单一来源」的同一原则，避免两处漂移。
  4. **校验与冲突自检**：端口须为纯数字且 1–65535；五个端口两两比对，重复即报错并中止安装（端口冲突会导致后启动组件绑定失败）。
  5. **提示与文档**：SOP 提示改用生效端口（原来写死 `127.0.0.1:8080`），新增第 7 条「安装后如何改端口」；bundle README 新增「端口自定义」章节（生产安装 / 解压即用 / 装后调整三种入口 + 端口清单表 + 防火墙与采集节点 `CENTER_ENDPOINT`/remote write 联动提醒）；`env.sh.example` 注释补充「安装期可用 install.sh 参数指定」。
- **影响模块**：`scripts/package-center.sh`（生成物 `scripts/install.sh`、`env/env.sh.example`、`README.md`）。
- **验证（抽取生成物实测）**：不传参 → 列出模板默认值且 `env.sh` 字节级未被改写；`--mc-port 18080 --prom-port 19090` → 正确写回且注释保留；`MC=9090`（与 PROM 默认冲突）→ 冲突报错并 `exit 1`；非数字 `abc` / 越界 `70000` → 均中止；`--help` / 未知参数 / 缺端口值 → 输出正确；已存在 `env.sh` 在无参安装时不被覆盖。

### F-34：`$var` 紧跟全角字符时变量值被吞、中文残缺（② 实现缺陷，2026-09-24，已修复）

- **现象**：打包脚本控制台输出出现非法 UTF-8 —— 例如 `>>> ERROR: 缺少环境变量 ��必填）`（变量值 `TOKEN` 消失、`（` 前 1 字节缺失）。
- **根因**：`echo "…… $v（必填）"` 这类「`$var` 紧跟全角字符」的写法，bash 会把全角字符的**首字节并入变量名**解析，导致变量展开为空、且残留 2 字节非法序列。实测 `utf-8` 解码报 `invalid start byte`；改为 `${v}（必填）` 或 `$v （必填）`（加空格）即恢复正常。
- **定性**：仅影响控制台提示可读性（不改变控制流），但会让报错信息丢失关键变量（如缺哪个环境变量），属真实缺陷。
- **处置**：将 7 处写法统一改为 `${var}` 花括号形式——`scripts/package-edge-agent.sh` 2 处（缺二进制、缺必填环境变量），`scripts/package-center.sh` 5 处（端口配置行、写回告警、缺账户告警）。
- **验证**：修正后重跑抽取生成物，输出经 `python3` UTF-8 解码校验全部合法，变量值完整可见。

