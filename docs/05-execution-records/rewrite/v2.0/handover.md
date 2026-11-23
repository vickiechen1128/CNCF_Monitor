# MetricCenter v2.0 交接清单（Handover）

> 目标：把项目级工具产品重写为可移交给正式开发团队的 v2.0。
> 每个模块在 R6 前必须完成对应条目；R6 汇总为整版交接包。

---

## 1. 产品与需求

- [ ] 业务需求文档（`business-requirements.md`）完整，目标 / 用户 / 场景 / 非目标清晰。
- [ ] 新 PRD 与实现一致，版本 / Change Log 可追溯。
- [ ] 删除 / 变更的旧功能有登记与理由。

## 2. 架构与数据

- [ ] 架构图 / 模块边界 / 依赖关系。
- [ ] 逻辑数据模型 + 物理列映射 + 身份键 / 唯一索引 / 关联完整性。
- [ ] API v3 契约快照；旧 v2 对照表。
- [ ] migration / 回滚 / 数据迁移说明。

## 3. 质量与安全

- [ ] 单元 / 集成 / E2E 测试与覆盖率。
- [ ] 旧 vs 新行为矩阵（保留 / 变更 / 删除）。
- [ ] 安全审查（认证、鉴权、密钥、配置下发、SSRF）。
- [ ] R1–R4 / lint / vet 通过。

## 4. 运维与交接

- [ ] 部署 / 升级 / 回滚 runbook。
- [ ] 环境变量 / 配置说明。
- [ ] README / onboarding / 已知问题 / roadmap。
- [ ] 旧版本基线 tag 与差异说明。

---

## 5. 模块清单

| 模块 | PRD | 代码 | 测试 | 迁移 | handover | 状态 |
|---|---|---|---|---|---|---|
| M00 | todo | done | done | done | doing | doing |
| M07 | doing | done | done | none | doing | doing |
| M06 | doing | done | done | done | doing | doing |
| M01 | todo | todo | todo | todo | todo | todo |
| M09 | todo | todo | todo | todo | todo | todo |
| M02 | todo | todo | todo | todo | todo | todo |
| M08 | todo | todo | todo | todo | todo | todo |
| M05 | todo | todo | todo | todo | todo | todo |
| 其他 | todo | todo | todo | todo | todo | todo |

---

## 6. M07 v3 交接说明

### 入口

```text
platform/modules/m07/
├── module.go          # 装配入口
├── domain/
├── repository/
├── service/
├── handler/
├── dto/
├── importer/
├── dictionary/
└── references/
```

旧 v2 业务目录（含 `platform/config/resource`）已随版本归档移除，仅保留 tag / 分支快照。

### 运行

控制面为 **v3-only / PostgreSQL-only**：只挂载 `/api/v3`，不启动旧后台任务；legacy 模式与 SQLite 双模式已移除。

```bash
# 本地默认库（trust 认证，metric_center）：建库 + v3 迁移
make db-init

# 编译、幂等迁移并启动控制面（:8080）
make run-metric-center

# 自定义 DSN（生产 / 其他环境）
METRIC_CENTER_DB_DSN='postgres://user:pwd@host:5432/db?sslmode=disable' \
  make run-metric-center

# 一键启动控制面 + Prometheus + Alertmanager + 前端（DSN 读 .env.local）
make dev-all
```

#### 本地 PostgreSQL 测试环境（macOS / Homebrew）

唯一支持的数据库为 PostgreSQL。本地装一个 PG 用于迁移与集成验证：

```bash
# 国内网络可用清华镜像加速（否则 brew 可能无法拉元数据）
export HOMEBREW_API_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/api"
export HOMEBREW_BOTTLE_DOMAIN="https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles"
brew install postgresql@16
brew services start postgresql@16

export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
createdb metric_center_test   # 一次性测试库，迁移测试会反复 Up/Down

# 全量后端测试（PG，逐测试独立 schema；缺 DSN 时 make 自动准备本地测试库）
make test-platform

# 或显式指定测试库
METRIC_CENTER_TEST_POSTGRES_DSN='postgres://<user>@127.0.0.1:5432/metric_center_test?sslmode=disable' make test-platform
```

