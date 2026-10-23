# CNCF_Monitor Agent 团队速查

> **版本：v1.28** — Phase 2 Agent 瘦身：通用 Gitflow、目录隔离、API 标准、R1–R4、测试/交付/审查协议下沉到 Skill；Agent 文件只保留角色、边界、权限、必须加载的 Skill 与角色专属流程。契约优先（Contract-First）规则不变。

## 核心架构：Orchestrator + 三层派生 + Developer + Reviewer

```
用户请求
   │
   ▼
Orchestrator（主 Agent）
   │
   ├──► prototype-designer —— PRD 草案 → 原型验证 → ready PRD
   │
   ├──► prometheus-developer —— 技术预研（解决 [待验证] 点）
   │
   ├──► planner Phase 1: plan-maintainer —— 从 ready / dev-ready PRD 派生 L2
   │       输出：04_Implementation_Map.md + 05_Code_Implementation_Plan.md
   │
   ├──► planner Phase 2: code-sequence-planner —— 从 L2 派生 L3
   │       输出：docs/05-execution-records/module-XX/task-sequence.yaml
   │
   ├──► backend-developer / frontend-developer —— 按 L3 micro-task 开发
   │
   ├──► golang-reviewer / frontend-reviewer / security-reviewer
   │
   ├──► build-resolver —— 修复构建/测试/lint 失败
   │
   └──► git-guardian —— 提交前合规审查
```

核心生产流程：

```
PRD（L1） → Implementation Plan（L2） → Code Sequence（L3） → Code
```

---

## Agent 列表

| Agent | 职责 | 写权限 | 关键约束 |
|-------|------|--------|----------|
| `orchestrator` | 接收需求、管理 PRD 状态、协调三层派生、调度子 Agent、管理 review-fix 闭环 | ✅ 可写协调产物 | 不直接写业务代码；保持会话整洁；调用子 Agent 时使用独立上下文 |
| `prototype-designer` | 产出 PRD + 可点击前端原型；维护 PRD Change Log；推动 PRD 到 ready 状态 | ✅ | 只能写 `docs/02-product-requirements/`、`docs/prototypes/`；分支 `design/module-mvp-demo` |
| `prometheus-developer` | Prometheus 扩展 / Patch；技术预研 | ✅ | 优先扩展点，次选 patch；分支 `feat/module-XX` |
| `planner` | 两阶段规划：Phase 1 从 PRD 派生 L2；Phase 2 从 L2 派生 L3 | ❌ 只读 | 禁止 Write/Shell；Track A 只接受 `ready`，Track B/B+ 接受 `dev-ready`（须有豁免记录）；`mode: incremental` 除外；遇到 `[待验证]` 阻断 |
| `backend-developer` | 基于 PRD + L3 开发 Go 后端 | ✅ | 只能写 `platform/`、`patches/prometheus/`；分支 `feat/module-XX`；必须 TDD |
| `frontend-developer` | 基于 PRD + L3 开发 React 前端 | ✅ | 只能写 `ui-custom/web/`；分支 `feat/module-XX` |
| `build-resolver` | 修复构建/测试/lint 错误 | ✅ | 不引入新功能；在 `feat/module-XX` 上修复 |
| `golang-reviewer` | Go 代码审查 | ❌ 只读 | 读取结构化输入包（PRD 相关章节 + 契约 + diff）；关注代码隔离、测试、SSRF |
| `frontend-reviewer` | 前端代码审查 | ❌ 只读 | 读取结构化输入包（PRD 相关章节 + 契约 + 原型映射 + diff）；关注组件质量、安全 |
| `security-reviewer` | 安全审查 | ❌ 只读 | 读取结构化输入包（PRD 相关章节 + 契约 + 安全预检 + diff）；关注配置下发、上传、鉴权 |
| `git-guardian` | 提交前 Git 合规审查 | ❌ 只读 | 检查分支名、变更目录、commit message、提交前验证 |

---

## PRD 状态流转

