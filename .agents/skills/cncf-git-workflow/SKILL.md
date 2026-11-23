---
name: cncf-git-workflow
description: "MetricCenter Git 工作流与开发交付：分支、目录权限、commit 单元、启动协议、验证、执行记录与完成汇报"
---

# Git 工作流与开发交付

本 Skill 是所有开发类 Agent 的 Git 与交付基线。审查类 Agent 只读，不执行分支/提交操作。V3 代码线统一使用 `/api/v3/platform/*` 与 PostgreSQL-only 迁移。

---

## 1. 空间与分支

```text
设计空间（SRS / 设计）：CNCF_Monitor-worktree
开发空间（生产代码）  ：CNCF_Monitor-feature
```

| 空间 | 分支 | 工作内容 |
|------|------|----------|
| 设计空间 | `design/module-mvp-demo` | SRS、设计、决策 |
| 开发空间（标准） | `feat/module-XX` / `fix/module-XX` | 生产代码 |
| 开发空间（rewrite） | `rewrite/vX.Y` | SRS + 代码 + schema 同分支演进 |

```bash
pwd
git branch --show-current
```

- 开发空间默认串行：一个时间只推进一个模块或一个 rewrite 模块。
- 零耦合任务确需并行时，使用各 harness 原生 worktree 能力或 `git worktree add`，用完即删。
- 不在正确空间/分支时先切换；无法判断时报告 Orchestrator，禁止自行切到 `main` / `develop`。

---

## 2. 分支模型

| 分支 | 用途 | 来源 | 合并目标 |
|------|------|------|----------|
| `main` | 稳定/生产 | - | - |
| `develop` | 已验收代码 SSOT | `main` | - |
| `design/module-mvp-demo` | SRS + 设计 | `develop` | `develop` |
| `feat/module-XX` | 标准功能 | `develop` | `develop` |
| `fix/module-XX` | 缺陷修复 | `develop` | `develop` |
| `rewrite/vX.Y` | 产品级版本重写 | `develop` | `develop`（发布时） |
| `rewrite/vX.Y-module-XX` | 重写期模块并行（短期） | `rewrite/vX.Y` | `rewrite/vX.Y` |
| `release/*` | 版本发布 | `develop` | `main` + `develop` |
| `hotfix/*` | 生产紧急修复 | `main` | `main` + `develop` |

### rewrite 分支规则

- `rewrite/vX.Y` 上 SRS 为 living document，按里程碑打 `baseline`；不使用 `frozen` 作为开发前置。
- API 新线统一 `/api/v3/platform/*`；旧 `/api/v2/*` 仅作回归对照。
- schema 允许直接演进，但一次变更 = 独立 commit + migration（Up/Down）+ 回滚说明 + 数据对账。
- 发布时 `--no-ff` 合回 `develop`，打 `baseline/vX.Y`。

---

## 3. 目录与写权限

| 目录 | 允许写入 | 禁止写入 |
|------|----------|----------|
| `docs/02-product-requirements/` | 需求 Owner / 技术 Owner | developer、reviewer |
| `docs/prototypes/`（V2 已归档） | 不维护 | developer、reviewer |
| `docs/05-execution-records/` | 各 Agent 写自己的执行记录 | 覆盖他人记录 |
| `platform/modules/`、`platform/foundation/`、`platform/models/`、`platform/db/`、`platform/cmd/` | backend / prometheus developer | frontend、reviewer |
| `platform/edge-sync-agent/` | backend（独立 Go module） | frontend |
| `ui-custom/web/` | frontend | backend |
| `upstream/` | 仅 patch 流程中的最小化修改 | 直接新增业务代码 |
| `patches/prometheus/` | prometheus developer；backend 仅在任务明确要求时 | frontend |
| `.agents/skills/`、`docs/03-engineering-standards/`、`AGENTS.md` | 项目 Owner + 任务明确要求 | 借任务夹带无关改动 |
| `scripts/`、`Makefile`、CI | 任务明确要求并经确认 | 借机改构建/CI |

