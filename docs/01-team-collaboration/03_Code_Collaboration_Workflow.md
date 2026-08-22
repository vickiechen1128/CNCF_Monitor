# MetricCenter 代码编写与提交环节详细流程

> 文档类型：团队协作规范
> **目标读者**：chenrt、zhangwq、guixm、zhaohy——**人视角**的代码协作总览
> 更新日期：2026-08-22（v1.26 新增：开发问题反馈单机制 §6.1 与三类问题处置权；改写原型代码复制条款 §6 禁止事项 3）

---

## 1. 目标

明确 MetricCenter 项目从**需求设计**到**代码合并到 develop** 的完整工程流程，确保：

- 产品侧 Vibe Coding（PRD + 原型）与开发侧 Vibe Coding（生产代码）清晰分离
- AI 代码生成在受控范围内执行
- 每个 `feat/module-XX` 分支都有清晰的边界和验收标准
- 代码质量由 AI 自检 + 人类 Review + 在线预览验收三重保障
- 合并到 `develop` 的代码可随时回滚

---

## 2. 流程总览

### 2.1 三阶段总览

```
Phase 1: 产品侧 Vibe Coding（chenrt）
├── 基于 develop 创建 design/module-mvp-demo
├── 编写 PRD：docs/02-product-requirements/Modules/Module_XX_*.md
├── 生成原型：docs/prototypes/module-XX/
├── 发起 design/module-mvp-demo → develop 的 PR
├── guixm + zhaohy review
└── chenrt --no-ff 合并到 develop
         │
         ▼
Phase 2: 开发侧 Vibe Coding（zhangwq）
├── 基于 develop 创建 feat/module-XX
├── 任务卡驱动调用 Agent 生成 platform/ 和 ui-custom/web/ 代码
├── 人工 Review + 测试补强
├── 执行提交前验证
├── 发起 feat/module-XX → develop 的 PR
├── GitHub Actions 自动部署预览环境
├── chenrt + zhaohy + guixm 通过预览链接验收
└── chenrt --no-ff 合并到 develop
         │
         ▼
Phase 3: develop 验证
└── 再次执行提交前验证
```

### 2.2 关键合并规则

| 分支                 | 合并目标               | 谁发起 PR  | 谁 Review                    | 谁合并               |
| ------------------ | ------------------ | ------- | --------------------------- | ----------------- |
| `design/module-mvp-demo` | `develop`          | chenrt  | guixm、zhaohy                | chenrt（`--no-ff`） |
| `feat/module-XX`   | `develop`          | zhangwq | zhangwq、zhaohy、guixm、chenrt | chenrt（`--no-ff`） |
| `release/*`        | `main` + `develop` | chenrt  | -                           | chenrt（`--no-ff`） |
| `hotfix/*`         | `main` + `develop` | zhangwq | chenrt                      | chenrt（`--no-ff`） |

---

## 3. Phase 1：产品侧 Vibe Coding（chenrt）

### 3.1 触发与负责人

- 触发：需求拆解会已明确模块范围；chenrt 决定进入设计阶段
- 设计分支 Owner：chenrt；Review：guixm（管理视角）、zhaohy（一线业务视角）；技术咨询：zhangwq

### 3.2 操作步骤

1. 创建设计分支（命令见 [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) §5）
2. 编写 PRD 到 `docs/02-product-requirements/Modules/Module_XX_*.md`（骨架规范见 `.kimi/agents/prototype-designer.md` Phase 3）
3. 生成原型到 `docs/prototypes/module-XX/`（调用 `prototype-designer`）
4. 发起 `design/module-mvp-demo → develop` PR，Reviewer 指定 guixm、zhaohy
5. Review 通过后 chenrt `--no-ff` 合并到 develop（命令见 04 §5.5）

### 3.3 Review 关注点

| Reviewer | 关注重点 |
|----------|----------|
| guixm | 业务战略价值、MVP 范围、管理视角 |
| zhaohy | 一线业务逻辑、用户故事完整性、验收标准 |
| zhangwq（可选） | 技术可行性、是否超出当前架构能力 |

---

## 4. Phase 2：开发侧 Vibe Coding（zhangwq）

### 4.1 触发与负责人

- 触发：`design/module-mvp-demo` 已合并到 develop；chenrt 向 zhangwq 下达开发任务单
- 执行：zhangwq（SRE / 工程质量 Owner）

### 4.2 操作步骤

1. 创建功能分支（命令见 [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) §6）
2. **任务卡驱动**调用 Agent：输入 = PRD 章节 + task-sequence + 原型路径 + 验收命令（任务卡格式见 `.kimi/agents/orchestrator.md`；后端调 `backend-developer`、前端调 `frontend-developer`、修复调 `build-resolver`）
3. 人工 Review + 测试补强（Review 清单见 zhangwq 手册 [`05_Vibe_Coding_Playbook_for_Zhangwq.md`](05_Vibe_Coding_Playbook_for_Zhangwq.md) §6）
4. 执行提交前验证（命令见 `docs/03-engineering-standards/04_Testing_Standard.md` §4）
5. 发起 `feat/module-XX → develop` PR（PR 描述要求见 04 §6.4）
6. 等待业务方通过预览链接验收（Vercel Bot 自动回复）

