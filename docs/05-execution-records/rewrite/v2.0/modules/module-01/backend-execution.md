# Module 01 v3 后端执行记录

> **分支**：`rewrite/v2.0`
> **范围**：P1 / B1（schema + repository + seed + 模块骨架）、B2（采集实现池 + 默认采集配置）、B2-3（M07 标签模板接入）、B3（ScrapeJob 核心）、B4（M09 源接入 + 中心规则同步 + 写回）、B5（监控规则 CRUD/校验）、B6（指标库/拨测模块/对账循环）
> **状态**：B1–B6 完成（凭证加密、前端、B8 待后续）
> **任务序列**：[`task-sequence.yaml`](task-sequence.yaml)（T01-B1-1 ~ T01-B1-4）
> **契约**：[`api-contract-snapshot-v3.md`](api-contract-snapshot-v3.md)

---

## 1. B1 变更清单

| 任务 | 产物 | 说明 |
|---|---|---|
| B1-1 | `platform/db/migrations/v3/00006_m01_strategy.{sqlite,postgres}.sql` | 8 张 `m01_*` 表 + 部分唯一索引 + CHECK + 域 FK；Up/Down 对称 |
| B1-1 | `platform/db/m01_migration_test.go` | 00006 专项测试：表、唯一约束、软删复用、FK、CHECK、Down |
| B1-1 | `platform/db/migrate_test.go` | 生命周期 / M06 / M09 测试适配「00006 为最新」 |
| B1-2 | `platform/modules/m01/domain/` | `doc.go` / `enums.go` / `entities.go` / `id.go` / `errors.go`；纯类型 + 枚举 + UUID + apierror 错误 |
| B1-2 | `platform/modules/m01/repository/` | 8 张表的 record 映射、接口与 GORM 实现；分页/关键字/软删/冲突映射 |
| B1-2 | `platform/modules/m01/repository/repository_test.go` | 8 个 repository 的 CRUD / 冲突 / 软删 / JSON roundtrip |
| B1-3 | `platform/modules/m01/seed/seed.go` | 内置采集实现 / 默认映射 / 技术指标 / 拨测模块；create-only 幂等 |
| B1-3 | `platform/modules/m01/seed/seed_test.go` | 计数、builtin 标记、二次执行幂等、不覆盖用户默认 |
| B1-4 | `platform/modules/m01/module.go` | 组合根：构造 8 个 repository；`Name()` + `RegisterRoutes()` |
| B1-4 | `platform/modules/m01/handler/routes.go` | 路由空壳（B2+ 按资源组挂载） |
| B1-4 | `platform/modules/m01/{service,dto,references}/doc.go` | 分层占位，锚定 R1 边界 |
| B1-4 | `platform/cmd/metric-center/{v3.go,main.go}` | registry 顺序 `system → m06 → m07 → m01 → m09 → auth`；两种启动模式都执行 M01 seed |
| B1-4 | `platform/cmd/metric-center/v3_test.go` | meta.modules 断言补 `m01` |

---

## 2. Schema 要点（`00006`）

- **命名**：`m01_*` 前缀，避免与 legacy AutoMigrate 的同名表（`scrape_jobs` 等，含 `change_status NOT NULL`）冲突（D-1）。
- **表**：`m01_exporter_templates` / `m01_ci_type_exporter_mappings` / `m01_scrape_jobs` / `m01_monitoring_rules` / `m01_metric_library` / `m01_business_metrics` / `m01_installations` / `m01_probe_modules`。
- **关键约束**：
  - `job_name`、`name`（采集实现 / 拨测模块）、`metric_id` / `metric_name`（业务指标）仅在未软删行内唯一；
  - 每个 `monitor_type` 至多一个 `is_default` 映射（部分唯一索引）；
  - 内置技术指标按 `metric_name` 唯一（用户指标可同名不同锚点）；
  - `network_domain_id` 外键指向 `network_domains`；
  - 枚举值由 CHECK 兜底（`job_type` / `auth_type` / `sync_status` / `scope=central` 等）。
- **同步列**：Job / Rule 持有 `sync_status` / `sync_version` / `sync_error` / `synced_at`（D-2）；规则另有 `ack_job_ref_errors` / `ack_reason`。
- **可选引用**：`exporter_template_id` / `label_template_id` / `blackbox_module` 以空串表示「未设置」，由 service 校验存在性，**不建 FK**（否则空串无法通过）。
- **数据迁移**：`none`（D-5）；v3 从空库 + seed 开始。

---

## 3. Seed 行为

| 数据 | 来源 | 数量 | 幂等策略 |
|---|---|---|---:|---|
| 采集实现 | `models.BuiltinExporterTemplates()` | 6 | 按 name 存在即跳过 |
| 默认映射 | `seed.DefaultMappings()` | 6 | 按 (monitor_type, exporter) 存在即跳过；已有用户默认时不抢占 |
| 技术指标 | `db/seed.BuiltinMetricLibrary()` | 19 | 按 builtin metric_name 存在即跳过 |
| 拨测模块 | `models.DefaultBlackboxModules()` | 4 | 按 name 存在即跳过 |

两种启动模式均执行：`runV3` 在 `seed.CoreV3` 之后、legacy 模式在 `MigrateV3` + `seed.BusinessDomains` 之后。

---

