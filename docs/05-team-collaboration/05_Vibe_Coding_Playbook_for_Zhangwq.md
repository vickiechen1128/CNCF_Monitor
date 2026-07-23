# MetricCenter Vibe Coding 执行手册（zhangwq 专用）

> 文档类型：团队协作规范  
> 目标读者：zhangwq（SRE 工程师 / Vibe Coding 执行者 / 工程质量 Owner）  
> 更新日期：2026-07-22

---

## 1. 目标

本手册是 zhangwq 在 MetricCenter 项目中使用 AI Agent 进行 Vibe Coding 的**执行层 SOP**，与 [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) 流程互补，但更聚焦在：

- 如何把 Module 文档转化为 AI 可执行的 prompt
- 如何监督 AI 在正确范围、正确分支、正确 worktree 内开发
- 如何对 AI 输出进行人工 Review 与测试补强
- 如何执行提交前验证并产出合并申请

> AI Agent 是生产工具，不是责任主体。**最终代码质量、安全性和可运维性由 zhangwq 和 chenrt 共同负责。**

---

## 2. 工作流总览

```
接收 chenrt 任务单
        │
        ▼
准备：worktree、feature 分支、必读文档
        │
        ▼
设计 prompt（背景 + 输入 + 输出 + 约束 + 验收）
        │
        ▼
调用 Agent 生成代码（backend / frontend / prometheus / build-resolver）
        │
        ▼
人工 Review（安全 / 正确性 / 可维护性 / 可测试性）
        │
        ▼
补充异常路径与集成测试
        │
        ▼
提交前验证（go test/vet、pnpm test/lint、服务启动）
        │
        ▼
提交代码 + 创建执行记录
        │
        ▼
向 chenrt 提交合并申请
```

---

## 3. 开发前检查清单

### 3.1 环境检查

| 检查项 | 命令 | 期望结果 |
|--------|------|----------|
| 在固定 worktree 内 | `git rev-parse --git-dir` | 包含 `.git/worktrees/` |
| 在正确 feature 分支 | `git branch --show-current` | `feature/module-XX-<功能名>` |
| 分支基于最新 develop | `git log --oneline -1` | 与 origin/develop 同步 |
| 后端环境 | `go version` | 与 `go.mod` 一致 |
| 前端环境 | `pnpm --version` / `node --version` | 符合项目要求 |

### 3.2 文档准备

调用 Agent 前，必须确认以下文档已就绪并已在 prompt 中指定：

| 文档 | 用途 |
|------|------|
| `docs/02-product-requirements/Modules/Module_XX_*.md` | 需求、业务规则、验收标准 |
| `docs/03-engineering-standards/00_Engineering_Standard.md` | 目录结构、技术栈 |
| `docs/03-engineering-standards/01_Code_Isolation_Standard.md` | 代码隔离边界 |
| `docs/03-engineering-standards/03_API_Standard.md` | API 路径、响应格式 |
| `docs/03-engineering-standards/04_Testing_Standard.md` | 测试要求、服务验证 |
| `docs/03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md` | 分支策略 |
| `.kimi/AGENTS.md` | Agent 角色说明 |

> 如果文档缺失或不清晰，先找 chenrt 确认，**不要直接让 AI 自行发挥**。

---

## 4. Prompt 设计模板

### 4.1 Prompt 五要素

每个给 AI 的 prompt 必须包含：

1. **背景**：当前模块目标、依赖模块、当前阶段
2. **输入**：需要阅读的文档路径、已有代码路径
3. **输出**：需要修改/新增的文件列表、预期行为
4. **约束**：API 前缀、数据模型、安全要求、代码风格
5. **验收标准**：测试命令、服务启动验证、人工检查点

### 4.2 后端开发 Prompt 模板

```markdown
请作为 backend-developer，基于以下信息完成 Module XX 的后端开发。

**必读文档**：
- docs/02-product-requirements/Modules/Module_XX_*.md
- docs/03-engineering-standards/03_API_Standard.md
- docs/03-engineering-standards/04_Testing_Standard.md
- docs/03-engineering-standards/01_Code_Isolation_Standard.md

**任务**：
1. 实现 XXX API（列出具体接口）
2. 实现 XXX 业务逻辑
3. 补充单元测试

**约束**：
- 平台能力 API 使用 /api/v2/platform/* 前缀
- 使用 GORM + SQLite
- 所有导出函数必须有注释
- URL 解析必须校验 scheme 和 host，防范 SSRF
- 不直接修改 upstream/ 源码，需要时生成 patch

**验收标准**：
1. go test ./platform/... 通过
2. go vet ./platform/... 通过
3. 启动服务后，关键接口返回正确 JSON
4. 关联执行记录：docs/04-execution-records/module-XX-<功能名>/backend-developer.md
```

