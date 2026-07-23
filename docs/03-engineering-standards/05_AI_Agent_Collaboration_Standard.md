# MetricCenter AI Agent 协作标准

> 文档类型：工程标准  
> 目标读者：zhangwq（Vibe Coding 执行者）、chenrt（Orchestrator）、所有调用 AI Agent 的成员  
> 目标：规范 AI Agent 在 MetricCenter 项目中的协作方式，确保代码质量和文档一致性。  
> 更新日期：2026-07-22

---

## 1. AI Agent 工作流

本项目采用 **Gitflow + 单一 worktree + 按功能子模块拆分 feature 分支** 的协作模式。

```
Orchestrator 接收需求
    │
    ├──► Planner 输出模块任务规划
    │         │
    │         ▼
    │    明确 feature/module-XX-<功能名> 分支
    │
    ├──► 复用单一 git worktree，切换到当前模块 feature 分支
    │
    ├──► Backend Developer / Frontend Developer TDD 开发
    │         │
    │         ▼
    │    提交到 feature/module-XX-<功能名>
    │
    ├──► Reviewer 代码审查
    │         │
    │         ▼
    │    如 REQUEST_CHANGES，返回 Developer 修复
    │
    ├──► 在 worktree 中验证运行状态
    │         │
    │         ▼
    │    后端：go test/vet + 启动服务验证接口
    │    前端：pnpm test/lint + 启动 dev server 验证页面
    │
    ├──► Orchestrator 在主仓库将 feature 分支 --no-ff 合并到 develop
    │
    ├──► 在 develop 环境中再次验证运行状态
    │         │
    │         ▼
    │    如失败，回退或修复；如通过，继续下一模块
    │
    └──► worktree 保留，切换到下一模块分支
```

详细分支策略与回退机制见 [`06_Gitflow_Branch_and_Rollback_Guide.md`](06_Gitflow_Branch_and_Rollback_Guide.md)。

### 1.1 Orchestrator 与执行者分工

| 角色 | 负责人 | 职责 |
|------|--------|------|
| Orchestrator | chenrt | 接收需求、调用 planner、确定 feature 分支、执行最终 `--no-ff` 合并 |
| Vibe Coding 执行者 | zhangwq | 调用 backend/frontend/prometheus/build-resolver 等 Agent 生成代码、Review、测试补强、提交前验证、提交合并申请 |
| Reviewer Agent | `golang-reviewer` / `frontend-reviewer` | 在 zhangwq 要求下对代码进行结构化审查 |

> zhangwq 的具体执行 SOP 见 [`../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

---

## 2. 任务开始前必读

AI Agent 接到任何开发任务前，必须读取以下文档：

| 文档 | 用途 |
|------|------|
| `docs/02-product-requirements/Modules/Module_XX_*.md` | 理解模块需求 |
| `docs/03-engineering-standards/00_Engineering_Standard.md` | 了解目录结构和技术栈 |
| `docs/03-engineering-standards/01_Code_Isolation_Standard.md` | 明确代码隔离边界 |
| `docs/03-engineering-standards/03_API_Standard.md` | 了解 API 规范 |
| `docs/03-engineering-standards/04_Testing_Standard.md` | 了解测试与服务启动验证要求 |
| `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` | 了解分支策略与回退机制 |
| `.kimi/AGENTS.md` | 了解 Agent 角色与标准工作流 |
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

- 关联执行记录: docs/04-execution-records/module-XX-<功能名>/<agent>.md
- 变更范围: platform/xxx, ui-custom/web/xxx
```

示例：

```
module-07-resource-management: 实现资源 CRUD API

- 关联执行记录: docs/04-execution-records/module-07-resource-management/backend-developer.md
- 变更范围: platform/config/resource/
```

---

## 4. Agent 调用规范

### 4.1 调用原则

- **单一职责**：一次 Agent 调用聚焦一个任务（如一个 API 或一个页面）。
- **范围控制**：在 prompt 中明确指定"不修改无关文件"，并在 AI 输出后检查 `git diff --stat`。
- **可读文档优先**：在 prompt 中列出所有必读文档路径，要求 AI 先读后写。
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

### 4.3 Prompt 设计五要素

每个给 AI 的 prompt 必须包含：

1. **背景**：当前模块目标、所处阶段、依赖关系
2. **输入**：需要阅读的文档路径、已有代码路径
3. **输出**：需要新增/修改的文件列表、预期行为
4. **约束**：API 前缀、数据模型、安全要求、代码风格、不修改范围
5. **验收标准**：测试命令、服务启动验证、人工检查点

### 4.4 执行记录要求

每次 Agent 调用结束后，zhangwq 必须在 `docs/04-execution-records/module-XX-<功能名>/` 下保存执行记录，记录模板见 [`../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

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
| 新增 patch | `patches/prometheus/README.md` |

---

## 6. Skill 使用

当 AI Agent 需要理解源码架构时，应调用 `.trae/skills/codebase-architecture-explorer`。

调用方式：在任务描述中说明，例如：

```
请使用 codebase-architecture-explorer 分析 platform/api/ 目录的接口注册与路由组织方式，再基于分析结果完成 Module XX 的 API 开发。
```

---

## 7. 相关文档

- [`../05-team-collaboration/00_Team_Charter.md`](../05-team-collaboration/00_Team_Charter.md) — 团队守则
- [`../05-team-collaboration/01_Role_Responsibilities.md`](../05-team-collaboration/01_Role_Responsibilities.md) — 角色职责速查表
- [`../05-team-collaboration/03_Code_Collaboration_Workflow.md`](../05-team-collaboration/03_Code_Collaboration_Workflow.md) — 代码编写与提交环节详细流程
- [`../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md) — zhangwq Vibe Coding 执行手册
- [`06_Gitflow_Branch_and_Rollback_Guide.md`](06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南