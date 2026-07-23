# MetricCenter 团队守则（Team Charter）

> 文档类型：团队协作规范  
> 目标读者：项目全体成员（chenrt、guixm、zhaohy、zhangwq）  
> 版本：v1.0  
> 更新日期：2026-07-21

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
| **chenrt** | 项目整体负责人 + 产品经理 | Orchestrator / 产品 Owner | 产品方向、需求拆解、原型设计、模块排期、Agent 调度、最终合并决策、对外汇报 |
| **guixm** | 高级运维总监 | 业务架构师 / 需求共创者 | 业务战略方向、重大需求决策、与 chenrt 共同拆解需求形成文档/原型、原型评审 |
| **zhaohy** | 运维业务经理 | 业务需求提出方 / 验收者 | 一线运维场景输入、痛点描述、业务逻辑验收、确认功能是否解决实际问题 |
| **zhangwq** | SRE 工程师 | Vibe Coding 执行者 / 工程质量 Owner | 实际调用 AI Agent 生成代码、代码 Review、测试补充、提交前验证、技术规范维护 |

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

### 5.1 流程

```
zhaohy 提出运维场景/痛点
        │
        ▼
chenrt 收集并初步梳理 → 形成需求草稿
        │
        ▼
chenrt + guixm 需求拆解会
   - 判断业务价值
   - 明确 MVP 范围
   - 确定优先级
        │
        ▼
chenrt 输出/更新：
   - docs/02-product-requirements/01_User_Stories.md
   - docs/02-product-requirements/02_Product_Roadmap.md
   - docs/02-product-requirements/Modules/Module_XX_*.md 需求框架
        │
        ▼
（如需可视化）chenrt 调用 prototype-designer 产出可点击原型
        │
        ▼
guixm + zhaohy 原型评审会
   - guixm：战略/管理视角
   - zhaohy：一线操作视角
        │
        ▼
评审通过后，chenrt 更新 Module 详细需求
        │
        ▼
zhangwq 参与技术方案预评审
   - 补充 API 标准、数据模型、技术约束
```

### 5.2 关键约定

- 任何进入开发队列的需求，必须落在某个 `Modules/Module_XX_*.md` 中。
- 原型分支 `feature/prototype-*` **不合并到 `develop`**，避免污染正式开发主线。
- 原型分支需**推送到远程仓库（GitHub）**，团队成员可通过 `git fetch` 拉取查看，chenrt 负责管理远程仓库权限。
- 原型中的优秀设计需通过正式模块分支（`feature/module-XX-<功能名>`）重新实现后，按标准流程合并到 `develop`。
- 推荐将原型部署到 GitHub Pages 等静态站点，方便 guixm、zhaohy 等非工程人员在线预览。
- 需求变更需 chenrt 确认；涉及业务方向调整需 guixm 同意。
- zhaohy 的需求输入应尽量使用"用户故事"格式：作为【角色】，我希望【功能】，以便于【价值】。

---

## 6. 代码编写与提交环节

### 6.1 流程

```
chenrt 根据 Module 文档，调用 planner 输出模块任务规划
        │
        ▼
明确 feature/module-XX-<功能名> 分支
        │
        ▼
zhangwq 接手，按 SOP 调用 AI Agent：
   - backend-developer / frontend-developer
   - 必要时调用 prometheus-developer / build-resolver
        │
        ▼
AI 生成代码并提交到 feature 分支
        │
        ▼
zhangwq 人工 Review：
   - 安全（SSRF、SQL 注入、配置下发风险）
   - 边界处理、错误处理
   - 可维护性、命名规范
   - 是否符合 API Standard / 模块需求
        │
        ▼
zhangwq 执行提交前验证：
   - go test ./platform/...
   - go vet ./platform/...
   - pnpm test
   - pnpm lint
   - 启动服务验证关键接口/页面
        │
        ▼
zhangwq 向 chenrt 提交合并申请
        │
        ▼
chenrt 最终审批并执行 --no-ff 合并到 develop
        │
        ▼
在 develop 环境中再次验证
```

### 6.2 zhangwq 在 Vibe Coding 中的关键动作

1. **Prompt 设计**：把 Module 文档和工程标准转化为 AI 能执行的 prompt。
2. **过程监督**：确保 AI 在正确的 worktree、正确的分支、正确的范围内开发。
3. **结果校验**：AI 输出后必须人工 Review，不盲目信任。
4. **测试补强**：AI 写 happy path，SRE 补异常路径和集成场景。
5. **质量兜底**：提交前验证清单的最终执行人。

### 6.3 分支与合并规则

