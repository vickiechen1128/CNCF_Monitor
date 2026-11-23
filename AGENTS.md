# MetricCenter - Agent 协作速查

> 本文档面向 AI 编程助手，提供项目的整体认知、常用命令、目录边界、开发规范和安全注意事项。
> 项目主要使用中文编写文档和注释，本文档同样使用中文。
> 若发现本文与源码或 `docs/` 最新文档冲突，以源码和 `docs/03-engineering-standards/` 为准，并请及时更新本文。

---

## 1. 项目概述

**MetricCenter** 是一个基于 Prometheus 改造包装的企业级**指标采集与查询中心**。项目采用**控制面 + 数据面**分离架构：

- **控制面**：`platform/`（Go 后端）+ `ui-custom/web/`（React 前端），负责配置管理、CMDB、采集规则下发、租户/用户管理和查询代理。
- **数据面**：`upstream/prometheus/` + `upstream/node_exporter/`，负责指标抓取、TSDB 存储、PromQL 查询和告警求值。

**核心约束**：业务代码必须写在 `platform/` 或 `ui-custom/web/`，尽量不动 `upstream/`；必须修改上游源码时，通过 `patches/prometheus/` 管理 patch（当前该目录尚未创建，属于预留机制）。

当前处于 **v3-only / PostgreSQL-only（v2.0 rewrite 线）**，已实现：

- `platform/cmd/metric-center/`：基于 Gin 的 v3-only 控制面主程序，提供 `/api/v3/platform/*` 管理接口、`/api/v3/edge/*` 边缘接口与 `/api/v1/*` Prometheus 查询代理。
- `platform/modules/mXX/`：M01/M05/M06/M07/M08/M09 业务模块。
- `platform/foundation/`：统一错误/响应、HTTP 辅助、模块 Registry、health/ready。
- `platform/db/`：PostgreSQL + GORM 初始化与 v3 版本化迁移（`migrations/v3/*.postgres.sql`）；`cmd/migrate/` 提供迁移命令。
- `ui-custom/web/`：基于 Vite + React 18 + TypeScript + Ant Design 的独立前端门户。
- `platform/edge-sync-agent/`：边缘采集客户端（独立 Go module）。

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 控制面后端 | Go 1.26.1 | `go.mod` 中声明，使用项目级工具链 `.tools/go/` |
| Web 框架 | Gin v1.10 | 路由、中间件、HTTP API |
| 元数据存储 | PostgreSQL 16 + GORM | `gorm.io/driver/postgres`；本地默认 `postgres://<系统用户>@127.0.0.1:5432/metric_center`，生产由 `METRIC_CENTER_DB_DSN` 注入 |
| 数据面引擎 | Prometheus（Go） | `upstream/prometheus/` 子模块，负责抓取/存储/查询 |
| 采集/边缘 | node_exporter + edge-sync-agent | `upstream/node_exporter/` 子模块；`platform/edge-sync-agent/` |
| 前端 | React 18 + TypeScript 5.5 | `ui-custom/web/` |
| 构建工具 | Vite 5 | 前端 dev / build / preview |
| UI 组件 | Ant Design 5 | 企业级后台组件库 |
| 包管理 | pnpm 9.x / 11.x | 前端依赖管理；`pnpm-workspace.yaml` 声明单包 workspace |
| 测试 | Go `testing` + testify；Vitest + React Testing Library | 后端与前端单元测试 |
| 构建编排 | Makefile + `setup.sh` | 统一入口，管理 Go/Node/pnpm 工具链 |

---

## 3. 目录结构

