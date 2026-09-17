# Gitflow 分支策略与回退指南

> 文档类型：工程标准  
> **目标读者**：技术架构师（分支模型设计）、chenrt（合并 / 回退操作执行人）、zhangwq（分支创建 / 合并申请）  
> 依赖文档：[05_AI_Agent_Collaboration_Standard.md](05_AI_Agent_Collaboration_Standard.md)、[05_Code_Implementation_Plan.md](../02-product-requirements/05_Code_Implementation_Plan.md)、[../01-team-collaboration/00_Team_Charter.md](../01-team-collaboration/00_Team_Charter.md)  
> 更新日期：2026-08-28（v1.29 新增：版本基线 tag 规范 §2.5 / 联调出口打 tag §2.6.4 / 基线回退路径 §6.6 / 禁止事项 11；v1.28 新增：按版本短生命周期联调分支 `integration/vX.Y` 与冻结窗口 §2.6 / §11 禁止事项 10；v1.27 新增：MVP 阶段设计分支合并为单一 `design/module-mvp-demo` §2.4；原型代码复制条款改写 §2.2 / §11 禁止事项 3）

---

## 1. 设计目标

1. **按阶段隔离**：产品侧 Vibe Coding（`design/`）与开发侧 Vibe Coding（`feat/`）分离，避免上下文错乱。
2. **需求即代码**：PRD 和原型代码合并到同一条 `design/module-mvp-demo` 分支，随合并进入 `develop`，成为 AI 读取的单一事实源。
3. **保留 develop 作为 SSOT**：`develop` 仍是 PRD、原型与已验收代码的唯一持久集成基线；跨模块联调通过按版本切出、短生命周期的 `integration/vX.Y` 分支承载，验收后必须 `--no-ff` 合回 `develop` 并删除，避免长期分支漂移。
4. **随时可回退**：模块不满意时，可放弃整个 `feat/` 分支；已合并到 `develop` 后，可通过 revert 撤销。
5. **在线验收**：每个 `feat/module-XX` PR 自动部署预览环境，产品经理和业务方在 PR 阶段通过 URL 验收，再决定是否合并。
6. **双文件夹友好**：设计空间（`CNCF_Monitor-worktree`）与开发空间（`CNCF_Monitor-feature`）物理隔离、互不打扰；开发侧串行复用单一克隆，并行时额外 `git worktree add` 多目录，避免目录堆积与上下文错乱。

---

## 2. 分支模型

本项目采用 **双文件夹隔离 + 设计/实现分离分支**。

### 2.1 分支约定

| 分支类型 | 命名示例 | 用途 | 来源 | 合并目标 | 负责人 | Reviewer |
|----------|----------|------|------|----------|--------|----------|
| `main` | `main` | 稳定/生产版本 | - | - | chenrt（项目整体负责人 / 产品 Owner） | - |
| `develop` | `develop` | PRD + 原型 + 已验收代码的 SSOT | `main` | - | chenrt（项目整体负责人 / 产品 Owner） | - |
| `design/module-mvp-demo` | `design/module-mvp-demo` | MVP 阶段**单一**设计分支：PRD + AI 生成的原型代码（模块归属按 PRD 单文件隔离，见 §2.4） | `develop` | `develop` | chenrt（项目整体负责人 / 产品 Owner） | guixm（业务架构师 / 管理视角）、zhaohy（业务需求提出方 / 一线视角） |
| `feat/module-XX` | `feat/module-07` | 生产代码实现 | `develop` | `develop` | zhangwq（SRE 工程师 / 工程质量 Owner） | zhangwq、zhaohy、guixm、chenrt |
| `feature/prototype-*` | `feature/prototype-mvp-demo` | 历史兼容原型分支 | `develop` | **不合并** | chenrt | guixm、zhaohy |
| `release/*` | `release/v0.1.0` | 版本发布 | `develop` | `main` + `develop` | chenrt（项目整体负责人 / 产品 Owner） | - |
| `integration/*` | `integration/v0.1` | 版本末跨模块联调 / E2E 验收（按版本短生命周期） | `develop` | `develop` | zhangwq（SRE 工程师 / 工程质量 Owner） | chenrt（项目整体负责人 / 产品 Owner） |
| `hotfix/*` | `hotfix/v0.1.1` | 生产紧急修复 | `main` | `main` + `develop` | zhangwq（SRE 工程师 / 工程质量 Owner） | chenrt（项目整体负责人 / 产品 Owner） |

> **重要**：只有 chenrt 有权将 `design/`、`feat/`、`integration/`、`release/`、`hotfix/` 分支合并到 `develop` 或 `main`，且必须使用 `--no-ff`。