### 4.3 前端开发 Prompt 模板

```markdown
请作为 frontend-developer，基于以下信息完成 Module XX 的前端页面开发。

**必读文档**：
- docs/02-product-requirements/Modules/Module_XX_*.md
- docs/03-engineering-standards/02_Frontend_Standard.md
- docs/03-engineering-standards/03_API_Standard.md

**任务**：
1. 实现 XXX 页面
2. 对接 XXX API
3. 补充基础渲染测试

**约束**：
- React 18 + TypeScript + Vite + Ant Design 5
- 使用 pnpm 管理依赖
- 错误状态必须处理（加载中、空数据、请求失败）
- 不直接修改上游 UI 组件源码

**验收标准**：
1. pnpm test 通过
2. pnpm lint 通过（0 errors / 0 warnings）
3. 启动 dev server 后页面可访问
4. 关联执行记录：docs/04-execution-records/module-XX-<功能名>/frontend-developer.md
```

### 4.4 Reviewer Prompt 模板

```markdown
请作为 golang-reviewer / frontend-reviewer，Review 当前 feature 分支的代码变更。

**必读文档**：
- docs/02-product-requirements/Modules/Module_XX_*.md
- docs/03-engineering-standards/03_API_Standard.md
- docs/03-engineering-standards/04_Testing_Standard.md

**审查范围**：
- 列出本次变更的文件或 git diff 范围

**审查重点**：
1. 安全性（SSRF、SQL 注入、路径遍历、敏感信息泄露）
2. 正确性（是否符合 Module 文档和 API 标准）
3. 可维护性（函数/文件长度、命名、重复代码）
4. 可测试性（happy path、异常路径、边界情况）

**输出要求**：
- 如通过：给出 "APPROVE" 结论
- 如需要修改：给出 "REQUEST_CHANGES"，按优先级列出问题，并给出修复建议
- 关联执行记录：docs/04-execution-records/module-XX-<功能名>/golang-reviewer.md
```

---

## 5. Agent 调用速查表

| 任务类型 | 调用 Agent | 适用场景 | 负责人 |
|----------|-----------|----------|--------|
| 模块实现计划 | `planner` | Module 开发前，输出任务拆分 | chenrt |
| 可点击原型 | `prototype-designer` | 需求确认前，产出原型 | chenrt |
| 后端代码开发 | `backend-developer` | 实现后端 API 与业务逻辑 | zhangwq |
| 前端代码开发 | `frontend-developer` | 实现前端页面与交互 | zhangwq |
| Prometheus 扩展分析 | `prometheus-developer` | 分析 Prometheus 源码/扩展点 | zhangwq |
| 构建/测试修复 | `build-resolver` | 修复编译、测试、依赖问题 | zhangwq |
| 后端代码审查 | `golang-reviewer` | Review Go 代码 | zhangwq |
| 前端代码审查 | `frontend-reviewer` | Review 前端代码 | zhangwq |
| 安全审查 | `security-reviewer` | 关键变更安全复核 | zhangwq |

> 调用前先在 prompt 中指定**必读文档**和**验收标准**，调用后必须保存执行记录。

---

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

---

## 7. 测试补强指南

### 7.1 AI 测试常见遗漏

AI 通常擅长 happy path，但容易遗漏：

- 异常输入（空、超长、特殊字符、非法字符集）
- 并发读写
- 权限边界
- 依赖服务不可用
- 数据库迁移兼容性
- 前端加载失败 / 网络异常

### 7.2 zhangwq 必须补充的测试

#### 后端

- 空输入、超大值、特殊字符
- 404、400、校验失败、500 场景
- 并发读写同一资源
- 数据库迁移兼容性（如修改了模型）

#### 前端

- 空列表状态
- 加载失败状态
- 表单校验边界（必填、长度、格式）
- 网络异常处理（超时、重试）

---

## 8. 提交前验证清单

### 8.1 后端验证

```bash
# 静态检查
go test ./platform/...
go vet ./platform/...

# 服务启动验证（验证完成后必须停止）
go run ./platform/cmd/metric-center/main.go

# 验证关键接口
curl http://localhost:8080/api/v1/health
curl http://localhost:8080/api/v1/health/db
curl http://localhost:8080/api/v1/status
```

### 8.2 前端验证

```bash
# 静态检查
cd ui-custom/web
pnpm test
pnpm lint

# 服务启动验证（验证完成后必须停止）
exec ./node_modules/.bin/vite --host

# 验证页面
curl -I http://localhost:5173/
```

### 8.3 通过标准