## 4. 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/db/...
ok  github.com/metriccenter/metriccenter/platform/db
ok  github.com/metriccenter/metriccenter/platform/db/seed

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/modules/m01/...
ok  github.com/metriccenter/metriccenter/platform/modules/m01
ok  github.com/metriccenter/metriccenter/platform/modules/m01/repository
ok  github.com/metriccenter/metriccenter/platform/modules/m01/seed

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/cmd/metric-center/...
ok  github.com/metriccenter/metriccenter/platform/cmd/metric-center

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过（含 m06 / m07 / m09 / legacy strategy）

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 服务启动（临时库 `/tmp/m01_v3_e2e.db`，端口 18080）：

```text
GET /api/v3/platform/health  -> {"data":{"status":"ok"}}
GET /api/v3/platform/ready   -> {"data":{"driver":"sqlite","schema_version":6,"status":"ready"}}
GET /api/v3/platform/meta    -> modules=["system","m06","m07","m01","m09","auth"]

m01_exporter_templates        6
m01_ci_type_exporter_mappings 6
m01_metric_library            19
m01_probe_modules             4
m01_scrape_jobs               0
```

---

## 5. 偏差与备注

1. **路由为空**：`handler.RegisterRoutes` 在 B1 不注册任何端点，仅验证模块可装配。B2 起按 §6.3 契约逐组挂载；未挂载路径返回 404（不是 401），符合「骨架阶段」预期。
2. **seed 为 create-only**：不复写既有行，避免覆盖用户对内置采集实现 / 拨测模块的调整；代价是代码内种子数据变更不会自动回填存量库。后续如需回填，按 M06 的「启动对账」模式单独加任务。
3. **`m01_probe_modules` 增加 `is_builtin`**：契约 §7.3 原写「由名称集合判定」，落库后改为显式列，便于内置行保护与后续自定义模块。契约与 assessment 已同步。
4. **repository 不做业务默认值**：`JobType` / `Scheme` / `AuthType` / `SyncStatus` 等默认值由 B3 的 service 层补齐，repository 只做持久化与约束映射；测试显式构造完整实体。
5. **PostgreSQL 未实跑**：本环境无 PG；`00006_m01_strategy.postgres.sql` 按 SQLite 同构编写（`jsonb` + 部分唯一索引），待 R3 环境验证。


---

## 6. B2 变更与验证（采集实现池 + 默认采集配置）

| 任务 | 产物 | 说明 |
|---|---|---|
| B2-1 | `domain/{monitor_type,params}.go` | 监控对象类型白名单、Prometheus duration/端口/路径校验（纯函数） |
| B2-1 | `dto/exporter_template.go` + `service/exporter_template.go` + `handler/exporter_template.go` | 采集实现池 CRUD；内置行 403、被映射引用 409、name 冲突 409 |
| B2-2 | `dto/mapping.go` + `service/mapping.go` + `handler/mapping.go` | 默认采集配置 CRUD + `PUT /:id/label-template` 专用入口；`is_default` 唯一、内置行只读、被 Job 引用禁删 |
| B2-2 | `handler/{json,errors,pagination}.go` | 严格 JSON（未知字段 400）、`httpapi` 错误映射、分页解析 |
| B2-2 | `service/ports.go` | `LabelTemplateResolver` 端口 + D-3 no-op 实现（接受 id、名称为空） |
| B2 | `handler/routes_test.go` | 契约级集成测试：CRUD、403/404/409/400、严格 JSON、label-template 专用端点 |
| B2 | `domain/params_test.go`、`service/service_test.go` | 校验函数与规范化单测 |
| B2 | `module.go` | 组合根接入 exporter / mapping service + handler |

### 6.1 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/modules/m01/...
ok  .../m01
ok  .../m01/domain
ok  .../m01/handler
ok  .../m01/repository
ok  .../m01/seed
ok  .../m01/service

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 服务启动（端口 18081，临时库）实测：

```text
匿名 GET /exporter-templates                    -> 401
GET  /exporter-templates?page_size=3            -> total=6（内置采集实现）
GET  /ci-exporter-mappings?page_size=3          -> total=6，exporter_template_name 已解析
POST /exporter-templates {"name":"e2e-exporter"} -> 200，is_builtin=false
POST /ci-exporter-mappings                      -> 200，label_template_id=""
PUT  /ci-exporter-mappings/{id}/label-template  -> 200，label_template_id="lt-e2e"（name 为空，D-3 降级）
DELETE 内置 mapping                              -> 403 forbidden
POST 未知字段 {"job_name":"x"}                   -> 400 bad_request
```

### 6.2 偏差

1. **内置 mapping 禁删**：契约 §3.2 原仅写 `is_default`/被引用两类 409。代码沿用旧线语义，内置行优先返回 403（否则 seed 下次启动会重建，用户操作无效）；契约已补注。
2. **label_template_id 只经专用端点写**：Create/Update 请求不接收该字段（严格 JSON 下出现即 400），与契约「专用入口」一致。
3. **Mapping Update 保留 label_template_id / is_builtin**：更新请求是「全量业务字段」，但这两个字段不在 DTO 中，服务端从 existing 继承，避免误清空。
4. **Label template 解析（已解决）**：B2 初期 D-3 未就绪时使用 no-op resolver；2026-11-16 M07 补齐 `m07_label_templates`（00007）后，M01 已切换为只读 reader，模板存在性/类别匹配与删除引用计数均生效。


---

## 7. B3 变更与验证（ScrapeJob 核心）