### 2.2 设计分支特殊规则

> **v1.27（单一设计分支）**：MVP 阶段合并为**单一** `design/module-mvp-demo` 分支，**不再按模块切分**。设计跨模块（如网域跨 M01/M06/M07/M09）时无需切换分支；模块归属靠 PRD 文件物理隔离（`Module_XX_*.md` 单文件）+ `docs/02-product-requirements/Modules/README.md` §4 映射表追溯，**追溯不依赖分支名**。进入正式多版本阶段后再拆分回 `design/module-XX`。

- `design/module-mvp-demo` 必须同时包含：
  - `docs/02-product-requirements/Modules/Module_XX_*.md`（PRD，单模块单文件）
  - `docs/prototypes/module-XX/`（AI 生成的可点击原型代码，按模块目录）
- 原型代码可作为**实现基底**复制到 `platform/` 或 `ui-custom/web/`，但复制后必须完成三道工序（**mock 替换 / ReviewNote 剔除 / MVP 裁剪**）方能合并，未走完禁止原样合并（见 §11 禁止事项 3）。
- `design/module-mvp-demo` 合并到 `develop` 后，该模块 PRD + 原型即冻结，成为开发 AI 的输入源。
- 如 PRD 在开发期间变更，默认走**版本化迭代**：当前 feat 版本按已冻结 PRD 收尾合并后，design 分支再迭代新需求（见 §2.5 与 Q5）；只有必须中途改需求的紧急情况，才重建或 rebase `feat/module-XX`。
- **多轮迭代**：`design/module-mvp-demo` 支持跨多轮需求迭代（如第十一轮、第十二轮…），每轮评审合并后重新发起新 PR（编号递增），PR 标注迭代轮次（如"第 N 轮需求对齐"）。PRD 版本、原型版本随轮次递增（每轮 +1），与 PR 编号一一对应（见 §2.5）。

### 2.3 功能分支特殊规则

- 一个 `feat/module-XX` 只实现一个模块。
- 必须从 `develop` 最新状态切出，确保读取到已冻结的 PRD + 原型。
- **开发前确认冻结基线**：在 PRD 头部确认「PRD 状态 = 已冻结」并记录所依据的「PRD 版本 + PR 编号」到执行记录；开发期间 PRD 变更默认不跟入（版本化迭代，见 Q5）。
- 推送到远程后，GitHub Actions 自动部署预览环境。
- 合并前必须完成：zhangwq Review + 提交前验证 + 产品经理/业务方预览验收。

### 2.4 模块分支列表

> **维护提示（v1.27）**：本表为当前已规划模块的快照。MVP 阶段**设计统一走单一 `design/module-mvp-demo` 分支**（不再按模块切分），功能分支逐个模块 `feat/module-XX`。**新增模块时需同步更新本表**；已冻结/已交付模块可保留作历史参考。

| 模块编号 | 设计分支 | 功能分支 | 说明 |
|----------|----------|----------|------|
| Module 00 | `design/module-mvp-demo` | `feat/module-00` | 基础设施与数据模型 |
| Module 07 | `design/module-mvp-demo` | `feat/module-07` | 配置管理（含资源、标签、Job、拨测） |
| Module 01 | `design/module-mvp-demo` | `feat/module-01` | 采集状态与诊断 |
| Module 02 | `design/module-mvp-demo` | `feat/module-02` | 指标查询中心 |
| Module 08 | `design/module-mvp-demo` | `feat/module-08` | 告警状态查看 |
| Module 05 | `design/module-mvp-demo` | `feat/module-05` | 前端门户集成 |

> MVP 阶段 `feat/module-XX` 可按粒度进一步拆分（例如 `feat/module-07a`），但设计统一在 `design/module-mvp-demo`，模块归属靠 PRD 单文件物理隔离追溯。

### 2.5 版本管理约定

仓库内并存 4 种"版本"概念，必须**分层使用、禁止混用**：

