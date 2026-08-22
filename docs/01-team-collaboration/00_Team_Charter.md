# MetricCenter 团队守则（Team Charter）

> 文档类型：团队协作规范  
> **目标读者**：项目全体成员（chenrt、guixm、zhaohy、zhangwq）——团队共识与人机分工边界  
> 版本：v1.3  
> 更新日期：2026-08-12（v1.25 去重：Agent 细节指向 .kimi/agents/ 与团队目录其他文档）

---

## 1. 团队目标

本项目采用 **Vibe Coding + Agent 团队** 的工程化方式，基于 Prometheus 开源生态构建 MetricCenter（指标采集与查询中心）。

本守则旨在明确：

1. 每个成员的角色、职责与决策边界
2. 需求设计、代码编写、提交合并的协作流程
3. 人类与 AI Agent 的分工边界
4. 统一使用的模型、工具和工程标准
5. 质量保证与沟通机制

> 所有成员必须遵守本守则。如有冲突，以本守则为最终依据。

---

## 2. 团队成员与角色

| 代号 | 身份 | 项目角色 | 核心职责 |
|------|------|----------|----------|
| **chenrt** | 项目整体负责人 + 产品经理 | Orchestrator / 产品 Owner | 定方向、拆需求、调 Agent、做决策、对外汇报 |
| **guixm** | 高级运维总监 | 业务架构师 / 需求共创者 | 把业务战略转化为可落地需求，把关原型方向 |
| **zhaohy** | 运维业务经理 | 业务需求提出方 / 验收者 | 提供一线运维场景，验证功能是否解决真实问题 |
| **zhangwq** | SRE 工程师 | Vibe Coding 执行者 / 工程质量 Owner | 调用 AI 写代码，Review 质量，补充测试，保障可运维 |

> 各角色详细职责、日常工作清单、决策权限与协作接口见 [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md)。

---

## 3. 人类与 AI 的分工边界

### 3.1 必须由人类决策/执行的事项

| 事项 | 负责人 | 说明 |
|------|--------|------|
| 产品方向与 MVP 范围 | chenrt | 决定做什么、不做什么 |
| 业务战略价值判断 | guixm | 判断需求是否值得做 |
| 一线场景与痛点输入 | zhaohy | 提供真实业务上下文 |
| Agent 调用与模块调度 | chenrt | 决定调用哪个 Agent、开发哪个模块 |
| 代码合并到 `develop` | chenrt | 最终审批与执行 `--no-ff` 合并 |
| 代码质量与安全兜底 | zhangwq | AI 生成代码的人工 Review 与验证 |
| 架构与技术选型 | chenrt（征询 zhangwq） | 决定技术路线 |
| 模型与工具统一规范 | chenrt | 决定团队使用哪种 AI 模型和工具 |

### 3.2 可以由 AI Agent 辅助执行的事项

> **v1.25 去重**：各 Agent 的适用场景、调用人与输入方式的**权威定义在 `.kimi/agents/orchestrator.md`（子 Agent 调用规范）与 `README.md` §2（各角色怎么用 Agent 速查卡）**。此处仅列总览：

| 事项 | 执行 Agent | 人类负责人 |
|------|-----------|-----------|
| 模块实现计划 | `planner` | chenrt |
| 可点击原型 | `prototype-designer` | chenrt |
| 后端代码开发 | `backend-developer` | zhangwq |
| 前端代码开发 | `frontend-developer` | zhangwq |
| Prometheus 扩展分析 | `prometheus-developer` | zhangwq |
| 构建/测试修复 | `build-resolver` | zhangwq |
| 代码审查 | `golang-reviewer` / `frontend-reviewer` | zhangwq |
| 安全审查 | `security-reviewer` | zhangwq |

### 3.3 目录隔离铁律

为支持**全链路 Vibe Coding**（产品经理用 AI 生成原型，开发用 AI 生成生产代码），项目目录按职责严格隔离：

| 目录 | 归属 | 允许修改者 | 说明 |
|------|------|-----------|------|
| `docs/02-product-requirements/` | 产品设计区 | chenrt / PM 的 AI | PRD Markdown 文件 |
| `docs/prototypes/` | 产品设计区 | chenrt / PM 的 AI | AI 生成的可点击原型代码 |
| `platform/` | 生产代码区 | zhangwq / 开发 AI | 后端生产代码 |
| `ui-custom/web/` | 生产代码区 | zhangwq / 开发 AI | 前端生产代码 |
| `upstream/` | 上游源码 | 禁止直接修改 | 必须走 patch 流程 |

