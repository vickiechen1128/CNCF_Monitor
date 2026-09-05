# MetricCenter

基于 Prometheus 改造包装的企业级**指标采集与查询中心**。

> 本项目以 Prometheus 为数据面引擎，在其上构建独立的控制面产品层。所有二次开发代码与上游源码严格隔离，控制面负责配置管理、CMDB 和采集规则下发，数据面负责指标抓取、存储和查询。

***

## 1. 项目定位

- **控制面与数据面分离**：控制面（`platform/` + `ui-custom/`）负责配置、CMDB 和规则下发；数据面（Prometheus 及生态组件）负责抓取、存储和查询
- **开发期轻量运行**：MVP 使用 SQLite（平台元数据）+ Prometheus TSDB（时序数据），本地单机即可运行
- **统一指标采集**：管理多源、多协议、多环境的指标采集目标
- **统一查询入口**：门户化指标查询与可视化
- **可扩展底座**：支持自定义服务发现、采集逻辑、前端展示与数据转发

<br />

***

## 2. 目录结构

```
CNCF_Monitor/
├── .trae/skills/                    # Trae Skill（源码架构分析）
├── .kimi/                            # Kimi Agent 团队配置
│   ├── agents/                       # Agent 定义（Planner/Developer/Reviewer）
│   ├── skills/                       # 共享知识库
│   └── AGENTS.md                     # Agent 使用速查
├── upstream/                         # 上游开源源码（尽量不修改）
│   ├── prometheus/
│   ├── alertmanager/
│   ├── blackbox_exporter/
│   └── node_exporter/
├── platform/                         # MetricCenter 业务扩展代码
│   ├── cmd/metric-center/            # 主程序入口
│   ├── gateway/                      # API Gateway
│   ├── discovery/                    # 自定义服务发现
│   ├── collector/                    # 自定义采集器
│   ├── storage/                      # 存储适配
│   ├── config/                       # 平台配置
│   ├── models/                       # 领域模型
│   ├── api/                          # 自定义 API
│   └── examples/                     # 示例 Agent / Exporter 模板
│       └── simple-agent/             # 标准采集端 Agent 模板
├── ui-custom/web/                    # 独立前端门户
├── patches/prometheus/               # 对上游源码的必要 patch
├── scripts/                          # 构建与辅助脚本
├── deploy/                           # 部署配置
├── docs/                             # 文档（按读者/使用场景排号）
│   ├── 01-team-collaboration/        # 团队协作指引（角色 / 流程 / Agent 使用）
│   ├── 02-product-requirements/      # 产品需求（PRD / 用户故事 / 路线图）
│   ├── 03-engineering-standards/     # 工程标准（API / 测试 / 分支 / 隔离）
│   ├── 04-source-architecture/       # 源码架构理解
│   ├── 05-execution-records/         # 执行记录（Agent 留痕）
│   └── prototypes/                   # 可点击原型（分模块）
├── Makefile                          # 统一构建入口
├── setup.sh                          # 一键初始化脚本（跨平台）
├── SETUP_WINDOWS.md                  # Windows 环境初始化指南
├── install-hooks.sh                  # 安装 Kimi hooks
├── .gitignore
└── README.md
```

***

## 3. 环境要求与依赖安装

> **Windows 用户请先阅读** **[SETUP\_WINDOWS.md](SETUP_WINDOWS.md)**：必须使用 **Git Bash** 执行（PowerShell/CMD 不兼容 Makefile 的 POSIX 语法），且工具链下载自动走国内镜像，无需手动配置代理。

本项目使用 Makefile 统一管理工具链，所有依赖默认安装到项目内的 `.tools/` 目录，不污染系统环境。协作者只需确保以下前置条件：

| 前置依赖       | 用途                                | 检查命令                                                            |
| ---------- | --------------------------------- | --------------------------------------------------------------- |
| `make`     | 统一构建入口                            | `make --version`（Windows 缺失时 setup.sh 自动获取，见 SETUP\_WINDOWS.md） |
| `curl`     | 下载 Go / Node.js 二进制包              | `curl --version`                                                |
| `git`      | 克隆上游源码                            | `git --version`                                                 |
| Docker（可选） | 容器化运行 Prometheus / node\_exporter | `docker --version`                                              |

> 注意：`.tools/` 目录已被 `.gitignore` 忽略，每位协作者首次都需要本地安装。

### 3.1 安装工具链（Go + Node.js + pnpm）

```bash
# 进入项目目录（Windows 用户在 Git Bash 中执行，路径替换为你的本地仓库路径）
cd <你的仓库路径，如 /Users/<name>/CNCF_Monitor 或 F:/code-program/CNCF_Monitor-worktree>

# 一键安装 Go 1.26.1、Node.js 22.14.0、pnpm 9.x 到 .tools/
make install-tools
```