- Reviewer 全部只读，不写入任何目录。
- `upstream/` 必须通过 `patches/prometheus/*.patch` 管理；目录不存在时先按任务创建并写 README。

---

## 4. Commit Message

```text
<type>(<scope>): <简短描述>

- 详细说明 1
- 详细说明 2

关联: docs/05-execution-records/module-XX/<agent>.md
```

| 分支 | type |
|------|------|
| `design/*` | `design(module-XX): ...` |
| `feat/*` | `feat(module-XX): ...` |
| `fix/*` | `fix(module-XX): ...` |
| `rewrite/vX.Y` | `docs:` / `schema:` / `feat:` / `test:` / `refactor:` |
| `release/*` | `release: ...` |
| `hotfix/*` | `hotfix: ...` |

- 全部小写，禁止 emoji，禁止 `update`、`fix bug` 等无意义描述。
- `feat` / `fix` 必须携带 task id（如 `T07-05~07`），并关联执行记录。
- `schema:` 必须列出 migration 文件路径；schema 变更单独 commit。
- `refactor:` 仅用于纯 rename/move/结构搬移，不引入行为变化；不再单独维护“技术债/还债”流程。
- 禁止把 `docs:`、`schema:`、代码搬移、新功能混在一个 commit。
- 修改 SRS 时同步更新 Change Log；冻结期规则按 `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`。

---

## 5. 提交单元

**提交单元 = 一个可回退、可验证、可审查的功能闭环。**

- 可回退：`git revert` 丢掉的是一个完整功能，不是半成品。
- 可验证：commit 前测试 / vet / lint / 服务启动按任务类型通过。
- 可审查：一句话能说清，reviewer 能按 commit 分片推进。

| 角色 | 推荐提交单元 | 禁止 |
|------|-------------|------|
| backend | 接口闭环（CRUD / 导入 / 下发可用） | 跨功能块、半成品、多个任务堆积 |
| frontend | 页面功能块（列表 + 表单抽屉可用） | 跨页面、半成品 |
| prometheus | 扩展点 / patch 闭环 | 无说明的源码修改 |

- 默认 1 个 micro-task ≈ 1 个 commit。
- 相邻且单独提交会留下死代码的小任务可合并；跨模块、跨功能块禁止合并。
- 不要等所有任务做完再一次性提交。

---

## 6. 启动协议

每个任务开始前：

1. **确认分支与空间**：按 §1；标准任务在 `feat/module-XX`，rewrite 任务在 `rewrite/vX.Y`。
2. **读取任务卡指定输入**：只读任务卡列出的精确路径与章节；典型输入为 SRS 场景、HLD、`Scenario Link`、`task-sequence.yaml`、`api-contract-snapshot*`、相关标准。
3. **读取 Skill**：按任务类型读取 `golang-coding-style` / `web-development` / `api-standard` / `testing-tdd`；缺失时停止并报告。
4. **验证基线**：按任务类型安装依赖并跑一次最小基线；基线失败先报告，不带病开发。
5. **确认范围**：发现需要改模型、跨模块契约、核心安全逻辑时，先停下确认。

### 增量/修复（`mode: incremental`）

- 首要输入是任务卡（问题描述 + 验收标准 + 影响范围），已提交 SRS 仍为约束。
- 原型不强制（V2 已归档）；跨端契约变更必须同步更新契约快照。
- 修复中发现 scope 扩大，停止并请确认。

### 版本重写（`mode: rewrite`）

- 输入：`docs/05-execution-records/rewrite/vX.Y/charter.md`、`plan.md`、模块 `assessment.md` / `task-sequence.yaml`。
- 新 SRS 是 living document；developer 不得自行改 SRS。
- 范围允许重开发、API v3、schema 演进；不再要求行为等价。
- 完成定义：模块验收 + 代码审查 + handover 材料齐全。

---

## 7. 任务粒度与上下文

