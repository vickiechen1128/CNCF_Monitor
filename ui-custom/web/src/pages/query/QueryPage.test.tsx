import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { QueryPage } from './QueryPage'
import { ApiError } from '../../api/client'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'

const mockQueryRange = vi.fn()
const mockLabelValues = vi.fn()

vi.mock('../../api/query', () => ({
  queryApi: {
    queryRange: (...args: unknown[]) => mockQueryRange(...args),
    labelValues: (...args: unknown[]) => mockLabelValues(...args),
  },
}))

// MainLayout 依赖路由上下文（useNavigate / useLocation），用 MemoryRouter 包裹 + 轻量壳替换。
vi.mock('../../layouts/MainLayout', () => ({
  MainLayout: ({ children }: { children: ReactNode }) => (
    <div data-testid="main-layout">{children}</div>
  ),
}))

// ECharts 在 jsdom 中无法测量尺寸，图表组件替换为可断言的数据出口；
// option 构造与 ECharts 生命周期分别由 chartOption.test / TimeSeriesChart.test 覆盖。
vi.mock('./TimeSeriesChart', () => ({
  TimeSeriesChart: ({ series }: { series: unknown[] }) => (
    <div data-testid="time-series-chart">{JSON.stringify(series)}</div>
  ),
}))

const MATRIX_OK = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      {
        metric: { __name__: 'up', job: 'node' },
        values: [
          [1000, '1'],
          [1060, '0'],
          [1120, 'NaN'],
        ],
      },
    ],
  },
  meta: {
    data_source: 'prometheus',
    freshness_at: '2026-11-22T10:00:00Z',
    network_domains: ['mc-a', 'mc-b'],
  },
}

const EMPTY_MATRIX_OK = {
  status: 'success',
  data: { resultType: 'matrix', result: [] },
  meta: { network_domains: ['mc-a'] },
}

const FIXED_URL = '/query?expr=up&from=1000&to=4600&step=60'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-search">{location.search}</div>
}

function renderPage(initialEntry = '/query') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

const promqlInput = () => screen.getByLabelText('PromQL 表达式')

/** AntD 下拉选项：点击可见的选项内容，避免命中隐藏的 aria 文本副本 */
async function chooseOption(text: string) {
  const option = await screen.findByText(text, { selector: '.ant-select-item-option-content' })
  await userEvent.click(option)
}