> **铁律**：产品经理的 AI 只能修改 `docs/` 下的内容；开发的 AI 只能读取 `docs/`、修改 `platform/` 和 `ui-custom/web/`。

> AI Agent 是生产工具，不是责任主体。**最终代码质量、安全性和可运维性由 zhangwq 和 chenrt 共同负责。**

---

## 4. 统一模型与工具规范

### 4.1 统一 AI 模型

- **本项目的 Vibe Coding 统一使用 Kimi-K2.7-Code 模型（通过 Trae IDE）**。
- 所有 AI 代码生成必须通过 Trae IDE 对话面板完成。
- 禁止未经批准使用其他模型（如 GPT-4、Claude、DeepSeek 等）生成项目代码。

### 4.2 统一 Agent 定义

- 所有 Agent 定义位于 `.kimi/agents/`，由 chenrt 和 zhangwq 共同维护。
- 任何人不得私自修改 Agent 定义；修改需经 chenrt 批准并同步团队。

### 4.3 统一开发环境

- 后端：Go（版本以 `go.mod` 为准）
- 前端：React 18 + TypeScript + Vite + Ant Design 5
- 包管理：前端使用 `pnpm`
- 代码编辑器：Trae IDE（推荐统一）

### 4.4 切换模型/工具的审批流程

如因特殊原因需要切换模型或工具：

1. 由 zhangwq 提出申请，说明原因
2. chenrt 审批
3. 在隔离分支上试点一个完整模块
4. 验证 Agent 遵守率、代码质量、测试通过率不低于现有模型
5. 通过后方可正式切换

---

## 5. 需求设计环节

> **v1.25 去重**：需求从痛点收集到冻结的完整流程见 [`02_Demand_Workflow.md`](02_Demand_Workflow.md)。本守则仅保留关键约定：

- 任何进入开发队列的需求，必须落在某个 `Modules/Module_XX_*.md` 中。
- **PRD 与原型代码放在同一分支 `design/module-mvp-demo`**，统一由 chenrt 提交到 `develop`。
- 原型代码存放在 `docs/prototypes/module-XX/`，**属于产品设计区**，不污染 `platform/` 和 `ui-custom/web/`。
- `design/module-mvp-demo` 合并到 `develop` 后，PRD + 原型成为 `develop` 上的 SSOT，zhangwq 的 AI 从此读取。
- 需求变更需 chenrt 确认；涉及业务方向调整需 guixm 同意。
- zhaohy 的需求输入应尽量使用"用户故事"格式：作为【角色】，我希望【功能】，以便于【价值】。

---

## 6. 代码编写与提交环节

> **v1.25 去重**：代码编写到合并 develop 的完整流程（含 PR 模板、验证、验收）见 [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) 与 [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md)。本守则仅保留关键约定：

### 6.1 zhangwq 在 Vibe Coding 中的关键动作

1. **任务卡设计**：把 Module 文档、原型代码和工程标准转化为任务卡（输入路径+章节 / 输出 / 验收 / 不修改范围，见 `.kimi/agents/orchestrator.md`）。
2. **过程监督**：确保 AI 在正确的 worktree、正确的分支、正确的范围内开发。
3. **结果校验**：AI 输出后必须人工 Review，不盲目信任。
4. **测试补强**：AI 写 happy path，SRE 补异常路径和集成场景。
5. **质量兜底**：提交前验证清单的最终执行人（见 `03-engineering-standards/04_Testing_Standard.md` §4）。

### 6.2 分支与合并规则

| 分支类型 | 命名示例 | 负责人 | 合并目标 | Reviewer | 说明 |
|----------|----------|--------|----------|----------|------|
| 设计分支 | `design/module-mvp-demo` | chenrt | `develop` | guixm、zhaohy | 包含 PRD + 原型代码 |
| 功能分支 | `feat/module-XX` | zhangwq | `develop` | chenrt、zhaohy、guixm | 生产代码实现 |
| 热修复 | `hotfix/*` | zhangwq | `main` + `develop` | chenrt | 生产紧急修复 |

- `design/module-mvp-demo` 合并到 `develop` 后，该模块 PRD + 原型即冻结。
- 只有 chenrt 有权将分支 `--no-ff` 合并到 `develop`。
- `feat/module-XX` 合并前必须完成：zhangwq Review 通过 + 提交前验证通过 + 产品经理/业务方通过预览链接验收。