```
CNCF_Monitor-worktree/
├── .agents/                        # 跨工具共享资产
│   ├── README.md                   # 使用原则
│   └── skills/                     # 唯一 Skill 源（OpenCode / Trae 自动发现）
├── .tools/                         # 项目级工具链（Go、Node.js、pnpm、可选 MinGW-w64），被 .gitignore 忽略
├── upstream/                       # 上游开源子模块源码
│   ├── prometheus/                 # Prometheus 源码（禁止直接修改）
│   ├── alertmanager/               # Alertmanager 源码（禁止直接修改）
│   ├── blackbox_exporter/          # blackbox_exporter 源码（禁止直接修改）
│   └── node_exporter/              # node_exporter 源码（禁止直接修改，当前不默认构建）
├── platform/                       # MetricCenter 业务扩展代码
│   ├── cmd/metric-center/          # v3-only 控制面主程序（main.go + v3.go）
│   ├── cmd/migrate/                # PostgreSQL migration 命令行
│   ├── modules/mXX/                # 业务模块（m01/m05/m06/m07/m08/m09）
│   ├── foundation/                 # apierror / apiresponse / httpx / module registry / system
│   ├── gateway/auth/               # 认证（M03 重写前的过渡适配器）
│   ├── models/                     # 共享 GORM 模型
│   ├── db/migrations/v3/           # PostgreSQL-only 版本化迁移
│   ├── testutil/testdb/            # 逐测试独立 PG schema
│   └── edge-sync-agent/            # 边缘采集客户端（独立 Go module）
├── ui-custom/web/                  # 独立前端门户
│   ├── src/api/                    # API 客户端
│   ├── src/components/             # 通用组件
│   ├── src/layouts/                # 布局组件
│   ├── src/pages/                  # 页面组件
│   ├── src/types/                  # TypeScript 类型定义
│   ├── package.json                # 前端依赖与脚本
│   ├── pnpm-workspace.yaml         # pnpm workspace 与 allowBuilds 配置
│   ├── tsconfig.json               # TypeScript 配置
│   └── vercel.json                 # Vercel 部署配置
├── docs/                           # 项目文档（按读者/场景编号）
│   ├── 01-team-collaboration/      # 团队协作、角色、流程
│   ├── 02-product-requirements/    # 产品需求（Modules/SRS/*.md 为需求基线）
│   ├── 03-engineering-standards/   # 工程标准（必读）
│   ├── 04-source-architecture/     # 源码架构分析
│   ├── 05-execution-records/       # 执行记录（含 design-proposals/）
│   ├── 06-mvp-e2e-testing/         # 部署手册（V2 E2E 已归档）
│   ├── 07-design/                  # 模块概要设计与关键设计专题（HLD）
│   └── prototypes/                 # V2 可点击原型（已归档）
├── scripts/                        # 构建与辅助脚本（含可选的 repo-map 符号地图生成器）
├── Makefile                        # 统一构建入口
├── setup.sh                        # 跨平台一键初始化脚本
├── SETUP_WINDOWS.md                # Windows 环境初始化指南
├── go.mod / go.sum                 # Go 模块依赖
├── .gitmodules                     # Git 子模块配置
└── README.md                       # 项目总览与快速开始
```

> **Skill 单一源**：`.agents/skills/` 是唯一源，直接修改；不再维护 `.kimi` 镜像、同步脚本或工具专属副本。各 harness 只写薄适配器指向 `AGENTS.md` 与 `.agents/skills/`。

---

## 4. 环境要求与工具链安装

### 4.1 前置依赖

- `make`（构建编排入口）
- `curl`（下载二进制包）
- `git`（子模块、源码管理）
- PostgreSQL 16（控制面元数据库；macOS `brew install postgresql@16`，Linux 用发行版包）
- Docker（可选，用于本地运行 Prometheus / node_exporter）

### 4.2 一键安装工具链

```bash
bash setup.sh
```

`setup.sh` 会：

1. 确保 `make` 可用（Windows Git Bash 下自动处理）。
2. 安装 Go 1.26.1、Node.js 22.14.0、pnpm 到 `.tools/`（项目级，不污染系统 PATH）。
3. 初始化 Git 子模块。
4. 应用 `patches/prometheus/*.patch`（当前 patch 目录尚未创建）。
5. 编译 `metric-center` 后端（纯 Go，无需 CGO）。
6. 构建 Custom UI。
7. 运行后端测试（PostgreSQL；`make test-platform` 自动准备本地测试库）。
8. 安装 Kimi hooks（可选）。

