---
name: cncf-project
description: "MetricCenter 项目上下文：定位、技术栈、目录结构、常用命令、跨工具 Skill 共享与协作原则，是所有 Agent 开始任务前的必读项目概要"
---

# CNCF_Monitor / MetricCenter 项目上下文

本项目是基于 Prometheus 改造包装的企业级**指标采集与查询中心**，采用控制面 + 数据面分离架构：

- **控制面**：`platform/`（Go 后端）+ `ui-custom/web/`（React 前端）
- **数据面**：`upstream/prometheus/` 等上游组件，负责抓取、存储、查询与告警求值

MVP 聚焦：**配置管理 + 手动 CMDB + Prometheus 配置下发**。

---

## 1. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 控制面后端 | Go 1.26.1 | `go.mod` 声明；项目级工具链 `.tools/go/` |
| Web 框架 | Gin v1.10 | 路由、中间件、HTTP API |
| 元数据存储 | SQLite + GORM | 开发期零运维；`METRIC_CENTER_DB_DSN` 可覆盖 |
| 数据面引擎 | Prometheus | `upstream/prometheus/` 子模块 |
| 前端 | React 18 + TypeScript 5.5 + Vite 5 | `ui-custom/web/` |
| UI 组件 | Ant Design 5 | 企业级后台组件库 |
| 包管理 | pnpm 9.x / 11.x | 前端依赖管理 |
| 测试 | Go `testing` + testify；Vitest + RTL | 后端与前端单元测试 |

---

## 2. 目录结构

```text
CNCF_Monitor-worktree/
├── .agents/skills/                  # 跨工具 Skill 共享镜像（生成，禁止手改）
├── .kimi/                           # Kimi Agent 团队配置 + Skill 单一源
│   ├── agents/                      # Agent 角色提示词
│   ├── skills/                      # Skill 单一源
│   └── AGENTS.md                    # Agent 团队速查
├── .trae/                           # Trae IDE 配置与专属 Skill
├── .tools/                          # 项目级工具链（Go / Node / pnpm，gitignore）
├── upstream/                        # 上游源码子模块（禁止直接改）
│   ├── prometheus/
│   ├── alertmanager/
│   ├── blackbox_exporter/
│   └── node_exporter/
├── platform/                        # 控制面业务代码
│   ├── cmd/metric-center/           # 主程序入口
│   ├── edge-sync-agent/             # v0.2 边缘采集客户端（独立 module）
│   ├── models/                      # CMDB / 标签 / 采集任务模型
│   ├── db/                          # SQLite 初始化与 migration
│   ├── api/response/                # 统一响应封装
│   └── examples/simple-agent/       # 采集端 Agent 模板
├── ui-custom/web/                   # React 前端门户
├── patches/prometheus/              # 上游 patch 与 README
├── docs/                            # PRD / 工程标准 / 架构 / 执行记录 / 原型
├── scripts/                         # 构建、校验、Skill 同步脚本
├── Makefile / setup.sh              # 统一构建与初始化入口
└── README.md
```

---

## 3. 常用命令

```bash
# 初始化工具链与子模块
make install-tools
bash setup.sh

# 后端
make build-metric-center
make run-metric-center
make test-platform

# Prometheus / 数据面
make build-prometheus
make run-prometheus
make apply-patches

# 前端
make build-ui
make dev-ui
cd ui-custom/web && pnpm run typecheck:test && pnpm lint
# 全量 pnpm test 仅在 testing-tdd §4.2 允许时执行

# Skill 同步与校验
make sync-skills
make check-skills
```

> 命令细节、验证矩阵与测试范围控制见 `testing-tdd`；分支 / 提交规则见 `cncf-git-workflow`。

---

## 4. 核心原则

1. **上游隔离**：不直接修改 `upstream/`；业务代码放 `platform/` 或 `ui-custom/web/`。必须改上游时生成 `patches/prometheus/*.patch` 并写 README。
2. **Skill 单一源**：`.kimi/skills/` 是唯一源；`.agents/skills/` 是 `scripts/sync-skills.sh` 生成的镜像，**禁止手改**。修改 Skill 后运行 `make sync-skills`，提交前运行 `make check-skills`。
3. **契约优先**：前后端以 PRD 第 5/6 章 + `api-contract-snapshot.md` + `03_API_Standard.md` 为契约，不以对端代码为实现依据。
4. **目录边界**：Developer 只写自己负责的目录；Reviewer 只读；执行记录只追加、不覆盖他人。
5. **开发前阅读**：相关 PRD、原型、工程标准与任务卡输入；不猜测。

---

## 5. 跨工具 Skill 与 Agent

| 位置 | 用途 | 使用方式 |
|------|------|---------|
| `.kimi/skills/` | Skill 单一源 | 修改后执行 `bash scripts/sync-skills.sh` |
| `.agents/skills/` | 跨工具共享镜像（生成） | OpenCode / Trae / Kimi Code CLI 自动发现，禁止手改 |
| `.kimi/agents/*.md` | Agent 角色提示词 | 在支持 Agent 的工具中作为 system prompt / 上下文引用 |
| `.trae/skills/` | Trae 专属入口 | 源码架构探索等 Trae 特有能力 |

- 传统 Kimi CLI 读取 `.kimi/skills/`；OpenCode / Trae / Kimi Code CLI 通过 `.agents/skills/` 自动发现。
- 架构结论应及时沉淀到 `prometheus-architecture` 与本 Skill，再执行 `make sync-skills`。
- 详细角色与工作流见 [`.kimi/AGENTS.md`](../../AGENTS.md)。

---

## 6. 关键文档

- [产品愿景](../../../docs/02-product-requirements/00_Product_Vision.md)
- [全局架构](../../../docs/02-product-requirements/00_Global_Architecture.md)
- [MVP 核心：监控对象管理](../../../docs/02-product-requirements/Modules/Module_07_Monitoring_Object_Management.md)
- [代码隔离标准](../../../docs/03-engineering-standards/01_Code_Isolation_Standard.md)
- [API 设计标准](../../../docs/03-engineering-standards/03_API_Standard.md)
- [测试标准](../../../docs/03-engineering-standards/04_Testing_Standard.md)
- [后端架构与技术债控制](../../../docs/03-engineering-standards/07_Backend_Architecture_and_Debt_Control.md)
- [Agent 协作速查](../../AGENTS.md)
