# MetricCenter AI Agent 协作标准

> 文档类型：工程标准
> 目标：规范 AI Agent 在 MetricCenter 项目中的协作方式，确保代码质量和文档一致性。
> 更新日期：2026-07-16

---

## 1. AI Agent 工作流

```
接收任务 → 读取相关 PRD / 标准 → 设计方案 → 编码 → 测试 → 提交
```

---

## 2. 任务开始前必读

AI Agent 接到任何开发任务前，必须读取以下文档：

| 文档 | 用途 |
|------|------|
| `docs/02-product-requirements/Modules/Module_XX_*.md` | 理解模块需求 |
| `docs/03-engineering-standards/00_Engineering_Standard.md` | 了解目录结构和技术栈 |
| `docs/03-engineering-standards/01_Code_Isolation_Standard.md` | 明确代码隔离边界 |
| `docs/03-engineering-standards/03_API_Standard.md` | 了解 API 规范 |
| `.trae/skills/codebase-architecture-explorer/SKILL.md` | 源码分析 Skill |

---

## 3. 编码规范

### 3.1 不直接修改 upstream

- 所有业务代码写在 `platform/` 或 `ui-custom/`
- 必须修改 upstream 时，先生成 patch 到 `patches/prometheus/`

### 3.2 不编造接口

- API 设计必须符合 `03_API_Standard.md`
- 数据模型变更需同步更新对应 PRD

### 3.3 小步变更

- 每个功能点独立提交
- 单次变更尽量控制在 500 行以内

### 3.4 先写测试或同步写测试

- 后端新增功能必须包含 `*_test.go`
- 前端新增组件必须包含基础渲染测试

---

## 4. 文档同步要求

代码变更后，AI Agent 必须同步更新以下文档：

| 变更类型 | 需要更新的文档 |
|----------|----------------|
| 新增模块 | `docs/02-product-requirements/Modules/` |
| 修改 API | `docs/03-engineering-standards/03_API_Standard.md` |
| 修改目录结构 | `docs/03-engineering-standards/00_Engineering_Standard.md` |
| 修改代码隔离规则 | `docs/03-engineering-standards/01_Code_Isolation_Standard.md` |
| 修改前端规范 | `docs/03-engineering-standards/02_Frontend_Standard.md` |
| 新增 patch | `patches/prometheus/README.md` |

---

## 5. Skill 使用

当 AI Agent 需要理解源码架构时，应调用 `.trae/skills/codebase-architecture-explorer`。

调用方式：在任务描述中说明