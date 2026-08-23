import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { MetricLibraryPage } from './MetricLibraryPage'

const listMock = vi.fn()

vi.mock('../../api/metricLibrary', () => ({
  metricLibraryApi: {
    list: (...args: unknown[]) => listMock(...args),
  },
}))

function metric(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    metric_name: `node_cpu_usage_${id}`,
    metric_type: 'gauge',
    help: 'CPU 使用率',
    unit: 'percent',
    labels: [],
    monitor_types: [{ monitor_type: 'host_linux', source_exporter: 'node-exporter' }],
    category: 'hardware',
    is_builtin: true,
    enabled: true,
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...extra,
  }
}

beforeEach(() => {
  listMock.mockReset()
})

describe('MetricLibraryPage', () => {
  setupAntdTest()

  it('renders metrics with type label, source exporter and status', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [metric(1)],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()
    expect(screen.getByText('MetricCenter')).toBeInTheDocument()
    expect(screen.getAllByText('仪表').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Linux 主机').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('node-exporter').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('启用')).toBeInTheDocument()
  })

  it('shows empty state 暂无指标', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('暂无指标')).toBeInTheDocument()
  })

  it('shows 内置/用户扩展 and 标签 columns in list view (F4)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          metric(1, { is_builtin: true, labels: ['instance', 'job'] }),
          metric(2, { is_builtin: false, labels: [] }),
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()
    // 内置标注列
    expect(screen.getByText('内置')).toBeInTheDocument()
    expect(screen.getByText('用户扩展')).toBeInTheDocument()
    // 标签列
    expect(screen.getByText('instance')).toBeInTheDocument()
    expect(screen.getByText('job')).toBeInTheDocument()
  })

  it('switches to group view and groups by CI type with badges (F1-7/E3)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [metric(1)], total: 1, page: 1, page_size: 20 },
    })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()

    // 切到分组浏览视图
    fireEvent.click(screen.getByText('分组浏览'))
    // 分组视图触发全量请求（page_size=100）
    await screen.findByText('node_cpu_usage_1')
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ page_size: 100 }))

    // 分组 Card：标题 = CI 类型展示名 + 列表「所属类型」列均含「Linux 主机」
    const linuxHosts = await screen.findAllByText('Linux 主机')
    expect(linuxHosts.length).toBeGreaterThanOrEqual(1)
    // 分组卡片内指标所在表格
    const groupCard = linuxHosts[1]?.closest('.ant-card') ?? linuxHosts[0].closest('.ant-card')
    expect(groupCard).toBeTruthy()
    expect(within(groupCard as HTMLElement).getAllByText('内置').length).toBeGreaterThanOrEqual(1)
  })

  it('renders top statistics 共 n 个指标（内置 x / 用户扩展 y）按 n 个 CI 类型组织 (F4)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [metric(1)], total: 1, page: 1, page_size: 20 },
    })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()
    // 顶部统计文案：共 1 个指标（内置 1 / 用户扩展 0），按 1 个 CI 类型组织
    expect(screen.getByText(/共 1 个指标（内置 1 \/ 用户扩展 0），按 1 个 CI 类型组织/)).toBeInTheDocument()
  })
})