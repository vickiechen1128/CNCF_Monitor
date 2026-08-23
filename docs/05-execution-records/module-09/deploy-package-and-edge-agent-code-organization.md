# Module 09 部署形态与 Edge Sync Agent 代码组织决策

> 记录日期：2026-08-23  
> 参与人：chenrt（用户）、Kimi Code Agent  
> 决策性质：架构/代码组织决策，作为 M09 后续开发的约束输入  
> 关联文档：`docs/02-product-requirements/Modules/Module_09_Network_Domain_and_Edge_Config_Center.md`、`docs/05-execution-records/module-09/design-decisions.md`、根目录 `AGENTS.md`、`Makefile`

---

## 1. 控制面与 Prometheus 是否打包成一个软件包

### 1.1 问题

项目当前通过两条独立命令分别构建和启动：

- `make run-metric-center`：编译并启动控制面（Gin，默认 `:8080`）
- `make run-prometheus`：编译并启动上游 Prometheus（默认 `:9090`）

在 M09 后续开发中，控制面需要管理配置并同步到 Prometheus。测试环境部署时，是否需要把二者打包为「一个软件包」？是否每次启动 Prometheus 进程时都必须同步启动它？

### 1.2 结论

**控制面与 Prometheus 应作为一个「一体化交付包」发布，但仍然是两个独立的运行时进程；启动控制面的同时必须拉起 Prometheus 进程。**

也就是说：

- 交付物层面：可以只给用户/测试人员一个压缩包 / 安装包 / 容器镜像，里面同时包含 `metric-center` 二进制、`prometheus` 二进制、初始配置、systemd 单元或启动脚本。
- 运行时层面：两个二进制必须同时运行，不存在「合并成一个进程」的方案。

### 1.3 详细依据

#### （1）控制面查询代理强依赖 Prometheus 进程

当前 `platform/cmd/metric-center/main.go` 中注册的查询类接口（`/api/v1/query`、`/api/v1/query_range`、`/api/v1/labels` 等）全部是透传到 Prometheus 的 HTTP 接口。如果 Prometheus 未启动，这些接口全部不可用，控制面本身不具备独立的查询求值能力。因此 Prometheus 进程是控制面的必要运行时依赖。

#### （2）M09 `local` 下发通道要求控制面能直接操作 Prometheus 配置目录

M09 PRD 第 3.11 节、第 6.3 节明确规定：

> `channel=local`（默认 `default` 域固定走该通道）的配置产物为本地文件集（`prometheus.yml`、`targets/*.json`、`rules.yml`、`blackbox.yml`），确认后直接写中心 Prometheus 配置目录，并触发 `SIGHUP` 或 `POST /-/reload`。

这带来两个部署约束：

1. 控制面进程必须能够访问 Prometheus 的配置目录（写盘）。
2. 控制面必须能够通过信号或 HTTP 触发 Prometheus reload。

这两个约束在「同机部署」模型下最容易满足。把两个二进制打包进同一个交付包，并用同一份 systemd / supervisor / shell 启动脚本管理，是 `local` 通道的自然形态。

#### （3）Prometheus 是上游子模块，不能也不应被合并进控制面代码

根据根目录 `AGENTS.md` 第 6.3 节与第 7.1 节：

- `upstream/prometheus/` 是 Git 子模块，**禁止直接修改**。
- 必须修改上游时，需通过 `patches/prometheus/` 管理 patch。
- 业务代码必须写在 `platform/` 或 `ui-custom/web/`。

因此不能把 Prometheus 源码和控制面源码合并编译成一个单一二进制。正确的做法是：

- 控制面继续放在 `platform/cmd/metric-center/`，编译为 `metric-center`。
- Prometheus 继续使用 `upstream/prometheus/`，编译为 `prometheus`。
- 交付时把两个产物放进同一个包，由启动脚本同时拉起。

#### （4）开发与部署构建命令的区分

当前 `Makefile` 的目标已经体现了这种分离：

- `make build-metric-center`：只编控制面。
- `make build-prometheus`：只编上游 Prometheus。
- `make build-all`：同时编译控制面 + Prometheus + Custom UI。
- `make run-metric-center` / `make run-prometheus`：开发期分别启动，便于独立调试。

这两条 `run-*` 命令只是为了开发调试方便，并不意味着生产或测试环境必须手动分别启动。测试环境完全可以在 `make build-all` 之后，用一个入口脚本统一启动。

### 1.4 推荐的测试环境交付形态

建议采用以下目录结构的离线包：

