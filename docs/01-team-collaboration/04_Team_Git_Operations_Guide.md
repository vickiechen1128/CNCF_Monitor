# MetricCenter 团队 Git 操作指南

> 文档类型：团队协作规范  
> **目标读者**：chenrt（设计分支/合并操作）、zhangwq（功能分支/日常开发）、guixm / zhaohy（只读 Review，§7）  
> 更新日期：2026-08-22（v1.28 新增：MVP 阶段设计分支合并为单一 `design/module-mvp-demo` §5；feedback 单随 feat PR 链接 §6.4）

---

## 1. 目标

本指南面向不同角色，说明如何在 MetricCenter 项目中：

- 拉取最新代码与文档
- 创建并切换分支
- 提交变更并发起 Pull Request
- 完成 Review 与合并

> 本指南是 [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) 和 [`../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md) 的操作补充。详细分支策略与回退机制请参考这两份文档。

---

## 2. 按角色流程速查

> **v1.25 去重**：全链路协作流程图（mermaid）的**权威定义在 `.kimi/agents/orchestrator.md`「标准工作流」**；本文件只保留各角色的 git 操作速查。协作流程总览见 [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md)。

### 2.1 关键规则速查表

| 分支 | 来源 | 合并目标 | 负责人 | Reviewer | 产出物 |
|------|------|---------|--------|----------|--------|
| `design/module-mvp-demo` | `develop` | `develop` | chenrt | guixm、zhaohy | PRD + 原型 |
| `feat/module-XX` | `develop` | `develop` | zhangwq | zhangwq、zhaohy、guixm、chenrt | 生产代码 |
| `release/*` | `develop` | `main` + `develop` | chenrt | - | 发布版本 |
| `hotfix/*` | `main` | `main` + `develop` | zhangwq | chenrt | 紧急修复 |

> **所有合并到 `develop` / `main` 的操作必须由 chenrt 在主仓库执行 `--no-ff`。**

### 2.2 版本号速查（v1.27）

仓库内 4 种"版本"分层使用，禁止混用（详见 06 Gitflow §2.5）：

| 层级 | 示例 | 谁维护 | 要点 |
|------|------|--------|------|
| 产品版本（路线图） | MVP / v0.2 / v0.3 / v0.4 / v1.0 | chenrt | 全局唯一，以 Module_00 集成图为准 |
| PRD 修订版本 | v1.0 → v1.1 → … | chenrt（design 分支） | 每轮需求对齐 +1，与 PR 编号对应 |
| 原型版本 | 与 PRD 修订版本一致 | chenrt（design 分支） | 必须与 PRD 修订版本保持一致 |
| 发布 tag | v0.1.0 | chenrt | 仅发布时打在 `main`，开发阶段不启用 |

- 每个模块 PRD 头部必带**修订表**（版本/日期/变更类型/变更内容/影响范围/产品版本影响/状态）。
- **已冻结**版本 = zhangwq 开发与回退的基线；冻结行只增不改，需求变更一律新增行。

---

## 3. 仓库与工作目录约定

| 路径 | 用途 | 谁使用 |
|------|------|--------|
| `/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor` | 主仓库 | chenrt（执行 `--no-ff` 合并） |
| `/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree` | 固定 worktree | zhangwq（日常开发）、chenrt（设计分支） |

> 所有 Agent 开发都在固定 worktree 内进行，通过 `git checkout` 切换分支，不额外创建 worktree。

### 3.1 worktree 初始化与验证

> **v1.25 去重**：worktree 初始化命令与验证方法见 `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` §5（唯一权威）。此处仅提醒：初始化一次即可，日常开发只做 `git checkout` 切换分支。

---

## 4. 通用操作：拉取最新内容

所有成员在本地操作前，先拉取远程最新状态：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout develop
git pull origin develop
```

chenrt 在主仓库合并前也需要拉取：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git pull origin develop
```

---

## 5. chenrt 操作：设计分支（MVP 阶段单一 `design/module-mvp-demo`）

chenrt 负责 PRD + 原型的提交，以及所有分支向 `develop` 的合并。

> **v1.28（单设计分支）**：MVP 阶段**合并为单一 `design/module-mvp-demo` 分支，不再按模块切分**。设计跨模块（如网域跨 M01/M06/M07/M09）时无需切换分支。模块归属靠 **PRD 文件物理隔离**（`Module_XX_*.md` 单文件）+ `docs/02-product-requirements/Modules/README.md` §4 映射表追溯，**追溯能力不依赖分支名**。进入正式多版本阶段后再视需要拆分回 `design/module-XX`。

### 5.1 创建设计分支

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout develop
git pull origin develop
git checkout -b design/module-mvp-demo
```

### 5.2 编写 PRD 与原型

编辑以下两个位置：

- `docs/02-product-requirements/Modules/Module_XX_*.md`
- `docs/prototypes/module-XX/`

### 5.3 提交并推送

```bash
git add docs/02-product-requirements/Modules/Module_XX_*.md
git add docs/prototypes/module-XX/
git commit -m "design(module-XX): 添加 XXX 模块 PRD 与原型

- 新增 PRD
- 新增可点击原型代码
"
git push origin design/module-mvp-demo
```

### 5.4 发起 PR

1. 在 GitHub 上发起 `design/module-mvp-demo → develop` 的 Pull Request
2. Reviewer 指定 guixm、zhaohy
3. 合并前必须获得 guixm 和 zhaohy 的 Approve

> **多轮迭代约定（v1.26）**：`design/module-mvp-demo` 允许跨多轮需求迭代（如第十一轮、第十二轮…），chenrt 持续在分支上提交并推送，每轮评审通过后合并到 `develop`。已合并的 PR 无法继续推送新提交，**每轮迭代后重新发起新 PR**（PR 编号递增，如 #12 → #24）。PR 标题或描述建议标注迭代轮次（如"第 N 轮需求对齐"），便于后续对照 PRD 版本。合并方式见 §5.5，与单轮 PR 完全一致。

### 5.5 合并到 develop

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git pull origin develop
git merge --no-ff design/module-mvp-demo
git push origin develop
```

---

## 6. zhangwq 操作：功能分支（feat/module-XX）

zhangwq 负责基于已冻结的 PRD + 原型开发生产代码。

### 6.1 创建功能分支

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout develop
git pull origin develop
git checkout -b feat/module-XX
```

### 6.2 开发生产代码

**开发前确认冻结基线**（v1.27）：在 PRD 头部确认「PRD 状态 = 已冻结」，并记录所依据的「PRD 版本 + PR 编号」到执行记录（`docs/05-execution-records/module-XX/<agent>.md`），作为后续回退依据。

只允许修改以下目录：

- `platform/`
- `ui-custom/web/`

禁止直接修改：

- `docs/02-product-requirements/`
- `docs/prototypes/`
- `upstream/`

### 6.3 提交变更

```bash
git add <具体文件>
git commit -m "feat(module-XX): <动作> - <简短描述>

- 关联执行记录: docs/05-execution-records/module-XX/<agent>.md
- 变更范围: platform/xxx, ui-custom/web/xxx
"
git push origin feat/module-XX
```

### 6.4 发起 PR

1. 在 GitHub 上发起 `feat/module-XX → develop` 的 Pull Request
2. PR 描述必须包含：
   - 来源设计分支：`design/module-mvp-demo`
   - 来源 PRD：`docs/02-product-requirements/Modules/Module_XX_*.md`
   - **依据的 PRD 版本 + PR 编号**（冻结基线，v1.27）
   - 来源原型：`docs/prototypes/module-XX/`
   - 测试结果（go test / go vet / pnpm test / pnpm lint）
   - 服务验证结果
   - 预览链接（待 GitHub Actions Bot 自动回复）
   - **dev-feedback.md 链接（v1.28）**：若 `docs/05-execution-records/module-XX/dev-feedback.md` 非空（存在 ①空白 / ③技术优化 反馈），PR 描述必须链接该反馈单，供 PM 合并时一次性收割；若为空则注明「无开发反馈」
3. Reviewer 指定 chenrt、zhaohy、guixm

### 6.5 处理 Review 意见

收到 Review 意见后：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout feat/module-XX
# 修改代码后
git add <修改文件>
git commit -m "fix(module-XX): 修复 XX 问题

- 关联执行记录: docs/05-execution-records/module-XX/<agent>.md
"
git push origin feat/module-XX
```

推送后预览链接会自动更新，验收方再次查看即可。

### 6.6 开发中需求不对齐：版本化迭代（v1.27）

feat 开发中发现需求与 PRD 不对齐时，**默认不中途修改**：

1. 记录问题清单到执行记录，继续按已冻结 PRD 收尾当前版本；
2. chenrt 在下一轮 design 迭代中修正需求（新 PR、PRD 版本 +1），合并到 develop；
3. zhangwq 基于最新 develop 开新的 feat 分支承接新需求——全程无需 rebase。

> 只有"必须中途改需求"的紧急情况才走 06 Gitflow §6.2 / Q5 的重建或 rebase 路径。

### 6.7 回退操作速查（v1.27）

```bash
# 回退到开发时依据的冻结基线（对照 PRD + 原型）
# 1. 在 PRD 修订表找冻结版本行，记下 PR 编号
# 2. 定位该轮 merge commit
git log --oneline --merges origin/develop | grep "#<PR编号>"
# 3. 检出该基线对照（只读）
git checkout <merge-commit-hash> -- docs/02-product-requirements/Modules/Module_XX_*.md docs/prototypes/module-XX/
```

当前 feat 分支整体不可接受时，按 §10 放弃重建（`git branch -D` + 从 `origin/develop` 重建）。

---

## 7. guixm / zhaohy 操作：Review 与验收

guixm 和 zhaohy 主要参与 GitHub 上的 Review 和验收，不需要本地开发环境。

### 7.1 查看 PRD + 原型 PR（design/module-mvp-demo）

1. 打开 GitHub 仓库
2. 进入 `design/module-mvp-demo → develop` 的 Pull Request
3. 查看 Files changed：
   - `docs/02-product-requirements/Modules/Module_XX_*.md`
   - `docs/prototypes/module-XX/`
4. 如有需要，可本地拉取查看：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git fetch origin
git checkout origin/design/module-mvp-demo
# 查看完成后切回 develop
git checkout develop
```

5. 在 PR 中评论修改意见或点击 `Approve`

### 7.2 验收功能 PR（feat/module-XX）

1. 打开 `feat/module-XX → develop` 的 Pull Request
2. 在 PR 评论区找到 **Vercel Bot** 自动回复的预览链接
3. 点击 `Preview` 链接打开预览环境（注意：不要点击 Vercel Dashboard Overview 中的 `Visit`，那是 Production Deployment，可能不是当前 PR 的代码）
4. 对照 `docs/prototypes/module-XX/` 原型进行验收
5. 在 PR 中评论问题或点击 `Approve`

> **注意**：Vercel 仅部署前端静态资源，不托管后端服务。若 PR 涉及后端接口，预览环境会自动使用 mock 状态或指向独立部署的测试后端。具体行为由 `ui-custom/web/vercel.json` 和 `VITE_STATIC_PREVIEW` / `VITE_API_BASE_URL` 环境变量控制。

---

## 8. chenrt 合并功能分支

所有 Reviewer Approve 后，chenrt 在主仓库执行合并：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git pull origin develop
git merge --no-ff feat/module-XX
git push origin develop
```

合并后必须再次执行提交前验证：

```bash
# 后端测试
go test ./platform...
go vet ./platform...

# 前端检查
cd ui-custom/web
pnpm test
pnpm lint

# 服务启动验证
go run ./platform/cmd/metric-center/main.go
exec ./node_modules/.bin/vite --host
```

---

## 9. 多模块切换

当需要暂停当前模块、处理其他模块时：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"

# 保存当前工作区
git stash push -m "WIP: module-XX"

# 切换到其他模块
git checkout feat/module-YY

# 处理完切回来
git checkout feat/module-XX
git stash pop
```

---

## 10. 放弃当前分支重来

如果当前分支改动混乱，可放弃后重建：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout develop
git branch -D feat/module-XX
git checkout -b feat/module-XX origin/develop
```

> 此操作会丢失该分支上的所有 commit，请谨慎使用。

---

## 11. 禁止事项

1. **禁止未经 chenrt 批准直接合并到 `develop`**。
2. **禁止在 `feat/module-XX` 分支混入其他模块改动**。
3. **禁止产品经理的 AI 修改 `platform/`、`ui-custom/web/`、`upstream/` 目录**。
4. **禁止开发的 AI 修改 `docs/02-product-requirements/`、`docs/prototypes/` 目录**。
5. **禁止绕过提交前验证直接申请合并**。
6. **禁止在 worktree 外直接开发并提交**。

---

## 12. 相关文档

- [`README.md`](README.md) — 团队协作目录导航（按角色索引）
- [`00_Team_Charter.md`](00_Team_Charter.md) — 团队守则
- [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md) — 角色职责速查表
- [`02_Demand_Workflow.md`](02_Demand_Workflow.md) — 需求设计环节详细流程
- [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) — 代码编写与提交环节详细流程
- [`05_Vibe_Coding_Playbook_for_Zhangwq.md`](05_Vibe_Coding_Playbook_for_Zhangwq.md) — zhangwq Vibe Coding 执行手册
- [`../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南
