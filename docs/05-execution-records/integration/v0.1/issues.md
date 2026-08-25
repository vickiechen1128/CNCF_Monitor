# integration/v0.1：联调问题与修复记录

## 记录格式

| 序号 | 问题描述 | 涉及模块 | 根因 | 修复方案 | 修复人 | 验证结果 | 状态 |
|------|----------|----------|------|----------|--------|----------|------|
| 1 | ResourceFormDrawer 测试全量运行时偶发失败 | M07 | 全量并行的 getComputedStyle/时序 flaky | 单独复跑通过，非本轮改动引入，不制度化重试 | frontend-developer | 单独复跑 11/11 通过 | closed |
| 2 | 配置变更单闭环缺失：前端保存采集 Job / 改资源后无任何途径让变更单出现 | M01/M09 | 后端 §3.3.3 30s 轮询未实现（NeedsRegeneration 无调用方）；前端未调 createDraft、未做「前往配置变更确认」跳转 | 后端落地方案 A（DB 基线 + 30s 轮询 goroutine，复用 GenerateDraft）；前端补保存后跳转 + 即时触发 createDraft（吸收方案 B） | backend-developer / frontend-developer | go test/vet + 前端 tsc/eslint/vitest 通过 | closed |
| 3 | NetworkDomainsPage 测试全量运行时偶发未处理错误：`guideRef.current?.scrollIntoView is not a function` | M09 | jsdom 未实现 scrollIntoView，全量并行下 setTimeout(200ms) 的 guideHighlight 时序暴露 | 在调用处加 `typeof guideRef.current?.scrollIntoView === 'function'` 防御；保持浏览器端平滑滚动行为不变 | frontend-developer（Orchestrator 协调） | 全量 `pnpm vitest run` 44/44 文件、310/310 用例通过，无 unhandled error | closed（已修复） |
| 4 | 配置变更单 pending 状态下新增 Job 不合并：job1 未确认时新增 job2，配置预览仍只显示 job1 | M09 | 原 GenerateDraft 对已有 pending 草稿仅做「保活」但不做变更合并，后增改动被吞掉 | 重构 `GenerateDraft`：检测到同域同通道存在 pending 时，先 reconcile 既有 pending 内容（后单取代前单），再生成新 diff；新增 `SupersedesChangeNo` 字段记录取代链 | backend-developer | `go test ./platform/configcenter/draft/...` 通过；端到端验证 pending 合并符合预期 | closed（已修复） |
| 5 | 配置检测轮询间隔固定 30s，单网域下响应过慢、多网域下可能过频 | M09 | watcher 使用固定 `--change-detect.interval`，未按域的最近变化频率自适应 | 改为 `Start(ctx, db, minInterval, maxInterval)` + 指数退避：无变化时逐步拉长到 maxInterval，出现变化后回退到 minInterval；支持 `--change-detect.min-interval` / `--change-detect.max-interval` 与对应环境变量 | backend-developer | `go test ./platform/configcenter/change/...` 通过；启动参数可正确覆盖 | closed（已修复） |
| 6 | 批量调整采集 Job 的 ready/draft 状态缺少入口，PRD 未定义 | M01 | 列表页仅支持单条操作，批量场景未实现；PRD 未覆盖批量状态切换 | 后端新增 `POST /api/v2/platform/scrape-jobs/batch-draft-status` 接口与单测；前端 `ScrapeJobListPage` 增加 rowSelection 与批量「标记 ready / 标记 draft」按钮 | backend-developer / frontend-developer | `go test ./platform/strategy/scrapejob/...` + `pnpm vitest run` 全量通过 | closed（MVP 内落地；PRD 后续补登） |

---

## 已记录问题

### 1. ResourceFormDrawer 测试 flaky（偶发）
- **问题**：`pnpm vitest run` 全量（44 文件）时 `src/pages/resources/ResourceFormDrawer.test.tsx`（M07 资源表单）失败，断言「请选择业务」文案超时。
- **根因**：全量并行执行时 getComputedStyle 伪元素未就绪/时序竞争，属 flaky；本轮未改动 resources 模块。
- **处置**：单独复跑 `vitest run src/pages/resources/ResourceFormDrawer.test.tsx` → **11/11 通过**，判定非本轮改动引入。按项目原则不制度化重试，归因挂账。
- **修复人**：frontend-developer（Orchestrator 协调）
- **状态**：closed（已归因，非缺陷）

