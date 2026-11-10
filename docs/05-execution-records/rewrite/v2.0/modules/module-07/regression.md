# Module 07 v3 回归矩阵（旧 v2 → 新 v3）

> **状态**：B6-1
> **旧基线**：`/api/v2/platform/*`（v2 legacy）
> **新线**：`/api/v3/platform/*`
> **结论**：保留项有自动化覆盖；变更/删除项均为有意变更。

---

## 1. 保留项（行为应一致）

| 能力 | 旧 v2 | 新 v3 | 覆盖 |
|---|---|---|---|
| 资源创建 / 详情 / 更新 / 删除 | `/resources` | `/resources` | `handler/routes_test.go` |
| 六类资源列表与分页 | `resource_category` + `page/page_size` | 同左，默认 20/上限 100 | `handler/routes_test.go`、`golden_test.go` |
| 资源筛选 | 网域 / 业务 / 状态 / keyword | 同左 + 应用 / 平台 | `repository` / `handler` 测试 |
| 资源标签 CRUD | `/resources/:id/labels` | 同左 | `handler/routes_test.go`、`repository/label_repository_test.go` |
| 标签写边界 | application / interface_service | 同左 | `service/label_service_test.go` |
| referenced-by | 只读反查 Job | 同左，走 references adapter | `handler/routes_test.go` |
| 字典列表 | business/app/platform/cloud/os | 同左 + zone-types | `dictionary/service_test.go` |
| app-platform-rel | 列表 / 新增 / 主平台 / 解绑 | 同左 | `dictionary/service_test.go` |
| Excel 导入 | create_only / upsert | 同左 | `service/import_service_test.go`、`handler/routes_test.go` |
| 导入记录 | 列表 / 详情 | 同左 | `handler/routes_test.go` |
| 判重键 | 六类 dedup key | 同左 | `domain/domain_test.go`、`importer` 测试 |
| 软删 | 资源软删后列表/详情不可见 | 同左 | `repository/resource_repository_test.go` |

---

## 2. 有意变更

| 变更 | 旧 v2 | 新 v3 | 原因 |
|---|---|---|---|
| API 前缀 | `/api/v2/platform` | `/api/v3/platform` | 旧新并行 / 契约断代 |
| 资源响应 | `map[string]interface{}` | typed DTO + `attributes` | 编译期契约、稳定演进 |
| `app_code` 物理列 | `app_name` 存 app_code | 统一 `app_code` | 去掉历史别名 |
| `cluster` 物理列 | `sub_app_code` | `cluster` | 去掉历史别名 |
| `env` 物理列 | `env_flag` | `env` | 去掉历史别名 |
| `cloud_code` | 资源表冗余列 | 经网域派生 | 单一事实来源 |
| 分页默认 | 50 | 20（上限 100） | 对齐 API 标准 |
| 判重约束 | 应用层先查后写 | DB `UNIQUE(category,dedup_key)` | 并发兜底 |
| 资源主键 | 单表唯一 | 全局 `resources.resource_id` | 标签/快照可 FK |
| 标签 ID | uint | TEXT UUID | 双库可移植 |
| 导入声明 | 导入内建字典 | 导入内建字典（v3 继续支持） | 保留 |

---

## 3. 有意删除 / 不迁移

| 项 | 处置 | 原因 |
|---|---|---|
| 旧 v2 资源表（hosts/databases/...） | 保留旧库，不迁移 | 已确认 `data_migration: none` |
| `service_dicts` / `service_code` | v3 不建 | 服务字典已废弃 |
| `connection_string` 明文 | v3 不存明文，改 `connection_secret_ref` | 凭证安全 |
| `resource_type` 过渡列 | v3 不建 | 只保留 `resource_category` |
| `zone_env` 资源列 | v3 不建 | 分区经网域派生 |

---

## 4. 已知未覆盖 / 后续

- PostgreSQL 集成测试需 `METRIC_CENTER_TEST_POSTGRES_DSN`，本机未跑。
- 审计日志表 `resource_audit_logs` 已建，但写链路尚未接入（B6-3 记录为遗留）。
- v3 资源导入的声明 sheet 已支持落库；跨模块字典写入仍复用 M00/M06 表。
- 旧 v2 与 v3 并行窗口：v2.0 发布后保留一个版本，再删除旧包。
