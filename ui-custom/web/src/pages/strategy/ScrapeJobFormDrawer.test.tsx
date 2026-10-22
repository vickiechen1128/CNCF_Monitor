import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest, selectAntdOption } from '../../test/antdTestUtils'
import { ScrapeJobFormDrawer } from './ScrapeJobFormDrawer'

const createMock = vi.fn()
const updateMock = vi.fn()
const instancesMock = vi.fn()
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
    // {T01-P6} 编辑态生效端口回显数据源（GET /instances 携带 port/port_source）
    instances: (...args: unknown[]) => instancesMock(...args),
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
  instancesMock.mockReset()
  domainListMock.mockReset()
  mappingListMock.mockReset()
  labelListMock.mockReset()
  exporterCreateMock.mockReset()
  // {T01-P6} 编辑态回显默认空列表（防止未设置时编辑态 fetch 抛错；各用例按需覆盖）
  instancesMock.mockResolvedValue({ status: 'success', data: { items: [], total: 0 } })
  // 每个资源类别都有系统预设的默认标签模板（与 seed 口径一致）。
  // 提交链路现在要求默认模板必须已加载并选中，默认 mock 不能再是空列表。
  labelListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: [
        { id: 101, name: '主机默认模板', resource_category: 'host', is_default: true, mappings: [], created_at: '', updated_at: '' },
        { id: 102, name: '数据库默认模板', resource_category: 'database', is_default: true, mappings: [], created_at: '', updated_at: '' },
        { id: 103, name: '中间件默认模板', resource_category: 'middleware', is_default: true, mappings: [], created_at: '', updated_at: '' },
        { id: 104, name: '应用默认模板', resource_category: 'application', is_default: true, mappings: [], created_at: '', updated_at: '' },
        { id: 105, name: '其他监控目标默认模板', resource_category: 'generic_target', is_default: true, mappings: [], created_at: '', updated_at: '' },
        { id: 106, name: '接口服务默认模板', resource_category: 'interface_service', is_default: true, mappings: [], created_at: '', updated_at: '' },
      ],
      total: 6,
      page: 1,
      page_size: 100,
    },
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

