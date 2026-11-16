# Module 01 监控策略与指标管理 v3 现状评估与重构计划

> **状态**：draft（D-1 / D-2 / D-3 / D-5 已确认；D-4 / D-6 / D-7 待定）
> **分支**：`rewrite/v2.0`
> **日期**：2026-11-16
> **性质**：R4 前的模块输入（现状评估 + 重构计划），本轮不含代码改动。
> **下游产物**：[`api-contract-snapshot-v3.md`](api-contract-snapshot-v3.md)、[`task-sequence.yaml`](task-sequence.yaml)
> **输入**：
> - `docs/02-product-requirements/Modules/SRS/Module_01_Metric_Collection_Center_Requirements.md`（SRS v1.2）
> - `docs/02-product-requirements/Modules/Module_01_Metric_Collection_Center.md`（历史技术 PRD v3.54，字段 / API 细节参考）
> - `docs/05-execution-records/rewrite/v2.0/decisions.md`（D13 / D25 / D26 / D28 / D33 / D35 / D36 / D40）
> - `docs/05-execution-records/rewrite/v2.0/charter.md`、`plan.md`
> - 现有 v3 代码：`platform/modules/{m06,m07,m09}/`、`platform/foundation/`、`platform/db/migrations/v3/`

---

## 1. 结论

1. **M01 在 v3 线尚未开始**：不存在 `platform/modules/m01/`；v3 migration 只到 `00005`；`seed.CoreV3` 不含 M01 数据。M09 当前在 `platform/modules/m09/references/source_reader.go` 中**临时从 M07 `resources` 派生 job**，源码注释已标注 “until M01 v3 lands”。**M01 v3 是 M09 配置包完整化（labels / blackbox / rules）的关键前置**。
2. **重构方式：v3 模块重写，不做原地修补**。旧实现 `platform/strategy/`（生产 4,613 行 / 测试 4,417 行 / 30 条路由 / 7 个资源组）按 `platform/modules/m01/{domain,dto,repository,service,handler,references}` 重建。旧线**冻结保留**（D13 的 legacy 启动模式仍挂 `/api/v2`，不能直接删）。
3. **难点不在 CRUD，而在 4 个跨模块契约**：
   - M01 表成为 M09 配置生成的唯一源（job / targets / labels / blackbox / rules）；
   - 同步状态（`synced/syncing/failed/draft`）的**写回模型**；
   - M07 v3 **label_template 能力已补齐**（`m07_label_templates` + CRUD API，00007）；
   - D40 资源删除的**回收循环**。
4. **规模估算**：后端约 30~34 人日（含回归与审查）、前端约 10~12 人日；按 P0~P7 八个阶段推进，每阶段独立验收、独立提交（schema / API / 功能分开 commit）。

---

## 2. 硬约束（不可协商）

| 约束 | 来源 | 对 M01 的影响 |
|---|---|---|
| 去确认化：无 `pending/confirmed/deployed` 变更单、无人工确认、无回滚 | D25 + SRS §2.2 | 删除 `change_status`、pending 期锁定、`batch-draft-status`；只保留源数据状态 + 同步状态 |
| 所有 Job 绑采集节点域，中心不采集 | D26 + NFR-02 | `network_domain_id` 必填；校验 = M06 存在且 enabled + M09 `registration_status=monitored` |
| 规则平台级全局、中心求值 | D35 / D36 | `monitoring_rules` 无 `network_domain_id`；`job` 引用校验基准 = 全平台 `ready+enabled` Job 并集 |
| 资源删除由 M01 拉取对账回收 | D40 | 新增 60s（可配）对账循环；M07 不反向调用 M01 |
| M01 只写策略源数据，不生成配置、不 reload | NFR-01 | `preview-targets` 仅做只读预演，复用共享 generator，不落盘 |
| 参数保存即快照，映射变更不穿透存量 Job | NFR-06 | 创建时解析生效值落库；「同步映射默认值」仅刷新未覆盖字段 |
| API 统一 `/api/v3/platform/*`，信封 `{status,data}`，分页 `{list,total,page,page_size}` | D38 + M07 v3 契约 | 不复用 legacy `/api/v2` 的 `items` 分页与新 envelope 差异 |
| 上游隔离 | 《代码隔离标准》 | 不修改 `upstream/`；需要时走 `patches/prometheus/` |
| legacy 模式与 v3 模式并存 | D13 | v3 M01 表不得与 legacy AutoMigrate 表冲突（见 §6.2） |

---

## 3. 现状盘点

### 3.1 后端旧代码（`platform/strategy/`）

