# CNCF_Monitor Agent 团队速查

## 核心架构：Orchestrator + Developer + Reviewer

```
用户请求
   │
   ▼
Orchestrator（主 Agent）
   │
   ├──► Planner（只读规划）
   ├──► Backend Developer（Go + Prometheus）
   ├──► Frontend Developer（React + TS）
   ├──► Prometheus Developer（源码扩展 / Patch）
   ├──► Build Resolver（修复构建错误）
   └──► Reviewer（只读审查）
            ├── Golang Reviewer
            ├── Frontend Reviewer
            └── Security Reviewer
```

## Agent 列表

| Agent | 职责 | 写权限 | 关键约束 |
|-------|------|--------|----------|
| `planner` | 输出实现计划、识别风险 | ❌ 只读 | 禁止 Write/Shell |
| `backend-developer` | Go 后端开发 | ✅ | 必须 TDD，必须在 worktree 中 |
| `frontend-developer` | React 前端开发 | ✅ | 必须在 worktree 中 |
| `prometheus-developer` | Prometheus 扩展 / Patch | ✅ | 优先扩展点，次选 patch |
| `build-resolver` | 修复构建/测试/lint 错误 | ✅ | 不引入新功能 |
| `golang-reviewer` | Go 代码审查 | ❌ 只读 | 关注代码隔离和测试 |
| `frontend-reviewer` | 前端代码审查 | ❌ 只读 | 关注组件质量和安全 |
| `security-reviewer` | 安全审查 | ❌ 只读 | 关注配置下发安全 |

## Skills

| Skill | 用途 | 对应 Agent |
|-------|------|-----------|
| `cncf-project` | 项目上下文、技术栈、常用命令 | 所有 Agent |
| `golang-coding-style` | Go 编码规范 | backend-developer |
| `prometheus-architecture` | Prometheus 架构与扩展点 | prometheus-developer |
| `testing-tdd` | TDD 流程与测试结构 | developer |
| `code-review` | 代码质量检查清单 | reviewer |
| `security-review` | 安全检查清单 | security-reviewer |
| `using-git-worktrees` | worktree 使用协议 | developer |
| `web-development` | 前端编码规范 | frontend-developer |

## Trae Skill 与 .kimi Skill 的关联

> **当前状态**：未购买 Kimi CLI Agent，所有交互入口统一在 **Trae IDE 对话面板**。`.kimi/` 目录完整保留，未来开通 Kimi CLI 会员后可直接启用，无需重建。

### 当前 Trae IDE 入口

| 位置 | 用途 | 当前使用方式 |
|------|------|-------------|
| `.trae/skills/codebase-architecture-explorer/` | 源码架构探索 | 在 Trae 对话中直接调用，分析 Prometheus / node_exporter 源码架构 |
| `.kimi/skills/` | 项目知识与规范 | 在 Trae 对话中通过引用相关 SKILL.md 文件作为上下文注入 |
| `.kimi/agents/*.md` | Agent 提示词 | 在 Trae 中需要扮演某角色时，直接复制对应 markdown 作为 system prompt 或上下文引用 |

### 未来 Kimi CLI 启用后

开通 Kimi CLI Agent 后，`.kimi/agents/*.yaml` 和 `.kimi/skills/` 将自动生效，可直接使用：

| Agent | 用途 |
|-------|------|
| `planner` | 只读规划 |
| `backend-developer` | Go 后端 TDD 开发 |
| `frontend-developer` | React 前端开发 |
| `prometheus-developer` | Prometheus 扩展 / Patch |
| `build-resolver` | 修复构建错误 |
| `golang-reviewer` / `frontend-reviewer` / `security-reviewer` | 代码审查 |

### 协同规则

1. **当前统一走 Trae**：源码架构探索、需求分析、代码编写、审查都通过 Trae IDE 完成，借助 `.trae/skills/` 和 `.kimi/skills/` 提供上下文。

2. **架构结论沉淀到 .kimi**：在 Trae 中分析出的核心模块、扩展点、数据流等结论，应及时更新到：
   - [`.kimi/skills/prometheus-architecture/SKILL.md`](skills/prometheus-architecture/SKILL.md)
   - [`.kimi/skills/cncf-project/SKILL.md`](skills/cncf-project/SKILL.md)
   这样未来切到 Kimi CLI 时，知识体系保持一致。

3. **不删除 .kimi**：`.kimi/` 是当前项目的 Agent 团队资产，即使暂时不用 Kimi CLI，也应保留目录和配置。

4. **避免重复建设**：Trae Skill 专注于“当前会话的源码探索与理解”，.kimi Skill 专注于“规范化开发知识”。两者共用同一套知识文件，只是入口不同。

## Plugins

`cncf-devtools` 提供以下工具：

| 工具 | 作用 |
|------|------|
| `run_backend_tests` | 运行 `go test ./platform/...` |
| `run_backend_vet` | 运行 `go vet ./platform/...` |
| `run_build_prometheus` | 编译 `metric-center` |
| `run_frontend_lint` | 运行前端 `pnpm lint` |
| `run_frontend_test` | 运行前端 `pnpm test` |
| `apply_patches` | 应用 `patches/prometheus/*.patch` |

## Hooks

| Hook | 事件 | 作用 |
|------|------|------|
| `auto-format.sh` | PostToolUse | 保存后自动格式化 Go/前端代码 |
| `block-oversized.sh` | PreToolUse | 阻止写入超过 800 行的文件 |
| `protect-env.sh` | PreToolUse | 阻止修改 `.env`、密钥等敏感文件 |
| `stop-verify.sh` | Stop | 会话结束前自动运行测试和 vet |

## 标准工作流

1. **Orchestrator 接收需求**
2. **调用 planner** 输出实现计划
3. **创建 git worktree**
4. **调用 developer agent** 在 worktree 中 TDD 开发
5. **调用 reviewer agent** 进行代码审查
6. 如有问题，返回 developer 修复
7. **合并分支并清理 worktree**