### 3. NetworkDomainsPage 测试报错 `scrollIntoView is not a function`（已修复）
- **问题**：`pnpm vitest run` 全量（44 文件）时 `src/pages/config-center/domains/NetworkDomainsPage.test.tsx`（M09 网域纳管页）抛未处理异常：`guideRef.current?.scrollIntoView is not a function`，来源 `NetworkDomainsPage.tsx:144`（guideHighlight 的 `setTimeout(200ms)` 回调）。
- **根因**：jsdom 不实现 `scrollIntoView`；全量并行下 antd 测试计时/`act` 时序竞争导致该回调在测试收尾阶段触达未加 mock 的 `guideRef`。
- **修复**：在 `NetworkDomainsPage.tsx:144` 调用前判断 `typeof guideRef.current?.scrollIntoView === 'function'`；浏览器环境下为真，正常平滑滚动；jsdom 环境下跳过，不抛未处理异常。保持浏览器端行为不变。
- **涉及文件**：`ui-custom/web/src/pages/config-center/domains/NetworkDomainsPage.tsx`。
- **修复人**：frontend-developer（Orchestrator 协调）
- **验证**：`pnpm vitest run` 全量 44/44 文件、310/310 用例通过，无 unhandled error。
- **状态**：closed（已修复）

### 4. 配置变更单 pending 状态下新增 Job 不合并（后单取代前单）
- **问题**：配置中心预览功能中，新增 job1 后尚未确认，又新增 job2，配置预览仍只显示 job1 的变更，job2 的变更被吞掉；只有把 job1 确认/废弃后，再新增 job3，才会把 job2、job3 一起纳入。
- **根因**：`draft.GenerateDraft` 对同域同通道已有 pending 草稿仅做「保活」(`LatestLivePending`)，未把后续新增改动合并到既有 pending 中，导致后增改动不可见。
- **修复方案**：
  - `GenerateDraft` 检测到存在 pending 时，先调用 `reconcileWithExistingPending` 把新基线与既有 pending 合并；
  - 以新 pending 取代旧 pending，旧 pending 标记为 `superseded`，新草稿 `SupersedesChangeNo` 记录取代链；
  - `skipped_pending` 分支不再推进 `SourceVersion`，避免基线跳变。
- **涉及文件**：`platform/configcenter/draft/service.go`、`platform/configcenter/draft/service_test.go`、`platform/configcenter/change/watcher.go`、`platform/models/config_center_rules.go`。
- **修复人**：backend-developer
- **验证**：`go test ./platform/configcenter/draft/...` + `go test ./platform/configcenter/change/...` 通过；端到端验证新增 Job 实时合并到既有 pending。
- **状态**：closed（已修复）

### 5. 配置检测轮询间隔固定 30s（自适应退避）
- **问题**：单网域场景下固定 30s 轮询显得响应慢；多网域场景下固定 30s 对无变化域也可能造成不必要负载。
- **根因**：`configcenter/change/watcher.go` 使用固定 `--change-detect.interval`，未根据实际变化频率动态调整。
- **修复方案**：
  - `ConfigChangeBaseline` 新增 `IntervalSeconds`、`BackoffLevel`、`NextCheckAt`；
  - `watcher.Start` 改为 `Start(ctx, db, minInterval, maxInterval)`，默认 `5s / 30s`（可通过 `--change-detect.min-interval` / `--change-detect.max-interval` 和 `CONFIG_CHANGE_DETECT_MIN_INTERVAL_SECONDS` / `CONFIG_CHANGE_DETECT_MAX_INTERVAL_SECONDS` 覆盖）；
  - 无变化时按指数退避逐步拉长间隔到 max；检测到变化时立即回退到 minInterval；生成失败不推进基线，下次重试。
- **涉及文件**：`platform/models/config_change_baseline.go`、`platform/configcenter/change/watcher.go`、`platform/cmd/metric-center/main.go`、`platform/configcenter/change/watcher_test.go`。
- **修复人**：backend-developer
- **验证**：`go test ./platform/configcenter/change/...` 通过；启动参数和环境变量覆盖验证通过。
- **状态**：closed（已修复；PRD 后续补登参数默认值与退避规则）