| 包 | 生产 LOC | 测试 LOC | 职责 | 主要问题 |
|---|---:|---:|---|---|
| `scrapejob/` | 1,997 | 2,210 | Job CRUD、实例选择、安装登记、preview-targets、批量草稿 | `validate.go` 单文件 542 行；handler 直连 `*gorm.DB`；状态机耦合 `change_status` |
| `rule/` | 872 | 924 | 规则 CRUD、YAML 校验、promtool、job 引用 | 校验逻辑分散在 create/update/validate；`promtool_check` 与 handler 耦合 |
| `ci-exporter/` | 515 | 462 | 默认采集配置 CRUD | `is_default` 唯一性靠服务内检查；无 repository 层 |
| `exporter-template/` | 500 | 538 | 采集实现池 CRUD | 内置只读判定散落；引用删除保护在高斯层拼接 |
| `blackboxmodule/` | 399 | 109 | 拨测模块 CRUD | 有 service/repository 雏形，可参考 |
| `metric-library/` | 244 | 174 | 技术指标库 | 仅 list/create/update，无删除 |
| `common/` + `routes.go` | 86 | 0 | 分页、总装配 | 分页与 v3 契约不同 |
| **合计** | **4,613** | **4,417** | 30 条路由（12 个测试文件） | — |

共 30 条路由，分 7 组：`exporter-templates`(5)、`ci-exporter-mappings`(4)、`blackbox-modules`(3)、`scrape-jobs`(9)、`monitoring-rules`(5)、`metric-library`(3)、`business-metrics`(0，仅模型)。

**代码形态**：`func Xxx(db *gorm.DB) gin.HandlerFunc` 闭包式 handler，校验、持久化、响应混杂；无 service 层、无 repository 接口，单元测试大量依赖 SQLite 内存库 + 路由集成。

### 3.2 旧数据模型（`platform/models/`，491 行 / 10 个结构体）

| 表 | 模型 | v3 处置 |
|---|---|---|
| `scrape_jobs` | `ScrapeJob` | 重建；删除 `change_status` / `blackbox_targets` / `filter_rules`(MVP 不用)；新增 `sync_status/sync_version/sync_error/synced_at` |
| `ci_type_exporter_mappings` | `CITypeExporterMapping` | 重建；保留 `is_default`、参数默认值、`label_template_id` |
| `exporter_templates` | `ExporterTemplate` | 重建；内置模板仍由常量 seed |
| `monitoring_rules` | `MonitoringRule` | 重建；删除 `change_status`；`scope` 固定 `central` |
| `exporter_metric_library` | `ExporterMetricLibrary` | 重建 |
| `business_metrics` | `BusinessMetric` | 重建（旧版只有模型，无路由） |
| `exporter_installation_confirmations` | `ExporterInstallationConfirmation` | 重建（可选留痕，不影响 target 生成） |
| `blackbox_modules` | `BlackboxModule` | 重建（平台预置 4 个模块） |
| `blackbox_probes` / `blackbox_targets` | 旧结构 | **不迁移**；`blackbox_targets` 仅保留请求非空即 400 的拒绝语义 |

### 3.3 前端（`ui-custom/web/src/pages/strategy/`）

- 37 个文件，生产 6,633 行 / 测试 4,348 行。
- 主要单体：`ScrapeJobFormDrawer.tsx`(866)、`CollectorTemplatesTab.tsx`(775)、`ScrapeJobListPage.tsx`(718)、`RuleMountDrawer.tsx`(670)、`ScrapeJobDetailDrawer.tsx`(653)。
- API 客户端 6 个：`scrapeJobs.ts`、`ciExporterMappings.ts`、`exporterTemplates.ts`、`monitoringRules.ts`、`metricLibrary.ts`、`blackboxModules.ts`，全部指向 `/api/v2/platform/*`。
- 状态列仍消费 `change_status` / `pending` 锁；`useJobScrapeStatus.ts` 已是 M09 targets 的适配层，可保留思路。

### 3.4 v3 已有基础与缺口

**已有**：

- 模块模式：`platform/foundation/module` 注册表 + `module.go` 组合根 + `foundation/httpapi` 错误映射。
- v3 迁移 runner：`platform/db/migrate.go`，支持 sqlite/postgres 双方言与 goose 标记。
- 跨模块读法先例：`m07/references/reader.go` 直接只读 M01 表；`m09/references/source_reader.go` 直接只读 M07 表。
- 同步基础设施：`m09/service/config_sync_service.go`（按域生成、原子切换、失败不覆盖）、`domain_config_snapshots` 表。
- 查询面：`GET /api/v1/targets`（M09，含 `job/instance/health/last_scrape/last_error/source`），可支撑 FR-13。
- 规则判定可复用件：`platform/strategy/rule/jobref`（无 gorm 依赖）、`promtool_check.go`、`models.ValidPromDuration`、`configcenter/portchain`、`generator.AssembleWithModules`。

**缺口**：

