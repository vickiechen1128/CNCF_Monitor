# Module 06 系统与平台管理（含多租户）— v3 重构现状评估

> **状态**：planning（已完成现状评估与差异矩阵；等待计划确认后进入 B1）
> **分支**：`rewrite/v2.0`
> **里程碑**：v2.0-m2
> **schema_change**：breaking（`network_domains` 类型语义收紧 + 数据归一；旧 v2 库不受影响）
> **API 版本**：v3（`/api/v3/platform/*`；旧 `/api/v2/*` 保留兼容窗口）
> **权威需求**：`docs/02-product-requirements/Modules/Module_06_Multi_Tenant_Requirements.md` v1.0（2026-11-11）
> **历史参考**：`docs/02-product-requirements/Modules/Module_06_Multi_Tenant.md` v2.19（字段/API 细节参考，冲突以 SRS 为准）
> **更新日期**：2026-11-11

---

## 1. 结论摘要

1. **新建 `platform/modules/m06/` v3 模块**，按 domain / repository / service / handler / references 分层；legacy `platform/admin/{tenant,user,networkdomain,storagelog}` 冻结保留，只服务 `/api/v2/*` 兼容窗口，不在原包上做大改。
2. **M06 v3 只负责行政语义**：租户、用户、网域行政字段、登录日志、存储与日志管理。网域纳管（channel/token/remote_write_url/运行态）归 M09/M11；认证会话归 M03。
3. **取消中心直连域**：`domain_type` 收缩为采集节点域（DB 允许 `edge`/`collection`，v2.0 只产生 `edge`）；不再预置 `default` 管理域；历史 `management` 行迁移时转为 `edge` + `agent_pull`，保留 ID 以避免 M07 资源引用悬空。
4. **schema 用新增迁移 00004，不修改 00000 baseline**：00000 已记录 checksum，直接改会在下次启动报 mismatch。00004 做数据归一 + SQLite 触发器封禁 management（PostgreSQL 替换 CHECK）+ 索引调整，并提供可回滚 Down。
5. **M07 消费口径同步收紧**：v3 导入不再默认回填 `network_domain_id="default"`；资源校验从「网域存在」升级为「网域存在且 `status=enabled`」，禁用网域后拒绝新资源登记。
6. **M09/M11 v3 尚未重写**：删除网域的级联清退通过 `MonitoringRetirer` 端口预留，v2.0 默认 no-op 并返回 `monitoring_available=false`；M09 v3 落地后注入实现，不改变 M06 API。
7. **删除被引用网域返回 409 conflict**（legacy 为 403），附带引用数量与样例；`cloud_code`/`tenant_id`/`domain_type`/`id`/`status` 在编辑请求中出现即 400，不再静默忽略。
8. **分页信封统一为 `{list, total, page, page_size}`**，与 M07 v3 对齐；legacy v2 的 `{items, total}` 不变。

预计实施量：**8–10 人日**（不含 M09/M11 级联实现和前端改造）。

---

## 2. 新 SRS 与历史 PRD 的差异矩阵

