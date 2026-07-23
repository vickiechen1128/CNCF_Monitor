# Gitflow 分支策略与回退指南

> 文档类型：工程标准  
> 目标读者：zhangwq（Vibe Coding 执行者）、chenrt（Orchestrator / 合并审批人）  
> 依赖文档：[05_AI_Agent_Collaboration_Standard.md](05_AI_Agent_Collaboration_Standard.md)、[05_Code_Implementation_Plan.md](../02-product-requirements/05_Code_Implementation_Plan.md)  
> 更新日期：2026-07-22

---

## 1. 设计目标

1. **按功能模块隔离开发**：每个功能子模块一个 feature 分支，避免不同模块代码混杂。
2. **随时可回退**：模块不满意时，可放弃整个 feature 分支；已合并到 `develop` 后，可通过 revert 撤销。
3. **保留历史可追溯**：每次 Agent 团队的执行记录与 commit 关联，能回溯到任意版本。
4. **单人开发友好**：固定单一 worktree，通过切换分支完成不同模块，避免目录堆积。

---

## 2. 分支模型

本项目采用 **Gitflow + 单一 worktree + 按功能子模块拆分 feature 分支**。

### 2.1 分支约定

| 分支类型 | 命名示例 | 用途 | 来源 | 合并目标 | 合并权限 |
|----------|----------|------|------|----------|----------|
| `main` | `main` | 稳定/生产版本 | - | - | - |
| `develop` | `develop` | 集成/开发主线 | `main` | - | - |
| `feature/module-XX-<功能名>` | `feature/module-00-infrastructure` | 单个功能子模块开发 | `develop` | `develop` | 仅 chenrt |
| `feature/prototype-<名称>` | `feature/prototype-mvp-demo` | 可点击原型 | `develop` | **不合并** | - |
| `release/*` | `release/v0.1.0` | 版本发布 | `develop` | `main` + `develop` | 仅 chenrt |
| `hotfix/*` | `hotfix/v0.1.1` | 生产紧急修复 | `main` | `main` + `develop` | 仅 chenrt |

> **重要**：只有 chenrt 有权将 `feature/release/hotfix` 分支合并到 `develop` 或 `main`，且必须使用 `--no-ff`。zhangwq 完成开发后需提交合并申请，禁止自行合并。

### 2.2 原型分支特殊规则

- 原型分支命名固定为 `feature/prototype-<名称>`。
- **严禁合并到 `develop`**，避免污染正式开发主线。
- 必须推送到远程仓库 `origin/feature/prototype-<名称>`，供团队成员通过 `git fetch` 查看。
- 推荐部署到 GitHub Pages，方便 guixm、zhaohy 等非工程人员在线预览。
- 原型中的有效设计必须通过正式模块分支（`feature/module-XX-<功能名>`）重新实现后，按标准流程合并到 `develop`。

### 2.3 模块分支列表

| 模块编号 | 分支名 | 对应 Phase | 说明 |
|----------|--------|------------|------|
| Module 00 | `feature/module-00-infrastructure` | Phase 0 | 基础设施与数据模型 |
| Module 07a | `feature/module-07-resource-management` | Phase 1 | 资源管理 + Excel 导入 |
| Module 07b | `feature/module-07-label-template` | Phase 2 | 标签模板 |
| Module 07c | `feature/module-07-scrape-job` | Phase 2 | 采集 Job |
| Module 07d | `feature/module-07-probe-config` | Phase 2 | 拨测配置 |
| Module 07e | `feature/module-07-config-generator` | Phase 3 | 配置生成与下发 |
| Module 01 | `feature/module-01-collection-status` | Phase 4 | 采集状态与诊断 |
| Module 02 | `feature/module-02-query-center` | Phase 5 | 指标查询中心 |
| Module 08 | `feature/module-08-alerting` | Phase 6 | 告警状态查看 |
| Module 05 | `feature/module-05-portal` | Phase 7 | 前端门户集成 |

> 每个模块开发前，从最新 `develop` 切出对应 feature 分支；模块完成后，由 chenrt 以 `--no-ff` 合并回 `develop`。

---

## 3. 工作目录与 worktree 约定

- **主仓库**：`/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor`
- **固定 worktree**：`/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree`
- **规则**：所有 Agent 开发在固定 worktree 内进行，通过 `git checkout` 切换 feature 分支，不创建新 worktree。

### 3.1 worktree 初始化（一次性）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git worktree add "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree" develop
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
```

### 3.2 验证当前在 worktree 内

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"

# 确认当前目录是 worktree
git rev-parse --git-dir
# 输出应包含 .git/worktrees/

# 确认当前分支
git branch --show-current
```