| 层级 | 命名示例 | 用途 | 管理要点 |
|------|----------|------|----------|
| 产品版本（路线图） | MVP / v0.2 / v0.3 / v0.4 / v1.0 | 功能落地的产品阶段 | 全局唯一，以 Module_00 集成图为准；各模块的「产品版本覆盖」需与之对齐 |
| PRD 修订版本 | v1.0 → v1.1 → … | PRD 文档自身修订 | 每轮需求对齐递增（每轮 +1），与 design 迭代轮次、PR 编号一一对应 |
| 原型版本 | 与 PRD 修订版本一致 | 原型项目版本 | 必须与 PRD 修订版本保持一致（prototype-designer 强制检查） |
| 发布 tag | v0.1.0 | 对外发布基线 | 仅第一版发布时在 `main` 打（语义化版本）；开发阶段不启用 |
| 版本基线 tag | `baseline/v0.1-mvp` | 版本收官的**整版回退锚点**（PRD + 原型 + 代码同一快照） | 联调合回 `develop` 后由 chenrt 在 integration 合并点打 annotated tag；tag 消息固化各模块 PRD 冻结版本 + PR 编号 + 验收日期；不可移动/重打，基线有误递增小数位（如 `baseline/v0.1-mvp.1`），详见 §6.6 |

**PRD 修订表模板**（每个模块 PRD 头部必带，统一列格式）：

| 版本 | 日期 | 变更类型 | 变更内容 | 影响范围 | 产品版本影响 | 状态 |
|------|------|----------|----------|----------|--------------|------|
| v1.1 | 2026-08-13 | 修改 | 标签口径统一（第十一轮） | 数据模型、标签模板 | MVP / v0.4 | 已冻结 |

- **变更类型**：新增 / 修改 / 删除 / 回滚
- **状态**：draft / prototyping / ready / 已冻结 / 已废弃
- **已冻结**：该轮 review 合并到 `develop` 后由 chenrt 标记，成为 zhangwq 开发与回退的基线。
- **冻结行只增不改**：修订表中已标记「已冻结」的版本行永不改写；需求变更一律**新增一行**，旧冻结版本保留作为开发基线。
- **列格式说明**：全仓库统一列名为「版本 / 日期 / 变更类型 / 变更内容 / 产品版本影响 / 状态」；「影响范围」列为完整模板可选列——完整版保留该列（Module_00/02/03/04/05/06/08/10），精简记录版省略该列（Module_01/07/09，完整历史见 `docs/05-execution-records/module-XX/design-decisions.md`「Change Log（完整历史）」）。
- **迭代追溯**：**迭代轮次内**不引入 git tag，追溯依靠「PRD 修订版本 + PR 编号 + 修订表冻结行」三者对应关系；**版本边界**（联调收官合回 develop）为例外，打 `baseline/vX.Y-*` 基线 tag（见上表与 §6.6），解决"整版基线"锚点缺失问题。
- **跨模块对齐快照**：各模块 PRD/原型版本的当前状态与对齐情况见 `docs/02-product-requirements/Modules/README.md`（版本对齐总表，prototype-designer 迭代后同步、chenrt 标记冻结/合并后同步）。
- **冻结期提交门禁（v1.26）**：模块 PRD 状态为「已冻结」（feat 分支已切出）至该 feat 版本合并到 `develop` 之间为**冻结期**。冻结期内：
  - ✅ **允许**：产品经理本地构思、草稿编辑（不提交）；下一轮需求写入 `docs/05-execution-records/module-XX/design-decisions.md`「下一轮迭代待办」；
  - ❌ **禁止**：commit / push 该模块 PRD / 原型版本变更；发起新的 design→develop PR；改写已冻结行（见上）。
  - 🔓 **解锁**：当前 feat 版本合并到 `develop` 后，由 chenrt 在修订表新增下一轮行（状态 prototyping），恢复提交权限。

---

## 2.6 跨模块联调分支（`integration/vX.Y`）

每个产品版本末（MVP / v0.2 / v0.3 / …）都会进入跨模块联调阶段。为在**不污染 `develop` SSOT** 的前提下，给联调修复提供一个稳定的工作位，并为下游功能分支提供明确的**冻结窗口**，引入按版本切出的短生命周期 `integration/vX.Y` 分支。

### 2.6.1 分支定位

| 维度 | 说明 |
|------|------|
| 命名 | `integration/v0.1`（MVP）、`integration/v0.2`（v0.2）等，与产品版本对齐 |
| 来源 | 从 `develop` 切出，且必须在本版本所有相关 `feat/module-XX` 已 `--no-ff` 合并到 `develop` 之后 |
| 合并目标 | 联调验收通过后 `--no-ff` 合回 `develop`，随后删除该分支 |
| 负责人 | zhangwq（工程质量 Owner）负责推动联调；chenrt 唯一有合并/删除权限 |

### 2.6.2 冻结窗口规则

进入 `integration/vX.Y` 即视为**版本级代码冻结窗口**开启，规则如下：