### 4.3 手动安装工具链

```bash
make install-tools   # 安装 Go + Node.js + pnpm
```

验证：

```bash
.tools/go/bin/go version
.tools/node/bin/node --version
.tools/pnpm/bin/pnpm --version
```

---

## 5. 常用构建、运行与测试命令

> 所有 `make` 命令已自动将 `.tools/go/bin`、`.tools/node/bin`、`.tools/pnpm/bin` 加入 PATH，并锁定 `GOROOT` 到项目级 Go。

### 5.1 构建

```bash
make build-metric-center   # 编译控制面后端 -> platform/cmd/metric-center/metric-center
make build-prometheus      # 编译上游 Prometheus（首次会自动构建 Web UI 资源）
make build-ui              # 构建 Custom UI -> ui-custom/web/dist
make build-all             # 编译后端 + Prometheus + 前端
make build-alertmanager    # 编译上游 Alertmanager -> upstream/alertmanager/alertmanager
make build-amtool          # 编译上游 amtool（AM 配置校验命令行）-> upstream/alertmanager/amtool
make build-blackbox-exporter  # 编译上游 blackbox_exporter -> upstream/blackbox_exporter/blackbox_exporter
make build-center          # 编译中心一体化交付包（metric-center + prometheus + alertmanager + blackbox_exporter + ui）
make build-edge-agent      # {v0.2} 编译边缘采集客户端 -> platform/edge-sync-agent/edge-sync-agent
make build-edge-package    # {v0.2} 组装边缘一体化离线包
```

### 5.2 运行

```bash
make run-metric-center     # 编译、迁移并启动控制面（默认 http://localhost:8080，连本地 PostgreSQL；M09 reload 走 --prometheus.url 的 /-/reload）
make run-prometheus        # 编译并启动 Prometheus（默认 http://localhost:9090；--config.file 指向 config-output/prometheus.yml（首次自动 seed）并开启 --web.enable-lifecycle）
make run-alertmanager      # 编译并启动 Alertmanager（默认 http://localhost:9093；--config.file 指向 config-output/alertmanager.yml（首次自动 seed），M08 静默代理/配置挂载依赖）
make dev-ui                # 启动前端开发服务器（默认 http://localhost:5173）
```

> 注意：`make run-metric-center` 会重新编译并启动新二进制；Makefile 已把 `upstream/prometheus`、`upstream/blackbox_exporter`、`upstream/alertmanager` 加入 PATH，M09 草稿校验才能找到 `promtool` / `blackbox_exporter`，M08 的 Alertmanager 配置挂载校验才能找到 `amtool`。后端代码改动后旧进程不会自动加载新逻辑，需先停止旧进程再执行 `make run-metric-center`。若手动启动二进制，必须显式导出 `PATH="$(pwd)/upstream/prometheus:$(pwd)/upstream/blackbox_exporter:$(pwd)/upstream/alertmanager:$PATH"`，否则草稿校验会卡在 `pending`（提示「promtool / amtool 不可调用」）。
> 另外，旧逻辑生成的 `pending` 草稿会按 checksum 幂等返回；要验证新逻辑，需先废弃旧单，再重新触发变更。废弃会按决策 43 回滚源数据（如把禁用的 Job 恢复启用），典型验证动线：废弃旧单 → 重新禁用 → 生成新单 → 重校/确认。

### 5.3 测试

```bash
make test-platform         # 运行 platform/ 下所有 Go 测试
```

前端测试需进入 `ui-custom/web/`：