- 一个子任务应能在一次 Smart Zone 内完成（约 2–15 分钟人类工程师工作量）。
- 任务过大时先拆分并汇报，不硬撑长会话。
- 完成一个子任务、验证通过并 commit 后，再进入下一个任务或新上下文。
- 禁止用“摘要压缩”代替新会话。

---

## 8. 提交前验证

按 `testing-tdd` 的验证矩阵执行。最低要求：

- 后端：目标包测试 + `go vet` + 服务启动 + 关键接口 200。
- 前端：目标测试 + `typecheck:test` + `pnpm lint` + dev server 页面 200。
- 涉及 migration：`make test-platform` + 空库/基线库 Up/Down。
- 验证完成后停止服务并释放端口。
- 未执行或失败的验证不得用“应该没问题”代替。

---

## 9. 执行记录

每个 micro-task 验收并 commit 后立即追加到：

```text
docs/05-execution-records/module-XX/<agent>.md
```

每条至少包含：

- task id / commit hash
- 新增/修改文件
- 关键实现说明
- 遇到的问题与解决方案
- 验证结果（命令 + 关键输出）
- 与契约/SRS 的偏离（如有）

Agent 调用结束后再写总结性收尾：输入文档、遗留风险、下一步。

---

## 10. SRS / 场景反馈

| 类型 | 标准/增量 | rewrite |
|------|-----------|---------|
| SRS 空白（边界值、校验细节等未规定） | 可自行定，写入 `dev-feedback.md` | 可自行定，写入 `rewrite/vX.Y/decisions.md` |
| SRS 已规定但实现发现矛盾 | 实现前报告，走 CR/决策 | 报告；由 SRS owner 更新，不自行改 |
| 场景演示中的技术优化 | 可自行定，写入反馈单 | 可自行定，写入 `decisions.md` |

反馈格式：SRS 场景 / 设计章节 + 现状 + 建议修正 + 影响模块 + 发现场景。

---

## 11. 完成汇报

返回给 Orchestrator：

1. 修改文件列表
2. 新增/修改测试
3. 验证命令与结果
4. commit 列表（hash + task id）
5. 执行记录路径
6. 契约/SRS 偏离说明
7. 阻塞项与是否需要其他 Agent 配合
8. 是否需要 Orchestrator 介入（CR / 环境 / 任务调整 / push）

---

## 12. 停止与升级

遇到以下情况必须停止并报告：

- Skill 文件缺失或与任务卡冲突
- 基线验证失败且无法定位
- SRS 已规定内容与实现矛盾
- 需要修改 `upstream/` 但无法通过 patch 解决
- task-sequence 顺序错误、依赖未实现
- 环境问题（子模块缺失、GOROOT 错配、网络代理）

---

## 13. 反合理化

| 借口 | 反驳 |
|------|------|
| “改动很小，不用写测试” | 小改动也会破坏现有行为；测试不是可选项 |
| “先实现再补测试” | 代码先于测试会被要求删除或重写 |
| “用户急着要，跳过验证” | 未验证的 commit 不是交付物 |
| “Skill 内容我已经知道” | 知道 ≠ 执行；必须读取并按 Skill 执行 |
| “task-sequence 太细，我按自己理解做” | task-sequence 是任务边界，偏离必须报告 |
| “SRS 和实现对不上，我顺便改 SRS” | developer 只报告，不自行改 SRS |
| “schema 改一下不用 migration” | 必须 migration + 回滚 + 对账 |
| “先 commit 半成品，后面再补” | 半成品无法 revert / bisect / 联调 |

---

## 14. 常用命令

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

## 15. 相关 Skill

- `testing-tdd`：测试命令、验证矩阵、flaky
- `golang-coding-style`：Go 分层、migration、模块注册
- `web-development`：前端规范、antd、forceRender
- `api-standard`：v3 契约、信封、分页、鉴权、SSRF
- `code-review`：审查输入包、严重级别、安全专项
- `srs-authoring`：需求场景
- `hld-design`：场景→实现与演示脚本
