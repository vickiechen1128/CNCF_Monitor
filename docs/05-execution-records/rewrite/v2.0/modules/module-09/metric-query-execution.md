# M09 指标查询页与查询护栏（执行记录）

- 状态：implemented，待评审 / 手工 E2E
- 日期：2026-11-22
- 分支：`rewrite/v2.0`
- 关联需求：M09 SRS v1.10 FR-22、NFR-11、NFR-12、NFR-13
- 关联设计：`docs/07-design/Module_09_Config_and_Query_Center_High_Level_Design.md` §6.7 / §10.1；`docs/07-design/design-notes/m09-query-page-ux.md`；`docs/07-design/design-notes/m09-promql-domain-injection.md`
- 关联契约：`api-contract-snapshot-v3.md` §1.3 / §7.3

## 1. 目标与范围

补齐「配置与查询中心 → 指标查询」的 P0 页面能力，并为查询代理增加规模护栏：

1. 区间查询：统一走 `/api/v1/query_range`，矩阵结果补 null 后交给图表。
2. 时序图：ECharts 按需引入；无数据断点不连线、`0` 与无数据可区分、图例/悬浮提示/缩放。
3. 时间范围：15m / 1h / 6h / 24h / 7d / 30d 快捷项 + 自定义起止时间；step 自动计算并受后端护栏约束。
4. 交互：执行 / 取消 / 重新执行；旧结果在查询中保留并标记「查询中」；过期响应按请求序号丢弃。
5. 结果：序列明细（最新 / 最小 / 最大 / 平均 / 点数）+ 元信息（时间范围 / 步长 / 序列数 / 耗时 / 覆盖网域 / 新鲜度）。
6. URL 复现：`/query?expr=&from=&to=&step=&preset=`；URL 带参进入自动执行一次，空 URL 保持未查询空态。
7. 辅助选择：指标名 / Job / 实例标签值懒加载，快速构造 `metric{job="...", instance="..."}`；仍支持直接手写 PromQL。
8. 预设：采集健康、采集耗时、采集样本数、CPU 使用率。
9. 查询护栏：8 KiB 表达式、30 天范围、15s 最小 step、每序列 11000 点、30s 上游超时；超限 400 `bad_request` 且不触达上游，超时 / 不可达 502 `bad_gateway`。

### 1.1 已确认口径

- **页面不提供网域选择器**：一次查询自动覆盖当前租户全部授权网域；服务端保留 `AllowedDomains → network_domain_id=~"..."` 注入，不新增网域隔离功能。
- **本次不做深链**：目标状态 / 指标库 / 告警入口留后续增量；查询页 URL 契约已就绪，FR-22 深链项标记 partial。
- **图表方案**：ECharts 6.1.0 按需引入 + QueryPage 路由懒加载。
- **不做**：查询历史（P1）、多查询对比 / 告警窗口叠加 / 导出图表（P2）。

## 2. 后端改动

### 2.1 查询护栏

新增 `platform/modules/m09/service/query_guard.go`：

- 常量：`MaxQueryLength = 8 KiB`、`MaxQueryRange = 30d`、`MinQueryStep = 15s`、`MaxQueryPoints = 11000`、`QueryTimeout = 30s`。
- `GuardQuery(path, params)`：按路径校验表达式长度、时间范围、step 与点数。
- `ValidateRangeWindow`：用于 `/labels`、`/series`、`/label/:name/values` 的 30 天窗口校验。
- `parseQueryTime` 支持 RFC3339 / unix 秒；`parseQueryStep` 支持 unix 秒、Go duration 与 Prometheus duration（`d/w/y`）。
- `suggestQueryStep`：点数超限时给出建议步长（15s / 30s / 1m ... 7d）。
- 无法解析的参数留给 Prometheus 原生错误语义，护栏不越权拒绝合法 PromQL。

`platform/modules/m09/service/query_service.go`：

- `Proxy` 在读取授权网域、检查上游配置后、注入网域前调用 `GuardQuery`；护栏失败直接返回，不请求 Prometheus。
- `http.Client` 超时与请求 context 统一为 `QueryTimeout`。
- `UpstreamError` 增加 `Timeout bool`，用于区分超时与不可达。

`platform/modules/m09/handler/query_handler.go`：

- `GuardError → 400 bad_request`。
- `UpstreamError.Timeout → 502 bad_gateway`，文案提示「查询超时，请缩小时间范围或增大步长后重试」。
- 其它上游错误保持 502「中心 Prometheus 不可达，请稍后重试」。

### 2.2 网域过滤（保持现状）

- 现有 `AllowedDomains → DomainMatcher → network_domain_id=~"..."` 逻辑未改动。
- 新增回归测试：租户同时授权 `mc-a`、`mc-b` 时，单次查询注入 `network_domain_id=~"mc-a|mc-b"`，`meta.network_domains` 返回两个网域；无授权时仍注入空匹配并返回空数据。
- `platform_admin` 无 bypass。

