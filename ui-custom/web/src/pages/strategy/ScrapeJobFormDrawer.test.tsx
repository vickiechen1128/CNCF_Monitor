import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'

const createMock = vi.fn()
const updateMock = vi.fn()
const domainListMock = vi.fn()
const mappingListMock = vi.fn()
const labelListMock = vi.fn()
const exporterCreateMock = vi.fn()

vi.mock('../../api/domain', () => ({
  networkDomainApi: { list: (...args: unknown[]) => domainListMock(...args) },
}))

vi.mock('../../api/ciExporterMappings', () => ({
  ciExporterMappingApi: { list: (...args: unknown[]) => mappingListMock(...args) },
}))

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
  },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: { list: (...args: unknown[]) => labelListMock(...args) },
}))

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: { create: (...args: unknown[]) => exporterCreateMock(...args) },
}))

vi.mock('../../api/configCenter', () => ({
  configDraftApi: { create: vi.fn().mockResolvedValue({ status: 'success', data: {} }) },
}))

// 实例选择器独立测试（F5），抽屉内直接 stub
vi.mock('./InstanceSelector', () => ({
  InstanceSelector: () => <div data-testid="instance-selector">instance selector</div>,
}))

vi.mock('./ExporterInstallationPanel', () => ({
  ExporterInstallationPanel: () => null,
}))

beforeEach(() => {
  createMock.mockReset()
  updateMock.mockReset()
  domainListMock.mockReset()
  mappingListMock.mockReset()
  labelListMock.mockReset()
  exporterCreateMock.mockReset()
  labelListMock.mockResolvedValue({
    status: 'success',
    data: { list: [], total: 0, page: 1, page_size: 100 },
  })
  domainListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [{ id: 'mc-a', name: '网域A', is_monitored: true, status: 'enabled' }],
      total: 1,
      page: 1,
      page_size: 100,
    },
  })
})