| # | 能力 | 历史 PRD v2.19 | 新 SRS v1.0 | v3 处理 |
|---|---|---|---|---|
| 1 | 网域类型 | `management`（中心直连域）/ `edge` | 仅采集节点域（`edge`/`collection`），用户侧只读 | 服务层拒绝 `management`；DB 约束收缩；不做类型选择入口 |
| 2 | 默认网域 | 预置 `default` 管理域，中心直接采集 | 不预置 `default`；所有网域必须经采集节点接入 | 删除 `seed.CoreV3` 的 default 创建；迁移将历史行转 edge |
| 3 | 登记流程 | 询问「中心能否直接访问」，选择域名类型 | 不再询问；固定「接入方式：采集节点域」 | 登记请求不接受 `domain_type` 业务选择：缺省写 `edge`，显式传非 `edge`（含 `collection`）→ 400 |
| 4 | 网域禁用 | 管理域不可禁用 | 禁用 = 行政冻结；所有网域一致；存量采集继续 | 取消 management 特判；返回影响范围；M07 拒绝新资源 |
| 5 | 网域删除 | 管理域不可删除；删除级联清退 M09 | 存在 M07 引用硬拒绝；无引用软删 + 级联清退 M09 | 409 + 引用清单；软删 + `MonitoringRetirer` 端口；租户授权同步清理 |
| 6 | 网域字段 | 含 `ip_cidrs`/CMDB/纳管字段 | 行政字段：name/description/cloud_code/zone_type/authorized_tenant_ids/status | 只暴露行政字段；`ip_cidrs`/CMDB 物理列保留但 v3 API 不读写 |
| 7 | 不可变字段 | `tenant_id` 不可变、`cloud_code` 编辑态只读 | `cloud_code`、`tenant_id` 登记后不可变更 | 编辑请求出现即 400；创建时 `tenant_id` 固定 `platform_admin` |
| 8 | 租户范围 | MVP 仅 `platform_admin` 查看/编辑 | 同左；v0.2+ 完整生命周期 | 仅 GET/PUT；POST/PATCH status 返回 403 |
| 9 | 租户-网域授权 | 双向字段 + add-only 同步 | 授权 ≠ 拥有；多对多 | `network_domains.authorized_tenant_ids` 为权威；租户侧为派生缓存 |
| 10 | 用户管理 | CRUD/禁用/重置密码/admin 不可删 | 同左 + 删除软删并失效会话 | 保留并补会话失效、最后管理员保护 |
| 11 | 登录日志 | 账号/结果/分页 | 增加时间范围筛选 | 增加 `start_time`/`end_time` |
| 12 | 存储与日志 | TSDB 保留策略读写 + 只读展示 | 同左；不提供越权重启 | 逻辑迁入 m06/storage，行为保持一致 |
| 13 | 审计日志 | P2 / v1.0+ | 同左 | v2.0 不做，仅预留接口边界 |
| 14 | 平台配置 | P2 / v1.0+ | 同左 | v2.0 不做 |

---

## 3. 现状盘点（legacy 基线）

### 3.1 代码规模

| 包 | 主要文件 | 约行数 | v3 处理 |
|---|---|---|---|
| `platform/admin/tenant` | handler / service / repository + tests | ~400 | 重写为 `m06/service/tenant_service.go` 等 |
| `platform/admin/user` | handler / service / repository + tests | ~1,000 | 重写为用户与登录日志 |
| `platform/admin/networkdomain` | create/update/status/delete/impact/cascade/access_progress/idgen + tests | ~2,500 | 重写行政 CRUD；legacy 级联保留 |
| `platform/admin/storagelog` | handler / retention / diskusage / system + tests | ~800 | 迁入 `m06/storage` |
| `platform/gateway/auth` | service / handler / middleware / repository / ratelimit + tests | ~2,500 | M03 暂不重写；v3 继续复用适配器 |

### 3.2 legacy 路由（`/api/v2/platform`，全部经全局 AuthMiddleware）

| 方法 | 路径 | 鉴权 | v3 对应 |
|---|---|---|---|
| GET | `/tenants`、`/tenants/:id` | RequireAdmin | 保留 |
| PUT | `/tenants/:id` | RequireAdmin | 保留（name / multi_site_enabled） |
| POST | `/tenants`、PATCH `/tenants/:id/status` | RequireAdmin | v3 返回 403（MVP 不开放） |
| GET/POST/PUT/PATCH/DELETE | `/users*` | RequireAdmin | 保留 |
| GET | `/login-logs` | RequireAdmin | 保留 + 时间筛选 |
| GET | `/network-domains`、`/network-domains/:id`、`/zone-types` | 全局认证 | 保留（zone-types 暂由 M07 注册） |
| POST/PUT/PATCH/DELETE | `/network-domains*` | RequireAdmin | 保留 + 语义调整 |
| GET/PUT | `/storage-logs*` | RequireAdmin | 保留 |
| POST | `/auth/login` 等 | 匿名/全局 | M03 适配器，M06 不改 |

