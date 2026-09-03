import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResourcesPage } from './ResourcesPage'

const listMock = vi.fn()
const removeMock = vi.fn()
const networkDomainListMock = vi.fn()
const businessDomainListMock = vi.fn()
const coverageListMock = vi.fn()

vi.mock('../../api/resources', () => ({
  resourceApi: {
    list: (...args: unknown[]) => listMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  },
  businessDomainApi: {
    list: (...args: unknown[]) => businessDomainListMock(...args),
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
    app_name: 'order',
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
    networkDomainListMock.mockReset()
    businessDomainListMock.mockReset()
    coverageListMock.mockReset()
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
    // 两行采集状态列均降级为 '-'
    expect(screen.getAllByText('-').length).toBe(2)
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
})
