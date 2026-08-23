import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

    render(<MetricLibraryPage />)

    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()
    expect(screen.getAllByText('仪表').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Linux 主机').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('node-exporter').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('启用')).toBeInTheDocument()
  })

  it('shows empty state 暂无指标', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<MetricLibraryPage />)
    expect(await screen.findByText('暂无指标')).toBeInTheDocument()
  })
})