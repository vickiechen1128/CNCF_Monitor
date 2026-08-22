# MetricCenter Vibe Coding 执行手册

> 文档类型：团队协作规范
> **目标读者**：SRE 工程师 / Vibe Coding 执行者 / 工程质量 Owner ——**人视角的执行 SOP**
> 更新日期：2026-08-12（v1.25 重构：Prompt 模板 / 验证清单 / Commit 规范的权威定义在 .kimi/agents/ 与工程标准，本手册只保留 zhangwq 的人视角操作）

***

## 1. 目标

本手册是 开发工程师 在 MetricCenter 项目中使用 AI Agent 进行 Vibe Coding 的**执行层 SOP**，聚焦于**人**要做的动作：

- 如何把 Module 文档转化为任务卡并调用 Agent
- 如何监督 AI 在正确范围、正确分支、正确空间（开发空间 `CNCF_Monitor-feature`）内开发
- 如何对 AI 输出进行人工 Review 与测试补强
- 如何执行提交前验证并产出合并申请

> AI Agent 是生产工具，不是责任主体。**最终代码质量、安全性和可运维性由 zhangwq 和 chenrt 共同负责。**

> **v1.25 关键变化**：Agent 已改为**任务卡驱动**——任务卡格式（输入路径+章节 / 输出 / 验收 / 不修改范围）见 `.kimi/agents/orchestrator.md`；Agent 只读任务卡指定的输入，无需读团队手册。因此本手册不再提供 Prompt 模板（过去 4.2/4.3/4.4 的模板已废弃）。

***

## 2. 工作流总览

```
接收 chenrt 任务单
        │
        ▼
准备：开发空间、feat 分支、必读文档
        │
        ▼
设计任务卡（输入路径+章节 / 输出 / 验收 / 不修改范围）
        │
        ▼
调用 Agent 生成代码（backend / frontend / prometheus / build-resolver）
        │
        ▼
人工 Review（安全 / 正确性 / 可维护性 / 可测试性 / 可运维性）
        │
        ▼
补充异常路径与集成测试
        │
        ▼
提交前验证（命令见 docs/03-engineering-standards/04_Testing_Standard.md §4）
        │
        ▼
提交代码 + 创建执行记录
        │
        ▼
向 chenrt 提交合并申请
```

***

## 3. 开发前检查清单

### 3.1 环境检查

| 检查项            | 命令                                  | 期望结果                 |
| -------------- | ----------------------------------- | -------------------- |
| 在开发空间 `CNCF_Monitor-feature` | `pwd`                           | `/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature` |
| 在正确 feat 分支    | `git branch --show-current`         | `feat/module-XX`     |
| 分支基于最新 develop | `git log --oneline -1`              | 与 origin/develop 同步  |
| 后端环境           | `go version`                        | 与 `go.mod` 一致        |
| 前端环境           | `pnpm --version` / `node --version` | 符合项目要求               |

### 3.2 文档准备

调用 Agent 前，确认以下输入已就绪并在**任务卡**中指定：

| 文档                                                       | 用途                      |
| -------------------------------------------------------- | ----------------------- |
| `docs/02-product-requirements/Modules/Module_XX_*.md`    | 需求、业务规则、验收标准（任务卡指定章节）   |
| `docs/prototypes/module-XX/`                             | 可点击原型，UI 流程与交互参考        |
| `docs/05-execution-records/module-XX/task-sequence.yaml` | micro-task 序列（当前任务权威输入） |
| `docs/03-engineering-standards/03_API_Standard.md`       | API 路径、响应格式（如任务涉及 API）  |
| `docs/03-engineering-standards/04_Testing_Standard.md`   | 测试要求、服务验证               |

> 如果文档缺失或不清晰，先找 chenrt 确认，**不要直接让 AI 自行发挥**。

***

## 4. 任务卡设计

> 任务卡是给 Agent 的唯一输入（**不再使用旧的 Prompt 模板**）。四要素：

1. **输入**：精确路径 + 章节（PRD §3/§5/§6/§9 等，按任务给）
2. **输出**：需要新增/修改的文件列表
3. **验收**：测试命令 / lint / 服务启动验证
4. **不修改范围**：如 platform/ 之外、原型目录、PRD

任务卡格式示例见 `.kimi/agents/orchestrator.md`「子 Agent 调用规范」。

***

## 5. Agent 调用速查表

| 任务类型            | 调用 Agent               | 适用场景                         |
| --------------- | ---------------------- | ---------------------------- |
| 模块实现计划          | `planner`              | Module 开发前，输出任务拆分（chenrt 调用） |
| 可点击原型           | `prototype-designer`   | 需求确认前，产出原型（chenrt 调用）        |
| 后端代码开发          | `backend-developer`    | 实现后端 API 与业务逻辑               |
| 前端代码开发          | `frontend-developer`   | 实现前端页面与交互                    |
| Prometheus 扩展分析 | `prometheus-developer` | 分析 Prometheus 源码/扩展点         |
| 构建/测试修复         | `build-resolver`       | 修复编译、测试、依赖问题                 |
| 后端代码审查          | `golang-reviewer`      | Review Go 代码（独立会话）           |
| 前端代码审查          | `frontend-reviewer`    | Review 前端代码（独立会话）            |
| 安全审查            | `security-reviewer`    | 关键变更安全复核                     |

