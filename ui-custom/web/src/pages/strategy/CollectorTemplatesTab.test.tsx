import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { CollectorTemplatesTab } from './CollectorTemplatesTab'
import { resetCollectionCatalogCache } from './useCollectionTemplateCatalog'
import type { CollectionTemplate } from '../../types/collectionTemplate'
import { EMPTY_SELECTOR } from '../../types/collectionTemplate'

const listMock = vi.fn()
const removeMock = vi.fn()
const updateMock = vi.fn()
const candidateFieldListMock = vi.fn()
const exporterListMock = vi.fn()
const labelListMock = vi.fn()

vi.mock('../../api/collectionTemplates', () => ({
  collectionTemplateApi: {
    list: (...args: unknown[]) => listMock(...args),
    get: vi.fn(),
    create: vi.fn(),
    update: (...args: unknown[]) => updateMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    impact: vi.fn(),
  },
  candidateFieldApi: {
    list: (...args: unknown[]) => candidateFieldListMock(...args),
  },
}))

vi.mock('../../api/exporterTemplates', () => ({
  exporterTemplateApi: {
    list: (...args: unknown[]) => exporterListMock(...args),
  },
}))

vi.mock('../../api/labelTemplates', () => ({
  labelTemplateApi: {
    list: (...args: unknown[]) => labelListMock(...args),
  },
}))

function template(overrides: Partial<CollectionTemplate> = {}): CollectionTemplate {
  return {
    code: 'mysql_default',
    name: 'MySQL 标准采集',
    resource_category: 'database',
    exporter_template_id: 'exp-1',
    exporter_template_name: 'mysqld-exporter',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    label_template_id: 'lt-db',
    label_template_name: 'MySQL 标准标签',
    default_selector: EMPTY_SELECTOR,
    description: '',
    sort_order: 100,
    enabled: true,
    is_builtin: true,
    reference_job_count: 2,
    ...overrides,
  }
}

function exporterTemplate(id: string, name: string, source = 'official') {
  return {
    id,
    name,
    version: '1.0.0',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    os: 'linux',
    arch: 'amd64',
    download_url: '',
    homepage: '',
    install_guide: '',
    description: '',
    is_builtin: true,
    source,
    created_at: '',
    updated_at: '',
  }
}

function renderTab() {
  render(
    <MemoryRouter>
      <CollectorTemplatesTab />
    </MemoryRouter>,
  )
}

const TEMPLATES = [
  template(),
  template({
    code: 'redis_default',
    name: 'Redis 标准采集',
    resource_category: 'middleware',
    exporter_template_id: 'exp-2',
    exporter_template_name: 'redis-exporter',
    default_port: 9121,
    label_template_id: 'lt-mw',
    label_template_name: 'Redis 标签',
    is_builtin: false,
    reference_job_count: 0,
    enabled: false,
  }),
]

