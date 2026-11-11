# Module 06 v3 后端执行记录

> **分支**：`rewrite/v2.0`
> **范围**：B1 schema / seed / M07 消费解耦；B2 模块骨架 + 租户；B3 网域行政 CRUD
> **状态**：B1–B3 完成，PG 迁移实测待环境

---

## 1. B1 变更清单

| 任务 | 产物 | 说明 |
|---|---|---|
| B1-1 | `platform/db/migrations/v3/00004_m06_domain_administration.{sqlite,postgres}.sql` | management→edge 数据归一；SQLite 触发器封禁 management；PostgreSQL 替换 CHECK；索引调整 |
| B1-1 | `platform/db/migrate_test.go` | 迁移生命周期扩展为 5 个版本；新增 00004 专项测试（数据转换、FK、触发器、索引、Down） |
| B1-2 | `platform/db/seed/core_v3.go` | 删除 default/management 域 seed；新增 `reconcileTenantDomainAuthorizations` 启动对账 |
| B1-2 | `platform/db/seed_core_v3_test.go` | fresh v3 库断言 0 网域；新增租户授权对账/软删清理测试 |
| B1-3 | `platform/modules/m07/dictionary/{repository,service,models}.go` | `NetworkDomainExists` → `NetworkDomainUsable`（存在 + enabled + edge/collection）；错误文案带登记/启用指引 |
| B1-3 | `platform/modules/m07/importer/row.go` | 删除 `network_domain_id="default"` 回落；空值转为行级错误 |
| B1-3 | M07 测试夹具 | `default`/`management`/`local` → `mc-demo`/`edge`/`agent_pull`；新增禁用网域、collection 网域、空网域导入测试 |

## 2. 实现偏差：SQLite 不重建表

原计划对 SQLite 使用 `legacy_alter_table` 重命名/重建 `network_domains`。实测在迁移 runner 的单事务内，
`ALTER TABLE ... RENAME` 会让 `resources.network_domain_id` 的外键跟随旧表，随后 `DROP TABLE` 报
`no such table: main.network_domains_m06_old` 或 FK 失败。

最终方案：

- 保留 `network_domains` 原表、列、外键与索引；
- 新增 `trg_network_domains_no_management_insert` / `trg_network_domains_no_management_update`，
  以 `RAISE(ABORT, 'management domain_type is no longer supported; use edge/collection')` 拒绝 management；
- 原 CHECK 仍为 `management|edge`，因此 SQLite 开发库实际只写 `edge`；v2.0 不产生 `collection`；
- PostgreSQL 仍按原计划替换 CHECK 为 `edge|collection`。

服务层（M06 v3）同样拒绝 management，触发器是数据库级兜底。legacy v2 `platform/admin/*` 冻结保留，
因此 `models.DomainTypeManagement` 常量不删除。

## 3. 数据对账

启动对账以 `network_domains.authorized_tenant_ids` + 登记 owner（`tenant_id`）为权威，
重算 `tenants.network_domain_ids`；软删网域在下次启动时从缓存移除。

验证脚本（临时 v3 库：迁移 + `seed.CoreV3` + 创建 `mc-demo`/`tenant-a` + 再跑一次 seed）输出：

```text
tenant=platform_admin network_domain_ids=[mc-demo]
tenant=tenant-a network_domain_ids=[mc-demo]
management_rows=0 orphan_resources=0
```

对账 SQL（归档用）：

```sql
-- 1) 不应再有 management 行
SELECT domain_type, count(*) FROM network_domains WHERE deleted_at IS NULL GROUP BY domain_type;

-- 2) 资源不得悬挂在不存在/已删除的网域上
SELECT count(*) FROM resources r
LEFT JOIN network_domains d ON d.id = r.network_domain_id
WHERE d.id IS NULL;

-- 3) 租户缓存应与网域授权一致（人工比对）
SELECT t.id, t.network_domain_ids
FROM tenants t WHERE t.deleted_at IS NULL;
SELECT id, tenant_id, authorized_tenant_ids
FROM network_domains WHERE deleted_at IS NULL;
```

## 4. 验证证据

