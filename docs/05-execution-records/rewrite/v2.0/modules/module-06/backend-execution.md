# Module 06 v3 后端执行记录

> **分支**：`rewrite/v2.0`
> **范围**：B1 schema / seed / M07 消费解耦（T06-B1-1 ~ T06-B1-4）
> **状态**：B1 完成，PG 迁移实测待环境

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