---

## 7. 文档 Ownership

### 7.1 产品需求与原型

| 文档/目录 | 主负责人 | 协作人 | 更新时机 |
|----------|---------|--------|----------|
| `docs/02-product-requirements/README.md` | chenrt | 全员 | PRD 目录结构或职责边界调整 |
| `docs/02-product-requirements/00_Product_Vision.md` | chenrt | guixm | 产品定位调整 |
| `docs/02-product-requirements/00_Global_Architecture.md` | chenrt | zhangwq | 总体架构调整 |
| `docs/02-product-requirements/01_User_Stories.md` | chenrt | zhaohy | 需求新增/变更 |
| `docs/02-product-requirements/02_Product_Roadmap.md` | chenrt | guixm、zhangwq | 里程碑/阶段调整 |
| `docs/02-product-requirements/03_Functional_Architecture.md` | chenrt | zhangwq | 功能架构调整 |
| `docs/02-product-requirements/04_Implementation_Map.md` | chenrt | zhangwq | 实施难度/技术方案调整 |
| `docs/02-product-requirements/05_Code_Implementation_Plan.md` | chenrt | zhangwq | 开发顺序/依赖调整 |
| `docs/02-product-requirements/Modules/Module_XX_*.md` | chenrt | zhangwq（技术约束）、zhaohy（业务验收） | 模块需求细化 |
| `docs/prototypes/module-XX/` | chenrt | zhangwq（技术可行性）、zhaohy（业务验收） | AI 生成的可点击原型代码 |

### 7.2 工程标准

| 文档/目录 | 主负责人 | 协作人 | 更新时机 |
|----------|---------|--------|----------|
| `docs/03-engineering-standards/README.md` | zhangwq | chenrt | 工程标准目录或职责边界调整 |
| `docs/03-engineering-standards/00_Engineering_Standard.md` | zhangwq | chenrt | 工程规范调整 |
| `docs/03-engineering-standards/01_Code_Isolation_Standard.md` | zhangwq | chenrt | 代码隔离规则调整 |
| `docs/03-engineering-standards/02_Frontend_Standard.md` | zhangwq | chenrt | 前端规范调整 |
| `docs/03-engineering-standards/03_API_Standard.md` | zhangwq | chenrt | API 规范调整 |
| `docs/03-engineering-standards/04_Testing_Standard.md` | zhangwq | chenrt | 测试规范调整 |
| `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md` | zhangwq | chenrt | Agent 协作方式调整 |
| `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` | zhangwq | chenrt | 分支策略调整 |

### 7.3 团队协作

| 文档/目录 | 主负责人 | 协作人 | 更新时机 |
|----------|---------|--------|----------|
| `docs/01-team-collaboration/00_Team_Charter.md` | chenrt | 全员 | 团队目标、角色、决策权限调整 |
| `docs/01-team-collaboration/01_Role_Responsibilities.md` | chenrt | 全员 | 角色职责调整 |
| `docs/01-team-collaboration/02_Demand_Workflow.md` | chenrt | guixm、zhaohy | 需求流程调整 |
| `docs/01-team-collaboration/03_Code_Collaboration_Workflow.md` | chenrt | zhangwq | 代码协作流程调整 |
| `docs/01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md` | zhangwq | chenrt | zhangwq 执行 SOP 调整 |

### 7.4 其他

| 文档/目录 | 主负责人 | 协作人 | 更新时机 |
|----------|---------|--------|----------|
| `README.md`（项目根目录） | chenrt | zhangwq | 项目整体说明调整 |
| `.kimi/agents/` | zhangwq | chenrt | Agent 定义优化 |
| `docs/05-execution-records/` | zhangwq / AI Agent | chenrt | 每次开发后 |
| `patches/prometheus/README.md` | zhangwq | chenrt | 新增/调整 patch |

---

## 8. 决策权限矩阵