### 3.3 legacy 关键假设（必须在 v3 切断）

- `models.DomainTypeManagement` / `models.DefaultDomainID="default"` / `models.ChannelForDomainType` 在配置生成、M09 纳管、M11 交付、legacy seed 中广泛使用。
- `platform/db/seed/core_v3.go::ensureDefaultManagementDomain` 在每次 v3 启动时保证存在一个 management 域。
- `platform/modules/m07/importer/row.go` 在导入行未填网域时回落 `"default"`。
- `platform/admin/networkdomain/status.go` 拒绝禁用 management 域；`delete.go` 对 management 域不做特殊限制但级联逻辑依赖 legacy M09 表。
- M07 v3 的 `NetworkDomainExists` 只检查主键存在，不检查 `status`，禁用域仍可登记新资源。

### 3.4 v3 当前基线

- `00000_m00_platform_core` 已建 `tenants` / `network_domains` / 字典 / `users` / `sessions` / `login_logs`。
- `network_domains.domain_type` 的 CHECK 仍为 `('management','edge')`，并存在 `idx_network_domains_single_management` 唯一部分索引。
- `seed.CoreV3` 仍创建 `default` 管理域。
- `v3.go` 已挂载 `system` / `m07` / `auth` 适配器；M06 尚未注册。
- v3-only 模式不启动 legacy M09/M11 后台任务，也不建 `edge_agents` / `scrape_jobs` / 配置草稿表。

---

## 4. v3 目标架构

### 4.1 模块目录

```text
platform/modules/m06/
├── module.go                     # 组装 + 路由注册 + admin 组
├── domain/
│   ├── tenant.go                 # 租户实体/状态/校验
│   ├── user.go                   # 用户实体/角色/密码规则
│   ├── network_domain.go         # 网域行政实体/类型/状态
│   ├── ids.go                    # 用户/登录日志/网域 ID 生成
│   └── errors.go                 # 领域错误（apierror.Coded）
├── dto/
│   ├── tenant.go
│   ├── user.go
│   ├── network_domain.go
│   ├── login_log.go
│   └── storage.go
├── repository/
│   ├── tenant_repository.go
│   ├── user_repository.go
│   ├── session_repository.go     # 仅删除（会话归属 M03）
│   ├── login_log_repository.go
│   ├── network_domain_repository.go
│   └── dictionary_repository.go  # cloud_dicts / zone_types 只读校验
├── service/
│   ├── tenant_service.go
│   ├── user_service.go
│   ├── network_domain_service.go
│   └── login_log_service.go
├── handler/
│   ├── routes.go
│   ├── tenant_handler.go
│   ├── user_handler.go
│   ├── network_domain_handler.go
│   ├── login_log_handler.go
│   ├── storage_handler.go
│   └── errors.go                 # httpapi.WriteError
├── references/
│   ├── m07.go                    # 资源引用计数/样例
│   └── monitoring.go             # MonitoringRetirer 端口（M09/M11）
└── storage/
    ├── service.go                # 保留策略期望值/运行时比对
    ├── retention.go              # 校验 + 原子写 env
    ├── diskusage_unix.go
    ├── diskusage_windows.go
    └── logrotate.go
```

### 4.2 v3 路由与契约

所有路径前缀 `/api/v3/platform`；管理接口挂 `auth.RequireAdmin()`；响应信封沿用 `platform/api/response`。

#### 租户（MVP 只读 + 有限编辑）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tenants` | 分页 `{list,total,page,page_size}`；筛选 `status`、`keyword` |
| GET | `/tenants/:id` | 详情 |
| PUT | `/tenants/:id` | 仅 `name`、`multi_site_enabled`；无字段或不可变字段出现 → 400 |
| POST | `/tenants` | 403（MVP 不开放新建） |
| PATCH | `/tenants/:id/status` | 403（MVP 不开放状态变更） |

