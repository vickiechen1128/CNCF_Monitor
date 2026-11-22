import { describe, expect, it } from 'vitest'
import { SERIES_COLORS, buildChartOption, formatChartValue } from './chartOption'
import type { ChartSeries } from './queryRange'

describe('formatChartValue', () => {
  it('renders finite values with readable precision', () => {
    expect(formatChartValue(0)).toBe('0')
    expect(formatChartValue(1.234567)).toBe('1.2346')
    expect(formatChartValue(1234.56)).toBe('1235')
  })

  it('renders gaps as a dash instead of 0', () => {
    expect(formatChartValue(null)).toBe('-')
    expect(formatChartValue(undefined)).toBe('-')
    expect(formatChartValue(Number.NaN)).toBe('-')
    expect(formatChartValue(Number.POSITIVE_INFINITY)).toBe('-')
    expect(formatChartValue(Number.NEGATIVE_INFINITY)).toBe('-')
  })
})

describe('buildChartOption', () => {
  const series: ChartSeries[] = [
    {
      label: 'up{job="node"}',
      data: [
        [0, 1],
        [15_000, null],
        [30_000, 0],
      ],
    },
  ]

  it('builds a time-axis line chart that never connects gaps', () => {
    const option = buildChartOption(series)
    const xAxis = option.xAxis as { type: string; boundaryGap: [string, string] }
    const lines = option.series as Array<{
      name: string
      type: string
      connectNulls: boolean
      showSymbol: boolean
      sampling: string
      data: ChartSeries['data']
    }>

    expect(xAxis.type).toBe('time')
    expect(xAxis.boundaryGap).toEqual(['0%', '0%'])
    expect(lines).toHaveLength(1)
    expect(lines[0].name).toBe('up{job="node"}')
    expect(lines[0].type).toBe('line')
    expect(lines[0].connectNulls).toBe(false)
    expect(lines[0].showSymbol).toBe(false)
    expect(lines[0].sampling).toBe('lttb')
  })

  it('keeps 0 and null as distinct chart values', () => {
    const option = buildChartOption(series)
    const lines = option.series as Array<{ data: ChartSeries['data'] }>

    expect(lines[0].data).toEqual([
      [0, 1],
      [15_000, null],
      [30_000, 0],
    ])
  })

  it('offers inside and slider zoom plus a scrollable legend', () => {
    const option = buildChartOption(series)
    const dataZoom = option.dataZoom as Array<{ type: string }>
    const legend = option.legend as { type: string }

    expect(dataZoom.map((item) => item.type)).toEqual(['inside', 'slider'])
    expect(legend.type).toBe('scroll')
    expect(option.color).toEqual(SERIES_COLORS)
  })

  it('handles an empty series list without throwing', () => {
    const option = buildChartOption([])

    expect(option.series).toEqual([])
  })
})