| 缺口 | 现状 | 影响 |
|---|---|---|
| `platform/modules/m01/` | 不存在 | M01 全部 v3 能力未落地 |
| M01 v3 migration | 最新 `00005` | 无表、无 seed |
| M01 v3 契约快照 | 已产出 draft（[`api-contract-snapshot-v3.md`](api-contract-snapshot-v3.md)） | 待 G2 评审冻结 |
| M07 label_template | 已补齐 `m07_label_templates` 表 + CRUD API（00007，2026-11-16） | FR-03 标签模板引导 / Job 模板选择可用 |
| 中心规则同步（D35） | M09 未实现中心 rules 产物与 reload | FR-16 规则同步状态无法闭环 |
| M01 → M09 源接入 | M09 从 M07 resources 临时派生 | Job 启停 / 删除 / blackbox / labels 均无法正确生效 |

---

## 4. 需求差距矩阵

### 4.1 功能需求（SRS §5）

| FR | 能力 | 旧实现 | v3 结论 |
|---|---|---|---|
| FR-01 | 类型 ↔ 采集实现映射、默认标记 | 有 | 重写；`is_default` 唯一性用部分唯一索引 + 服务校验 |
| FR-02 | 采集实现池 CRUD、内置只读、被引用禁删 | 有 | 重写 |
| FR-03 | 标签模板引导与引用 | 有（v1） | 重写；存在性 + 类别匹配校验已生效（M07 `m07_label_templates`） |
| FR-04 | 网域级参数覆盖 | 无 | **MVP 不做**（v0.2+） |
| FR-05 | ScrapeJob CRUD | 有 | 重写 |
| FR-06 | 草稿 / 生效正交，仅 ready+enabled 进候选 | 有，但耦合变更单 | 重写并去掉变更单状态 |
| FR-07 | 参数继承、覆盖标记、同步默认值 | 有 | 逻辑迁入 `domain` 包，补单测 |
| FR-08 | 端口四级解析 | 有（portchain） | 复用共享实现；MVP 生效三级（网域覆盖未做） |
| FR-09 | 手动实例选择、offline 置灰、同网域收敛 | 有 | 重写；候选查询避免 N+1 |
| FR-10 | NPU 类型、候选不按 OS/型号过滤 | 部分 | 补推导与测试 |
| FR-11 | Blackbox 拨测、`target_field` 只读派生、拒绝手填目标 | 有 | 重写，语义按 SRS §5.4 收紧 |
| FR-12 | 同步状态展示 + 失败原因 | 无（仅有 change_status） | **新增**（见 §6.5） |
| FR-13 | 实例级采集状态回显 | 有（前端拼 targets） | 保留思路，改由 v3 targets 契约驱动 |
| FR-14 | 规则 YAML 透传 + 检查/提交两段式 | 有 | 重写，校验管线收敛为单一 service |
| FR-15 | job 引用分级校验 + 逃生门 | 有（jobref） | 复用 jobref；基准改为全平台并集（D36） |
| FR-16 | 规则同步状态 | 无 | **新增**（中心规则同步 + 写回） |
| FR-17 | 字段化规则编辑 | 无 | **v0.3+ 不做** |
| FR-18 | 技术指标库 | 有 | 重写 + 补删除/停用 |
| FR-19 | 业务指标库状态机 | 仅模型 | 新增轻量 CRUD；状态机 `pending→instrumented→online` 校验 |
| FR-20 | Exporter 安装登记 | 有 | 重写；明确「仅留痕、不是 target 前置」 |

### 4.2 非功能需求（SRS §6）

| NFR | v3 设计响应 |
|---|---|
| NFR-01 只维护策略数据 | M01 不写配置、不 reload；`preview-targets` 只读复用 `configcenter/generator` |
| NFR-02 必须绑采集节点域 | 保存时校验 `network_domains`(enabled/edge) + `network_domain_access`(`monitored`)，无 `default` 特例 |
| NFR-03 源变更自动触发同步 | 所有写操作显式刷新 `updated_at`；M09 watcher 指纹扩展 M01 表（含软删） |
| NFR-04 失败不锁死源数据 | 无 pending 锁；`failed` 仅展示，允许直接编辑 |
| NFR-05 选中关系一致性 | 60s 对账循环（D40）+ 保存时存在性强校验 |
| NFR-06 参数快照稳定 | 创建时快照；映射变更不穿透 |
| NFR-07 网域作用域 | 实例候选 / 选中校验限定 Job 网域；规则引用全平台 |
| NFR-08 权限 | MVP 复用全局 auth（platform_admin），M03 v3 落地后按模块接权限 |
| NFR-09 业务语言 | 前端统一「监控对象类型 / 采集实现 / 采集 Job / 同步状态」 |
| NFR-10 错误可执行 | v3 错误码 + 明确 next-action 文案（如「请先到网域管理完成纳管」） |

### 4.3 五个关键差距（实施优先级最高）