租户视图字段：`id/name/network_domain_ids/multi_site_enabled/is_platform_admin/status/created_at/updated_at`。

#### 用户与登录日志

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/users` | 筛选 `keyword/role/status`；分页 |
| POST | `/users` | `username/display_name/password/role?`；`tenant_id` 固定 `platform_admin` |
| PUT | `/users/:id` | 仅 `display_name/role`；`username` 出现即 400 |
| PATCH | `/users/:id/status` | `active/disabled`；禁用即失效全部会话 |
| PUT | `/users/:id/password` | 重置密码并失效全部会话 |
| DELETE | `/users/:id` | 仅 `role=user`；软删 + 失效会话；admin → 400 |
| GET | `/login-logs` | `username/success/start_time/end_time` + 分页；`created_at desc` |

用户视图字段：`id/tenant_id/username/display_name/role/status/last_login_at/created_at`；绝不返回 `password_hash`。

#### 网域（行政字段）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/network-domains` | `name/description?/cloud_code/zone_type/domain_code?/authorized_tenant_ids?`；`domain_type` 仅接受 `edge`；`tenant_id` 出现 → 400 |
| GET | `/network-domains` | 筛选 `status/keyword/cloud_code/zone_type/tenant_id`；分页；`created_at asc` |
| GET | `/network-domains/:id` | 详情 |
| PUT | `/network-domains/:id` | 仅 `name/description/zone_type/authorized_tenant_ids`；`cloud_code/tenant_id/domain_type/id/status` 出现 → 400 |
| PATCH | `/network-domains/:id/status` | `enabled/disabled`；禁用返回 `impact` |
| DELETE | `/network-domains/:id` | 有 M07 引用 → 409 + 引用摘要；无引用软删 + 级联端口 + 清理租户授权 |
| GET | `/network-domains/:id/impact` | `resource_count/sample_resources/managed_edge_agent_count/has_online_agents/monitoring_available` |

网域视图字段：`id/name/description/domain_type/domain_type_label/zone_type/cloud_code/tenant_id/authorized_tenant_ids/status/created_at/updated_at`。
`domain_type_label` 固定「采集节点域」；`channel/token/agent_type/remote_write_url/last_heartbeat` 等纳管字段不出现在 M06 v3 响应中。