安装完成后，可通过以下方式验证：

```bash
.tools/go/bin/go version
.tools/node/bin/node --version
.tools/pnpm/bin/pnpm --version
```

Makefile 会自动将 `.tools/go/bin`、`.tools/node/bin`、`.tools/pnpm/bin` 加入 `PATH`，因此后续命令无需手动导出环境变量。

### 3.2 初始化项目代码（当前状态说明）

目前项目已初始化基础入口，但业务功能仍在逐步完善中：

| 组件                                | 状态     | 说明                                             |
| --------------------------------- | ------ | ---------------------------------------------- |
| `platform/cmd/metric-center/`     | ✅ 已初始化 | 控制面主程序入口（Gin + 健康检查 + Query 代理）                |
| `ui-custom/web/package.json`      | ✅ 已初始化 | Custom UI 前端项目（Vite + React + TS + Ant Design） |
| `platform/examples/simple-agent/` | ✅ 已存在  | 标准采集端 Agent 模板，可独立运行                           |
| `upstream/prometheus/`            | ✅ 已存在  | 上游 Prometheus 源码                               |
| `upstream/alertmanager/`          | ✅ 已存在  | 上游 Alertmanager 源码（M08 通知收敛）                   |
| `upstream/blackbox_exporter/`     | ✅ 已存在  | 上游 blackbox\_exporter 源码（M01/M09 拨测）           |
| `upstream/node_exporter/`         | ✅ 已存在  | 上游 node\_exporter 源码（参考示例，当前不默认构建）             |

当前可用命令按「**使用场景** × **适用版本**」拆分如下：

| 场景                   | 命令                              | 用途                                                                                                                                                                   | 适用版本     |
| -------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **环境准备**             | `make install-tools`            | 安装 Go / Node.js / pnpm 工具链到 `.tools/`（每位协作者首次只需一次）                                                                                                                   | 通用       |
| **本地开发**             | `make run-metric-center`        | 编译并启动控制面（默认 `:8080`）                                                                                                                                                 | MVP / 后续 |
| <br />               | `make run-prometheus`           | 编译并启动 Prometheus（默认 `:9090`）                                                                                                                                         | MVP / 后续 |
| <br />               | `make run-alertmanager`         | 编译并启动 Alertmanager（默认 `:9093`，M08 静默代理/配置挂载依赖）                                                                                                                       | MVP / 后续 |
| <br />               | `make dev-ui`                   | 启动前端开发服务器（默认 `:5173`）                                                                                                                                                | MVP / 后续 |
| **测试验证**             | `make test-platform`            | 运行 `platform/` 下所有 Go 测试                                                                                                                                             | MVP / 后续 |
| <br />               | `cd ui-custom/web && pnpm test` | 前端单元测试                                                                                                                                                               | MVP / 后续 |
| <br />               | `cd ui-custom/web && pnpm lint` | 前端静态检查                                                                                                                                                               | MVP / 后续 |
| **编译打包（预生产 / 测试环境）** | `make build-metric-center`      | 编译控制面后端二进制                                                                                                                                                           | MVP / 后续 |
| <br />               | `make build-prometheus`         | 编译上游 Prometheus                                                                                                                                                      | MVP / 后续 |
| <br />               | `make build-ui`                 | 构建前端静态资源                                                                                                                                                             | MVP / 后续 |
| <br />               | `make build-alertmanager`       | 编译上游 Alertmanager                                                                                                                                                    | MVP / 后续 |
| <br />               | `make build-amtool`             | 编译上游 amtool（AM 配置校验命令行，`amtool check-config`）                                                                                                                        | MVP / 后续 |
| <br />               | `make build-blackbox-exporter`  | 编译上游 blackbox\_exporter                                                                                                                                              | MVP / 后续 |
| <br />               | `make build-center`             | 编译中心一体化五件套二进制（metric-center + prometheus + alertmanager + blackbox\_exporter + UI，产物散落源码目录，供开发期验证）                                                                   | MVP / 后续 |
| <br />               | `make package-center`           | 打包中心一体化离线交付包 `dist/*.tar.gz`（默认最小集；`WITH_ALERTMANAGER=1` / `WITH_BLACKBOX=1` 扩为全量五件套，指导见 [package-center-guide.md](docs/06-mvp-e2e-testing/package-center-guide.md)） | MVP / 后续 |
| **边缘交付（未来版本）**       | `make build-edge-agent`         | 编译边缘采集客户端                                                                                                                                                            | v0.2     |
| <br />               | `make build-edge-package`       | 组装边缘一体化离线包（Edge Sync Agent + vmagent / prometheus-agent + blackbox exporter）                                                                                         | v0.2     |

