# PostgreSQL 测试与迁移说明（v2.0）

> **目标**：v3 生产使用 PostgreSQL；SQLite 仅本地开发/快速测试。
> **状态**：B1-5 / B1-6 配套说明

---

## 1. 本地启动 PostgreSQL

### 方式 A（本机已用 Homebrew 安装，推荐）

本机已通过 Homebrew 安装 `postgresql@16`，服务由 launchd 托管（开机自启）。**日常只需确认服务在跑**：

```bash
brew services start postgresql@16     # 启动（已启动则无副作用）
brew services list | grep postgres    # 查看状态
brew services stop postgresql@16      # 停止（可选）
```

首次安装（国内网络走清华镜像，否则 brew 可能拉不到元数据）：

```bash
export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
brew install postgresql@16
brew services start postgresql@16
```

认证为本地 trust（无需密码），用户即 `whoami`（本机为 `chenrt`）。DSN：

```text
postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable
```

### 方式 B（Docker，备选）

`brew` 不可用或想隔离环境时用 Docker（需先启动 Docker Desktop）：

```bash
docker run --rm -d \
  --name mc-postgres-test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=metric_center_test \
  -p 5432:5432 \
  postgres:16
```

DSN：`postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable`

> 测试库必须是可丢弃的：`TestMigrateV3Postgres` 会执行 Up/Down。

### 一键脚本（方式 A 专用）

`scripts/pg-dev.sh` 封装了 start / reset / migrate / test / run，避免每次手敲 DSN：

```bash
./scripts/pg-dev.sh status              # 服务状态 + 当前 DSN
./scripts/pg-dev.sh dsn                 # 只打印 DSN（供手动调用）
./scripts/pg-dev.sh reset --yes         # 丢弃并重建测试库（Up/Down 测试前确保干净）
./scripts/pg-dev.sh migrate             # 对测试库执行 v3 迁移
./scripts/pg-dev.sh mstatus             # 迁移状态
./scripts/pg-dev.sh mdown               # 回滚一个迁移（开发用）
./scripts/pg-dev.sh test                # 跑 PG 迁移集成测试（Up + 逐版本 Down）
./scripts/pg-dev.sh run                 # v3-only 模式连 PG 启动 metric-center
```

可用 `PG_TEST_DB=<库名>` 覆盖默认库名 `metric_center_test`；`run` 的管理员初始密码用 `PG_ADMIN_PASSWORD` 覆盖（默认 `admin123`）。

---

## 2. 执行 PG migration

```bash
METRIC_CENTER_DB_DRIVER=postgres \
METRIC_CENTER_DB_DSN='postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable' \
make migrate
```

查看状态 / 回滚：

```bash
METRIC_CENTER_DB_DRIVER=postgres \
METRIC_CENTER_DB_DSN='postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable' \
make migrate-status

METRIC_CENTER_DB_DRIVER=postgres \
METRIC_CENTER_DB_DSN='postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable' \
make migrate-down
```

---

## 3. 执行 PG 集成测试

```bash
METRIC_CENTER_TEST_POSTGRES_DSN='postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable' \
  make test-postgres
```

测试覆盖：应用全部迁移 → 校验 core / M07 表 → 用 `MigrateV3DownTo` 按版本逐级 Down → 全部 Down。
回滚按版本目标而非固定步数，因此新增迁移（含 postgres-only 的 0013）不会让测试错位。
未设置 `METRIC_CENTER_TEST_POSTGRES_DSN` 时测试自动 skip，不影响 SQLite 快速测试。

---

## 3.1 v3-only 启动冒烟（PostgreSQL）

推荐用一键脚本（自动注入本机 DSN，用户为 `whoami`、trust 认证）：

```bash
./scripts/pg-dev.sh migrate     # 首次：对测试库执行 v3 迁移
PG_ADMIN_PASSWORD='<strong-password>' ./scripts/pg-dev.sh run
```

等价的手动命令（DSN 用户要匹配本机 PG 用户，Homebrew 默认不是 `postgres`）：

```bash
METRIC_CENTER_DB_MODE=v3 \
METRIC_CENTER_DB_DRIVER=postgres \
METRIC_CENTER_DB_DSN='postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable' \
METRIC_CENTER_ADMIN_PASSWORD='<strong-password>' \
make run-metric-center
```

> `db.OpenDB` 的编译期默认 DSN（`postgres://postgres@…/metric_center`）仅为占位值；裸启动前必须设 `METRIC_CENTER_DB_DSN` 或用脚本覆盖，生产由部署环境注入真实 DSN。

验收：

- `GET /api/v3/platform/health` → 200
- `GET /api/v3/platform/ready` → 200，`driver=postgres`，`schema_version=18`（当前 19 个迁移的最新版本号;`status=ready`）
- `GET /api/v3/platform/meta` → 200，`modules` 含 `system` / `m07` / `auth`
- `POST /api/v3/platform/auth/login` → 200，返回 token

