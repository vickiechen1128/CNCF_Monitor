# 后端测试与运行统一 PostgreSQL、移除 SQLite（module-00 基础设施）

> 状态：已完成（A/B/C 三阶段）
> 分支：`feat/module-01-collection-templates`（工作区实施）
> 关联：`docs/05-execution-records/rewrite/v2.0/postgres-testing.md`、`docs/03-engineering-standards/04_Testing_Standard.md`

---

## 1. 背景

v3 控制面生产库早已是 PostgreSQL，但测试、开发启动与交付包仍保留大量 SQLite 痕迹：

- 43 个测试文件以 `MigrateV3("sqlite")` + 临时文件建库；`make test-platform` 因此只覆盖 SQLite；
- `make test-postgres` 仅跑 3 个迁移测试，业务测试从未在 PG 上执行；
- `0023_m01_collection_templates.postgres.sql` 与 SQLite 变体漂移，导致迁移在真实 PG 上直接失败（聚合 `GROUP BY`、jsonb `replace()`、任务组改造漏抄）；
- `make run-metric-center-v3` 设置 `METRIC_CENTER_DB_DRIVER=sqlite`，而生产二进制已不再注入 SQLite 驱动，启动必失败；
- 交付包 `start.sh` / `env.sh.example` 默认 `METRIC_CENTER_DB_DSN=$DATA_ROOT/metric_center.db`，交付即启动失败；
- 构建/测试/打包仍要求 CGO（`ensure-cgo`、Windows MinGW、交叉编译 zig），实际只为 `mattn/go-sqlite3` 服务。

## 2. 目标

1. 后端测试全部运行在 PostgreSQL（与生产同方言），不再回退 SQLite；
2. 删除 SQLite 驱动、方言迁移与 CGO 工具链，消除双方言漂移；
3. 修复由此暴露的、仅在 PG 上出现的生产缺陷。

## 3. 实施

### A. 止血与工具链（低风险）

- `Makefile`：删除 `run-metric-center-v3`；新增本地 PG 默认 DSN（`postgres://<系统用户>@127.0.0.1:5432/metric_center`）、`db-init`、`METRIC_CENTER_DB_DSN` 覆盖；`run-metric-center` 先幂等迁移再启动；`build-metric-center`/`migrate*` 去掉 `ensure-cgo`；帮助文本纠正。
- 交付包：`scripts/package-center.sh` 生成的 `start.sh` / `env/env.sh.example` 改为 `METRIC_CENTER_DB_DRIVER=postgres` + 必须显式配置 `METRIC_CENTER_DB_DSN`（缺失时回落本机并告警）；`config/metric-center.yml` 去掉 SQLite 路径；同步 `docs/06-mvp-e2e-testing/package-center-guide.md` 与 `deploy/center-bundle-deploy-checklist.md`。
- `scripts/pg-dev.sh`：`ensure_service` 自动启动本机 PG；新增 `ensure-db`；`test` 改为跑 `./platform/...` 全量。

### B. 测试迁 PostgreSQL

- `platform/testutil/testdb`：改为 **PG-only**；`Open` 每次创建一个独立 schema（`test_<random>`，search_path 注入 DSN，`t.Cleanup` DROP CASCADE），使「一个测试内建多个 stack」与旧的一次性 SQLite 文件同语义；`DSN` 惰性创建；缺 `METRIC_CENTER_TEST_POSTGRES_DSN` 时 `t.Fatalf` 明确提示，绝不回退。
- `platform/db`：新增 `pg_test_support_test.go`（`testPostgresDSN`、`openTestSQL`、`requireTableCount/ColumnCount/IndexCount`、`rollbackV3To`）；15 个迁移测试整体改为 PG（`information_schema`、`$n` 占位符、布尔字面量、去掉 PRAGMA/foreign_key_check）；删除 `migrate_postgres_test.go`（其覆盖已被 `TestMigrateV3Lifecycle` 完全覆盖）。
- `migrate.go`：`migrationChecksumColumnExists` 改用 `current_schema()`，使测试可在独立 schema 内做迁移簿记（不再依赖 public）。
- 43 个模块测试统一改用 `testdb.Open`；清除 `sqlite.Open`、内存 DSN keeper、`_foreign_keys`、`METRIC_CENTER_DB_DRIVER=sqlite`。
- `Makefile: test-platform`：缺 DSN 时自动执行 `pg-dev.sh ensure-db` 并注入 DSN；合并/删除 `test-postgres`。

### C. 删除 SQLite 与 CGO