- **已合并的 `feat/module-XX` 冻结**：不再接受新提交。联调期间发现的 bug 或边界问题，在 `integration/vX.Y` 上修复；禁止回退到原 `feat/module-XX` 分支继续开发。
- **下一版本功能分支可并行启动**：v0.3 的功能分支可以从 `develop` 最新状态切出，但必须预期在 `integration/v0.2` 合回 develop 后执行一次 rebase / 同步。
- **禁止未经协调的 rebase**：任何在冻结窗口内对 `develop` 历史的重写，必须经 chenrt 与 zhangwq 共同确认。

### 2.6.3 入口条件

1. 本版本范围内所有 `feat/module-XX` 已 `--no-ff` 合并到 `develop`。
2. PRD 修订表中对应版本行已标记为「已冻结」。
3. chenrt 正式宣布「代码冻结 / 进入联调」。
4. 从 `develop` 切出 `integration/vX.Y`。

### 2.6.4 出口条件

1. Phase 5 验收清单全部完成（端到端主链路跑通、文档补齐、构建/测试通过）。
2. chenrt 审批通过。
3. `--no-ff` 合并 `integration/vX.Y` → `develop`。
4. 在合并点打版本基线 tag `baseline/vX.Y-*`（annotated，消息含各模块 PRD 冻结版本 + PR 编号 + 验收日期），并 `git push origin <tag>` 推送。
5. 删除 `integration/vX.Y` 分支。
6. 宣布解冻，下一版本功能分支可正式推进。

### 2.6.5 大改动回退路径

联调期间若发现某模块需要**实质性返工**（超出 bug 修复/边界补齐范围）：

- **默认路径**：先记录问题，让当前 `integration/vX.Y` 尽快收尾合回 `develop`；解冻后重新切 `feat/module-XX`（或变更请求 CR）处理该模块；必要时再开 `integration/vX.Y.1` 做第二轮联调。
- **禁止路径**：在 `integration/vX.Y` 上大规模重构已合并模块的核心逻辑，或私自重启已冻结的 `feat/module-XX` 分支。

---

## 3. `develop` 作为单一事实源（SSOT）

### 3.1 develop 上必须包含的内容

| 类型 | 路径/目录 | 说明 |
|------|----------|------|
| PRD | `docs/02-product-requirements/` | 已确认的产品需求文档 |
| 原型 | `docs/prototypes/` | 已确认的可点击原型代码 |
| 工程标准 | `docs/03-engineering-standards/` | 代码规范、API 标准、测试标准等 |
| 团队规范 | `docs/01-team-collaboration/` | 团队守则、角色职责、协作流程 |
| 生产代码 | `platform/`、`ui-custom/web/` | 已验收的后端/前端代码 |
| Agent 定义 | `.kimi/agents/` | 团队统一的 Agent 定义 |

### 3.2 develop 上不应出现的内容

- 未确认的需求草稿
- 仅用于演示、未按工程标准实现的原型代码（应留在 `docs/prototypes/`）
- 直接修改的 `upstream/` 源码（必须走 patch 流程）

---

## 4. 目录隔离设计

为支持全链路 Vibe Coding，目录按职责严格隔离：

```text
CNCF_Monitor/
├── docs/
│   ├── 02-product-requirements/     # PRD 存放处（产品经理的 AI 可写）
│   │   └── Modules/
│   │       └── Module_XX_*.md
│   ├── prototypes/                  # 原型代码存放处（产品经理的 AI 可写）
│   │   └── module-XX/
│   ├── 03-engineering-standards/    # 工程标准
│   └── 01-team-collaboration/       # 团队协作规范
├── platform/                        # 后端生产代码（开发的 AI 可写）
├── ui-custom/web/                   # 前端生产代码（开发的 AI 可写）
├── upstream/                        # 上游源码（禁止直接修改）
└── patches/prometheus/              # 上游 patch（zhangwq 维护）
```

### 4.1 目录修改权限

| 目录 | 允许修改者 | 禁止修改者 |
|------|-----------|-----------|
| `docs/02-product-requirements/` | chenrt / PM 的 AI | zhangwq / 开发的 AI |
| `docs/prototypes/` | chenrt / PM 的 AI | zhangwq / 开发的 AI |
| `docs/03-engineering-standards/` | chenrt（design 分支）、zhangwq（feat 分支） | - |
| `docs/01-team-collaboration/` | chenrt（design 分支）、zhangwq（feat 分支） | - |
| `.kimi/agents/` | chenrt（design 分支）、zhangwq（feat 分支） | - |
| `platform/` | zhangwq / 开发的 AI | chenrt / PM 的 AI |
| `ui-custom/web/` | zhangwq / 开发的 AI | chenrt / PM 的 AI |
| `upstream/` | 禁止直接修改 | 全员 |

