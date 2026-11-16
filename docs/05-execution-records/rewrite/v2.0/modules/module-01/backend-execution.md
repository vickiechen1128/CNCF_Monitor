# Module 01 v3 后端执行记录

> **分支**：`rewrite/v2.0`
> **范围**：P1 / B1（schema + repository + seed + 模块骨架）
> **状态**：B1 完成；资源路由与 service 在 B2+ 落地
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

## 6. 下一步

- **B2**：采集实现池 + 默认采集配置的 service / handler（FR-01/02/03）；D-3（M07 `label_templates`）仍未就绪，模板名称解析先降级。
- **B3**：ScrapeJob CRUD / 参数层叠 / 实例候选 / blackbox / preview-targets。
- 每个资源组按「service + handler + 契约测试」独立提交；schema 不再变更。