| 任务 | 产物 | 说明 |
|---|---|---|
| B3-1 | `domain/job.go`、`service/job.go` | 参数层叠（Job→映射→采集实现→全局）、快照、mapping_overrides 计算、`sync_mapping_defaults` |
| B3-1 | `dto/job.go`、`handler/job.go` | CRUD + 列表筛选 + 内联 `sync`；strict JSON |
| B3-2 | `domain/{resource,job}.go`、`service/job.go` | 网域纳管、实例存在/同域/类别、offline 拒绝、blackbox 门禁、认证、duration/路径、模板类别 |
| B3-2 | `references/{resource,domain}.go` | 只读 M07 六类资源与 M06/M09 网域纳管状态；候选 SQL 单次 JOIN |
| B3-3 | `service/job.go`、`handler/job.go` | 候选收敛、Job 实例、安装登记、`preview-targets` |
| B3 | `handler/job_test.go`、`m01/references/*_test.go` | 候选/Job/预演/离线/网域/blackbox/严格 JSON 集成测试 |

### 7.1 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/modules/m01/...
ok  .../m01
ok  .../m01/domain
ok  .../m01/handler
ok  .../m01/references
ok  .../m01/repository
ok  .../m01/seed
ok  .../m01/service

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 服务实测（端口 18083）：

```text
GET  /scrape-jobs/instance-candidates?monitor_type=host_linux&network_domain_id=mc-demo
     -> total=1, display_name=web-01, target_address=10.0.0.1:9100, selectable=true
POST /scrape-jobs（standard, host_linux）
     -> 200, sync.status=pending, interval=15s, timeout=10s, /metrics, http
POST /scrape-jobs/{id}/preview-targets
     -> targets=[10.0.0.1:9100]
POST /scrape-jobs（blackbox, interface_service, http_2xx）
     -> 200, target_field=api_url, monitor_type=""
POST /scrape-jobs/{blackbox}/preview-targets
     -> targets=[http://10.0.0.20:8080/health]
POST /scrape-jobs（不存在的实例）
     -> 400 selected_instance_ids: resource "nope" not found
```

### 7.2 偏差与遗留

1. **凭证仍是占位编码**：`password_cipher` / `token_cipher` 以 `plain:<value>` 前缀存储，未做 AES-GCM / secret ref；安全审查前必须替换（记为 S-M01-1）。响应只回 `credential_configured`，不回显明文。
2. **preview-targets 标签最小化**：当前只注入 `network_domain`，未按标签模板展开 target labels；完整标签在 B4/M09 生成期由 M07 模板解析。
3. **application 目标地址**：v3 application 资源无 `instance_ip`，候选地址从 `endpoint` 或 `health_check_url` 解析 host + 资源 `port`；解析失败进入 `skipped`。
4. **无 M09 写回**：Job 写入只置 `pending/draft`，`synced/failed` 由 B4 的 `SyncResultSink` 回写。
5. **未做实例级采集状态前端聚合**（T01-B4-4）：后端已提供选中实例与 target 估算，前端按 §9.4 与 M09 targets 合并。


---

## 7. B4a 变更与验证（M09 源接入 + 同步写回）

| 任务 | 产物 | 说明 |
|---|---|---|
| B4-1 | `m09/references/source_reader.go` | 改为读取 `m01_scrape_jobs`（ready+enabled+未删）；targets 来自选中实例，blackbox 用探测 URL，参数取 Job 快照；Fingerprint 覆盖资源/Job/软删/拨测模块 |
| B4-1 | `m01/domain/job.go` | 抽出 `domain.ResourceAddress`，M01 preview 与 M09 生成共用同一端口解析 |
| B4-3 | `m01/references/sync_sink.go` | `RecordDomainSync` / `RecordRuleSync`：按 `updated_at` 与 `generatedAt` 比较，旧结果不覆盖新编辑 |
| B4-3 | `m09/service/config_sync_service.go` | 快照生成后调用 `SyncResultSink`；校验失败/无可用 target 也会回写 failed 原因 |
| B4 | `m09/module.go`、`v3.go` | M01 先构建，`SyncResultSink` 注入 M09；注册顺序不变 |

### 7.1 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 服务实测（端口 18084，PATH 注入 promtool/blackbox_exporter）：

```text
POST /scrape-jobs host-prod   -> sync=pending
（M09 watcher 30s）
GET  /scrape-jobs/{id}        -> sync.status=synced, version=20261116-9331
domain_config_snapshots       -> validation_status=passed, is_current=1
targets/host-prod.json        -> 10.0.0.1:9100
```

### 7.2 偏差与遗留

1. **target labels 仍最小化**：仅注入 `resource_id`；external label `network_domain_id` 由 generator 统一注入。按标签模板展开 target labels 尚未实现，需在 M09 生成期读取 M07 模板映射。
2. **中心规则同步未做**（T01-B4-2）：`RecordRuleSync` 已提供，但 M09 尚未生成中心 `rules.yml` 与 reload；随 B5 规则一起落地。
3. **Fingerprint 含全局拨测模块**：任一模版变更会触发所有域重算（checksum 不变时 M09 直接返回当前快照，不产生新版本）。
4. **写回失败只记日志**：快照已发布，M01 状态可能短暂陈旧，下一次源变更会重试。


---

## 8. B5a 变更与验证（监控规则 CRUD/校验）

| 任务 | 产物 | 说明 |
|---|---|---|
| B5-1 | `domain/rule.go` | YAML/groups 结构校验、组内唯一、组名列表、job 引用分级（`up` 存活类 error，其余 warning） |
| B5-1 | `service/rule.go`、`service/promtool.go` | CRUD + validate；组名跨规则唯一（enabled+ready）；promtool 失败阻断、不可用降级 |
| B5-1 | `dto/rule.go`、`handler/rule.go` | `/monitoring-rules` CRUD + `POST /validate`；response 含 group_count/rule_count/sync |
| B5-1 | `repository/job.go` | `ListActiveNames`：全平台 ready+enabled Job 并集 |
| B5 | `handler/rule_test.go` | CRUD、validate、组名冲突、逃生门、非法内容、strict JSON |

