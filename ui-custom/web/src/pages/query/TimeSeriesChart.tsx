/**
 * 指标查询时序图（ECharts 按需引入）。
 *
 * 只负责 ECharts 生命周期（init / setOption / resize / dispose）；option 由
 * `buildChartOption` 纯函数构造，便于单测覆盖「断点不连线」「0 不是空值」等契约。
 * 见 docs/07-design/design-notes/m09-query-page-ux.md §5/§6。
 */
import { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { buildChartOption } from './chartOption'
import type { ChartSeries } from './queryRange'

// 按需注册：折线图 + 网格/提示/图例/缩放 + Canvas 渲染器，避免引入完整 echarts。
echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
])

export interface TimeSeriesChartProps {
  /** 已按查询 step 对齐的序列网格（null 表示该点无数据） */
  series: ChartSeries[]
  /** 图表高度（px），默认 360 */
  height?: number
  /** 无障碍名称 */
  ariaLabel?: string
}

export function TimeSeriesChart({
  series,
  height = 360,
  ariaLabel = '指标时序图',
}: TimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.EChartsType | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const chart = echarts.init(container)
    chartRef.current = chart

    // 容器宽度随布局变化（Sider 折叠 / 窗口缩放）时保持自适应；
    // 测试环境（jsdom）没有 ResizeObserver，跳过监听即可。
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => chart.resize())
      observer.observe(container)
    }

    return () => {
      observer?.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    // notMerge=true：切换表达式后不残留旧序列 / 旧图例。
    chartRef.current?.setOption(buildChartOption(series), true)
  }, [series])

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={ariaLabel}
      data-testid="time-series-chart"
      style={{ width: '100%', height }}
    />
  )
}

export default TimeSeriesChart
