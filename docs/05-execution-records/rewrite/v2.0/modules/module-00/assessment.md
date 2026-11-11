# Module 00 基础设施 / 数据模型 — 现状评估

> **状态**：done（SQLite 全量验证通过；PostgreSQL 集成测试待环境）
> **分支**：`rewrite/v2.0`
> **里程碑**：v2.0-m2
> **schema_change**：additive（v3 新线独立 baseline；旧 v2 库不受影响）
> **API 版本**：v3（`/api/v3/platform/*`）
> **更新日期**：2026-11-11

---

## 1. 范围

M00 只提供**跨模块共享的地基**，不承载业务语义：

| 能力 | 归属 | 说明 |
|---|---|---|
| 统一错误分类 + HTTP envelope 映射 | `platform/foundation/apierror`、`httpapi`、`api/response` | 业务错误实现 `ErrorKind()`，传输层统一映射 4xx/5xx |
| v3 迁移 runner | `platform/db/migrate.go` | checksum、dialect 文件、版本 0、Up/Down/DownTo/Status |
| v3 共享参考 / 身份表 baseline | `platform/db/migrations/v3/00000_*` | tenants / network_domains / 字典 / users / sessions / login_logs；语义归 M06/M03 |
| v3 最小 seed | `platform/db/seed/core_v3.go` | 租户、字典、初始管理员、默认管理域；幂等 |
| 模块注册契约 | `platform/foundation/module` | `Name()` + `RegisterRoutes()`；重复注册 fail fast |
| 共享 HTTP 中间件 | `platform/foundation/httpx` | RequestID、结构化 AccessLog |
| v3 系统端点 | `platform/foundation/system` | health / ready / meta；ready 校验 DB + migration |
| 双模式启动 | `platform/cmd/metric-center` | legacy（默认）与 v3-only；`--database.mode` / `METRIC_CENTER_DB_MODE` |

明确不做：

- 不迁移旧 v2 数据（D7）。
- 不在 M00 定义业务字段语义（资源、告警、采集配置归各业务模块）。
- 不引入 goose 依赖；迁移文件保留 `-- +goose Up/Down` 标记以便未来切换。

---

## 2. 关键设计

### 2.1 迁移文件 dialect 化

- 文件名 `<version>_<name>.<dialect>.sql`，当前支持 `.sqlite.sql` / `.postgres.sql`。
- 无后缀文件对两种 driver 通用（00001 / 00002 / 00003）。
- 版本 0 作为 platform core baseline；00002 M07 schema 的 FK 依赖 00000 建表，因此顺序不可调换。
- 已应用迁移写入 checksum；文件内容变更会在下次启动时直接报错，强制新增迁移而不是改历史文件。
- `MigrateV3DownTo(target)` 支持任意目标版本回滚（测试与本地重置用）。

### 2.2 物理列名沿用说明

`network_domains.ip_c_id_rs` 是 GORM 对 `IPCIDRs` 的历史推导名，v2 库已存在该列。
v3 baseline 首版沿用同一物理名，避免共享 `models.NetworkDomain` 在 legacy 模式产生影子列；
已在模型上显式标注 `column:ip_c_id_rs`。待 v3 自有网域模型落地后用 migration 改名（D5）。

### 2.3 v3-only 启动模式

`METRIC_CENTER_DB_MODE=v3`（或 `--database.mode=v3`）时：

1. `db.InitV3()`：打开连接 + `MigrateV3`，不执行 legacy `AutoMigrate`。
2. `seed.CoreV3()`：只写 v3 所需最小参考数据。
3. 只挂载 v3 模块（system / m07 / auth 适配器），不注册 `/api/v2/*`，不启动依赖旧 schema 的后台任务。
4. 支持 PostgreSQL（生产目标）与 SQLite（开发/测试）。

默认仍是 `legacy`：旧 v2 功能面保持可用，并增量应用 v3 迁移，供过渡期联调。

### 2.4 过渡期认证

M03 v3 认证面尚未重写。v3-only 模式通过 `v3AuthModule` 适配器临时复用 legacy
`platform/gateway/auth` handler（表结构与 00000 baseline 同构），登录路径为
`POST /api/v3/platform/auth/login`，该路径与 health/ready/meta 一并加入匿名白名单。
M03 v3 模块落地后替换适配器，接口路径保持不变。

---

## 3. 债务与待关闭项

| # | 项 | 影响 | 关闭条件 |
|---|---|---|---|
| M00-1 | PostgreSQL 集成测试未在本机执行 | PG DDL 仅有静态审查 | 提供 `METRIC_CENTER_TEST_POSTGRES_DSN` 后跑 `TestMigrateV3Postgres` |
| M00-2 | v3 auth 为 legacy 适配器 | 认证契约尚未独立 | M03 v3 模块落地 |
| M00-3 | legacy 模式仍增量跑 v3 迁移 | 旧库会多出 v3 表 | v3 切换完成后删除 legacy 模式或停止增量迁移 |
| M00-4 | `ip_c_id_rs` 物理列名不雅 | 可读性 | v3 网域模型迁移改名 |
| M00-5 | system meta 未暴露 build commit | 排障粒度有限 | 版本注入方案确定后补充 |

---

## 4. 验证记录

```bash
GOPROXY=off .tools/go/bin/go test ./platform/modules/m07/... ./platform/db/... ./platform/foundation/...
GOPROXY=off .tools/go/bin/go test ./platform/cmd/metric-center/...
GOPROXY=off .tools/go/bin/go vet ./platform/...
GOPROXY=off make test-platform
```

结果：全部通过（2026-11-11）。

v3-only 手工冒烟（SQLite）：

```bash
METRIC_CENTER_DB_DSN=/tmp/mc-v3.db \
  ./metric-center --database.mode=v3 --listen-address=:18080
```

- `GET /api/v3/platform/health` → 200
- `GET /api/v3/platform/ready` → 200，`schema_version=3`
- `GET /api/v3/platform/meta` → 200，`modules=[system m07 auth]`
- `POST /api/v3/platform/auth/login` → 200，token 可访问 M07 资源接口
- `POST /api/v3/platform/resources` → 200，列表可见且时间戳非零

legacy 默认模式冒烟：`/api/v1/health`、`/api/v2/platform/auth/login`、`/api/v3/platform/ready` 均为 200。