> **说明**：`make build-all` 是历史快捷命令，仅编译 metric-center + Prometheus + UI，**不包含** Alertmanager / blackbox\_exporter；需要五件套二进制用 `make build-center`，需要可交付的离线安装包（`dist/*.tar.gz`）用 `make package-center`。

### 3.3 一键初始化脚本

协作者可执行（**Windows 用户在 Git Bash 中运行**）：

```bash
bash setup.sh
```

该脚本**跨平台**（macOS / Linux / Windows-Git Bash），会自动：

1. 检测并获取 `make`（Windows 下优先复用 Git 自带 make，否则下载 MinGW-w64 取其中的 mingw32-make，全程不污染系统）；
2. 安装工具链（Go / Node / pnpm）到 `.tools/`（Windows 额外装 MinGW-w64 供 CGO）；
3. 初始化 git 子模块 → 应用 patch → 编译后端 → 构建前端 → 运行测试 → 安装 Kimi hooks。

> 注意：`setup.sh` 中的 `go test ./platform/...` 使用系统 PATH 中的 `go`。如果系统未安装 Go，可改为 `make test-platform` 使用 `.tools/go/bin/go`。
>
> **Windows 专属细节**（Git Bash 前提、国内镜像下载、CGO 编译器、常见排错）见 [SETUP\_WINDOWS.md](SETUP_WINDOWS.md)。

***

## 4. 快速开始（当前可用）

### 4.1 编译并启动 MetricCenter 控制面

```bash
# 先安装工具链
make install-tools

# 编译并启动控制面（默认监听 :8080）
make run-metric-center
```

访问 <http://localhost:8080/health> 查看健康状态。

### 4.2 启动前端开发服务器

```bash
make dev-ui
```

访问 <http://localhost:5173，前端会通过代理访问> <http://localhost:8080/api/v1/status。>

> 注意：需先启动 MetricCenter 控制面，前端状态卡片才能正常显示。

### 4.4 PR 预览环境（Vercel）

本项目已接入 Vercel，每个 `feat/module-XX` PR 都会自动生成独立预览链接：

1. 开发推送 `feat/module-XX` 分支并创建 PR 到 `develop`
2. Vercel Bot 在 PR 评论区自动回复 Preview 链接
3. 产品经理/业务方点击 `Preview` 链接即可在线验收

Vercel 仅部署 `ui-custom/web/` 前端静态资源。预览环境下：

- 默认启用 `VITE_STATIC_PREVIEW=true`，前端使用 mock 状态
- 若需联调真实后端，可在 Vercel Environment Variables 中配置 `VITE_API_BASE_URL=https://your-test-api.example.com`

