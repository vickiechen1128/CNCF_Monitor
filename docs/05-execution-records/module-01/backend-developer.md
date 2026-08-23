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