> 规范和 Agent 定义由项目负责人在设计分支、开发工程师在功能分支中按需维护，但禁止在对方核心目录（PRD/原型、生产代码）中修改。

---

## 5. 工作目录与双文件夹隔离约定

- **设计空间**：`/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree`，固定分支 `design/module-mvp-demo`，负责写 PRD、改原型。
- **开发空间**：`/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature`，`develop` + `feat/module-XX`，负责 Vibe Coding。
- **规则**：设计空间与开发空间为两个独立克隆，物理隔离。开发侧串行复用 `CNCF_Monitor-feature`，通过 `git checkout` 切换分支；并行推进多模块时才在开发空间额外 `git worktree add` 多目录。

### 5.1 开发空间初始化（一次性）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
git clone <远程仓库地址> .
git checkout develop
```

### 5.2 校验当前所处的空间与分支

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"

# 确认当前目录在开发空间
pwd

# 确认当前分支
git branch --show-current
```

> 设计工作应在 `CNCF_Monitor-worktree` 且分支为 `design/module-mvp-demo`；开发工作应在 `CNCF_Monitor-feature` 且分支为 `feat/module-XX`。

### 5.3 创建设计分支（在设计空间 `CNCF_Monitor-worktree`）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-worktree"
git checkout develop
git pull origin develop
git checkout -b design/module-mvp-demo
```

### 5.4 创建功能分支（在开发空间 `CNCF_Monitor-feature`）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
git checkout develop
git pull origin develop
git checkout -b feat/module-XX
```

### 5.5 多模块切换（stash 方式，在开发空间 `CNCF_Monitor-feature`）

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"

# 保存当前工作区
git stash push -m "WIP: module-XX"

# 切换到其他模块
git checkout feat/module-YY

# 处理完切回来
git checkout feat/module-XX
git stash pop
```

> **并行多模块推荐做法**：如需同时推进多个模块（避免 stash 频繁切换），可在开发空间额外创建独立 worktree：
> ```bash
> cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
> git worktree add ../CNCF_Monitor-feature-YY -b feat/module-YY
> ```
> 参考 `using-git-worktrees` Skill 的使用协议。

---

## 6. 回退机制

### 6.1 模块开发中不满意：丢弃当前 feat 分支

如果 Agent 当前模块的代码不符合要求，且尚未合并到 `develop`，最简单的方式是删除该 feat 分支并重建。

```bash
# 1. 切回 develop，确保开发空间不处于要删除的分支上
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
git checkout develop

# 2. 删除不满意的 feat 分支（本地）
git branch -D feat/module-XX

# 3. 从 develop 最新状态重建分支
git checkout -b feat/module-XX origin/develop
```

> 此操作会丢失该分支上的所有 commit，但 `develop` 完全不受影响。适合模块尚未合并、且改动整体不可接受的情况。

### 6.2 设计分支已合并但想撤回 PRD

如果 `design/module-mvp-demo` 已合并到 `develop`，但发现 PRD 或原型存在重大问题：

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop

# 找到 design/module-mvp-demo 的 merge commit
git log --oneline --merges

# revert 合并（保留历史）
git revert -m 1 <merge-commit-hash>
```

> 同时需要在文档中标记该模块 PRD 已撤回，避免 zhangwq 基于此开发。

### 6.3 模块已合并到 develop：revert 整个模块

如果 `feat/module-XX` 已合并到 `develop`，才发现不符合要求，可以通过 revert 合并提交来撤销整个模块的改动。

```bash
# 1. 找到模块合并到 develop 的 merge commit
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git log --oneline --merges

# 2. 对 merge commit 做 revert（保留历史，撤销变更）
git revert -m 1 <merge-commit-hash>
```

> `-m 1` 表示保留 merge commit 的第一个父提交（即 `develop` 方向）作为主线。

### 6.4 develop 被污染：从 main 重置 develop