| 状态 | 含义 | 允许的操作 |
|------|------|-----------|
| `draft` | PRD 草案 | prototype-designer 可自由修改 |
| `prototyping` | 原型验证中 | prototype-designer 修改 PRD 和原型 |
| `dev-ready` | Track B/B+ 轻量规格已获用户书面确认，免原型验证 | planner 可直派 L3；开发验收后回填 as-built 并补登 ready |
| `ready` | 已通过原型验证，可派生 Plan | plan-maintainer 可从此状态派生 L2 |
| `frozen` | 已切出 feat 分支进入开发 | 修改必须走变更请求（CR） |

---

## Skills

| Skill | 用途 | 对应 Agent |
|-------|------|-----------|
| `cncf-project` | 项目上下文、技术栈、常用命令 | 所有 Agent |
| `code-navigation` | 代码定位建议：文档/地图 → 定点查询 → 限定域全文扫 | 所有读写代码的 Agent |
| `cncf-git-workflow` | Gitflow、双空间隔离、目录写权限、提交单元、commit / PRD 修订规范 | 所有需要分支/提交操作的 Agent；reviewer 只读不加载 |
| `grill-with-docs` | 需求对齐、设计决策拷问 | orchestrator、prototype-designer |
| `api-standard` | API 契约优先级、路由、响应信封、字段命名、分页、枚举、鉴权、SSRF | backend / frontend / prometheus / planner / reviewer |
| `golang-coding-style` | Go 编码规范、R1–R4、migration、错误处理 | backend-developer、golang-reviewer |
| `prometheus-architecture` | Prometheus 架构、扩展点优先级、patch 规范、技术预研模板 | prometheus-developer |
| `testing-tdd` | TDD 循环、Go/前端测试、提交前验证矩阵、测试范围控制、flaky | developer、build-resolver、git-guardian |
| `dev-delivery` | 启动、任务粒度、提交单元、验证、执行记录、PRD 反馈、完成汇报 | developer、build-resolver |
| `code-review` | 独立审查协议、输入包、triage、成本控制、统一输出与复审 | golang / frontend / security reviewer |
| `security-review` | 鉴权/越权、注入、敏感信息、上传、配置下发、SSRF、Patch 安全 | security-reviewer；Track B+ 审查 |
| `using-git-worktrees` | 并行推进多模块时在开发空间加开 worktree | developer |
| `web-development` | 前端编码规范、原型一致性、antd 测试稳定模式、forceRender、测试范围 | frontend-developer、frontend-reviewer |

---

## Trae / OpenCode / Kimi 的 Skill 共享

> **单一源**：`.kimi/skills/`。跨工具共享镜像：`.agents/skills/`，由 `scripts/sync-skills.sh` 生成。
> OpenCode、Trae、Kimi Code CLI 会自动发现 `.agents/skills/`；传统 Kimi CLI 继续读取 `.kimi/skills/`。
> 修改 Skill 后执行 `make sync-skills`（或 `bash scripts/sync-skills.sh`），并用 `make check-skills` 校验。

### 当前跨工具入口

| 位置 | 用途 | 使用方式 |
|------|------|---------|
| `.kimi/skills/` | Skill 单一源 | 修改这里，然后执行 `bash scripts/sync-skills.sh` |
| `.agents/skills/` | 跨工具共享镜像（生成） | OpenCode / Trae / Kimi Code CLI 自动发现，**禁止手改** |
| `.trae/skills/codebase-architecture-explorer/` | 源码架构探索 | 在 Trae 对话中直接调用，分析 Prometheus / node_exporter 源码架构 |
| `.kimi/agents/*.md` | Agent 提示词 | 在 Trae / OpenCode 中需要扮演某角色时，复制对应 markdown 作为 system prompt 或上下文引用 |

### 未来 Kimi CLI / Kimi Code CLI 启用后

开通 Kimi CLI Agent 后，`.kimi/agents/*.md` 将作为角色提示词使用；传统 Kimi CLI 读取 `.kimi/skills/`，Kimi Code CLI 读取 `.agents/skills/`。可直接使用：

| Agent | 用途 |
|-------|------|
| `orchestrator` | 主控协调、PRD 状态管理、三层派生、review-fix 闭环 |
| `prototype-designer` | 快速原型设计、PRD 状态推进 |
| `prometheus-developer` | 技术预研、Prometheus 扩展 / Patch |
| `planner` | 只读规划：plan-maintainer + code-sequence-planner |
| `backend-developer` | Go 后端 TDD 开发 |
| `frontend-developer` | React 前端开发 |
| `build-resolver` | 修复构建错误 |
| `git-guardian` | 提交前 Git 合规审查 |
| `golang-reviewer` / `frontend-reviewer` / `security-reviewer` | 代码审查 |

