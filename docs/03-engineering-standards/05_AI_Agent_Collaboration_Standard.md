# MetricCenter AI Agent 协作标准

> 文档类型：工程标准  
> **目标读者**：chenrt（Orchestrator / 产品 Owner）、zhangwq（Vibe Coding 执行者）、评审（guixm / zhaohy）——**人视角**的 Agent 协作流程概览；Agent 行为规则权威在 `.kimi/agents/*.md`  
> 目标：规范 AI Agent 在 MetricCenter 项目中的协作方式，确保代码质量和文档一致性。  
> 更新日期：2026-07-22（v1.25 去重）

---

## 1. AI Agent 工作流

> **v1.25 起去重**：工作流每一步的**详细执行要求（每个 Agent 何时被调、读什么、产出什么、如何验收）的权威定义在 `.kimi/agents/orchestrator.md`「标准工作流」**；本文件仅保留人视角的流程概览，不再重复细节。

本项目采用 **双文件夹隔离 + 按功能子模块拆分 feature 分支** 的协作模式。

- **设计空间**：`CNCF_Monitor-worktree`，固定分支 `design/module-mvp-demo`，写 PRD、改原型。
- **开发空间**：`CNCF_Monitor-feature`，从 `develop` 创建/切换 `feat/module-XX` 做 Vibe Coding（并行推进多模块时额外 `git worktree add` 多目录）。

```
Orchestrator 接收需求
    │
    ├──► [设计空间] prototype-designer 产出 PRD + 原型（design/module-mvp-demo）
    ├──► Planner 输出模块任务规划（明确 feature/module-XX-<功能名> 分支）
    ├──► [开发空间] Backend / Frontend Developer TDD 开发（提交到 feat/module-XX-<功能名>）
    ├──► Reviewer 代码审查（如 REQUEST_CHANGES，返回 Developer 修复）
    ├──► [开发空间] 验证运行状态（后端 go test/vet+接口；前端 pnpm test/lint+dev server）
    ├──► Orchestrator 将 feat 分支 --no-ff 合并到 develop
    ├──► 在 develop 环境中再次验证运行状态（如失败回退或修复）
    └──► 开发空间保留，切换到下一模块 feat 分支
```

> 各环节的**任务卡格式与子 Agent 只读规则见 `.kimi/agents/orchestrator.md`**；详细分支策略与回退机制见 [`06_Gitflow_Branch_and_Rollback_Guide.md`](06_Gitflow_Branch_and_Rollback_Guide.md)。

### 1.1 Orchestrator 与执行者分工

| 角色 | 负责人 | 职责 |
|------|--------|------|
| Orchestrator | chenrt | 接收需求、调用 planner、确定 feature 分支、执行最终 `--no-ff` 合并 |
| Vibe Coding 执行者 | zhangwq | 调用 backend/frontend/prometheus/build-resolver 等 Agent 生成代码、Review、测试补强、提交前验证、提交合并申请 |
| Reviewer Agent | `golang-reviewer` / `frontend-reviewer` | 在 zhangwq 要求下对代码进行结构化审查 |

