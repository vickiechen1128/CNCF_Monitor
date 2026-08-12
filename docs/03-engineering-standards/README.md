# 工程标准目录

> 本目录存放 MetricCenter 的**工程标准（技术规范）**，面向技术架构师、开发工程师与 AI 编程助手。
> 为保持"单一权威"与可维护性，各标准有明确职责边界与读者，开发前应优先阅读本页定位。
> **Agent 行为规则（工作流 / 调用规范 / 验收要求）不在本目录，权威在 `.kimi/agents/*.md`**；本目录是"技术怎么做"的标准。

---

## 1. 文档职责一览

| 文档 | 职责 | 目标读者 | 不重复写什么 |
|------|------|----------|--------------|
| [00_Engineering_Standard.md](00_Engineering_Standard.md) | 项目目录结构、技术栈、编码前必读、AI 协作核心原则速查 | 架构师（选型/目录）、开发工程师、AI 助手 | 不写具体 API / 测试命令 / 分支细节（分别在 03/04/06） |
| [01_Code_Isolation_Standard.md](01_Code_Isolation_Standard.md) | upstream 与业务代码隔离边界、patch 管理、隔离审查清单 | 架构师、后端工程师、zhangwq（patch） | 不写前端规范 / API / 测试命令 |
| [02_Frontend_Standard.md](02_Frontend_Standard.md) | 前端技术栈、目录结构、编码规范、部署渠道分工 | 前端工程师、架构师 | 不写 API 路由细节（在 03）、不重复验证命令（在 04） |
| [03_API_Standard.md](03_API_Standard.md) | API 风格、路由规划、返回格式、认证、多租户、代理说明 | 后端（实现）、前端（对接）、架构师 | 不写具体模块字段（在 PRD Modules） |
| [04_Testing_Standard.md](04_Testing_Standard.md) | 测试规范、覆盖率目标、**提交前验证清单（唯一权威）** | 前后端工程师、架构师（质量门禁） | 不写分支/合并细节（在 06） |
| [05_AI_Agent_Collaboration_Standard.md](05_AI_Agent_Collaboration_Standard.md) | 人视角的 Agent 协作流程概览、角色分工、Commit 规范 | chenrt、zhangwq、评审（人视角） | 不写 Agent 行为细节（在 `.kimi/agents/`） |
| [06_Gitflow_Branch_and_Rollback_Guide.md](06_Gitflow_Branch_and_Rollback_Guide.md) | 分支模型、SSOT、worktree、回退机制、合并审批、预览环境 | 架构师、chenrt（合并/回退）、zhangwq | 不写具体测试命令（在 04） |

---

## 2. 权威定位声明（防止重复，v1.25）

为避免多份文档重复维护同一规则，以下内容**只在一个地方定义**，其余文档一律引用：

| 内容 | 唯一权威位置 |
|------|-------------|
| Agent 工作流 / 任务卡 / 子 Agent 调用 | `.kimi/agents/orchestrator.md` |
| 各 Agent 行为（启动协议 / 编码 / 验证） | `.kimi/agents/<agent>.md` |
| 提交前验证命令与通过标准 | `04_Testing_Standard.md` §4 |
| Commit 格式 | `05_AI_Agent_Collaboration_Standard.md` §3.6 |
| 分支策略 / 回退 / 合并审批 / 合并申请模板 | `06_Gitflow_Branch_and_Rollback_Guide.md` |
| API 路径 / 返回格式 | `03_API_Standard.md` |
| 前端技术栈 / 目录 / 部署渠道 | `02_Frontend_Standard.md` |
| 目录隔离 / patch 管理 | `01_Code_Isolation_Standard.md` |
| 团队协作（人视角） | `docs/01-team-collaboration/` |
| 产品需求（PRD） | `docs/02-product-requirements/` |

---

## 3. 按角色阅读顺序

### 技术架构师（技术选型 / 边界设计 / 分支模型）

1. [00_Engineering_Standard.md](00_Engineering_Standard.md) — 目录与技术栈
2. [01_Code_Isolation_Standard.md](01_Code_Isolation_Standard.md) — 隔离边界
3. [03_API_Standard.md](03_API_Standard.md) — API 风格
4. [06_Gitflow_Branch_and_Rollback_Guide.md](06_Gitflow_Branch_and_Rollback_Guide.md) — 分支与回退

### 后端开发工程师

1. [00_Engineering_Standard.md](00_Engineering_Standard.md) — 目录与入口
2. [01_Code_Isolation_Standard.md](01_Code_Isolation_Standard.md) — 隔离与 patch
3. [03_API_Standard.md](03_API_Standard.md) — API 规范
4. [04_Testing_Standard.md](04_Testing_Standard.md) — 测试与提交前验证

### 前端开发工程师

1. [02_Frontend_Standard.md](02_Frontend_Standard.md) — 前端规范
2. [03_API_Standard.md](03_API_Standard.md) — API 对接
3. [04_Testing_Standard.md](04_Testing_Standard.md) — 测试与验证

### AI 编程助手（backend / frontend / build-resolver）

1. `.kimi/agents/<agent>.md` — 自身行为规范（随加载生效，无需读本目录全量）
2. 任务卡指定的标准（如 03_API_Standard.md / 04_Testing_Standard.md）——由 Orchestrator 在任务卡中给出精确路径

### 评审（guixm / zhaohy）与项目 Owner（chenrt）

- [05_AI_Agent_Collaboration_Standard.md](05_AI_Agent_Collaboration_Standard.md) — 人视角协作概览
- [06_Gitflow_Branch_and_Rollback_Guide.md](06_Gitflow_Branch_and_Rollback_Guide.md) — 合并审批规则

---

## 4. 目录变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-12 | 新建本 README（对齐 02 / 01 README 导航风格）；各标准已加「目标读者」并完成 v1.25 去重（Agent 协作细节指向 `.kimi/agents/`） |