#### 存储与日志

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/storage-logs` | 期望值 vs 运行时、磁盘占用、日志轮转只读 |
| PUT | `/storage-logs/retention` | `time/size` 校验 + 原子写 `prom-retention.env`；不重启 Prometheus |

#### 字典端点

- `/zone-types`、`/cloud-dict` 当前由 M07 v3 注册（只读）。M06 校验直接读表，**不重复注册**，避免 Gin duplicate route panic。
- `zone-types` / `cloud-dict` 的模块归属在 v3.1 字典模块化时统一；本模块只依赖其数据。

### 4.3 鉴权与过渡期

- 全局 `auth.AuthMiddleware` 已覆盖 `/api/v3/*`；M06 管理接口在模块内再挂 `auth.RequireAdmin()`。
- M03 v3 未落地前继续使用 legacy auth 适配器；M06 不重写登录/会话校验。
- 用户禁用/删除/重置密码时，M06 通过 `repository.SessionRepository.DeleteByUserID` 删除 `sessions` 行（只删除，不创建/校验）。

---

## 5. Schema 迁移方案（00004）

### 5.1 为什么新增而不是修改 00000

`platform/db/migrate.go` 对已应用迁移做 checksum 校验；修改 00000 会导致已有 v3 开发库启动报
`migration 0 checksum mismatch`。按 D5/D12，新增 `00004_m06_domain_administration.{sqlite,postgres}.sql`。

### 5.2 Up 内容

1. **数据归一（先于约束生效）**
   - `domain_type='management'` → `'edge'`；
   - `channel` → `'agent_pull'`（含历史 `edge` + `local` 行）；
   - 清空中心直连运行态：`token=''`、`agent_type=''`、`remote_write_url=''`、`max_disk_usage_per_url=''`、`center_endpoint=''`、`monitored_status=NULL`、`last_heartbeat=NULL`、`agent_version=NULL`；
   - `is_monitored=false`、`registration_status='created'`；
   - `name='中心直连域'` → `'默认采集域（历史迁移）'`，description 同步说明；
   - `authorized_tenant_ids` 为空时回填 `["platform_admin"]`（保留 JSON 文本口径）。
2. **约束收紧**
   - SQLite：**不重建表**。迁移 runner 在单事务内执行，`ALTER TABLE ... RENAME` 会让 `resources.network_domain_id` 外键跟随旧表，随后 `DROP TABLE` 触发 `no such table: main.network_domains_m06_old` / FK 失败。改用 `BEFORE INSERT` / `BEFORE UPDATE OF domain_type` 触发器拒绝 `management`（`RAISE(ABORT, ...)`），保留原表、原列、原外键与索引。原 CHECK 仍为 `management|edge`，因此 SQLite 开发库实际只允许 `edge`；v2.0 不产生 `collection`，待 v3 自有网域模型落地时再随表重建放开。
   - PostgreSQL：`DO` 块按 `pg_constraint` 找到 `domain_type` 的 CHECK 并删除，再新增命名约束 `network_domains_domain_type_check`。
3. **索引**
   - 删除 `idx_network_domains_single_management`（management 语义消失）；
   - 新增 `idx_network_domains_status(status)`、`idx_network_domains_cloud_zone(cloud_code, zone_type)`；
   - 新增 `idx_login_logs_username_created_at(username, created_at)`、`idx_login_logs_success(success, created_at)`，支撑登录日志筛选。
4. **不改的列**
   - `zone_type` / `cloud_code` 保持可空，由服务层强制必填（避免对历史空值做臆造回填）；
   - `channel` 的 CHECK 仍保留 `local|agent_pull`，M06 只写 `agent_pull`；`local` 的清理由 M09/M11 v3 统一收敛；
   - `ip_c_id_rs` 物理列名保留（D5/M00-4），v3 M06 API 不暴露。

### 5.3 Down 内容

- SQLite：删除 management 守卫触发器，重建 `idx_network_domains_single_management`，删除新增索引。表结构未变，无需数据折叠。
- PostgreSQL：删除新约束，恢复旧约束与唯一部分索引，删除新增索引；`collection` 行折叠为 `edge` 以恢复旧 CHECK。
- 数据不回滚（management 行已转 edge）；Down 只恢复 schema 可写能力，避免把业务数据反向改回中心直连语义。

### 5.4 对账

迁移后执行并归档结果：

```sql
-- 1) 不应再有 management 行
SELECT domain_type, count(*) FROM network_domains WHERE deleted_at IS NULL GROUP BY domain_type;

-- 2) 不应存在孤儿资源
SELECT count(*) FROM resources r
LEFT JOIN network_domains d ON d.id = r.network_domain_id AND d.deleted_at IS NULL
WHERE d.id IS NULL;

-- 3) 历史 default 行状态
SELECT id, domain_type, channel, status, is_monitored, registration_status
FROM network_domains WHERE id = 'default';

-- 4) 租户授权缓存 vs 网域权威字段
--    由 seed.CoreV3 的 reconcile 在启动时修正，测试中断言二者集合一致。
```

---

## 6. 跨模块边界

### 6.1 M07（监控对象台账）

- 变更 `dictionary.Repository.NetworkDomainExists` → `NetworkDomainUsable`：存在 + `status='enabled'` + `domain_type IN ('edge','collection')`。
- `importer/row.go` 删除 `network_domain_id="default"` 回落；空值返回行级错误「网域必填，请先登记采集节点域」。
- M07 v3 测试夹具中的 `management`/`local` 改为 `edge`/`agent_pull`；建议把夹具 ID 从 `default` 改为 `mc-demo`，避免继续传播默认域心智。
- 禁用网域后，M07 新资源创建/导入返回 400/422 类可执行错误；存量资源读取、更新不受影响。

### 6.2 M09 / M11（纳管与采集节点）

- M06 v3 不写 `edge_agents` / `scrape_jobs` / 配置草稿表；这些表在 v3-only 库中不存在。
- 删除网域：`references.MonitoringRetirer` 端口：
  ```go
  type RetireResult struct {
      ManagedAgentCount int64
      WillRetireAgents  []AgentRef
      MonitoringAvailable bool
  }
  type MonitoringRetirer interface {
      RetireDomain(ctx context.Context, tx *gorm.DB, domainID string) (RetireResult, error)
  }
  ```
  默认 `noopRetirer` 返回 `MonitoringAvailable=false`；M09 v3 落地后在 `NewModule` 注入实现。删除响应仍返回 `cascade_impact`，其中 `monitoring_available` 明确告知前端当前未接入纳管清退。
- 禁用网域只改 M06 行政状态；不停止存量采集、不改配置。M09 在生成新配置时自行读取 `status` 拦截。

### 6.3 M03（认证）

- 登录/登出/会话校验继续由 `platform/gateway/auth` 适配器提供。
- M06 只读 `users`/`login_logs`，只删 `sessions`；不做密码校验/登录限流。
- 生产管理员密码策略继续由 `seed.runAdminUser` 保证（NFR-05）。

### 6.4 M00（地基）

- 复用 `apierror` / `httpapi` / `module` / `httpx` / `system`。
- 不修改 00000、00001、00002、00003；只新增 00004。
- `seed.CoreV3` 去掉 default 域，增加租户授权对账（幂等）。

---

## 7. 测试与验收矩阵

### 7.1 目标测试

| 层 | 范围 | 命令 |
|---|---|---|
| 迁移 | 00004 Up/Down/重复执行、FK、约束、索引 | `go test ./platform/db/...` |
| seed | CoreV3 幂等、无 default、租户授权对账 | `go test ./platform/db/... ./platform/db/seed/...` |
| M07 解耦 | 网域存在/启用校验、导入空网域、存量兼容 | `go test ./platform/modules/m07/...` |
| M06 单元 | domain/service/repository/storage | `go test ./platform/modules/m06/...` |
| M06 HTTP | 路由、鉴权、字段不可变、分页、错误码 | `go test ./platform/modules/m06/...` |
| v3 集成 | 登录 → 登记网域 → M07 建资源 → 禁用/删除 → 租户授权 | `go test ./platform/cmd/metric-center/...` |
| 全局门禁 | 全量 + vet | `make test-platform`、`go vet ./platform/...` |

### 7.2 SRS 验收映射

| SRS 条目 | 验证方式 | 任务 | 证据 |
|---|---|---|---|
| 中心不直接采集；无 management 文案/取值 | 路由/DTO grep + DB 约束测试 + 迁移对账 | B1-1、B3-2、B6-2 | `TestMigrateV3M06DomainAdministration`、`TestNetworkDomainCreateAndList` |
| 不再预置 `default` | `TestCoreV3SeedIdempotent` 断言 0 个网域 | B1-2 | `platform/db/seed_core_v3_test.go` |
| 登记不询问中心可达性 | 创建请求仅接受 `edge`；响应 label 固定 | B3-1/B3-2 | `TestNetworkDomainCreateAndList`、`TestGenerateDomainID` |
| `cloud_code`/`tenant_id` 不可变 | 编辑请求出现即 400 + 测试 | B3-3 | `TestNetworkDomainUpdate` |
| 禁用 = 行政冻结 | 禁用后 M07 创建/导入失败；存量资源可读 | B1-3、B3-3、B6-1 | `TestNetworkDomainStatus`、`TestV3M06EndToEndDomainLifecycle` |
| 删除有引用拒绝、无引用软删 + 级联 | 409 + 引用摘要；fake retirer 断言调用；租户授权清理 | B3-4、B6-1 | `TestNetworkDomainDelete`、`TestV3M06EndToEndDomainLifecycle` |
| 租户 MVP 仅查看/编辑 | POST/PATCH 403；GET/PUT 正常 | B2-2 | `TestTenantLifecycleEndpointsForbidden`、`TestTenantUpdateOnlyMutableFields` |
| 用户 CRUD/admin 不可删/会话失效 | handler 测试 + sessions 计数 | B4-1/B4-2 | `TestUserCreateListGet`、`TestUserResetPasswordAndDelete` |
| 最后管理员保护 | 禁用/删除/降级 → 409；双 admin 允许 | B4-2 | `TestUserStatusAndLastAdminGuard`、`TestUserUpdateAndRoleGuards` |
| 登录日志筛选 | username/success/时间范围测试 | B4-3 | `TestLoginLogsFiltersAndShape` |
| 存储保留策略 | 校验/原子写/待重启状态 | B5-1/B5-2 | `TestUpdateRetentionWritesAndReportsPending`、`TestStorageOverviewAndRetentionUpdate` |
| 管理接口 RequireAdmin | user 角色访问返回 403 | B2-1、B4-4 | `TestUserAndLoginLogAdminGate`、`TestNetworkDomainReadsAllowUsersButMutationsRequireAdmin`、`TestStorageRequiresAdmin` |
| 密码/Token 不泄露 | DTO 无 `password_hash`；网域 DTO 无 `token` | B6-2 | `TestUserCreateListGet`、`TestNetworkDomainCreateAndList` |

### 7.3 非自动化验收

- NFR-10 列表首屏 ≤1s：在目标数据集（1 万资源/100 网域/10 万登录日志）做一次手工压测并归档。
- NFR-11 用户语言：前端文案检查；后端 `domain_type_label` 固定业务语言。
- NFR-12 错误可执行：逐条检查 400/409 文案包含下一步指引。

### 7.4 实施结果（B1–B6）

| 项 | 结果 |
|---|---|
| 迁移 / seed | SQLite 00004 Up/Down/重复执行、触发器、FK、索引、授权对账全绿 |
| M07 解耦 | `NetworkDomainUsable`、导入空网域行级错误、夹具迁移全绿 |
| 租户 / 网域 / 用户 / 登录日志 / 存储 | m06 单测与 HTTP 契约全绿 |
| v3 端到端 | 登录 → 建域授权 → M07 建资源 → 禁用拒绝 → 删除 409 → 删资源 → 删域成功 |
| 鉴权 | 匿名 401、user 403、admin 全链路；禁用/删除用户后旧 token 401 |
| 契约 | `api-contract-snapshot-v3.md` 冻结 |
| PostgreSQL | 未实测；`TestMigrateV3Postgres` 按 `METRIC_CENTER_TEST_POSTGRES_DSN` skip（open） |
| NFR-10 压测 | 未执行（open） |

---

## 8. 风险与待决

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | 00004 SQLite 约束收紧 | 迁移失败或资源外键悬空 | SQLite 采用触发器而非表重建（FK 安全）；B1-1 增加 Up/Down/重复/FK/触发器测试；PG 环境就绪后跑同构测试 |
| R2 | PG 约束名依赖自动命名 | 迁移在 PG 失败 | 用 `DO` 块按 `pg_constraint` 查找并删除，不硬编码自动名 |
| R3 | M09/M11 v3 未落地 | 删除级联清退无法端到端验收 | `MonitoringRetirer` 端口 + `monitoring_available=false`；M09 v3 接入后补集成测试 |
| R4 | `/zone-types`、`/cloud-dict` 路由暂由 M07 注册 | 模块归属不清晰 | 本模块不重复注册；v3.1 字典模块化时迁移 |
| R5 | v3 前端尚未改造 | 契约变更无法前端联调 | B0-2 先冻结契约；前端按 `/api/v3` 新信封适配 |
| R6 | 无 PostgreSQL 实例 | PG 迁移未实测 | 沿用 `METRIC_CENTER_TEST_POSTGRES_DSN` 门禁；未就绪时在评估中标记 open |
| R7 | 租户授权双写 | 数据不一致 | `authorized_tenant_ids` 权威；租户侧仅派生；CoreV3 启动对账 + 测试 |
| R8 | 最后管理员被禁用导致锁死 | 运维风险 | 禁用/删除最后一个 active admin → 409；保留 admin 不可删除规则 |

### 建议决策（B0-1 评审后落入 decisions.md）

| # | 决策 | 结论 |
|---|---|---|
| D15 | M06 v3 模块归属 | 新建 `platform/modules/m06/`；legacy `platform/admin/*` 冻结保留，只服务 v2 兼容窗口 |
| D16 | 网域 schema 演进 | 新增 00004；`management` 被服务层 + 触发器/CHECK 双重拒绝；历史行转 `edge` + `agent_pull`；不再 seed `default` |
| D17 | 租户-网域授权 | `network_domains.authorized_tenant_ids` 为唯一权威；`tenants.network_domain_ids` 为派生缓存，启动对账 |
| D18 | M07 消费口径 | 网域校验 = 存在 + enabled + edge/collection；导入不再回落 `default` |
| D19 | M09/M11 边界 | 删除级联通过 `MonitoringRetirer` 端口；M09 v3 未落地时 no-op + `monitoring_available=false` |
| D20 | v3 契约 | 分页 `{list,total,page,page_size}`；删除被引用网域 409；不可变字段出现即 400 |
| D21 | 管理员安全 | 禁用/删除最后一个 active admin、把最后一个 active admin 降级为 user → 409；admin 删除（非最后）→ 400；用户禁用/删除/改密事务内清会话 |
| D22 | 网域创建类型 | v3.0 只创建 `edge` + `agent_pull`；`collection` 仅读兼容；创建请求显式传非 `edge` → 400 |

### 已确认（进入 B1 前）

- [x] 00004 对 `network_domains` 的约束收紧方式：SQLite 采用触发器封禁（不改表，FK 安全）；PostgreSQL 替换 CHECK。
- [x] 历史 `default` 行采用「转 edge 保留 ID」，不软删、不要求重建。
- [x] v2.0 接受「M09/M11 级联清退暂为端口 + no-op」的边界。
- [x] 网域 `ip_cidrs` 确认不在 v3 M06 行政 API 暴露。
- [x] 用户管理确认增加「最后一个 active admin 不可禁用/删除」保护。

---

## 9. 验证命令

```bash
# 单模块
GOPROXY=off .tools/go/bin/go test ./platform/modules/m06/...
GOPROXY=off .tools/go/bin/go test ./platform/modules/m07/...
GOPROXY=off .tools/go/bin/go test ./platform/db/...
GOPROXY=off .tools/go/bin/go test ./platform/cmd/metric-center/...

# 迁移（本地 SQLite）
GOPROXY=off .tools/go/bin/go run ./platform/cmd/migrate -driver sqlite -dsn /tmp/mc-v3.db up
GOPROXY=off .tools/go/bin/go run ./platform/cmd/migrate -driver sqlite -dsn /tmp/mc-v3.db status
GOPROXY=off .tools/go/bin/go run ./platform/cmd/migrate -driver sqlite -dsn /tmp/mc-v3.db down

# 阶段门禁
GOPROXY=off .tools/go/bin/go vet ./platform/...
GOPROXY=off make test-platform

# v3-only 冒烟
METRIC_CENTER_DB_DSN=/tmp/mc-v3.db \
  ./platform/cmd/metric-center/metric-center --database.mode=v3 --listen-address=:18080
```

---

## 10. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-11 | 初稿：基于 M06 SRS v1.0 完成现状评估、差异矩阵、schema 方案、跨模块边界与验收矩阵 |
| v1.0 | 2026-11-11 | B1–B6 实施收口：SQLite 触发器方案、D22、验收证据、API 契约快照冻结、PostgreSQL/NFR-10 open |
