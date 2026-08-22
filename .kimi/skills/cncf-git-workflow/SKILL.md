# CNCF_Monitor Git 工作流与目录隔离规范

本 Skill 定义 MetricCenter 项目统一的 Gitflow、worktree 使用、分支命名、目录权限和提交规范。**所有 Developer、Reviewer、Build Resolver 在执行任务前必须先读取本 Skill。**

---

## 1. 双文件夹隔离（设计空间 + 开发空间）

本项目采用 **双文件夹隔离** 协作模型：设计与开发在不同物理目录（两个独立克隆）中互不打扰，共用同一个远程仓库。

```text
设计空间（写 PRD / 改原型）：/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree
开发空间（Vibe Coding）    ：/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature
```

### 1.1 各 Agent 的工作空间归属

| 空间 | 目录 | 固定分支 | 工作内容 |
|------|------|----------|----------|
| 设计空间 | `CNCF_Monitor-worktree` | `design/module-mvp-demo` | 写 PRD、改原型 → 合入 develop |
| 开发空间 | `CNCF_Monitor-feature` | `develop` + `feat/*` | 拉功能分支做 Vibe Coding |

- **prototype-designer / chenrt（需求侧）**：在设计空间 `CNCF_Monitor-worktree` 工作，固定分支 `design/module-mvp-demo`。
- **Developer / Reviewer / Build Resolver 等开发侧 Agent**：在开发空间 `CNCF_Monitor-feature` 工作，从 `develop` 创建/切换 `feat/module-XX` 分支。

### 1.2 检查当前是否在正确的空间中

```bash
pwd
git branch --show-current
```

- 设计工作（PRD / 原型）：确认 `pwd` 为设计空间，且当前分支为 `design/module-mvp-demo`。
- 开发工作（Vibe Coding）：确认 `pwd` 为开发空间 `CNCF_Monitor-feature`，且已在 `feat/module-XX` 分支。

> 两个克隆为物理隔离的独立 checkout，一个目录内的 checkout / 分支操作不会影响另一个。

---

## 2. 分支模型

| 分支类型 | 命名示例 | 用途 | 来源 | 合并目标 | 负责人 |
|----------|----------|------|------|----------|--------|
| `main` | `main` | 稳定/生产版本 | - | - | chenrt |
| `develop` | `develop` | PRD + 原型 + 已验收代码的 SSOT | `main` | - | chenrt |
| `design/module-mvp-demo` | `design/module-mvp-demo` | PRD + AI 生成的原型代码 | `develop` | `develop` | chenrt |
| `feat/module-XX` | `feat/module-07` | 生产代码实现 | `develop` | `develop` | zhangwq |
| `feature/prototype-*` | `feature/prototype-mvp-demo` | 历史兼容原型分支 | `develop` | **不合并** | chenrt |
| `release/*` | `release/v0.1.0` | 版本发布 | `develop` | `main` + `develop` | chenrt |
| `hotfix/*` | `hotfix/v0.1.1` | 生产紧急修复 | `main` | `main` + `develop` | zhangwq |

### 2.1 切换/创建分支

设计阶段：

```bash
git checkout develop
git pull origin develop
git checkout -b design/module-mvp-demo
```

开发阶段（确认 `design/module-mvp-demo` 已合并到 develop 且 PRD + 原型已冻结）：

```bash
git checkout develop
git pull origin develop
git checkout -b feat/module-XX
```

---

## 3. 目录隔离铁律

| 目录 | 允许修改者 | 禁止修改者 |
|------|-----------|-----------|
| `docs/02-product-requirements/` | `prototype-designer` / chenrt 的 AI | `backend-developer`、`frontend-developer`、zhangwq 的 AI |
| `docs/prototypes/` | `prototype-designer` / chenrt 的 AI | `backend-developer`、`frontend-developer`、zhangwq 的 AI |
| `platform/` | `backend-developer`、`frontend-developer`、zhangwq 的 AI | `prototype-designer`、chenrt 的 AI |
| `ui-custom/web/` | `backend-developer`、`frontend-developer`、zhangwq 的 AI | `prototype-designer`、chenrt 的 AI |
| `upstream/` | 禁止直接修改 | 全部 Agent |
| `docs/03-engineering-standards/` | 项目负责人 + 开发工程师按需维护 | - |
| `docs/01-team-collaboration/` | 项目负责人 + 开发工程师按需维护 | - |
| `.kimi/agents/` | 项目负责人 + 开发工程师按需维护 | - |

---

## 4. Commit Message 规范

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

- 全部小写，禁止 emoji
- `feat` / `fix` 提交必须关联执行记录

---

## 5. 关键禁止项

1. 禁止在 `main` 或 `develop` 上直接提交
2. 禁止 `feat/module-XX` 直接合入 `main`
3. 禁止在当前分支修改不允许的目录
4. 禁止在 `feat/module-XX` 分支混入其他模块改动
5. 禁止直接修改 `upstream/prometheus/` 源码；必须生成 patch 到 `patches/prometheus/`

---

## 6. 常用命令速查

```bash
# 当前分支
git branch --show-current

# 查看变更
git status --short
git diff --stat

# 最近提交
git log --oneline -5

# 创建并切换设计分支
git checkout develop && git pull origin develop
git checkout -b design/module-mvp-demo

# 创建并切换功能分支
git checkout develop && git pull origin develop
git checkout -b feat/module-XX
```

---

## 7. 与其他 Skill 的关系

- `cncf-project`：项目背景、技术栈、常用命令
- `cncf-git-workflow`：**本文件**，Git 工作流与目录隔离
- `using-git-worktrees`：通用 git worktree 命令参考；本项目开发侧以「双文件夹隔离」的单一开发克隆为主，串行推进模块；如需**并行**推进多个模块，可在开发空间额外 `git worktree add` 多目录，参考 `using-git-worktrees` 的使用协议
