# 跨工具 Skill 共享与 Agent 瘦身（Phase 1 + Phase 2）

> **状态**：Phase 1 已落地；Phase 2（Agent 瘦身）已完成（2026-10-23）；Phase 3 待启动。
> **范围**：`.kimi/skills/`、`.agents/skills/`、`.kimi/agents/`、`scripts/sync-skills.sh`、CI 校验、测试标准对齐
> **关联文档**：根 `AGENTS.md` §3、`.kimi/AGENTS.md`「Trae / OpenCode / Kimi 的 Skill 共享」

---

## 1. 背景

项目此前的 Agent / Skill 资产集中在 `.kimi/`。随着 Trae、OpenCode、Kimi Code CLI 并行使用，需要回答：

- Skill 能否只维护一份，被多个工具自动发现？
- Agent 是否也需要跨工具共享？
- 是否值得为跨工具维护一套生成/同步流水线？

Phase 1 解决 **Skill 层**；Phase 2 解决 **Agent 提示词瘦身**。Agent 跨工具适配留到 Phase 3。

---

## 2. 兼容性结论

| 工具 | Skill 自动发现目录 | 说明 |
|------|-------------------|------|
| Kimi（传统 CLI） | `.kimi/skills/` | 当前项目主要入口 |
| Kimi Code CLI | `.agents/skills/`、`.kimi-code/skills/` | 新版 Kimi 已支持 `.agents/skills` |
| OpenCode V2 | `.opencode/skills`、`.claude/skills`、`.agents/skills` | 本阶段验证通过 |
| Trae | `.trae/skills`、`.agents/skills` | 官方更新日志已说明支持 `.agents/skills` |

因此选择 **`.agents/skills/` 作为跨工具共享镜像**。

---

## 3. 决策

### 3.1 单一源

- **`.kimi/skills/` 是唯一维护入口**；
- `.agents/skills/` 是生成物，禁止手改；
- 不移动现有 `.kimi/skills/`，避免影响传统 Kimi CLI。

### 3.2 为什么用生成镜像而不是软链接

| 方案 | 结论 | 原因 |
|------|------|------|
| 软链接 `.agents/skills -> ../.kimi/skills` | 不采用 | Windows 下 Git 软链不可靠 |
| 生成镜像 + CI 校验 | 采用 | 跨平台稳定，差异可被 CI 捕获 |

### 3.3 同步与校验

```bash
make sync-skills    # 同步 .kimi/skills -> .agents/skills
make check-skills   # 校验镜像是否与单一源一致
```

底层脚本：`scripts/sync-skills.sh`。

CI：`.github/workflows/check-skills-sync.yml`，在 Skill 或脚本变更时运行 `check`。

### 3.4 Frontmatter 标准化

所有 `.kimi/skills/*/SKILL.md` 已补充：

```yaml
---
name: <skill-id>
description: "<一句话说明：做什么 + 什么时候用>"
---
```

原因：

- OpenCode 没有 `description` 时不会向模型展示 Skill；
- Trae / Kimi 的 `SKILL.md` 规范也要求 `name` / `description`；
- `name` 与目录名保持一致，保证 Skill ID 可预测。

---

## 4. 验证结果

### 4.1 Phase 1

- `bash scripts/sync-skills.sh check` 通过；
- `make check-skills` 通过；
- 当时 11 个 Skill 的 YAML frontmatter 解析通过；
- OpenCode 已自动发现 `.agents/skills/` 下的 Skill；
- Trae 官方文档确认支持 `.agents/skills/` 自动加载；
- 传统 Kimi 继续读取 `.kimi/skills/`，内容与镜像一致。

### 4.2 Phase 2

- Skill 数量从 11 增至 **13**：新增 `api-standard`、`dev-delivery`；
- 所有 13 个 Skill frontmatter 校验通过；
- `make sync-skills && make check-skills` 通过，`.agents/skills/` 与单一源一致；
- Agent 总行数从 **3606 → 2626**（约 -27%），主要开发 / 审查角色显著下降：

| Agent | 瘦身前 | 瘦身后 |
|-------|-------:|-------:|
| backend-developer | 275 | 138 |
| frontend-developer | 391 | 148 |
| prometheus-developer | 288 | 159 |
| build-resolver | 170 | 129 |
| golang-reviewer | 170 | 68 |
| frontend-reviewer | 173 | 72 |
| security-reviewer | 174 | 71 |
| git-guardian | 255 | 142 |