### 6. 批量调整采集 Job ready/draft 状态缺少入口
- **问题**：ScrapeJob 列表仅支持单条切换 ready/draft，用户在批量编写 Job 时需要逐条操作，效率低；PRD 未定义批量状态切换入口。
- **根因**：前端列表未提供 rowSelection + 批量操作；后端缺少批量状态切换接口。
- **修复方案**：
  - 后端新增 `platform/strategy/scrapejob/batch.go`，实现 `POST /api/v2/platform/scrape-jobs/batch-draft-status`，支持批量 `ready` / `draft`；
  - 前端 `ScrapeJobListPage` 增加 Ant Design Table rowSelection、批量「标记 ready」「标记 draft」按钮，调用 `batchDraftStatus`；
  - 单测覆盖正常/空选/全选/部分失败场景。
- **涉及文件**：`platform/strategy/scrapejob/batch.go`、`platform/strategy/scrapejob/batch_test.go`、`platform/strategy/scrapejob/routes.go`、`ui-custom/web/src/api/scrapeJobs.ts`、`ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`。
- **修复人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/strategy/scrapejob/...` + `pnpm vitest run` 全量通过。
- **状态**：closed（MVP 内落地；PRD 后续补登批量操作交互规范）

### 7. instance 校验放开 + 校验信息透传（M09 方案 A，联调发现）
- **问题**：默认模板生成 `instance` 标签（M07 PRD §5.12C `instance_ip:port → instance` 标准映射），但 M09 产物校验器 `validateLabelName` 无条件复用 `IsProtectedLabel` 拒绝 `instance`，系统默认合法产物被自身校验器打回；重校验返回 400「失败」却无具体原因（vMsg 未透传）。
- **根因**：M07 映射层 `mappings.go` 已实现 `composite→instance` 例外（决策 3.4），M09 校验器未同步；`RevalidateDraft` 丢弃 `vMsg`，前端拿不到失败原因。属「同型缺口第二次」（决策 3.26 首次）。
- **修复方案（方案 A，PRD 无需改动）**：
  - `validateLabelName` 对 `instance` 放行，仍拦 `job`/`scheme`/`__*`（M09 PRD §3.5.1 仅禁 `__` 前缀标签）；
  - `ConfigDraft` 增 `validation_message` 持久化字段，生成 / 取代 / 重校写入并透传；重校失败返回 `ErrValidationStillFailed: <vMsg>`。
- **涉及文件**：`generator/validate.go`、`models/config.go`、`draft/service.go`、`types/config-center.ts`、`ConfigPreviewPage.tsx`。
- **修复人**：backend-developer
- **验证**：`go test ./platform/...` + 前端 vitest/tsc 通过。
- **状态**：closed（PRD 无需改动）

### 8. 校验分层落地：pending 态操作出口 + 校验失败机因（决策 45 系列）
- **问题**：方案 A 修复后重校回到 `pending`，但配置确认详情页（1）pending 态「确认发布」未禁用（违反 §3.5.1 三态语义，promtool 不可用等未校验态不应可发布）；（2）pending 态不展示「重新校验」，无自愈入口；（3）`failed` 与 `pending` 在 UI 无法区分，失败无归因无操作指向。
- **根因**：前端操作区逻辑 `validationFailed = status === 'failed'` 硬编码，未按「仅 passed 可确认」反转；原型已定义的 `validation_cause` / `validation_details`（v1.39 决策 39-1/39-3）未同步到实现。
- **修复方案（决策 45-1~45-3，对齐原型）**：
  - 操作区三态：`passed`→可确认；`pending`/`failed`→禁确认、给「重新校验+废弃」；`failed+user_config` 额外给「前往修改」引导；
  - Alert 分色：`failed`→error、`pending`→warning（promtool 不可用属待环境就绪）；
  - 后端 `ConfigDraft` 增 `validation_cause`（user_config/platform_fault）/ `validation_details`（结构化定位），`ValidateArtifacts` 返回归因，契约透传。
- **涉及文件**：后端 `draft/service.go`、`generator/validate.go`、`models/config.go`、`models/config_center_rules.go`；前端 `ConfigPreviewPage.tsx`、`config-center.ts`。
- **修复人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/...` + `pnpm vitest run`（15/15）通过。
- **状态**：closed（45-1~45-3 已落地；45-4 M07 源数据静态校验立项为 M07 独立任务）
- **待 design 分支收割**：M09 PRD §3.5 补「pending 态不可确认发布、需重校」语义注记。