```text
$ GOPROXY=off .tools/go/bin/go test ./platform/db/... ./platform/modules/m07/...
ok  github.com/metriccenter/metriccenter/platform/db
ok  github.com/metriccenter/metriccenter/platform/db/seed
ok  github.com/metriccenter/metriccenter/platform/modules/m07/dictionary
ok  github.com/metriccenter/metriccenter/platform/modules/m07/domain
ok  github.com/metriccenter/metriccenter/platform/modules/m07/dto
ok  github.com/metriccenter/metriccenter/platform/modules/m07/handler
ok  github.com/metriccenter/metriccenter/platform/modules/m07/importer
ok  github.com/metriccenter/metriccenter/platform/modules/m07/references
ok  github.com/metriccenter/metriccenter/platform/modules/m07/repository
ok  github.com/metriccenter/metriccenter/platform/modules/m07/service
```

专项测试：

```text
$ GOPROXY=off .tools/go/bin/go test ./platform/db -run 'TestMigrateV3M06DomainAdministration' -v
=== RUN   TestMigrateV3M06DomainAdministration
--- PASS: TestMigrateV3M06DomainAdministration (0.03s)
PASS
```

覆盖点：

- management 行转 edge/agent_pull，保留 ID，运行态清空；
- 存量 `resources` 存活，`PRAGMA foreign_key_check` 为空；
- management 插入被触发器拒绝；
- 旧单 management 索引移除，新索引与触发器存在；
- Down 删除触发器并恢复旧部分索引，legacy 写入窗口可用；
- fresh v3 seed 0 网域；授权对账与软删清理。

## 5. 未完成 / 风险

- **PostgreSQL 未实测**：本机无 PG 实例，`TestMigrateV3Postgres` 继续按 `METRIC_CENTER_TEST_POSTGRES_DSN` skip。
- **legacy v2 仍引用 default/management**：`platform/admin/*`、`platform/config/*` 冻结在兼容窗口内，不在 B1 修改范围；
  v2 使用独立 SQLite 库，不执行 v3 迁移，因此不受 00004 触发器影响；若在 v3 库上调用 legacy v2 写路径，management 写入会被触发器拒绝（有意行为）。

---

## 6. B2 模块骨架与租户 API

| 任务 | 产物 | 说明 |
|---|---|---|
| B2-1 | `platform/modules/m06/{module,domain,dto,repository,service,handler,references,storage}` | M06 v3 组合根；`Options{EnvFile,PromURL}` 允许空值；管理路由统一挂 `auth.RequireAdmin` |
| B2-1 | `platform/cmd/metric-center/v3.go`、`v3_test.go` | 注册顺序 system → m06 → m07 → auth；meta 断言模块列表；匿名 401 / user 403 冒烟 |
| B2-2 | `platform/modules/m06/{dto,repository,service,handler}` | GET /tenants（status/keyword + 分页）、GET /tenants/:id、PUT 仅 name/multi_site_enabled |
| B2-2 | `platform/modules/m06/handler/routes.go` | POST /tenants、PATCH /tenants/:id/status 在 MVP 返回 403 |
| B2-3 | `platform/modules/m06/handler/tenant_handler_test.go` | 拒绝 `network_domain_ids`/`is_platform_admin`/`status` 等不可变字段；无字段 400 |
| B2-3 | `platform/db/seed_core_v3_test.go` | 授权移除、重新授权、软删网域三种场景的缓存一致性 |

### 6.1 契约落点

- 分页信封 `{list,total,page,page_size}`，默认 20、上限 100，与 M07 v3 一致。
- `network_domain_ids` 只读：租户接口不接受写入，权威字段仍是
  `network_domains.authorized_tenant_ids`（D17）。
- 严格 JSON：PUT body 使用 `DisallowUnknownFields`，不可变字段与未知字段均返回 400，
  不静默忽略（D20）。
- 鉴权：全局 `AuthMiddleware` 负责 401；M06 管理组 `RequireAdmin` 负责 403。
- 生命周期：MVP 只维护 `platform_admin`，租户创建/状态变更留到 v0.2（SRS FR-01）。

### 6.2 验证

```text
$ GOPROXY=off .tools/go/bin/go test ./platform/modules/m06/... ./platform/cmd/metric-center/...
ok  github.com/metriccenter/metriccenter/platform/modules/m06/handler
ok  github.com/metriccenter/metriccenter/platform/cmd/metric-center
```

`go vet ./platform/modules/m06/... ./platform/cmd/metric-center/...` 无输出。

### 6.3 后续

- B3 开始网域领域模型与登记/编辑/删除；M06 `references` 端口在 B3-4 落地。
- 用户/登录日志在 B5；存储策略在 B4。

---

## 7. B3 网域行政 CRUD

### 7.1 变更清单