```text
metric-center-bundle/
├── bin/
│   ├── metric-center          # 控制面二进制（platform/cmd/metric-center 产物）
│   └── prometheus             # 上游 Prometheus 二进制（upstream/prometheus 产物）
├── config/
│   ├── metric-center.yml      # 控制面配置（监听端口、数据库路径、Prometheus 地址等）
│   └── prometheus/
│       └── prometheus.yml     # Prometheus 初始配置（空 scrape_configs 或最小配置）
├── data/                      # Prometheus TSDB 数据目录（运行期生成）
├── logs/                      # 运行日志目录
└── scripts/
    ├── start.sh               # 同时启动 metric-center 与 prometheus
    ├── stop.sh                # 优雅停止
    └── install-systemd.sh     # 安装 systemd unit
```

systemd 建议拆成两个 service，再由一个 target 统一管理：

- `metric-center.service`：拉起控制面。
- `prometheus.service`：拉起 Prometheus。
- `metric-center.target`：依赖前两个 service，实现 `systemctl start metric-center` 一次启动全部。

这样：

- 用户视角是一个整体服务。
- 运维视角可以独立重启、独立看日志、独立升级。
- 与 `local` 通道同机写盘 + reload 的要求完全兼容。

### 1.5 关键配置项建议

为避免写死路径，建议在 `metric-center` 启动配置中增加：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `prometheus.config_dir` | Prometheus 配置目录，M09 `local` 通道写盘目标 | `/etc/prometheus` |
| `prometheus.reload_url` | Prometheus `/-/reload` 地址 | `http://127.0.0.1:9090/-/reload` |
| `prometheus.reload_method` | 触发 reload 的方式：`signal` / `http` | `http` |
| `prometheus.query_url` | 查询代理目标地址 | `http://127.0.0.1:9090` |

### 1.6 被否决的备选方案

| 方案 | 否决原因 |
|------|----------|
| 把 Prometheus 静态资源/查询逻辑内嵌到 `metric-center` 进程 | 违反 upstream 隔离原则；Prometheus 的 TSDB、抓取、告警求值无法简单嵌入；升级维护困难 |
| 测试环境只启动 `metric-center`，不启动 Prometheus | 查询代理与配置 reload 全部失效，M09 本地通道无法闭环 |
| 把两个二进制合并成一个容器镜像，但只运行一个入口进程 | 违背「两个进程」的本质，单进程模型无法同时跑 Gin 和 Prometheus |
| 控制面通过 SSH/远程 API 写远端 Prometheus 配置 | 引入不必要的网络可达性与权限复杂度；`local` 通道的设计意图就是同机操作 |

---

## 2. Edge Sync Agent 的代码管理位置

### 2.1 问题

M09 把「网域 + 边缘配置中心」作为核心能力，v0.2 阶段需要实现 Edge Sync Agent（部署在边缘节点的客户端程序，负责心跳、拉取配置包、守护采集器与 blackbox exporter、触发 reload）。问题是：

- Edge Sync Agent 的源码应该放在哪里？
- 是否应该作为独立项目/仓库？
- 是否应该和 `metric-center` 共用一个 Go module？

### 2.2 结论

**Edge Sync Agent 应作为本仓库内的一个独立目录 + 独立 Go module 存在，推荐路径为 `platform/edge-sync-agent/`。**

具体组织方式：

- 不拆成独立 Git 仓库（至少在 MVP/v0.2 阶段不拆）。
- 不放进 `platform/cmd/metric-center/`（与控制面二进制混编）。
- 不放进 `platform/examples/simple-agent/`（那是示例模板，不是正式组件）。
- 使用独立的 `go.mod`，与 `metric-center` 主模块解耦。

### 2.3 详细依据

#### （1）独立 Go module 是边缘部署的必然要求

Edge Sync Agent 的运行环境与控制面差异巨大：

| 维度 | 控制面 `metric-center` | Edge Sync Agent |
|------|------------------------|-----------------|
| 部署位置 | 中心服务器 | 远端/隔离网域/边缘节点 |
| 网络可达性 | 可被用户/浏览器访问 | 通常只允许 outbound HTTPS 443 |
| 功能 | 配置管理、UI API、数据库、代理查询 | 心跳上报、拉 zip 包、进程守护、本地 reload |
| 依赖 | Gin、GORM、SQLite、Prometheus SDK 等 | 应尽量轻量（HTTP client、文件操作、进程管理） |
| 二进制体积 | 可接受较大 | 越小越好，弱网传输友好 |
| 目标平台 | 通常是中心服务器架构 | 需交叉编译 linux/amd64、linux/arm64 等 |

如果 Edge Sync Agent 与控制面共用一个 `go.mod`，会出现两个问题：