如果 `develop` 被多次错误合并严重污染，且尚未发布到 `main`，可以从 `main` 重建 `develop`。

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git reset --hard origin/main
```

> 此操作会丢失 `develop` 上所有未合并到 `main` 的改动，仅在极端情况下使用。

### 6.5 开发中回退到冻结基线（zhangwq 阅读）

zhangwq 开发中需要确认或回退到"我开发时依据的 PRD 基线"时：

```bash
# 1. 在 PRD 修订表找到自己开发时依据的冻结版本行，记下「PRD 版本 + PR 编号」
# 2. 定位该轮合并到 develop 的 merge commit
git log --oneline --merges develop | grep "#<PR编号>"
# 3. 需要时检出该基线（只读对照，不提交）
git checkout <merge-commit-hash> -- docs/02-product-requirements/Modules/Module_XX_*.md docs/prototypes/module-XX/
# 4. 对照完毕后可丢弃工作区改动
git checkout -- docs/02-product-requirements/Modules/Module_XX_*.md docs/prototypes/module-XX/
```

> 若当前 feat 分支整体不可接受，走 §6.1 丢弃重建；若必须中途对接新 PRD 基线，走 Q5 的 rebase/重建路径（重写历史、可能返工，谨慎使用）。

### 6.6 回退到版本基线（tag 路径）

适用于**整版对照 / 整版回退**场景：如 v0.2 涉及功能与架构重设计，实施后发现方向性问题，需要回到上一版本收官状态。基线 tag 打在 `develop` 的 integration 合并点上，PRD、原型、代码为同一快照，一个 tag 即完整版本锚点。

```bash
# 1. 只读对照：查看基线时点的任意文件（不改动当前分支）
git show baseline/v0.1-mvp:docs/02-product-requirements/Modules/Module_XX_*.md
# 或把基线版本检出到工作区比对
git checkout baseline/v0.1-mvp -- <path>

# 2. 确需基于基线重做/修复时，从 tag 切分支
git checkout -b hotfix/vX.Y.Z baseline/v0.1-mvp
```

- **优先级**：先对照（tag 只读检出），再决定是 revert 还是新 feat 分支重做；避免上来就 `git revert -m 1`（merge-revert 会阻碍该分支未来重新合并，需 revert-of-revert 才能恢复）。
- 单模块、局部问题仍走 §6.1–§6.3 的分支丢弃 / merge-revert 流程，不必动用版本基线。
- 版本基线 tag 清单与含义可通过 `git tag -l 'baseline/*' -n99` 查看（tag 消息即版本清单）。

---

## 7. 合并审批规则

### 7.1 design/module-mvp-demo 合并条件

1. PRD 和原型代码已按目录隔离要求放置
2. PRD 修订表已同步更新：版本已递增、未改写任何「已冻结」行、PR 标注迭代轮次（§2.5）
3. guixm（业务架构师 / 管理视角）review 通过
4. zhaohy（业务需求提出方 / 一线业务视角）review 通过
5. chenrt（项目整体负责人 / 产品 Owner）做最终审批，合并后将该版本标记「已冻结」

### 7.2 feat/module-XX 合并条件

1. zhangwq（SRE 工程师 / 工程质量 Owner）完成代码 Review 并确认通过
2. 提交前验证全部通过（`go test` / `go vet` / `pnpm test` / `pnpm lint` / 服务启动）
3. 变更范围符合 Module 文档和 `docs/prototypes/module-XX/` 原型，未混入其他模块改动
4. commit message 符合规范，并关联执行记录
5. 预览环境部署成功，chenrt / zhaohy / guixm 通过预览链接验收
6. zhangwq 已向 chenrt 提交合并申请

### 7.3 合并权限

- **唯一合并人**：chenrt（项目整体负责人 / 产品 Owner）
- **合并方式**：`git merge --no-ff design/module-mvp-demo` 或 `git merge --no-ff feat/module-XX`
- **合并地点**：在主仓库 `CNCF_Monitor` 中执行
- **合并后**：必须再次在 develop 环境执行提交前验证

### 7.4 合并申请内容

zhangwq 提交的合并申请应包含：

```markdown
## 合并申请

**分支**：feat/module-XX
**来源设计**：design/module-mvp-demo
**来源 PRD**：docs/02-product-requirements/Modules/Module_XX_*.md
**来源原型**：docs/prototypes/module-XX/
**预览链接**：https://...
**变更范围**：列出新增/修改文件
**测试结果**：go test / go vet / pnpm test / pnpm lint 结果
**服务验证**：后端/前端服务启动验证结果
**Review 结论**：自查通过 / 问题已修复
**业务验收**：zhaohy / guixm / chenrt 已 Approve
**风险点**：XXX
**建议下一步**：合并到 develop
```

详细模板见 [`../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md)。

---

## 8. 全链路 Vibe Coding 协作流程

### 8.1 标准流程

> **v1.25 去重**：全链路协作流程（角色流程图 + 文字版步骤）的**权威定义在 `.kimi/agents/orchestrator.md`「标准工作流」**（Agent 执行视角）与 [`05_AI_Agent_Collaboration_Standard.md`](05_AI_Agent_Collaboration_Standard.md) §1（人视角概览）。本文件只承载**分支 / 回退 / 审批**等 git 操作层面规则，不再重复流程图。

