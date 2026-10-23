---
name: prometheus-architecture
description: "Prometheus 源码架构、扩展点优先级、upstream 隔离、patch 规范、技术预研报告模板与验证命令，prometheus-developer 专用"
---

# Prometheus 架构与扩展规范

本 Skill 是 prometheus-developer 的领域基线。Git 分支 / 目录 / commit 规则见 `cncf-git-workflow`；开发交付流程见 `dev-delivery`；测试与验证见 `testing-tdd`。

---

## 1. 核心模块

| 模块 | 关键文件 | 职责 |
|------|----------|------|
| 入口 | `cmd/prometheus/main.go` | 启动流程、组件装配 |
| 配置 | `config/config.go` | YAML 配置解析与校验 |
| 服务发现 | `discovery/discovery.go` | Discoverer 接口与管理器 |
| 采集 | `scrape/manager.go` | 抓取任务管理 |
| 存储 | `storage/interface.go` | 存储抽象 |
| TSDB | `tsdb/db.go` | 时序数据库 |
| 查询 | `promql/engine.go` | PromQL 引擎 |
| 规则 | `rules/manager.go` | 规则引擎 |
| 通知 | `notifier/manager.go` | 告警通知 |
| Web API | `web/api/v1/` | HTTP API |

---

## 2. 扩展点

| 扩展点 | 接口 / 机制 | 适用场景 | 优先级 |
|--------|-------------|----------|--------|
| 服务发现 | `discovery.Discoverer` | 自定义目标发现 | 高 |
| 远程写入 | `storage.Appendable` | 数据转发 | 高 |
| 远程读取 | `storage.Queryable` | 外部存储查询 | 高 |
| 配置扩展 | `config` + `scrape` 配置结构 | 新增配置字段 / 任务类型 | 中 |
| Web API | `web/api/v1` 路由注册 | 新增查询 / 管理接口 | 中 |
| 独立组件 / Sidecar | Gateway、adapter、bridge | 不适合侵入源码的能力 | 中 |
| Patch 源码 | `patches/prometheus/*.patch` | 扩展点无法满足 | 低（最后手段） |

```go
type Discoverer interface {
    Run(ctx context.Context, up chan<- []*targetgroup.Group)
}
```

数据流：

```text
发现源 → Discovery Manager → Scrape Manager → scrapeLoop → TSDB → Query/Rule
```

---

## 3. 扩展优先级

1. **优先扩展点**：使用 Prometheus 提供的接口（Discoverer、Appendable、Queryable、Web API 等）。
2. **次选独立组件 / Sidecar**：通过 Gateway、adapter、bridge 实现，不改 upstream。
3. **最后才 patch**：必须修改源码时，严格按 patch 规范执行，最小化 diff。

选择方案时必须说明：

- 为什么扩展点不够用；
- 独立组件为什么不可行；
- patch 的影响范围、升级风险、回滚方式。

---

## 4. 目录与 upstream 隔离

| 目录 | 规则 |
|------|------|
| `platform/` | 可写：扩展组件、adapter、bridge 等业务代码 |
| `patches/prometheus/` | 可写：patch 文件与 README |
| `upstream/prometheus/` | **禁止直接新增业务代码文件**；只允许为生成 patch 做最小化修改，且不得提交 upstream 子模块指针变更 |
| `docs/02-product-requirements/`、`docs/prototypes/` | 禁止修改 |
| `ui-custom/web/` | 禁止修改（共享类型需 Orchestrator 确认） |
| `docs/` 其他目录 | 仅允许写自己的执行记录 / 预研报告 |

- `upstream/` 是 Git 子模块，禁止把业务代码提交进子模块。
- patch 是 upstream 修改的唯一交付物；应用 patch 后的源码状态不进入 Git。
- 发现 upstream 有未提交修改时，先确认是否为自己产生；不是自己的修改必须报告 Orchestrator，禁止覆盖。

---

## 5. Patch 规范

### 5.1 生成

```bash
cd upstream/prometheus
git diff > ../../patches/prometheus/0001-<description>.patch
```