describe('CollectorTemplatesTab', () => {
  setupAntdTest()

  beforeEach(() => {
    // 模板目录是模块级缓存：不清空会让后续用例读到上一轮数据（hook 不再请求）
    resetCollectionCatalogCache()
    listMock.mockReset()
    removeMock.mockReset()
    updateMock.mockReset()
    candidateFieldListMock.mockReset()
    exporterListMock.mockReset()
    labelListMock.mockReset()

    listMock.mockResolvedValue({
      status: 'success',
      data: { list: TEMPLATES, total: TEMPLATES.length, page: 1, page_size: 100 },
    })
    removeMock.mockResolvedValue({ status: 'success', data: { code: 'redis_default' } })
    updateMock.mockResolvedValue({ status: 'success', data: TEMPLATES[1] })
    candidateFieldListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    exporterListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [exporterTemplate('exp-1', 'mysqld-exporter'), exporterTemplate('exp-2', 'redis-exporter', 'third_party')],
        total: 2,
        page: 1,
        page_size: 100,
      },
    })
    labelListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 100 } })
  })

  it('renders template rows with category, exporter, params, references and status', async () => {
    renderTab()

    expect(await screen.findByText('MySQL 标准采集')).toBeInTheDocument()
    // 编码作为副标题展示
    expect(screen.getByText('mysql_default')).toBeInTheDocument()
    // 资源类别 Tag
    expect(screen.getAllByText('数据库').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('中间件')).toBeInTheDocument()
    // 采集实现名称（有名称时不再退回 id）
    expect(screen.getByText('mysqld-exporter')).toBeInTheDocument()
    expect(screen.getByText('redis-exporter')).toBeInTheDocument()
    // 默认端口 / 路径 / 协议 与 参数（间隔 / 超时）
    expect(screen.getByText('9104')).toBeInTheDocument()
    expect(screen.getAllByText('/metrics').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('间隔 15s').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('超时 10s').length).toBeGreaterThanOrEqual(1)
    // 标签模板名称
    expect(screen.getByText('MySQL 标准标签')).toBeInTheDocument()
    // 引用任务数 + 状态（状态 Tag 与筛选下拉选项同名，故限定在行内断言）
    expect(screen.getByText('2')).toBeInTheDocument()
    const mysqlRow = screen.getByText('MySQL 标准采集').closest('tr') as HTMLElement
    expect(within(mysqlRow).getByText('启用')).toBeInTheDocument()
    expect(within(mysqlRow).getByText('内置')).toBeInTheDocument()
    const redisRow = screen.getByText('Redis 标准采集').closest('tr') as HTMLElement
    expect(within(redisRow).getByText('停用')).toBeInTheDocument()
    expect(within(redisRow).getByText('9121')).toBeInTheDocument()
  })

  it('filters rows by keyword and by status', async () => {
    renderTab()
    await screen.findByText('MySQL 标准采集')

    fireEvent.change(screen.getByPlaceholderText('模板名 / 编码 / 采集实现'), { target: { value: 'redis' } })
    await waitFor(() => expect(screen.queryByText('MySQL 标准采集')).toBeNull(), { timeout: 8000 })
    expect(screen.getByText('Redis 标准采集')).toBeInTheDocument()

    // 清空关键词后按状态筛选「停用」
    fireEvent.change(screen.getByPlaceholderText('模板名 / 编码 / 采集实现'), { target: { value: '' } })
    await screen.findByText('MySQL 标准采集')
    fireEvent.mouseDown(screen.getByText('全部状态'))
    const disabledOption = await screen.findByText('停用', { selector: '.ant-select-item-option-content' })
    await userEvent.click(disabledOption)
    await waitFor(() => expect(screen.queryByText('MySQL 标准采集')).toBeNull(), { timeout: 8000 })
    expect(screen.getByText('Redis 标准采集')).toBeInTheDocument()
  })

  it('opens the create drawer from 新建模板', async () => {
    renderTab()
    await screen.findByText('MySQL 标准采集')

    fireEvent.click(screen.getAllByRole('button', { name: /新建模板/ })[0])

    expect(await screen.findByText('新建采集模板')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('例如：mysql_default')).toBeInTheDocument()
  })

  it('deletes a user template through the confirmation and refreshes the catalog', async () => {
    renderTab()
    await screen.findByText('Redis 标准采集')

    // 内置行删除入口禁用，仅自定义模板行可点（两行各一个「删除」）
    const deleteButtons = screen.getAllByRole('button', { name: /删\s*除/ })
    expect(deleteButtons).toHaveLength(2)
    expect(deleteButtons[0]).toBeDisabled()
    const enabledDelete = deleteButtons.find((button) => !(button as HTMLButtonElement).disabled)!
    fireEvent.click(enabledDelete)

    const confirmButtons = await screen.findAllByRole('button', { name: /删\s*除/ })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('redis_default'), { timeout: 8000 })
    // reload() 让共享缓存重新拉取
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 8000 })
  })

  it('shows the backend reference-count message when delete conflicts (409)', async () => {
    const { mockAntdMessage } = await import('../../test/antdTestUtils')
    const messages = mockAntdMessage()
    removeMock.mockRejectedValue(
      new Error('collection template "redis_default" is still referenced (jobs=3, metric_anchors=1)'),
    )
    renderTab()
    await screen.findByText('Redis 标准采集')

    const enabledDelete = screen
      .getAllByRole('button', { name: /删\s*除/ })
      .find((button) => !(button as HTMLButtonElement).disabled)!
    fireEvent.click(enabledDelete)
    const confirmButtons = await screen.findAllByRole('button', { name: /删\s*除/ })
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    await waitFor(
      () =>
        expect(messages.error).toHaveBeenCalledWith(
          expect.stringContaining('is still referenced (jobs=3, metric_anchors=1)'),
        ),
      { timeout: 8000 },
    )
  })

  it('explains 内置模板仅可停用 for built-in rows and toggles enable state', async () => {
    renderTab()
    await screen.findByText('MySQL 标准采集')

    // 内置行的删除按钮禁用，悬停提示只能停用
    const builtinRow = screen.getByText('MySQL 标准采集').closest('tr') as HTMLElement
    const builtinDelete = builtinRow.querySelector('button[disabled]') as HTMLButtonElement
    expect(builtinDelete).not.toBeNull()
    fireEvent.mouseEnter(builtinDelete.parentElement as HTMLElement)
    expect(await screen.findByText('内置模板仅可停用')).toBeInTheDocument()

    // 停用内置模板：PUT 整模板 + enabled=false（内置不可删除，停用是唯一下线手段）
    fireEvent.click(screen.getByRole('button', { name: /停\s*用/ }))
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1), { timeout: 8000 })
    expect(updateMock.mock.calls[0][0]).toBe('mysql_default')
    expect((updateMock.mock.calls[0][1] as Record<string, unknown>).enabled).toBe(false)
  })

  it('lists the exporter pool on the 采集实现 tab', async () => {
    renderTab()
    await screen.findByText('MySQL 标准采集')

    // 「采集实现」既是 Tab 名也是模板表格列名，故按 role=tab 定位
    fireEvent.click(screen.getByRole('tab', { name: '采集实现' }))

    expect(await screen.findByText('采集实现（exporter）池')).toBeInTheDocument()
    // 采集模板 Tab 的内容仍挂载（antd Tabs 默认不销毁），故限定在采集实现面板内断言
    const panel = document.querySelector('[id$="panel-implementations"]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(within(panel).getByText('mysqld-exporter')).toBeInTheDocument()
    expect(within(panel).getByText('redis-exporter')).toBeInTheDocument()
    expect(within(panel).getByText('官方')).toBeInTheDocument()
    expect(within(panel).getByText('第三方')).toBeInTheDocument()
  })
})