```bash
cd ui-custom/web
pnpm install
pnpm vitest run src/pages/<module>/__tests__/<File>.test.tsx   # 单任务默认
pnpm run typecheck:test                                         # 测试类型门禁
pnpm lint                                                      # eslint
pnpm test                                                      # 全量，仅 testing-tdd §4.2 允许时
```

### 5.4 其他

```bash
make apply-patches         # 应用 patches/prometheus/*.patch 到上游源码
make repo-map              # 生成业务代码符号地图（可选辅助索引）-> docs/04-source-architecture/repo-map.md
make check-repo-map        # 手动校验符号地图新鲜度（可选，不再作为提交/合并门禁）
make install-git-hooks     # 启用项目级 git hooks（core.hooksPath=scripts/git-hooks；setup.sh 已集成）
make clean                 # 清理构建产物
bash scripts/review-precheck.sh -m module-XX  # 生成结构化审查预检报告 -> docs/05-execution-records/module-XX/review-precheck.md
```

---

## 6. 代码组织

### 6.1 后端（`platform/`）

- `cmd/metric-center/main.go`：唯一控制面入口。
  - 系统模块注册 `/api/v3/platform/health`（liveness）与 `/api/v3/platform/ready`（DB + migration readiness）。
  - 注册 `/api/v1/query`、`/api/v1/query_range`、`/api/v1/labels`、`/api/v1/label/:name/values`、`/api/v1/series`，代理到 Prometheus。
- `db/db.go` + `db/migrate.go`：PostgreSQL 连接与 v3 迁移入口；`cmd/migrate/` 提供 migrate/status/down 命令；`migrations/v3/` 为嵌入式版本化迁移。
- `models/`：共享 GORM 模型。
- `foundation/`：`apierror` / `apiresponse` 统一错误与响应、`httpapi` / `httpx` HTTP 辅助、`module` Registry、`system` health/ready。
- `modules/mXX/`：业务模块（m01/m05/m06/m07/m08/m09），按 handler / service / repository / dto / domain 分层。
- `edge-sync-agent/`：部署在边缘节点的独立客户端（独立 `go.mod`），负责心跳、配置包拉取、进程守护与 reload。详见 `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`。

### 6.2 前端（`ui-custom/web/`）

- `src/main.tsx`：React 应用入口。
- `src/App.tsx`：当前仅渲染 `HomePage`。
- `src/api/client.ts`：基于 `fetch` 的 API 客户端，解析后端统一响应格式，抛出 `ApiError`。
- `src/pages/`：页面组件（home、query、collection、config、resources、alerts）。
- `src/layouts/MainLayout.tsx`：主布局。
- `src/types/api.ts`、`src/types/resource.ts`：全局类型。

### 6.3 上游隔离

- `upstream/prometheus/` 和 `upstream/node_exporter/` 是 Git 子模块，**禁止直接修改**。
- 必须修改上游时：
  1. 在 `upstream/prometheus/` 中完成修改；
  2. 生成 patch 到 `patches/prometheus/0001-<描述>.patch`；
  3. 在 `patches/prometheus/README.md` 记录用途和验证方法；
  4. 通过 `make apply-patches` 应用。

### 6.4 代码布局

当前为 v3-only / PostgreSQL-only：业务模块在 `platform/modules/mXX`，跨模块基础设施在 `platform/foundation`，迁移在 `platform/db/migrations/v3`。旧 v2 业务目录已移除；`platform/gateway/auth` 是 M03 重写前的过渡认证适配器。

---

## 7. 开发规范与代码风格

### 7.1 目录隔离铁律

