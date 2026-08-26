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
| 12 | target 抓取地址缺 exporter 端口，Host 落到 80 端口抓取失败（非 PRD 表述问题，M01/M09 执行理解偏差，决策 46） | M01/M09 | PRD（M01 §5.1 / M07 §5.12C）已明确端口来源 = `CITypeExporterMapping.default_port`、M09 生成时拼接 `instance_ip:default_port`；实现未按契约执行——M09 `resolveResource` Host 分支只取 IP、Database/Middleware 误用资源业务端口，M01 `ScrapeJob` 无端口快照、生成器未解析映射 default_port | 决策 46 最小方案：新增 `LoadExporterPort`（映射 default_port → 回落采集器 default_port），`resolveResource` 对 Host/Database/Middleware 统一拼接 exporter 端口 | backend-developer | `go test ./platform/...` 通过；端到端验证 Prometheus `health: up`、scrape_url=`http://1.15.94.116:9100/metrics` | closed（PRD §5.4 端口口径另列 M01 F-20 待设计侧统一） |
| 13 | 禁用已生效采集 Job 后变更清单仍显示「本次无配置变更」（M01/M09，实现偏差） | M01/M09 | M09 `buildChangeItems` 不做新旧产物 diff，仅罗列当前仍启用 Job 且全部标「新增」；禁用 Job 被过滤后清单为空 → `buildSummary` 返回「本次无配置变更」 | 新增 `draft/change_items.go`：按上一生效版本产物 diff 派生 add/update/delete，移除已生效 Job 标记 high；M01 前端启停改为有文字按钮 + Popconfirm 二次确认 | backend-developer / frontend-developer | `go test ./platform/configcenter/draft/...` + 前端相关 18 用例通过 | closed（PRD 无需改动） |
| 14 | 规则挂载「保存并下发」后状态变停用（M01，实现偏差） | M01 | 前端创建请求漏传 `enabled`；后端 `CreateMonitoringRuleRequest.Enabled` 为非指针 bool，零值 false 落库 | 后端 `Enabled` 改为 `*bool` 缺省 true；前端显式传 `enabled: true`，按钮文案改为「提交生效」 | backend-developer / frontend-developer | `go test ./platform/strategy/rule/...` + 前端相关用例通过 | closed（PRD 无需改动） |
| 15 | Prometheus 加载不到告警规则（"No rules found"）（M09，实现偏差） | M01/M09 | M09 `render.go` 生成 prometheus.yml 未注入 `rule_files` 引用 rules.yml，Prometheus 默认不加载规则文件 | `cfgFile` 增 `RuleFiles`，有规则时注入 `rule_files: ["rules.yml"]`（无规则不注入） | backend-developer | `go test ./platform/...` 通过；端到端下发后 Prometheus Rules 正常加载 | closed（PRD 无需改动） |
| 16 | promtool 校验误报——check config 缺 rules.yml 引用文件（M09，实现偏差） | M09 | F-23 修复后 prometheus.yml 经 `rule_files: ["rules.yml"]` 引用同目录规则文件，但 `runPromtoolCheck` 校验时只写 prometheus.yml 到临时目录，未写 rules.yml / targets/*.json，promtool 判定引用文件不存在 | `runPromtoolCheck` 改为按真实下发目录结构（prometheus.yml + rules.yml + targets/*.json）写入临时目录再校验 | backend-developer | `go test ./platform/...` 通过；重编译重启后对失败草稿 CHG-20260826-015 重校通过（passed） | closed（PRD 无需改动） |
| 18 | 规则 change_status 无 M09 回写，禁用后残留 pending 假锁（M01/M09，实现缺漏） | M01/M09 | `MonitoringRule.change_status` 创建时置 pending 后永不再写回（ScrapeJob 有 `deployment/callback.go` 回写 pending→deployed，规则无对应机制）；M09 确认/废弃/下发均只处理 Job 侧 | 决策 C：`deployment/callback.go` 增 `writebackRuleChangeStatus`（pending+ready→deployed 全量回写），`Dispatch` 统一经 `writebackChangeStatuses` 执行；ceshi002 一次性数据修复 pending→none；废弃回写场景登记待 v0.3 | backend-developer | `go test ./platform/...` 全绿 + `go vet` 通过；ceshi002 已解锁（change_status=none） | closed（方案 C 已拍板并落地，待重启服务后 E2E 复核） |
| 19 | Form 抽屉/弹窗首次打开内容为空、二次才回显（antd 惰性挂载竞态，M01/M07/M09 跨模块通病） | M01/M07/M09 | antd Drawer/Modal 首次打开时内容惰性挂载（rc-motion 动画期晚于父组件 useEffect 的 `form.setFieldsValue`），setFieldsValue 在 Form 字段注册前执行被静默吞掉；二次打开时 Form 已常驻挂载 → 回显正常 | 规则/采集 Job/标签映射/登记采集器/资源（M07）/网域登记+编辑/标签模板新增 共 9 处 Form 抽屉/弹窗统一增 `forceRender`（替代 destroyOnHidden/destroyOnClose），保证 Form 常驻挂载、首次打开即回显；补「关闭→打开切换回显」回归测试；frontend-developer.md v1.35 新增强制规则（Step 3.7） | frontend-developer | `pnpm vitest run`（ResourceFormDrawer/LabelTemplatesPage/RuleMountDrawer/ScrapeJobFormDrawer）45/45 + `tsc --noEmit` 通过 | closed（PRD 无需改动） |

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

### F-25 决策：规则「停用可编辑」提级 MVP，规则草稿（draft_status=draft）推迟 v0.3（用户拍板）
- **背景**：用户希望规则编辑效仿采集 Job——规则显示「停用」状态时允许再次编辑；并咨询 MVP 阶段实现规则「保存草稿」（draft→ready 批量提交流程）的难度与是否属 0.2 提级。
- **决策（chenrt，2026-08-26）**：
  1. **MVP 实现「停用可编辑」**：规则操作列新增「编辑」按钮，复用 `RuleMountDrawer` 编辑模式（回显 + PUT update，不携带 enabled、不改启停状态）；编辑可用性 = 除 `change_status=pending`（存在待确认变更单，锁定期）外均可编辑，与采集 Job F-19 / 决策 44-1 锁定语义一致；
  2. **规则草稿推迟 v0.3 不提前实现**：yaml_passthrough 整文件无「PromQL 半成品」场景，草稿价值绑在 v0.3 字段化编辑；api-contract-snapshot §18 已将其列为 v0.2 能力、本期范围外。
- **登记**：M01 dev-feedback F-25。
- **状态**：closed（前端已实现，单测 11 用例 + tsc + eslint 通过）
- **注意**：该「pending 锁定」依赖 `change_status` 真实反映在途单据，而 #18 暴露规则 change_status 无 M09 回写、会残留假 pending——两处需一并治理。

---

### 12. target 抓取地址缺 exporter 端口（跨 M01/M09，决策 46）
- **问题（联调实测）**：添加 Host 采集 Job 后 Prometheus 报 `Get "http://1.15.94.116/metrics": dial tcp 1.15.94.116:80: connect: connection refused`——targets 产物为 `["1.15.94.116"]`（无端口），Prometheus 默认落 80 端口；node_exporter 实际监听 9100（本地实测可达）。Database/Middleware 分支虽拼端口，但用的是**资源业务端口**（3306/6379）而非 exporter 监听端口（9104/9121）。
- **定性（非 PRD 表述问题，M01/M09 执行理解偏差）**：
  - PRD 口径本身清晰——M01 §5.1「端口一致性说明」与 M07 §5.12C「取值时序 / 跨层解析 / 端口配置点不变」均明确规定：`target`/`instance` 端口取自 `CITypeExporterMapping.default_port`（如 node_exporter 9100），由 Module_09 生成配置时对 `selected_instance_ids` 逐个拼接 `instance_ip:default_port`；host 资源本身无 port 字段，DB/中间件的 port 是服务端口而非 exporter 监听端口。无需改动 PRD 表述。
  - 偏差在两模块实现侧：① M09 生成器 `resolveResource` 未按 §5.12C 解析策略层端口——Host 分支只取 `PrivateIP` 不拼端口，Database/Middleware 误用业务端口；② M01 `ScrapeJob` 无端口快照字段、生成器也未解析映射/采集器 `default_port`（PRD §5.4「端口是否进 Job 快照」内部口径冲突另列 M01 F-20，待设计侧统一后评估 v0.2+ 补 `ScrapeJob.port`）。
- **修复方案（决策 46，MVP 最小方案，PRD 无需改动）**：
  - 新增 `generator.LoadExporterPort`：优先 `CITypeExporterMapping.default_port`（monitor_type 默认映射），回落 `ExporterTemplate.default_port`（exporter_template_id）；
  - `resolveResource` 对 Host/Database/Middleware 抓取地址统一拼接 exporter 端口（Database/Middleware 在 exporter 端口为 0 时回落业务端口）；Application 用健康检查 URL、GenericTarget 用登记服务端口（不变）；
  - `instance` 组合标签随地址自动带端口。
- **涉及文件**：`platform/configcenter/generator/targets.go`（`exporterPortOr` / `resolveResource` 签名 + 端口拼接）、`generator/data_source.go`（`LoadExporterPort`）、`generator/generator_test.go`（`TestResolveTargetsExporterPort` / `TestLoadExporterPortPriority`）、`draft/service.go`（buildArtifacts 传入 exporterPort）。
- **修复人**：backend-developer
- **验证**：`go test ./platform/...` 通过；端到端重新生成草稿 `CHG-20260826-006`（targets 带 `1.15.94.116:9100`）→ promtool 校验 passed → 确认下发，Prometheus reload 后 `health: up`、scrape_url=`http://1.15.94.116:9100/metrics`、`last_error` 为空。
- **状态**：closed（决策 46 已落地）
- **待 design 分支收割**：M01 PRD §5.4 统一「端口是否进 ScrapeJob 字段 / mapping_overrides」口径（416 行与字段表冲突，已列 M01 F-20）；v0.2+ 若做 Job 级端口快照则补 `ScrapeJob.port` 字段与前端表单端口输入。
- **备注**：联调时曾因运行环境使用旧二进制（09:58 编译）+ 旧 targets 文件（10:43 生成，早于 10:54 的源码修复）而误判，重编译并重启 + 重新生成下发后恢复正常；后续改后端代码重启服务后需在「配置变更确认」页重新校验 + 下发，Prometheus 才会拿到新 targets。
### 13. 禁用已生效采集 Job 后变更清单仍显示「本次无配置变更」（M01/M09，实现偏差）

- **问题（用户验收）**：在 Job 列表点击「停用」后，配置变更确认页摘要显示「本次配置无变化 / 无实际内容变化」，与「版本对比」Tab 中 scrape_config 被删除的真实 diff 自相矛盾，引发误解。
- **根因**：`platform/configcenter/draft/service.go` 的 `buildChangeItems` 不做新旧产物 diff，仅罗列当前仍启用的 Job/规则且全部写死标为「新增」；被禁用 Job 已被 `LoadJobs` 过滤，永远不会以「移除」出现在清单中。禁用唯一 Job 时清单为空 → `buildSummary` 返回「本次无配置变更」。不符合 M09 PRD §3.4（变更类型 新增/修改/移除、按产物差异派生、删除目标=高风险）。
- **修复方案**：
  - 后端新增 `platform/configcenter/draft/change_items.go`：
    - `buildChangeItems(jobs, rules, artifacts, base)`：以「上一已确认 ConfigVersion 产物 vs 本次草稿产物」diff 派生；
    - Job 级：对比 scrape_config + targets 文件内容 → 新增（low）/变更（low）；生效版本中存在但本次产物已摘除的 → delete/high「移除采集 Job（监控断点风险）」；
    - 规则级：按规则组名 diff → 新增/变更/移除（均 high）。
  - `platform/configcenter/generator/generator.go`：导出 `NormalizeJobFilename`，供 draft 按同一口径反查 targets 文件名。
  - `platform/configcenter/draft/service.go`：`GenerateDraft` 前置 `lastConfirmedVersion` 作为 diff 基线；清单为空即 `ErrNoChanges`（抑制空跑噪声）。
  - 前端 `ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`：启停由小号无文字 Switch 改为有文字「停用/启用」链接按钮 + Popconfirm 二次确认，停用提示监控中断影响。
- **涉及文件**：`platform/configcenter/draft/change_items.go`（新增）、`platform/configcenter/draft/service.go`、`platform/configcenter/generator/generator.go`、`ui-custom/web/src/pages/strategy/ScrapeJobListPage.tsx`。
- **修复人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/...` 全绿；前端 ScrapeJobListPage/RuleMountDrawer/RulesPage 18 用例通过；`pnpm lint` 通过。
- **状态**：closed（PRD 无需改动）

### 14. 规则挂载「保存并下发」后规则状态显示「停用」（M01，实现偏差）

- **问题（用户验收）**：规则挂载抽屉点击「保存并下发」后，规则列表显示「停用」，与采集 Job「创建默认启用」（M01 PRD §8）不一致；PRD §5.5 明确 `enabled=false` 的规则将从 rules.yml 摘除，「保存并下发」一个停用规则语义自相矛盾。
- **根因**：前端 `RuleMountDrawer` 创建请求漏传 `enabled`；后端 `CreateMonitoringRuleRequest.Enabled` 为非指针 bool 且无默认值兜底，Go 零值 `false` 直接落库。
- **修复方案**：
  - 后端 `platform/strategy/rule/create.go`：`Enabled` 改为 `*bool`，缺省默认 `true`；显式传 `false` 仍尊重调用方（停用挂载场景）。
  - 前端 `ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`：创建请求显式传 `enabled: true`；按钮文案「保存并下发」→「提交生效」（实际需 M09 人工确认后下发，名实相符）。
- **涉及文件**：`platform/strategy/rule/create.go`、`platform/strategy/rule/monitoring_rule_test.go`、`ui-custom/web/src/pages/strategy/RuleMountDrawer.tsx`、`ui-custom/web/src/pages/strategy/RuleMountDrawer.test.tsx`。
- **修复人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/strategy/rule/...` 通过；前端 RuleMountDrawer 用例通过；`pnpm lint` 通过。
- **状态**：closed（PRD 无需改动）

### 15. Prometheus 加载不到告警规则（"No rules found"，M01/M09，实现偏差）

- **问题（用户验收）**：触发 Job 变更并挂载 rules.yaml 后，在配置文件中心确认下发，Prometheus 成功获取 targets 与 job，但 Rules 模块仍显示 "No rules found"。
- **根因**：`platform/configcenter/generator/render.go` 生成的 prometheus.yml 仅含 `global` / `scrape_configs`，**未注入 `rule_files`** 引用同目录下发的 `rules.yml`；Prometheus 仅在显式配置 `rule_files` 时才加载规则文件，故 rules.yml 虽已由 `deployment/service.go` `writeStructural` 与 prometheus.yml 同目录写盘，却不被加载。
- **定性**：实现偏差，PRD 无需改动（M09 PRD §3.2 配置产物已含 rules.yml；M01 PRD §5.5 规则组装语义明确）。
- **修复方案**：
  - `generator/render.go`：`cfgFile` 增 `RuleFiles []string` 字段，`Assemble` 渲染时「有规则内容才注入 `rule_files: ["rules.yml"]`，无规则不注入」——避免无规则时引用不存在的文件导致配置加载失败；
  - 单测 `TestAssembleRulesYAMLPassthrough` 增 rule_files 断言、新增 `TestAssembleRuleFilesOmittedWhenNoRules`。
- **涉及文件**：`platform/configcenter/generator/render.go`、`platform/configcenter/generator/generator_test.go`。
- **修复人**：backend-developer
- **验证**：`go test ./platform/...` 通过；端到端重新生成草稿下发后，Prometheus reload 加载 rules.yml，Rules 模块不再显示 "No rules found"。
- **状态**：closed（PRD 无需改动）
- **登记**：M09 dev-feedback F-23。

### 16. promtool 校验误报——check config 缺 rules.yml 引用文件（M09，实现偏差）

- **问题（用户验收）**：新增规则文件后触发校验，配置变更确认报 `promtool check config 失败: Checking .../promcheck-*.yml FAILED: ".../T/rules.yml" does not point to an existing file`。
- **根因**：`platform/configcenter/generator/validate.go` `runPromtoolCheck` 只把 `prometheus.yml` 写入临时文件就执行 `promtool check config`；F-23 修复后 `prometheus.yml` 经 `rule_files: ["rules.yml"]`（相对路径）引用同目录规则文件，但校验临时目录未写入 `rules.yml`（`file_sd` 引用的 `targets/*.json` 亦未写入），promtool 判定引用文件不存在而误报。属「生成器注入 rule_files 后，校验器未同步按真实下发目录结构落盘」的同型缺口（与 F-23 成对）。
- **定性**：实现偏差，PRD 无需改动（M09 PRD §3.2 配置产物已含 rules.yml，校验语义明确）。
- **修复方案**：
  - `generator/validate.go`：`runPromtoolCheck` 签名改为接收 `*ConfigArtifacts`，按真实下发目录结构（与 `deployment.writeStructural` 一致）写入临时目录——`prometheus.yml` + `rules.yml` + `targets/*.json`——再执行 `promtool check config`；`runToolChecks` / `toolCheckerFn` 同步改传 `*ConfigArtifacts`；新增 `path/filepath` 导入。附带收益：`rules.yml` 语法现在真正被 promtool 校验。
  - `generator/generator_test.go`：`toolCheckerFn` mock 签名同步。
- **涉及文件**：`platform/configcenter/generator/validate.go`、`platform/configcenter/generator/generator_test.go`。
- **修复人**：backend-developer
- **验证**：`go test ./platform/...` 通过；重编译并重启 metric-center 后，对失败草稿 `CHG-20260826-015` 重新校验返回 `validation_status=passed`，草稿进入可确认状态。
- **状态**：closed（PRD 无需改动）
- **登记**：M09 dev-feedback F-24。

### 17. 规则按 CI 类型组织 + 多记录合并语义（M01/M09，用户拍板功能增强）

- **背景（用户诉求 + DeepSeek 分析引出）**：用户询问「规则名与 rules.yml 的映射、能否按 CI 类型维护多条规则」后，拍板把 v0.2 的 monitor_type 维度提级 MVP：前端按资源类别组织多条规则，后端统一拼接为同一份 rules.yml。
- **问题**：
  1. `renderRules` 原样字符串拼接多条 `rule_content`，各带顶层 `groups:` 键 → 重复顶层键的非法 rules.yml，promtool 校验失败（issue 16 修复后该校验真正生效，此坑暴露）；
  2. `MonitoringRule.MonitorType` 列已存在（M01 PRD §5.5 透传模式可空），但接口不接、列表不筛、前端无入口。
- **修复方案（方案 A，保存时校验组名唯一，非渲染期合并同名组）**：
  - 后端 `generator/render.go`：`renderRules` 改为逐条解析 groups → `yaml.Node` 节点级合并为单个 `groups:` 文档（内容不重排）；
  - 后端 `strategy/rule/`：`validate.go` 新增 `extractGroupNames` / `validateGroupNamesAvailable`（生效规则间组名全局唯一，撞名 bad_request 点名占用方；停用不校验、停用即释放）；`create.go`/`update.go` 接收并校验 `monitor_type`（可空，`models.ValidMonitorType`）；`list.go` 支持 `monitor_type` 筛选；
  - 前端 `RuleMountDrawer.tsx`：新增「资源类别 → 监控对象类型」两级级联（复用 MONITOR_TYPE_CASCADE，F1-8 同源），提交仅 `monitor_type`；`RulesPage.tsx`：新增「监控对象类型」列 + 筛选 + 详情行；`monitoringRules.ts` 接口补 `monitor_type`。
- **涉及文件**：`platform/configcenter/generator/render.go`、`generator.go`、`generator_test.go`、`platform/strategy/rule/{validate,create,update,list}.go`、`monitoring_rule_test.go`、`ui-custom/web/src/api/monitoringRules.ts`、`pages/strategy/{RuleMountDrawer,RulesPage}.tsx` 及测试。
- **修复人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/...` 全绿 + `go vet` 通过；前端 RuleMountDrawer/RulesPage 9 用例通过、`pnpm lint`、`tsc --noEmit` 通过（全量测试仅 `resources.test.ts` 1 个改动前已存在的 jsdom 问题）。
- **状态**：closed（待 design 收割 PRD §5.5 多记录合并语义 + 原型补级联字段）
- **登记**：M01 dev-feedback F-24。

### 18. 规则 change_status 无 M09 回写，禁用后残留 pending 假锁（M01/M09，实现缺漏）

- **问题（用户实测）**：规则 `ceshi002` 已停用，前端操作列「编辑」被禁用，Tooltip 提示「该规则存在待确认变更单，请先前往配置变更确认页处理」，但配置变更确认页无任何待处理记录，用户被卡死无法编辑。
- **实测定性（DB 证据）**：
  - `monitoring_rules` 规则 id=5 `ceshi002`：`enabled=0`、`change_status=pending`、`draft_status=ready`，创建 13:14:14、更新（停用）13:21:49；
  - `config_drafts` 规则侧完整闭环已发生：CHG-20260826-015（13:14 创建 → 13:19 **confirmed**，「变更告警规则 1 条」）= ceshi002 创建；CHG-20260826-016（13:23 创建 → 13:35 **confirmed**，「移除告警规则 1 条（高风险）」）= ceshi002 停用。两条均已确认下发，`config_change_baselines` 为 idle、无活 pending。
  - 即：**规则侧 M09 管线已正常处理，但 `MonitoringRule.change_status` 自创建起一直是 pending，从未被写回**。
- **根因**：`MonitoringRule.change_status` **缺少 M09 回写机制**，与 ScrapeJob 形成反差：
  - ScrapeJob：`platform/configcenter/deployment/callback.go` `writebackChangeStatus` 在 local reload 成功后把 `change_status=pending` 回写为 `deployed`（决策 31-M2），废弃时 `draft/service.go` 决策 43 回滚源数据；**规则侧无任何对应回写/重置**；
  - `strategy/rule/create.go` 创建即置 `change_status=pending`，此后 update/delete/confirm/deploy/abandon 均不触碰该字段 → 规则 change_status 永久停留在 pending；
  - 前端 F-25 编辑按钮按 `change_status=pending` 锁定（与 Job F-19 同语义），规则因此被「假 pending」锁死，而 M09 确认页只展示活 pending 单据（已确认单据为历史、不展示）→ 无可处理项，用户无出口。
- **候选修复方案（已决策 C，2026-08-26 用户拍板）**：
  - A. **补规则回写（对齐决策 31-M2）**：`deployment/callback.go` / `Dispatch` 成功下发后同步把 `MonitoringRule.change_status` pending→deployed（规则为全局 scope=central，无网域列，按「有变更被下发」全量回写）；`draft/service.go` 废弃（决策 43）时对规则补重置/回滚，避免废弃后仍 pending；
  - B. **前端 pending 锁自愈出口**：规则列表「编辑」的 pending 锁定增加兜底——当 `change_status=pending` 但实际无在途单据时提供「刷新状态」动作或放行编辑；需后端提供规则↔在途单据的关联查询（按规则组名反查活 pending 变更项）；
  - C. **MVP 最小修复（已选）**：先落 A 的部署回写（堵住「确认下发后仍 pending」主路径），配合对现有 `ceshi002` 一条做一次性数据修复（手动置 change_status=none），废弃/ErrNoChanges 场景登记待 v0.3。
- **已实施（方案 C，2026-08-26）**：
  - `platform/configcenter/deployment/callback.go`：新增 `writebackRuleChangeStatus`（`MonitoringRule` 中 change_status=pending 且 draft_status=ready → deployed，全局全量回写）与 `writebackChangeStatuses`（合并 Job + 规则回写错误，`errors.Join`）；
  - `platform/configcenter/deployment/service.go`：`Dispatch` 成功下发后由 `writebackChangeStatus` 改为 `writebackChangeStatuses`，回写失败仍按 MEDIUM-1 降级记录 error_message 不整链 500；
  - `deployment/deployment_test.go`：新增 `seedRule` + `TestWritebackRuleChangeStatus`（ready→deployed / draft 不动 / none 不动），`newMemDB` 迁移补 `MonitoringRule`；
  - 数据修复：`monitoring_rules` id=5 `ceshi002` `change_status` pending→none（一次性，DB 直改）。
- **验证**：`go vet ./platform/...` + `go test ./platform/...` 全绿；ceshi002 前端「编辑」按钮已解锁。**注意**：运行中的 metric-center 仍为旧二进制，需重启服务后新回写逻辑才生效，建议按动线「新增/改规则 → 确认下发 → 检查 change_status=deployed」E2E 复核。
- **待 v0.3 跟进**：规则废弃（决策 43）场景的 change_status 重置/回滚（方案 A 后半段）；按需评估前端 pending 锁自愈出口（方案 B）。
- **关联**：与 F-25「规则 pending 期锁定待后端 409 兜底」备注同源——本 issue 是该缺漏在真实数据上的暴露。
- **涉及文件**：`platform/configcenter/deployment/callback.go`、`platform/configcenter/deployment/service.go`、`platform/configcenter/deployment/deployment_test.go`、`platform/strategy/rule/*.go`、`ui-custom/web/src/pages/strategy/RulesPage.tsx`。
- **修复人**：backend-developer
- **验证**：`go vet ./platform/...` + `go test ./platform/...` 全绿；ceshi002 前端「编辑」按钮已解锁（详见上文「已实施 / 验证」）
- **状态**：closed（方案 C 已拍板并落地：规则部署回写 + ceshi002 数据修复；废弃回写登记待 v0.3；待重启服务后 E2E 复核）
- **待 design 分支收割**：M01 PRD §5.5 补「规则 change_status 随 M09 确认/下发/废弃回写，同采集 Job」语义；评估规则侧是否需要 `network_domain_id` 关联或全局回写口径。

### 19. 编辑抽屉首次打开内容为空、二次才回显（M01，antd Drawer 惰性挂载竞态）

- **问题（用户实测）**：规则 `ceshi002` 刷新页面后首次点「编辑」抽屉内容全为空，关闭再点第二次才回显规则名与 yaml。随后发现采集 Job 也复现：刷新后直接点「编辑」为空，仅「先勾选前面多选框（触发额外重渲染）再点编辑」才有回显。
- **根因**：antd `Drawer` 默认 `forceRender=false`，首次打开时内容**惰性挂载**（rc-drawer 内部 motion 动画期在父组件 commit 之后才真正挂载 Form）；父组件 `useEffect([open, record])` 里的 `form.setFieldsValue` 在**同一 commit 末尾**执行，早于 Form 字段注册 → 值被静默吞掉。第二次打开时 Form 已常驻挂载（rc-drawer 首次打开后内容保持挂载）→ 回显正常。勾选多选框只是多触发一次父组件重渲染、改变挂载时序，属**偶发缓解**而非修复。
- **影响范围**：所有「Form 放 Drawer + useEffect(open) 里 setFieldsValue 回显/预填」的抽屉均同源存在——`RuleMountDrawer`（规则，已先修）、`ScrapeJobFormDrawer`（采集 Job）、`MappingDrawer`（默认采集配置）、`ExporterTemplateDrawer`（登记采集器）。
- **修复（2026-08-26）**：四个抽屉的 `Drawer` 统一增 `forceRender`，保证 Form 常驻挂载，首次打开即正确回显/预填，不依赖交互垫时序。
- **扩展修复（2026-08-26 续，通病收敛）**：同一竞态在 M07/M09 侧继续复现（M07 资源编辑 `ResourceFormDrawer`、网域登记 `DomainForm`(Modal)、网域编辑 `NetworkDomainsPage`、标签映射 `MappingDrawer`、标签模板新增 `LabelTemplatesPage`），均以 `forceRender` 统一修复（替代 destroyOnHidden/destroyOnClose）；累计 9 处。
- **规范登记（v1.35）**：`frontend-developer.md` Change Log 新增 v1.35 + 正文新增 Step 3.7「Form 抽屉/弹窗强制 forceRender」强制规则——所有「Form 放 Drawer/Modal + useEffect(open) setFieldsValue 回显/预填」必须 `forceRender`，禁止 destroyOnHidden/destroyOnClose，且每个 Form 抽屉/弹窗必须配套「关闭→打开切换回显」回归测试（例外：无 Form 的确认/展示弹窗不受限）。
- **测试**：
  - `ScrapeJobFormDrawer.test.tsx` 新增「关闭→打开切换（首次打开）即回显 job_name/采集参数」回归用例；`RuleMountDrawer.test.tsx` 已含同款用例（#19 首修时新增）；
  - 注意：jsdom 下 rc-motion 挂载时序与真实浏览器不同，该用例在**移除 forceRender 时也不失败**（无法复现时序竞态），作用为行为契约/文档守卫，真实验证靠浏览器手动复测；
  - `CollectorTemplatesTab.test.tsx` 原 `screen.getByRole('dialog')` 因 forceRender 后同页多抽屉常驻挂载而多匹配，改为按「更换标签模板」标题定位目标抽屉。
- **验证**：`pnpm vitest run src/pages/strategy` 69/69 通过 + `tsc --noEmit` + `pnpm lint` 通过；扩展修复后 `pnpm vitest run`（ResourceFormDrawer/LabelTemplatesPage/RuleMountDrawer/ScrapeJobFormDrawer）45/45 通过 + `tsc --noEmit` 通过。
- **涉及文件**：`ui-custom/web/src/pages/strategy/{RuleMountDrawer,ScrapeJobFormDrawer,MappingDrawer,ExporterTemplateDrawer}.tsx` + 对应 `.test.tsx`、`CollectorTemplatesTab.test.tsx`；扩展：`pages/resources/ResourceFormDrawer.tsx(.test.tsx)`、`pages/label-templates/{MappingDrawer,LabelTemplatesPage}.tsx`、`pages/admin/domains/DomainForm.tsx`、`pages/config-center/domains/NetworkDomainsPage.tsx`；规范：`.kimi/agents/frontend-developer.md`（v1.35 / Step 3.7）。
- **修复人**：frontend-developer
- **状态**：closed（PRD 无需改动；浏览器侧建议刷新后首次点编辑复核）

### 20. scrape_interval/scrape_timeout 从未写入 prometheus.yml + 采集参数层叠默认链落地（M01 ↔ M09，已修复）

- **问题（用户实测追问）**：采集 Job 上填的「采集间隔/采集超时」不生效——M09 生成器 `scrapeConf` 结构体无 `scrape_interval/scrape_timeout` 字段，两个值从未渲染进 prometheus.yml（静默按 Prometheus 全局默认 1m 执行）；同时参数在「采集器登记 → 默认采集配置 → 采集 Job」三层重复填写，且 update / 批量提交生效路径无回落（清空字段报必填）。
- **修复（F-28，用户拍板方案 A「层叠默认 + 稀疏覆盖」，2026-08-26）**：
  - 生成器 `render.go`：`scrapeConf` 补 `scrape_interval/scrape_timeout` 真实渲染；空值按全局兜底常量（`models.DefaultScrapeInterval=15s` 等）回填；
  - M01 `scrapejob`：create/update/batch-submit-ready 统一 `resolveJobScrapeParams` 三层回落（is_default 映射 → 采集器模板 → 全局兜底），保存时解析为生效快照（决策 14 快照语义不变，端口仍走生成器 `LoadExporterPort`，决策 46 不变）；
  - 前端参数区改 placeholder 稀疏继承（留空=继承），详见 M01 dev-feedback F-28。
- **联调影响**：生成的 prometheus.yml 每个 scrape_config 现在显式携带 `scrape_interval/scrape_timeout/metrics_path/scheme`——变更单 diff 会更完整（存量 Job 首次重新生成会体现 interval/timeout 注入差异，属一次性口径收敛）；校验侧 promtool 对新字段原生支持，无兼容风险。
- **涉及文件**：`platform/configcenter/generator/render.go`、`platform/models/scrape_job.go`、`platform/strategy/scrapejob/{validate,create,update,batch}.go`、`ui-custom/web/src/pages/strategy/{MappingDrawer,ScrapeJobFormDrawer,CollectorTemplatesTab}.tsx`。
- **修复人**：backend-developer / frontend-developer
- **验证**：`go test ./platform/...` 全绿（新增 `TestAssembleRendersScrapeIntervalTimeout` 等 5 用例）；前端 `pnpm test` 334/335（唯一失败为改动前已存在的 `resources.test.ts` jsdom 问题）；`tsc --noEmit`、`pnpm lint` 通过。
- **状态**：closed（待重启 metric-center 后按「清空 Job 参数保存 → 生成变更单 → diff 可见 interval/timeout」E2E 复核）

### 21. 登记采集器 internal error——软删残留占用 name 唯一索引（M01，实现偏差，已修复）

- **问题（用户实测）**：登记采集器点击保存返回「登记失败 internal error」（500）。根因：ExporterTemplate 删除走软删（`deleted_at`），name 唯一索引仍被软删行占用；GORM 默认作用域（`deleted_at IS NULL`）查询不到软删行，同名重建时 INSERT 命中 DB 唯一约束抛 500。
- **修复（F-29，2026-08-26）**：`create.go` 重复检查改 `Unscoped()` 连软删行一起查，软删残留先物理清理释放索引再重建；活跃同名仍返回 409 Conflict。与 scrapejob 软删重建行为对齐。
- **涉及文件**：`platform/strategy/exporter-template/create.go`、`platform/strategy/exporter-template/exporter_template_test.go`。
- **验证**：新增回归测试 `TestCreateExporterTemplateRecreateAfterSoftDelete`；`go test ./platform/...` 全绿。
- **状态**：closed（修复已合入源码，待重启 metric-center 后按「删除→重建同名登记→成功」E2E 复核）