- 文件名：`0001-<短描述>.patch`，序号递增。
- patch 必须由 `git diff` 生成，禁止手工拼接。
- 修改前确认 upstream 工作区干净；修改后只保留本次 patch 所需的 diff。
- 生成后恢复 upstream 工作区（`git checkout -- .` 或 `git stash`），确保 patch 可重复应用。

### 5.2 README 必填

`patches/prometheus/README.md` 每个 patch 必须记录：

- patch 用途 / 对应 PRD 章节
- 影响范围（文件、函数、行为）
- 验证方法（应用命令、编译命令、关键测试）
- 升级 upstream 时的注意事项 / 冲突风险
- 回滚方式

### 5.3 验证

```bash
make apply-patches
make build-prometheus
make test-platform
```

- patch 必须能重新应用到干净的 upstream。
- 编译必须通过；受影响的上游测试必须运行或在 README 标注原因。
- 验证完成后再次确认 upstream 工作区状态，避免把临时修改带入 commit。

### 5.4 禁止

- 禁止在 `upstream/prometheus/` 直接新增业务代码文件。
- 禁止大量修改 `tsdb/`、`promql/engine.go` 等高风险区域；确需修改必须经 Orchestrator 和用户双重确认。
- 禁止无 README 的源码修改。
- 禁止把 patch 应用后的 upstream 修改直接 commit 到 feature 分支。
- 禁止修改 `docs/02-product-requirements/`、`docs/prototypes/`。

---

## 6. 技术预研报告模板

输出到 `docs/05-execution-records/module-XX/tech-feasibility.md`：

```markdown
# 技术预研报告：module-XX

## 待验证问题

清晰列出本次预研要回答的问题。

## 涉及的开源组件

- 组件名称与版本
- 相关源码路径
- 官方文档依据

## 验证方法

- 阅读的源码文件与函数
- 实验用的配置、命令、测试用例
- 复现环境说明

## 验证结果

### 方案 A：使用 Prometheus 扩展点

- 可行性：可行 / 部分可行 / 不可行
- 实现思路
- 限制与风险

### 方案 B：独立组件 / Sidecar

- 可行性：可行 / 部分可行 / 不可行
- 实现思路
- 限制与风险

### 方案 C：Patch 源码

- 可行性：可行 / 部分可行 / 不可行
- 影响范围
- 升级 upstream 时的风险

## 结论

推荐方案及理由。

## 对 PRD 的建议修改

- 需要新增 / 修改 / 删除哪些 PRD 内容
- 是否需要调整模块边界或数据模型
```

预研规则：

- 禁止在预研阶段直接修改 PRD。
- 禁止在无实验证据（源码、文档、可复现实验）的情况下给出“可行”结论。
- 超出 Prometheus 生态范围的问题，报告 Orchestrator。
- 预研报告只写 `docs/05-execution-records/module-XX/`，不改 PRD / 原型。

---

## 7. 开发验证

```bash
# 后端单元测试 / 静态检查
go test ./platform/...
go vet ./platform/...

# patch 应用与编译（如生成 patch）
make apply-patches
make build-prometheus
```

- 所有测试通过；`go vet` 无错误。
- patch 必须能正常应用并编译通过。
- 服务启动验证按 `testing-tdd` 执行（如涉及 API）。
- 验证完成后汇报修改文件、patch、测试结果、是否误改 `docs/` / `upstream/`。

---

## 8. 常见反模式

| 借口 | 反驳 |
|------|------|
| “直接改 upstream 更快” | 直接改源码会导致升级困难；优先扩展点，其次 patch |
| “patch 很小，不用写 README” | 任何 patch 都必须有 README，否则无法追溯 |
| “扩展点不够，必须改 engine” | 高风险改动必须经 Orchestrator 和用户双重确认 |
| “测试通过就不用验证 patch 应用” | patch 文件本身必须能重新应用，这是独立验证项 |
| “预研凭经验就能下结论” | 预研必须基于代码、文档或实验证据 |
| “先改 PRD 再实现” | 开发分支禁止修改 PRD；矛盾报告 Orchestrator 走 CR |