| 目录 | 允许修改 | 禁止修改 |
|------|----------|----------|
| `platform/modules/`、`platform/foundation/`、`platform/models/`、`platform/db/`、`platform/cmd/` | backend / prometheus developer | frontend developer、reviewer |
| `platform/edge-sync-agent/`（独立 Go module） | backend developer | reviewer |
| `ui-custom/web/` | frontend developer | backend developer、reviewer |
| `docs/02-product-requirements/`（SRS） | 需求 Owner、项目 Owner | developer、reviewer |
| `docs/07-design/`（HLD / Scenario Link） | 技术 Owner | developer、reviewer |
| `docs/prototypes/`（V2 已归档） | 不维护 | developer、reviewer |
| `docs/05-execution-records/` | 各角色写入自己的执行记录 | 覆盖他人记录 |
| `.agents/skills/`、`docs/03-engineering-standards/`、`AGENTS.md` | 项目 Owner + 任务明确要求 | 借任务夹带无关改动 |
| `upstream/` | 仅 patch 流程中的最小化修改 | 直接新增业务代码 |
| `patches/prometheus/` | prometheus developer | 其余角色 |

### 7.2 Go 编码风格

- 包注释说明用途；结构体/函数按需添加注释。
- 错误处理使用 `fmt.Errorf("...: %w", err)` 包装上下文。
- HTTP API 使用 `platform/foundation/apiresponse` 统一响应。
- 外部依赖通过接口注入，便于单元测试 mock。
- 测试文件使用 `*_test.go`，使用 `testify/assert` 和 `testify/require`。

### 7.3 前端编码风格

- 函数组件 + Hooks。
- 组件文件 PascalCase：`TargetList.tsx`；工具文件 camelCase：`formatTime.ts`。
- TypeScript 严格模式已开启（`tsconfig.json`）。
- API 调用统一走 `src/api/client.ts`。

### 7.4 Commit 规范

```
<模块>: <动作> - <简短描述>

- 关联执行记录: docs/05-execution-records/module-XX-<功能名>/<agent>.md
- 变更范围: platform/xxx, ui-custom/web/xxx
```

---

## 8. 测试策略

### 8.1 后端测试

- 所有 `platform/` 业务包必须包含 `*_test.go`。
- 单元测试使用标准 `testing` + `testify`。
- 数据库测试统一跑 PostgreSQL（生产同方言，SQLite 已移除）：用
  `platform/testutil/testdb` 打开逐测试独立的 schema，或直接导出
  `METRIC_CENTER_TEST_POSTGRES_DSN`。
- 不修改 `upstream/prometheus/` 原有测试。

当前已验证的测试命令：

```bash
make test-platform   # 自动准备本地 PG 测试库并跑全量（DSN 可用 METRIC_CENTER_TEST_POSTGRES_DSN 覆盖）
```

### 8.2 前端测试

```bash
cd ui-custom/web
pnpm vitest run <目标测试文件或目录>   # 开发中默认
pnpm run typecheck:test                # 测试类型门禁
pnpm lint                              # eslint
pnpm test                              # 全量，仅 testing-tdd §4.2 允许时
```

### 8.3 覆盖率目标

| 模块 | 目标覆盖率 |
|------|-----------|
| `platform/foundation` | ≥ 80% |
| `platform/modules` 新增/修改包 | ≥ 70% |
| `platform/db`（migration / DSN） | ≥ 70% |
| `ui-custom/web` | ≥ 50% |

### 8.4 提交前验证清单

- [ ] `go test ./platform/...` 通过
- [ ] `go vet ./platform/...` 通过
- [ ] 前端按 `testing-tdd` §6 完成目标测试 / 变更范围回归、`typecheck:test`、`pnpm lint`；全量 `pnpm test` 仅在 §4.2 适用时执行
- [ ] 后端服务能启动，`/api/v3/platform/health`、`/api/v3/platform/ready` 返回 200
- [ ] 前端 dev server 能启动，首页返回 200
- [ ] 验证完成后停止服务并释放端口

详细命令见 `docs/03-engineering-standards/04_Testing_Standard.md` §4。

---

## 9. 安全注意事项