| 检查项 | 通过标准 |
|--------|----------|
| `go test ./platform/...` | 全部通过 |
| `go vet ./platform/...` | 无问题 |
| `pnpm test` | 全部通过 |
| `pnpm lint` | 0 errors / 0 warnings |
| 后端服务启动 | 关键接口返回 200 |
| 前端 dev server | 页面返回 200 |

### 8.4 验证后清理

验证完成后必须停止服务并释放端口：

```bash
# 停止后端服务
Ctrl+C

# 停止前端服务
Ctrl+C
```

---

## 9. 提交规范

### 9.1 Commit 格式

```
<模块>: <动作> - <简短描述>

- 关联执行记录: docs/04-execution-records/module-XX-<功能名>/<agent>.md
- 变更范围: platform/xxx, ui-custom/web/xxx
```

### 9.2 Commit 类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 |
| `docs` | 文档 |
| `test` | 测试 |
| `refactor` | 重构 |
| `chore` | 工程事务 |
| `prototype` | 原型设计 |

### 9.3 Commit 示例

```
module-07-resource-management: 实现资源 CRUD 与 Excel 导入

- 新增 Host/Middleware/Application CRUD API
- 新增 Excel 批量导入与错误行返回
- 新增 Excel 模板下载

关联: docs/04-execution-records/module-07-resource-management/backend-developer.md
```

---

## 10. 合并申请模板

向 chenrt 提交合并申请时，使用以下结构：

```markdown
## 合并申请

**分支**：feature/module-XX-<功能名>
**来源 Module**：docs/02-product-requirements/Modules/Module_XX_*.md

**变更范围**：
- platform/xxx/...
- ui-custom/web/...

**测试结果**：
- go test ./platform/...：通过
- go vet ./platform/...：通过
- pnpm test：通过
- pnpm lint：通过

**服务验证**：
- 后端服务启动成功，/api/v1/health 返回 200
- 前端 dev server 启动成功，/ 返回 200

**Review 结论**：
- 自查通过 / 发现 XX 问题已修复

**执行记录**：
- docs/04-execution-records/module-XX-<功能名>/

**风险点**：
- XXX

**建议下一步**：
- 合并到 develop
```

---

## 11. 执行记录模板

每个 Agent 调用结束后，在 `docs/04-execution-records/module-XX-<功能名>/` 下创建执行记录：

```markdown
# 执行记录：backend-developer / Module XX

## 1. 任务目标

## 2. 输入

- Module 文档路径
- 涉及的工程标准

## 3. 输出

- 新增/修改的文件列表
- 关键实现说明

## 4. 遇到的问题

## 5. 解决方案

## 6. 验证结果

- go test：通过 / 失败
- go vet：通过 / 失败
- 服务启动：通过 / 失败

## 7. 遗留风险

## 8. 下一步
```

---

## 12. 常见问题与处理

### Q1：AI 生成的代码偏离了 Module 文档怎么办？

1. 立即停止当前 Agent 继续生成
2. 指出具体偏离点，给出正确方向
3. 必要时回到 Module 文档与 chenrt 确认
4. 重新设计 prompt 后再次调用

### Q2：AI 修改了不该修改的文件怎么办？

1. 检查变更范围：`git status` / `git diff --stat`
2. 如果改动不大，可要求 AI 还原并重新生成
3. 如果改动混乱，考虑丢弃当前分支重建（见 [`06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md)）

### Q3：提交前验证失败，但 AI 已经生成了大量代码怎么办？

1. 先定位失败原因（编译错误、测试失败、lint 错误）
2. 调用 `build-resolver` 修复构建/测试问题
3. 修复后重新执行完整验证清单
4. 不要绕过验证直接提交

### Q4：如何在多个模块之间切换？

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

## 13. 禁止事项

1. **禁止绕过提交前验证直接申请合并**。
2. **禁止在 feature 分支混入其他模块改动**。
3. **禁止直接修改 `upstream/` 源码**；必须走 patch 流程。
4. **禁止未经 chenrt 批准直接合并到 `develop`**。
5. **禁止在未经批准的情况下切换 AI 模型或工具**。
6. **禁止让 AI 在 worktree 外直接开发并提交**。

---

## 14. 相关文档

- [`00_Team_Charter.md`](00_Team_Charter.md) — 团队守则
- [`01_Role_Responsibilities.md`](01_Role_Responsibilities.md) — 角色职责速查表
- [`03_Code_Collaboration_Workflow.md`](03_Code_Collaboration_Workflow.md) — 代码编写与提交环节详细流程
- [`../03-engineering-standards/05_AI_Agent_Collaboration_Standard.md`](../03-engineering-standards/05_AI_Agent_Collaboration_Standard.md) — AI Agent 协作细则
- [`../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md`](../03-engineering-standards/06_Gitflow_Branch_and_Rollback_Guide.md) — 分支策略与回退指南
