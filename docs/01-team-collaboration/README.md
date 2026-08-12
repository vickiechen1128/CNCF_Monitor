# MetricCenter 团队协作指引

> 文档类型：团队协作规范
> **目标读者**：项目全体成员（chenrt / guixm / zhaohy / zhangwq）——**面向"人"的协作指引**
> 定位：本目录只回答团队成员的三个问题——**我是谁**（角色）、**我怎么参与**（流程）、**我具体做什么操作**（命令/模板）。凡涉及"Agent 内部怎么干活"的内容，权威在 `.kimi/agents/` 与 `docs/03-engineering-standards/`，本目录只做引用。

---

## 1. 目录导航（按角色）

| 文档 | 定位 | 谁需要读 |
|------|------|----------|
| [`00_Team_Charter.md`](00_Team_Charter.md) | 团队共识：目标 / 角色 / 目录隔离铁律 / 决策矩阵 / 沟通机制 | **全员必读** |
| [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md) | 四个角色的职责 / 决策权限 / 协作接口 / 典型任务 | **全员**（重点读自己章节） |
| [`02_Demand_Workflow.md`](02_Demand_Workflow.md) | 需求侧流程：从痛点收集到需求冻结 | **chenrt / guixm / zhaohy**（产品与业务侧） |
| [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) | 代码协作总览：三阶段流程 + 合并规则 | **chenrt / zhangwq**（开发侧）+ 评审 |
| [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) | Git 操作速查：按角色分步命令 | **chenrt / zhangwq**（需要动手操作 git 的人） |
| [`05_Vibe_Coding_Playbook_for_Zhangwq.md`](05_Vibe_Coding_Playbook_for_Zhangwq.md) | zhangwq 执行 SOP：用 Agent 开发的人视角操作 | **zhangwq** |

---

## 2. 各角色怎么用 Agent（速查卡）

> Agent 行为规则的权威定义在 `.kimi/agents/*.md`（随 Agent 加载生效）；以下是**人视角**的调用指引——你只需知道"什么场景调谁、怎么给输入"。

### 2.1 chenrt（产品 Owner / Orchestrator）

| 场景 | 调用 | 怎么给输入 |
|------|------|-----------|
| 需求 → 原型 | `prototype-designer` | 给需求范围 + 要展示的页面/流程；原型产出后走两段评审（用户走查 + 技术核对） |
| 需求对齐 | 直接与原型 Agent 讨论（grill） | 用 AskUserQuestion 澄清隐含假设，结论落 design-decisions.md |
| 模块规划 | `planner` | 给 ready 状态的 PRD，产出实现计划 |
| 协调开发 | 不直接写代码 | 给 zhangwq 下开发任务单（来源 PRD / 原型 / 验收标准） |

### 2.2 zhangwq（SRE / Vibe Coding 执行者）

| 场景 | 调用 | 怎么给输入 |
|------|------|-----------|
| 后端开发 | `backend-developer` | 给任务卡：PRD 章节 + task-sequence + 验收命令 |
| 前端开发 | `frontend-developer` | 给任务卡：PRD 章节 + 原型路径 + 验收命令（含原型-实现一致性核对） |
| 构建/测试修复 | `build-resolver` | 给报错信息 + 复现命令 |
| 代码审查 | `golang-reviewer` / `frontend-reviewer` | 给 `git diff` + PRD + 原型路径（独立会话） |
| 安全复核 | `security-reviewer` | 给变更文件 + 风险关注点 |

> 关键：**任务卡驱动**——给子 Agent 的输入包含「输入路径+章节 / 输出 / 验收 / 不修改范围」四要素（格式见 `.kimi/agents/orchestrator.md`），子 Agent 只读任务卡指定的输入，无需读团队手册。

### 2.3 guixm（业务架构师）

| 场景 | 怎么做 |
|------|--------|
| 需求拆解 | 与 chenrt 需求拆解会，判断业务价值 / MVP 范围 / 优先级 |
| 原型评审 | 在 GitHub `design/module-XX → develop` PR 里看 PRD + 原型，评论或 Approve（管理视角） |
| 功能验收 | 点 `feat/module-XX` PR 里 Vercel Bot 的 `Preview` 链接，对照原型验收 |

> 你不需要本地开发环境，所有评审/验收都在 GitHub PR 内完成（操作见 [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) §7）。

### 2.4 zhaohy（业务需求提出方 / 验收者）

| 场景 | 怎么做 |
|------|--------|
| 提需求 | 用「用户故事」格式（作为…我希望…以便于…）+ 业务场景 / 痛点 / 验收标准，见 [`02_Demand_Workflow.md`](02_Demand_Workflow.md) Stage 1 |
| 原型评审 | 看 design PR 的原型，重点核对一线操作习惯 / 字段完整性 / 流程顺畅 |
| 功能验收 | 点 `feat/module-XX` PR 的 `Preview` 链接，验证是否解决真实问题 |

---

## 3. 相关文档

- `.kimi/agents/*.md` — Agent 行为规则（唯一权威，随 Agent 加载）
- `docs/03-engineering-standards/` — 工程标准（技术规范：API / 测试 / 分支 / 隔离）
- `docs/02-product-requirements/` — 产品需求（PRD / 用户故事 / 路线图）