### 8.1 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/modules/m01/...
ok  .../m01
ok  .../m01/domain
ok  .../m01/handler
ok  .../m01/references
ok  .../m01/repository
ok  .../m01/seed
ok  .../m01/service

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

### 8.2 偏差与遗留

1. **中心规则同步未做**（T01-B5-2 / T01-B4-2）：规则保存后 `sync.status=pending`，尚未生成中心 `rules.yml` 与 reload；`RecordRuleSync` 已就绪，等 M09 中心规则服务接入。
2. **promtool 不可用降级**：`status=unavailable` 只提示不阻断；`failed` 阻断保存。测试环境通常为 unavailable。
3. **字段化编辑未做**：`content_mode=structured` 返回 400（v0.3+）。
4. **name 默认值**：为空时取首个 group 名，与旧实现一致。


---

## 9. B4-2 / B5-2 中心规则同步（2026-11-16 完成）

| 任务 | 产物 | 说明 |
|---|---|---|
| B4-2 | `platform/db/migrations/v3/00008_m09_center_rules.{sqlite,postgres}.sql` | `center_config_snapshots`：唯一版本、单 current、校验状态/归因 |
| B4-2 | `m09/repository/center_snapshot_repository.go` | 中心快照 Insert / InsertAndActivate / CurrentPassed |
| B4-2 | `m09/configgen/configgen.go` | `GenerateCenterRules`：centerEvaluator=true，生成中心 `rules.yml` |
| B4-2 | `m09/references/center_rules.go` | 只读 `m01_monitoring_rules`（enabled+ready）与变更指纹 |
| B4-2 | `m09/service/center_rules_service.go` | 生成/校验/原子写 `rules.yml` + POST `/-/reload` + `RecordRuleSync` 回写；30s watcher |
| B5-3 | `m01/references/sync_sink.go` | `RecordRuleSync` 按 rule id 回写，按 `updated_at` 防覆盖 |
| B4-2 | `m09/module.go` | 中心规则服务与 watcher 接入 `StartBackground` |

### 9.1 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 实测（端口 18085，假 Prometheus 19090 响应 `POST /-/reload`）：

```text
POST /monitoring-rules（HostDown, up == 0） -> sync=pending
（中心 watcher 30s）
GET  /monitoring-rules/{id}                 -> sync.status=synced, version=20261116-609a
$configDir/rules.yml                        -> groups[host] HostDown
center_config_snapshots                     -> validation_status=passed, is_current=1
```

### 9.2 偏差与遗留

1. **中心规则文件位置**：写入 `--config.dir` 下的 `rules.yml`；与 legacy local 通道共用目录，v3-only 模式下由中心 Prometheus 读取。
2. **reload 失败即失败**：写文件成功但 reload 失败时快照标记 `platform_fault`、不切换 current；下一次 watcher 会重试。
3. **规则 outcomes 按 rule id**：`RecordRuleSync` 以 M01 rule id 为键，避免规则展示名重复。
4. **无历史清理**：中心规则快照暂未实现保留策略（每域快照仍保留 5 份）；后续按需补。


---

## 10. B6 变更与验证（指标库 / 业务指标 / 拨测模块 / 对账循环）

| 任务 | 产物 | 说明 |
|---|---|---|
| B6-1 | `service/metric.go`、`dto/metric.go`、`handler/metric.go` | 技术指标库 CRUD/筛选；内置只读、删除 403 |
| B6-2 | `service/business_metric.go`、`dto/business_metric.go`、`handler/business_metric.go` | 业务指标 CRUD；`pending→instrumented→online` 状态机；非 pending 禁删 |
| B6-3 | `service/probe_module.go`、`dto/probe_module.go`、`handler/probe_module.go` | 拨测模块 CRUD；YAML 根键=名称；内置仅启停；被 Job 引用禁删 |
| B6-4 | `service/reconcile.go`、`module.go` | D40 对账循环（默认 60s，`Options.ReconcileInterval` 可配）；批量回收失效/跨域实例并置 pending |
| B6 | `handler/catalog_test.go`、`service/reconcile_test.go` | 指标/业务指标/拨测模块契约测试 + 对账单测 |

### 10.1 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/modules/m01/...
ok  .../m01
ok  .../m01/domain
ok  .../m01/handler
ok  .../m01/references
ok  .../m01/repository
ok  .../m01/seed
ok  .../m01/service

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

### 10.2 偏差与遗留

1. **指标库 monitor_type 过滤未实现**：标的 `monitor_types` 为 JSON，当前按 `metric_type`/`category`/`keyword` 过滤；按监控对象类型筛选留待后续（需 JSON 查询）。
2. **安装登记**：已在 B3 的 Job 实例接口提供，不再单独暴露。
3. **对账循环日志**：仅回收数量日志，未逐条审计；后续可接审计链路（M07 S-6）。
4. **凭证加密仍未做**（T01-B3-4）。

---

## 11. 下一步

- **B3-4**：凭证 AES-GCM / secret ref（安全审查前置项，S-M01-1）。
- **B4-4 / F1-F4**：前端 M01 页面切 v3、同步/采集状态列。
- **B8**：回归矩阵、安全审查、handover。

---

## 11. 2026-11-17 收敛（拨测模块只读 + 列表状态列清理）

### 11.1 拨测模块

