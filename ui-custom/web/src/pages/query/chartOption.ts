/**
 * 指标查询时序图 option 构造（纯函数，便于单测）。
 *
 * 契约要求：无数据区间补 null 且不跨缺口连线（connectNulls=false）；
 * 0 是有效值，不得当作 null。见 m09-query-page-ux.md §5/§6。
 */
import type { EChartsOption } from 'echarts'
import type { ChartSeries } from './queryRange'

/** 固定色板：与 AntD 主色系协调，避免依赖皮肤 token 的运行时值 */
export const SERIES_COLORS = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#eb2f96',
  '#722ed1',
  '#13c2c2',
  '#fa541c',
  '#2f54eb',
  '#a0d911',
  '#f5222d',
]

/** 大数值保留可读精度；小数值最多 4 位小数 */
export function formatChartValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  return value.toFixed(4).replace(/\.?0+$/, '')
}

/** 构造 ECharts 折线图 option；series 顺序即图例顺序 */
export function buildChartOption(series: ChartSeries[]): EChartsOption {
  return {
    animation: false,
    color: SERIES_COLORS,
    grid: { left: 56, right: 24, top: 44, bottom: 72, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
      valueFormatter: (value) =>
        formatChartValue(typeof value === 'number' ? value : Number(value)),
    },
    legend: { type: 'scroll', top: 0, left: 0, right: 0 },
    xAxis: {
      type: 'time',
      boundaryGap: ['0%', '0%'],
      axisLabel: { hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { show: true },
    },
    dataZoom: [
      { type: 'inside', filterMode: 'none' },
      { type: 'slider', filterMode: 'none', height: 20, bottom: 8 },
    ],
    series: series.map((item) => ({
      name: item.label,
      type: 'line',
      showSymbol: false,
      connectNulls: false,
      sampling: 'lttb',
      lineStyle: { width: 1.5 },
      emphasis: { focus: 'series' },
      data: item.data,
    })),
  }
}
