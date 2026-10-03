import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResourcesPage } from './ResourcesPage'

const listMock = vi.fn()
const removeMock = vi.fn()
const templateMock = vi.fn()
const networkDomainListMock = vi.fn()
const businessDomainListMock = vi.fn()
const applicationDictListMock = vi.fn()
const cloudDictListMock = vi.fn()
const serviceDictListMock = vi.fn()
const platformDictListMock = vi.fn()
const coverageListMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    list: (...args: unknown[]) => listMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
    // F-4：模板下载弹窗（TemplateDownloadModal）依赖 resourceApi.template
    template: (...args: unknown[]) => templateMock(...args),
  },
  businessDomainApi: {
    list: (...args: unknown[]) => businessDomainListMock(...args),
  },
  // 决策 92/96：应用列经 applicationDictApi.list 解析 app_name，缺条目回退 app_code
  applicationDictApi: {
    list: (...args: unknown[]) => applicationDictListMock(...args),
  },
  // 决策 103：云列经 cloudDictApi.list 解析 cloud_name（部署级只读，仅有 list）
  cloudDictApi: {
    list: (...args: unknown[]) => cloudDictListMock(...args),
  },
  // 决策 105：服务列经 serviceDictApi.list 解析 service_name
  serviceDictApi: {
    list: (...args: unknown[]) => serviceDictListMock(...args),
  },
  // 决策 104：平台列经 platformDictApi.list 派生 platform_name
  platformDictApi: {
    list: (...args: unknown[]) => platformDictListMock(...args),
  },
}))

// 决策 47-3：采集状态 badge / 三态筛选，测试侧 mock M02 coverage 聚合接口
vi.mock('../../api/coverage', () => ({
  coverageApi: {
    list: (...args: unknown[]) => coverageListMock(...args),
  },
}))

vi.mock('../../api/domain', () => ({
  networkDomainApi: {
    list: (...args: unknown[]) => networkDomainListMock(...args),
  },
}))

// useResources 通过 isApiError(e) && e.code === 403 判定权限不足，测试侧用 code 判别
vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client')
  return {
    ...actual,
    isApiError: (e: unknown) =>
      !!e && typeof e === 'object' && 'code' in e && (e as { code: number }).code === 403,
  }
})

/**
 * vitest jsdom 环境的 window.localStorage 是不真正存储的桩，无法验证「网域/业务」筛选记忆
 * （PRD §5.4 / §11.2）；此处以内存 Map 替换，使记忆持久化在用例内可验证。
 */
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

/** host 列表 item 构造器（对齐 T07-05 列表契约字段） */
function hostItem(resource_id: string, instance_name: string, extra: Record<string, unknown> = {}) {
  return {
    resource_id,
    resource_category: 'host',
    network_domain_id: 'mc-a',
    biz_code: 'infra',
    app_code: 'order',
    env: 'prod',
    cluster: 'c1',
    owner: 'chenrt',
    status: 'online',
    source_type: 'manual',
    instance_name,
    hostname: `${instance_name}.volc`,
    instance_ip: '10.0.1.11',
    os_type: 'Linux',
    ...extra,
  }
}

/** database 列表 item 构造器（对齐 T07-05 列表契约字段，决策 70 / F-38 用） */
function dbItem(resource_id: string, instance_ip: string, extra: Record<string, unknown> = {}) {
  return {
    resource_id,
    resource_category: 'database',
    network_domain_id: 'mc-a',
    biz_code: 'infra',
    env: 'prod',
    status: 'online',
    source_type: 'manual',
    database_type: 'mysql',
    instance_ip,
    port: 3306,
    version: '8.0',
    ...extra,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ResourcesPage />
    </MemoryRouter>,
  )
}