> 迁移运行器对 PostgreSQL 使用 `default_query_exec_mode=simple_protocol`，因为单个迁移文件会整段多语句执行（含 `DO $$` 块）；运行时连接池仍走 prepared-statement 模式。`schema_migrations` 记账语句相应使用内联字面量（值均为本地派生，无外部输入）。

启动模式也可用 `--database.mode=v3`；flag 优先于环境变量。

v3 系统端点：`/api/v3/platform/health`（存活）、`/api/v3/platform/ready`（DB + migration）、
`/api/v3/platform/meta`（版本 / driver / 模块列表），均为匿名探针。
过渡期认证复用 legacy handler：`POST /api/v3/platform/auth/login`。

### API

- 新线：`/api/v3/platform/*`
- 旧线：`/api/v2/platform/*`（兼容窗口内保留）
- 契约：`modules/module-07/api-contract-snapshot-v3.md`

### 测试

```bash
go test ./platform/modules/m07/...
go test -race ./platform/modules/m07/...
make test-platform   # PostgreSQL 全量；METRIC_CENTER_TEST_POSTGRES_DSN 可覆盖
```

### 已知遗留

- 多租户查询过滤（S-1）；
- `connection_secret_ref` 解析 / 加密（S-3）；
- 审计写链路（S-6）；
- v3-only 的认证面仍复用 legacy handler（M03 v3 模块落地后替换）；
- 后端测试已统一跑 PostgreSQL（`make test-platform`，逐测试独立 schema）；CI 尚未配置带 `postgres:16` service 的 workflow；
- `network_domains.ip_c_id_rs` 物理列名沿用 v2，v3 网域模型落地时用 migration 改名；
- v2/v3 并行窗口结束后删除旧 v2 包。


---

## 7. M06 v3 交接说明

### 入口

```text
platform/modules/m06/
├── module.go          # 装配入口（Options{EnvFile,PromURL,Monitoring}）
├── domain/            # tenant / network_domain / user / login_log
├── dto/               # v3 契约视图
├── repository/        # tenant / network_domain / dictionary / user / login_log
├── service/           # tenant / network_domain / user / login_log
├── handler/           # 路由 + HTTP handlers
├── references/        # M07 引用计数、M09/M11 MonitoringRetirer 端口
└── storage/           # 保留策略 / 磁盘占用 / 日志轮转
```

旧 `platform/admin/{tenant,user,networkdomain,storagelog}` 为 v2 legacy，兼容窗口内冻结。

### 运行

- v3-only：`METRIC_CENTER_DB_MODE=v3`（或 `--database.mode=v3`）。
- 登录：`POST /api/v3/platform/auth/login`（过渡期复用 legacy auth）。
- 存储保留策略写入 `--config.dir` 下 `prom-retention.env`；Prometheus 重启后生效。
- 网域删除级联端口默认 no-op，`monitoring_available=false`；M09 v3 落地后注入实现。

### API

- 新线：`/api/v3/platform/*`
- 契约：`modules/module-06/api-contract-snapshot-v3.md`
- 旧线：`/api/v2/platform/*`（兼容窗口内保留，行为不变）

### 测试

```bash
GOPROXY=off .tools/go/bin/go test ./platform/db/...
GOPROXY=off .tools/go/bin/go test ./platform/modules/m07/...
GOPROXY=off .tools/go/bin/go test ./platform/modules/m06/...
GOPROXY=off .tools/go/bin/go test ./platform/cmd/metric-center/...
GOPROXY=off .tools/go/bin/go vet ./platform/...
```

### 已知遗留

- PostgreSQL 迁移与业务测试已全量实测（`make test-platform`）；CI 门禁待补；
- 最后管理员保护为进程内 mutex，多实例部署需数据库级锁；
- 用户软删后用户名仍被唯一索引占用，不支持同名重建；
- M09/M11 v3 未落地，网域删除级联为端口 + no-op；
- `/zone-types` 仍由 M07 注册；`/cloud-dict` 的 GET 由 M07 承载、写接口在 M06（D37），v3.1 字典模块化时统一迁移；
- NFR-10（1 万资源 / 100 网域 / 10 万登录日志首屏）压测未执行；
- v3 前端尚未改造，需按新契约接入。