---

## 3.2 公共测试 DB 助手 `platform/testutil/testdb`

为了让同一批单测既能跑 SQLite 快速路径、又能跑本地 PG，新增测试专用包
`platform/testutil/testdb`（生产二进制不 import 它；`go list -deps ./platform/cmd/metric-center`
中 sqlite / testutil 均为 0）。

### API

| 函数 | 用途 |
|---|---|
| `Open(t *testing.T) *gorm.DB` | 按环境变量选后端建库，自动应用 v3 迁移；`t.Cleanup` 自动释放 |
| `DSN(t *testing.T) string` | 返回当前后端 DSN，供需要裸 `sql.DB` 的测试使用 |
| `MigrateDriver() string` | 返回 `"sqlite"` / `"postgres"`，供直接调用 `db.MigrateV3` 的测试使用 |

### 测试接入方式

测试文件继续与生产代码同目录（Go 要求），只把本地的建库 helper 改成薄委托，
**fixture 里的 seed INSERT 等业务语句原样保留**：

```go
// 改造前
func openTestDB(t *testing.T) *gorm.DB {
    dsn := filepath.Join(t.TempDir(), "m01_repository.db")
    require.NoError(t, db.MigrateV3("sqlite", dsn))
    gormDB, err := gorm.Open(sqlite.Open(dsn+"?_foreign_keys=on"), &gorm.Config{})
    require.NoError(t, err)
    ... seed ...
    return gormDB
}

// 改造后
func openTestDB(t *testing.T) *gorm.DB {
    gormDB := testdb.Open(t) // 后端由环境变量决定；v3 迁移已应用
    ... seed ...              // 业务逻辑不变
    return gormDB
}
```

### 双后端切换

```bash
# 默认：每个测试一个隔离的 SQLite 内存库（file:testdb_<id>?mode=memory&cache=shared）
.tools/go/bin/go test ./platform/... -count=1

# PG：每个测试一个独立 schema（test_<随机>）
METRIC_CENTER_TEST_POSTGRES_DSN='postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable' \
  .tools/go/bin/go test ./platform/... -count=1

# 仅跑助手自测（含 CRUD、schema 隔离与 DROP SCHEMA 清理验证）
METRIC_CENTER_TEST_POSTGRES_DSN='postgres://chenrt@127.0.0.1:5432/metric_center_test?sslmode=disable' \
  .tools/go/bin/go test ./platform/testutil/testdb/ -count=1 -v
```

### 隔离实现要点

- PG 下为每个测试创建 `test_<随机>` schema，并把 `search_path=<schema>` **写进 DSN**
  （`?sslmode=disable&search_path=test_xxx`）。必须用 DSN 固定而不是 session 级 `SET search_path`：
  GORM 连接池可能开多个连接，`SET` 只影响执行它的那条连接，会导致不同连接看到不同 schema。
- `t.Cleanup` 自动 `DROP SCHEMA ... CASCADE`，测试间数据互不污染，无需手工清库。
- SQLite 下用带唯一名的 `mode=memory&cache=shared` DSN 保证同一进程内多测试互不串库；
  并刻意把 GORM 池限制为单连接——共享缓存内存库对并发写返回 `SQLITE_LOCKED`（`_busy_timeout`
  无效），单连接可保持与旧临时文件 helper 一致的单写语义。
- `db.MigrateV3` 中 `migrationChecksumColumnExists` 硬编码了 `table_schema='public'` 探测
  `schema_migrations`。助手在 PG 测试库的 `public` 中预置一张仅用于探测的
  `schema_migrations`（含 `checksum` 列），迁移实际 DDL 仍落在隔离 schema 中，**未改生产代码**。

### 当前迁移范围（渐进式）

已改造的代表测试：`platform/modules/m01/repository/repository_test.go`、
`platform/modules/m07/repository/resource_repository_test.go`。其余 ~90 个 `_test.go`
暂不改动， helper 可逐个按上面的模式迁移。

### 验证结果

- `go test ./platform/... -count=1`（默认 SQLite）：全绿
- 两个代表测试包 + `testdb` 自测在 PG env 下：全绿
- `go list -deps ./platform/cmd/metric-center | grep -i sqlite`：0

---

## 4. 默认策略

| 环境 | Driver | 说明 |
|---|---|---|
| 本地快速单测 | `sqlite` | 默认；内存库，快 |
| 本地完整验证 | `postgres` | 建议用 Docker |
| CI 快速门禁 | `sqlite` | 保持现有速度 |
| CI PG 门禁 | `postgres` | 至少跑 migration + M07 repository 集成测试 |
| v3 生产 | `postgres` | 唯一生产目标 |
| 旧 v2 | `sqlite` | 归档线，不迁移 |
