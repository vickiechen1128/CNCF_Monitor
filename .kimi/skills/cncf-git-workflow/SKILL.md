---
name: cncf-git-workflow
description: "MetricCenter Gitflow、双空间隔离、分支命名、目录写权限、提交单元与 commit message 规范，适用于所有需要分支/提交操作的 Agent"
---

# CNCF_Monitor Git 工作流与目录隔离规范

本 Skill 定义 MetricCenter 统一的 Gitflow、双空间隔离、分支命名、目录权限和提交规范。**所有 Developer、Build Resolver、Git Guardian 在执行任务前必须先读取本 Skill；Reviewer 只读，不执行分支操作。**

---

## 1. 双文件夹隔离（设计空间 + 开发空间）

```text
设计空间（PRD / 原型）：/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree
开发空间（生产代码）  ：/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature
```

| 空间 | 固定分支 | 工作内容 | 主要角色 |
|------|----------|----------|----------|
| 设计空间 | `design/module-mvp-demo` | PRD、原型、设计决策 | prototype-designer / chenrt |
| 开发空间 | `develop` + `feat/module-XX` | 生产代码实现 | backend / frontend / prometheus / build-resolver |

- 两个目录是物理隔离的独立 checkout，一个目录的分支操作不会影响另一个。
- 开发空间默认**串行**推进：一个时间只开一个 `feat/module-XX`。
- 零耦合任务确需并行时，才在开发空间额外 `git worktree add`，用完即删；命令见 `using-git-worktrees`。

### 1.1 空间检查

```bash
pwd
git branch --show-current
```

- 设计工作：`pwd` 为设计空间，分支为 `design/module-mvp-demo`。
- 开发工作：`pwd` 为开发空间，分支为 `feat/module-XX`。
- 不在正确空间 / 分支时，先按本 Skill 切换；无法判断时报告 Orchestrator。
- **增量/修复阶段分支识别（放宽）**：`feature/zwq` 等既有维护分支不强制改名为 `feat/module-XX`。增量/修复任务（任务卡 `mode: incremental`）的分支条件是：开发空间中非 `main` / `develop` / `design/*` / `feature/prototype-*` 的分支即可；新模块开发仍建议按标准命名。

---

## 2. 分支模型

| 分支 | 命名示例 | 用途 | 来源 | 合并目标 | 负责人 |
|------|----------|------|------|----------|--------|
| `main` | `main` | 稳定 / 生产版本 | - | - | chenrt |
| `develop` | `develop` | PRD + 原型 + 已验收代码的 SSOT | `main` | - | chenrt |
| `design/module-mvp-demo` | `design/module-mvp-demo` | PRD + 原型 | `develop` | `develop` | chenrt |
| `feat/module-XX` | `feat/module-07` | 生产代码实现 | `develop` | `develop` | zhangwq |
| `fix/module-XX` | `fix/module-07` | 缺陷修复 | `develop` | `develop` | zhangwq |
| `feature/prototype-*` | `feature/prototype-mvp-demo` | 历史兼容原型分支 | `develop` | **不合并** | chenrt |
| `release/*` | `release/v0.1.0` | 版本发布 | `develop` | `main` + `develop` | chenrt |
| `hotfix/*` | `hotfix/v0.1.1` | 生产紧急修复 | `main` | `main` + `develop` | zhangwq |

### 2.1 创建 / 切换分支

```bash
# 设计分支
git checkout develop && git pull origin develop
git checkout -b design/module-mvp-demo

# 功能分支（确认 design/module-mvp-demo 已合并到 develop）
git checkout develop && git pull origin develop
git checkout -b feat/module-XX
```

---

## 3. 目录与写权限

| 目录 | 允许写入 | 禁止写入 |
|------|----------|----------|
| `docs/02-product-requirements/` | prototype-designer / chenrt | developer、reviewer、build-resolver、prometheus-developer |
| `docs/prototypes/` | prototype-designer / chenrt | developer、reviewer、build-resolver、prometheus-developer |
| `docs/05-execution-records/` | 各 Agent 写自己的执行记录；Orchestrator 协调写入 | 覆盖其他 Agent 的记录 |
| `platform/` | backend-developer、prometheus-developer | frontend-developer、prototype-designer、reviewer |
| `patches/prometheus/` | prometheus-developer；backend-developer 仅在任务明确要求时 | frontend-developer、prototype-designer |
| `ui-custom/web/` | frontend-developer | backend-developer、prometheus-developer、prototype-designer |
| `upstream/` | 仅 patch 流程中的最小化修改 | 直接新增业务代码 / 直接提交 |
| `docs/03-engineering-standards/`、`docs/01-team-collaboration/`、`.kimi/agents/`、`.kimi/skills/` | 项目负责人 + 开发工程师按需维护 | 借任务之便夹带无关改动 |
| `scripts/`、`Makefile` | 任务明确要求时，需 Orchestrator 同意 | 借机改构建 / CI 基础设施 |

