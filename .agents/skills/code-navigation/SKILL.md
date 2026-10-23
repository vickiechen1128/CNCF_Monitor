---
name: code-navigation
description: "在 MetricCenter 仓库中定位代码的推荐搜索顺序与工具使用策略，帮助 Agent 用最小 token 成本找到目标代码"
---

# Code Navigation（代码定位建议）

> 适用对象：所有需要读代码的 Agent（developer、reviewer、build-resolver、prometheus-developer）。
> 目标：用尽量小的搜索成本定位代码，避免大面积 Grep/Read 造成的 token 浪费。

## 搜索顺序（建议）

接到"找某个功能/符号/bug 位置"的任务时，建议按以下顺序逐级降级；不强制逐层，优先选择成本最低且能直接命中的方式：

### 第 1 层：查现成文档与地图（零搜索成本）

1. **模块级导航**：`docs/02-product-requirements/04_Implementation_Map.md`（模块 → 能力 → 实施层），以及各模块 L3 `docs/05-execution-records/module-XX/task-sequence.yaml`（micro-task 里有相关文件路径）。
2. **符号索引（可选）**：`docs/04-source-architecture/repo-map.md`（`make repo-map` 生成）可作为辅助索引；它可能滞后于当前代码，命中后仍需 `Read` 源文件确认。
3. **上游架构结论**：查 `upstream/prometheus` 行为/扩展点时，先读 `.kimi/skills/prometheus-architecture/SKILL.md` 与 `docs/04-source-architecture/`，**不要**直接扎进上游源码。

### 第 2 层：结构化 / 定点查询

- 已知文件路径 → 直接 `Read`，不要先 Grep 验证存在性。
- 已知精确符号名 → `Grep` 搜符号名（如 `func CreateNetworkDomain`），限定 `path` 到 `platform/` 或 `ui-custom/web/src/`。
- 结构性问题（"所有注册 Gin 路由的地方""所有 GORM 模型"）→ 用带结构的正则一次性查全，而不是逐个文件翻。

### 第 3 层：词法兜底

只有前两层都失败时才做大范围全文搜索，并且：

- **必须缩小搜索域**：用 `path` / `glob` 限定到 `platform/`、`ui-custom/web/src/` 等具体目录。
- **`upstream/` 默认排除**：它是只读子模块、体量占全仓库 95% 以上。除非任务明确是 Prometheus 源码预研，否则不要在其中全文搜索。
- 宽搜索命中后，把结论（符号 → 文件 → 职责）**沉淀回架构文档**，避免下个 Agent 重复搜索。

## repo-map（可选工具）

- `repo-map.md` 由 `make repo-map` 生成，**请勿手改**；需要时运行 `make repo-map` 刷新。
- Agent 定位代码**不要求**先刷新或查询 repo-map，按上面的搜索顺序直接检索即可；仓库也不对其施加提交/合并门禁。

## 架构结论沉淀

- 探索中发现的稳定架构结论（模块职责、数据流、扩展点），写入 `docs/04-source-architecture/` 或对应 `.kimi/skills/*/SKILL.md`，遵循"架构结论沉淀到 .kimi"规则。

## 反模式（禁止）

- ❌ 一上来就 `Grep` 全仓库搜关键词（尤其是把 `upstream/` 扫进去）。
- ❌ 反复 grep → 读文件 → 再 grep 的"散步式"定位，超过 3 轮仍未命中应停下，回到第 1 层查文档/地图或向 Orchestrator 报告。
- ❌ 手工编辑 `repo-map.md`。
- ❌ 把 `upstream/prometheus` 源码当业务代码排障的第一现场。
