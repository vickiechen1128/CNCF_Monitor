import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'

const createMock = vi.fn()
const updateMock = vi.fn()
const domainListMock = vi.fn()
const mappingListMock = vi.fn()

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

function renderDrawer(record?: unknown) {
  render(<ScrapeJobFormDrawer open record={record as never} onCancel={() => {}} onSuccess={() => {}} />)
}

describe('ScrapeJobFormDrawer', () => {
  setupAntdTest()

  it('renders create drawer with standard fields', async () => {
    renderDrawer()
    expect(screen.getByText('新增采集任务')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：prod-mysql-01')).toBeInTheDocument()
    expect(screen.getByText('监控对象类型')).toBeInTheDocument()
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
})