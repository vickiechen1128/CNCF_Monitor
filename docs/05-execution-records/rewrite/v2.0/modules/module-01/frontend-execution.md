# M01 前端迁移执行记录

> **分支**：`rewrite/v2.0`
> **范围**：F1 v3 契约层（类型 + API 客户端）；F2/F3 页面切换待后续
> **状态**：F1 完成（2026-11-16）

---

## 1. F1 变更清单

| 产物 | 说明 |
|---|---|
| `ui-custom/web/src/types/strategyV3.ts` | v3 类型：字符串 UUID、`sync` 状态、`credential_configured`、规则校验/指标/业务指标/拨测模块 |
| `ui-custom/web/src/api/strategyV3.ts` | 6 组客户端：exporter templates / mappings / scrape jobs / rules / metric library / business metrics / probe modules |
| `ui-custom/web/src/api/strategyV3.test.ts` | 路径、请求体、分页信封、label-template 专用端点、规则 validate 契约测试 |

关键差异（相对 v2 客户端）：

- 前缀统一 `/api/v3/platform/*`；列表信封 `{list,total,page,page_size}`。
- Job 响应不再有 `change_status` / `blackbox_targets`，改为 `sync` + `credential_configured`。
- mapping 的 `label_template_id` 通过 `PUT /ci-exporter-mappings/{id}/label-template` 写入。
- 规则预检统一 `POST /monitoring-rules/validate`（`{id, rule_content}`）。
- 新增业务指标与拨测模块 CRUD 客户端。
- 删除 v2 的 `batchSubmitReady`（v3 无批量草稿）。

---

## 2. 验证

```text
$ cd ui-custom/web
$ pnpm vitest run src/api/strategyV3.test.ts
✓ 6 tests passed

$ pnpm run typecheck:test
# 无输出（通过）

$ pnpm exec eslint src/api/strategyV3.ts src/api/strategyV3.test.ts src/types/strategyV3.ts
# 无输出
```

---

## 3. 后续（F2/F3/F4）

1. **F2 Job 页面**：列表/表单/详情改 `scrapeJobApiV3`；用 `sync.status` 替换 `change_status` 列；移除 pending 锁与批量草稿；实例候选/实例/预演对接 v3。
2. **F3 规则/指标库/采集器/拨测模块**：规则页切 `ruleApiV3.validate`；指标库/业务指标/拨测模块切 v3 客户端。
3. **F4 测试门禁**：目标目录 vitest、`typecheck:test`、`pnpm lint`；删除 v2 客户端与相关测试。

> 旧 `/api/v2` 客户端在页面迁完前保留，避免半迁移导致页面不可用。
