import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { ScrapeJobListPage } from './ScrapeJobListPage'

const listMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const domainListMock = vi.fn()
const tmplListMock = vi.fn()
const labelListMock = vi.fn()
const mappingListMock = vi.fn()

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

// F1-2：默认映射快照（参数同步三态「异常驱动」对比基线）
vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: { list: (...args: unknown[]) => mappingListMock(...args) },
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
  mappingListMock.mockReset()
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
  // 默认映射快照：mysql 默认 scrape_interval=15s（与 job 默认一致 → 已同步）
  mappingListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 1, monitor_type: 'mysql', exporter_template_id: 1, is_default: true, scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http' }],
      total: 1,
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

  it('renders param sync three states overridden/pending/synced (F1-2)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          job(1, {}), // 与默认映射一致（15s）→ 已同步
          job(2, { scrape_interval: '60s' }), // 与默认映射不一致 → 待同步
          job(3, { mapping_overrides: [{ field: 'scheme', value: 'https' }] }), // → 已覆盖 1 项
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    expect(screen.getAllByText('已同步').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('待同步').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('已覆盖 1 项').length).toBeGreaterThanOrEqual(1)
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
    // 标签模板列（O1/T01-F14 异常驱动）：正常继承只显模板名、无「待配置」Tag
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    expect(screen.queryByText('待配置')).toBeNull()
  })

  it('label template column exception-driven: 待配置 only when job lacks label but default mapping has one (O1/T01-F14)', async () => {
    // redis 默认映射已挂标签模板（label_template_id='8'）；mysql 默认映射未挂
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 1, monitor_type: 'mysql', exporter_template_id: 1, is_default: true, scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http' },
          { id: 2, monitor_type: 'redis', exporter_template_id: 2, is_default: true, label_template_id: '8', scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http' },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          // 正常继承：job 已关联标签模板 → 只显模板名、无「待配置」Tag
          job(1, { monitor_type: 'mysql', label_template_id: '7' }),
          // 异常态：job 未关联标签模板，但 redis 默认映射已挂标签 → 显橙色「待配置」Tag
          job(2, { monitor_type: 'redis', label_template_id: undefined }),
          // 无标签：job 未关联且默认映射未挂标签 → '-'
          job(3, { monitor_type: 'mysql', label_template_id: undefined }),
        ],
        total: 3,
        page: 1,
        page_size: 20,
      },
    })

    renderPage()

    expect(await screen.findByText('job-1')).toBeInTheDocument()
    // 正常继承：只显模板名、无「待配置」Tag
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    const row1 = screen.getByText('job-1').closest('tr') as HTMLElement
    expect(within(row1).queryByText('待配置')).toBeNull()
    // 异常态：job-2 行显「待配置」橙 Tag
    const row2 = screen.getByText('job-2').closest('tr') as HTMLElement
    expect(within(row2).getByText('待配置')).toBeInTheDocument()
    // 无标签：job-3 行渲染 '-'
    const row3 = screen.getByText('job-3').closest('tr') as HTMLElement
    expect(within(row3).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  it('shows empty state 暂无采集任务', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    renderPage()
    expect(await screen.findByText('暂无采集任务')).toBeInTheDocument()
  })

  it('redirects legacy ?tab=collectors to /collectors (F-09)', async () => {
    // 拆分前 `?scrape-jobs?tab=collectors` 直达采集器管理；拆分后自动跳转独立页
    render(
      <MemoryRouter initialEntries={['/scrape-jobs?tab=collectors']}>
        <Routes>
          <Route path="/scrape-jobs" element={<ScrapeJobListPage />} />
          <Route path="/collectors" element={<div data-testid="collectors-page">collectors</div>} />
        </Routes>
      </MemoryRouter>,
    )
    // 跳转后应落到 /collectors 对应页面，且不再渲染采集 Job 列表主体
    expect(await screen.findByTestId('collectors-page')).toBeInTheDocument()
    expect(screen.queryByText('新增采集任务')).toBeNull()
  })

  it('opening create drawer renders job form', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    renderPage()
    fireEvent.click(screen.getByText('新增采集任务'))
    expect(screen.getByTestId('job-form-drawer')).toBeInTheDocument()
  })
})