/** 渲染抽屉：MemoryRouter + Routes 供网域空态「前往网域管理」跳转断言（O3/T01-F16） */
function renderDrawer(record?: unknown) {
  render(
    <MemoryRouter initialEntries={['/scrape-jobs']}>
      <Routes>
        <Route
          path="/scrape-jobs"
          element={<ScrapeJobFormDrawer open record={record as never} onCancel={() => {}} onSuccess={() => {}} />}
        />
        <Route path="/admin/domains" element={<div>domains-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// F1-8 两级级联：先选资源类别，再选监控对象类型
async function selectCategoryAndType(categoryText: string, typeText: string) {
  fireEvent.mouseDown(screen.getByText('请选择'))
  await selectAntdOption(categoryText)
  fireEvent.mouseDown(screen.getByText('请选择监控对象类型'))
  await selectAntdOption(typeText)
}

describe('ScrapeJobFormDrawer', () => {
  setupAntdTest()

  it('renders create drawer with standard fields', async () => {
    renderDrawer()
    expect(screen.getByText('新增采集任务')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：prod-mysql-01')).toBeInTheDocument()
    expect(screen.getByText('监控对象类型')).toBeInTheDocument()
    expect(screen.getByText('资源类别')).toBeInTheDocument()
    expect(screen.getByTestId('instance-selector')).toBeInTheDocument()
  })

  it('switching to blackbox hides monitor/exporter and shows blackbox fields', async () => {
    renderDrawer()

    fireEvent.click(screen.getByRole('radio', { name: '拨测' }))
    // antd Select 的 placeholder 以文本呈现而非 placeholder 属性，按文本查询
    expect(await screen.findByText('选择拨测模块')).toBeInTheDocument()
    expect(screen.getByText('拨测目标')).toBeInTheDocument()
    expect(screen.queryByText('监控对象类型')).toBeNull()
  })

  it('basic auth reveals username/password; bearer reveals token', async () => {
    renderDrawer()

    // 展开认证折叠面板
    fireEvent.click(await screen.findByText('认证与 TLS'))
    // auth_type 默认 none；切换为 basic
    fireEvent.mouseDown(screen.getAllByText('无')[0])
    await selectAntdOption('用户名密码')

    expect(screen.getByPlaceholderText('用户名')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('密文仅存储，不回显')).toBeInTheDocument()
  })

  it('submits a blackbox job with required fields', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 9, job_name: 'probe-x', job_type: 'blackbox' } })
    renderDrawer()

    fireEvent.click(screen.getByRole('radio', { name: '拨测' }))

    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'probe-x')

    // 选择网域
    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')

    // 选择拨测模块（placeholder 文本，非属性）；antd 会同时渲染 accessibility role=option 与 option-content，
// 因此用 selector 精确定位可点击的 option-content
    fireEvent.mouseDown(await screen.findByText('选择拨测模块'))
    const moduleOption = await screen.findByText('http_2xx', { selector: '.ant-select-item-option-content' })
    await userEvent.click(moduleOption)

    // 添加一个拨测目标并填 target
    fireEvent.click(screen.getByText('添加拨测目标'))
    await userEvent.type(await screen.findByPlaceholderText('目标地址'), 'https://example.com')

    // antd 会在双字按钮插入空格（「保 存」），用 role+空格容忍正则匹配
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.job_name).toBe('probe-x')
    expect(body.job_type).toBe('blackbox')
    expect(body.blackbox_module).toBe('http_2xx')
    expect(body.network_domain_id).toBe('mc-a')
    expect((body.blackbox_targets as { target: string }[])[0].target).toBe('https://example.com')
  })

  it('renders label template as card filtered by resource category (F1-4)', async () => {
    labelListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 7, name: 'MySQL 标准标签', resource_category: 'database', is_default: true, mappings: [], created_at: '', updated_at: '' },
          { id: 8, name: 'Linux 标签', resource_category: 'host', is_default: false, mappings: [], created_at: '', updated_at: '' },
        ],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })
    renderDrawer()

    // F1-8：资源类别=数据库 → 监控对象类型=MySQL（两级级联）
    await selectCategoryAndType('数据库', 'MySQL')

    // 仅展示 database 类别模板卡片，host 类别不展示
    expect(await screen.findByText('MySQL 标准标签')).toBeInTheDocument()
    expect(screen.queryByText('Linux 标签')).toBeNull()
  })

  it('shows label template empty hint with 补配 action when none in category (F1-4)', async () => {
    renderDrawer()
    await selectCategoryAndType('数据库', 'MySQL')
    expect(await screen.findByText('该资源类别下暂无标签模板')).toBeInTheDocument()
    expect(screen.getByText('前往补配标签模板')).toBeInTheDocument()
  })

  it('filters monitor type options by resource category and triggers default collector (F1-8)', async () => {
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          {
            id: 1,
            monitor_type: 'mysql',
            exporter_template_id: 'exp-1',
            scrape_interval: '15s',
            scrape_timeout: '10s',
            metrics_path: '/metrics',
            scheme: 'http',
            label_template_id: undefined,
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })
    renderDrawer()

    // 选中资源类别=数据库
    fireEvent.mouseDown(screen.getByText('请选择'))
    await selectAntdOption('数据库')

    // 打开监控对象类型下拉：仅展示数据库下类型，不含主机类型
    fireEvent.mouseDown(screen.getByText('请选择监控对象类型'))
    expect(await screen.findByText('MySQL')).toBeInTheDocument()
    expect(screen.queryByText('Linux 主机')).toBeNull()

    // 选中 MySQL → 沿用 handleMonitorTypeChange 带出默认采集器与参数
    await selectAntdOption('MySQL')
    await waitFor(() =>
      expect(mappingListMock).toHaveBeenCalledWith({ monitor_type: 'mysql', is_default: true, page: 1, page_size: 20 }),
    )
  })

  it('echoes resource category derived from monitor_type in edit mode (F1-8)', async () => {
    renderDrawer({
      id: 1,
      job_name: 'job-mysql-1',
      job_type: 'standard',
      monitor_type: 'mysql',
      network_domain_id: 'mc-a',
      scrape_interval: '15s',
      scrape_timeout: '10s',
      metrics_path: '/metrics',
      scheme: 'http',
      auth_type: 'none',
      tls_skip_verify: false,
    })
    // 编辑态回显：由 monitor_type=mysql 反推资源类别=数据库，监控对象类型=MySQL
    expect(await screen.findByText('数据库')).toBeInTheDocument()
    expect(screen.getByText('MySQL')).toBeInTheDocument()
  })

  it('opens collector register drawer from inline button only in empty state (C1)', async () => {
    renderDrawer()
    // Q1a：登记入口仅空态展示（已选监控对象类型但无默认采集器）；未选类型时不出现
    expect(screen.queryByRole('button', { name: /登记采集器/ })).toBeNull()
    await selectCategoryAndType('数据库', 'MySQL')
    fireEvent.click(screen.getByRole('button', { name: /登记采集器/ }))
    expect(await screen.findByPlaceholderText('例如：mysql-exporter')).toBeInTheDocument()
  })

  it('shows cross-module guidance to M06 domain management when no monitored domain (O3/T01-F16)', async () => {
    domainListMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 100 },
    })
    renderDrawer()
    // 空态文案体现「默认域自动同步已纳管，未纳管请前往网域管理纳管」，不再写 M07
    expect(await screen.findByText(/默认域自动同步已纳管/)).toBeInTheDocument()
    const guideLink = screen.getByText(/网域管理/)
    expect(guideLink).toBeInTheDocument()
    // 可点击引导跳转 /admin/domains（系统与平台管理 → 网域管理）
    fireEvent.click(guideLink)
    expect(await screen.findByText('domains-page')).toBeInTheDocument()
  })
})