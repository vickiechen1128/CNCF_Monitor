# Module_01 后端开发执行记录（backend-developer）

> 本文件记录 Module_01「监控策略与指标管理」Phase 3 MVP 后端全部 micro-task 的执行情况，
> 供 golang-reviewer 分片推进与 Orchestrator 验收。

## 提交与任务对照

| # | Task | commit_group | commit hash | 状态 |
|---|------|--------------|-------------|------|
| 1 | T01-01/T01-02：models 补齐 + 种子扩充 | models-baseline | `58ff9f0a` | done |
| 2 | T01-03/T01-04：ExporterTemplate + CITypeExporterMapping API | ci-exporter | `1f8f5360` | done |
| 3 | T01-05/T01-06：ScrapeJob CRUD + 实例候选/安装确认/预览 | scrape-job | `5ebbc066` | done |
| 4 | T01-07：MonitoringRule CRUD + validate-yaml | rule | `9eacde1f` | done |
| 5 | T01-08：技术指标库 API | metric-library | `d9b2a618` | done |
| 6 | T01-09：路由收口 + main.go 接入 + 集成验收 | routes-integration | `61ed552f` | done |

分支：`feat/module-01-strategy`（基自 develop）。

## 验证结果

- `go build ./platform/...` ✅
- `go vet ./platform/...` ✅
- `go test ./platform/...` ✅（全绿：models / db / seed / admin/networkdomain / config/resource / config/label / cmd/metric-center / strategy/*）

## 变更清单（新增）

- `platform/models/`：blackbox_target.go、exporter_metric_library.go、
  exporter_installation_confirmation.go、monitor_type.go；`scrape_job.go` 追加
  `BlackboxTargets` 与 `Password` 字段（仅存储不回显明文）。
- `platform/db/seed/`：exporter.go（补 kafka/snmp + 映射）、metric_library.go（内置
  指标最小集、含拨测三件套）、ten_domain.go（网域 is_monitored=true）。
- `platform/strategy/exporter-template/`、`ci-exporter/`、`scrapejob/`、`rule/`、
  `metric-library/`：各子包 list/create/update/delete/validate/routes + 测试；`routes.go`
  收口五子包。
- `platform/cmd/metric-center/main.go` 接入 `strategy.RegisterRoutes`；`main_test.go`
  补充策略域模型迁移；`strategy_integration_test.go` 端到端验收。

## 关键实现决策（对齐 task-sequence 与 api-contract-snapshot）

- 分页信封统一 `list` 键，默认 page_size=20 上限 100；子资源 instances 用 `items`。
- 路由前缀统一 `/api/v2/platform`。
- `change_status` 由 M09 pull 回写，本模块仅维护 `updated_at` 不主动通知。
- ExporterInstallationConfirmation 主键维度 `(resource_id, scrape_job_id)`，
  exporter_template_id 为冗余缓存不参与唯一。
- 网域「已纳管」= `IsMonitored==true && Status==enabled`；冻结（status=disabled）拒绝保存。
- 内置（is_builtin=true）ExporterTemplate / 指标库只读（forbidden）。
- 规则 YAML 校验至少校验顶层 `groups` 存在且为数组，不做 PromQL 语义校验。

## 对现有测试的兼容修复

- `main_test.go` 的 `buildIntegrationEngine` 原本未迁移 `ExporterMetricLibrary` 表，
  导致 `seed.Run`（T01-02 起会写入内置指标库）报 `no such table`。已在 AutoMigrate
  补该模型，修复既有的 M06/M07 端到端测试回归。

## 阻塞与待 #决策

- 无阻塞。
- 待建：`docs/05-execution-records/module-01/backend-developer.md` 以外的执行记录
  （frontend-developer 的 F 组任务不在本期后端范围）。
- `scripts/review-precheck.sh` 的未提交改动来自上一会话（与后端开发无关），未纳入本期提交。
## 2026-08-26（user-verify-fix）

### 规则创建 enabled 缺省默认 true（修复「保存并下发后规则变停用」）

#### 问题
- 用户验收反馈：规则挂载抽屉点击「保存并下发」后，规则状态显示「停用」。与采集 Job「创建默认启用」（PRD §8）不一致；且 PRD §5.5 明确 `enabled=false` 的规则会被从生成的 rules.yml 摘除，「提交一个停用规则」语义自相矛盾。
- 根因：前端 `RuleMountDrawer` 创建请求漏传 `enabled`；后端 `CreateMonitoringRuleRequest.Enabled` 为非指针 `bool` 且无默认值兜底，Go 零值 `false` 直接落库（`platform/strategy/rule/create.go`）。

#### 修复
- `platform/strategy/rule/create.go`：`Enabled` 改为 `*bool`，缺省（未传）默认 `true`（注释标注对齐 M01 PRD §8「创建默认启用」）；显式传 `false` 仍尊重调用方（停用挂载场景）。
- 前端同步修复见 `frontend-developer.md`（创建请求显式携带 `enabled: true`，双保险）。

#### 新增/修改测试（monitoring_rule_test.go）
- 新增 `TestCreateMonitoringRuleDefaultEnabled`：不传 enabled → 落库 `enabled=true`；显式 `enabled=false` → 落库停用。

#### 契约同步
- `api-contract-snapshot.md` §7 POST `/monitoring-rules` 请求体 `enabled` 标注「缺省 true」。

#### 验证
- `go test ./platform/strategy/rule/...`、`go test ./platform/...` 全绿；`go vet ./platform/...` 通过。

## 2026-08-26（规则管理增强 F-24：合并语义 + 组名唯一 + monitor_type）

### 背景
- 用户提出「按 CI 类型自定义多条规则」诉求（DeepSeek 分析引出）：`renderRules` 原样字符串拼接多条规则内容，会拼出重复顶层 `groups:` 键的非法 rules.yml；`MonitoringRule.MonitorType` 列已存在但接口不接、不可筛选。

### 实现（用户拍板方案 A）
- `platform/configcenter/generator/render.go`：`renderRules` 由字符串拼接改为「逐条解析 groups → `yaml.Node` 节点级合并为单个 `groups:` 文档」（各 group 内容不重排）；解析失败的存量脏数据跳过；`generator.go` 注释同步。
- `platform/strategy/rule/validate.go`：新增 `extractGroupNames`（空 name / 文件内重名报错）与 `validateGroupNamesAvailable`（查 `enabled=true AND draft_status=ready`、排除自身，撞名 bad_request 并点名占用方）。
- `create.go`：请求体加 `monitor_type`（可空，非空校验 `models.ValidMonitorType`）；enabled=true 时校验组名全局唯一。
- `update.go`：请求体加 `monitor_type *string`；应用变更后若规则生效（`enabled && draft_status=ready`）校验组名唯一（排除自身）；停用规则不校验，停用后组名释放。
- `list.go`：新增 `monitor_type` query 过滤。

### 新增/修改测试
- `generator/generator_test.go`：`TestAssembleRulesYAMLPassthrough` 强化为「合并产物重新解析合法、恰含 2 个 group、顶层 `groups:` 仅出现一次」。
- `strategy/rule/monitoring_rule_test.go`：新增 `TestExtractGroupNames`、`TestCreateMonitoringRuleGroupNameConflict`、`TestCreateMonitoringRuleMonitorType`（含列表筛选断言）、`TestUpdateMonitoringRuleGroupNameConflict`；存量双规则用例改用不同组名。

### 契约/文档同步
- `api-contract-snapshot.md` §7：GET 加 `monitor_type` 筛选、POST/PUT 请求体加 `monitor_type?`、业务错误补「monitor_type 非法 / group 名冲突」、注记补合并语义；`dev-feedback.md` F-24 登记（待 design 收割 PRD §5.5）。

### 验证
- `go test ./platform/...` 全绿；`go vet ./platform/...` 通过。
- 提示：后端改动需 `make run-metric-center` 重启后前端实测生效。

## 2026-08-26（F-27 C：映射 ↔ 采集器支持类型校验）

### 背景
- 用户追问 supported_monitor_types 与默认采集配置不对齐的后果：此前该字段仅预填/展示，无校验 → 元数据失真。用户拍板加后端硬校验（A+B+C 方案中的 C）。

### 实现
- `platform/strategy/ci-exporter/create.go`：新增 `ensureExporterSupportsType`——采集器 `supported_monitor_types` 非空且不含所选 `monitor_type` 时 bad_request（错误文案带声明清单）；`validateMappingReq` 在 exporter 存在性校验后调用。
- `platform/strategy/ci-exporter/update.go`：`verifyExporter` 重构为 `loadExporterByID`（返回模板）；保存前按最终生效的（monitor_type, exporter_template_id）校验支持类型。
- 兼容口径：`supported_monitor_types` 为空（未标注存量模板）放行。

### 测试
- `ci_exporter_test.go` 新增 `TestMappingExporterSupportTypeGuard`：不匹配建单 400 / 匹配放行 / 未标注放行 / 更新撞类型 400。
- `go test ./platform/...` 全绿；`go vet` 通过。

### 契约同步
- `api-contract-snapshot.md` §4 POST/PUT 业务错误补「采集器支持类型声明不匹配」。

## 2026-08-26（F-28：采集参数层叠默认 + 稀疏覆盖，interval/timeout 渲染补齐）

### 背景
- 用户实测质疑「端口/路径填 3 遍、间隔/超时填 2 遍」，并发现 Job 上的 scrape_interval/scrape_timeout 从未写入 prometheus.yml（generator `scrapeConf` 缺字段，静默丢失）。用户拍板方案 A（V1 层叠默认 + 稀疏覆盖，留空=继承）。

### 实现
- `platform/models/scrape_job.go`：新增全局兜底常量 `DefaultScrapeInterval=15s` / `DefaultScrapeTimeout=10s` / `DefaultMetricsPath=/metrics` / `DefaultScheme=http`（层叠默认链末端）。
- `platform/strategy/scrapejob/validate.go`：摘除 standard 任务 4 参数硬必填；`inheritDefaultsFromMapping` 升级为 `resolveJobScrapeParams`——逐字段三层回落：默认采集配置（is_default 映射，可稀疏）→ 采集器模板（仅 metrics_path/scheme）→ 全局兜底；label_template_id 仅映射层继承。blackbox 任务跳过。
- `platform/strategy/scrapejob/create.go`：ready 分支改调 `resolveJobScrapeParams`（保存时解析为生效快照，决策 14 快照语义不变）。
- `platform/strategy/scrapejob/update.go`：补上回落调用——编辑时清空某字段即「恢复继承」，不再报必填。
- `platform/strategy/scrapejob/batch.go`：`BatchSubmitReady` 先逐条解析参数再完整校验，状态翻转与解析结果逐条 Save 落库（保持 all-or-nothing 语义）。
- `platform/configcenter/generator/render.go`：`scrapeConf` 补 `scrape_interval/scrape_timeout` 字段真实渲染；metrics_path/scheme/interval/timeout 空值按全局兜底常量回填（`orDefault`，存量/异常数据防线）。

### 测试
- `scrape_job_test.go` 新增 `TestCreateScrapeJobGlobalDefaultFallback`（无映射→全局兜底）/ `TestCreateScrapeJobTemplateFallback`（映射稀疏→模板回落）/ `TestUpdateScrapeJobClearFieldReInherits`（清空即恢复继承）。
- `batch_test.go`：AutoMigrate 补 mapping/template 表；`TestBatchSubmitReady_ValidateBeforeReady` 失败用例改用清水 monitor_type（采集参数留空已不再失败）；新增 `TestBatchSubmitReady_ResolvesEmptyScrapeParams`（留空解析+落库断言）。
- `generator_test.go` 新增 `TestAssembleRendersScrapeIntervalTimeout`（显式渲染 + 留空兜底 + 逐 job YAML 解析断言）。
- `go test ./platform/...` 全绿；`go vet ./platform/...` 通过。

### 契约同步
- `api-contract-snapshot.md` §5 关键字段、§10 字段必填口径（映射/Job 参数改「可留空=继承」）；`dev-feedback.md` F-28 登记；M09 生成器渲染补齐同步登记 `integration/v0.1/issues.md`。
- 提示：后端改动需 `make run-metric-center` 重启后前端实测生效。
