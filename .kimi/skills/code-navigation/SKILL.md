# Code Navigation（代码定位纪律）

> 适用对象：所有需要读代码的 Agent（developer、reviewer、build-resolver、prometheus-developer）。
> 目标：排障 / 定位代码时**先查地图、再查符号、最后才全文扫**，避免大面积 Grep/Read 造成的 token 浪费。

## 搜索升级阶梯（Escalation Ladder）

接到"找某个功能/符号/bug 位置"的任务时，**必须**按以下顺序逐层降级，禁止跳级：

### 第 1 层：查现成地图（零搜索成本）

1. **模块级导航**：`docs/02-product-requirements/04_Implementation_Map.md`（模块 → 能力 → 实施层），以及各模块 L3 `docs/05-execution-records/module-XX/task-sequence.yaml`（micro-task 里有明确的相关文件路径）。
2. **符号级地图**：`docs/04-source-architecture/repo-map.md`（`make repo-map` 生成）。
   - 用符号名（函数 / 类型 / 接口 / React 组件名）在本文件里检索，命中后直接 `Read` 目标文件。
   - 注意地图的生成时间与 commit 在文件头部；如果与当前 HEAD 差距大、或按图索骥发现符号已不存在，先 `make repo-map` 刷新再继续。
3. **上游架构结论**：查 `upstream/prometheus` 行为/扩展点时，先读 `.kimi/skills/prometheus-architecture/SKILL.md` 与 `docs/04-source-architecture/`，**不要**直接扎进上游源码。

### 第 2 层：结构化 / 定点查询

地图未命中、需要精确定位时：

- 已知文件路径 → 直接 `Read`，不要先 Grep 验证存在性。
- 已知精确符号名 → `Grep` 搜符号名（如 `func CreateNetworkDomain`），限定 `path` 到 `platform/` 或 `ui-custom/web/src/`。
- 结构性问题（"所有注册 Gin 路由的地方""所有 GORM 模型"）→ 用带结构的正则一次性查全，而不是逐个文件翻。

### 第 3 层：词法兜底

只有前两层都失败时才做大范围全文搜索，并且：

- **必须缩小搜索域**：用 `path` / `glob` 限定到 `platform/`、`ui-custom/web/src/` 等具体目录。
- **`upstream/` 默认排除**：它是只读子模块、体量占全仓库 95% 以上。除非任务明确是 Prometheus 源码预研，否则不要在其中全文搜索。
- 宽搜索命中后，把结论（符号 → 文件 → 职责）**沉淀回地图来源文档**，避免下个 Agent 重复搜索。

## 地图维护纪律（已流程化强制）

- `repo-map.md` 是生成物，**禁止手改**；刷新命令：`make repo-map`。
- 新鲜度**由流程强制，不靠自觉**：
  - **本地 pre-commit hook**：提交涉及 `platform/`、`ui-custom/web/src/` 或地图本身时自动运行 `scripts/check-repo-map.sh`，过期即拒绝提交（`make install-git-hooks` 启用，`setup.sh` 已集成）。
  - **CI 门禁**：`.github/workflows/check-repo-map.yml` 在 PR / push 到 develop/main 时运行同一检查，不一致则阻断合并。
  - **审查预检**：`scripts/review-precheck.sh` 报告中包含 repo-map 新鲜度项。
  - 手动校验：`make check-repo-map`。
- 校验只对比符号清单，忽略头部时间戳/commit 行，不会因单纯重新生成而误报。
- 探索中发现的稳定架构结论（模块职责、数据流、扩展点），写入 `docs/04-source-architecture/` 或对应 `.kimi/skills/*/SKILL.md`，遵循"架构结论沉淀到 .kimi"规则。

## 反模式（禁止）

- ❌ 一上来就 `Grep` 全仓库搜关键词（尤其是把 `upstream/` 扫进去）。
- ❌ 反复 grep → 读文件 → 再 grep 的"散步式"定位，超过 3 轮仍未命中应停下，回到第 1 层查地图或向 Orchestrator 报告。
- ❌ 手工编辑 `repo-map.md`。
- ❌ 把 `upstream/prometheus` 源码当业务代码排障的第一现场。