### 2.3 后端测试

- 新增 `query_guard_test.go`：8 KiB 边界、30d 边界、15s 下限、11000 点上限、RFC3339/unix/duration 解析、建议步长、错误文案。
- 扩展 `query_service_test.go`：护栏命中不触达上游、多网域授权 matcher、超时标记 `UpstreamError.Timeout`。
- 扩展 `query_handler_test.go`：护栏命中返回 400 `bad_request`。

## 3. 前端改动

### 3.1 API 与类型

- `ui-custom/web/src/api/query.ts`：新增 `queryRange`、`labelValues`，全部支持 `AbortSignal`；保留 `query` 即时查询。
- `ui-custom/web/src/api/client.ts`：`parseResponse` 回填 `meta`（此前被丢弃，导致页面无法展示覆盖网域 / 新鲜度）。
- `ui-custom/web/src/api/query.test.ts`、`client.test.ts`：覆盖 query_range 参数 / signal、label values 编码、meta 透传。

### 3.2 纯逻辑

新增 `ui-custom/web/src/pages/query/queryRange.ts`：

- `niceStep` / `computeStep`：约 1000 点目标、15s 下限。
- `resolveQuickRange` / `matchQuickRange`：快捷范围与当前窗口互推。
- `toGrid`：按查询 step 生成完整时间轴，缺失点补 `null`，`0` 保留，`NaN/±Inf` 转 `null`。
- `summarizeSeries`：只统计有限值，`0` 参与统计。
- `formatLabels` / `promqlString`：稳定标签排序与 PromQL 字符串转义。
- `parseQueryState` / `buildQuerySearch`：URL 解析 / 序列化，非法参数回落默认值。
- `parseBareMetric` / `buildSelector`：辅助选择器回填与 `metric{job,instance}` 构造。
- `isAbortError`、`queryLengthBytes`：取消识别与 8 KiB 前端预检。

新增 `queryRange.test.ts`：19 个用例，覆盖 step、快捷范围、断点 / 0、统计、标签、URL、转义、辅助选择。

### 3.3 图表

新增 `chartOption.ts`：

- 固定色板、时间轴、`connectNulls=false`、`showSymbol=false`、`sampling='lttb'`、inside + slider 缩放、scroll 图例。
- `formatChartValue` 统一图表 / 明细数值格式（断点显示 `-`）。

新增 `TimeSeriesChart.tsx`：

- `echarts/core` + `LineChart` + `Grid/Tooltip/Legend/DataZoom` + `CanvasRenderer` 按需注册。
- `init / setOption(notMerge) / ResizeObserver resize / dispose` 生命周期；jsdom 下无 `ResizeObserver` 时跳过监听。

新增 `chartOption.test.ts`（6 用例）与 `TimeSeriesChart.test.tsx`（3 用例）。

### 3.4 查询页

重写 `ui-custom/web/src/pages/query/QueryPage.tsx`：

- 查询条件：PromQL 文本域、指标名 / Job / 实例辅助选择、快捷范围 + RangePicker、查询 / 取消 / 清空、预设。
- 默认 `up` + 最近 6h + 自动 step（30s），但不自动请求；URL 带参时自动执行一次。
- 执行后写入 URL（`replace`），表单改动不覆盖已展示结果。
- 结果：元信息条、序列过多警告（>50）、ECharts 图、序列明细表、空结果提示。
- 错误：客户端预检、`bad_data` 提示检查 PromQL、502 超时 / 不可达文案、取消不显示为错误。
- 不包含网域选择器；顶部说明「网域过滤由服务端按授权自动完成」。

`App.tsx`：`QueryPage` 改为 `lazy(() => import('./pages/query/QueryPage'))`，移除同步 import，避免 ECharts 进入首屏 chunk。

### 3.5 前端测试

重写 `QueryPage.test.tsx`（12 用例）：

- 默认空态不请求、MainLayout、URL 带参自动执行、手动执行参数、Ctrl+Enter、空表达式、取消、`bad_data`、预设、辅助选择、快捷范围 step、清空重置 URL。

覆盖文件：

- `src/pages/query/QueryPage.test.tsx`
- `src/pages/query/queryRange.test.ts`
- `src/pages/query/chartOption.test.ts`
- `src/pages/query/TimeSeriesChart.test.tsx`
- `src/api/query.test.ts`
- `src/api/client.test.ts`

## 4. 验证

### 后端

```bash
METRIC_CENTER_TEST_POSTGRES_DSN="postgres://$(whoami)@127.0.0.1:5432/metric_center_test?sslmode=disable" \
  .tools/go/bin/go test ./platform/modules/m09/service ./platform/modules/m09/handler -count=1
```

结果：`ok .../service`、`ok .../handler`。

