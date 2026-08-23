import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ScrapeJobListPage } from './ScrapeJobListPage'

const listMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const domainListMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    list: (...args: unknown[]) => listMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}))

vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...args: unknown[]) => domainListMock(...args),
  },
}))

// 页面测试不深入抽屉内部（F4 单独测）
vi.mock('./ScrapeJobFormDrawer', () => ({
  ScrapeJobFormDrawer: ({ open, onCancel }: { open: boolean; onCancel: () => void }) =>
    open ? <div data-testid="job-form-drawer">form</div> : (
      <button onClick={onCancel}>noop</button>
    ),
}))

function job(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    job_name: `job-${id}`,
    job_type: 'standard',
    monitor_type: 'mysql',
    exporter_template_id: 'mysqld-exporter',
    network_domain_id: 'mc-a',
    selected_instance_ids: ['r-1', 'r-2'],
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    auth_type: 'none',
    enabled: true,
    draft_status: 'ready',
    change_status: 'pending',
    created_at: '2026-08-23T00:00:00Z',
    updated_at: '2026-08-23T00:00:00Z',
    ...extra,
  }
}

beforeEach(() => {
  listMock.mockReset()
  updateMock.mockReset()
  removeMock.mockReset()
  domainListMock.mockReset()
  domainListMock.mockResolvedValue({
    status: 'success',
    data: { list: [{ id: 'mc-a', name: '网域A', is_monitored: true, status: 'enabled' }], total: 1, page: 1, page_size: 100 },
  })
})

describe('ScrapeJobListPage', () => {
  setupAntdTest()

  it('renders jobs with aggregate status and override tag', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          job(1, { change_status: 'pending', enabled: true }),
          job(2, { change_status: 'deployed', enabled: true, mapping_overrides: [{ field: 'scrape_interval', value: '30s' }] }),
          job(3, { enabled: false }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    render(<ScrapeJobListPage />)

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    // 「待下发」「已生效」同时出现在下发状态列与状态聚合列，需匹配多个
    expect(screen.getAllByText('待下发').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已生效').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('已停用')).toBeInTheDocument()
    expect(screen.getAllByText('已覆盖 1 项').length).toBeGreaterThanOrEqual(1)
    // 「网域A」同时出现在筛选下拉选项与表格网域列
    expect(screen.getAllByText('网域A').length).toBeGreaterThanOrEqual(1)
  })

  it('shows blackbox job type label', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [job(1, { job_type: 'blackbox', monitor_type: '', exporter_template_id: '', change_status: 'deployed' })],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    render(<ScrapeJobListPage />)
    expect(await screen.findByText('拨测')).toBeInTheDocument()
  })

  it('shows empty state 暂无采集任务', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<ScrapeJobListPage />)
    expect(await screen.findByText('暂无采集任务')).toBeInTheDocument()
  })

  it('opening create drawer renders job form', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(<ScrapeJobListPage />)
    fireEvent.click(screen.getByText('新增采集任务'))
    expect(screen.getByTestId('job-form-drawer')).toBeInTheDocument()
  })
})