1. **上游源码隔离**：不直接修改 `upstream/`，避免引入难以追踪的安全补丁冲突。
2. **Prometheus 代理鉴权**：`platform/cmd/metric-center/main.go` 中的 Prometheus 查询代理目前仅做透传，TODO 中已标注需要在转发前完成租户/用户认证与查询范围隔离。
3. **URL 校验**：`parseURL` 强制校验 `http`/`https` scheme 和非空 host，避免异常 scheme 或空目标。
4. **数据库**：PostgreSQL 连接串可能含口令，必须通过 `METRIC_CENTER_DB_DSN` / 部署环境 `env.sh` 注入，禁止写入仓库；本地开发用 `./scripts/pg-dev.sh` 管理实例与库。
5. **敏感文件保护**：`.env`、SSH 私钥、数据库文件等已被 `.gitignore` 忽略；hooks 中也有 `protect-env.sh` 防止误改。
6. **依赖安全**：Go 依赖通过 `go.mod` / `go.sum` 锁定；前端依赖通过 `pnpm-lock.yaml` 锁定。
7. **SSRF 防护**：后端代理 Prometheus 接口时，应校验目标 URL 是否属于允许列表，避免用户构造请求访问内网服务。

---

## 10. 部署流程

### 10.1 本地开发

```bash
# 终端 1
make run-prometheus

# 终端 2
make run-metric-center

# 终端 3
make run-alertmanager   # M08 场景（静默代理 / AM 配置挂载）需要；MVP 前端页面无需

# 终端 4
make dev-ui
```

> 测试/生产环境建议将 `metric-center` 与 Prometheus 作为「一体化交付包」同机部署：一个安装包内同时包含两个二进制，由 systemd / supervisor / 启动脚本统一拉起，但二者仍是独立进程。M09 `local` 下发通道要求控制面能直接写 Prometheus 配置目录并触发 reload。详见 `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`。
>
> **生产目录规范（决策 64）**：生产部署对齐《业务软件标准化目录与权限配置操作手册》三目录基线——程序/种子配置 `/opt/apps/metric-center/`（只读）、数据 `/opt/data/metric-center/`（TSDB / config-output 活配置；元数据在外部 PostgreSQL）、日志 `/opt/log/metric-center/`，三目录由运维预建；交付包 `env/env.sh` 集中定义 `DATA_ROOT` / `LOG_ROOT` / TSDB 保留策略，`start.sh` 双模式（有 env.sh 走生产路径，否则回落包内 data/logs 解压即用）；活配置落 `/opt/data/.../config-output/` 以兼容程序目录只读红线。详见 `docs/06-mvp-e2e-testing/package-center-guide.md` §2.4。

### 10.2 Vercel 预览

- 触发分支：`feature/module-*`、`develop`、`main`。
- `ui-custom/web/vercel.json` 配置：
  - `VITE_STATIC_PREVIEW=true`：静态预览环境使用 mock 状态。
  - `ignoreCommand` 跳过 `design/*` 和 `feature/prototype-*` 分支。
- 如需联调真实后端，可在 Vercel Environment Variables 中配置 `VITE_API_BASE_URL`。

### 10.3 GitHub Pages 原型预览（历史）

- V2 原型已归档，`docs/prototypes/**` 不再更新；`.github/workflows/deploy-prototype.yml` 保留但默认不触发。
- 如恢复原型流程，使用新目录 `docs/prototypes-v3/` 并同步调整 workflow 路径。

### 10.4 容器化（可选）

```bash
docker run -p 9090:9090 prom/prometheus:latest
```

---

## 11. 协作工作流（简要）

项目采用 **双文件夹隔离 + 按功能子模块拆分 feature 分支** 模型。