/** 渲染抽屉：MemoryRouter + Routes 供网域空态「前往网域管理」与端口来源「前往 M07 修改」跳转断言 */
function renderDrawer(record?: unknown) {
  render(
    <MemoryRouter initialEntries={['/scrape-jobs']}>
      <Routes>
        <Route
          path="/scrape-jobs"
          element={<ScrapeJobFormDrawer open record={record as never} onCancel={() => {}} onSuccess={() => {}} />}
        />
        <Route path="/admin/domains" element={<div>domains-page</div>} />
        <Route path="/resources" element={<div>resources-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** {T01-P6} 编辑态标准 Job 记录（回显用例共用基线） */
const EDIT_RECORD = {
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
    // 资源类别与拨测目标仍是用户可见项
    expect(screen.getByText('资源类别')).toBeInTheDocument()
    expect(screen.getByText('拨测目标')).toBeInTheDocument()
    // 探测地址字段已写死（接口服务→接口地址、应用服务→健康检查 URL），不再是输入项
    expect(screen.queryByText('探测地址字段')).toBeNull()
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

  it('submits a blackbox job with resource-based targets (阶段5：手填已禁用)', async () => {
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

    // 只选资源类别：探测地址字段写死推导（接口服务→接口地址），用户无需（也不能）再选
    fireEvent.mouseDown(screen.getByText('请选择'))
    await selectAntdOption('接口服务')
    expect(await screen.findByText(/目标地址固定取所选实例的接口地址/)).toBeInTheDocument()

    // 拨测目标改走「从资源选择」：旧的手填入口必须彻底消失
    expect(screen.queryByText('添加拨测目标')).not.toBeInTheDocument()

    // 新增态 footer：提交生效（完整校验进入 M09 管线）
    fireEvent.click(screen.getByRole('button', { name: /提\s*交\s*生\s*效/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.job_name).toBe('probe-x')
    expect(body.job_type).toBe('blackbox')
    expect(body.blackbox_module).toBe('http_2xx')
    expect(body.network_domain_id).toBe('mc-a')
    // 目标由资源选择承载：只提交类别（target_field 由服务端推导），且不再提交 blackbox_targets
    expect(body.resource_type).toBe('interface_service')
    expect(body.target_field).toBeUndefined()
    expect(body.blackbox_targets).toBeUndefined()
  })

  it('blackbox：资源类别只提供接口服务 / 应用服务两类', async () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('radio', { name: '拨测' }))

    fireEvent.mouseDown(screen.getByText('请选择'))
    // 只列两类（与后端 models.BlackboxProbeCategories 一致）
    expect(await screen.findByText('接口服务', { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    expect(screen.getByText('应用服务', { selector: '.ant-select-item-option-content' })).toBeInTheDocument()
    // 其余四类不可选
    for (const gone of ['主机', '数据库', '中间件', '其他监控目标']) {
      expect(screen.queryByText(gone, { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument()
    }

    // 选应用服务 → 引导文案指明取「健康检查 URL」
    await selectAntdOption('应用服务')
    expect(await screen.findByText(/目标地址固定取所选实例的健康检查 URL/)).toBeInTheDocument()
  })

  it('blackbox：按拨测资源类别展示标签模板并可切换方案', async () => {
    labelListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 11, name: '接口服务默认模板', resource_category: 'interface_service', is_default: true, mappings: [], created_at: '', updated_at: '' },
          { id: 12, name: '接口服务自定义模板', resource_category: 'interface_service', is_default: false, mappings: [], created_at: '', updated_at: '' },
          { id: 21, name: '应用服务默认模板', resource_category: 'application', is_default: true, mappings: [], created_at: '', updated_at: '' },
        ],
        total: 3,
        page: 1,
        page_size: 100,
      },
    })
    createMock.mockResolvedValue({ status: 'success', data: { id: 9, job_name: 'probe-label', job_type: 'blackbox' } })
    renderDrawer()
    fireEvent.click(screen.getByRole('radio', { name: '拨测' }))

    // 未选资源类别时给出引导（此前拨测分支因 monitorType 为空而不渲染选择器）
    expect(await screen.findByText('选择拨测目标资源类别后按资源类别列出')).toBeInTheDocument()

    // 选择接口服务：只列该类别模板；留空选项明确为「使用默认标签模板」
    fireEvent.mouseDown(screen.getByText('请选择'))
    await selectAntdOption('接口服务')
    expect(await screen.findByText('使用默认标签模板（接口服务默认模板）')).toBeInTheDocument()
    expect(screen.getByText('接口服务自定义模板')).toBeInTheDocument()
    expect(screen.queryByText('应用服务默认模板')).not.toBeInTheDocument()

    // 切换为自定义方案并提交
    fireEvent.click(screen.getByRole('radio', { name: /接口服务自定义模板/ }))
    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'probe-label')
    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')
    fireEvent.mouseDown(await screen.findByText('选择拨测模块'))
    await userEvent.click(await screen.findByText('http_2xx', { selector: '.ant-select-item-option-content' }))
    fireEvent.click(screen.getByRole('button', { name: /提\s*交\s*生\s*效/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect((createMock.mock.calls[0][0] as Record<string, unknown>).label_template_id).toBe('12')
  })

  // 回归：标准采集任务选「使用默认标签模板」时，提交的是该资源类别默认模板的
  // 真实 ID；此前提交 undefined 导致字段从请求体消失，后端保留旧值/无法回落默认。
  it('standard：选「使用默认标签模板」时提交默认模板 ID 与资源类别', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 13, job_name: 'default-label', job_type: 'standard' } })
    labelListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 7, name: 'MySQL 标准标签', resource_category: 'database', is_default: true, mappings: [], created_at: '', updated_at: '' },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      },
    })
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        // 监控对象类型的默认采集配置未配标签模板 → 表单停在「使用默认标签模板」
        list: [
          { id: 1, monitor_type: 'mysql', exporter_template_id: 'exp-1', scrape_interval: '30s', scrape_timeout: '20s', metrics_path: '/m', scheme: 'http', label_template_id: undefined },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })
    renderDrawer()

    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'default-label')
    await selectCategoryAndType('数据库', 'MySQL')
    expect(await screen.findByText('使用默认标签模板（MySQL 标准标签）')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')
    fireEvent.click(screen.getByRole('button', { name: /提\s*交\s*生\s*效/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.label_template_id).toBe('7')
    expect(body.resource_type).toBe('database')
  })

  it('saves a standard job as draft with minimal validation and passes network_domain_id + draft_status', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 10, job_name: 'draft-job', job_type: 'standard' } })
    renderDrawer()

    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'draft-job')

    // 选择网域
    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')

    // 点击保存草稿（仅校验 job_name / job_type）
    fireEvent.click(screen.getByRole('button', { name: /保\s*存\s*草\s*稿/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    expect(body.job_name).toBe('draft-job')
    expect(body.job_type).toBe('standard')
    expect(body.draft_status).toBe('draft')
    expect(body.network_domain_id).toBe('mc-a')
    expect(body.enabled).toBe(true)
  })

  it('leaves scrape params optional with inheritance placeholders and submits sparse values (F-28)', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 11, job_name: 'sparse-job', job_type: 'standard' } })
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 1, monitor_type: 'mysql', exporter_template_id: 'exp-1', scrape_interval: '30s', scrape_timeout: '20s', metrics_path: '/m', scheme: 'https', label_template_id: undefined },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })
    renderDrawer()

    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'sparse-job')
    await selectCategoryAndType('数据库', 'MySQL')

    // F-28：映射默认值以 placeholder 提示，不再值预填进表单
    expect(await screen.findByPlaceholderText('留空继承默认采集配置（30s）')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('留空继承默认采集配置（/m）')).toBeInTheDocument()

    // 选择网域后直接提交生效（采集参数全部留空 = 继承）
    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')
    fireEvent.click(screen.getByRole('button', { name: /提\s*交\s*生\s*效/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    const body = createMock.mock.calls[0][0] as Record<string, unknown>
    // 留空字段显式归一为 '' 提交，由后端按 映射→模板→全局 链解析生效快照
    expect(body.scrape_interval).toBe('')
    expect(body.scrape_timeout).toBe('')
    expect(body.metrics_path).toBe('')
    expect(body.scheme).toBe('')
    // 默认采集器仍自动带出
    expect(body.exporter_template_id).toBe('exp-1')
  })

  // 采集地址拆分（M01 侧）：application_http 的采集地址来自资源台账「端点 + 端口」，
  // metrics_path 无通用默认值，必须显式填写，否则后端 bad_request。
  it('requires metrics_path and shows guidance for application_http', async () => {
    renderDrawer()
    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'app-job')
    await selectCategoryAndType('应用服务', 'HTTP 应用')

    // 引导文案 + 应用口径 placeholder
    expect(await screen.findByText(/应用采集地址来自资源台账/)).toBeInTheDocument()
    expect(
      screen.getByPlaceholderText('请填写应用指标路径，例如 /actuator/prometheus（留空无法采集）'),
    ).toBeInTheDocument()

    // 选网域后留空 metrics_path 提交 → 必填校验拦截且不提交
    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')
    fireEvent.click(screen.getByRole('button', { name: /提\s*交\s*生\s*效/ }))

    await waitFor(() =>
      expect(screen.getByText('应用采集必须填写采集路径，例如 /actuator/prometheus')).toBeInTheDocument(),
    )
    expect(createMock).not.toHaveBeenCalled()
  })

  it('keeps metrics_path optional for non-application monitor type', async () => {
    createMock.mockResolvedValue({ status: 'success', data: { id: 12, job_name: 'host-job', job_type: 'standard' } })
    renderDrawer()
    await userEvent.type(screen.getByPlaceholderText('例如：prod-mysql-01'), 'host-job')
    await selectCategoryAndType('主机', 'Linux 主机')

    // 非 application_http：无必填、无引导文案，保持「留空=继承」
    expect(screen.queryByText(/应用采集地址来自资源台账/)).toBeNull()
    expect(screen.getByPlaceholderText('留空继承采集器默认（/metrics）')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('仅已纳管非冻结网域'))
    await selectAntdOption('网域A')
    fireEvent.click(screen.getByRole('button', { name: /提\s*交\s*生\s*效/ }))

    await waitFor(() => expect(createMock).toHaveBeenCalled())
    expect((createMock.mock.calls[0][0] as Record<string, unknown>).metrics_path).toBe('')
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

    // 仅展示 database 类别模板（默认模板选项文本包含模板名），host 类别不展示
    expect(await screen.findByText(/MySQL 标准标签/)).toBeInTheDocument()
    expect(screen.queryByText('Linux 标签')).toBeNull()
  })

  it('shows label template empty hint with 补配 action when none in category (F1-4)', async () => {
    labelListMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 100 },
    })
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

  it('echoes standard params and label template selection in edit mode', async () => {
    // 提供 database 类别标签模板，验证编辑时标签模板卡片区可选并选中已挂模板
    labelListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 7, name: 'MySQL 标准标签', resource_category: 'database', is_default: true, mappings: [], created_at: '', updated_at: '' },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      },
    })
    // 决定性实验：默认映射返回与 record 不同的间隔 99s，
    // 若编辑回显显示 15s（record 值）则证明 setFieldsValue 不触发 handleMonitorTypeChange 覆盖；显示 99s 则证明被覆盖。
    mappingListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { id: 1, monitor_type: 'mysql', exporter_template_id: 'exp-x', scrape_interval: '99s', scrape_timeout: '90s', metrics_path: '/x', scheme: 'ftp', label_template_id: undefined },
        ],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })
    renderDrawer({
      id: 1,
      job_name: 'job-mysql-1',
      job_type: 'standard',
      monitor_type: 'mysql',
      network_domain_id: 'mc-a',
      scrape_interval: '15s',
      scrape_timeout: '10s',
      metrics_path: '/metrics',
      scheme: 'https',
      auth_type: 'none',
      tls_skip_verify: false,
      label_template_id: '7',
    })
    // 采集参数（SCRAPE_PARAM_FIELDS）由 record 回显，而非被默认映射（99s）覆盖
    expect(await screen.findByDisplayValue('15s')).toBeInTheDocument()
    expect(screen.getByDisplayValue('10s')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/metrics')).toBeInTheDocument()
    expect(screen.getByDisplayValue('https')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('99s')).toBeNull()
    // 标签模板默认选项携带默认模板 ID（value=7）；默认模板不再重复渲染为普通卡片
    expect(await screen.findByText(/MySQL 标准标签/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /MySQL 标准标签/ })).toBeChecked()
  })

  // 回归：#19 同源问题（采集 Job 抽屉）。用户实测「刷新页面后，勾选多选框再点编辑才有回显；
  // 不勾选直接点编辑内容为空」——根因是 antd Drawer 首次打开时内容惰性挂载（rc-drawer 动画期
  // 晚于父组件 useEffect 的 setFieldsValue），字段注册前 setFieldsValue 被吞；forceRender 保证
  // Form 常驻挂载后，首次打开（含刷新后第一次点编辑）即正确回显，不再依赖勾选等交互垫时序。
  it('edit mode echoes fields when drawer transitions from closed to open (first open)', async () => {
    const record = {
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
    }
    const { rerender } = render(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route
            path="/scrape-jobs"
            element={<ScrapeJobFormDrawer open={false} record={null} onCancel={() => {}} onSuccess={() => {}} />}
          />
        </Routes>
      </MemoryRouter>,
    )
    rerender(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route
            path="/scrape-jobs"
            element={<ScrapeJobFormDrawer open record={record as never} onCancel={() => {}} onSuccess={() => {}} />}
          />
        </Routes>
      </MemoryRouter>,
    )
    // 首次打开即回显 job_name 与采集参数，而非空表单
    expect(await screen.findByDisplayValue('job-mysql-1')).toBeInTheDocument()
    expect(screen.getByDisplayValue('15s')).toBeInTheDocument()
    expect(screen.getByDisplayValue('/metrics')).toBeInTheDocument()
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
    // 空态文案引导先去网域管理登记/纳管网域（中心直连域不再自动预置）
    expect(await screen.findByText(/请选择已纳管网域；未纳管请前往/)).toBeInTheDocument()
    const guideLink = screen.getByText(/网域管理/)
    expect(guideLink).toBeInTheDocument()
    // 可点击引导跳转 /admin/domains（系统与平台管理 → 网域管理）
    fireEvent.click(guideLink)
    expect(await screen.findByText('domains-page')).toBeInTheDocument()
  })

  // {T01-P6} 生效端口回显：四种来源中文标注；instance 来源无警示、非 instance 来源给 M07 引导
  it('edit mode echoes effective port with four source labels (T01-P6)', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'a', instance_name: 'srv-a', instance_ip: '10.0.0.1', status: 'confirmed', port: 3306, port_source: 'instance' },
          { resource_id: 'b', instance_name: 'srv-b', instance_ip: '10.0.0.2', status: 'confirmed', port: 9100, port_source: 'mapping' },
          { resource_id: 'c', instance_name: 'srv-c', instance_ip: '10.0.0.3', status: 'confirmed', port: 9104, port_source: 'template' },
          { resource_id: 'd', instance_name: 'srv-d', instance_ip: '10.0.0.4', status: 'confirmed', port: 8080, port_source: 'business' },
        ],
        total: 4,
      },
    })
    renderDrawer(EDIT_RECORD)

    expect(await screen.findByText('生效端口回显')).toBeInTheDocument()
    expect(screen.getByText('实例覆盖')).toBeInTheDocument()
    expect(screen.getByText('类型默认')).toBeInTheDocument()
    expect(screen.getByText('采集器默认')).toBeInTheDocument()
    expect(screen.getByText(/业务端口兜底/)).toBeInTheDocument()
    // 四行中仅 instance 来源不出现「前往 M07 修改」引导（其余三行各有）
    expect(screen.getAllByText('前往 M07 修改')).toHaveLength(3)
    // instance 来源行内无 ⚠️ 警示
    const rowA = screen.getByText('srv-a').closest('.ant-list-item') as HTMLElement
    expect(within(rowA).queryByText(/⚠️/)).toBeNull()
  })

  // {T01-P6} business 兜底：警示 Tooltip 文案可见，且不阻断保存（D-4：后端恒 200）
  it('business port source shows warning tooltip and does not block save (T01-P6)', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'a', instance_name: 'srv-a', instance_ip: '10.0.0.1', status: 'confirmed', port: 8080, port_source: 'business' },
        ],
        total: 1,
      },
    })
    updateMock.mockResolvedValue({ status: 'success', data: { id: 1 } })
    renderDrawer(EDIT_RECORD)

    const bizTag = await screen.findByText(/业务端口兜底/)
    fireEvent.mouseEnter(bizTag)
    expect(
      await screen.findByText('采集端口未配置，当前以业务端口兜底，请确认 exporter 是否监听该端口'),
    ).toBeInTheDocument()

    // 不阻断：保存按钮可用，点击后正常调用 update（警示不影响任何操作）
    const saveBtn = screen.getByRole('button', { name: /保\s*存/ })
    expect(saveBtn).toBeEnabled()
    fireEvent.click(saveBtn)
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1))
  })

  // {T01-P6} unresolved：端口展示 '-'（非 0，§9 失败态口径）+ 「前往 M07 修改」引导
  it('unresolved port echoes "-" and guides to M07 (T01-P6)', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'a', instance_name: 'srv-a', instance_ip: '10.0.0.1', status: 'confirmed', port: 0, port_source: 'unresolved' },
        ],
        total: 1,
      },
    })
    renderDrawer(EDIT_RECORD)

    expect(await screen.findByText('生效端口回显')).toBeInTheDocument()
    const rowA = screen.getByText('srv-a').closest('.ant-list-item') as HTMLElement
    expect(within(rowA).getByText('-')).toBeInTheDocument()
    expect(within(rowA).queryByText('0')).toBeNull()
    fireEvent.click(within(rowA).getByText('前往 M07 修改'))
    expect(await screen.findByText('resources-page')).toBeInTheDocument()
  })

  // {T01-P6} blackbox 编辑态：不拉取 instances、不渲染生效端口回显
  it('blackbox edit mode does not fetch or render port echo (T01-P6)', async () => {
    renderDrawer({
      ...EDIT_RECORD,
      job_type: 'blackbox',
      blackbox_module: 'http_2xx',
      blackbox_targets: [{ target: 'https://example.com', protocol: 'https' }],
    })
    expect(await screen.findByText('拨测模块')).toBeInTheDocument()
    expect(instancesMock).not.toHaveBeenCalled()
    expect(screen.queryByText('生效端口回显')).toBeNull()
  })
})