1. **依赖污染**：编译 agent 时会无条件拉取 Gin、GORM、SQLite 等控制面依赖，显著增大二进制体积和构建时间。
2. **构建目标不一致**：控制面通常只编译当前平台，而 agent 需要频繁交叉编译。独立 module 可以让 agent 的 `GOOS/GOARCH` 构建完全独立。

#### （2）本仓库内 monorepo 管理有利于协议契约同步

Edge Sync Agent 与中心控制面之间的契约包括：

- 心跳协议：`EdgeHeartbeat` 结构体（PRD 5.3）
- 配置包拉取接口：HTTP 下载 + Token 鉴权 + 版本比对 304
- 配置包结构：`metadata.json` 格式、zip 包内文件组织、`checksum` 算法
- `config_sync_status` 状态机：`no_version`、`out_of_sync`、`in_sync`、`manual_override` 等

这些契约在 PRD 第 6.1-6.3 节、第 8 节中有详细描述。如果 agent 拆成独立仓库，任何一方修改契约都需要双仓库同步版本，MVP/v0.2 阶段节奏快、人力有限，跨仓库协同成本过高。

本仓库 monorepo 的优势：

- 一次 PR 可以同时修改控制面接口、agent 拉取逻辑和契约文档。
- `go test` / CI 可以一次性验证两端。
- 配置包和 agent 二进制可以在同一个 CI pipeline 里组装成 PRD 3.9 要求的一体化离线包。

#### （3）`platform/` 是项目业务代码的合法区域

根目录 `AGENTS.md` 第 6.1 节规定：

> 业务代码必须写在 `platform/` 或 `ui-custom/web/`，尽量不动 `upstream/`。

`platform/` 中已经存在 `platform/examples/simple-agent/`（独立 Go module 的 Agent 模板）。因此把 Edge Sync Agent 放在 `platform/edge-sync-agent/` 完全符合现有目录约定，不需要新增顶层目录或改动 AGENTS 的目录边界。

`platform/` 中已有的预留扩展目录（gateway、discovery、collector、storage、config）主要是控制面内部模块，Edge Sync Agent 是部署在边缘的独立客户端，单独一个目录最为清晰。

#### （4）与现有 `simple-agent` 示例保持一致的工程模式

`platform/examples/simple-agent/` 已经是一个独立 Go module 的子目录，它的存在证明了项目允许这种「同一个仓库、独立 module、独立构建目标」的模式。Edge Sync Agent 可以沿用该模式：

- 独立的 `go.mod` 和 `go.sum`。
- 独立的 `main.go` 入口。
- 独立的 Makefile target 或 `make build-edge-agent`。
- 独立的版本标签（如 `edge-agent/v0.2.0`）可选。

### 2.4 推荐的目录与模块结构

```text
platform/
├── cmd/
│   └── metric-center/              # 控制面主程序（已有）
├── examples/
│   └── simple-agent/               # 示例 Agent 模板（已有）
└── edge-sync-agent/                # 新增：Edge Sync Agent 独立模块
    ├── go.mod                      # 独立 Go module
    ├── go.sum
    ├── cmd/
    │   └── edge-sync-agent/
    │       └── main.go             # 入口
    ├── internal/
    │   ├── agent/                  # 主控循环、心跳、状态机
    │   ├── puller/                 # 配置包拉取、304 比对、checksum 校验
    │   ├── deployer/               # 本地配置原子替换、reload 触发
    │   ├── supervisor/             # vmagent / blackbox exporter 进程守护
    │   └── token/                  # Token 缓存与请求签名
    ├── pkg/
    │   └── contract/               # 与中心共享的契约类型（可选）
    │       └── heartbeat.go        # EdgeHeartbeat 等结构体
    ├── build/
    │   └── linux-amd64/
    │       └── edge-sync-agent     # 交叉编译产物
    └── scripts/
        └── build.sh                # 交叉编译脚本
```

说明：

- `pkg/contract/` 只放纯结构体定义，**不允许**引入任何控制面依赖（无 GORM、无 Gin）。
- 如果担心 agent 反向依赖 `platform/models/`，可以把契约包抽到 `platform/pkg/contract/` 或保持一份独立副本并在 PRD/API 文档中强约定。
- 最佳实践是「契约代码只定义一次，两侧不互相 import 业务包」。

### 2.5 构建与交付集成

新增或扩展以下构建目标：

| 目标 | 说明 |
|------|------|
| `make build-edge-agent` | 编译 `platform/edge-sync-agent/` 为当前平台二进制 |
| `make build-edge-agent-all` | 交叉编译 linux/amd64、linux/arm64 等目标平台 |
| `make build-edge-package` | 组装一体化离线包：Edge Sync Agent + vmagent（或 prometheus-agent）+ blackbox exporter + systemd unit |