```bash
.tools/go/bin/go vet ./platform/modules/m09/...
```

结果：无输出。

### 前端

```bash
cd ui-custom/web
../../.tools/pnpm/bin/pnpm vitest run src/pages/query src/api/query.test.ts src/api/client.test.ts
```

结果：7 个测试文件、65 个用例通过。

```bash
../../.tools/pnpm/bin/pnpm run typecheck:test
../../.tools/pnpm/bin/pnpm lint
```

结果：均通过，无 warning / error。

```bash
../../.tools/pnpm/bin/pnpm build
```

结果：构建通过；`QueryPage-*.js` 约 562 kB（gzip 约 192 kB），随路由懒加载；Vite 提示 chunk > 500 kB 为 ECharts 体积，属预期。

### 服务启动

```bash
.tools/go/bin/go build -o /tmp/metric-center-check ./platform/cmd/metric-center
METRIC_CENTER_DB_DSN="postgres://$(whoami)@127.0.0.1:5432/metric_center?sslmode=disable" \
  /tmp/metric-center-check --listen-address 127.0.0.1:18080 \
  --config.dir /tmp/mc-config --edge-packages.dir /tmp/mc-edge \
  --web.static-dir ui-custom/web/dist
```

结果：

- `GET /api/v3/platform/health` → 200 `{"status":"success","data":{"status":"ok"}}`；
- `GET /api/v3/platform/ready` → 200，`schema_version=24`；
- `GET /query` → 200（静态 SPA 回退，`#root` 存在）；
- 未带 Token 的 `GET /api/v1/query_range` → 401（全局鉴权生效）。

### 未执行

- 手工 E2E（连接真实 Prometheus 数据，验证断点 / 0 / 取消 / 502 的页面呈现）未在本轮执行，待联调。
- NFR-12 的 1000 点 × 20 序列首屏压测未执行。

## 5. 已知限制与后续

1. **深链入口未接线**：目标状态 / 指标库 / 告警的「查看指标」尚未拼 URL；URL 契约与页面解析已就绪。FR-22 因此标记 partial。
2. **查询历史（P1）未实现**：本地保留最近查询、回看 / 重跑留待后续。
3. **指标名 / 标签值无缓存**：每次展开下拉会重新请求；5 分钟缓存待后续。
4. **大结果集**：后端护栏限制 11000 点/序列；页面在序列 > 50 时仅提示聚合 / 过滤，不做自动聚合。
5. **ECharts chunk 体积**：按需引入后 QueryPage chunk 仍约 192 kB gzip；后续如需进一步压缩，可评估 `echarts/core` 的按图表类型拆包或 CDN 外置（当前不做）。
6. **网域隔离**：按已确认口径，页面不选网域、服务端按租户授权网域自动过滤；同一租户下不同用户的更细粒度授权不在本次范围。

## 6. 提交记录

- `c5db8b7` `feat(module-09): 增加查询护栏与上游超时映射`
- `c74a2f1` `feat(module-09): 重构指标查询页并接入 ECharts`
- 文档回填随本提交（HLD / 查询页交互契约 / 契约快照 / 验收）

## 7. 变更文件

后端：

- `platform/modules/m09/service/query_guard.go`（新增）
- `platform/modules/m09/service/query_guard_test.go`（新增）
- `platform/modules/m09/service/query_service.go`
- `platform/modules/m09/service/query_service_test.go`
- `platform/modules/m09/handler/query_handler.go`
- `platform/modules/m09/handler/query_handler_test.go`

前端：

- `ui-custom/web/src/api/query.ts`
- `ui-custom/web/src/api/query.test.ts`（新增）
- `ui-custom/web/src/api/client.ts`
- `ui-custom/web/src/api/client.test.ts`
- `ui-custom/web/src/pages/query/queryRange.ts`（新增）
- `ui-custom/web/src/pages/query/queryRange.test.ts`（新增）
- `ui-custom/web/src/pages/query/chartOption.ts`（新增）
- `ui-custom/web/src/pages/query/chartOption.test.ts`（新增）
- `ui-custom/web/src/pages/query/TimeSeriesChart.tsx`（新增）
- `ui-custom/web/src/pages/query/TimeSeriesChart.test.tsx`（新增）
- `ui-custom/web/src/pages/query/QueryPage.tsx`（重写）
- `ui-custom/web/src/pages/query/QueryPage.test.tsx`（重写）
- `ui-custom/web/src/App.tsx`
- `ui-custom/web/package.json` / `pnpm-lock.yaml`（新增 `echarts@6.1.0`）

文档：

- `docs/07-design/Module_09_Config_and_Query_Center_High_Level_Design.md`
- `docs/07-design/design-notes/m09-query-page-ux.md`
- `docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md`
- `docs/05-execution-records/rewrite/v2.0/modules/module-09/acceptance.md`
