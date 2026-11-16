# Module 01 v3 后端执行记录

> **分支**：`rewrite/v2.0`
> **范围**：P1 / B1（schema + repository + seed + 模块骨架）、B2（采集实现池 + 默认采集配置）、B2-3（M07 标签模板接入）、B3（ScrapeJob 核心）、B4a（M09 源接入与同步写回）、B5a（监控规则 CRUD/校验）
> **状态**：B1 / B2 / B3 / B4a / B5a 完成（凭证加密、M09 中心规则、前端状态聚合待后续）
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

## 9. 下一步

- **B5-2 / B4-2**：M09 中心规则产物（`rules.yml`）+ reload + `RecordRuleSync` 回写；需新增中心规则快照表（migration）。
- **B3-4**：凭证 AES-GCM / secret ref（安全审查前置项，S-M01-1）。
- **B4-4**：前端实例级采集状态聚合（M09 targets + 选中实例）。
- B6：指标库、业务指标、拨测模块、D40 对账循环。
