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

## 3. F2 进展（同步状态展示基座）

| 产物 | 说明 |
|---|---|
| `pages/strategy/syncStatus.ts` | v3 `sync.status` → 文案/颜色/说明；`aggregateJobSyncStatus` 处理草稿/停用/同步态 |
| `pages/strategy/SyncStatusTag.tsx` | 同步状态 Tag；失败时 Tooltip 展示 M09 `sync.error` |
| 测试 | `syncStatus.test.ts`（5）+ `SyncStatusTag.test.tsx`（3） |
| `pages/strategy/jobStatus.ts` | `aggregateJobStatus` 兼容 v3 `sync`：有 sync 时优先 `synced/syncing/pending/failed`，无 sync 时回落 legacy `change_status` |
| 测试 | `jobStatus.test.ts`（3）：草稿/停用优先级、sync 优先、legacy 回落 |

### F2 完成方式（兼容层）

`api/scrapeJobs.ts` 已全量切到 `/api/v3/platform/scrape-jobs`，并在边界把 v3 响应映射回页面既有的 `ScrapeJob` 视图类型：

- `sync` 透传，`change_status` 固定映射 `none`（v3 无变更单，避免 pending 锁）；
- `resource_category` → `resource_type`；`list` → `instances.items`；preview 分组拍平；
- `create/update` 把 `resource_type` 翻译为 `resource_category`，丢弃 `blackbox_targets`/`mapping_overrides`；
- `batchSubmitReady` 逐条 get+update 保持页面动作可用。

页面层未重写，但运行在 v3 后端；`aggregateJobStatus` 已优先使用 `sync`。列级文案清理（移除「变更进度」列）归 F3/B8。

## 4. F3 完成（规则 / 指标库 / 拨测模块 / 采集器）

| 客户端 | v3 适配 |
|---|---|
| `monitoringRules.ts` | CRUD + `POST /monitoring-rules/validate`；`change_status` → `none` + `sync`；标签探查无 v3 端点，降级空结果 |
| `metricLibrary.ts` | v3 路径；update 先 GET 合并再 PUT；新增 remove |
| `blackboxModules.ts` | v3 路径；`referenced_job_count` 映射；update 先取 name |
| `exporterTemplates.ts` | v3 路径；字符串 ID |
| `ciExporterMappings.ts` | v3 路径；`label_template_id` 自动拆到专用端点 |

验证：4 个 API 测试文件 21 通过；F3 页面测试（Rules/Metric/Blackbox/Collector）28 通过；`typecheck:test`/eslint 通过。

> 残留：`labelTemplates.ts` 仍指向 v2（M07 标签模板），Job 表单模板选择在 v3-only 模式需在 F4 一并切到 `/api/v3/platform/label-templates`。

## 5. 2026-11-17 收敛

- 删除「拨测模块」页面、菜单与路由；`blackboxModuleApi` 仅保留 `list`；v3 probe 客户端移除写方法。
- 采集 Job / 规则列表移除「变更进度」列，改为「启用状态 + 同步状态」；移除 pending 锁与批量提交。
- 对应测试已更新：strategy/api/layout 322 用例通过。

## 6. 后续（F4）

1. **F2 Job 页面**：列表/表单/详情改 `scrapeJobApiV3`；用 `sync.status` 替换 `change_status` 列；移除 pending 锁与批量草稿；实例候选/实例/预演对接 v3。
2. **F3 规则/指标库/采集器/拨测模块**：规则页切 `ruleApiV3.validate`；指标库/业务指标/拨测模块切 v3 客户端。
3. **F4 测试门禁**：目标目录 vitest、`typecheck:test`、`pnpm lint`；删除 v2 客户端与相关测试。

> 旧 `/api/v2` 客户端在页面迁完前保留，避免半迁移导致页面不可用。

## 7. 2026-11-18 指标库筛选修复