### 协同规则

1. **统一 Skill 源**：源码架构探索、需求分析、代码编写、审查所需的项目知识统一维护在 `.kimi/skills/`；Trae / OpenCode / Kimi Code CLI 通过 `.agents/skills/` 镜像自动发现。

2. **架构结论沉淀到 .kimi**：分析出的核心模块、扩展点、数据流等结论，应及时更新到：
   - [`.kimi/skills/prometheus-architecture/SKILL.md`](skills/prometheus-architecture/SKILL.md)
   - [`.kimi/skills/cncf-project/SKILL.md`](skills/cncf-project/SKILL.md)
   然后执行 `bash scripts/sync-skills.sh`，让跨工具镜像同步更新。

3. **不删除 .kimi**：`.kimi/` 是当前项目的 Agent 团队资产与 Skill 单一源，即使暂时不用 Kimi CLI，也应保留目录和配置。

4. **避免重复建设**：Trae 专属 Skill 只放“Trae 特有入口/能力”；项目规范与知识放 `.kimi/skills/`，通过 `.agents/skills/` 共享，避免多份副本。

---

## Plugins

`cncf-devtools` 提供以下工具：

| 工具 | 作用 |
|------|------|
| `run_backend_tests` | 运行 `go test ./platform/...` |
| `run_backend_vet` | 运行 `go vet ./platform/...` |
| `run_build_prometheus` | 编译 `metric-center` |
| `run_frontend_lint` | 运行前端 `pnpm lint` |
| `run_frontend_test` | 运行前端全量 `pnpm test`（约 17 分钟，按 `testing-tdd` §4.2 使用） |
| `apply_patches` | 应用 `patches/prometheus/*.patch` |

---

## Hooks

| Hook | 事件 | 作用 |
|------|------|------|
| `auto-format.sh` | PostToolUse | 保存后自动格式化 Go/前端代码 |
| `block-oversized.sh` | PreToolUse | 阻止写入超过 800 行的文件 |
| `protect-env.sh` | PreToolUse | 阻止修改 `.env`、密钥等敏感文件 |
| `stop-verify.sh` | Stop | 会话结束前自动运行测试和 vet |

---

## 代码定位建议

需要读代码的 Agent 可参考 [`.kimi/skills/code-navigation/SKILL.md`](skills/code-navigation/SKILL.md) 的搜索顺序：

```
文档/地图 → 定点 Grep / Read → 限定域全文扫（兜底）
```

- `docs/04-source-architecture/repo-map.md`（`make repo-map` 生成）仅作可选辅助索引，不要求定位前先刷新或查询；是否维护按任务需要决定。
- `upstream/` 默认排除在搜索域外；Prometheus 架构结论优先查 `prometheus-architecture` Skill 与 `docs/04-source-architecture/`。

---

## Micro-task 规则

Micro-task 由 **planner Phase 2（code-sequence-planner）** 从 L2 派生，输出到：

```
docs/05-execution-records/module-XX/task-sequence.yaml
```

每个 micro-task 必须满足：

- **可一次完成**：人类工程师约 2-15 分钟工作量，能在一次 LLM Smart Zone 内完成
- **输入明确**：包含 PRD 路径、原型路径、L3 task_id、相关标准文件、起始 commit、期望输出
- **可独立验证**：有明确的测试/lint/服务验证命令
- **不跨职责**：后端、前端、Prometheus 扩展尽量拆成独立任务
- **有依赖关系**：明确 `depends_on`，Orchestrator 按依赖顺序派发

每个 micro-task 完成后，应调用 `new_context` 或启动新子 Agent，禁止把多个阶段塞进同一个会话。

---

## 标准工作流

1. **Orchestrator（chenrt）接收需求**
   - 确认模块编号
   - 检查当前 PRD 状态
2. **需求对齐**
   - 如果需求不清晰，调用 `grill-with-docs` 或 `AskUserQuestion`