### 3.3 开始新模块

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git fetch origin
git checkout -b feature/module-XX-<功能名> origin/develop
```

### 3.4 切换已有模块

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout feature/module-XX-<功能名>
```

### 3.5 多模块切换（stash 方式）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"

# 保存当前工作区
git stash push -m "WIP: module-XX-xxx"

# 切换到其他模块
git checkout feature/module-YY-<功能名>

# 处理完切回来
git checkout feature/module-XX-<功能名>
git stash pop
```

---

## 4. 回退机制

### 4.1 模块开发中不满意：丢弃当前 feature 分支

如果 Agent 团队当前模块的代码不符合要求，且尚未合并到 `develop`，最简单的方式是删除该 feature 分支并重建。

```bash
# 1. 切回 develop，确保 worktree 不处于要删除的分支上
cd "../CNCF_Monitor-worktree"
git checkout develop

# 2. 删除不满意的 feature 分支（本地）
git branch -D feature/module-XX-<功能名>

# 3. 从 develop 最新状态重建分支
git checkout -b feature/module-XX-<功能名> origin/develop
```

> 此操作会丢失该分支上的所有 commit，但 `develop` 完全不受影响。适合模块尚未合并、且改动整体不可接受的情况。

### 4.2 模块已合并到 develop：revert 整个模块

如果模块已合并到 `develop`，才发现不符合要求，可以通过 revert 合并提交来撤销整个模块的改动。

```bash
# 1. 找到模块合并到 develop 的 merge commit
cd "../CNCF_Monitor"
git checkout develop
git log --oneline --merges

# 2. 对 merge commit 做 revert（保留历史，撤销变更）
# 假设 merge commit 为 abc1234，且 develop 是当前主线
git revert -m 1 abc1234
```

> `-m 1` 表示保留 merge commit 的第一个父提交（即 `develop` 方向）作为主线。

### 4.3 只想回退到模块内某个历史版本

如果模块内部分提交有问题，可以回退到该模块的某个指定 commit。

```bash
# 查看模块分支历史
cd "../CNCF_Monitor-worktree"
git log --oneline feature/module-XX-<功能名>

# 强制回退到指定 commit（会丢弃该 commit 之后的所有提交）
git checkout feature/module-XX-<功能名>
git reset --hard <commit-hash>
```

> 使用 `--hard` 会丢失工作区修改，执行前请确认。若想保留历史，可改用 `git revert <commit-hash>` 反向提交。

### 4.4 develop 被污染：从 main 重置 develop

如果 `develop` 被多次错误合并严重污染，且尚未发布到 `main`，可以从 `main` 重建 `develop`。

```bash
cd "../CNCF_Monitor"
git checkout develop
git reset --hard origin/main
```

> 此操作会丢失 `develop` 上所有未合并到 `main` 的改动，仅在极端情况下使用。

---

## 5. 合并审批规则

### 5.1 合并条件

feature 分支合并到 `develop` 必须同时满足：

1. zhangwq 完成代码 Review 并确认通过
2. 提交前验证全部通过（`go test` / `go vet` / `pnpm test` / `pnpm lint` / 服务启动）
3. 变更范围符合 Module 文档，未混入其他模块改动
4. commit message 符合规范，并关联执行记录
5. zhangwq 已向 chenrt 提交合并申请

### 5.2 合并权限

- **唯一合并人**：chenrt
- **合并方式**：`git merge --no-ff feature/module-XX-<功能名>`
- **合并地点**：在主仓库 `CNCF_Monitor` 中执行
- **合并后**：必须再次在 develop 环境执行提交前验证

### 5.3 合并申请内容

zhangwq 提交的合并申请应包含：

```markdown
## 合并申请

**分支**：feature/module-XX-<功能名>
**来源 Module**：docs/02-product-requirements/Modules/Module_XX_*.md
**变更范围**：列出新增/修改文件
**测试结果**：go test / go vet / pnpm test / pnpm lint 结果
**服务验证**：后端/前端服务启动验证结果
**Review 结论**：自查通过 / 问题已修复
**风险点**：XXX
**建议下一步**：合并到 develop
```

详细模板见 [`../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

---

## 6. 与 Agent 团队的协作流程

### 6.1 标准流程

