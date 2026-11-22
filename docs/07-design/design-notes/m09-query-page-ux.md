# 设计专题：指标查询页交互契约

> 所属模块：M09 配置与查询中心
> 对应 SRS：FR-22、NFR-11、NFR-12
> 关联代码：`ui-custom/web/src/pages/query/QueryPage.tsx`、`src/api/query.ts`、`src/types/query.ts`
> 状态：基础查询已实现；图表、时间范围、断点、深链待补

---

## 1. 目标

让工程师从告警/目标状态进入后，在 3 次点击内看到“中断窗口 + 指标趋势”，并能判断：

- `up=0` 的抓取失败窗口；
- CPU 等指标“无数据”与“0 值”的区别；
- 目标状态的 `lastError`、采集耗时、样本数；
- 中断前后的趋势与恢复点。

不是 Grafana 替代品：只做单页探索与排障，不做面板编排。

---

## 2. 布局

```text
┌─ 指标查询 ──────────────────────────────────────────────────────┐
│ [指标 ▾] [PromQL ................................] [最近6h ▾] [查询] │
│ 步长 30s · 序列 3 · 耗时 180ms · 可见网域：default · 新鲜度 12s前   │
├─────────────────────────────────────────────────────────────────┤
│ 折线图（多序列 / 断点 / 图例 / 悬浮提示 / 缩放）                   │
├─────────────────────────────────────────────────────────────────┤
│ 序列明细：指标 / job / instance / 最新 / 最小 / 最大 / 平均        │
├─────────────────────────────────────────────────────────────────┤
│ 预设：采集健康 | CPU | 内存 | 磁盘        查询历史（P1）            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. URL 契约

```text
/query?expr=<urlencoded>&from=<unix秒>&to=<unix秒>&step=<秒>&preset=<name>
```

- 缺省：`expr=up`、最近 6 小时、step 自动；
- `preset` 优先于 `expr`；
- 非法参数回落默认值，不报错；
- 刷新/分享可复现；深链只拼 URL，不依赖全局状态。

---

## 4. 时间范围与 step

```ts
rangeSec = to - from
rawStep  = Math.ceil(rangeSec / 1000)       // 目标约 1000 点
step     = niceStep(Math.max(15, rawStep))   // 15/30/60/120/300/600/900/1800/3600...
```

- 快捷：15m / 1h / 6h / 24h / 7d / 30d；
- 自定义：结束必须大于开始；
- 后端护栏：`step >= 15s` 且 `step >= rangeSec / 11000`；
- 顶部展示步长，便于理解分辨率。

---

## 5. matrix → 图表数据

```ts
function toGrid(matrix: PromMatrixItem[], start: number, end: number, step: number) {
  const grid: number[] = []
  for (let t = start; t <= end; t += step) grid.push(t)
  return matrix.map((series) => {
    const byTs = new Map(series.values.map(([ts, v]) => [Math.round(ts), Number(v)]))
    return {
      label: formatLabels(series.metric),
      data: grid.map((t) => {
        const v = byTs.get(t)
        return [t * 1000, v === undefined || !Number.isFinite(v) ? null : v]
      }),
    }
  })
}
```

规则：

- 缺失点补 `null`，图表 `connectNulls=false`；这是 40 分钟中断可见的前提；
- `NaN` / `+Inf` / `-Inf` → `null`；
- `up=0` 是有效值，保留 0；
- 网格用查询 step，避免边界错位。

---

## 6. 图表

- ECharts 按需引入（LineChart + Grid + Tooltip + Legend + DataZoom + CanvasRenderer）；
- `xAxis.type='time'`、`showSymbol=false`、`connectNulls=false`、`sampling='lttb'`；
- `dataZoom=[inside, slider]`、`legend.type='scroll'`；
- 颜色取 AntD token/固定色板，外层 Card/Toolbar；
- 序列数 > 50 时提示聚合/过滤；
- 路由懒加载。

---

## 7. 状态与错误

| 状态 | 行为 |
|------|------|
| 初始 | 未执行，展示示例/预设 |
| 加载 | 按钮 loading；旧结果保留并标记“查询中”；新请求取消旧请求 |
| 成功 | 图表 + 明细 + 元信息 |
| 空结果 | 提示无匹配序列，展示可见网域，引导去目标状态 |
| Prometheus 错误 | 展示 error 原文 + 表达式；`bad_data` 提示检查 PromQL |
| 上游不可达 | 提示稍后重试/检查中心 Prometheus |
| 超限 | 提示缩小范围/增大步长，并给建议值 |

---

## 8. 深链与预设

| 入口 | 拼参 |
|------|------|
| 目标状态行「查看指标」 | `up{job="...",instance="..."}`，最近 6h |
| 指标库行「查询」 | 指标名，最近 1h |
| 告警详情 | 有 job/instance → `up{...}`；否则 `ALERTS{alertname="..."}`（需验证网域标签） |
| 首页第 6 步 | 默认值 |

预设：

- 采集健康：`up`、`scrape_duration_seconds`、`scrape_samples_scraped`；
- CPU：`100 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100`；
- 内存/磁盘/网络（P1）。

---

## 9. 性能与限制

- 1000 点 × 20 序列首屏 1 秒级；
- 查询可取消；连续输入不重复提交；
- 指标名/标签值缓存 5 分钟；
- 查询护栏见概要设计 §10.1。

---

## 10. 测试矩阵

| 场景 | 期望 |
|------|------|
| 默认进入 | 不自动请求，展示空态/预设 |
| 执行成功 | `query_range` 调用，图表 + 明细 |
| 无数据窗口 | null 断点，不跨缺口连线 |
| `up=0` | 保留 0，不当作 null |
| URL 带参 | 预填并执行 |
| 非法参数 | 回落默认，不报错 |
| 请求中再次执行 | 取消旧请求，旧响应不覆盖新结果 |
| Prometheus `bad_data` | 展示错误原文 |
| 深链从目标状态 | 预填 job/instance 与时间范围 |
| 步长计算 | 15s 下限、11000 点上限、nice step |