1. **同步状态模型**：旧 `change_status` 与 D25 冲突，必须整体替换为 `sync_status` + M09 写回。
2. **M09 源接入**：不切换 source reader，Job 的启停 / 删除 / blackbox / labels 都不会进入配置包。
3. ~~label_template 依赖~~：M07 v3 已补齐，M01 只读消费并校验存在性/类别。
4. **中心规则同步**：D35 未落地，规则的「已同步」无法真实成立。
5. **回收循环**：D40 未实现，M07 删除资源后会留下悬空 `selected_instance_ids`。

---

## 5. 技术债清单（对齐 R1~R4 红线）

| # | 债务 | 证据 | 处置 |
|---|---|---|---|
| R1 | 分层缺失：handler 直连 DB，无 service/repository | `platform/strategy/scrapejob/*.go` 全部 `func(db *gorm.DB)` | v3 按 `handler → service → repository` 分层；纯逻辑进 `domain` |
| R1 | 单文件巨型校验 | `scrapejob/validate.go` 542 行，混合网域、实例、参数、采集器校验 | 拆为 `domain` 纯函数 + service 编排 |
| R2 | 无版本化 migration，依赖 AutoMigrate | `platform/db/db.go` Init() | v3 新增 `00006`（sqlite/postgres 双份）+ Up/Down |
| R3 | 跨模块直接 join / 读表 | `validate.go` 读 `network_domains`/资源表；`jobref` 查 `scrape_jobs` | 统一走 `m01/references` 读端口（只读 SQL 集中在 references） |
| R4 | 模块不自注册，路由集中挂载 | `platform/strategy/routes.go` + `main.go` 手写 | v3 `module.go` 自注册进 `foundation/module.Registry` |
| 状态 | `change_status` / pending 锁 / 批量草稿残留 | `models/scrape_job.go`、`strategy/scrapejob/batch.go` | v3 全部删除；旧线冻结不改 |
| 契约 | v2 envelope + `items` 分页 + 无快照 | `strategy/common/paging.go`、API 客户端 | v3 统一 `{status,data}` + `{list,total,page,page_size}`，补契约快照 |
| 安全 | 采集凭证明文落库 | `ScrapeJob.Password/Token` 列 | v3 至少落密文（AES-GCM / secret ref），响应永不回显 |
| 前端 | 单体页面、状态列耦合旧状态机 | 见 §3.3 | 拆组件 + 换 v3 客户端；删 `change_status` 列 |

---

## 6. 目标架构

### 6.1 目录结构

```text
platform/modules/m01/
├── module.go            # 组合根：Name()/RegisterRoutes()/StartBackground(ctx)
├── domain/              # 纯逻辑，无 gorm / gin
│   ├── monitor_type.go      # 类型推导、候选收敛规则
│   ├── params.go            # 参数层叠、映射覆盖、生效值解析
│   ├── port.go              # 端口解析（复用/提升 configcenter/portchain）
│   ├── blackbox.go          # target_field 派生、资源类别门禁
│   ├── rule.go              # YAML/groups/组名唯一性/jobref 严重级合并
│   └── sync.go              # sync_status 状态机与迁移规则
├── dto/                 # 请求/响应 DTO（snake_case，_id 后缀）
├── repository/          # GORM 记录 + repository 接口实现（一资源一文件）
├── service/             # 用例编排：catalog / job / rule / metric / sync / reconcile
├── handler/             # gin handler + routes.go + errors.go
├── references/          # 跨模块只读端口：resources / label templates / domains
└── seed/                # 内置采集实现、映射、指标、拨测模块
```

后台循环与 M09 同构：`StartBackground(ctx)` 仅在可取消 context（生产）启动，测试传 `context.Background()` 不产生游离 goroutine。

### 6.2 数据模型（migration `00006_m01_strategy`，sqlite + postgres）

**表命名（D-1 推荐）**：v3 使用模块自有前缀 `m01_*`，**不复用 legacy 同名表**。原因：legacy 模式会先跑 AutoMigrate 建出 `scrape_jobs` 等表（含 `change_status NOT NULL`），v3 migration 的 `CREATE TABLE IF NOT EXISTS` 会静默跳过，导致 v3 插入失败、两模式 schema 漂移。新表名让两套 schema 互不干扰，跨模块读取方明确指向 M01 v3 表。