- **双轨制（v2.0 起）**：需求按「五问」判定走 **Track A**（核心差异化能力：完整 SRS + 高保真场景演示）或 **Track B/B+**（通用标准能力：轻量 SRS + `dev-ready`；B+ 涉安全敏感，强制独立安全审查）；权威定义见 `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md` §1.0 与 `srs-authoring` / `hld-design` Skill。
- **版本重写（v2.0 起）**：全模块下一代版本重写使用 `rewrite/vX.Y`（如 `rewrite/v2.0`）；SRS + 代码 + schema 同分支演进，旧版本归档不维护；新线 API 统一 `/api/v3/platform/*`。权威定义见 `docs/05-execution-records/rewrite/v2.0/charter.md` 与 `cncf-git-workflow` Skill。
- **需求 → 设计**：需求方产出 SRS（业务场景 SCN + 验收），技术方产出 HLD（场景→实现 + 演示脚本），双方唯一链接点是 `Module_XX_Scenario_Link.md`，并在开发前完成场景演示走查。

1. **需求阶段**：需求 Owner 通过对话产出 SRS（场景 + 验收 + 非目标），分支 `design/module-mvp-demo` 或 `rewrite/vX.Y`。
2. **设计阶段**：技术 Owner 产出 HLD + Scenario Link + 场景演示脚本，与需求方联合走查。
3. **规划阶段**：从 Scenario Link 派生 `task-sequence.yaml`（每个任务引用 SCN / HLD 章节）。
4. **开发阶段**：backend / frontend 在开发空间基于 `develop` / `rewrite/vX.Y` 创建分支，TDD 开发，按场景验收。
5. **审查阶段**：独立 reviewer（Go / 前端 / 安全）审查，核对场景覆盖。
6. **合并阶段**：Orchestrator 在验证通过后以 `--no-ff` 合并到 `develop`。
7. **验证阶段**：在 `develop` 重复执行测试与服务启动验证。

### 功能详细设计提案（Design Proposal）

当开发工程师需要针对某个核心功能编写详细设计、但暂不直接修改模块 SRS 时，使用 **design-proposal** 机制：

- **位置**：`docs/05-execution-records/module-XX/design-proposals/<feature-name>.md`
- **状态标记**：文档头部标注 `状态：draft / reviewing / approved / merged`
- **评审**：由技术 Owner 或需求 Owner 评审；涉及跨模块契约的，必须先落档 `design-decisions.md`
- **合并**：批准后由技术 Owner 或原作者将内容合并进主 SRS/HLD，版本 +1，Change Log 记录「吸收 design-proposal <feature-name>」
- **归档**：合并后提案保留在 `design-proposals/` 目录，状态改为 `merged`
- **模板**：由开发工程师按功能复杂度自行定义，最小需包含「需求背景 / 设计范围 / 详细设计 / 验收标准 / 与现有 SRS/HLD 差异点 / 合并计划」

Agent 角色、边界与流程的权威定义见 `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md` 与 `.agents/skills/`；各 harness 的子代理/模型/权限由工具自身管理。

---

## 12. 关键文档索引