- 删除独立「拨测模块」页面与菜单（SRS v1.2 未要求维护页）。
- `POST/PUT/DELETE /api/v3/platform/blackbox-modules` 移除；保留 `GET` 列表/详情（Job 表单下拉与只读展示）。
- `m01_probe_modules` 表与 4 个预置模块 seed 保留。
- **修复 M09 缺口**：`configgen.Source` 新增 `Modules`，M09 `SourceReader` 读取 `m01_probe_modules`（enabled）并传入 `AssembleWithModules`；此前传 `nil` 会导致 blackbox Job 生成报「模块不存在」。

### 11.2 列表状态列

- 采集 Job / 监控规则列表删除「变更进度」列。
- 改为「启用状态 + 同步状态」两列，由 `SyncStatusTag` 消费 v3 `sync`。
- 移除 pending 期编辑/启停/删除锁、批量提交草稿入口与 `triggerConfigDrafts` 调用。

---

## 12. 2026-11-18 指标库筛选修复（增量）

- **补上未实现的 `monitor_type` 过滤**：`MetricHandler.List` 读取 `monitor_type`，`MetricFilter` 新增 `MonitorType`；repository 按方言匹配 `monitor_types` JSON 锚点（SQLite `json_each` / PostgreSQL `jsonb_array_elements`）。
- **新增 `resource_category` 参数**：粗粒度资源类别（host / database / middleware / application / generic_target）由 `domain.MonitorTypesForCategory` 展开为该类别的监控类型集合后按锚点归属过滤；与 `monitor_type` 同时传入时 AND 组合，无对应类型（如 interface_service）或未知类别返回空页。
- **语义澄清**：契约中的 `category` 仍表示指标语义域（cpu / memory / ...），不承载资源类别，避免 `category=host` 查不到数据。
- **契约**：`api-contract-snapshot-v3.md` §7.1 已同步 `resource_category` 与 AND 语义。
- **验证**：`go test ./platform/modules/m01/...`、`go vet ./platform/modules/m01/...` 通过；SQLite 与 PostgreSQL（`METRIC_CENTER_TEST_POSTGRES_DSN`）测试均通过；服务启动后用内置种子验证 all=19 / host=6 / database=4 / mysql=2 / application+host_linux=0。

---

## 13. 2026-11-18 监控对象类型配置化 + 一个 CI 多采集器（增量）

> 需求来源：SRS Module_01 v1.3 §3.1 / §5.6（FR-21~FR-24）、SRS Module_07 v2.1 §3.5 / §5.8（FR-30/FR-31）。
> 目标：`monitor_type` 从 Go 枚举变为平台可配置元数据；一个 CI 可同时命中多个类型，被多个采集器分别采集。

### 13.1 schema（migration）

| 文件 | 内容 |
|------|------|
| `0019_m07_resource_capabilities.{sqlite,postgres}.sql` | `host_resources` 增 `has_npu` / `has_gpu`（NOT NULL DEFAULT FALSE）；新增 `m07_attribute_definitions`（能力 key 字典）与 `m07_resource_attributes`（资源 × key × value），均有 Up/Down |
| `0020_m01_monitor_type_registry.{sqlite,postgres}.sql` | 新增 `m01_monitor_types`（code/name/resource_category/rule_logic/enabled/is_builtin）与 `m01_monitor_type_rules`（field/operator/values/priority），`match_operator` 由 CHECK 约束枚举 |

### 13.2 M01 实现

- `domain/monitor_registry.go`：`MonitorTypeDefinition` / `MonitorTypeRule` / `MonitorTypeScope` / `MonitorTypeRegistry`（不可变快照 + `MonitorTypeRegistryHolder`），定义/规则的保存期校验（字段白名单、操作符与字段类型匹配、值类型校验）。
- `domain/scope_fields.go`：**受控字段白名单**（os_family / os_type / has_npu / has_gpu / database_type / middleware_type / …），key → 物理列的映射由服务端持有，用户输入只作为参数绑定。
- `domain/builtin_monitor_types.go`：内置 10 个类型作为种子（`npu` 更名为 `host_npu`，规则改为 `has_npu = true`，与 OS 类型正交）。
- `domain/monitor_type.go`：`ValidMonitorType` / `CategoryForMonitorType` / `MonitorTypesForCategory` 改为读取注册表；**所有既有校验点（Job / 映射 / 规则 / 指标锚点 / 采集器 supported_monitor_types）自动支持新类型，无需改调用方**。
- `repository/monitor_type.go`：定义与规则持久化、整组规则替换、引用计数（mappings / jobs / rules / metric anchors）。
- `service/monitor_type.go`：CRUD + 影响面（引用数 + 当前匹配资源数）+ 每次写操作后重建快照并 `InstallMonitorTypeRegistry`；`EnsureBuiltins` 幂等补种子；`Bootstrap` 在 boot 时执行。
- `handler/monitor_type.go` + `dto/monitor_type.go`：`/api/v3/platform/monitor-types`（List/Create/Get/Update/Delete/Impact）与 `/monitor-types/scope-fields`。
- `references/resource.go`：候选实例收敛改为**规则解释**——`candidateScope` 取注册表 scope，`scopePredicate` 按 `all`/`any` 组合成 SQL 谓词；`os_family` 为虚拟字段，展开为 OS 字典关键字（保持 Ubuntu / RedHat 等规范名匹配行为）；`regexp` 仅 Postgres。
- `references` 新增 `CountCandidates`，供影响面预览复用同一查询，避免预览与表单漂移。
- `seed/seed.go`：新增 `seedMonitorTypes`（create-only，不覆盖用户修改）。

### 13.3 M07 实现

