---
name: dev-delivery
description: "MetricCenter 开发交付协议：启动、任务粒度、提交单元、验证、执行记录、PRD 反馈与完成汇报，适用于 developer / prometheus-developer / build-resolver"
---

# 开发交付协议

本 Skill 定义所有开发类 Agent（backend-developer、frontend-developer、prometheus-developer、build-resolver）共用的交付流程。角色专属规则仍写在各自 Agent 文件中。

---

## 1. 启动协议

每个任务开始前按顺序执行：

1. **读取强制 Skill**
   - 所有开发 Agent：`cncf-project`、`cncf-git-workflow`、`dev-delivery`
   - 按任务类型追加：`golang-coding-style` / `web-development` / `prometheus-architecture` / `api-standard` / `testing-tdd`
   - 缺失 Skill 文件时停止并报告 Orchestrator。
2. **确认空间与分支**
   - 按 `cncf-git-workflow` 确认设计空间 / 开发空间与当前分支。
   - 开发任务必须在 `feat/module-XX`；不在正确分支时按 Skill 切换，禁止自行切到 `main` / `develop`。
3. **读取任务卡指定输入**
   - 只读 Orchestrator 任务卡列出的精确路径与章节；不要全文读取 PRD 或协作标准。
   - 典型输入：PRD 指定章节、`task-sequence.yaml`、`api-contract-snapshot.md`、原型页面、相关工程标准。
   - `task-sequence.yaml` 缺失不阻断：以 PRD + 任务卡为准继续，并在汇报中标注「task-sequence 缺失」。
4. **验证基线**
   - 按任务类型安装依赖并跑一次最小基线；基线失败先报告 Orchestrator，不要带病开发。

### 1.1 增量/修复阶段（`mode: incremental`，PRD 滞后回填）

任务卡标记 `mode: incremental` 时适用本节；未标记时按默认流程。分支条件放宽：开发空间中非 `main` / `develop` / `design/*` / `feature/prototype-*` 的分支均可（含 `feat/module-XX`、`fix/module-XX`、`feature/zwq` 等既有维护分支，不强制改名）。

- **首要输入是任务卡**（问题描述 + 验收标准 + 影响范围），已提交 PRD 仍为约束。
- 不强制 PRD 章节 / 原型 / `frontend-prototype-map.md`；缺失不阻断。
- **跨端契约变更必须同步更新 `api-contract-snapshot.md`**（见 `api-standard` §1.1）；PRD 回填由 chenrt 每周统一完成。
- 实现与已提交 PRD 冲突时，先报告 Orchestrator，不直接覆盖 PRD 意图。
- 修复过程中发现 scope 扩大（需改模型 / 影响其他模块 / 改核心安全逻辑），停止并请 Orchestrator 确认后继续。
- 验收方式：用户对接人体验验收；验收通过后由 chenrt 回填 PRD。

---

## 2. 任务粒度与上下文

- 一个子任务应能在一次 Smart Zone 内完成（约 2–15 分钟人类工程师工作量）。
- 任务过大时先拆分并汇报拆分结果，不要硬撑长会话。
- 完成一个子任务、验证通过并 commit 后，再进入下一个任务或 `new_context`。
- 禁止用「摘要压缩」代替 `new_context`。

---

## 3. 提交单元

**提交单元 = 一个可回退、可验证、可审查的功能闭环。**

### 3.1 成立标准

1. **可回退**：`git revert` 该 commit 丢掉的是一个完整功能，不是半成品。
2. **可验证**：commit 前工作区必须绿（测试 / vet / lint / 服务启动按任务类型）。
3. **可审查**：一句话能说清这个 commit 做了什么，reviewer 能按 commit 分片推进。

### 3.2 粒度参考

| 角色 | 推荐提交单元 | 可合并条件 | 禁止 |
|------|-------------|-----------|------|
| backend | 接口闭环（如资源 CRUD 可用） | 相邻 + 同功能块 + 单独提交会留下死代码 | 跨功能块、半成品、多个任务堆积 |
| frontend | 页面功能块（列表 + 表单抽屉可用） | 相邻 + 同页面 + 单独提交页面残缺 | 跨页面、半成品、多个任务堆积 |
| prometheus | 扩展点 / patch 闭环 | 同一能力的最小 patch + 验证 | 无说明的源码修改、跨模块 patch |
| build-resolver | 一次失败修复批次 | 同类失败且同一根因 | 借机重构、引入新功能 |