> zhangwq 的具体执行 SOP 见 [`../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

---

## 2. 项目文档导航（人视角参考）

> **v1.25 起去重**：子 Agent 启动时**无需读取以下清单**——其强制读取内容由各 `.kimi/agents/<agent>.md` 定义 + Orchestrator 任务卡指定（见 `.kimi/agents/orchestrator.md`）。本表仅供**人（chenrt / zhangwq / 评审）**快速定位项目文档：

| 文档 | 用途 |
|------|------|
| `.kimi/agents/*.md` | **Agent 行为规则唯一权威**（工作流 / 调用规范 / 验收要求） |
| `.kimi/AGENTS.md` | Agent 角色与标准工作流总览 |
| `docs/02-product-requirements/Modules/Module_XX_*.md` | 模块需求（PRD） |
| `docs/03-engineering-standards/00_Engineering_Standard.md` | 目录结构和技术栈 |
| `docs/03-engineering-standards/01_Code_Isolation_Standard.md` | 代码隔离边界 |
| `docs/03-engineering-standards/03_API_Standard.md` | API 规范 |
| `docs/03-engineering-standards/04_Testing_Standard.md` | 测试与服务启动验证要求 |
| `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` | 分支策略与回退机制 |
| `docs/01-team-collaboration/` | 团队协作指引（角色职责 / 需求流程 / zhangwq 手册） |
| `.trae/skills/codebase-architecture-explorer/SKILL.md` | 源码分析 Skill（如存在） |

---

## 3. 编码规范

### 3.1 不直接修改 upstream

- 所有业务代码写在 `platform/` 或 `ui-custom/`
- 必须修改 upstream 时，先生成 patch 到 `patches/prometheus/`

### 3.2 不编造接口

- API 设计必须符合 `03_API_Standard.md`
- 数据模型变更需同步更新对应 PRD

### 3.3 小步变更

- 每个功能点独立提交
- 单次变更尽量控制在 500 行以内

### 3.4 先写测试或同步写测试

- 后端新增功能必须包含 `*_test.go`
- 前端新增组件必须包含基础渲染测试

### 3.5 提交前必须验证运行状态

- 后端：除 `go test`/`go vet` 外，必须启动服务验证关键接口返回 200
- 前端：除 `pnpm test`/`pnpm lint` 外，必须启动 dev server 验证页面返回 200
- 验证完成后必须停止服务并释放端口
- 详细命令见 [`04_Testing_Standard.md`](04_Testing_Standard.md)

### 3.6 Commit 规范

每次 commit 必须能对应到某个 Agent 的一次执行记录：

```
<模块>: <动作> - <简短描述>

- 关联执行记录: docs/05-execution-records/module-XX-<功能名>/<agent>.md
- 变更范围: platform/xxx, ui-custom/web/xxx
```

示例：

```
module-07-resource-management: 实现资源 CRUD API

- 关联执行记录: docs/05-execution-records/module-07-resource-management/backend-developer.md
- 变更范围: platform/config/resource/
```

---

## 4. Agent 调用规范

> **v1.25 起去重**：Prompt 设计与任务卡格式的**权威定义在 `.kimi/agents/orchestrator.md`「子 Agent 调用规范」**（机器执行标准）；本节仅保留人视角的调用原则与适用场景速查，详细任务卡格式不再重复维护。

### 4.1 调用原则

- **单一职责**：一次 Agent 调用聚焦一个任务（如一个 API 或一个页面）。
- **范围控制**：在 prompt 中明确指定"不修改无关文件"，并在 AI 输出后检查 `git diff --stat`。
- **任务卡驱动**：给子 Agent 的输入使用统一任务卡格式（输入路径+章节 / 输出 / 验收 / 不修改范围），见 `.kimi/agents/orchestrator.md`；子 Agent 只读任务卡指定的输入，无需读取本文件或团队手册（其行为规范已固化在自身定义中）。
- **验收先行**：在 prompt 中明确列出验收标准（测试命令、服务启动验证）。

### 4.2 各 Agent 适用场景与调用人

| Agent | 调用人 | 适用场景 | 产出要求 |
|-------|--------|----------|----------|
| `planner` | chenrt | Module 开发前 | 任务拆分、依赖分析、分支建议 |
| `prototype-designer` | chenrt | 需求确认前 | 可点击原型、mock 数据、GitHub Pages 部署说明 |
| `backend-developer` | zhangwq | 后端 API / 业务逻辑开发 | Go 代码、单元测试、API 文档注释 |
| `frontend-developer` | zhangwq | 前端页面 / 交互开发 | React + TS 代码、基础渲染测试 |
| `prometheus-developer` | zhangwq | Prometheus 源码分析 / 扩展点 | 分析报告、patch 建议 |
| `build-resolver` | zhangwq | 编译失败 / 测试失败 / 依赖问题 | 修复后的可编译可测试代码 |
| `golang-reviewer` | zhangwq | 后端代码 Review | APPROVE / REQUEST_CHANGES + 结构化意见 |
| `frontend-reviewer` | zhangwq | 前端代码 Review | APPROVE / REQUEST_CHANGES + 结构化意见 |
| `security-reviewer` | zhangwq | 关键变更安全复核 | 安全风险清单 + 修复建议 |

### 4.3 执行记录要求

每次 Agent 调用结束后，zhangwq 必须在 `docs/05-execution-records/module-XX-<功能名>/` 下保存执行记录，记录模板见 [`../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

---

## 5. 文档同步要求

代码变更后，AI Agent 必须同步更新以下文档：

| 变更类型 | 需要更新的文档 |
|----------|----------------|
| 新增模块 | `docs/02-product-requirements/Modules/` |
| 修改 API | `docs/03-engineering-standards/03_API_Standard.md` |
| 修改目录结构 | `docs/03-engineering-standards/00_Engineering_Standard.md` |
| 修改代码隔离规则 | `docs/03-engineering-standards/01_Code_Isolation_Standard.md` |
| 修改前端规范 | `docs/03-engineering-standards/02_Frontend_Standard.md` |
| **修改用户可见文案 / 页面布局** | **同步更新对应模块 PRD 的 UI/UX 规范章节（v1.25 起：防止原型/前端改完 UI 而 PRD 没跟上，导致后续开发断层）** |
| 新增 patch | `patches/prometheus/README.md` |

---

## 6. Skill 使用

> **v1.25 起去重**：各 Agent 强制加载的 Skill 清单**以各 `.kimi/agents/<agent>.md` 定义为权威**（随 Agent 加载生效）；本文件不再重复维护。此处仅保留人视角的提示：

当 AI Agent 需要理解源码架构时，应在任务描述中说明调用 `.trae/skills/codebase-architecture-explorer`，例如：

```
请使用 codebase-architecture-explorer 分析 platform/api/ 目录的接口注册与路由组织方式，再基于分析结果完成 Module XX 的 API 开发。
```

---

## 7. 相关文档

- [`../01-team-collaboration/00_Team_Charter.md`](../01-team-collaboration/00_Team_Charter.md) — 团队守则
- [`../01-team-collaboration/01_Role_Responsibilities.md`](../01-team-collaboration/01_Role_Responsibilities.md) — 角色职责速查表
- [`../01-team-collaboration/03_Code_Collaboration_Workflow.md`](../01-team-collaboration/03_Code_Collaboration_Workflow.md) — 代码编写与提交环节详细流程
- [`../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md) — zhangwq Vibe Coding 执行手册
- [`06_Gitflow_Branch_and_Rollback_Guide.md`](06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南