- 所有 Agent 明确列出必须加载的 Skill 及路径；Reviewer 统一引用 `code-review` 的输入包 / 输出模板；
- 测试策略已与 `testing-tdd` 对齐：`docs/03-engineering-standards/04_Testing_Standard.md` §4.1、`02_Frontend_Standard.md` §6 / 门禁表、`05_AI_Agent_Collaboration_Standard.md` §3.5 / §3.6、`06_Gitflow_Branch_and_Rollback_Guide.md` §7.2 / §7.4、根 `AGENTS.md` §5.3 / §8.2 / §8.4；
- `cncf-project` 已更新 Go 1.26.1、`.agents/skills`、`.kimi/skills` 单一源与常用命令；
- `git diff --check` 无 whitespace 错误；
- Phase 2 未修改任何生产代码（`platform/`、`ui-custom/web/`）。

---

## 5. 阶段推进

### Phase 2：Agent 瘦身（已完成）

目标：把通用规范下沉到 Skill，Agent 只保留角色、边界、权限、必须加载的 Skill 列表与角色专属流程。

**新增 Skill：**

- `api-standard`：契约优先级、路由、响应信封、字段命名、分页、枚举、鉴权、SSRF；
- `dev-delivery`：启动、任务粒度、提交单元、验证、执行记录、PRD 反馈、完成汇报。

**扩展 / 重写 Skill：**

| Skill | 吸收的内容 |
|-------|-----------|
| `cncf-git-workflow` | 双空间、分支、目录写权限、提交单元、task id、PRD 修订表与冻结期 |
| `golang-coding-style` | R1–R4、migration、包注释、文件 / 函数长度、SSRF |
| `testing-tdd` | TDD 循环、Go / 前端测试分级、验证矩阵、17 分钟全量限制、flaky |
| `web-development` | 契约优先、原型一致性 8 项核对、forceRender、antd 测试稳定模式、测试范围 |
| `code-review` | 独立审查协议、结构化输入包、triage-then-deep、成本控制、统一输出、复审 |
| `security-review` | 安全预检、鉴权 / 越权、注入、敏感信息、上传、配置下发、SSRF、Patch 安全 |
| `prometheus-architecture` | 扩展点优先级、patch 规范、upstream 隔离、技术预研模板、验证命令 |

**Agent 改动：**

- developer / reviewer / build-resolver / git-guardian 重写为“角色 + 边界 + Skill 列表 + 专属流程”；
- orchestrator / planner / prototype-designer 做定向瘦身，删除重复 Gitflow / API / 预研模板，保留角色专属编排规则；
- 所有 Agent 保留显式 Skill 路径，兼容传统 Kimi CLI 按路径加载。

**不在 Phase 2 范围：**

- Trae / OpenCode Agent 配置文件生成；
- Agent 角色行为的大幅重构；
- 生产代码改动。

### Phase 3：跨工具 Agent 适配（待实施）

- OpenCode：`opencode.json` 的 `agents` + `{file:.kimi/agents/<name>.md}`；
- Trae：生成 `.trae/agents/<name>.md`；
- 增加同步脚本与 CI 校验。

### Phase 4：Skill 自优化（可选、远期）

- 先稳定 Skill 格式与边界；
- 再评估 OpenCode 插件（如 `agent-autolearn`）或自建 hook；
- 项目级 Skill 的自动更新必须经人工确认 + PR，不直接写 `main`。

---

## 6. 增量/修复阶段模式（2026-10-23 追加）

项目进入「代码先行、每周回填 PRD」的维护阶段后，补充统一的**增量/修复阶段模式**（`mode: incremental`），不绑定具体人员：

- **判定**：任务卡显式标记 `mode: incremental`；分支条件放宽为开发空间中非 `main` / `develop` / `design/*` / `feature/prototype-*` 的分支（含 `feature/zwq` 等既有维护分支，不强制改名）。
- **契约分层**：`api-contract-snapshot.md`（`api-standard` §1.1）必须随跨端契约变更同步更新；PRD 允许每周滞后回填，由 chenrt 收割 commit + `dev-feedback.md` 完成。
- **审查降级**：`code-review` §3.1 增量审查——基线为任务卡验收标准 + 快照 + dev-feedback；免原型 / PRD 修订表 / S/A/B 核对；`debt:` 提交只验证不影响现有功能。
- **测试最小化**：`testing-tdd` §4.3——目标测试 + typecheck + lint + 服务启动；全量仅按 §4.2 三种情形。
- **scope 控制**：任务卡必含 impact / regression_risk / estimated_effort；修复中发现 scope 扩大必须停下请用户确认。
- **改动文件**：`api-standard`、`dev-delivery`、`code-review`、`testing-tdd`、`golang-coding-style`、`cncf-git-workflow`、`orchestrator`、`planner`、`backend-developer`、`frontend-developer`、`golang-reviewer`、`frontend-reviewer`、`security-reviewer`、`git-guardian`。