3. **原型验证（prototype-designer）**
   - 基于 `develop` 创建 `design/module-mvp-demo`
   - 如果 PRD 中有 `[待验证]` 点，先派发 `prometheus-developer` 做技术预研
   - 输出/更新 PRD：`docs/02-product-requirements/Modules/Module_XX_*.md`
   - 输出可点击原型：`docs/prototypes/module-XX/`
   - 维护 Change Log
   - 将 PRD 状态推进到 **ready**（Track A）或 **dev-ready**（Track B/B+）
   - chenrt 发起 `design/module-mvp-demo → develop` 的 PR，guixm、zhaohy review
   - chenrt 以 `--no-ff` 合并到 `develop`
4. **Plan 派生（planner Phase 1: plan-maintainer）**
   - 输入：`ready`（Track A）或 `dev-ready`（Track B/B+，须有豁免记录）状态的 PRD
   - 输出/更新：`docs/02-product-requirements/04_Implementation_Map.md`
   - 输出/更新：`docs/02-product-requirements/05_Code_Implementation_Plan.md`
   - 确保 PRD 版本号 = Plan 版本号
5. **Code Sequence 派生（planner Phase 2: code-sequence-planner）**
   - 输入：L2 Plan
   - 输出：`docs/05-execution-records/module-XX/task-sequence.yaml`
6. **开发侧 Vibe Coding（backend-developer / frontend-developer / prometheus-developer）**
   - 基于最新 `develop` 创建 `feat/module-XX`
   - 强制读取 PRD + `docs/05-execution-records/module-XX/task-sequence.yaml`
   - 优先读取 `docs/prototypes/module-XX/` 原型；如缺失，以 PRD + L3 为准
   - 在开发空间 `CNCF_Monitor-feature` 中开发，只能修改各自允许的生产代码目录
   - 后端必须 TDD；验证按 `testing-tdd` §6 执行，前端默认单文件 / 变更范围回归，不无条件跑全量 `pnpm test`
   - 按 micro-task 逐个完成，每个任务结束后汇报 Orchestrator
   - 开发中发现 PRD 需要调整，必须报告 Orchestrator，禁止自行修改 PRD
7. **调用 reviewer agent 审查（独立 sub-agent 会话）**
   - Orchestrator 启动新的 sub-agent 调用 golang/frontend/security-reviewer
   - Reviewer 接收结构化输入包（变更清单 + 摘要 + 预检结果 + 高风险标注 + 已验证清单 + 契约快照 + diff 路径），按需切片读取
   - Reviewer 输出结构化报告（CRITICAL / HIGH / MEDIUM / LOW + APPROVE / REQUEST_CHANGES；安全用 PASS / FAIL）
8. **Review-Fix 闭环**
   - CRITICAL / HIGH：Orchestrator 打回给原 Developer 或对应 specialist 修复
   - MEDIUM / LOW：记录为遗留风险或快速修复
   - 修复完成后必须重新执行对应验证命令，并再次审查直至通过
9. **在开发空间 `CNCF_Monitor-feature` 中验证运行状态**：
   - 按 `testing-tdd` §6 的提交前验证矩阵执行；后端启动服务验证关键接口 200，前端启动 dev server 验证页面可访问
   - 前端默认单文件 / 变更范围回归，不无条件跑全量 `pnpm test`
   - 验证通过后必须停止服务并释放端口
10. **调用 git-guardian 做提交前审查**
    - 只有通过 Git Guardian 后，才输出建议的 `git commit` / `git push` 命令
11. **zhangwq 发起 `feat/module-XX → develop` 的 PR**
    - PR 描述包含来源 PRD/原型路径、L3 task-sequence 路径、测试结果、服务验证结果
    - GitHub Actions 自动部署预览环境，Bot 在 PR 评论区回复预览链接
12. **产品经理/业务方在线验收**
    - chenrt、zhaohy、guixm 点击预览链接，对照 `docs/prototypes/module-XX/` 原型验收
    - 在 GitHub PR 中评论或 Approve