一句话概览：`design/module-mvp-demo`（PRD+原型）→ chenrt 合并到 `develop` 冻结 → zhangwq 切 `feat/module-XX` 开发 → 预览验收 → chenrt `--no-ff` 合并回 `develop`。

### 8.2 Commit 规范

> **v1.25 去重**：Commit 规范的**唯一权威定义在 [`05_AI_Agent_Collaboration_Standard.md`](05_AI_Agent_Collaboration_Standard.md) §3.6**（design/ 与 feat/ 提交格式、示例）。本文件不再重复，提交时以 05 §3.6 为准。

关键要求速查：每个 feat 提交必须对应到某个 Agent 的一次执行记录（`docs/05-execution-records/module-XX/<agent>.md`），格式 `feat(module-XX): <动作> - <简短描述>`。

### 8.3 执行记录目录结构

```
docs/05-execution-records/
├── module-XX/
│   ├── README.md
│   ├── planner.md
│   ├── backend-developer.md
│   ├── frontend-developer.md
│   ├── golang-reviewer.md
│   └── frontend-reviewer.md
```

每个模块的 `README.md` 记录目标、参与 Agent、关键决策、主要变更文件、验证结果和状态。

---

## 9. 预览环境（Preview Environments）

### 9.1 目标

- 产品经理和业务方无需本地配置开发环境即可验收功能。
- 每个 `feat/module-XX` PR 自动生成独立预览链接。
- 预览链接成为团队沟通的通用语言。

### 9.2 推荐方案

#### 方案 A：Vercel（推荐，已配置）

适用于 `ui-custom/web/` 前端项目。本项目已接入 Vercel，每次 `feat/module-XX` PR 自动生成独立预览链接。

**Vercel 项目配置**（路径：`Project Settings → Build and Deployment`）：

| 配置项 | 值 | 说明 |
|--------|-----|------|
| Framework Preset | `Other` | 避免 Vercel 自动覆盖自定义构建命令 |
| Root Directory | `ui-custom/web` | 前端代码根目录 |
| Build Command | `tsc && vite build --base /` | 覆盖 `vite.config.ts` 中的 GitHub Pages base |
| Output Directory | `dist` | Vite 默认构建输出 |
| Install Command | `pnpm install` | 使用 pnpm 安装依赖 |
| Environment Variables | `VITE_STATIC_PREVIEW=true` | 预览环境无后端，使用 mock 状态 |

**对应代码文件**：
- `ui-custom/web/vercel.json`：Vercel 构建配置 + 环境变量
- `ui-custom/web/vite.config.ts`：`base: process.env.VITE_BASE_PATH || '/'`
- `ui-custom/web/src/pages/home/HomePage.tsx`：根据 `VITE_STATIC_PREVIEW` 切换 mock / 真实后端

**预览链接生成规则**：

```
https://cncf-monitor-git-feat-module-XX-chenrt-team.vercel.app
```

Vercel Bot 自动在 PR 评论区回复，验收方点击 `Preview` 链接即可打开。

> **注意**：Vercel 是纯前端静态托管，不运行后端服务。若需同时预览后端 API，请参考方案 C 或使用独立部署的测试后端并配置 `VITE_API_BASE_URL`。

#### 方案 B：GitHub Pages + Actions（低成本）

适用于原型预览和早期阶段。

每个 `feat/module-XX` 推送后，GitHub Actions 构建并部署到：

```
https://<org>.github.io/CNCF_Monitor/preview/feat-module-XX/
```

#### 方案 C：自建 Docker + Nginx（全栈预览）

如需同时预览后端 API：

1. GitHub Actions 构建 `platform/` 和 `ui-custom/web/` Docker 镜像
2. 部署到测试服务器随机端口
3. Nginx 动态路由分配临时域名
4. PR 关闭时自动销毁容器

### 9.3 验收动作

- **chenrt**（项目整体负责人 / 产品 Owner）：判断产品符合度、架构一致性、是否可合并
- **zhaohy**（业务需求提出方 / 验收者）：判断业务逻辑、一线操作习惯、是否解决真实问题
- **guixm**（业务架构师 / 需求共创者）：判断管理价值与战略方向

验收方在 PR 中：

1. 打开 Bot 回复的预览链接
2. 对比 `docs/prototypes/module-XX/` 原型
3. 确认业务逻辑、页面流程、字段展示是否符合预期
4. 在 GitHub PR 中评论修改意见或点击 `Approve`

---

## 10. 常见问题

### Q1: Agent 在当前模块改了一半，想临时切换到另一个模块怎么办？

