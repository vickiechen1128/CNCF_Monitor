import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { MetricLibraryPage } from './MetricLibraryPage'
import { resetCollectionCatalogCache } from './useCollectionTemplateCatalog'

const listMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const templateListMock = vi.fn()

vi.mock('../../api/metricLibrary', () => ({
  metricLibraryApi: {
    list: (...args: unknown[]) => listMock(...args),
    create: (...args: unknown[]) => createMock(...args),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
}))

// M01 v2.0：指标锚点改挂「采集模板」，下拉选项来自 useCollectionTemplateCatalog()
vi.mock('../../api/collectionTemplates', () => ({
  collectionTemplateApi: {
    list: (...args: unknown[]) => templateListMock(...args),
  },
  candidateFieldApi: {
    list: vi.fn(),
  },
}))

// vitest jsdom 的 localStorage 不受控，用内存 Map 承载登录态（角色判定走 getStoredUser）。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

const USER_STORAGE_KEY = 'metriccenter:auth:user'

function setRole(role: 'admin' | 'user' | null) {
  if (!role) {
    storageMap.delete(USER_STORAGE_KEY)
    return
  }
  storageMap.set(
    USER_STORAGE_KEY,
    JSON.stringify({
      id: 'u1',
      username: 'u1',
      display_name: '测试用户',
      tenant_id: 'platform_admin',
      role,
    }),
  )
}

/** 采集模板目录夹具（code 与后端内置模板一致） */
const TEMPLATES = [
  {
    code: 'host_linux',
    name: 'Linux 主机采集',
    resource_category: 'host',
    enabled: true,
    is_builtin: true,
    sort_order: 10,
  },
  {
    code: 'mysql',
    name: 'MySQL 采集',
    resource_category: 'database',
    enabled: true,
    is_builtin: true,
    sort_order: 40,
  },
]

function templateListResponse(list = TEMPLATES) {
  return { status: 'success', data: { list, total: list.length, page: 1, page_size: 100 } }
}

function metric(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    metric_name: `node_cpu_usage_${id}`,
    metric_type: 'gauge',
    help: 'CPU 使用率',
    unit: 'percent',
    labels: [],
    collection_templates: [{ template_code: 'host_linux', source_exporter: 'node-exporter' }],
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
  createMock.mockReset()
  updateMock.mockReset()
  removeMock.mockReset()
  templateListMock.mockReset()
  // 采集模板目录有进程内缓存，逐用例重置，保证各用例只看到自己声明的模板
  resetCollectionCatalogCache()
  templateListMock.mockResolvedValue(templateListResponse())
  // 默认管理员：既有用例覆盖页面主体，写入口默认可见
  storageMap.clear()
  setRole('admin')
})

/**
 * 打开 FilterItem 标签对应的 antd Select。
 *
 * 列名与筛选条件同名（如「资源类别」「采集模板」会同时出现在表头），
 * 因此按标签文本找到**带下拉的筛选格**再点击，避免 getByText 命中多处。
 */