| v3 表 | 关键列 | 说明 |
|---|---|---|
| `m01_exporter_templates` | id(uuid), name(unique), version, default_port, metrics_path, scheme, supported_monitor_types(json), os, arch, download_url, homepage, install_guide, description, is_builtin, source, timestamps, deleted_at | 内置模板只读 |
| `m01_ci_type_exporter_mappings` | id, monitor_type, exporter_template_id, is_default, default_port, metrics_path, scheme, scrape_interval, scrape_timeout, label_template_id, is_builtin, timestamps, deleted_at | 部分唯一索引：(monitor_type) WHERE is_default AND deleted_at IS NULL；(monitor_type, exporter_template_id) WHERE deleted_at IS NULL |
| `m01_scrape_jobs` | id(uuid), job_name(unique), job_type, resource_category, monitor_type(null for blackbox), exporter_template_id(null), network_domain_id(FK), instance_selection_mode, selected_instance_ids(json), scrape_interval, scrape_timeout, metrics_path, scheme, auth_type, username, password_cipher, token_cipher, tls_skip_verify, ca_file, label_template_id, blackbox_module, target_field, mapping_overrides(json), draft_status, enabled, **sync_status, sync_version, sync_error, synced_at**, timestamps, deleted_at | 删除 `change_status`/`blackbox_targets`/`filter_rules` |
| `m01_monitoring_rules` | id(uuid), name, content_mode, rule_content, rule_type, expr, duration, labels(json), annotations(json), monitor_type, exporter_template_id, scope(固定 central), enabled, draft_status, **ack_job_ref_errors, ack_reason**, **sync_status, sync_version, sync_error, synced_at**, timestamps, deleted_at | 无 `network_domain_id`（D36）；逃生门留痕 |
| `m01_metric_library` | id, metric_name, metric_type, help, unit, labels(json), monitor_types(json), category, exporter_template_id, is_builtin, enabled, timestamps, deleted_at | 唯一约束：(metric_name, monitor_type 锚点) 语义同名不同义需允许，故不加全局唯一 |
| `m01_business_metrics` | id, metric_id(unique), metric_name, description, metric_type, unit, business_domain, app_name, threshold_suggestion, owner, register_source, status, timestamps, deleted_at | 状态机 pending→instrumented→online |
| `m01_installations` | id, resource_id, scrape_job_id, status, actual_port, confirmed_by, notes, timestamps | 唯一 (resource_id, scrape_job_id)；仅留痕 |
| `m01_probe_modules` | id, name(unique), content, is_builtin, enabled, timestamps, deleted_at | 预置 http_2xx/icmp_ping/tcp_connect/dns_query；内置行可停用、不可删/改 content |

**seed**：新增 `platform/db/seed/m01_v3.go`（幂等），在 `runV3` 与 legacy 模式 `MigrateV3` 之后调用；数据源复用现有常量 `models.BuiltinExporterTemplates()`、`DefaultBlackboxModules()` 与指标库 seed，避免两份真相。

**数据迁移**：`data_migration: none`。v3 从空库 + seed 开始（charter §6）；旧租户数据不搬迁。

### 6.3 API 契约草案（`/api/v3/platform`）

| 组 | 方法与路径 | 说明 |
|---|---|---|
| 采集实现 | `GET/POST /exporter-templates`；`GET/PUT/DELETE /exporter-templates/{id}` | 内置行 PUT/DELETE → 403；被映射引用 → 409 |
| 默认采集配置 | `GET/POST /ci-exporter-mappings`；`PUT/DELETE /ci-exporter-mappings/{id}` | `is_default` 冲突 → 409；删除被 Job 引用 → 409 |
| 采集 Job | `GET/POST /scrape-jobs`；`GET/PUT/DELETE /scrape-jobs/{id}` | 列表项内联 `sync` 对象 |
| 实例候选 | `GET /scrape-jobs/instance-candidates?monitor_type&network_domain_id&keyword&page&page_size` | offline 返回并标记 `selectable=false` |
| 实例/安装 | `GET /scrape-jobs/{id}/instances`；`POST/DELETE /scrape-jobs/{id}/instances/{resource_id}/confirm` | 选中实例 + 安装留痕 |
| 预演 | `POST /scrape-jobs/{id}/preview-targets` | 只读解析 targets，不落盘（NFR-01） |
| 监控规则 | `GET/POST /monitoring-rules`；`GET/PUT/DELETE /monitoring-rules/{id}`；`POST /monitoring-rules/validate` | 兼容旧 `:id/validate-yaml` 语义；`id=0` 表示新建 |
| 指标库 | `GET/POST /metric-library`；`PUT /metric-library/{id}` | 内置指标只读 |
| 业务指标 | `GET/POST /business-metrics`；`PUT /business-metrics/{id}` | 状态流转校验 |
| 拨测模块 | `GET/POST /blackbox-modules`；`PUT/DELETE /blackbox-modules/{id}` | 被 Job 引用时禁删 |

统一约定：列表响应 `{list,total,page,page_size}`；`page_size` 默认 20、上限 100；错误 `bad_request/unauthorized/forbidden/not_found/conflict/internal`；凭证字段只写不回显。

### 6.4 跨模块端口与依赖方向