- `domain/attributes.go`：`HostAttributes` 增 `HasNPU` / `HasGPU`，校验不变。
- `dto/attributes.go` / `dto/resource.go`：`has_npu` / `has_gpu` 进入 host 属性 payload。
- `repository/models.go` / `mapping.go`：host 扩展表读写两个能力列。
- `domain/capability.go`：`AttributeDefinition`（key / 值类型 / 枚举 / 必填 / 启停）与 `ResourceAttribute`，按类型校验取值。
- `repository/attribute_repository.go`、`service/attribute_service.go`、`handler/attribute_handler.go`、`dto/attribute.go`：字典 CRUD + 资源属性整组替换；有引用的 key 只允许停用、不允许删除。
- 路由：`/api/v3/platform/attribute-definitions`（CRUD）、`/api/v3/platform/resources/:resource_id/attributes`（GET/PUT）。

### 13.4 行为变更（相对旧实现）

| 旧行为 | 新行为 | 原因 |
|--------|--------|------|
| `monitor_type` 由 `candidateScope` 的 switch 决定 | 由 DB 规则 + 注册表决定；switch 删除 | FR-21/22，新增类型不改代码 |
| `npu` 类型候选为主机全集 | `host_npu` 由 `has_npu = true` 推导，可与 `host_linux` 同时命中 | FR-10/23，一个 CI 多采集器 |
| 一台主机只能被一种主机类型选中 | 同一主机可出现在 host_linux 与 host_npu 两个候选池 | FR-23 |
| 新增类型需改常量 + 发版 | 界面/API 新增，保存即生效 | NFR-11 |

### 13.5 验证

- `go build ./platform/...`、`go vet ./platform/...` 通过。
- `go test ./platform/...` 全绿。
- 迁移 Up/Down：`platform/db/monitor_type_registry_migration_test.go`（0019/0020 建表、唯一索引、CHECK 约束、回滚后重放）。
- 路由级：`TestSetupV3RouterMountsSystemM06M07` 断言 `/monitor-types`、`/monitor-types/scope-fields`、`/attribute-definitions` 已挂载且受鉴权；登录后 `/monitor-types` 返回内置类型（Bootstrap 生效）。
- 业务级：`TestSameHostMatchesOSAndNPUTypes`（同一主机同时命中 host_linux 与 host_npu）、`TestRuntimeRegisteredTypeDrivesCandidates`（运行时注册即生效）、`TestCreateMonitorTypeIsImmediatelyUsable`、`TestReplaceResourceAttributesValidatesValues` 等。
- 说明：本地 SQLite 仅测试可用，生产默认 Postgres，故未做真实进程启动冒烟；等价验证由 `setupV3Router` 测试承担（真实 router + 全部 v3 模块 + 鉴权）。

### 13.6 遗留 / 下一步

- 前端页面（监控对象类型管理页、资源能力属性区）未实现，API 已就绪。
- Excel 导入尚未支持 `has_npu` / `has_gpu` 固定列与「属性名=值」扩展属性列（FR-30/31 的导入分支）。
- 规则字段中的 `regexp` 仅 PostgreSQL 支持；SQLite 下保存期可校验，运行期返回明确错误。
- 删除了 `MONITOR_TYPE_DERIVATION_MAP` 在 M01 的运行时用途；`platform/models/monitor_type.go`（legacy v2）保持原样，未触碰。

---

## 14. 2026-11-18 收尾三件套：npu 改名兼容 / 前端管理页 / Excel 能力列

> 承接 §13。需求来源：SRS Module_01 v1.3 §3.1/§5.6、Module_07 v2.1 §5.8（FR-30/31）。

### 14.1 ① `npu` → `host_npu` 改名兼容

- **数据订正 migration** `0021_m01_npu_code_rename.{sqlite,postgres}.sql`：把存量 `npu` 改写为 `host_npu`，覆盖 `m01_scrape_jobs`、`m01_job_groups`、`m01_ci_type_exporter_mappings`、`m01_monitoring_rules` 的 `monitor_type`，以及 `m01_exporter_templates.supported_monitor_types`、`m01_metric_library.monitor_types` 两个 JSON 文本列；若曾有中间版本写入 `npu` 的类型定义行，一并改名为 `host_npu`（仅当 `host_npu` 尚不存在）。语句幂等，新库执行影响 0 行。
- **入参别名**：`domain.NormalizeMonitorTypeCode` 把 `npu` 解析为 `host_npu`，`MonitorTypeRegistry.Get` 内部先归一；Job 与默认采集配置在保存前归一，避免旧客户端/旧表格继续写入过期编码。
- 验证：`platform/db/monitor_type_registry_migration_test.go` 回滚 0021 → 写入 legacy `npu` 行 → 重放 0021 → 断言 Job 与 exporter 支持列表均已改写；`TestLegacyNPUCodeResolvesToHostNPU` 覆盖别名解析。

### 14.2 ② 前端页面

| 文件 | 说明 |
|------|------|
| `ui-custom/web/src/types/monitorType.ts` / `api/monitorTypes.ts` | 类型定义、规则、影响面、字段白名单的类型与 API 客户端 |
| `ui-custom/web/src/pages/strategy/MonitorTypePage.tsx` | 监控对象类型管理页：列表（编码/名称/类别/规则/启停/内置）+ 新增/编辑抽屉（规则动态行：字段来自白名单、操作符按字段类型收敛、取值按 boolean/os_family 给固定选项）+ 影响面弹窗 |
| `ui-custom/web/src/pages/strategy/MonitorTypePage.test.tsx` | 列表渲染、加载失败、新增抽屉 3 条行为测试 |
| `ui-custom/web/src/types/attribute.ts` / `api/attributes.ts` | 扩展属性字典与资源属性值 API |
| `ui-custom/web/src/pages/resources/AttributeDefinitionsDrawer.tsx` | 扩展属性字典抽屉（登记 key / 值类型 / 枚举 / 必填 / 启停 / 删除） |
| `ui-custom/web/src/pages/resources/ResourceAttributesDrawer.tsx` | 单资源扩展属性编辑抽屉，字段由字典动态生成（boolean/number/text/enum） |
| `ResourceFormDrawer`（host） | 新增「NPU 芯片」「GPU 芯片」开关，随 `attributes.has_npu/has_gpu` 提交与回显 |
| `ResourceDetailDrawer` | 新增「能力属性」区：NPU/GPU 标记 + 扩展属性值，入口「维护扩展属性」 |
| `ResourcesPage` | 工具栏新增「扩展属性字典」入口 |
| `App.tsx` / `MainLayout.tsx` | 新增 `/monitor-types` 路由与「采集策略 → 监控对象类型」菜单项 |

