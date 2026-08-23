import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ScrapeJobListPage } from './ScrapeJobListPage'

const listMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const domainListMock = vi.fn()
const tmplListMock = vi.fn()
const labelListMock = vi.fn()

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

// F1-1：采集器列反查真实名称 / 标签模板列渲染
vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { list: (...args: unknown[]) => tmplListMock(...args) },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: { list: (...args: unknown[]) => labelListMock(...args) },
}))

// 采集器管理 Tab 独立测试（F2），页面挂载测试内 stub
vi.mock('./CollectorTemplatesTab', () => ({
  CollectorTemplatesTab: () => <div data-testid="collectors-tab">collectors</div>,
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
  tmplListMock.mockReset()
  labelListMock.mockReset()
  domainListMock.mockResolvedValue({
    status: 'success',
    data: { list: [{ id: 'mc-a', name: '网域A', is_monitored: true, status: 'enabled' }], total: 1, page: 1, page_size: 100 },
  })
  tmplListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 1, name: 'mysqld-exporter' }, { id: 2, name: 'redis-exporter' }],
      total: 2,
      page: 1,
      page_size: 100,
    },
  })
  labelListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 7, name: 'MySQL 标准标签' }, { id: 8, name: 'Redis 标准标签' }],
      total: 2,
      page: 1,
      page_size: 100,
    },
  })
})

function renderPage() {
  render(
    <MemoryRouter>
      <ScrapeJobListPage />
    </MemoryRouter>,
  )
}

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

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    // MainLayout 导航外壳已包覆：顶栏品牌标题可见
    expect(screen.getByText('MetricCenter')).toBeInTheDocument()
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

    renderPage()
    expect(await screen.findByText('拨测')).toBeInTheDocument()
  })

  it('resolves collector name from exporter_template_id and renders label template column (F1-1)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          // 常规 job：exporter_template_id 命中模板名「mysqld-exporter」；label_template_id 命中「MySQL 标准标签」
          job(1, { exporter_template_id: 'mysqld-exporter', label_template_id: '7' }),
          // 未关联标签模板
          job(2, { exporter_template_id: 'redis-exporter', label_template_id: undefined }),
          // 查无模板 → 回退「默认采集器」占位，禁止裸 ID
          job(3, { exporter_template_id: 'unknown-exporter' }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.getByText('redis-exporter')).toBeInTheDocument()
    // 采集器列真实模板名解析 + 默认占位（非裸 ID）
    expect(screen.getByText('默认采集器')).toBeInTheDocument()
    // 标签模板列：命中模板名 + 待配置橙 Tag；未关联渲染 '-'
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    expect(screen.getAllByText('待配置').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state 暂无采集任务', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    renderPage()
    expect(await screen.findByText('暂无采集任务')).toBeInTheDocument()
  })

  it('opening create drawer renders job form', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    renderPage()
    fireEvent.click(screen.getByText('新增采集任务'))
    expect(screen.getByTestId('job-form-drawer')).toBeInTheDocument()
  })
})