describe('QueryPage', () => {
  setupAntdTest()

  beforeEach(() => {
    mockQueryRange.mockReset()
    mockLabelValues.mockReset()
    mockLabelValues.mockResolvedValue({ status: 'success', data: [] })
  })

  it('初始为未查询空态：预填 up 但不自动请求', () => {
    renderPage()

    expect(screen.getByText('指标查询')).toBeInTheDocument()
    expect(promqlInput()).toHaveValue('up')
    expect(screen.getByRole('button', { name: /查\s*询/ })).toBeInTheDocument()
    expect(screen.getByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).toBeInTheDocument()
    expect(mockQueryRange).not.toHaveBeenCalled()
  })

  it('自包 MainLayout 布局外壳（/query 深链不丢 Header / Sider）', () => {
    renderPage()

    expect(screen.getByTestId('main-layout')).toBeInTheDocument()
  })

  it('URL 带参进入时预填并自动执行，图表保留 0 与断点并展示元信息', async () => {
    mockQueryRange.mockResolvedValue(MATRIX_OK)

    renderPage(FIXED_URL)

    await waitFor(() => {
      expect(mockQueryRange).toHaveBeenCalledTimes(1)
    })
    expect(mockQueryRange).toHaveBeenCalledWith(
      { query: 'up', start: 1000, end: 4600, step: 60 },
      { signal: expect.any(AbortSignal) },
    )

    const chart = await screen.findByTestId('time-series-chart')
    const series = JSON.parse(chart.textContent || '[]') as Array<{
      label: string
      data: Array<[number, number | null]>
    }>
    expect(series[0].label).toBe('up{job="node"}')
    // 0 是有效值；缺失 / NaN 点是 null（图表 connectNulls=false 形成断点）
    expect(series[0].data.slice(0, 3)).toEqual([
      [1_000_000, 1],
      [1_060_000, 0],
      [1_120_000, null],
    ])

    expect(screen.getByTestId('query-domains')).toHaveTextContent('覆盖网域 mc-a, mc-b')
    expect(screen.getByText('步长 1m')).toBeInTheDocument()
    expect(screen.getByText('序列 1')).toBeInTheDocument()

    const row = screen.getByText('up{job="node"}').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('0.5')).toBeInTheDocument()
    expect(within(row as HTMLElement).getByText('3')).toBeInTheDocument()

    expect(screen.getByTestId('location-search').textContent).toContain('from=1000')
    expect(screen.getByTestId('location-search').textContent).toContain('step=60')
  })

  it('手动执行调用 query_range，并按当前默认 6h / 30s 传参', async () => {
    mockQueryRange.mockResolvedValue(EMPTY_MATRIX_OK)

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }))

    await waitFor(() => expect(mockQueryRange).toHaveBeenCalledTimes(1))
    const params = mockQueryRange.mock.calls[0][0] as {
      query: string
      start: number
      end: number
      step: number
    }
    expect(params.query).toBe('up')
    expect(params.end - params.start).toBe(6 * 3600)
    expect(params.step).toBe(30)

    expect(await screen.findByText('查询成功但没有匹配到指标序列')).toBeInTheDocument()
    expect(screen.getByTestId('query-domains')).toHaveTextContent('覆盖网域 mc-a')
  })

  it('支持 Ctrl+Enter 快捷执行', async () => {
    mockQueryRange.mockResolvedValue(EMPTY_MATRIX_OK)

    renderPage()
    fireEvent.keyDown(promqlInput(), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(mockQueryRange).toHaveBeenCalledTimes(1))
  })

  it('空表达式不发起请求并给出提示', async () => {
    renderPage()

    await userEvent.clear(promqlInput())
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }))

    expect(await screen.findByText('请输入 PromQL 表达式后再执行查询')).toBeInTheDocument()
    expect(mockQueryRange).not.toHaveBeenCalled()
  })

  it('查询中可取消：AbortSignal 触发后展示已取消，不展示错误', async () => {
    mockQueryRange.mockImplementation(
      (_params: unknown, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    )

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }))

    const cancelButton = await screen.findByRole('button', { name: /取\s*消/ })
    await userEvent.click(cancelButton)

    expect(await screen.findByText('已取消查询')).toBeInTheDocument()
    expect(screen.queryByText('查询失败')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /取\s*消/ })).not.toBeInTheDocument()
  })

  it('Prometheus bad_data 错误展示原文并提示检查 PromQL', async () => {
    mockQueryRange.mockRejectedValue(
      new ApiError('parse error at char 1: unexpected end of input', 400, 'bad_data'),
    )

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }))

    expect(
      await screen.findByText(/parse error at char 1: unexpected end of input.*请检查 PromQL/),
    ).toBeInTheDocument()
    expect(screen.getByText('查询失败')).toBeInTheDocument()
    // 错误态不展示空态引导（不把失败伪装成无数据）
    expect(screen.queryByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).not.toBeInTheDocument()
  })

  it('预设按钮填充表达式但不自动执行', async () => {
    renderPage()

    await userEvent.click(screen.getByRole('button', { name: 'CPU 使用率' }))

    expect(promqlInput()).toHaveValue(
      '100 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100',
    )
    expect(mockQueryRange).not.toHaveBeenCalled()
  })

  it('指标名 / Job / 实例辅助选择构造表达式', async () => {
    mockLabelValues.mockImplementation((label: string) =>
      Promise.resolve({
        status: 'success',
        data:
          label === '__name__'
            ? ['node_cpu_seconds_total']
            : label === 'job'
              ? ['node']
              : ['10.0.0.1:9100'],
      }),
    )

    renderPage()

    await userEvent.click(screen.getByRole('combobox', { name: '指标名' }))
    await chooseOption('node_cpu_seconds_total')
    expect(promqlInput()).toHaveValue('node_cpu_seconds_total')
    expect(mockLabelValues).toHaveBeenCalledWith('__name__')

    await userEvent.click(screen.getByRole('combobox', { name: 'Job' }))
    await chooseOption('node')
    expect(promqlInput()).toHaveValue('node_cpu_seconds_total{job="node"}')

    await userEvent.click(screen.getByRole('combobox', { name: '实例' }))
    await chooseOption('10.0.0.1:9100')
    expect(promqlInput()).toHaveValue(
      'node_cpu_seconds_total{job="node", instance="10.0.0.1:9100"}',
    )
    expect(mockQueryRange).not.toHaveBeenCalled()
  })

  it('切换快捷时间范围后按新范围与步长查询', async () => {
    mockQueryRange.mockResolvedValue(EMPTY_MATRIX_OK)

    renderPage()
    await userEvent.click(screen.getByRole('combobox', { name: '时间范围' }))
    await selectAntdOption('最近 1 小时')
    await userEvent.click(screen.getByRole('button', { name: /查\s*询/ }))

    await waitFor(() => expect(mockQueryRange).toHaveBeenCalledTimes(1))
    const params = mockQueryRange.mock.calls[0][0] as {
      start: number
      end: number
      step: number
    }
    expect(params.end - params.start).toBe(3600)
    expect(params.step).toBe(15)
  })

  it('清空重置表达式、结果与 URL', async () => {
    mockQueryRange.mockResolvedValue(EMPTY_MATRIX_OK)

    renderPage(FIXED_URL)
    expect(await screen.findByText('查询成功但没有匹配到指标序列')).toBeInTheDocument()
    expect(screen.getByTestId('location-search').textContent).toContain('expr=up')

    await userEvent.click(screen.getByRole('button', { name: /清\s*空/ }))

    expect(promqlInput()).toHaveValue('')
    expect(screen.getByText('输入 PromQL 表达式并执行查询，结果将显示在这里')).toBeInTheDocument()
    expect(screen.getByTestId('location-search').textContent).toBe('')
  })
})