> 每个 Agent 的行为规范（启动协议 / 编码规范 / 验证要求）见 `.kimi/agents/<agent>.md`，随加载生效；调用时只需给任务卡。

***

## 6. 人工 Review 清单

### 6.1 安全性

- [ ] URL 解析是否校验 scheme（仅 `http`/`https`）和 host
- [ ] 是否防范 SSRF
- [ ] 是否防范 SQL 注入 / 路径遍历
- [ ] 文件写入是否校验路径
- [ ] 配置下发是否有权限控制
- [ ] 是否有敏感信息泄露风险（日志、错误信息、配置文件）

### 6.2 正确性

- [ ] 实现是否符合 Module 文档
- [ ] 实现是否符合 `docs/prototypes/module-XX/` 原型表达的业务意图与交互流程
- [ ] API 路径和响应格式是否符合 `03_API_Standard.md`
- [ ] 数据模型是否与 Module 文档一致
- [ ] 错误处理是否完善（错误码、错误信息、降级策略）

### 6.3 可维护性

- [ ] 函数长度是否小于 50 行
- [ ] 文件长度是否小于 800 行
- [ ] 命名是否清晰（函数、变量、类型）
- [ ] 是否有重复代码
- [ ] 是否有过度工程化

### 6.4 可测试性

- [ ] 是否覆盖 happy path
- [ ] 是否覆盖边界情况（空输入、超大值、特殊字符）
- [ ] 是否覆盖错误路径（404、400、校验失败）
- [ ] 是否覆盖并发/集成场景

### 6.5 可运维性

- [ ] 日志是否清晰、可追踪
- [ ] 配置是否外部化
- [ ] 是否有健康检查 / 监控埋点
- [ ] 启动失败时是否有明确错误信息

***

## 7. 测试补强指南

AI 通常擅长 happy path，但容易遗漏异常路径、并发、权限边界、依赖不可用、数据库迁移兼容性、前端加载失败等场景。zhangwq 必须补充：

**后端**：空输入、超大值、特殊字符；404 / 400 / 校验失败 / 500；并发读写；数据库迁移兼容性。
**前端**：空列表状态、加载失败状态、表单校验边界、网络异常处理（超时、重试）。

***

## 8. 提交前验证与提交规范

> **v1.25 去重**：
>
> - 提交前验证命令与通过标准 → `docs/03-engineering-standards/04_Testing_Standard.md` §4（唯一权威）
> - Commit 格式（`feat(module-XX): <动作> - <简短描述>` + 关联执行记录）→ `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md` §3.6（唯一权威）
> - 合并申请模板 → `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` §7.4（唯一权威）
> - 执行记录模板 → 各 Agent 定义「执行记录」章节

***

## 9. 常见问题与处理

### Q1：AI 生成的代码偏离了 Module 文档怎么办？

1. 立即停止当前 Agent 继续生成
2. 指出具体偏离点，给出正确方向
3. 必要时回到 Module 文档与 chenrt 确认
4. 重新设计任务卡后再次调用

### Q2：AI 修改了不该修改的文件怎么办？

1. 检查变更范围：`git status` / `git diff --stat`
2. 如果改动不大，可要求 AI 还原并重新生成
3. 如果改动混乱，考虑丢弃当前分支重建（见 `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`）

### Q3：提交前验证失败，但 AI 已经生成了大量代码怎么办？

1. 先定位失败原因（编译错误、测试失败、lint 错误）
2. 调用 `build-resolver` 修复构建/测试问题
3. 修复后重新执行完整验证清单
4. 不要绕过验证直接提交

### Q4：如何在多个模块之间切换？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
git stash push -m "WIP: module-XX"
git checkout feat/module-YY
# 处理完切回来
git checkout feat/module-XX
git stash pop
```

***

## 10. 禁止事项

1. **禁止绕过提交前验证直接申请合并**。
2. **禁止在 feature 分支混入其他模块改动**。
3. **禁止直接修改** **`upstream/`** **源码**；必须走 patch 流程。
4. **禁止未经 chenrt 批准直接合并到** **`develop`**。
5. **禁止在未经批准的情况下切换 AI 模型或工具**。
6. **禁止让 AI 在开发空间（`CNCF_Monitor-feature`）之外直接开发并提交**。

***

## 11. 相关文档

- [`README.md`](README.md) — 团队协作目录导航（按角色索引）
- [`00_Team_Charter.md`](00_Team_Charter.md) — 团队守则
- [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md) — 角色职责速查表
- [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) — 代码协作总览
- [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) — 团队 Git 操作指南
- `docs/03-engineering-standards/04_Testing_Standard.md` — 测试标准（验证唯一权威）
- `docs/03-engineering-standards/05_AI_Agent_Collaboration_Standard.md` — Agent 协作（Commit 规范 §3.6）
- `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` — 分支策略 / 合并申请模板
- `.kimi/agents/orchestrator.md` — Orchestrator 任务卡驱动

