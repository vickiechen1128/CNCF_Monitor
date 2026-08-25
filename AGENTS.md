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

当前处于 **MVP 阶段**，已实现：

- `platform/cmd/metric-center/`：基于 Gin 的控制面主程序，提供健康检查、SQLite 元数据、`/api/v1/*` Prometheus 查询代理、`/api/v2/platform/*` 配置占位 API。
- `platform/models/`：CMDB 资源模型（Host / Middleware / Application）、标签模板、采集任务、Blackbox 探测配置的 GORM 模型。
- `platform/db/`：SQLite + GORM 初始化与迁移。
- `platform/api/response/`：统一 JSON 响应格式。
- `ui-custom/web/`：基于 Vite + React 18 + TypeScript + Ant Design 的独立前端门户。
- `platform/examples/simple-agent/`：标准采集端 Agent 模板，演示 Prometheus client_golang 用法。

---

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 控制面后端 | Go 1.26.1 | `go.mod` 中声明，使用项目级工具链 `.tools/go/` |
| Web 框架 | Gin v1.10 | 路由、中间件、HTTP API |
| 元数据存储 | SQLite + GORM | `gorm.io/driver/sqlite`，开发期零运维；默认 `metric_center.db` |
| 数据面引擎 | Prometheus（Go） | `upstream/prometheus/` 子模块，负责抓取/存储/查询 |
| 采集示例 | node_exporter + simple-agent | `upstream/node_exporter/` 子模块；`platform/examples/simple-agent/` |
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
├── .kimi/                          # Kimi Agent 团队配置
│   ├── agents/                     # Agent 角色定义（orchestrator、backend-developer、frontend-developer 等）
│   ├── skills/                     # 共享 Skill（cncf-project、prometheus-architecture、testing-tdd 等）
│   └── AGENTS.md                   # Agent 团队速查（与本文件不同：本文件面向所有 AI Agent 的项目总览）
├── .trae/                          # Trae IDE 配置与 Skill
├── .tools/                         # 项目级工具链（Go、Node.js、pnpm、可选 MinGW-w64），被 .gitignore 忽略
├── upstream/                       # 上游开源子模块源码
│   ├── prometheus/                 # Prometheus 源码（禁止直接修改）
│   ├── alertmanager/               # Alertmanager 源码（禁止直接修改）
│   ├── blackbox_exporter/          # blackbox_exporter 源码（禁止直接修改）
│   └── node_exporter/              # node_exporter 源码（禁止直接修改，当前不默认构建）
├── platform/                       # MetricCenter 业务扩展代码
│   ├── cmd/metric-center/          # 控制面主程序入口
│   ├── edge-sync-agent/            # v0.2 边缘采集客户端（独立 Go module）
│   ├── api/response/                 # 统一 API 响应封装
│   ├── db/                         # SQLite + GORM 连接与迁移
│   ├── models/                     # 领域模型（CMDB、标签模板、采集任务等）
│   ├── examples/simple-agent/      # 标准采集端 Agent 模板（独立 Go 模块）
│   └── gateway/、discovery/、collector/、storage/、config/  # 预留扩展目录
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
│   ├── 02-product-requirements/    # PRD、模块需求（Modules/Module_XX_*.md）
│   ├── 03-engineering-standards/   # 工程标准（必读）
│   ├── 04-source-architecture/     # 源码架构分析
│   ├── 05-execution-records/       # Agent 执行记录
│   └── prototypes/                 # 可点击原型（module-01 ~ module-10）
├── scripts/                        # 构建与辅助脚本
├── Makefile                        # 统一构建入口
├── setup.sh                        # 跨平台一键初始化脚本
├── SETUP_WINDOWS.md                # Windows 环境初始化指南
├── install-hooks.sh                # Kimi hooks 安装脚本
├── go.mod / go.sum                 # Go 模块依赖
├── .gitmodules                     # Git 子模块配置（upstream/prometheus、upstream/node_exporter）
└── README.md                       # 项目总览与快速开始
```

---

## 4. 环境要求与工具链安装

### 4.1 前置依赖

- `make`（构建编排入口）
- `curl`（下载二进制包）
- `git`（子模块、源码管理）
- C 编译器（macOS/Linux 通常已自带；Windows 由 `setup.sh` / Makefile 自动下载 MinGW-w64）
- Docker（可选，用于本地运行 Prometheus / node_exporter）

### 4.2 一键安装工具链

```bash
bash setup.sh
```

`setup.sh` 会：

1. 确保 `make` 可用（Windows Git Bash 下自动处理）。
2. 安装 Go 1.26.1、Node.js 22.14.0、pnpm 到 `.tools/`（项目级，不污染系统 PATH）。
3. 确保 CGO 编译器可用（Windows 自动下载 MinGW-w64）。
4. 初始化 Git 子模块。
5. 应用 `patches/prometheus/*.patch`（当前 patch 目录尚未创建）。
6. 编译 `metric-center` 后端。
7. 构建 Custom UI。
8. 运行后端测试。
9. 安装 Kimi hooks（可选）。

### 4.3 手动安装工具链

```bash
make install-tools   # 安装 Go + Node.js + pnpm + CGO 编译器
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
make build-blackbox-exporter  # 编译上游 blackbox_exporter -> upstream/blackbox_exporter/blackbox_exporter
make build-center          # 编译中心一体化交付包（metric-center + prometheus + alertmanager + blackbox_exporter + ui）
make build-edge-agent      # {v0.2} 编译边缘采集客户端 -> platform/edge-sync-agent/edge-sync-agent
make build-edge-package    # {v0.2} 组装边缘一体化离线包
```

### 5.2 运行

```bash
make run-metric-center     # 编译并启动控制面（默认 http://localhost:8080；已默认传 --config.reload-url=http://localhost:9090/-/reload）
make run-prometheus        # 编译并启动 Prometheus（默认 http://localhost:9090；--config.file 指向 config-output/prometheus.yml（首次自动 seed）并开启 --web.enable-lifecycle）
make dev-ui                # 启动前端开发服务器（默认 http://localhost:5173）
```

### 5.3 测试

```bash
make test-platform         # 运行 platform/ 下所有 Go 测试
```

前端测试需进入 `ui-custom/web/`：

```bash
cd ui-custom/web
pnpm install
pnpm test        # vitest run
pnpm lint        # eslint . --ext ts,tsx
```

### 5.4 其他

```bash
make apply-patches         # 应用 patches/prometheus/*.patch 到上游源码
make clean                 # 清理构建产物
bash scripts/review-precheck.sh -m module-XX  # 生成结构化审查预检报告 -> docs/05-execution-records/module-XX/review-precheck.md
```

---

## 6. 代码组织

### 6.1 后端（`platform/`）

- `cmd/metric-center/main.go`：唯一控制面入口。
  - 注册 `/api/v1/health`、`/api/v1/health/db`、`/api/v1/status`。
  - 注册 `/api/v1/query`、`/api/v1/query_range`、`/api/v1/labels`、`/api/v1/label/:name/values`、`/api/v1/series`，代理到 Prometheus。
  - 注册 `/api/v2/platform/config/preview` 和 `/api/v2/platform/config/apply` 占位。
- `db/db.go`：SQLite 初始化、GORM 迁移；支持 `METRIC_CENTER_DB_DSN` 环境变量覆盖默认 `metric_center.db`。
- `models/`：领域模型，统一嵌入 `BaseModel`（ID、时间戳、软删除），实现 `Resource` 接口。
- `api/response/`：统一响应格式 `{status, data, errorType, error}`。
- `edge-sync-agent/`（v0.2）：部署在边缘监控代理节点的独立客户端，负责心跳上报、配置包拉取、进程守护与 reload；使用独立 `go.mod`，便于最小化依赖与交叉编译。详见 `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`。

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

### 6.4 预留扩展目录

v0.2 计划落地的目录：`platform/edge-sync-agent/`（边缘采集客户端，独立 Go module）。

项目中存在但未实际落地的目录：`platform/gateway/`、`platform/discovery/`、`platform/collector/`、`platform/storage/`、`platform/config/`，后续模块会按需实现。

---

## 7. 开发规范与代码风格

### 7.1 目录隔离铁律

| 目录 | 允许修改 | 禁止修改 |
|------|----------|----------|
| `platform/` | backend-developer、prometheus-developer | prototype-designer |
| `platform/edge-sync-agent/`（v0.2，独立 Go module） | backend-developer | prototype-designer |
| `ui-custom/web/` | frontend-developer | prototype-designer |
| `docs/02-product-requirements/` | prototype-designer、chenrt | backend-developer、frontend-developer |
| `docs/prototypes/` | prototype-designer、chenrt | backend-developer、frontend-developer |
| `docs/05-execution-records/` | 各 Agent 写入自己的执行记录 | 覆盖他人记录 |
| `upstream/` | 全部禁止 | 全部 Agent |
| `patches/prometheus/` | prometheus-developer | prototype-designer |

### 7.2 Go 编码风格

- 包注释说明用途；结构体/函数按需添加注释。
- 错误处理使用 `fmt.Errorf("...: %w", err)` 包装上下文。
- HTTP API 使用 `platform/api/response` 统一响应。
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
- 数据库测试优先使用内存 DSN：`file::memory:?cache=shared`。
- 不修改 `upstream/prometheus/` 原有测试。

当前已验证的测试命令：

```bash
make test-platform
# 或
.tools/go/bin/go test ./platform/...
```

### 8.2 前端测试

```bash
cd ui-custom/web
pnpm test     # vitest run
pnpm lint     # eslint
```

### 8.3 覆盖率目标

| 模块 | 目标覆盖率 |
|------|-----------|
| `platform/gateway` | ≥ 70% |
| `platform/discovery` | ≥ 70% |
| `platform/collector` | ≥ 60% |
| `ui-custom/web` | ≥ 50% |

### 8.4 提交前验证清单

- [ ] `go test ./platform/...` 通过
- [ ] `go vet ./platform/...` 通过
- [ ] 前端 `pnpm test`、`pnpm lint` 通过
- [ ] 后端服务能启动，`/api/v1/health`、`/api/v1/health/db`、`/api/v1/status` 返回 200
- [ ] 前端 dev server 能启动，首页返回 200
- [ ] 验证完成后停止服务并释放端口

详细命令见 `docs/03-engineering-standards/04_Testing_Standard.md` §4。

---

## 9. 安全注意事项

1. **上游源码隔离**：不直接修改 `upstream/`，避免引入难以追踪的安全补丁冲突。
2. **Prometheus 代理鉴权**：`platform/cmd/metric-center/main.go` 中的 Prometheus 查询代理目前仅做透传，TODO 中已标注需要在转发前完成租户/用户认证与查询范围隔离。
3. **URL 校验**：`parseURL` 强制校验 `http`/`https` scheme 和非空 host，避免异常 scheme 或空目标。
4. **数据库**：SQLite 文件 `metric_center.db` 默认生成在项目根目录，生产环境应迁移到受保护的持久化存储。
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
make dev-ui
```

> 测试/生产环境建议将 `metric-center` 与 Prometheus 作为「一体化交付包」同机部署：一个安装包内同时包含两个二进制，由 systemd / supervisor / 启动脚本统一拉起，但二者仍是独立进程。M09 `local` 下发通道要求控制面能直接写 Prometheus 配置目录并触发 reload。详见 `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md`。

### 10.2 Vercel 预览

- 触发分支：`feature/module-*`、`develop`、`main`。
- `ui-custom/web/vercel.json` 配置：
  - `VITE_STATIC_PREVIEW=true`：静态预览环境使用 mock 状态。
  - `ignoreCommand` 跳过 `design/*` 和 `feature/prototype-*` 分支。
- 如需联调真实后端，可在 Vercel Environment Variables 中配置 `VITE_API_BASE_URL`。

### 10.3 GitHub Pages 原型预览

- 触发分支：`develop`、`main`，当 `docs/prototypes/**` 变更时。
- 工作流：`.github/workflows/deploy-prototype.yml`。
- 原型分支统一走 GitHub Pages，不走 Vercel。

### 10.4 容器化（可选）

```bash
docker run -p 9090:9090 prom/prometheus:latest
```

---

## 11. 协作工作流（简要）

项目采用 **双文件夹隔离 + 按功能子模块拆分 feature 分支** 模型。

- **设计空间**：`CNCF_Monitor-worktree`，固定分支 `design/module-mvp-demo`，用于写 PRD、改原型。
- **开发空间**：`CNCF_Monitor-feature`，从 `develop` 创建/切换 `feat/module-XX-<功能名>` 做 Vibe Coding（并行推进多模块时可在开发空间额外 `git worktree add` 多目录）。

1. **需求阶段**：`prototype-designer` 在设计空间产出 PRD 和可点击原型，分支 `design/module-mvp-demo`。
2. **规划阶段**：`planner` 从 ready PRD 派生 L2（实现地图 + 代码实施计划）和 L3（`task-sequence.yaml`）。
3. **开发阶段**：`backend-developer` / `frontend-developer` / `prometheus-developer` 在开发空间基于 `develop` 创建 `feat/module-XX-<功能名>` 分支，TDD 开发。
4. **审查阶段**：`golang-reviewer`、`frontend-reviewer`、`security-reviewer` 独立审查。
5. **合并阶段**：Orchestrator 在验证通过后以 `--no-ff` 合并到 `develop`。
6. **验证阶段**：在 `develop` 重复执行测试和服务启动验证。

Agent 行为规则的权威定义见 `.kimi/agents/*.md`；人视角流程概览见 `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md`。

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
| `docs/02-product-requirements/Modules/Module_XX_*.md` | 各模块 PRD |
| `docs/prototypes/module-XX/` | 可点击原型 |
| `docs/05-execution-records/module-09/deploy-package-and-edge-agent-code-organization.md` | M09 部署形态与 Edge Sync Agent 代码组织决策 |
| `docs/06-mvp-e2e-testing/README.md` | MVP 配置下发闭环 API 测试指导手册（local 通道，curl 动线 + 成功判据 + 排查表） |
| `.kimi/AGENTS.md` | Kimi Agent 团队角色与工作流速查 |
| `.kimi/agents/*.md` | 各 Agent 详细行为规则 |

---

## 13. 已知当前状态（截至本文件生成时）

- 后端 MVP 骨架已跑通，`go test ./platform/...` 全部通过。
- 前端骨架已建立，包含首页状态卡片、MainLayout、API 客户端和若干页面占位。
- `platform/examples/simple-agent/` 可独立运行，用于验证采集链路。
- `patches/` 目录尚未创建；Makefile 已预留 `make apply-patches` 命令。
- `upstream/alertmanager/` 与 `upstream/blackbox_exporter/` 已添加为 Git 子模块，支撑 MVP 的 M08 通知收敛与 M01/M09 blackbox 拨测；`upstream/node_exporter/` 保留子模块但当前不默认构建。
- `platform/` 中部分目录（gateway、discovery、collector、storage、config）为预留结构，等待后续模块实现。
- 跨模块联调分支策略已决策：每个版本末从 `develop` 切出短生命周期 `integration/vX.Y` 分支承载 Phase 5 联调，验收后 `--no-ff` 合回 `develop` 并删除；联调窗口内已合并的 `feat/module-XX` 冻结，避免冲突。详见 `docs/05-execution-records/module-00-infrastructure/integration-branch-strategy.md`。