### 9. labels 归属层级决策：挂 target 级（跨 M01/M07/M09，决策 D43）
- **问题**：配置预览发现 `targets/*.json` 中 `labels: {}` 为空，未取到标签模板映射值；讨论「labels 应挂 `prometheus.yml` job 级 还是 `targets/*.json` target 级」。
- **决策（用户拍板）**：labels 最终挂 **target 级**（`targets/*.json` 每个 target 的 `labels`），与 Prometheus file_sd 语义 + 资源实例级差异化一致；Job 级 labels 仅保留系统字段；`ScrapeJob.label_template_id` 仍为 Job 级引用，配置生成时按该模板把每个 target 对应资源属性转换为 target 级 labels。当前 `labels:{}` 为空是 generator 实现缺漏。
- **影响模块**：M01/M09 配置生成器（`platform/configcenter/generator/`）、M07 标签模板映射服务。
- **涉及文件**：`generator/`（targets 生成）、`scrape_job.go`。
- **负责人**：backend-developer（generator 补全 target 级 labels 映射解析）
- **状态**：open（实现缺漏待补；M09 PRD §3.2/§9.1 需补 `targets/*.json[].labels` 来源说明）
- **待 design 分支收割**：M01 PRD §5.4 明确 Job 级引用→target 级产物；M09 PRD §3.2/§9.1 补产物 labels 来源。