### 4.3 开发中的监督要点

- 确保 AI 在正确的 `feat/module-XX` 分支上工作
- 确保 AI 只修改 `platform/` 和 `ui-custom/web/`
- 及时纠正偏离需求或原型的实现方向
- 遇到阻塞及时升级给 chenrt

---

## 5. Phase 3：业务验收与合并

### 5.1 验收方式

| 角色 | 验收动作 | 验收重点 |
|------|----------|----------|
| zhangwq | 代码 Review + 提交前验证 | 安全、正确性、可维护性、可测试性 |
| zhaohy | 点击 Vercel Bot 的 `Preview` 链接 | 业务逻辑、一线操作习惯、是否解决实际问题 |
| guixm | 点击 `Preview` 链接 | 管理价值、战略方向 |
| chenrt | 点击 `Preview` 链接 + 查看 diff | 产品符合度、架构一致性、合并决策 |

### 5.2 验收不通过处理

- 验收方在 PR 中评论具体问题
- zhangwq 调用对应 Agent 修改，重新 push 后预览链接自动更新
- 验收方再次查看并确认

### 5.3 合并到 develop

所有 Reviewer Approve 后，chenrt 在主仓库执行 `--no-ff` 合并（命令见 [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) §8），合并后必须再次执行提交前验证（失败则修复或 `git revert` 回退）。

---

## 6. 禁止事项

> **核心原则：契约保护与细节反馈解耦。** 禁改 PRD/原型是硬红线（保护契约优先 + 版本可追溯），但由此带来的"每条细节都要走 design 分支往返"成本，通过下方 §6.1 反馈单机制解决，**不放松 PRD/原型禁改红线**。

1. **禁止产品经理的 AI 修改** `platform/`、`ui-custom/web/`、`upstream/` 目录。
2. **禁止开发的 AI 修改** `docs/02-product-requirements/`、`docs/prototypes/` 目录（PRD / 原型文件与版本号照旧禁止改动；开发发现的问题走 §6.1 反馈单）。
3. **禁止将** `docs/prototypes/` 中的原型代码直接复制到生产目录后原样合并。原型可作为**实现基底**复制，但复制后必须完成三道工序——**mock 替换 / ReviewNote 剔除 / MVP 裁剪**——未走完三道工序不得作为生产代码提交。
4. **禁止绕过提交前验证直接申请合并**。
5. **禁止在** `feat/module-XX` **分支混入其他模块改动**。
6. **禁止未经 chenrt 批准直接合并到** `develop`。

### 6.1 开发问题反馈单机制（v1.26 起）

开发在 `feat` 分支上发现 PRD / 原型细节问题时，**PRD / 原型文件与版本号照旧禁止修改**，但可按以下分类处置，避免每条边界值都要走 design 分支往返：

| 类型 | 例子 | 处置权 |
|------|------|--------|
| ① PRD **空白**（未规定） | 边界值、校验细节、字段长度上限 | **开发可直接定**——PRD 未规定不算违约，但必须写入反馈单留痕 |
| ② PRD **已规定但实现发现矛盾** | 某字段语义与真实数据对不上 | **开发不得自行反向**，必须事前报告 PM 决策（现行红线，保留） |
| ③ 原型**纯技术优化** | 组件结构、mock 修复、交互细节 | 同①，写入反馈单留痕即可 |

**反馈单位置**：`docs/05-execution-records/module-XX/dev-feedback.md`（05 目录为 agent 可写区）。格式：PRD 章节 / 原型文件位置 + 现状 + 建议修正 + 影响模块 + 发现场景。

**反馈单不是改 PRD，是变更请求单**——PRD 版本号不动、不用跑 design 分支。`feat` 合并 PR 时，feedback 非空必须**在 PR 描述中链接反馈单**；PM 在 `design/module-mvp-demo` 分支上做一轮版本化迭代时**一次性收割**（收割后在单内标「已收割于 vX.X」）。

> **红线（② 类）**：矛盾必须在**实现前**报告 Orchestrator 走决策，禁止"改了实现再记进 feedback 当既成事实"（见 `frontend-developer.md` / `backend-developer.md` Anti-Rationalization）。

---

## 7. 相关文档

- [`README.md`](README.md) — 团队协作目录导航（按角色索引）
- [`00_Team_Charter.md`](00_Team_Charter.md) — 团队守则
- [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md) — 角色职责速查表
- [`02_Demand_Workflow.md`](02_Demand_Workflow.md) — 需求设计环节详细流程
- [`04_Team_Git_Operations_Guide.md`](04_Team_Git_Operations_Guide.md) — 团队 Git 操作指南（按角色命令）
- [`05_Vibe_Coding_Playbook_for_Zhangwq.md`](05_Vibe_Coding_Playbook_for_Zhangwq.md) — zhangwq Vibe Coding 执行手册
- `docs/03-engineering-standards/04_Testing_Standard.md` — 测试标准（提交前验证唯一权威）
- `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` — 分支策略与回退指南
- `.kimi/agents/orchestrator.md` — Orchestrator 任务卡驱动与子 Agent 调用规范
