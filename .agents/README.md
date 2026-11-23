# 跨工具项目资产

本目录存放**跨 harness 复用的项目知识**：

- `skills/`：按需加载的项目流程（`SKILL.md`）。**这是唯一 Skill 源**，直接修改，不再维护镜像或同步脚本。
- OpenCode、Trae 等支持 `SKILL.md` / `.agents/skills` 的工具会自动发现；不支持的工具只写 5–20 行适配器指向这里。

## 使用原则

1. 项目事实、命令、红线放 `AGENTS.md`。
2. 按需流程放 `.agents/skills/`，不要复制到工具专属目录。
3. 工具编排、子代理、hooks、格式化、worktree、记忆交给各 harness 自己。
4. 不提交工具本地状态（`.workbuddy/`、`.trae/` 草稿等）。

## 当前 Skills

| Skill | 用途 |
|-------|------|
| `cncf-git-workflow` | 分支、目录权限、commit、启动、验证、执行记录 |
| `testing-tdd` | TDD、Go/PG 测试、前端测试、验证矩阵 |
| `golang-coding-style` | V3 分层、migration、模块注册、错误处理 |
| `web-development` | React/AntD、契约优先、场景优先、forceRender、测试稳定 |
| `api-standard` | v3 契约、信封、分页、鉴权、SSRF |
| `code-review` | 独立审查、输入包、triage、安全专项、输出模板 |
| `srs-authoring` | 需求方：业务场景、面向结果验收、非目标与反定制 |
| `hld-design` | 技术方：场景→实现、能力抽象、演示脚本、Scenario Link |