- **问题**：`MetricLibraryPage` 的「资源类别」只用于收敛「监控类型」下拉并清空已选类型，`load` / `loadAgg` 均未把 `category` 传给后端，导致单独按资源类别筛选不生效；「监控类型」虽已传参，但后端未实现该过滤。
- **修复**：`metricLibraryApi.list` 参数新增 `resource_category`（与语义域 `category` 区分）；`load` / `loadAgg` 传入 `resource_category: category`，并把 `category` 加入 `useCallback` 依赖，分组视图与顶部统计同步受筛选影响。
- **回归测试**：新增「资源类别变更发送 resource_category」与「监控类型变更发送 monitor_type」两个用例；`MetricLibraryPage.test.tsx` 7 项、`metricLibrary.test.ts` 4 项通过；`pnpm run typecheck:test`、eslint 通过。

## 8. 2026-11-19 指标库视图与筛选收敛（T01-F3）

**用户反馈**：分组浏览视图不需要；监控对象类型已可手动新增，筛选下拉是否会同步更新；表格列名要与筛选条件对应。

**变更**：

1. **移除分组浏览视图**：删除「分组浏览 / 列表」Segmented、按 CI 类型分组的 Card 视图与 `aggItems / aggTotal / groupedData / GROUP_PAGE_SIZE` 全量拉取；页面只保留扁平分页列表（一次请求），顶部统计改为服务端筛选后的 `共 n 个指标`，不再显示「按 n 个 CI 类型组织」。该视图本就在 `frontend-prototype-map.md` 中登记为 P2 裁剪（E3/F1-7），本次回到裁剪口径。
2. **监控对象类型筛选与注册表同步**：下拉选项继续取自 `useMonitorTypeCatalog()`；新增 `refreshMonitorTypeCatalog()`（主动重新拉取、失败时保留已有目录不降级），在「监控对象类型」下拉展开时调用。手动新增 / 停用类型后无需刷新浏览器，展开下拉即可看到最新选项；资源类别变更时仍清空已选类型并按类别收敛候选。
3. **列名与筛选条件对齐**：`类型` → `指标类型`、`所属类型` → `监控对象类型`；新增 `资源类别` 列（由 `monitor_types` 锚点经目录 `categoryFor` 反查 M07 资源类别），使 `资源类别 / 监控对象类型 / 指标类型` 三个筛选维度在表头一一对应。
4. **空态与提示**：空态按当前筛选给出「『MySQL』暂无指标」等针对性文案；选中监控对象类型且无数据时补充「指标库为平台内置只读字典，监控对象类型挂接指标后才会产生数据」，避免把「新类型无内置指标」误判为筛选失效。

**文件**：

| 文件 | 说明 |
|---|---|
| `ui-custom/web/src/pages/strategy/MetricLibraryPage.tsx` | 移除分组视图；列名与筛选对齐；资源类别列；空态说明 |
| `ui-custom/web/src/pages/strategy/useMonitorTypeCatalog.ts` | 新增 `refreshMonitorTypeCatalog()`；抽出 `toOptions` 复用 |
| `ui-custom/web/src/pages/strategy/MetricLibraryPage.test.tsx` | 重写 10 项用例（分组视图移除、列名对齐、类型同步、空态说明等） |
| `ui-custom/web/src/pages/strategy/useMonitorTypeCatalog.refresh.test.ts` | 新增 2 项（刷新生效、刷新失败保留目录） |

**验证**：

```text
$ pnpm vitest run src/pages/strategy/MetricLibraryPage.test.tsx
✓ 10 tests passed

$ pnpm vitest run src/pages/strategy
✓ 21 files / 161 tests passed

$ pnpm run typecheck:test   # 通过
$ pnpm exec eslint <changed files>   # 通过
$ pnpm build               # tsc + vite build 通过
$ vite --port 5199         # GET / → 200
```

**偏离 / 待评审**：表格 10 列，超过前端标准「建议 ≤8 列」；技术指标字典需要横向比对元数据，保留 `TABLE_SCROLL_X` 横向滚动与首列固定。若评审要求收敛，可把「标签 / 来源采集器」下沉到后续详情抽屉（当前 MVP 只读、无详情抽屉）。
