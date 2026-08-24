# MetricCenter 工程实现标准

> **AI 编程助手必读**：本文档包含编码前必须了解的目录结构、技术栈、关键实现约定和避坑指南。
> 文档类型：工程标准
> **目标读者**：技术架构师（技术选型 / 目录规划）、开发工程师（后端 / 前端，编码前必读）、AI 编程助手
> 更新日期：2026-07-21（v1.25 去重）

***

## 1. 项目目录结构

> **维护提示（v1.25）**：`.kimi/agents/` 下的文件清单以实际目录为准，新增 Agent 时无需（也不应）同步本文；本目录树仅作整体认知参考。

```
CNCF_Monitor/
├── .kimi/                                       # Kimi Agent 与 Skill 定义
│   ├── agents/                                  # Agent 角色定义
│   │   ├── backend-developer.md
│   │   ├── frontend-developer.md
│   │   ├── planner.md
│   │   ├── golang-reviewer.md
│   │   ├── frontend-reviewer.md
│   │   ├── prometheus-developer.md
│   │   ├── build-resolver.md
│   │   └── security-reviewer.md
│   ├── AGENTS.md                                # Agent 团队速查
│   └── skills/                                  # 可选 Skill
│
├── upstream/                                    # 上游开源源码（尽量不修改）
│   ├── prometheus/
│   ├── alertmanager/
│   ├── blackbox_exporter/
│   └── node_exporter/
│
├── platform/                                    # MetricCenter 业务扩展代码
│   ├── cmd/metric-center/                       # 主程序入口
│   ├── edge-sync-agent/                         # v0.2 边缘配置同步 Agent（独立 Go module）
│   ├── gateway/                                 # API Gateway
│   │   ├── auth/                                # 认证鉴权
│   │   ├── tenant/                              # 多租户
│   │   ├── proxy/                               # 查询代理
│   │   └── router/                              # 路由注册
│   ├── discovery/                               # 自定义服务发现
│   │   ├── cmdb/
│   │   ├── nacos/
│   │   └── custom-http/
│   ├── collector/                               # 自定义采集器
│   ├── storage/                                 # 自定义存储适配
│   ├── config/                                  # 平台配置
│   ├── models/                                  # 领域模型
│   └── api/                                     # 自定义 API
│
├── ui-custom/                                   # 独立前端门户
│   └── web/
│
├── patches/                                     # 对上游源码的必要 patch
│   └── prometheus/
│       └── README.md
│
├── scripts/                                     # 构建与辅助脚本
├── deploy/                                      # 部署配置
│
├── docs/                                        # 文档
│   ├── 04-source-architecture/                  # 源码架构理解
│   ├── 02-product-requirements/                 # 新产品需求文档
│   └── 03-engineering-standards/                # 工程约束与标准
│
├── Makefile                                     # 统一构建入口
├── .gitignore
└── README.md
```

***

## 2. 技术栈

### 2.1 MVP 开发期选型

| 层级      | 技术                      | 说明                          |
| ------- | ----------------------- | --------------------------- |
| 后端引擎    | Prometheus（Go）          | 数据面核心，负责抓取、TSDB、PromQL、告警求值 |
| 控制面后端   | Go 1.25+                | 轻量扩展层，优先保持简单                |
| Gateway | Go + Gin                | 统一入口、鉴权、查询代理、配置管理 API       |
| 前端      | React 18 + TypeScript   | 门户化配置管理页面                   |
| UI 组件库  | Ant Design              | 企业级后台组件库                    |
| 数据库（平台） | SQLite                  | 开发期零运维、单机可运行                |
| 部署      | Docker / Docker Compose | 本地开发与测试                     |

### 2.2 未来演进选型

| 层级    | MVP 选型            | 未来演进                                            | 切换条件           |
| ----- | ----------------- | ----------------------------------------------- | -------------- |
| 元数据存储 | SQLite            | PostgreSQL / MySQL                              | 生产部署、多实例、审计需求  |
| 缓存    | 无                 | Redis                                           | 会话、配置缓存、采集状态缓存 |
| 时序存储  | Prometheus TSDB   | VictoriaMetrics / Mimir                         | 长期存储、集群查询      |
| 采集端   | Prometheus Server | Prometheus Agent Mode / OpenTelemetry Collector | 大规模分布式采集       |
| 告警    | Prometheus 原生告警   | 自建告警中心 + 通知网关                                   | 复杂告警编排、多渠道通知   |
| 图表    | 无                 | uPlot / ECharts                                 | 高性能时序图表需求      |