`make build-all` 当前包含 `build-metric-center`、`build-prometheus`、`build-ui`，**暂不纳入** `build-edge-agent`，原因见下节「节奏控制」。

### 2.6 节奏控制：MVP 先不建，v0.2 再建

M09 PRD 第 9.1 节「MVP 验收范围收敛」明确说明：

> MVP 子集 = `default` 域 + `local` 通道 + 配置生成/预览/确认/reload 全链路；凡涉及 Edge Agent / `agent_pull` / 多网域 / 节点状态 / Token / 安装指引 的验收条目均标注 `{v0.2}`，MVP 仅验收本次子集内可闭合项。

因此：

- **MVP 阶段（当前）**：不需要创建 `platform/edge-sync-agent/` 目录。集中精力把 `local` 通道、配置生成、变更确认、diff/preview、reload、回滚、下发记录跑通。
- **v0.2 阶段开始时**：再创建 `platform/edge-sync-agent/`，实现心跳、配置包拉取、进程守护、安装指引的一体化离线包。

提前创建目录会引入无关依赖和构建复杂度，属于超前工程。

### 2.7 被否决的备选方案

| 方案 | 否决原因 |
|------|----------|
| 新建顶层目录如 `edge/` 或 `edge-sync-agent/` | 需要修改根目录 `AGENTS.md` 的目录边界与隔离表；`platform/` 已经足够容纳业务代码 |
| 把 Edge Sync Agent 代码放进 `platform/cmd/metric-center/` 作为子命令 | 会导致 agent 和控制面共用依赖与构建产物，二进制体积过大，且运行环境完全不同 |
| 把 Edge Sync Agent 放进 `platform/examples/simple-agent/` | 示例目录的语义是「参考模板」，Edge Sync Agent 是正式交付组件，不应和示例混放 |
| 拆成独立 Git 仓库 | v0.2 阶段契约变化快，跨仓库同步成本高；且 PRD 与执行记录都在本仓库，割裂上下文 |
| 与控制面共用同一个 `go.mod`，通过 build tags 裁剪依赖 | build tags 无法真正剥离 module 级依赖，go build 仍会解析并下载全部依赖，二进制也难以做到最小化 |

---

## 3. 两项决策的关联关系

这两项决策是相互配合的：

- **中心侧**：控制面 + Prometheus 一体化交付包，支撑 `local` 通道（MVP 核心）。
- **边缘侧**：Edge Sync Agent 独立模块，支撑 `agent_pull` 通道（v0.2）。

它们共同构成 M09 的完整部署架构：

```text
测试环境 / 生产（中心）
├─ metric-center（控制面）
├─ prometheus（数据面，同机）
└─ 配置目录 + reload 通道（local）

远端 / 隔离网域（边缘）
└─ Edge Sync Agent（独立二进制）
   ├─ vmagent / prometheus-agent
   └─ blackbox exporter（可选）
```

---

## 4. 待办与后续行动

1. **MVP 阶段**：
   - 在 `metric-center` 配置中增加 `prometheus.config_dir`、`prometheus.reload_url` 等配置项，适配 `local` 通道。
   - 在 `Makefile` / `setup.sh` 中补充「中心一体化交付包」的打包脚本（`scripts/package-center.sh`）。
   - 更新根目录 `AGENTS.md` 或 `docs/03-engineering-standards/00_Engineering_Standard.md` 中关于测试部署形态的说明。

2. **v0.2 阶段开始时**：
   - 创建 `platform/edge-sync-agent/` 独立 Go module。
   - 新增 `make build-edge-agent`、`make build-edge-agent-all`、`make build-edge-package`。
   - 与 PRD 第 6.1-6.5 节对齐，先实现心跳 + 配置包拉取 + checksum 校验 + 本地 reload 的最小闭环。

---

## 5. 参考索引

- PRD M09 第 3.9 节：一体化交付与职责边界
- PRD M09 第 3.11 节：网域能力开关与下发通道
- PRD M09 第 5.3 节：心跳上报 `EdgeHeartbeat`
- PRD M09 第 6.1-6.5 节：Edge Sync Agent 协议、配置包拉取、本地行为、校验分层
- PRD M09 第 8 节：配置同步状态机
- PRD M09 第 9.1 节：MVP 验收范围收敛
- 根目录 `AGENTS.md` 第 6.1 / 6.3 / 7.1 节：目录隔离与 upstream 禁止修改
- `Makefile`：`build-metric-center`、`build-prometheus`、`build-ui`、`build-all`、`run-metric-center`、`run-prometheus`
- `platform/examples/simple-agent/`：独立 Go module 的 Agent 模板先例
