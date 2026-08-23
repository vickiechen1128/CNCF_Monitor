# API 契约快照 — Module XX <模块名>

> **本文件是前后端并行的唯一权威契约**：前端以本快照为第一权威，PRD 第 5/6 章与 `03_API_Standard.md` 为补充；**禁止**反向以 `platform/models/*.go` 为实现依据（并行开发时后端未实现，抄对端代码是最高频翻车点）。
>
> 快照再生成条件：PRD 第 5/6 章变更、`03_API_Standard.md` 变更、后端模型字段变更、或进入新 Phase 前。发生任一变更时旧版快照作废，必须重新派生。
>
> 使用方式：复制本文件到 `docs/05-execution-records/module-XX/api-contract-snapshot.md`，按模块填充（完整示例见 `docs/05-execution-records/module-07/api-contract-snapshot.md`）。

## 0. 快照元信息

| 项 | 值 |
|----|----|
| Phase | Phase N |
| 模块 | module-XX-<功能名> |
| 分支 | feat/module-XX-<功能名> |
| 版本 | vYYYY-MM-DD（新建 / 第 N 版） |
| 生成方式 | planner Phase 2 派生（code-sequence-planner） |
| 来源 | PRD `Module_XX_*.md` §3/§5/§6/§8/§11；`03_API_Standard.md` §7；`task-sequence.yaml` |

## 1. 通用契约

### 1.1 前缀与响应

- 前缀：`/api/v2/platform`（或本模块实际前缀；若与 PRD 写的前缀不一致，必须在 §2 记录偏差）
- 统一响应：`{status: success, data}` / `{status: error, errorType, error}`

### 1.2 errorType 枚举

`bad_request` / `unauthorized` / `forbidden` / `not_found` / `internal` / `conflict`

### 1.3 分页信封

| 接口 | 信封 | 默认/上限 |
|------|------|-----------|
| <列出所有分页接口> | `list` 或 `items` 键 | page/page_size 默认与上限 |

> ⚠️ 前端消费时必须按接口区分 `list` / `items` 信封；空结果一律返回 `[]` 而非 `null`。

## 2. 路径偏差说明（PRD → 实际实现）

| PRD §6 原文 | 实际实现（前端消费） | 原因 |
|-------------|---------------------|------|
| | | |

## 3. <资源/业务对象> API

| 方法 | 路径 | Query / 请求体 | 响应 data | 业务错误 | PRD 源 |
|------|------|----------------|-----------|----------|--------|
| GET | | | | | |

## 4. <下一组> API

（按模块实际 API 分组展开，逐条列出 method / path / query / body / 响应字段 / 枚举 / 错误码 / 必填口径）

## N. 枚举字典

| 枚举 | 取值 | 说明 |
|------|------|------|
| | | |

## N+1. 字段必填口径

- <对象> 创建必填：<字段清单>
- <对象> 更新可改 / 不可改：<字段清单>

## N+2. UI 展示名映射（字段 ↔ 用户语言）

| 接口字段（snake_case） | UI 展示名 | 备注 |
|------------------------|-----------|------|
| | | |

## N+3. 来源对照表

- PRD：`docs/02-product-requirements/Modules/Module_XX_*.md` §3/§5/§6/§8/§11
- 标准：`docs/03-engineering-standards/03_API_Standard.md` §7
- 序列：`docs/05-execution-records/module-XX/task-sequence.yaml`