- 默认 **1 个 micro-task ≈ 1 个 commit**。
- `feat` / `fix` 提交必须携带 task id（如 `T07-05~07`、`T07-F3~F4`）。
- commit message 格式、分支类型、关联执行记录见 `cncf-git-workflow`。
- 不要等所有任务做完再一次性提交；也不要把一个功能块拆成无法独立验证的多个半成品 commit。

### 3.3 技术债修复提交（增量/修复阶段）

- 技术债修复必须与功能修复 / 新功能**分开提交**，commit 标题或正文携带 `debt:` 标记（如 `fix(module-07): debt: 补齐 resource service 分层（T07-05）`）。
- 放行标准：**不影响现有已实现功能**（现有测试 + 服务启动验证通过）即可，不需要用户逐条审批。
- 每笔还债在执行记录中登记：还了什么债、验证结果；涉及 R1–R4 的同步更新 `feature-debt-control.md` 对应条目。
- 新功能仍禁止新增技术债（R1–R4 照常执行）；还债是修复既有问题，不是新债。

---

## 4. 提交前验证

按 `testing-tdd` 的「提交前验证矩阵」执行。最低要求：

- 后端：目标包测试 + `go vet` + 服务启动 + 关键接口 200。
- 前端：单文件/单目录测试 + `typecheck:test` + `pnpm lint` + dev server 页面 200。
- Patch：`make apply-patches` + `make build-prometheus`。
- 验证完成后停止服务并释放端口。
- 未执行或失败的验证不得用「测试应该没问题」代替。

---

## 5. 执行记录

每个 micro-task 验收通过并 commit 后，**立即追加**到：

```
docs/05-execution-records/module-XX/<agent>.md
```

每条至少包含：

- task id
- commit hash
- 新增/修改文件
- 关键实现说明
- 遇到的问题与解决方案
- 验证结果（命令 + 关键输出）
- 与契约 / PRD 的偏离（如有）

Agent 调用结束后再写总结性收尾：输入文档、遗留风险、下一步。

---

## 6. PRD / 原型反馈义务

开发中发现 PRD / 原型细节问题，PRD / 原型文件与版本号照旧禁止修改。按三类处置：

| 类型 | 处置 |
|------|------|
| ① PRD 空白（边界值、校验细节、字段长度等未规定） | 可直接定，但必须写入 `docs/05-execution-records/module-XX/dev-feedback.md` 留痕 |
| ② PRD 已规定但实现发现矛盾（字段语义、契约冲突） | **实现前**报告 Orchestrator，走 CR / PM 决策；禁止先改实现再补反馈单 |
| ③ 原型纯技术优化（组件结构、mock 修复、交互细节） | 可直接定，写入反馈单留痕 |

反馈单格式：PRD 章节 / 原型文件位置 + 现状 + 建议修正 + 影响模块 + 发现场景。

---

## 7. 完成汇报

返回给 Orchestrator 的汇报至少包含：

1. 修改的文件列表
2. 新增/修改的测试
3. 验证命令与结果（测试 / vet / lint / 服务启动）
4. commit 列表（hash + task id）
5. 执行记录路径
6. 契约 / PRD 偏离说明（如有）
7. 阻塞项与是否需要其他 Agent 配合
8. 是否需要 Orchestrator 介入（CR / 环境 / L3 调整 / push）

---

## 8. 停止与升级

遇到以下情况必须停止并报告 Orchestrator：

- Skill 文件缺失或内容与任务卡冲突
- 基线验证失败且无法定位
- PRD 已规定内容与实现矛盾（②类）
- 需要修改 `upstream/` 但无法通过 patch 解决
- task-sequence 顺序错误、依赖未实现
- 环境问题（子模块缺失、GOROOT 错配、网络代理）

---

## 9. 反合理化

| 借口 | 反驳 |
|------|------|
| "这个改动很小，不用写测试" | 小改动也会破坏现有行为；TDD / 测试不是可选项 |
| "先实现再补测试" | 代码先于测试会被要求删除或重写 |
| "用户急着要，跳过验证" | 未验证的 commit 不是交付物 |
| "这个 Skill 的内容我已经知道" | 知道 ≠ 执行；必须读取并按 Skill 执行 |
| "task-sequence 太细，我按自己理解做" | task-sequence 是任务边界，偏离必须报告 |
| "PRD 和实现对不上，我顺便改 PRD" | 开发分支禁止修改 PRD；矛盾必须走 CR |
| "等所有任务做完再一起提交" | 禁止堆积提交；每个功能块闭环即 commit |
| "先 commit 半成品，后面再补" | 半成品无法 revert / bisect / 联调，必须等功能闭环 |