- 删除 20 个 `*.sqlite.sql` 迁移与 `platform/db/migrations/*.sql` 下 7 个 v2 归档文件；`migrate.go` 只接受 `.postgres.sql`/`.sql`，`.sqlite.sql` 直接报错；删除 `sqlite_test_support_test.go`、`db.go` 的 SQLite dialector 注入与 `OpenDB` 分支。
- 删除 `go.mod` 中 `gorm.io/driver/sqlite`、`github.com/mattn/go-sqlite3`，`go.sum` 同步清理；`go list -deps ./platform/cmd/metric-center` 不再出现 sqlite。
- `Makefile`/`setup.sh`：移除 `ensure-cgo`、`install-gcc`、`GCC_*`、`CGO_ENABLED` 导出；`setup.sh` 的 MinGW 下载仅为 Windows 取 `mingw32-make`。
- `scripts/package-center.sh`：交叉编译改 `CGO_ENABLED=0`，删除 zig 依赖与检查。
- 文档与 Skill 收口：AGENTS、README、`04_Testing_Standard`、`00_Engineering_Standard`、`07_Backend_Architecture_and_Debt_Control`、`SETUP_WINDOWS.md`、`.kimi/skills/{cncf-project,testing-tdd}`（已 `make sync-skills`）。

## 4. 关键决策

| 决策 | 说明 |
|------|------|
| 测试逐 schema 隔离，而非一次一库 | 复用单个一次性数据库，`go test` 包级并行无冲突；schema 名随机，`t.Cleanup` 回收 |
| `testdb.Open` 每次调用新建 schema | 保持「同名 helper 多次调用 = 多个独立库」的旧语义（如 m01 handler 同时建 admin/viewer 两个 router） |
| 迁移簿记跟随 `current_schema()` | 让隔离 schema 能自洽运行迁移，无需 public 兜底表 |
| 缺 DSN 直接失败 | 要求「测试必须 PG」，禁止静默退回 SQLite |
| GORM `NowFunc = UTC` | `TIMESTAMP WITHOUT TIME ZONE` 列写入本地墙钟、按 UTC 读回会偏移 8h；统一写 UTC，API 时间稳定 |
| 新增 0024 迁移修 `is_primary` | 00002 为兼顾 SQLite 把布尔写成 `INTEGER`，而代码/GORM 用 `bool`，PG 上 `is_primary = true` 直接报 `integer = boolean` |

## 5. 由此暴露并修复的 PG-only 缺陷

1. `m01/repository/collection_template.go`：jsonb 列上的 `LIKE`/`json_each` → 改 `jsonb_array_elements`（另有独立提交 `f852a9b`）。
2. `0023` PG 迁移三处：聚合子查询补 `GROUP BY mt.rule_logic`；补 `m01_job_groups` 改造块；`replace()` 前 `::text` 再 `::jsonb`。
3. `m08/repository`：`labels`/`annotations` 为 nil map 时 GORM json serializer 写空串，jsonb 拒绝 → 归一为 `{}`（`nonNilStringMap`）。
4. `m05` 面板 `created_at`：创建走内存本地时区、更新走 DB UTC，同一字段两种表示 → `toDomain` 统一 `.UTC()`。
5. `is_primary`：`INTEGER`（SQLite 兼容）与 `bool` 代码不一致 → 0024 迁移转为 `BOOLEAN`。
6. `sync_sink.updatedAfter`：原先为「PG 写本地墙钟」做的时区补偿，在统一写 UTC 后反而错 8 小时 → 删除补偿，直接比较 UTC。
7. `m01/references` 选择器：删除 sqlite 方言分支与 `dialect` 参数（regexp 始终走 PG `~*`）。

## 6. 验证记录（2026-11-20）

| 验证 | 命令 | 结果 |
|------|------|------|
| 全量测试（PG） | `make test-platform` | 通过（0 FAIL，约 4–5 分钟；自动使用 `metric_center_test`） |
| 静态检查 | `go vet ./platform/...` | 通过 |
| 构建（无 CGO） | `CGO_ENABLED=0 make build-metric-center` | 通过 |
| 交叉编译 | `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build ./platform/cmd/metric-center` | 通过（静态 ELF） |
| 迁移 | `make migrate` → `make migrate-status` | 24 个迁移全部 applied |
| 启动 | `make run-metric-center` → `/api/v3/platform/health` | 200 `{"status":"ok"}`，driver=postgres |
| 方言残留 | `grep -rn sqlite platform --include=*.go` / `go list -deps` | 仅剩「拒绝 `.sqlite.sql`」的显式校验与历史注释 |

## 7. 遗留事项

- CI 暂无 Go 测试任务；若要成为 PR 门禁，需新增带 `postgres:16` service 的 workflow 并注入 `METRIC_CENTER_TEST_POSTGRES_DSN`。
- 老执行记录/需求文档中的 SQLite 描述作为历史保留，不逐篇重写。
- 本地旧 SQLite 文件（`metric_center.db`、`metric_center_v3.db`，均 gitignore）可手工删除。
- `go mod tidy` 在受限沙箱内无法写模块缓存，本次采用精确删除依赖 + `go build`/`go vet` 校验；联网环境可再跑一次 tidy 收尾。