```text
            ┌─────────────── 读（只读表 / 端口）───────────────┐
            │                                                 │
   M06 network_domains        M07 resources / label_templates │
            ▲                                                 ▲
            │                                                 │
   ┌────────┴─────────┐        ┌───────────────────────┐      │
   │  M01 (strategy)  │        │  M09 (config sync)    │──────┘
   │  m01_* tables    │◄───────│  source reader        │
   │  SyncResultSink  │◄───────│  sync result sink     │
   └──────────────────┘        └───────────────────────┘
```

| 端口 | 定义位置 | 实现 | 用途 |
|---|---|---|---|
| `references.Resources` | `m01/references` | 直接只读 M07 `resources` + 6 张扩展表 | 候选实例、存在性、地址/标签字段 |
| `references.LabelTemplates` | `m01/references` | 只读 `m07_label_templates`（已落地） | 模板名称、类别、默认标记；删除引用计数 |
| `references.Domains` | `m01/references` | 只读 `network_domains` + `network_domain_access` | 纳管校验、可选项列表 |
| `references.SyncSink` | `m09/references` | M01 service 实现 | M09 生成/校验后回写 per-job / per-rule 同步结果 |
| `references.SourceReader` | `m09/references` | 直接只读 `m01_scrape_jobs` / `m01_monitoring_rules` / `m01_probe_modules` | 配置生成输入 |

依赖方向：**M09 → M01（读表 + 调 sink）**，M01 不 import M09；M01 → M07/M06 只读。`v3.go` 负责把 Sink 注入 M09，避免 Go import 环。与 D23 `MonitoringRetirer`、D31 `AlertmanagerSnapshotSink` 同一模式。

### 6.5 同步状态与采集状态口径

**同步状态（M01 持有）**：`sync_status ∈ {draft, pending, syncing, synced, failed}`。

| 事件 | 状态迁移 |
|---|---|
| 新建/编辑/启停（`ready && enabled`） | → `pending`，清空 `sync_error`，刷新 `updated_at` |
| `draft_status=draft` 或 `enabled=false`（不在候选集） | → `draft`（UI 结合 `enabled` 显示「已停用」） |
| M09 开始生成 | → `syncing`（可选，best-effort） |
| M09 生成成功且 Job 被纳入当前快照 | → `synced`，写 `sync_version` / `synced_at` |
| M09 校验失败且归因 `user_config` 且命中该 Job/规则 | → `failed`，写 `sync_error` + 可跳转 M09 快照 |
| M09 归因 `platform_fault` | → `failed`，`sync_error` 标注平台侧，用户可重试 |

**写回协议**：M09 `ConfigSyncService` 在生成/校验后调用 `SyncResultSink.RecordDomainSync(ctx, domainID, version, generatedAt, []JobOutcome)`；规则走 `RecordRuleSync`。M01 按 `updated_at <= generatedAt` 更新，避免覆盖生成期间用户的新编辑（新编辑保持 `pending`）。这与 SRS §8.4「M09 返回同步结果与校验和；M01 将同步状态回写到 Job/规则」一致。

**采集状态（只读）**：Job 详情页由前端把 `GET /api/v1/targets?job=<job_name>` 与选中实例做交集，派生 `待采集 / up / stale / down / unknown`；M01 后端只返回选中实例与安装留痕，不复制 targets 数据。

---

## 7. 复用 / 重写 / 删除矩阵

| 类别 | 内容 | 处置 |
|---|---|---|
| 直接复用 | `strategy/rule/jobref`（无 gorm）、`promtool_check.go` 的归因逻辑、`models.ValidPromDuration`、`configcenter/portchain`、`models.BuiltinExporterTemplates`、`DefaultBlackboxModules`、monitor_type 推导表 | 迁入 `m01/domain` 或提升为共享包；保留既有单测 |
| 重写 | `scrapejob` 全部 CRUD/校验/选择/安装/preview；`ci-exporter`、`exporter-template`、`rule`、`metric-library`、`blackboxmodule` | 按 v3 分层重建；逻辑用测试锁定后搬迁 |
| 新增 | `sync_status` 写回、M09 源接入、中心规则同步、D40 对账循环、业务指标 CRUD、实例状态聚合 | 见 §8 |
| 删除（v3 不实现） | `change_status` 状态机、pending 锁、`batch-draft-status`、手填 `blackbox_targets`、`clone`（未实现）、`filter_rules`（MVP 不用） | 旧线冻结不改，仅 v3 不出现 |
| 前端 | 6 个 v2 API 客户端、列表/表单/规则页、状态列 | 改 v3 契约；拆单体组件；删除 `change_status` 与锁逻辑 |

---

## 8. 分阶段重构计划

> 每个阶段独立提交、独立验收；schema commit 与功能 commit 分开。估算为单人日，含测试。

### P0 决策与契约冻结（1 人日）