- 说明：详情抽屉的按钮文案由「编辑扩展属性」改为「维护扩展属性」——「编辑」前缀会与既有的「编辑」按钮在 `getByRole('button', {name:/编\s*辑/})` 查询中冲突（实测导致 ResourceDetailDrawer 两条测试失败）。

### 14.3 ③ Excel 导入能力列

- `importer/template.go`：host 模板新增 `has_npu`、`has_gpu`、`attributes` 三列；其余类别新增 `attributes`；三列均为**尾部可选列**，旧模板文件仍可导入（header 校验裁掉尾部可选列后比对前缀）。
- `importer/excel.go`：新增 `HasNPURaw` / `HasGPURaw` / `AttributesRaw` 与 `parseBoolCell`（支持 `true/false/1/0/是/否/有/无`）。
- `importer/row.go`：布尔列落入 `HostAttributes.HasNPU/HasGPU`；`AttributePairs()` 解析 `key=value;key2=value2`，格式错误给行级错误。
- `importer/validate.go`：`ValidatedRow` 携带 `Attributes` 交由导入服务按字典校验。
- `service/import_service.go`：`SetAttributeWriter` 注入字典与写入端口；**先校验后建资源**（未登记 key / 停用 key / 非法取值直接判行失败，避免"资源已建、属性静默丢弃"），再按 key 合并写入（不覆盖 UI 维护的其他属性）。
- `module.go`：M07 组合根注入扩展属性仓储。
- 前端 `TemplateDownloadModal` 的填报提示补 `has_npu` / `has_gpu` / `attributes` 三列说明。

### 14.4 验证

- 后端：`go test ./platform/...` 全绿、`go vet ./platform/...` 通过（含新增 `TestMigrateV3MonitorTypeRegistryAndCapabilities` 的 0021 回滚/重放、`TestParseExcelCarriesCapabilityColumns`、`TestImportPersistsCapabilityFlagsAndAttributes`、`TestImportRejectsUnregisteredAttributeKey`）。
- 前端：`tsc --noEmit`（应用与测试两套配置）通过；`eslint` 对全部新增/改动文件通过；`vitest run MonitorTypePage.test.tsx` 3/3 通过；`ResourceFormDrawer.test.tsx`（58）、`ResourceDetailDrawer.test.tsx`（25）通过。
- 已知环境问题：`ResourcesPage.test.tsx` 的 F-17/F-13 与 F-17/F-8-b 两条在**未包含本次改动**的对照实验下同样超出 15s 默认超时（实测 20.6s），属既有慢用例 + 本机负载，与本轮改动无关；`--testTimeout=60000` 下通过。

### 14.5 遗留

- Excel 导入暂不支持「能力属性」的批量声明 sheet（沿用资源列直填）。
- 前端未提供监控对象类型规则的批量导入/导出。
- 扩展属性值暂不参与列表列展示与筛选（仅详情与编辑）。

### 14.6 2026-11-18 补正：扩展属性接入资源登记表单（用户实测反馈）

- **问题**：§14.2 只把扩展属性接到了「资源详情 → 维护扩展属性」抽屉与 Excel 导入，**新增/编辑资源的主表单没有渲染动态字段**，导致用户登记了 `testkey` 后在「新增资源」里看不到。这是实现缺口，不是设计取舍——FR-31 要求「资源登记表单按适用类别动态展示扩展属性字段」。
- **修复**：
  - `resourceFormFields.tsx` 新增 `renderResourceExtensionAttributes(definitions)`：按值类型渲染 Switch / InputNumber / Select(enum) / Input，字段名挂在 `extension_attributes.<key>`。
  - `ResourceFormDrawer.tsx`：打开抽屉时按当前资源类别拉取启用中的扩展属性字典；编辑态拉取已有值并在**字段挂载后**回填（Form `preserve={false}` 会丢弃未挂载字段的值，故回填放在独立 effect）；提交成功后按「先建/改资源 → 再写扩展属性」两步落库；布尔字段显式写 true/false，其余空值即清空；字典未渲染的历史 key 原样保留（不做隐式删除）。
  - 新增 2 条测试：新增态动态字段 + 创建后落值；编辑态回显 + 历史 key 保留。`ResourceFormDrawer.test.tsx` 60/60 通过。
- **验证**：`tsc --noEmit`（应用 + 测试）、`eslint` 通过；`vitest run ResourceFormDrawer.test.tsx` 60/60。
- **使用口径**：扩展属性字典变更后，已打开的抽屉不会热更新，**重新打开「新增/编辑资源」即可看到新字段**。

### 14.7 2026-11-18 补正：前端类型下拉改为读注册表（用户实测反馈）