见 [5.5 多模块切换（stash 方式）](#55-多模块切换stash-方式)。

### Q2: 如何确认某个模块是否已合并到 develop？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor"
git checkout develop
git branch --merged develop | grep -E "design/module-mvp-demo|feat/module-XX"
```

### Q3: 想比较当前 feat 分支和 develop 的差异？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"
git diff develop..feat/module-XX
```

### Q4: 发现当前 feat 分支改动混乱，如何放弃重来？

```bash
cd "/Users/chenrt/S-03Python/03 AIopsAgent-study/CNCF_Monitor-feature"

# 1. 切回 develop（确保不在要删除的分支上）
git checkout develop

# 2. 删除不满意的 feat 分支（本地）
git branch -D feat/module-XX

# 3. 从 develop 最新状态重建分支
git checkout -b feat/module-XX origin/develop
```

> 此操作会丢失该分支上的所有 commit，但 `develop` 完全不受影响。

### Q5: 设计分支合并后，发现 PRD 需要修改怎么办？

分两种情况：

- **feat/module-XX 尚未创建**：直接修改 `design/module-mvp-demo`（PRD 修订表新增一行，版本 +1），重新发起 PR 到 develop。
- **feat/module-XX 已在开发中**：
  - **默认路径（版本化迭代，推荐）**：**不中途修改**。记录问题清单，当前 feat 版本按已冻结 PRD 收尾合并；随后 design 分支迭代新需求（新轮次、新 PR、版本 +1），合并后再开新的 feat 分支承接——全程无需 rebase / 重建。
  - **必须中途改（紧急）**：走变更请求（CR）流程，重新走 `design/module-mvp-demo` 流程合并后，zhangwq 基于新的 develop commit **重建或 rebase** `feat/module-XX`（重写历史、可能返工，谨慎使用）。

---

## 11. 禁止事项

1. **严禁 `design/` 或 `feat/` 分支直接合入 `main`**。
2. **严禁在 `feat/module-XX` 分支混入其他模块改动**。
3. **严禁将 `docs/prototypes/` 中的原型代码直接复制到 `platform/` 或 `ui-custom/web/` 后原样合并**；原型可作为实现基底复制，但必须完成 **mock 替换 / ReviewNote 剔除 / MVP 裁剪** 三道工序后方可提交。
4. **严禁产品经理的 AI 修改 `platform/`、`ui-custom/web/`、`upstream/` 目录**。
5. **严禁开发的 AI 修改 `docs/02-product-requirements/`、`docs/prototypes/` 目录**。
6. **严禁在错误的空间中开发并提交**（设计变更须在设计空间 `CNCF_Monitor-worktree`，生产代码须在开发空间 `CNCF_Monitor-feature`，避免空间与分支错乱）。
7. **严禁 zhangwq 未经 chenrt 批准自行合并到 `develop`**。
8. **严禁擅自改动 `.git/worktrees/` 元数据**（除非明确知道如何修复）。
9. **严禁改写修订表中已标记「已冻结」的版本行**（需求变更一律新增行，见 §2.5）。
10. **严禁在 `integration/vX.Y` 冻结窗口内向已合并的 `feat/module-XX` 分支提交新改动**；所有联调修复必须落在 `integration/vX.Y` 上，实质性返工走 §2.6.5 回退路径。
11. **严禁移动 / 删除重打版本基线 tag**（`baseline/vX.Y-*`）；基线内容有误时递增小数位打新 tag（如 `baseline/v0.1-mvp.1`）；tag 仅在版本边界（联调合回 `develop` 后）打，迭代轮次内不新增 tag；打完必须 `git push origin <tag>`。

---

## 12. 相关文档

- [`../01-team-collaboration/00_Team_Charter.md`](../01-team-collaboration/00_Team_Charter.md) — 团队守则
- [`../01-team-collaboration/01_Role_Responsibilities.md`](../01-team-collaboration/01_Role_Responsibilities.md) — 角色职责速查表
- [`../01-team-collaboration/02_Demand_Workflow.md`](../01-team-collaboration/02_Demand_Workflow.md) — 需求设计环节详细流程
- [`../01-team-collaboration/03_Code_Collaboration_Workflow.md`](../01-team-collaboration/03_Code_Collaboration_Workflow.md) — 代码编写与提交环节详细流程
- [`../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md`](../01-team-collaboration/05_Vibe_Coding_Playbook_for_Zhangwq.md) — zhangwq Vibe Coding 执行手册
- [`05_AI_Agent_Collaboration_Standard.md`](05_AI_Agent_Collaboration_Standard.md) — AI Agent 协作细则
