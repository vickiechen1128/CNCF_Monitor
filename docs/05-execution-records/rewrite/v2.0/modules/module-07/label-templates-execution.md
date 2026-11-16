# M07 v3 标签模板执行记录

> **分支**：`rewrite/v2.0`
> **范围**：`00007_m07_label_templates` + CRUD API + M01 引用端口
> **状态**：完成（2026-11-16）
> **关联**：`api-contract-snapshot-v3.md` §4.1；M01 `task-sequence.yaml` T01-B2-3

---

## 1. 变更清单

| 产物 | 说明 |
|---|---|
| `platform/db/migrations/v3/00007_m07_label_templates.{sqlite,postgres}.sql` | `m07_label_templates` 表；name+category 唯一、每类别单默认、类别 CHECK、mappings JSON |
| `platform/modules/m07/domain/label_template.go` | `LabelTemplate` / `LabelMapping` / source type / transform 校验；模板不存在/冲突错误 |
| `platform/modules/m07/repository/label_template_repository.go` | CRUD、分页筛选、`ClearDefault`、软删 |
| `platform/modules/m07/service/label_template_service.go` | 创建/更新/删除；默认互斥；类别不可变；删除引用计数 |
| `platform/modules/m07/dto/label_template.go` | v3 请求/响应 DTO |
| `platform/modules/m07/handler/label_template_handler.go` | `/api/v3/platform/label-templates` 路由与 handler |
| `platform/modules/m07/module.go` | `Options.LabelTemplateUsage` 端口注入；service/handler 装配 |
| `platform/modules/m07/references/label_template_usage.go` | `LabelTemplateUsageChecker` 端口 + no-op |
| `platform/modules/m01/references/label_template.go` | M01 只读 reader + 引用计数（mapping + job） |
| `platform/modules/m01/service/ports.go` | resolver 返回 `domain.LabelTemplateRef`（名称/类别/默认标记） |
| `platform/modules/m01/service/mapping.go` | 模板存在性 + 类别匹配校验；`label_template_name` 解析 |
| `platform/modules/m01/module.go` | 生产 resolver / usage checker 接线 |
| `platform/cmd/metric-center/v3.go` | M01 先于 M07 构建，注入引用计数端口 |
| 测试 | M07 domain/handler/service、M01 references/handler、00007 migration 与 lifecycle 更新 |

---

## 2. 关键设计

1. **表名 `m07_label_templates`**：legacy v2 已有 `label_templates`（AutoMigrate 创建），v3 迁移在 legacy 模式也会执行。前缀避免 `CREATE TABLE IF NOT EXISTS` 静默跳过与 schema 漂移（与 M01 `m01_*` 同策略）。
2. **类别默认互斥**：部分唯一索引 `(resource_category) WHERE is_default AND deleted_at IS NULL`；service 在设置默认前清除同类别旧默认。
3. **M07 不依赖 M01**：删除模板前通过 `LabelTemplateUsageChecker` 端口查询 M01 引用数；生产由 `v3.go` 注入 M01 实现，测试/独立启动用 no-op。
4. **M01 只读 M07 表**：`m01/references.LabelTemplateReader` 直接读 `m07_label_templates`，不 import M07 包；映射/Job 保存时校验模板存在且类别匹配。

---

## 3. 验证证据

```text
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/db/... ./platform/modules/m07/... ./platform/modules/m01/...
ok  .../platform/db
ok  .../platform/db/seed
ok  .../platform/modules/m07/domain
ok  .../platform/modules/m07/handler
ok  .../platform/modules/m07/repository
ok  .../platform/modules/m07/service
ok  .../platform/modules/m01
ok  .../platform/modules/m01/domain
ok  .../platform/modules/m01/handler
ok  .../platform/modules/m01/references
ok  .../platform/modules/m01/repository
ok  .../platform/modules/m01/seed
ok  .../platform/modules/m01/service

$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go test ./platform/...
# 全量通过
$ GOCACHE=/tmp/mc-gocache .tools/go/bin/go vet ./platform/...
# 无输出
```

v3 服务实测（端口 18082）：

```text
POST /label-templates {"name":"host-e2e","resource_category":"host"}  -> 200
GET  /label-templates?resource_category=host                         -> total=1
POST /label-templates 同名同类别                                      -> 409
PUT  /ci-exporter-mappings/{id}/label-template {lt-db}（类别不匹配）  -> 400
PUT  /ci-exporter-mappings/{id}/label-template {lt-host}             -> 200，name="host-e2e"
DELETE /label-templates/{lt}（仍被 mapping 引用）                     -> 409
DELETE mapping 后再次 DELETE template                                -> 200
```

---

## 4. 偏差与遗留

1. **未实现模板修改快照（LabelTemplateSnapshot）**：legacy 每次变更写快照用于审计；v3 先不引入，后续按 M07 审计要求补（与 S-6 审计写链路一并处理）。
2. **未实现 clone / mapping 级 CRUD / 模板资源清单**：v3 当前以整组 mappings 全量更新，满足 M01 消费；mapping 单条编辑、clone、模板资源反查留待 M07 前端迁移时评估。
3. **默认模板 seed 未恢复**：legacy 迁移已删除默认模板种子；v3 保持「用户创建」语义，M01 映射模板默认为空。
4. **PostgreSQL 未实跑**：00007 postgres 与 sqlite 同构（jsonb + 部分唯一索引），待 R3 环境验证。