> 详细配置见 `ui-custom/web/vercel.json` 和 [`docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md)。

### 4.5 编译并运行 simple-agent 示例

`simple-agent` 用于验证「CMDB 字段 → Prometheus Label → 配置下发」的完整链路。

```bash
cd platform/examples/simple-agent
../../.tools/go/bin/go mod tidy
../../.tools/go/bin/go run main.go -listen-address ":9100" -app-name "order-service" -env "prod"
```

运行后访问 <http://localhost:9100/metrics> 查看指标。

### 4.6 使用 Docker 启动 Prometheus（可选）

如果你只想查看 Prometheus 原生界面，可直接使用 Docker：

```bash
docker run -p 9090:9090 prom/prometheus:latest
```

访问 <http://localhost:9090>

### 4.7 后端改动后重启与验证避坑（M01/M09 联动）

每次修改 `platform/` 后端代码后，**必须重编译并重启控制面**，否则旧二进制仍在运行，新逻辑不生效：

```bash
make build-metric-center
# 先停掉旧进程，再启动
make run-metric-center
```

`make run-metric-center` 会自动把 `upstream/prometheus`、`upstream/blackbox_exporter` 和 `upstream/alertmanager` 加入 `PATH`，因此 M09 草稿校验能找到 `promtool` / `blackbox_exporter`，M08 的 Alertmanager 配置挂载校验能找到 `amtool`。若手动起二进制，必须显式导出：

```bash
export PATH="$(pwd)/upstream/prometheus:$(pwd)/upstream/blackbox_exporter:$(pwd)/upstream/alertmanager:$PATH"
./platform/cmd/metric-center/metric-center --config.reload-url=http://localhost:9090/-/reload
```

否则变更单会卡在 `validation_status=pending`，提示「promtool / amtool 不可调用」。

另外，若旧逻辑已生成一张 `pending` 草稿，即使换了新二进制，`GenerateDraft` 也会按 checksum 幂等返回旧草稿（保活设计）。要看到新的 diff / 变更清单，需要先**废弃**旧草稿，再重新触发变更。废弃会按决策 43 回滚源数据（例如被禁用的 Job 会被恢复启用），因此典型验证动线是：**废弃旧单 → 重新禁用 Job → 生成新单 → 重校/确认**。

***

## 5. 协作者 Setup 检查清单

每位新协作者进入项目后，建议按以下顺序确认（**Windows 用户全程在 Git Bash 中操作**）：

- [ ] 已安装 `make`、`curl`、`git`（Windows 缺失的 `make` 由 setup.sh 自动获取）
- [ ] 已执行 `make install-tools` 且 `.tools/` 目录生成成功
- [ ] 已阅读 [`00_Product_Vision.md`](docs/02-product-requirements/00_Product_Vision.md) 和 [`00_Global_Architecture.md`](docs/02-product-requirements/00_Global_Architecture.md)
- [ ] 本地开发验证：`make run-metric-center` + `make run-prometheus` + `make run-alertmanager`（M08 场景）+ `make dev-ui` 均可启动
- [ ] 后端改动后重新编译并重启控制面（见 4.7）
- [ ] 测试验证：`make test-platform` 与 `pnpm test` / `pnpm lint` 通过
- [ ] 编译打包验证：`make build-center` 可完成（如需预生产/测试环境交付）
- [ ] 如需验证采集链路，可运行 `platform/examples/simple-agent/`

***

## 6. 文档索引

> docs/ 按读者/使用场景分 6 个目录，每个目录的 README 提供导航：团队协作 / 产品需求 / 工程标准 / 源码架构 / 执行记录 / 原型。

### 6.1 团队协作（docs/01-team-collaboration/）

- [目录导航（按角色索引 + 各角色怎么用 Agent）](docs/01-team-collaboration/README.md)
- [团队守则](docs/01-team-collaboration/00_Team_Charter.md)
- [角色职责速查表](docs/01-team-collaboration/01_Role_Responsibilities.md)
- [需求设计流程](docs/01-team-collaboration/02_Demand_Workflow.md)
- [代码协作流程](docs/01-team-collaboration/03_Code_Collaboration_Workflow.md)
- [团队 Git 操作指南](docs/01-team-collaboration/04_Team_Git_Operations_Guide.md)
- [zhangwq Vibe Coding 执行手册](docs/01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)

### 6.2 产品需求（docs/02-product-requirements/）

- [产品需求目录导航](docs/02-product-requirements/README.md)
- [产品愿景](docs/02-product-requirements/00_Product_Vision.md)
- [全局架构](docs/02-product-requirements/00_Global_Architecture.md)
- [用户故事](docs/02-product-requirements/01_User_Stories.md)
- [产品路线图](docs/02-product-requirements/02_Product_Roadmap.md)
- [模块需求](docs/02-product-requirements/Modules/)（11 个模块，MVP 核心见下）

### 6.3 工程标准（docs/03-engineering-standards/）

- [工程标准目录导航（含按角色阅读顺序）](docs/03-engineering-standards/README.md)
- [工程实现标准](docs/03-engineering-standards/00_Engineering_Standard.md)
- [代码隔离标准](docs/03-engineering-standards/01_Code_Isolation_Standard.md)
- [前端开发标准](docs/03-engineering-standards/02_Frontend_Standard.md)
- [API 设计标准](docs/03-engineering-standards/03_API_Standard.md)
- [测试标准](docs/03-engineering-standards/04_Testing_Standard.md)
- [AI Agent 协作标准](docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md)
- [Gitflow 分支与回退指南](docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md)

### 6.4 源码架构（docs/04-source-architecture/）

- [Prometheus 整体架构分析](docs/04-source-architecture/prometheus/2026-07-15_prometheus-architecture-overview.md)

### 6.5 执行记录（docs/05-execution-records/）

- 各模块的 Agent 执行记录与设计决策（module-XX/design-decisions.md、<agent>.md）

### 6.6 原型（docs/prototypes/）

- 分模块可点击原型（module-XX/），GitHub Pages 部署说明见各模块 README

***

## 7. 协作规范

1. **不直接修改** **`upstream/`** **源码**，所有业务代码放在 `platform/` 或 `ui-custom/`
2. **必须修改 upstream 时**，生成 patch 到 `patches/prometheus/`
3. 开发前阅读对应的 PRD 和工程标准（见 [§6 文档索引](#6-文档索引)）

***

## 8. 许可证

上游项目 Prometheus、Alertmanager、blackbox\_exporter 与 node\_exporter 遵循 Apache License 2.0。
MetricCenter 新增代码同样遵循 Apache License 2.0。