- 每个功能子模块对应一个 `feature/module-XX-<功能名>` 分支。
- 原型使用 `feature/prototype-*` 分支，**不合并到 `develop`**，但需推送到远程仓库供团队查看。
- 只有 chenrt 有权将 feature 分支 `--no-ff` 合并到 `develop`。
- 合并前必须完成：zhangwq Review 通过 + 提交前验证通过。

---

## 7. 文档 Ownership

| 文档/目录 | 主负责人 | 协作人 | 更新时机 |
|----------|---------|--------|----------|
| `00_Product_Vision.md` | chenrt | guixm | 产品定位调整 |
| `01_User_Stories.md` | chenrt | zhaohy | 需求新增/变更 |
| `02_Product_Roadmap.md` | chenrt | guixm | 里程碑调整 |
| `03_Functional_Architecture.md` | chenrt | zhangwq | 功能架构调整 |
| `04_Implementation_Map.md` | chenrt | zhangwq | 技术方案调整 |
| `Modules/Module_XX_*.md` | chenrt | zhangwq（技术约束） | 模块需求细化 |
| `05_Code_Implementation_Plan.md` | chenrt | zhangwq | 实施计划调整 |
| `00_Engineering_Standard.md` | zhangwq | chenrt | 工程规范调整 |
| `01_Code_Isolation_Standard.md` | zhangwq | chenrt | 代码隔离规则调整 |
| `02_Frontend_Standard.md` | zhangwq | chenrt | 前端规范调整 |
| `03_API_Standard.md` | zhangwq | chenrt | API 规范调整 |
| `04_Testing_Standard.md` | zhangwq | chenrt | 测试规范调整 |
| `05_AI_Agent_Collaboration_Standard.md` | zhangwq | chenrt | Agent 协作方式调整 |
| `06_Gitflow_Branch_and_Rollback_Guide.md` | zhangwq | chenrt | 分支策略调整 |
| `.kimi/agents/` | zhangwq | chenrt | Agent 定义优化 |
| `04-execution-records/` | zhangwq / AI Agent | chenrt | 每次开发后 |
| `05-team-collaboration/` | chenrt | 全员 | 协作规范调整 |

---

## 8. 决策权限矩阵

| 决策事项 | 最终决策人 | 必须征询 | 备注 |
|----------|-----------|----------|------|
| 产品方向 / 愿景 | chenrt | guixm | 需对齐公司运维战略 |
| MVP 范围变更 | chenrt | guixm、zhaohy | 需同步更新 Roadmap |
| 需求优先级调整 | chenrt | guixm、zhaohy | 影响开发顺序 |
| 新增/删除模块 | chenrt | guixm、zhangwq | 需更新功能架构 |
| 技术选型变更 | chenrt | zhangwq | 需更新 Implementation Map |
| API 路径/响应格式变更 | zhangwq | chenrt | 需更新 API Standard |
| 分支合并到 develop | chenrt | zhangwq（Review 通过） | 必须完成提交前验证 |
| 原型方向/汇报内容 | chenrt | guixm、zhaohy | 原型分支不合并 |
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

- `go test ./platform/...` 通过
- `go vet ./platform/...` 通过
- `pnpm test` 通过
- `pnpm lint` 通过
- 后端服务启动，关键接口返回 200
- 前端 dev server 启动，页面返回 200

### 10.2 人类验收（必须）

- **zhangwq**：代码 Review、安全、可运维性、测试完整性
- **chenrt**：产品符合度、架构一致性、合并决策
- **zhaohy**：业务场景正确性、是否解决一线问题
- **guixm**：管理价值与战略方向

---

## 11. 禁止事项

1. **禁止私自修改 Agent 定义**（`.kimi/agents/`）。
2. **禁止在未经批准的情况下切换 AI 模型或工具**。
3. **禁止绕过提交前验证直接申请合并**。
4. **禁止在 feature 分支混入其他模块改动**。
5. **禁止直接修改 `upstream/` 源码**；必须走 patch 流程。
6. **禁止将原型分支合并到 `develop`**（原型可推送远程供查看，但需通过正式模块分支重新实现后合并）。
7. **禁止未经 chenrt 批准直接合并到 `develop`**。

---

## 12. 守则修订

本守则由 chenrt 主责维护。如需修订：

1. 由相关成员提出建议
2. chenrt 组织讨论
3. 修订后同步全员
4. 更新本守则版本号和更新日期

---

## 13. 相关文档

- [`../02-product-requirements/README.md`](../02-product-requirements/README.md) — PRD 目录说明
- [`../03-engineering-standards/05_AI_Agent_Collaboration_Standard.md`](../03-engineering-standards/05_AI_Agent_Collaboration_Standard.md) — AI Agent 协作细则
- [`../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南
- [`../../.kimi/AGENTS.md`](../../.kimi/AGENTS.md) — Agent 团队速查
