import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { TimeSeriesChart } from './TimeSeriesChart'
import type { ChartSeries } from './queryRange'

const echartsMocks = vi.hoisted(() => ({
  use: vi.fn(),
  init: vi.fn(),
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('echarts/core', () => ({
  use: echartsMocks.use,
  init: echartsMocks.init,
}))

vi.mock('echarts/charts', () => ({ LineChart: {} }))
vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
  LegendComponent: {},
  DataZoomComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

const SERIES: ChartSeries[] = [
  {
    label: 'up{job="node"}',
    data: [
      [0, 1],
      [15_000, null],
    ],
  },
]

describe('TimeSeriesChart', () => {
  beforeEach(() => {
    echartsMocks.init.mockReset().mockReturnValue({
      setOption: echartsMocks.setOption,
      resize: echartsMocks.resize,
      dispose: echartsMocks.dispose,
    })
    echartsMocks.setOption.mockReset()
    echartsMocks.resize.mockReset()
    echartsMocks.dispose.mockReset()

    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn()
        disconnect = vi.fn()
        unobserve = vi.fn()
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers only the required ECharts modules at import time', () => {
    expect(echartsMocks.use).toHaveBeenCalledTimes(1)
    expect(echartsMocks.use.mock.calls[0][0]).toHaveLength(6)
  })

  it('initializes, applies the option with notMerge, and disposes on unmount', () => {
    const { rerender, unmount } = render(<TimeSeriesChart series={SERIES} />)

    expect(echartsMocks.init).toHaveBeenCalledTimes(1)
    expect(echartsMocks.setOption).toHaveBeenCalledWith(
      expect.objectContaining({ series: [expect.objectContaining({ name: 'up{job="node"}' })] }),
      true,
    )

    rerender(<TimeSeriesChart series={[]} />)
    expect(echartsMocks.setOption).toHaveBeenCalledTimes(2)
    expect(echartsMocks.setOption).toHaveBeenLastCalledWith(
      expect.objectContaining({ series: [] }),
      true,
    )

    unmount()
    expect(echartsMocks.dispose).toHaveBeenCalledTimes(1)
  })

  it('exposes an accessible label and default height', () => {
    const { getByTestId } = render(<TimeSeriesChart series={SERIES} ariaLabel="CPU 趋势" />)

    const chart = getByTestId('time-series-chart')
    expect(chart).toHaveAttribute('role', 'img')
    expect(chart).toHaveAttribute('aria-label', 'CPU 趋势')
    expect(chart).toHaveStyle({ height: '360px' })
  })
})