- 确认 §10 的 D-1~D-7；确定表命名、同步写回模型、MVP 裁剪。
- 产出 `modules/module-01/api-contract-snapshot-v3.md`（draft）与 `task-sequence.yaml`。
- **验收**：owner 确认；契约快照覆盖 §6.3 全部端点与错误码。

### P1 骨架 + schema + seed（2~3 人日）

- `00006_m01_strategy.sqlite.sql` / `.postgres.sql`（Up/Down，8 张表 + 索引）。
- `repository` 记录与接口、`module.go`、空路由、`v3.go` 注册（system → m06 → m07 → **m01** → m09 → auth）。
- `seed/m01_v3.go`（内置采集实现 / 映射 / 指标 / 拨测模块，幂等）。
- **验收**：v3 模式启动 `registry.Names()` 含 `m01`；迁移 up/down 于空库通过；seed 二次执行无变更；repository 单测通过。

### P2 采集实现池 + 默认采集配置（3~4 人日，已完成 2026-11-16）

- FR-01 / FR-02：CRUD、内置只读、被引用禁删、`is_default` 唯一。
- FR-03：模板引用校验与列表展示（M07 `m07_label_templates`；存在性 + 类别匹配）。
- **验收**：契约测试 + 冲突/禁删错误码；与 M07 模板端口联调（若已就绪）。

### P3 ScrapeJob 核心（6~7 人日）

- FR-05/06/07/08/09/10/11：CRUD、参数快照与覆盖、同步默认值、端口解析、实例候选（offline 置灰、NPU、同网域）、blackbox 派生与拒绝手填目标、preview-targets。
- 校验矩阵：网域纳管、实例存在/同域/类别、认证 TLS 组合、duration 合法性、`job_name` 唯一。
- 凭证落密文（安全审查前置项）。
- **验收**：SRS §9.1 第 3/4/6/7/8 条单测覆盖；候选查询无 N+1（基准测试）。

### P4 M09 Job 源接入 + Job 同步/采集状态（4~5 人日，含 M09 改动）

- M09 `references/source_reader.go` 切换为 `m01_scrape_jobs`（含启停/软删/labels/blackbox），`Fingerprint` 覆盖 M01 表与软删时间。
- M09 `configgen` 接入 moduleDefs；每域 outcomes 通过 `SyncResultSink` 回写（§6.5）。
- M01 列表/详情返回 `sync` 对象；失败原因可跳转 M09 快照。
- FR-12 / FR-13。
- **验收**：端到端「保存 Job → watcher 生成快照 → synced」；校验失败 → `failed` + 原因；禁用/删除 → target 移除。

### P5 监控规则 + 中心规则同步（4~5 人日）

- FR-14/15/16：规则 CRUD；YAML/groups/组名全局唯一/promtool/jobref 分级（全平台并集、逃生门留痕）。
- M09 中心规则产物（centerEvaluator=true）+ reload（D35）；规则 outcomes 经 `SyncResultSink.RecordRuleSync` 回写。
- **验收**：`validate` 响应形状与旧契约兼容（`valid/error/job_ref`）；error 级需 ack 才能提交；promtool 缺失降级 warning；规则保存 → 中心生效 → `synced`。

### P6 指标库 + 安装登记 + 对账循环（3~4 人日）

- FR-18/19/20：技术指标库（含停用）、业务指标状态机、安装留痕。
- D40：`ReconcileLoop`（默认 60s，`m01.Options.ReconcileInterval` 可配），批量回收失效/跨域实例，刷新 `updated_at`。
- **验收**：删除资源后 ≤60s 从 `selected_instance_ids` 回收；循环可停止、测试不泄漏 goroutine。

### P7 前端重构 + 旧线冻结 + 回归（8~10 人日，与 P2~P6 并行）

- F1 契约层：6 个 API 客户端切 `/api/v3/platform`，类型补 `sync`、去 `change_status`。
- F2 列表/表单：同步状态列 + 失败原因 + 跳转；移除 pending 锁与批量草稿；拆 `ScrapeJobFormDrawer` / `CollectorTemplatesTab`。
- F3 规则页：检查/提交两段式、逃生门、标签预览；指标库与拨测模块页。
- F4 验证：目标 `vitest`、`typecheck:test`、`pnpm lint`；保留 `InstanceSelector` / `LabelTemplateSelectDrawer` 交互测试思路。
- **验收**：M01 页面无 `/api/v2` 调用；无 `change_status`；NFR-09 文案检查通过。

### 提交切分建议

1. `m01: 新增 v3 schema 与 seed`（仅 migration + seed）
2. `m01: 骨架与模块注册`
3. `m01: 采集实现池与默认采集配置`
4. `m01: 采集 Job CRUD 与校验`
5. `m01: 实例候选与拨测`
6. `m09: 接入 M01 源与同步结果写回`
7. `m01: 监控规则`
8. `m01: 指标库与对账循环`
9. `web: M01 页面切 v3 契约`

