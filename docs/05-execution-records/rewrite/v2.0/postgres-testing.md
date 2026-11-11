# PostgreSQL 测试与迁移说明（v2.0）

> **目标**：v3 生产使用 PostgreSQL；SQLite 仅本地开发/快速测试。
> **状态**：B1-5 / B1-6 配套说明

---

## 1. 本地启动 PostgreSQL

```bash
docker run --rm -d \
  --name mc-postgres-test \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=metric_center_test \
  -p 5432:5432 \
  postgres:16
```

DSN：

```text
postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable
```

> 测试库必须是可丢弃的：`TestMigrateV3Postgres` 会执行 Up/Down。

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

测试覆盖：应用全部迁移 → 校验 00000 core 表 + M07 表 → 连续 4 次 Down（00003 → 00002 → 00001 → 00000）。
未设置 `METRIC_CENTER_TEST_POSTGRES_DSN` 时测试自动 skip，不影响 SQLite 快速测试。

---

## 3.1 v3-only 启动冒烟（PostgreSQL）

```bash
METRIC_CENTER_DB_MODE=v3 \
METRIC_CENTER_DB_DRIVER=postgres \
METRIC_CENTER_DB_DSN='postgres://postgres:postgres@127.0.0.1:5432/metric_center_test?sslmode=disable' \
METRIC_CENTER_ADMIN_PASSWORD='<strong-password>' \
make run-metric-center
```

验收：

- `GET /api/v3/platform/health` → 200
- `GET /api/v3/platform/ready` → 200，`driver=postgres`，`schema_version=3`
- `GET /api/v3/platform/meta` → 200，`modules` 含 `system` / `m07` / `auth`
- `POST /api/v3/platform/auth/login` → 200，返回 token

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