```
chenrt（Orchestrator）
    │
    ├──► 调用 planner 输出模块任务规划
    │         │
    │         ▼
    │    明确当前模块分支：feature/module-XX-<功能名>
    │
    └──► 向 zhangwq 下达开发任务单
              │
              ▼
    zhangwq（Vibe Coding 执行者）
              │
              ├──► 复用单一 git worktree
              │         │
              │         ▼
              │    在 worktree 内切换到当前模块 feature 分支
              │
              ├──► 调用 backend-developer 在 worktree 中 TDD 开发
              │         │
              │         ▼
              │    完成后提交到 feature/module-XX-<功能名>
              │
              ├──► 调用 golang-reviewer 审查
              │         │
              │         ▼
              │    如 REQUEST_CHANGES，返回 backend-developer 修复
              │
              ├──► 调用 frontend-developer 开发前端页面（可并行）
              │         │
              │         ▼
              │    完成后提交到 feature/module-XX-<功能名>
              │
              ├──► 调用 frontend-reviewer 审查
              │
              ├──► 在 worktree 中验证运行状态
              │         │
              │         ▼
              │    后端：go test/vet + 启动服务验证接口
              │    前端：pnpm test/lint + 启动 dev server 验证页面
              │
              ├──► 向 chenrt 提交合并申请
              │
              └──► 等待 chenrt 审批
                            │
                            ▼
    chenrt（合并审批人）
              │
              ├──► 审查合并申请与变更范围
              │
              ├──► 将 feature/module-XX-<功能名> 以 --no-ff 合并到 develop
              │         │
              │         ▼
              │    在主仓库 CNCF_Monitor 中执行合并
              │
              └──► 在 develop 环境中再次验证运行状态
                            │
                            ▼
              如验证失败，回退或修复；如通过，继续下一模块

    worktree 保留，切换到下一个模块分支继续复用
```

> zhangwq 的具体执行细节、prompt 模板、Review 清单、提交前验证清单见 [`../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

### 6.2 Commit 规范

每次 commit 必须能对应到某个 Agent 的一次执行记录：

```
<模块>: <动作> - <简短描述>

- 关联执行记录: docs/04-execution-records/module-XX-<功能名>/<agent>.md
- 变更范围: platform/xxx, ui-custom/web/xxx
```

示例：

```
module-00-infrastructure: 统一 API 响应格式为 status/data/error/errorType

- 关联执行记录: docs/04-execution-records/module-00-infrastructure/backend-developer.md
- 变更范围: platform/api/response/response.go, platform/cmd/metric-center/main.go
```

### 6.3 执行记录目录结构

```
docs/04-execution-records/
├── module-00-infrastructure/
│   ├── README.md
│   ├── planner.md
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   └── golang-reviewer.md
├── module-07-resource-management/
│   └── ...
└── module-07-label-template/
    └── ...
```

每个模块的 `README.md` 记录目标、参与 Agent、关键决策、主要变更文件、验证结果和状态。

---

## 7. 常见问题

### Q1: Agent 在当前模块改了一半，想临时切换到另一个模块怎么办？

见 [3.5 多模块切换（stash 方式）](#35-多模块切换stash-方式)。

### Q2: 如何确认某个模块是否已合并到 develop？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git branch --merged develop | grep feature/module-XX-<功能名>
```

### Q3: 想比较当前模块分支和 develop 的差异？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git diff develop..feature/module-XX-<功能名>
```

### Q4: 发现当前 feature 分支改动混乱，如何放弃重来？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"

# 1. 切回 develop（确保不在要删除的分支上）
git checkout develop

# 2. 删除不满意的 feature 分支（本地）
git branch -D feature/module-XX-<功能名>

# 3. 从 develop 最新状态重建分支
git checkout -b feature/module-XX-<功能名> origin/develop
```

> 此操作会丢失该分支上的所有 commit，但 `develop` 完全不受影响。适合模块尚未合并、且改动整体不可接受的情况。

---

## 8. 禁止事项

1. **严禁 feature 分支直接合入 `main`**。
2. **严禁在 feature 分支上混入其他模块改动**。
3. **严禁将原型分支 `feature/prototype-*` 合并到 `develop`**。
4. **严禁在 worktree 外直接开发并提交**（避免主仓库与 worktree 状态混乱）。
5. **严禁 zhangwq 未经 chenrt 批准自行合并到 `develop`**。
6. **严禁修改 `.git/worktrees/` 元数据**（除非明确知道如何修复）。

---

## 9. 相关文档

- [`../05-team-collaboration/00_Team_Charter.md`](../05-team-collaboration/00_Team_Charter.md) — 团队守则
- [`../05-team-collaboration/01_Role_Responsibilities.md`](../05-team-collaboration/01_Role_Responsibilities.md) — 角色职责速查表
- [`../05-team-collaboration/03_Code_Collaboration_Workflow.md`](../05-team-collaboration/03_Code_Collaboration_Workflow.md) — 代码编写与提交环节详细流程
- [`../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../05-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md) — zhangwq Vibe Coding 执行手册
- [`05_AI_Agent_Collaboration_Standard.md`](05_AI_Agent_Collaboration_Standard.md) — AI Agent 协作细则