---

## 9. 验证与验收

### 9.1 测试矩阵

| 层 | 范围 | 要求 |
|---|---|---|
| domain 单测 | 参数层叠、端口解析、blackbox 派生、规则严重级、sync 状态机 | 纯函数表驱动，无 DB |
| repository | 8 张表 CRUD、唯一约束、软删、分页 | SQLite 内存 DSN |
| service | 校验矩阵、跨模块端口 mock、冲突/禁删 | testify mock |
| handler | 契约快照 golden、错误码、分页信封 | httptest + gin |
| 集成 | m01 + m09：保存→生成→写回；禁用/删除；规则中心同步 | `v3.go` 装配 |
| 前端 | 目标页面 vitest、`typecheck:test`、lint | 按 testing-tdd §4.2 |

### 9.2 验收口径

- SRS §9.1 功能验收 14 条逐条映射到测试或 E2E 动线（缺少项在 `acceptance.md` 标注）。
- SRS §9.2 非功能验收 6 条：重点验证「M01 不生成配置 / 不 reload」「全部绑采集节点域」「失败不锁死」「回收循环」。
- 安全：凭证不回显、越权写拒绝、SQL 注入/分页边界、模板内容 XSS 不作为后端职责但需前端转义。
- 门禁：`go test ./platform/...`、`go vet ./platform/...`、前端目标测试 + typecheck + lint、v3 服务启动与健康检查。

---

## 10. 风险与待决

### 10.1 风险

| 风险 | 影响 | 应对 |
|---|---|---|
| M09 集成排期晚于 M01 | 同步状态长期 `pending`，无法验收 FR-12/16 | P4 与 M09 任务合并排期；P3 先交付无 sync 的 CRUD |
| M07 label_template 变更 | 模板删除 / 类别调整影响 M01 引用 | M07 删除前经 M01 引用计数端口拦截；M01 保存时校验存在性与类别 |
| legacy/v3 双管线并存 | 过渡期配置来源歧义 | v3 表独立命名；legacy 模式不启动 M09 watcher（现状）；文档标注 |
| 前端一次性切换 | 回归面大 | F1 契约层先行 + 按页切换；保留旧客户端到所有页面迁完 |
| promtool 不可用 | 规则语义校验缺失 | 沿用旧归因：unavailable 只提示不阻断 |
| 候选查询性能 | 大资源量下列表慢 | 单次 JOIN + 索引（domain/category/status）；基准测试 |
| 凭证加密方案未定 | 安全审查阻塞 | P3 前确认 secret ref / AES-GCM，避免明文 |

### 10.2 待决（需 owner 确认）

| ID | 决策 | 结论 / 推荐 | 状态 |
|---|---|---|---|
| D-1 | v3 表命名与 legacy 共存 | **`m01_*` 新表**，不复用同名表 | ✅ 2026-11-16 确认 |
| D-2 | 同步状态归属 | **M01 持有列 + M09 调 `SyncResultSink` 写回**（SRS §8.4） | ✅ 2026-11-16 确认 |
| D-3 | label_template v3 归属 | M07 新增 `m07_label_templates` + CRUD API；M01 只读 + 引用计数 | ✅ 2026-11-16 完成 |
| D-4 | 中心规则同步（D35）落地时点 | 与 P5 同批实现（M09 center rules + reload） | ⏳ 待定 |
| D-5 | 数据迁移 | **none**（空库 + seed） | ✅ 2026-11-16 确认 |
| D-6 | MVP 裁剪 | FR-04/09-filter/17 不做；FR-19 仅轻量 CRUD | ⏳ 待定 |
| D-7 | 旧 API / 前端切换节奏 | 契约层先行、按页切换，v3 模式为验收基线 | ⏳ 待定 |

---

## 11. 下一步

1. ~~Owner 确认 D-1~D-7~~ → D-1 / D-2 / D-3 / D-5 已确认（2026-11-16）；D-4 / D-6 / D-7 待定。
2. ~~产出契约快照与任务序列~~ → 已完成：[`api-contract-snapshot-v3.md`](api-contract-snapshot-v3.md)、[`task-sequence.yaml`](task-sequence.yaml)（30 个任务，B0 已完成）。
3. ~~P1（`00006` schema + repository + seed + 模块骨架）~~、~~P2（采集实现池 + 默认采集配置）~~ → 已完成（2026-11-16，见 [`backend-execution.md`](backend-execution.md)）；下一步 **B3 ScrapeJob 核心**。
4. 与 M09 负责人对齐 P4 的 `SourceReader` / `SyncResultSink` / 中心规则同步接口，避免两端各自演进。
5. D-3 已关闭；继续推进 D-4（M09 中心规则）与 D-6/D-7 的 owner 决策。