| 任务 | 产物 | 说明 |
|---|---|---|
| B3-1 | `platform/modules/m06/domain/network_domain.go`、`ids.go` | 网域实体 / 状态 / Impact / 409 错误；ID 生成 `<deploy_code>-<domain_code>`，保留 `default`，缺省随机 8 位 hex |
| B3-1 | `platform/modules/m06/repository/dictionary_repository.go` | `cloud_code` 必须为启用云字典；`zone_type` 必须存在；授权租户必须 active |
| B3-2 | `platform/modules/m06/repository/network_domain_repository.go` | 列表/详情/创建；创建事务内同步租户授权缓存；唯一键竞态映射 409 |
| B3-2 | `platform/modules/m06/dto/network_domain.go`、`handler/network_domain_handler.go` | v3 行政字段视图 + `domain_type_label`；分页信封；严格 JSON |
| B3-3 | `service/network_domain_service.go` | PUT 仅 `name/description/zone_type/authorized_tenant_ids`；PATCH 状态禁用返回 impact；启用幂等 |
| B3-4 | `platform/modules/m06/references/m07.go` | M07 引用计数 + 样例（resource_id/category/name） |
| B3-4 | `platform/modules/m06/references/monitoring.go` | `MonitoringRetirer` 端口；v2.0 默认 no-op + `monitoring_available=false`（D19） |
| B3-4 | `repository/network_domain_repository.go` | DELETE：软删 + 清运行态 token/agent 字段 + `registration_status=retired` + 清租户缓存 |
| B3-5 | `handler/network_domain_handler_test.go`、`domain/network_domain_test.go`、`cmd/metric-center/v3_test.go` | 契约 / 鉴权 / golden 回归；匿名 401、user 403、admin 全链路 |

### 7.2 契约落点

- 路由：GET `/network-domains`、`/network-domains/:id`、`/network-domains/:id/impact`
  仅要求登录；POST/PUT/PATCH/DELETE 挂 `RequireAdmin`。
- 创建固定 `edge` + `agent_pull`：`domain_type` 缺省写 `edge`，显式传 `collection`
  或其他值 → 400（D22）。`tenant_id` 由服务端固定 `platform_admin`，请求出现即 400。
- `domain_code` 规则 `[a-z0-9-]`，不可为 `default`；省略时随机生成，最终 ID 为
  `<METRIC_CENTER_DEPLOY_CODE 或 mc>-<domain_code>`。
- 名称大小写不敏感唯一；软删 ID 不可重登记（409）；`cloud_code` 创建后不可变。
- 响应仅含行政字段，`channel/token/agent_type/remote_write_url/heartbeat` 等纳管字段
  不出现在 M06 v3 契约中；`domain_type_label` 固定「采集节点域」。
- 禁用返回 `impact`：`resource_count/sample_resources/managed_edge_agent_count/
  has_online_agents/monitoring_available`；启用不返回 impact。
- DELETE 有 M07 引用 → 409 + 引用摘要；无引用 → 软删，响应同时返回 `impact` 与
  `cascade_impact`（同口径）。删除前先调用 `MonitoringRetirer`，v2.0 为 no-op。

### 7.3 验证

```text
$ GOPROXY=off .tools/go/bin/go test ./platform/modules/m06/... ./platform/cmd/metric-center/...
ok  github.com/metriccenter/metriccenter/platform/modules/m06/domain
ok  github.com/metriccenter/metriccenter/platform/modules/m06/handler
ok  github.com/metriccenter/metriccenter/platform/cmd/metric-center
```

覆盖点：

- 创建/随机 ID/名称冲突/软删 ID 重登记/字典与租户校验/management 与 collection 拒绝；
- 列表筛选 + 分页 + 详情 + impact 样例；
- PUT 不可变字段与未知字段 400；授权变更事务内同步租户缓存；
- 禁用/重复禁用/启用；禁用 impact 含 M09 端口字段；
- DELETE 有引用 409、无引用软删 + fake retirer 调用 + token 清空 + 租户授权清理；
- 读接口 user 200、写接口 user 403、匿名 401。

### 7.4 偏差与后续

- `collection` 在 v3.0 只读兼容、不可创建（D22）；SQLite 原 CHECK 仍只允许
  `management|edge`，因此开发库实际只写 `edge`。
- `MonitoringRetirer` 暂为 `context` 级端口（非事务内），v2.0 no-op；M09 v3 落地后
  再评估是否需要事务/补偿语义。
- PostgreSQL 仍未实测，沿用 `METRIC_CENTER_TEST_POSTGRES_DSN` skip。