- Reviewer 全部只读，不写入任何目录。
- `upstream/` 必须通过 `patches/prometheus/*.patch` 管理；patch 规则见 `prometheus-architecture`。

---

## 4. Commit Message 规范

### 4.1 格式

```text
<type>(<scope>): <简短描述>

- 详细说明 1
- 详细说明 2

关联: docs/05-execution-records/module-XX/<agent>.md
```

| 分支类型 | Commit 类型 | 示例 |
|----------|-------------|------|
| `design/module-mvp-demo` | `design(module-XX): ...` | `design(module-07): 添加资源管理 PRD 与原型` |
| `feat/module-XX` | `feat(module-XX): ...` | `feat(module-07): 实现资源管理 CRUD 与 Excel 导入` |
| `fix/module-XX` | `fix(module-XX): ...` | `fix(module-07): 修复资源列表查询参数校验` |
| `release/*` | `release: ...` | `release: bump version to v0.1.0` |
| `hotfix/*` | `hotfix: ...` | `hotfix: 修复生产环境 health 接口异常` |

### 4.2 强制要求

- 全部小写，禁止 emoji，禁止 `update`、`fix bug` 等无意义描述。
- `feat` / `fix` 提交必须在标题或正文携带 task id（如 `T07-05`、`T07-05~07`、`T07-F3~F4`）。
- `feat` / `fix` 提交必须关联 `docs/05-execution-records/module-XX/<agent>.md`，且该文件中存在对应 task id 条目。
- `design` 提交建议说明 PRD / 原型路径、迭代轮次与 PRD 版本（如「第十一轮需求对齐，PRD v1.11」）。
- 修改 PRD 的提交必须同步更新 PRD 修订表：新增一行、版本 +1、**不改写已冻结行**。
- 模块 PRD 处于冻结期（修订表最新状态为「已冻结」）时，禁止在 design 分支提交该模块的 PRD / 原型版本变更；构思写入 `design-decisions.md`「下一轮迭代待办」，不 commit / 不 push / 不发新 PR。
- PRD 版本递增后，必须同步更新 `docs/02-product-requirements/Modules/README.md` 版本对齐表对应行。

---

## 5. 提交单元与拆分

**提交单元 = 一个可回退、可验证、可审查的功能闭环。** 详细规则见 `dev-delivery` §3。

- 后端：接口闭环（如 CRUD 可用、导入闭环可用），禁止「模型加了字段但接口没用上」。
- 前端：页面功能块（如列表 + 表单抽屉可用），禁止「列表页 UI 有了但 API 没接」。
- 默认 1 个 micro-task ≈ 1 个 commit；相邻 + 同功能块 + 单独提交会留下半成品的任务可合并。
- 禁止跨功能块、跨模块、多个任务堆积到最后一次性提交。
- 单一 commit 超过约 10 个文件且无法用一句话概括时，Git Guardian 应阻断并要求拆分。

---

## 6. 关键禁止项

1. 禁止在 `main` / `develop` 上直接提交。
2. 禁止 `feat/module-XX` 直接合入 `main`。
3. 禁止在当前分支修改不允许的目录。
4. 禁止在 `feat/module-XX` 混入其他模块改动。
5. 禁止直接修改 `upstream/prometheus/` 源码；必须通过 patch。
6. 禁止覆盖其他 Agent 的执行记录。
7. 禁止在冻结期提交已冻结模块的 PRD / 原型版本变更。

---

## 7. 常用命令

```bash
git branch --show-current
git status --short
git diff --stat
git log --oneline -5

git checkout develop && git pull origin develop
git checkout -b feat/module-XX

git add <files>
git commit -m "feat(module-07): ...（T07-05~07）"
```

---

## 8. 与其他 Skill 的关系

- `cncf-project`：项目背景、技术栈、常用命令
- `cncf-git-workflow`：**本文件**，空间 / 分支 / 目录 / commit
- `dev-delivery`：启动、任务粒度、提交单元、验证、执行记录与汇报
- `using-git-worktrees`：并行开发时的 worktree 命令
- `prometheus-architecture`：upstream patch 规范