| 文档 | 说明 |
|------|------|
| `README.md` | 项目总览、目录结构、快速开始 |
| `Makefile` | 统一构建命令 |
| `setup.sh` / `SETUP_WINDOWS.md` | 一键初始化脚本与 Windows 指南 |
| `docs/03-engineering-standards/00_Engineering_Standard.md` | 目录结构、技术栈、编码前必读 |
| `docs/03-engineering-standards/01_Code_Isolation_Standard.md` | upstream 与业务代码隔离规则 |
| `docs/03-engineering-standards/02_Frontend_Standard.md` | 前端开发规范（组件选型 / 长文本与横向滚动 / 页面状态）、pnpm workspace 约束 |
| `docs/03-engineering-standards/03_API_Standard.md` | API 设计规范、路由规划、错误类型 |
| `docs/03-engineering-standards/04_Testing_Standard.md` | 测试标准与提交前验证清单 |
| `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md` | AI Agent 协作流程 |
| `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` | 分支策略与回退指南 |
| `docs/03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md` | 后端分层、migration、架构红线（R1/R2/R4） |
| `docs/02-product-requirements/Modules/SRS/*.md` | 各模块 SRS（需求基线：场景 SCN + 验收） |
| `docs/02-product-requirements/Domain_Map.md` | 业务域（DOMAIN）↔ 实现模块（mXX）映射 |
| `docs/07-design/README.md` | 概要设计目录：SRS/设计分层约定、模板与索引 |
| `docs/07-design/Module_09_Config_and_Query_Center_High_Level_Design.md` | M09 配置与查询中心概要设计（场景→实现映射/接口清单/数据归属/关键流程/追溯） |
| `docs/07-design/Module_09_Scenario_Link.md` | M09 场景链接矩阵（场景 ↔ 设计 ↔ 演示 ↔ 验收） |
| `docs/05-execution-records/module-09/scenario-walkthrough.md` | M09 场景演示脚本（技术方走查、需求方反馈） |
| `docs/07-design/design-notes/` | M09 关键设计专题（PromQL 注入 / 配置发布 / 查询页交互） |
| `docs/prototypes/module-XX/` | V2 可点击原型（已归档，仅历史参考） |
| `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md` | M09 部署形态与 Edge Sync Agent 代码组织决策 |
| `docs/06-mvp-e2e-testing/README.md` | 部署手册索引（V3 / PostgreSQL；V2 E2E 已归档） |
| `docs/06-mvp-e2e-testing/frontend-backend-deploy-topology.md` | 前端访问后端部署拓扑决策：当前单机走 A2（相对路径 + metric-center 托管静态文件），未来前后端分离走 nginx 反代；含打包改造清单 |
| `docs/04-source-architecture/repo-map.md` | 业务代码符号地图（`make repo-map` 生成，禁止手改）；可选辅助索引，非强制定位入口 |
| `.agents/README.md` | 跨工具项目资产使用原则 |
| `.agents/skills/` | **唯一 Skill 源**（OpenCode / Trae 自动发现；直接修改） |
| `docs/05-execution-records/module-00-infrastructure/cross-tool-skill-sharing.md` | 跨工具 Skill 共享历史决策（旧机制，已由单一源取代） |

---

## 13. 已知当前状态（截至本文件生成时）

- 后端 v3-only / PostgreSQL-only 骨架已跑通，`make test-platform`（PostgreSQL 全量）通过；`platform/modules/mXX` + `platform/foundation` 为当前代码布局。
- 前端已接入 v3 API（`/api/v3/platform/*`），M09 查询页持续演进。
- `patches/` 目录尚未创建；仅在实际需要修改 upstream 时创建并走 patch 流程。
- `upstream/alertmanager/` 与 `upstream/blackbox_exporter/` 已添加为 Git 子模块，支撑 M08 通知收敛与 M01/M09 blackbox 拨测；`upstream/node_exporter/` 保留子模块但当前不默认构建。
- `platform/gateway/auth/` 是 M03 重写前的过渡认证适配器；其余旧 v2 业务目录已移除。
- 跨模块联调分支策略已决策：每个版本末从 `develop` 切出短生命周期 `integration/vX.Y` 分支承载 Phase 5 联调，验收后 `--no-ff` 合回 `develop`、在合并点打版本基线 tag `baseline/vX.Y-*`（annotated，作为整版回退锚点）并删除分支；联调窗口内已合并的 `feat/module-XX` 冻结，避免冲突。详见 `docs/05-execution-records/module-00-infrastructure/integration-branch-strategy.md` 与 `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` §2.5/§6.6。
- 已新增可选的代码定位辅助：`scripts/repo-map`（Go AST + TS 导出正则）生成 `docs/04-source-architecture/repo-map.md` 符号地图（覆盖 `platform/` 与 `ui-custom/web/src/`，刻意排除 `upstream/`）；定位优先使用 harness 原生搜索与文档索引，repo-map 仅作可选辅助。
- repo-map 不再作为提交/合并门禁：pre-commit hook 仅保留 SRS 合规校验，`check-repo-map.yml` 已移除，`review-precheck.sh` 不再输出该项；`make check-repo-map` 保留为手动可选校验。