| 决策事项 | 最终决策人 | 必须征询 | 备注 |
|----------|-----------|----------|------|
| 产品方向 / 愿景 | chenrt | guixm | 需对齐公司运维战略 |
| MVP 范围变更 | chenrt | guixm、zhaohy | 需同步更新 Roadmap |
| 需求优先级调整 | chenrt | guixm、zhaohy | 影响开发顺序 |
| 新增/删除模块 | chenrt | guixm、zhangwq | 需更新功能架构 |
| `design/module-mvp-demo` 合并到 develop | chenrt | guixm、zhaohy | PRD + 原型评审通过 |
| `feat/module-XX` 合并到 develop | chenrt | zhangwq（Review 通过）、zhaohy（业务验收通过） | 必须完成提交前验证 + 预览验收 |
| 技术选型变更 | chenrt | zhangwq | 需更新 Implementation Map |
| API 路径/响应格式变更 | zhangwq | chenrt | 需更新 API Standard |
| 目录隔离规则调整 | zhangwq | chenrt | 影响 AI 可读范围 |
| 告警/拨测等业务逻辑 | zhaohy | guixm、chenrt | 需落到 Module 文档 |
| 引入新的外部依赖 | zhangwq | chenrt | 需评估许可与安全 |
| 模型/工具切换 | chenrt | zhangwq | 需试点验证 |
| Agent 定义/协作方式调整 | zhangwq | chenrt | 影响团队工作方式 |

---

## 9. 沟通机制

| 会议/同步 | 频率 | 参与人 | 目的 |
|----------|------|--------|------|
| 需求输入会 | 每周 1 次 | zhaohy、chenrt | zhaohy 同步一线痛点 |
| 需求拆解会 | 按需 | chenrt、guixm | 把需求变成用户故事和原型 |
| 原型评审会 | 按需 | chenrt、guixm、zhaohy | 确认原型是否符合业务预期 |
| 技术方案评审 | 每个 Module 开发前 | chenrt、zhangwq | 确认实现方案、API、数据模型 |
| AI 输出 Review | 每个 feature 合并前 | zhangwq、chenrt | 验收代码质量和业务符合度 |
| 周会/复盘 | 每周 1 次 | 全员 | 进度同步、问题升级、经验沉淀 |

---

## 10. 质量保证双保险

### 10.1 AI 自检（必须）

> **v1.25 去重**：测试 / lint / 服务启动验证的完整命令与通过标准见 `docs/03-engineering-standards/04_Testing_Standard.md` §4（唯一权威）。此处仅保留原则：`go test/vet`、`pnpm test/lint`、后端接口 200、前端页面 200。

### 10.2 人类验收（必须）

#### 设计阶段

- **chenrt**：PRD 与原型完整性、产品方向正确性
- **guixm**：业务战略价值、管理视角
- **zhaohy**：一线业务逻辑正确性、用户故事完整性

#### 开发阶段

- **zhangwq**：代码 Review、安全、可运维性、测试完整性
- **chenrt**：产品符合度、架构一致性、合并决策
- **zhaohy**：通过预览链接验收业务场景正确性
- **guixm**：管理价值与战略方向

---

## 11. 禁止事项

1. **禁止私自修改 Agent 定义**（`.kimi/agents/`）。
2. **禁止在未经批准的情况下切换 AI 模型或工具**。
3. **禁止绕过提交前验证直接申请合并**。
4. **禁止在 `feat/module-XX` 分支混入其他模块改动**。
5. **禁止直接修改 `upstream/` 源码**；必须走 patch 流程。
6. **禁止将 `docs/prototypes/` 中的原型代码复制到 `platform/` 或 `ui-custom/web/` 后原样合并**；原型可作为实现基底复制，但须完成 **mock 替换 / ReviewNote 剔除 / MVP 裁剪** 三道工序（见 `03_Code_Collaboration_Workflow.md` §6）。
7. **禁止产品经理的 AI 修改 `platform/`、`ui-custom/web/`、`upstream/` 目录**。
8. **禁止开发的 AI 修改 `docs/02-product-requirements/`、`docs/prototypes/` 目录**。
9. **禁止未经 chenrt 批准直接合并到 `develop`**。

---

## 12. 守则修订

本守则由 chenrt 主责维护。如需修订：

1. 由相关成员提出建议
2. chenrt 组织讨论
3. 修订后同步全员
4. 更新本守则版本号和更新日期

---

## 13. 相关文档

- [`README.md`](README.md) — 团队协作目录导航（按角色索引 + 各角色怎么用 Agent 速查卡）
- [`../02-product-requirements/README.md`](../02-product-requirements/README.md) — PRD 目录说明
- [`../03-engineering-standards/05_AI_Agent_Collaboration_Standard.md`](../03-engineering-standards/05_AI_Agent_Collaboration_Standard.md) — AI Agent 协作细则
- [`../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南
- [`../../.kimi/AGENTS.md`](../../.kimi/AGENTS.md) — Agent 团队速查