13. **如验收通过，由 chenrt 在主仓库将 `feat/module-XX` 以 `--no-ff` 合并到 `develop`**
14. **在 develop 环境中再次验证运行状态**（步骤同 9）
15. **版本末跨模块联调（integration/vX.Y）**
    - 触发条件：本版本所有 `feat/module-XX` 已合并到 `develop`，PRD 修订表已标记「已冻结」，chenrt 宣布进入联调
    - Orchestrator 协调从 `develop` 切出 `integration/vX.Y`（如 `integration/v0.1`）
    - 联调记录统一写入 `docs/05-execution-records/integration/v0.1/`（README / plan / issues / e2e-results）
    - 已合并的 `feat/module-XX` 在联调窗口内冻结；所有联调修复只进 `integration/vX.Y`
    - 验收通过后，由 chenrt 以 `--no-ff` 合并 `integration/vX.Y` → `develop`；在合并点打版本基线 tag `baseline/vX.Y-*`（annotated，消息含各模块 PRD 冻结版本 + PR 编号 + 验收日期，规则见 Gitflow 指南 §2.5/§6.6），push 后删除该分支
16. 开发空间 `CNCF_Monitor-feature` 保留供下一模块复用（在克隆内切到新的 `feat/module-XX` 分支）

---

## 增量/修复阶段（`mode: incremental`）

缺陷修复 / 小优化 / PRD 滞后回填阶段的统一规则（不绑定具体人）：

- 任务卡标记 `mode: incremental`：首要输入 = 问题描述 + 验收标准 + 影响范围（`impact` / `regression_risk` / `estimated_effort` 必填）；已提交 PRD 仍为约束。
- 分支条件放宽：开发空间非 `main` / `develop` / `design/*` / `feature/prototype-*` 分支均可（含 `feature/zwq` 等既有维护分支，不强制改名）。
- **契约快照必须随代码同步**：跨端 API 变更（路由 / 字段 / 枚举 / 响应结构）必须更新 `api-contract-snapshot.md`；PRD 由 chenrt 每周收割 commit + `dev-feedback.md` 统一回填，快照不允许滞后。
- 原型不强制；Reviewer 按 `code-review` §3.1 轻量审查（免原型 / PRD 修订表检查）。
- 测试按 `testing-tdd` §4.3 最小范围（目标测试 + typecheck + lint + 服务启动）；全量按 §4.2。
- 技术债修复用 `debt:` 标记独立提交；不影响现有已实现功能即可放行，不要求用户逐条审批。
- scope 扩大（改模型 / 跨模块契约 / 核心安全逻辑）必须停下请用户确认。
- 详细规则见 `orchestrator.md`「增量/修复阶段」与 `dev-delivery` §1.1。

---

## 变更控制流程

一旦模块切出 `feat/module-XX`，PRD 进入 `frozen` 状态。开发中如需调整 PRD：

- **影响单个 micro-task**：Orchestrator 就地决策，记录到 `docs/05-execution-records/module-XX/design-decisions.md`
- **影响模块边界 / 数据模型 / API 契约**：
  1. Orchestrator 创建变更请求（CR）
  2. 架构师（用户）审批
  3. 如批准，切回 `design/module-mvp-demo` 更新 PRD + Change Log
  4. 重新调用 plan-maintainer 更新 L2
  5. 重新调用 code-sequence-planner 更新 L3
  6. 通知开发 Agent 调整

---

## 目录隔离铁律

| 目录 | 允许修改者 | 禁止修改者 |
|------|-----------|-----------|
| `docs/02-product-requirements/` | `prototype-designer` / chenrt 的 AI | `backend-developer`、`frontend-developer`、zhangwq 的 AI |
| `docs/prototypes/` | `prototype-designer` / chenrt 的 AI | `backend-developer`、`frontend-developer`、zhangwq 的 AI |
| `docs/05-execution-records/` | Orchestrator 协调写入；各 Agent 写入自己的执行记录 | 不允许覆盖其他 Agent 的记录 |
| `platform/` | `backend-developer`、`prometheus-developer`、zhangwq 的 AI | `prototype-designer`、chenrt 的 AI |
| `ui-custom/web/` | `frontend-developer`、zhangwq 的 AI | `prototype-designer`、chenrt 的 AI |
| `patches/prometheus/` | `prometheus-developer`、zhangwq 的 AI | `prototype-designer`、chenrt 的 AI |
| `upstream/` | 禁止直接修改 | 全部 Agent |