> **一致性要求**：本表与 [`docs/02-product-requirements/00_Global_Architecture.md`](../02-product-requirements/00_Global_Architecture.md) 保持同步。MVP 阶段优先使用轻量组合，生产级组件通过标准接口逐步替换。

***

## 3. 编码前必读

### 3.1 绝不直接修改 upstream 源码

- 所有业务代码写在 `platform/`
- 必须修改 upstream 时，生成 patch 到 `patches/prometheus/`
- patch 命名格式：`0001-<简短描述>.patch`

### 3.2 入口程序独立

不要直接运行 `upstream/prometheus/cmd/prometheus/main.go`，而是通过 `platform/cmd/metric-center/main.go` 包装：

```go
package main

import (
    prometheus "github.com/prometheus/prometheus/cmd/prometheus"
    _ "your-platform/discovery/cmdb"   // 注册自定义发现
)

func main() {
    prometheus.Main()
}
```

### 3.3 文档驱动

- 每个模块开发前，必须先补充或更新 `docs/02-product-requirements/Modules/`
- 每个代码变更前，先确认是否符合 `docs/03-engineering-standards/`

***

## 4. AI Agent 协作规范

> **v1.25 去重**：Agent 协作的详细规则**权威定义在** **`.kimi/agents/*.md`**（行为规范）与 [`05_AI_Agent_Collaboration_Standard.md`](05_AI_Agent_Collaboration_Standard.md)（人视角流程概览）；分支策略见 [`06_Gitflow_Branch_and_Rollback_Guide.md`](06_Gitflow_Branch_and_Rollback_Guide.md)。本节不再重复维护，仅保留核心原则速查：

1. **先读文档再写代码**：AI Agent 接到任务后，按任务卡读取相关 PRD 和工程标准（见 `.kimi/agents/orchestrator.md` 任务卡驱动）
2. **按功能子模块开发**：每个功能子模块一个 `feature/module-XX-<功能名>` 分支
3. **双文件夹隔离复用**：设计空间 `CNCF_Monitor-worktree`（固定分支 `design/module-mvp-demo`）与开发空间 `CNCF_Monitor-feature`（`develop` + `feat/*`）物理隔离；开发串行复用同一开发克隆，并行时额外 `git worktree add` 多目录
4. **不编造接口**：所有 API 设计需符合 `03_API_Standard.md` 或已在 PRD 中定义
5. **提交前必须验证**：除测试/lint 外，必须启动服务并验证关键接口/页面可正常访问
6. **Patch 可追溯**：所有对 upstream 的修改必须有 patch 文件和说明
7. **执行记录关联**：每次 commit 必须能对应到 `docs/05-execution-records/module-XX-<功能名>/` 中的执行记录

***

## 5. 关键参考文档

> 各标准的目标读者、职责边界与按角色阅读顺序见 [README.md](README.md)（目录导航）。

| 文档                                                                                      | 说明                |
| --------------------------------------------------------------------------------------- | ----------------- |
| [01\_Code\_Isolation\_Standard.md](01_Code_Isolation_Standard.md)                       | 源码与二次开发代码隔离细则     |
| [02\_Frontend\_Standard.md](02_Frontend_Standard.md)                                    | 前端开发规范            |
| [03\_API\_Standard.md](03_API_Standard.md)                                              | API 设计规范          |
| [04\_Testing\_Standard.md](04_Testing_Standard.md)                                      | 测试规范              |
| [05\_AI\_Agent\_Collaboration\_Standard.md](05_AI_Agent_Collaboration_Standard.md)      | AI Agent 协作细则     |
| [06\_Gitflow\_Branch\_and\_Rollback\_Guide.md](06_Gitflow_Branch_and_Rollback_Guide.md) | Gitflow 分支策略与回退指南 |