describe('ResourcesPage', () => {
  beforeEach(() => {
    listMock.mockReset()
    removeMock.mockReset()
    templateMock.mockReset()
    networkDomainListMock.mockReset()
    businessDomainListMock.mockReset()
    applicationDictListMock.mockReset()
    cloudDictListMock.mockReset()
    serviceDictListMock.mockReset()
    platformDictListMock.mockReset()
    coverageListMock.mockReset()
    // jsdom 未实现 createObjectURL / revokeObjectURL，桩掉以完成模板下载触发
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // 清理「网域/业务」筛选记忆（PRD §11.2），保证用例隔离；jsdom 环境能力不完整时降级跳过
    try {
      window.localStorage.removeItem('metriccenter:resources:filters')
    } catch {
      // ignore
    }
    networkDomainListMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 100 },
    })
    businessDomainListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    applicationDictListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    cloudDictListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    serviceDictListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    platformDictListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
    removeMock.mockResolvedValue({ status: 'success', data: { resource_id: 'res-1' } })
    coverageListMock.mockResolvedValue({
      status: 'success',
      data: { items: [], total: 0, summary: { total: 0, collecting: 0, pending_down: 0, not_monitored: 0, coverage_rate: 0 } },
    })
  })

  it('shows table loading while fetching', () => {
    let resolve!: (v: unknown) => void
    listMock.mockReturnValue(new Promise((r) => (resolve = r)))
    const { container } = renderPage()
    expect(container.querySelector('.ant-spin')).toBeTruthy()
    resolve({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
  })

  it('loads host list with default page and page size 50', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ resource_category: 'host', page: 1, page_size: 50 }),
      ),
    )
  })

  it('renders host rows on success', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [hostItem('res-1', 'prod-web-01'), hostItem('res-2', 'prod-web-02')],
        total: 2,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    expect(await screen.findByText('prod-web-01')).toBeInTheDocument()
    expect(screen.getByText('prod-web-02')).toBeInTheDocument()
  })

  it('renders empty state with 暂无资源 and guidance buttons', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    expect(await screen.findByText('暂无资源')).toBeInTheDocument()
    expect(screen.getAllByText('新增资源').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Excel 导入').length).toBeGreaterThanOrEqual(1)
  })

  it('renders error Alert and reload button triggers reload', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    renderPage()
    expect(await screen.findByText('资源列表加载失败，请稍后重试')).toBeInTheDocument()
    const reloadBtn = await screen.findByRole('button', { name: /重新加载/ })
    fireEvent.click(reloadBtn)
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  it('shows permission denied empty state', async () => {
    const err = new Error('forbidden')
    ;(err as unknown as { code: number }).code = 403
    listMock.mockRejectedValue(err)
    renderPage()
    expect(await screen.findByText('当前账号无此页面查看权限')).toBeInTheDocument()
  })

  it('switches tab and calls list with new resource_category', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ resource_category: 'host' })),
    )
    fireEvent.click(screen.getByText('数据库'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'database' })),
    )
  })

  it('sends keyword to list on search', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    const search = screen.getByPlaceholderText('搜索实例名 / IP / 应用')
    fireEvent.change(search, { target: { value: 'web' } })
    fireEvent.keyDown(search, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'web' })))
  })

  it('filters rows by business client-side', async () => {
    businessDomainListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ code: 'infra', name: '公共基础设施', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          hostItem('res-1', 'prod-web-01', { biz_code: 'infra' }),
          hostItem('res-2', 'prod-web-02', { biz_code: 'payment' }),
        ],
        total: 2,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    expect(await screen.findByText('prod-web-01')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('全部业务'))
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    expect(screen.getByText('prod-web-01')).toBeInTheDocument()
    expect(screen.queryByText('prod-web-02')).toBeNull()
  })

  it('restores remembered network domain filter on mount', async () => {
    // 上次选择「网域 mc-a」被记忆，进入页面默认带该筛选请求列表（PRD §5.4 / §11.2）
    window.localStorage.setItem(
      'metriccenter:resources:filters',
      JSON.stringify({ network_domain_id: 'mc-a' }),
    )
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() =>
      expect(listMock).toHaveBeenCalledWith(
        expect.objectContaining({ resource_category: 'host', network_domain_id: 'mc-a' }),
      ),
    )
  })

  it('persists business filter selection to localStorage', async () => {
    businessDomainListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ code: 'infra', name: '公共基础设施', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { biz_code: 'infra' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    fireEvent.mouseDown(screen.getByText('全部业务'))
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    await waitFor(() => {
      const raw = window.localStorage.getItem('metriccenter:resources:filters')
      expect(raw).toBeTruthy()
      expect(JSON.parse(raw as string)).toMatchObject({ biz_code: 'infra' })
    })
  })

  it('calls list with page 2 when paginating', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => hostItem(`res-${i}`, `prod-web-${String(i).padStart(2, '0')}`))
    listMock.mockResolvedValue({ status: 'success', data: { list: rows, total: 51, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1 })))
    fireEvent.click(screen.getByTitle('2'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })))
  })

  it('deletes resource after confirm and reloads', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    fireEvent.click(screen.getByRole('button', { name: /删除/ }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('res-1'))
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
  })

  // 决策 47-3：资源列表「采集状态」三态 badge / 三态筛选（数据源 M02 coverage，Map by resource_id）
  it('renders collecting badge from coverage merged by resource_id', async () => {
    coverageListMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'res-1', resource_category: 'host', instance_name: 'prod-web-01', monitor_state: 'collecting', health: 'up' },
          { resource_id: 'res-2', resource_category: 'host', instance_name: 'prod-web-02', monitor_state: 'not_monitored', health: null },
        ],
        total: 2,
        summary: { total: 2, collecting: 1, pending_down: 0, not_monitored: 1, coverage_rate: 0.5 },
      },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01'), hostItem('res-2', 'prod-web-02')], total: 2, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('prod-web-01')).toBeInTheDocument()
    expect(await screen.findByText('采集中')).toBeInTheDocument()
    // 未命中 coverage 的 res-2 归一为「未监控」
    expect(screen.getByText('未监控')).toBeInTheDocument()
  })

  it('degrades collection-status column to "-" when coverage fetch fails, while resource list still renders', async () => {
    // review M1：coverage 接口失败降级为 '-'，不影响资源列表主渲染
    coverageListMock.mockRejectedValue(new Error('coverage upstream down'))
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01'), hostItem('res-2', 'prod-web-02')], total: 2, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('prod-web-01')).toBeInTheDocument()
    expect(screen.getByText('prod-web-02')).toBeInTheDocument()
    // 每行三处 '-'：采集状态降级 + 云列空值（决策 103 共享列）+ 平台列空值（决策 104，字典未挂条目）
    expect(screen.getAllByText('-').length).toBe(6)
    // 不渲染三态文案
    expect(screen.queryByText('采集中')).not.toBeInTheDocument()
    expect(screen.queryByText('未监控')).not.toBeInTheDocument()
  })

  it('renders pending_down badge with tooltip and falls back to not_monitored on empty cell', async () => {
    coverageListMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'res-2', resource_category: 'host', instance_name: 'prod-web-02', monitor_state: 'pending_down', health: 'down', last_error: 'connect refused' },
        ],
        total: 1,
        summary: { total: 1, collecting: 0, pending_down: 1, not_monitored: 0, coverage_rate: 0 },
      },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01'), hostItem('res-2', 'prod-web-02')], total: 2, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('已下发未采到')).toBeInTheDocument()
    expect(screen.getByText('未监控')).toBeInTheDocument()
    // pending_down 的 Tooltip 展示 health / last_error
    fireEvent.mouseEnter(screen.getByText('已下发未采到'))
    expect(await screen.findByText('connect refused')).toBeInTheDocument()
  })

  it('filters rows by monitor state from three-state selector', async () => {
    coverageListMock.mockResolvedValue({
      status: 'success',
      data: {
        items: [
          { resource_id: 'res-1', resource_category: 'host', instance_name: 'prod-web-01', monitor_state: 'collecting', health: 'up' },
          { resource_id: 'res-2', resource_category: 'host', instance_name: 'prod-web-02', monitor_state: 'pending_down', health: 'down' },
        ],
        total: 2,
        summary: { total: 2, collecting: 1, pending_down: 1, not_monitored: 0, coverage_rate: 0.5 },
      },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01'), hostItem('res-2', 'prod-web-02')], total: 2, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // 运行状态与采集状态占位均为「全部」，取最后一个（采集状态位于运行状态之后）
    const placeholders = screen.getAllByText('全部')
    fireEvent.mouseDown(placeholders[placeholders.length - 1])
    fireEvent.click(await screen.findByTitle('采集中'))
    expect(screen.getByText('prod-web-01')).toBeInTheDocument()
    expect(screen.queryByText('prod-web-02')).toBeNull()
  })

  // 决策 47-4：五类 Tab 的「采集状态」列唯一且位于「运行状态」之后（修复非 host tab 重复列回归）
  it('places collection-status column right after running-status and only once, across all five tabs', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '通用目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
      const collectCount = headers.filter((t) => t.trim() === '采集状态').length
      expect(collectCount, `${name} tab：采集状态应恰好出现一次`).toBe(1)
      const atRunning = headers.findIndex((t) => t.includes('运行状态'))
      const atCollect = headers.findIndex((t) => t.trim() === '采集状态')
      expect(atCollect, `${name} tab：采集状态应位于运行状态之后`).toBeGreaterThan(atRunning)
    }
  })

  // 决策 47-4：主机 tab「实例名」列头提示角标（实例名即主机名）
  it('shows a hint badge on host instance-name column header', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    const nameHeader = screen.getByRole('columnheader', { name: /实例名/ })
    const badge = nameHeader.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText('主机资源的实例名即主机名')).toBeInTheDocument()
  })

  // 决策 70 / F-38：主机 Tab 实例名列删除与 instance_name 同值的 hostname 副行
  it('决策 70 / F-38：主机 Tab 实例名列不再渲染 hostname 副行', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('prod-web-01')).toBeInTheDocument()
    // 副行 `hostname`（fixture 中为 `prod-web-01.volc`）已删除
    expect(screen.queryByText('prod-web-01.volc')).toBeNull()
  })

  // 决策 70 / F-38：database / middleware Tab 实例名列改绑 instance_ip（原绑不产出的 instance_name → 恒 '-'）
  it('决策 70 / F-38：数据库 Tab「实例名」列改绑 instance_ip', async () => {
    listMock.mockImplementation((params: { resource_category?: string }) =>
      Promise.resolve({
        status: 'success',
        data: {
          list: params?.resource_category === 'database' ? [dbItem('res-db-1', '10.0.2.20')] : [],
          total: 1,
          page: 1,
          page_size: 50,
        },
      }),
    )
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getByText('数据库'))
    const row = (await screen.findByText('mysql')).closest('tr')
    expect(row).not.toBeNull()
    // 列序：实例名 / 数据库类型 / IP 地址 / 端口 / 版本 ...
    const cells = within(row as HTMLElement).getAllByRole('cell')
    expect(cells[0]).toHaveTextContent('10.0.2.20')
    expect(cells[2]).toHaveTextContent('10.0.2.20')
  })

  it('决策 70 / F-38：数据库 Tab「实例名」列头挂提示角标（模型无独立名称字段）', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getByText('数据库'))
    const header = await screen.findByRole('columnheader', { name: /实例名/ })
    const badge = header.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText(/以实例 IP 作为实例标识/)).toBeInTheDocument()
  })

  // 决策 92/96：资源列表五类 Tab 共享「应用」列——经应用字典解析 app_name，
  // 停用条目加「（已停用）」标识、缺条目回退 app_code、空值渲染 '-'
  it('决策 92/96：应用列渲染应用字典 app_name（enabled 条目 cyan Tag）', async () => {
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ app_code: 'order', app_name: '订单服务', status: 'enabled' }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { app_code: 'order' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    // 应用列解析为展示名「订单服务」（而非编码 order）
    expect(await screen.findByText('订单服务')).toBeInTheDocument()
    // 不渲染停用后缀
    expect(screen.queryByText(/订单服务（已停用）/)).toBeNull()
  })

  it('决策 92/96：停用应用以「应用名（已停用）」标识', async () => {
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ app_code: 'legacy', app_name: '已下线应用', status: 'disabled' }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { app_code: 'legacy' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('已下线应用（已停用）')).toBeInTheDocument()
  })

  it('决策 92/96：字典缺条目回退显示 app_code', async () => {
    // 字典不包含该条目：应用列回退展示编码本身（§5.19 消费链路）
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { app_code: 'ghost-app' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    // 应用列回退 ghost-app（F-6 后 host 组合列已拆分，应用信息由应用列唯一承载）
    const row = (await screen.findByText('prod-web-01')).closest('tr') as HTMLElement
    expect(within(row).getAllByText('ghost-app').length).toBeGreaterThanOrEqual(1)
  })

  it('决策 92/96：app_code 为空时应用列渲染 "-"', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { app_code: undefined })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    const row = (await screen.findByText('prod-web-01')).closest('tr') as HTMLElement
    // 行内 '-' 来自应用列与云列（决策 103 新增共享列；业务/采集状态/其他列均非空）
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  // F-13 列分组（M07 dev-feedback §13）：五类 Tab「应用名称」「业务名称」同属「业务归属」组，
  // 组内相对序为 平台 → 应用 → [所属服务] → 业务（应用名称在业务名称之前）。
  it('F-13：五类 Tab「应用名称」「业务名称」同属业务归属组，组内应用名称在业务名称之前', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '通用目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
      expect(headers.filter((t) => t.trim() === '应用名称').length, `${name} tab：应用名称列应恰好出现一次`).toBe(1)
      const atBiz = headers.findIndex((t) => t.trim() === '业务名称')
      const atApp = headers.findIndex((t) => t.trim() === '应用名称')
      // 组内相对序：应用名称应在业务名称之前（不再断言全局绝对列序）
      expect(atApp, `${name} tab：业务归属组内应用名称应在业务名称之前`).toBeLessThan(atBiz)
    }
  })

  // F-8-b：列头改名（业务名称/应用名称/录入方式）+ 录入方式列移到采集状态之后、操作之前
  it('F-8-b：五类 Tab 列头为「业务名称/应用名称/录入方式」，录入方式位于采集状态之后', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '通用目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
      expect(headers, `${name} tab`).toContain('业务名称')
      expect(headers, `${name} tab`).toContain('应用名称')
      expect(headers, `${name} tab`).toContain('录入方式')
      expect(headers.some((t) => t.trim() === '来源'), `${name} tab：不得再出现「来源」列头`).toBe(false)
      const atCollect = headers.findIndex((t) => t.trim() === '采集状态')
      const atSource = headers.findIndex((t) => t.trim() === '录入方式')
      expect(atSource, `${name} tab：录入方式应位于采集状态之后`).toBeGreaterThan(atCollect)
    }
  })

  // F-13 列分组（M07 dev-feedback §13）：antd 列头分组「技术属性 / 位置」+「业务归属」，操作列不归组；
  // 「云」为经网域派生的位置属性，归技术 / 位置组（不放业务归属组）。
  it('F-13：五类 Tab 列头呈技术属性/位置 + 业务归属两组，各列归属正确，操作列不归组', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    const { container } = renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '通用目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      const rows = Array.from(container.querySelectorAll('thead tr'))
      expect(rows.length, `${name} tab：分组表头应有两行`).toBe(2)
      const groupRow = Array.from(rows[0].querySelectorAll('th'))
      const groupTitles = groupRow.map((th) => (th.textContent ?? '').trim())
      expect(groupTitles[0], `${name} tab：第一组为「技术属性 / 位置」`).toBe('技术属性 / 位置')
      expect(groupRow[0].getAttribute('scope'), `${name} tab：组列为 colgroup`).toBe('colgroup')
      expect(groupTitles[1], `${name} tab：第二组为「业务归属」`).toBe('业务归属')
      expect(groupTitles[2], `${name} tab：操作列不归组`).toBe('操作')
      const techSpan = groupRow[0].colSpan
      const bizSpan = groupRow[1].colSpan
      const leaves = Array.from(rows[1].querySelectorAll('th')).map((th) => (th.textContent ?? '').trim())
      const techLeaves = leaves.slice(0, techSpan)
      const bizLeaves = leaves.slice(techSpan, techSpan + bizSpan)
      // 技术属性 / 位置组：网域 / 运行状态 / 采集状态 / 录入方式 / 云（位置属性）
      for (const t of ['网域', '运行状态', '采集状态', '录入方式', '云']) {
        expect(techLeaves.some((x) => x.includes(t)), `${name} tab：${t} 应属技术属性 / 位置组`).toBe(true)
      }
      // 业务归属组：平台 / 应用名称 / 业务名称
      for (const t of ['平台', '应用名称', '业务名称']) {
        expect(bizLeaves.some((x) => x.includes(t)), `${name} tab：${t} 应属业务归属组`).toBe(true)
      }
      // 云为位置属性，不得落入业务归属组；所属服务仅 application / generic_target 且属业务归属组
      expect(bizLeaves.some((x) => x === '云'), `${name} tab：云不应在业务归属组`).toBe(false)
      expect(techLeaves.some((x) => x.includes('所属服务')), `${name} tab：所属服务不应在技术组`).toBe(false)
      if (name === '应用服务' || name === '通用目标') {
        expect(bizLeaves.some((x) => x.includes('所属服务')), `${name} tab：所属服务应属业务归属组`).toBe(true)
      } else {
        expect(leaves.some((x) => x.includes('所属服务')), `${name} tab：不应出现所属服务列`).toBe(false)
      }
    }
  })

  // F-13：分组后不破坏 fixed / scroll —— 主标识列仍 fixed left、操作列仍 fixed right、横向滚动开启。
  it('F-13：分组后主标识列仍 fixed left、操作列仍 fixed right、scroll.x 生效', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    const { container } = renderPage()
    await screen.findByText('prod-web-01')
    const rows = Array.from(container.querySelectorAll('thead tr'))
    // 表头：技术属性组首个子列（主标识）带 fix-left；操作列（顶层、末尾）带 fix-right
    const leafHeaders = Array.from(rows[1].querySelectorAll('th'))
    expect(leafHeaders[0].className).toContain('ant-table-cell-fix-left')
    const actionHeader = Array.from(rows[0].querySelectorAll('th')).find(
      (th) => (th.textContent ?? '').trim() === '操作',
    )
    expect(actionHeader, '操作列表头应存在').toBeTruthy()
    expect(actionHeader!.className).toContain('ant-table-cell-fix-right')
    // 表体：首格 fix-left、末格 fix-right
    const bodyRow = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    const cells = Array.from(bodyRow.querySelectorAll('td'))
    expect(cells[0].className).toContain('ant-table-cell-fix-left')
    expect(cells[cells.length - 1].className).toContain('ant-table-cell-fix-right')
    // scroll={{ x: 'max-content' }} → 出现横向滚动容器
    expect(container.querySelector('.ant-table-content')).toBeTruthy()
  })

  // F-8-c：应用名称列头 tooltip
  it('F-8-c：应用名称列头提示「该资源归属的应用字典条目」', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    const appHeader = screen.getByRole('columnheader', { name: /应用名称/ })
    const badge = appHeader.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText('该资源归属的应用字典条目')).toBeInTheDocument()
  })

  // F-8-c / F-15：应用服务 Tab「服务名」列头 tooltip（与服务字典归属「所属服务」区分）
  it('F-15：应用服务 Tab「服务名」列头提示实例名与服务字典归属是两个概念', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getByRole('tab', { name: '应用服务' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '应用服务' }).getAttribute('aria-selected')).toBe('true'))
    const svcHeader = await screen.findByRole('columnheader', { name: /服务名/ })
    const badge = svcHeader.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(
      await screen.findByText('本应用服务实例名，参与判重；与服务字典归属（所属服务）是两个概念'),
    ).toBeInTheDocument()
  })

  // F-15：应用服务 Tab 标签由「应用」改为「应用服务」（RESOURCE_TYPE_MAP）
  it('F-15：五类 Tab 中 application 展示名为「应用服务」', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '应用服务' })
    expect(screen.getByRole('tab', { name: '应用服务' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '应用' })).toBeNull()
  })

  // F-15：共享「所属服务」列（决策 105）列头 + tooltip
  it('F-15：应用服务 Tab「所属服务」列头挂提示（服务字典归属，svc 标签取值）', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getByRole('tab', { name: '应用服务' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '应用服务' }).getAttribute('aria-selected')).toBe('true'))
    const header = await screen.findByRole('columnheader', { name: /所属服务/ })
    const badge = header.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(await screen.findByText('该资源归属的服务字典条目（svc 标签取值）')).toBeInTheDocument()
  })

  // F-14：云列列头 tooltip（云归属经网域派生、资源侧只读）
  it('F-14：云列列头提示「云归属经所属网域派生（网域登记时确定），资源侧只读」', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    const cloudHeader = screen.getByRole('columnheader', { name: /^云/ })
    const badge = cloudHeader.querySelector('.anticon-info-circle')
    expect(badge).toBeTruthy()
    fireEvent.mouseEnter(badge!)
    expect(
      await screen.findByText('云归属经所属网域派生（网域登记时确定），资源侧只读；此处展示为云名'),
    ).toBeInTheDocument()
  })

  // F-4/F-7：工具栏「下载模板」打开独立模板 Modal——用户语言三问 + 当前业务/应用可选值直显 + 演进提示
  it('F-4/F-7：工具栏「下载模板」打开模板下载 Modal（用户语言 + 当前可选值 + 演进提示，无黑话/技术列名）', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    // 工具栏与空态各有一个「下载模板」按钮，取工具栏（第一个）
    fireEvent.click(screen.getAllByRole('button', { name: /下载模板/ })[0])
    // 模板 Modal 标题 + 用户语言三问 + 模板演进提示 Alert
    expect(await screen.findByText('下载模板 - 主机')).toBeInTheDocument()
    expect(screen.getByText('这模板怎么填')).toBeInTheDocument()
    expect(screen.getByText('每列能填什么值')).toBeInTheDocument()
    expect(screen.getByText(/模板会随版本更新/)).toBeInTheDocument()
    // F-7-②：字典为空（默认 mock）→ 空态占位 + 声明表引导（用户语言）
    expect(screen.getByText(/暂无已登记业务/)).toBeInTheDocument()
    expect(screen.getByText(/暂无已登记应用/)).toBeInTheDocument()
    // F-7-③：技术列名清单与设计黑话已删除
    expect(screen.queryByText('列顺序')).toBeNull()
    expect(screen.queryByText('os_type')).toBeNull()
    expect(screen.queryByText('biz_code')).toBeNull()
    expect(screen.queryByText('取值说明')).toBeNull()
    expect(screen.queryByText('固定列模板')).toBeNull()
    expect(screen.queryByText('决策 97')).toBeNull()
    // 不打开 Excel 导入弹窗
    expect(screen.queryByText('Excel 导入 - 主机')).toBeNull()
  })

  // F-7-②：模板 Modal 直显页面已加载的业务/应用字典启用条目（决策 92/96 正交两维）
  it('F-7-②：模板 Modal 直显当前业务/应用字典启用条目（停用不展示）', async () => {
    businessDomainListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { code: 'infra', name: '公共基础设施', enabled: true },
          { code: 'legacy', name: '已下线业务', enabled: false },
        ],
        total: 2,
      },
    })
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { app_code: 'order', app_name: '订单服务', status: 'enabled' },
          { app_code: 'old-app', app_name: '已停用应用', status: 'disabled' },
        ],
        total: 2,
      },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getAllByRole('button', { name: /下载模板/ })[0])
    await screen.findByText('下载模板 - 主机')
    // 启用条目以「名称」直显（业务/应用两面板）
    expect(await screen.findByText('公共基础设施')).toBeInTheDocument()
    expect(screen.getByText('订单服务')).toBeInTheDocument()
    // 停用条目不展示
    expect(screen.queryByText('已下线业务')).toBeNull()
    expect(screen.queryByText('已停用应用')).toBeNull()
  })

  it('F-4：模板 Modal 内「下载模板」按钮触发 resourceApi.template', async () => {
    templateMock.mockResolvedValue(
      new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    )
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getAllByRole('button', { name: /下载模板/ })[0])
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /下载模板/ }))
    await waitFor(() => expect(templateMock).toHaveBeenCalledWith('host'))
  })

  it('F-4：空态「下载模板」同样打开模板下载 Modal', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    const btns = screen.getAllByRole('button', { name: /下载模板/ })
    // 空态「下载模板」位于 Empty 引导区（最后一个）
    fireEvent.click(btns[btns.length - 1])
    expect(await screen.findByText('下载模板 - 主机')).toBeInTheDocument()
  })

  it('F-4：「Excel 导入」按钮打开 Excel 导入弹窗（专注上传导入）', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByText('暂无资源')
    fireEvent.click(screen.getAllByRole('button', { name: /Excel 导入/ })[0])
    expect(await screen.findByText('Excel 导入 - 主机')).toBeInTheDocument()
    // 不打开模板下载 Modal
    expect(screen.queryByText('下载模板 - 主机')).toBeNull()
  })

  // F-6：host Tab 拆分「应用 / 环境 / 集群」组合列——独立「环境」「集群」列，组合列头移除
  it('F-6：host Tab 拆分组合列——独立「环境」「集群」列且不再渲染组合列头', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [hostItem('res-1', 'prod-web-01', { env: 'prod', cluster: 'c1' })],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
    expect(headers).toContain('环境')
    expect(headers).toContain('集群')
    expect(headers.some((t) => t.includes('应用 / 环境 / 集群'))).toBe(false)
    // 行内渲染 env / cluster 值（Tag）；应用信息由应用列唯一承载（字典缺条回退 app_code）
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    expect(within(row).getByText('prod')).toBeInTheDocument()
    expect(within(row).getByText('c1')).toBeInTheDocument()
    expect(within(row).getByText('order')).toBeInTheDocument()
  })

  // 决策 103：资源列表「云」列（五类共享列）——启用条目展示 cloud_name、
  // 停用条目加「（已停用）」、字典缺条目回退 cloud_code、空值 '-'
  it('决策 103：云列渲染云字典 cloud_name（启用条目）', async () => {
    cloudDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ cloud_code: 'PUB-TX', cloud_name: '腾讯云', cloud_type: 'PUB', carrier: 'TX', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { cloud_code: 'PUB-TX' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('腾讯云')).toBeInTheDocument()
    expect(screen.queryByText('PUB-TX')).toBeNull()
  })

  it('决策 103：停用云以「云名（已停用）」标识', async () => {
    cloudDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [{ cloud_code: 'PUB-TX', cloud_name: '腾讯云', cloud_type: 'PUB', carrier: 'TX', enabled: false }],
        total: 1,
      },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { cloud_code: 'PUB-TX' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    expect(await screen.findByText('腾讯云（已停用）')).toBeInTheDocument()
  })

  it('决策 103：字典缺条目回退显示 cloud_code', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { cloud_code: 'PRI-TX' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    const row = (await screen.findByText('prod-web-01')).closest('tr') as HTMLElement
    expect(within(row).getAllByText('PRI-TX').length).toBeGreaterThanOrEqual(1)
  })

  it('决策 103：cloud_code 为空时云列渲染 "-"', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { cloud_code: '' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    const row = (await screen.findByText('prod-web-01')).closest('tr') as HTMLElement
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  // ---- 决策 110 / 118-4：平台列取资源行 platform_code 一等字段为权威来源 ----

  it('决策 110：平台列渲染资源行 platform_code 对应的 platform_name', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ platform_code: 'ecommerce', platform_name: '电商平台', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [hostItem('res-1', 'prod-web-01', { platform_code: 'ecommerce' })],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    expect(await screen.findByText('电商平台')).toBeInTheDocument()
  })

  it('决策 118-4：平台列不再经已废弃的 ApplicationDict.platform_code 派生（应用挂了废弃字段也显示 "-"）', async () => {
    // 应用字典条目上的单值 platform_code 已废弃（决策 111 M:N / 118-3），
    // 若仍走 app_code → 应用父级派生，本例会错误渲染出平台名
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { app_code: 'order', app_name: '订单应用', status: 'enabled', platform_code: 'ecommerce' },
        ],
        total: 1,
      },
    })
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ platform_code: 'ecommerce', platform_name: '电商平台', enabled: true }], total: 1 },
    })
    // 资源行未填 platform_code（留空走应用主平台兜底）
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    expect(screen.queryByText('电商平台')).toBeNull()
  })

  it('决策 110：平台字典缺条目时回退显示 platform_code', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [hostItem('res-1', 'prod-web-01', { platform_code: 'unknown-pf' })],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    const row = (await screen.findByText('prod-web-01')).closest('tr') as HTMLElement
    expect(within(row).getAllByText('unknown-pf').length).toBeGreaterThanOrEqual(1)
  })

  it('决策 110：停用平台以「平台名（已停用）」标识', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ platform_code: 'legacy-pf', platform_name: '旧平台', enabled: false }], total: 1 },
    })
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [hostItem('res-1', 'prod-web-01', { platform_code: 'legacy-pf' })],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    expect(await screen.findByText('旧平台（已停用）')).toBeInTheDocument()
  })

  it('决策 103 + 红线④：五类 Tab 均含「云」列且不得出现 cloud_type / carrier 独立列', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '通用目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      const headers = screen.getAllByRole('columnheader').map((h) => h.textContent ?? '')
      expect(headers.filter((t) => t.trim() === '云').length, `${name} tab：云列应恰好出现一次`).toBe(1)
      expect(headers.some((t) => t.includes('云类型')), `${name} tab：不得出现云类型列`).toBe(false)
      expect(headers.some((t) => t.includes('云载体')), `${name} tab：不得出现云载体列`).toBe(false)
    }
  })

  it('F-6：host Tab 环境/集群为空时渲染 "-"', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [hostItem('res-1', 'prod-web-01', { env: undefined, cluster: undefined })],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })
    renderPage()
    const row = (await screen.findByText('prod-web-01')).closest('tr') as HTMLElement
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })
})