function openFilterSelect(label: string) {
  for (const node of screen.getAllByText(label)) {
    const selector = node.closest('.ant-col')?.querySelector<HTMLElement>('.ant-select-selector')
    if (selector) {
      fireEvent.mouseDown(selector)
      return
    }
  }
  throw new Error(`未找到筛选「${label}」下拉`)
}

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
    // 采集模板列按 code 解析展示名（来自采集模板目录）
    expect(screen.getAllByText('Linux 主机采集').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('node-exporter').length).toBeGreaterThanOrEqual(1)
    // 抽屉常驻挂载（forceRender）也含「启用」文案，状态断言限定在表格内
    expect(within(screen.getByRole('table')).getByText('启用')).toBeInTheDocument()
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

  it('shows 内置/用户扩展 and 标签 columns (F4)', async () => {
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
    expect(screen.getByText('内置')).toBeInTheDocument()
    expect(screen.getByText('用户扩展')).toBeInTheDocument()
    expect(screen.getByText('instance')).toBeInTheDocument()
    expect(screen.getByText('job')).toBeInTheDocument()
  })

  it('shows 未挂接采集模板 for metrics without anchors', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [metric(1, { collection_templates: [] })],
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
    expect(screen.getByText('未挂接采集模板')).toBeInTheDocument()
  })

  it('only renders the flat list (分组浏览视图已移除)', async () => {
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

    expect(screen.queryByText('分组浏览')).toBeNull()
    expect(screen.queryByText('列表')).toBeNull()
    // 不再为分组统计额外拉取全量数据
    expect(listMock).not.toHaveBeenCalledWith(expect.objectContaining({ page_size: 100 }))
  })

  it('aligns column headers with filter labels (资源类别 / 采集模板 / 指标类型)', async () => {
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

    const table = screen.getByRole('table')
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headers).toEqual(
      expect.arrayContaining(['指标名', '指标类型', '资源类别', '采集模板', '来源采集器', '启用状态']),
    )
    // 监控对象类型已退场：表头与筛选都不应再出现该文案
    expect(screen.queryByText('监控对象类型')).toBeNull()
    // 筛选区标签与表头同名（各出现 1 次筛选 + 1 次表头）
    expect(screen.getAllByText('资源类别').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('采集模板').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('指标类型').length).toBeGreaterThanOrEqual(2)
  })

  it('sends resource_category when 资源类别 changes', async () => {
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

    openFilterSelect('资源类别')
    fireEvent.click(await screen.findByText('数据库'))

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ resource_category: 'database', template_code: undefined, page: 1 }),
      ),
    )
  })

  it('sends template_code when 采集模板 changes', async () => {
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

    openFilterSelect('采集模板')
    fireEvent.click(await screen.findByText('MySQL 采集'))

    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ template_code: 'mysql', page: 1 })),
    )
  })

  it('syncs 采集模板 options with newly added templates', async () => {
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
    expect(screen.queryByText('达梦数据库采集')).toBeNull()

    // 新增采集模板后，展开下拉会重新拉取目录
    templateListMock.mockResolvedValue(
      templateListResponse([
        ...TEMPLATES,
        {
          code: 'dameng',
          name: '达梦数据库采集',
          resource_category: 'database',
          enabled: true,
          is_builtin: false,
          sort_order: 45,
        },
      ]),
    )
    openFilterSelect('采集模板')

    expect(await screen.findByText('达梦数据库采集')).toBeInTheDocument()
  })

  it('explains an empty result for a template without metrics', async () => {
    listMock.mockResolvedValueOnce({
      status: 'success',
      data: { list: [metric(1)], total: 1, page: 1, page_size: 20 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()

    openFilterSelect('采集模板')
    fireEvent.click(await screen.findByText('MySQL 采集'))

    expect(await screen.findByText('「MySQL 采集」暂无指标')).toBeInTheDocument()
    expect(
      screen.getByText('该采集模板还没有挂接指标；管理员可点「新增指标」创建用户扩展指标并选择该模板'),
    ).toBeInTheDocument()
  })

  it('renders top statistics 共 n 个指标 (F4)', async () => {
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
    expect(screen.getByText(/共 1 个指标/)).toBeInTheDocument()
  })

  it('shows write entries for admins and keeps built-in rows read-only', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [metric(1, { is_builtin: true }), metric(2, { is_builtin: false, metric_name: 'custom_total' })],
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
    expect(await screen.findByText('custom_total')).toBeInTheDocument()

    expect(screen.getByTestId('create-metric')).toBeInTheDocument()
    // 内置行只读，用户扩展行可编辑/删除
    expect(screen.getByText('内置只读')).toBeInTheDocument()
    expect(screen.getByTestId('edit-metric-2')).toBeInTheDocument()
    expect(screen.getByTestId('delete-metric-2')).toBeInTheDocument()
    expect(screen.queryByTestId('edit-metric-1')).toBeNull()
  })

  it('hides write entries for non-admins', async () => {
    setRole('user')
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [metric(2, { is_builtin: false, metric_name: 'custom_total' })], total: 1, page: 1, page_size: 20 },
    })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('custom_total')).toBeInTheDocument()

    expect(screen.queryByTestId('create-metric')).toBeNull()
    expect(screen.queryByRole('columnheader', { name: '操作' })).toBeNull()
    expect(screen.queryByTestId('edit-metric-2')).toBeNull()
  })

  it('creates a user metric anchored to collection templates (admin)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [metric(1)], total: 1, page: 1, page_size: 20 },
    })
    createMock.mockResolvedValue({
      status: 'success',
      data: metric(9, { is_builtin: false, metric_name: 'app_payment_success_total' }),
    })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('node_cpu_usage_1')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('create-metric'))
    expect(await screen.findByText('新增指标（用户扩展）')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('例如 app_payment_success_total'), {
      target: { value: 'app_payment_success_total' },
    })
    // 挂接采集模板（多选，选项来自采集模板目录）
    fireEvent.mouseDown(
      screen.getByText('请选择采集模板').closest('.ant-select')!.querySelector('.ant-select-selector')!,
    )
    const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') as HTMLElement
    fireEvent.click(within(dropdown).getByText('Linux 主机采集'))
    // 每个已选模板可单独填写来源采集器
    const sourceInput = await screen.findByLabelText('来源采集器-host_linux')
    fireEvent.change(sourceInput, { target: { value: 'node-exporter' } })

    fireEvent.click(screen.getByTestId('submit-metric'))

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({
          metric_name: 'app_payment_success_total',
          metric_type: 'gauge',
          collection_templates: [{ template_code: 'host_linux', source_exporter: 'node-exporter' }],
          enabled: true,
        }),
      ),
    )
  })

  it('deletes a user metric after confirmation (admin)', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [metric(2, { is_builtin: false, metric_name: 'custom_total' })], total: 1, page: 1, page_size: 20 },
    })
    removeMock.mockResolvedValue({ status: 'success', data: { id: '2' } })

    render(
      <MemoryRouter>
        <MetricLibraryPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText('custom_total')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('delete-metric-2'))
    const confirm = await screen.findByText('删除该指标？')
    const popover = confirm.closest('.ant-popover') as HTMLElement
    // antd 会在两个中文字符的按钮文案间插入空格（「删 除」），用正则匹配
    fireEvent.click(within(popover).getByRole('button', { name: /删\s*除/ }))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith(2))
  })
})