### 10. 批量提交生效提级 MVP + pending 期间 job 锁定（决策 D28 / 44）
- **问题**：（1）PRD 将「保存草稿/提交生效」批量下发定位 v0.2，MVP 仅有四态占位，初次配置 job 量大时缺批量承载；（2）「待生效」job 仍可编辑/删除，保存报内部错误、产生幽灵单。
- **决策**：方案 C 提级 MVP——创建抽屉「保存草稿/提交生效」双按钮；批量接口收窄为**单向「批量提交生效」**（draft→ready，前端不暴露 ready→draft 回退，回退由 M09 变更单废弃承接 §43-3）；批量下发诉求由 M09 后单取代前单合并承接。pending 期间禁止编辑/启停/删除 job（后端 409 + 前端禁用 Tooltip）。
- **实现落库**：`scrapejob/batch.go` 语义收窄、`create.go` 支持 draft_status、`update.go`/`delete.go` pending 409、`ScrapeJobFormDrawer` 双按钮、`ScrapeJobListPage` 批量提交生效 + pending 行禁用。
- **涉及文件**：`platform/strategy/scrapejob/*.go`、`ScrapeJobFormDrawer.tsx`、`ScrapeJobListPage.tsx`。
- **负责人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/strategy/scrapejob/...` + 前端 vitest 通过。
- **状态**：closed（MVP 内落地）
- **待 design 分支收割**：M01 PRD §5.1 版本归属 v0.2→MVP、§5.4 pending 锁定语义 + draft 单向流转、§11.1 批量提交生效；原型补 pending 行禁用态。

### 11. host 操作系统必填 + 内置字典（M07 §7/§9，跨 M01 采集候选匹配）
- **问题**：`os_type` PRD 标非必填，但采集实例定位强依赖它——`os_type` 为空（或拼写错误）的主机被排除出候选，采集 Job 选不到；PRD §5.6 标注与采集候选匹配矛盾。
- **修复**：`validateHost` 与前端 host 表单 `os_type` 改**必填**；新增 `os_dict.go` 内置字典（规范名→家族）+ `NormalizeOSType` + 配置接口 `GET /api/v2/platform/os-options`；前端 host 表单操作系统改 AutoComplete 下拉（可搜索自定义）。
- **涉及文件**：后端 `models/os_dict.go`、`config/resource/os_options.go`、`validateHost`；前端 `ResourceFormDrawer.tsx`。
- **负责人**：backend-developer / frontend-developer
- **状态**：closed（已实施）
- **待 design 分支收割**：M07 PRD §5.6 `os_type` 改为 ✅ 必填 + 字典选择描述（参考 `/os-options`）。

---

## 变更记录

### 首页聚合 Dashboard 接口（Phase 5 新增）
- **后端**：新增 `GET /api/v2/platform/dashboard/summary`，返回 `resource_count / pending_draft_count / recent_deployments / domain_count`，复用 M07/M09 各表 count/join，见 `platform/dashboard/summary.go`。
- **前端**：新增 `ui-custom/web/src/api/dashboard.ts`；改造 `HomePage.tsx` 展示概览卡片 + 最近下发记录表格（Spin/Alert/空态/mock）。
- **契约**：`{ status, data: { resource_count, pending_draft_count, recent_deployments: [{ id, change_no, network_domain_name, status, triggered_at }], domain_count } }`。
- **状态**：closed（已端到端验证）

### 采集器管理标签模板预览补齐（M01）
- **问题**：选择/查看标签模板只显示模板名（此前甚至只显「已挂模板」），无映射明细、无 M07 跨模块引导，偏离 PRD §5.1 L228/L229/L240。
- **修复**：新增 `LabelTemplatePreview` 组件（模板头部 + 类别·ID + 映射明细 +「前往标签模板管理（M07）」链接）；`LabelTemplateSelectDrawer` 选中后内联预览模板映射；`CollectorTemplatesTab` 列表列显示模板名 +「默认」标记、预览抽屉承载完整预览。
- **涉及文件**：`LabelTemplatePreview.tsx`（新增）、`LabelTemplateSelectDrawer.tsx`、`CollectorTemplatesTab.tsx`。
- **登记**：M01 dev-feedback F-12。
- **状态**：closed（tsc / eslint / vitest 通过）

### 监控对象业务字典定制（M07）
- **问题**：MVP 业务字段为预置字典，原有 4 条（infra/payment/data-api/legacy）非所需，且 MVP 无字典增删入口（只读 + 热加载）。
- **修复**：`platform/config/business_domains.yaml` 改为 2 条：`授权运营`（authorized-ops）、`数据创新实验室`（data-innovation-lab）；同步 `main_test.go` E2E 断言与用例 biz_code。
- **状态**：closed（`go test ./platform/...` 通过）

### 首页 dashboard 404 根因与版本标注挪位（M05/首页）
- **问题**：首页请求 `/api/v2/platform/dashboard/summary` 返回 404；并需把「系统状态（PR 预览）版本/模式」从首屏中央挪至不显眼角落。
- **根因**：8080 残留旧版 `metric-center` 二进制进程，不含 dashboard 路由；重建并重启后取数正常。
- **修复**：`HomePage.tsx` 移除顶部状态卡片，版本（0.1.0-mvp）/模式（mvp）挪至页面右下角小字标注；样式调整留待 module05 分支跟进（当前分支未建立）。
- **状态**：closed（接口实测取数通过；样式留待 M05 细化）

### 配置变更单闭环缺失：自动变更检测未实现 + 前端无跳转动线（M01/M09，方案 A 吸收 B）
- **问题**：MVP 验收要求「配置生成 → 变更检测 → 确认 → diff → reload」全链路，但 `NeedsRegeneration` 全仓库无调用方，后端 §3.3.3 30s 轮询未实现；前端配置确认页连「手动生成」按钮都没有，用户保存采集 Job / 改资源后无任何途径让变更单出现。
- **选型**：放弃纯方案 B（M01 push createDraft 只堵一条入口，且与已冻结的「pull 模式、Module_01 不主动通知」架构决策冲突）；落地**方案 A 为主，吸收方案 B**。
- **后端（方案 A）**：
  - 新增 `ConfigChangeBaseline` 表（`config_change_baselines`）承载持久化检测基线，**从 DB 派生而非内存态取最新草稿/已确认版本 metadata**：服务重启不误判，首启（无基线）仅初始化跳过，不对全部网域误生成噪声草稿；
  - 新增 `configcenter/change` 包：`Start(ctx, db, interval)` 独立 goroutine、30s 间隔（`--change-detect.interval` 默认、`CONFIG_CHANGE_DETECT_INTERVAL_SECONDS` 覆盖）、ctx 优雅退出；`ProcessDomain` 单域裁决（版本未变跳过 / 已有活 pending 保活跳过 / 复用 `GenerateDraft` 生成）；
  - `draft.GenerateDraft` 已内聚保活/校验/checksum，复用不另起一套；生成失败记 `DetectStatus=failed + LastError`（决策 42-4），不推进基线版本、下轮重试；
  - `main.go` 改为 signal (SIGINT/SIGTERM) 优雅关闭 HTTP + watcher。
- **前端（吸收方案 B）**：`ScrapeJobFormDrawer` 保存成功后提供「点击消息前往配置变更确认（/config-preview）」跳转，并 best-effort 即时触发一次 `configDraftApi.create`（保活约束保证不重复；检测闭环不依赖它，30s 轮询兜底）。
- **涉及模块**：`platform/models/config_change_baseline.go`（新增）、`platform/configcenter/change/watcher.go`（新增）、`draft/service.go`（导出 `LatestLivePending`）、`db/db.go`（迁移）、`cmd/metric-center/main.go`（启动 watcher）、`ui-custom/web/.../ScrapeJobFormDrawer.tsx`。
- **登记**：M09 dev-feedback §6。
- **状态**：closed（`go test ./platform/...` 全通过 + 前端 tsc/eslint/vitest 通过）