- **问题**：后端 `monitor_type` 已配置化，但前端仍保留一份写死枚举 `MONITOR_TYPE_CASCADE` / `MONITOR_TYPE_MAP`（且还是旧编码 `npu`）。采集器管理、采集 Job、任务组、指标库、规则、采集器「支持监控类型」等 **12 处**下拉/展示全部取自该常量，因此新建的类型永远选不到。
- **修复**：
  - 新增 `pages/strategy/useMonitorTypeCatalog.ts`：`useSyncExternalStore` + 模块级单例，首次订阅拉取 `/api/v3/platform/monitor-types`；提供 `cascade` / `optionsForCategory` / `allCodes` / `nameOf` / `categoryFor`；加载失败或未加载时回退内置常量（静态预览与单测可用）；**仅启用类型进入可选列表**，停用类型保留名称以展示历史 Job。
  - `types/strategy.ts`：`MonitorType` 由闭集联合改为开放 `string`（类型集合已配置化）。
  - 12 个消费点改为读目录：`MappingDrawer`、`ScrapeJobFormDrawer`、`JobGroupWizardDrawer`、`CollectorTemplatesTab`、`ScrapeJobListPage`、`MetricLibraryPage`、`RulesPage`、`RuleMountDrawer`、`ExporterTemplateDrawer`、`LabelTemplateSelectDrawer`、`ScrapeJobDetailDrawer`；`strategyConstants` 的常量降级为「内置回退数据」并更新为 `host_npu`。
  - `MonitorTypePage` 拉取列表后调用 `applyMonitorTypeList()` 覆盖目录缓存：新增/改名/停用类型后，切到采集 Job、采集器管理立即看到，无需刷新页面。
  - 依赖数组补齐 `catalog`（目录加载完成后下拉重算）；两处「打开抽屉重置表单」的 effect 刻意不纳入 `catalog` 并注明原因——否则目录加载完成会把用户已填内容清空。
- **验证**：`tsc --noEmit`（应用 + 测试）、`eslint src/pages/strategy` 全通过；`vitest run src/pages/strategy` 20 个文件 / 156 条通过（含新增 `useMonitorTypeCatalog.test.ts` 4 条：回退内置、页面推送的启用类型进入候选、停用类型只保留名称、未知编码不渲染 undefined）；`vite build` 成功。
- **口径提醒**：下拉只显示**启用**类型；保存默认采集配置时，若采集器的 `supported_monitor_types` 非空且不含该类型，后端会拒绝（`exporter does not support monitor type`），需先在采集器里勾选该类型。

## 15. 2026-11-19 监控对象类型 / 指标库写入权限收口 + 用户扩展指标挂接（增量）

**背景**：新建监控对象类型后需要能立即给它挂指标；用户裁定「监控对象（类型）和指标写入仅管理员」「内置指标只读 + 用户扩展另存」。

### 15.1 权限收口

- `handler/routes.go`：`/monitor-types` 与 `/metric-library` 拆成「读组 + 写组」，写组挂 `auth.RequireAdmin()`。
  - 读：`GET /monitor-types`、`GET /monitor-types/scope-fields`、`GET /monitor-types/:code`、`GET /monitor-types/:code/impact`、`GET /metric-library`、`GET /metric-library/:id`。
  - 写（仅 admin）：`POST /monitor-types`、`PUT/DELETE /monitor-types/:code`、`POST /metric-library`、`PUT/DELETE /metric-library/:id`。
- 已认证普通用户 → 403；匿名 → 由全局 `AuthMiddleware` 401（handler 层测试锁定 403 边界）。
- 与 M05/M06/M09 的 `RequireAdmin` 口径一致；M03 权限点体系落地后再细化。

### 15.2 指标库写校验（补齐契约缺口）

- `service/metric.go`：
  - Prometheus 命名校验：`metric_name` 匹配 `^[a-zA-Z_:][a-zA-Z0-9_:]*$`（≤200 字符）；`labels` 每个键匹配 `^[a-zA-Z_][a-zA-Z0-9_]*$`（≤64 个）。
  - 锚点/标签归一化：去空白、去重、丢弃空锚点。
  - **(metric_name, monitor_type) 判重**：新增 `repository.HasAnchorConflict`（SQLite `json_each` / Postgres `jsonb_array_elements`），同名 + 任一相同锚点 → 409；内置行与用户行一起参与，避免用户扩展遮蔽内置锚点。锚点是 JSON 数组，无法建唯一索引，暂由应用层保证。
  - 更新同样校验并排除自身；内置行继续 403。
- 未新增导入/批量接口（用户裁定暂不做 `/metrics` 文本导入）。

### 15.3 测试

- 新增 `handler/admin_gate_test.go`：
  - `TestMonitorTypeWritesRequireAdmin` / `TestMetricLibraryWritesRequireAdmin`：普通用户与匿名上下文 403、读 200、管理员 200。
  - `TestMetricLibraryUserEntryValidation`：同名同锚点 409、同名不同锚点 200、非法指标名/标签键 400。
- `handler/routes_test.go`：测试路由默认注入管理员上下文（`newTestRouter`），新增 `newTestRouterAs` 支持普通用户/匿名场景。
- 验证：`go test ./platform/...` 全绿；`go build ./platform/modules/m01/...` 通过。

### 15.4 口径提醒

- 内置指标仍不可覆盖/禁用（保持只读）；「用户扩展另存」= 新增 `is_builtin=false` 行并挂同一/新增锚点，同名同锚点会被 409 拒绝，因此不会产生重复行。
- 监控对象类型被指标锚点引用时仍禁止删除（已有引用计数保护），停用后不能再挂新指标（锚点校验要求类型 enabled）。
