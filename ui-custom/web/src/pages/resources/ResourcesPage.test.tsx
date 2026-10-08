import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ResourcesPage } from './ResourcesPage'
import { RESOURCE_COLUMN_META } from './resourceColumnPrefs'

const listMock = vi.fn()
const removeMock = vi.fn()
const templateMock = vi.fn()
const networkDomainListMock = vi.fn()
const businessDomainListMock = vi.fn()
const applicationDictListMock = vi.fn()
const cloudDictListMock = vi.fn()
const serviceDictListMock = vi.fn()
const platformDictListMock = vi.fn()
// F-18 / 决策 111：应用↔平台 M:N 关联，「应用」筛选器按所选平台级联的数据源
const appPlatformRelListMock = vi.fn()
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
  // F-18 / 决策 111：应用筛选器按平台级联，关联数据源仅影响下拉候选收敛度
  appPlatformRelApi: {
    list: (...args: unknown[]) => appPlatformRelListMock(...args),
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

/** F-17：当前可见列的表头文案列表（trim 后） */
function visibleHeaderTexts(): string[] {
  return screen.getAllByRole('columnheader').map((h) => (h.textContent ?? '').trim())
}

/**
 * F-17：展开工具栏「列设置」下拉。
 *
 * 等待条件用`Checkbox.Group` 容器而非某个具体勾选项文案——各Tab 主标识列文案不同
 * （实例名 / 服务名 / 目标名称），按文案等待会让非host Tab 假失败。
 */
async function openColumnSettings() {
  fireEvent.click(screen.getByRole('button', { name: /列设置/ }))
  await waitFor(() => expect(document.querySelector('.ant-checkbox-group')).toBeTruthy())
}

/**
 * F-17：经「列设置」下拉勾选若干列（按勾选项文案）。
 *
 * 这是抽列后「验证特定列渲染」的统一入口：**先由用户显式打开该列**，再断言其渲染，
 * 而不是把列塞回默认列集（PM 红线：不得为绿而回填）。
 */
async function showColumnsByLabels(...labels: string[]) {
  await openColumnSettings()
  for (const label of labels) {
    const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
    if (!box.checked) fireEvent.click(box)
  }
}

/** F-17：经「列设置」下拉取消勾选若干列 */
async function hideColumnsByLabels(...labels: string[]) {
  await openColumnSettings()
  for (const label of labels) {
    const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
    if (box.checked) fireEvent.click(box)
  }
}

/** F-17：关闭「列设置」浮层，避免浮层内同名文案干扰后续 screen 查询 */
function closeColumnSettings() {
  fireEvent.mouseDown(document.body)
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
    appPlatformRelListMock.mockReset()
    coverageListMock.mockReset()
    // jsdom 未实现 createObjectURL / revokeObjectURL，桩掉以完成模板下载触发
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // 清理「网域/业务」筛选记忆（PRD §11.2），保证用例隔离；jsdom 环境能力不完整时降级跳过
    try {
      window.localStorage.removeItem('metriccenter:resources:filters')
      // F-17：列显隐偏好按 resource_category 分区存储于 storageMap（模块级，跨用例累积），
      // 不清理会让上一个用例的勾选污染下一个用例的默认列集断言
      for (const t of ['host', 'database', 'middleware', 'application', 'generic_target']) {
        window.localStorage.removeItem(`mc_res_list_cols_${t}`)
      }
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
    appPlatformRelListMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0 } })
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

  // F-18 行为变更：biz_code 由**前端当页过滤**改为**后端等值筛选**。
  // 原用例断言「选中业务后未命中的行从表格消失」（前端过滤特征）——该特征已随缺陷修复移除，
  // 改为断言 biz_code 进入列表请求参数（前端不再自行过滤，分页总数由后端给出）。
  it('sends biz_code to backend list instead of filtering client-side', async () => {
    businessDomainListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ code: 'infra', name: '公共基础设施', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部业务'))
    fireEvent.click(await screen.findByText('公共基础设施 (infra)'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ biz_code: 'infra' })),
    )
  })

  // F-18 行为变更：status 同样下沉后端（修复前为前端当页过滤，total 不随筛选变化）。
  it('sends status to backend list instead of filtering client-side', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getAllByText('全部')[0])
    fireEvent.click(await screen.findByText('离线'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'offline' })))
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
    // F-17：云 / 平台已非默认可见列，需先经「列设置」勾选才能验证其空值降级
    await showColumnsByLabels('云', '平台')
    // 每行三处'-'：采集状态降级 + 云列空值（决策 103 共享列）+ 平台列空值（决策 104，字典未挂条目）
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

  /** F-18 遗留风险显式化：采集状态为前端过滤，须提示用户分页总数不随之变化（避免静默误导）。 */
  it('F-18：选中采集状态时提示其为前端过滤（分页总数不随该条件变化）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01'), hostItem('res-2', 'prod-web-02')], total: 2, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // 未选采集状态时不提示
    expect(screen.queryByText('「采集状态」为前端过滤')).toBeNull()
    // 选中后须显式提示
    const placeholders = screen.getAllByText('全部')
    fireEvent.mouseDown(placeholders[placeholders.length - 1])
    fireEvent.click(await screen.findByTitle('采集中'))
    expect(await screen.findByText('「采集状态」为前端过滤')).toBeInTheDocument()
  })

  // 决策 47-4：五类 Tab 的「采集状态」列唯一且位于「运行状态」之后（修复非 host tab 重复列回归）
  it('places collection-status column right after running-status and only once, across all five tabs', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '其他监控目标']) {
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
    // F-17：默认列集不含「IP 地址」，先经「列设置」勾选以验证同值双列
    await showColumnsByLabels('IP 地址')
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
    await screen.findByText('prod-web-01')
    // F-17：应用名称已非默认可见列，先经「列设置」勾选
    await showColumnsByLabels('应用名称')
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
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('应用名称')
    expect(await screen.findByText('已下线应用（已停用）')).toBeInTheDocument()
  })

  it('决策 92/96：字典缺条目回退显示 app_code', async () => {
    // 字典不包含该条目：应用列回退展示编码本身（§5.19 消费链路）
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { app_code: 'ghost-app' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('应用名称')
    // 应用列回退 ghost-app（F-6 后 host 组合列已拆分，应用信息由应用列唯一承载）
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    expect(within(row).getAllByText('ghost-app').length).toBeGreaterThanOrEqual(1)
  })

  it('决策 92/96：app_code 为空时应用列渲染 "-"', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { app_code: undefined })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('应用名称')
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    // 行内 '-' 来自应用列与云列（决策 103 新增共享列；业务/采集状态/其他列均非空）
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(1)
  })

  // F-17：抽列后，「应用名称 / 业务名称 / 平台 / 云」等业务归属列默认不可见。
  // 本用例改为验证 PM 裁定的默认列集与列序，并确认业务归属列**可经列设置勾选回来**后列序仍成立
  //（原意图：业务归属组内「应用名称在业务名称之前」，且整段位于技术 / 位置列之后）。
  it('F-17/F-13：默认列集为 PM 裁定的高频列，勾选业务归属列后列序仍为「应用名称先于业务名称」', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    const PM_DEFAULTS: Record<string, string[]> = {
      主机: ['实例名', '操作系统', '网域', '运行状态', '采集状态', '操作'],
      数据库: ['实例名', '数据库类型', '网域', '运行状态', '采集状态', '操作'],
      中间件: ['实例名', '中间件类型', '网域', '运行状态', '采集状态', '操作'],
      应用服务: ['服务名', '网域', '运行状态', '采集状态', '所属服务', '操作'],
      其他监控目标: ['目标名称', '网域', '运行状态', '采集状态', '所属服务', '操作'],
    }
    for (const name of Object.keys(PM_DEFAULTS)) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      // 默认列集**恰好**等于 PM 裁定集合（不多不少），且列序与 buildColumns 的定义序一致
      expect(visibleHeaderTexts(), `${name} tab：默认可见列`).toEqual(PM_DEFAULTS[name])
      // 默认列数全部 ≤ 8（tablePresets.ts 规范）
      expect(PM_DEFAULTS[name].length, `${name} tab：默认列数应 ≤ 8`).toBeLessThanOrEqual(8)
    }

    // 勾选回业务归属列后，组内相对序与「整段位于技术 / 位置列之后」仍成立
    for (const name of Object.keys(PM_DEFAULTS)) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      await showColumnsByLabels('云', '平台', '应用名称', '业务名称')
      const headers = visibleHeaderTexts()
      expect(headers.filter((t) => t === '应用名称').length, `${name} tab：应用名称列应恰好出现一次`).toBe(1)
      expect(headers.filter((t) => t === '业务名称').length, `${name} tab：业务名称列应恰好出现一次`).toBe(1)
      expect(headers.indexOf('应用名称'), `${name} tab：应用名称应在业务名称之前`).toBeLessThan(
        headers.indexOf('业务名称'),
      )
      expect(headers.indexOf('平台'), `${name} tab：平台列应位于云列之后`).toBeGreaterThan(headers.indexOf('云'))
      // 列已平铺：表头只有一行，不存在两级表头 / 列分组父列（F-13 撤销后的口径不因F-17 回归）
      expect(document.querySelectorAll('thead tr').length, `${name} tab：表头应为单行`).toBe(1)
      expect(document.querySelectorAll('th[scope="colgroup"]').length, `${name} tab：不应有列分组父列`).toBe(0)
      // 勾选态按 category 分区落库，卸载重挂后仍保留（避免每轮重复配置）
      closeColumnSettings()
    }
  })

  // F-8-b：列头改名（业务名称/应用名称/录入方式）+ 录入方式列位于采集状态之后。
  // F-17 起这三列默认不可见，需经「列设置」勾选后验证。
  it('F-17/F-8-b：勾选后列头为「业务名称/应用名称/录入方式」，录入方式位于采集状态之后', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '其他监控目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      await showColumnsByLabels('应用名称', '业务名称', '录入方式')
      const headers = visibleHeaderTexts()
      expect(headers, `${name} tab`).toContain('业务名称')
      expect(headers, `${name} tab`).toContain('应用名称')
      expect(headers, `${name} tab`).toContain('录入方式')
      expect(headers.some((t) => t === '来源'), `${name} tab：不得再出现「来源」列头`).toBe(false)
      expect(headers.indexOf('录入方式'), `${name} tab：录入方式应位于采集状态之后`).toBeGreaterThan(
        headers.indexOf('采集状态'),
      )
      closeColumnSettings()
    }
  })

  // F-13（M07 dev-feedback §13）：原「列头分组」用例随分组撤销而失效已删除
  //（其覆盖的 sticky 意图由下一条用例承接）。

  // F-13（M07 dev-feedback §13）：撤除列头分组不破坏 fixed / scroll —— 主标识列仍 fixed left、
  // 操作列仍 fixed right、横向滚动开启。
  // F-17 追加实测：`scroll.x='max-content'` 下**隐藏列后表宽重算**，sticky 结论仍须成立
  // （本轮要求的必测风险点；已用「临时去掉 fixed 属性」验证本用例确实会红，见交付报告）。
  it('F-13/F-17：主标识列仍 fixed left、操作列仍 fixed right、scroll.x 生效，且隐藏列后不回归', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    const { container } = renderPage()
    await screen.findByText('prod-web-01')
    //撤组后表头为单行，列均在此行
    const headerRows = Array.from(container.querySelectorAll('thead tr'))
    expect(headerRows.length, '撤组后表头应为单行').toBe(1)
    const headers = Array.from(headerRows[0].querySelectorAll('th'))
    // 首列（主标识）带 fix-left；末列（操作）带 fix-right
    expect(headers[0].className).toContain('ant-table-cell-fix-left')
    const actionHeader = headers[headers.length - 1]
    expect((actionHeader.textContent ?? '').trim(), '末列表头应为「操作」').toBe('操作')
    expect(actionHeader.className).toContain('ant-table-cell-fix-right')
    // 表体：首格 fix-left、末格 fix-right
    const bodyRow = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    const cells = Array.from(bodyRow.querySelectorAll('td'))
    expect(cells[0].className).toContain('ant-table-cell-fix-left')
    expect(cells[cells.length - 1].className).toContain('ant-table-cell-fix-right')
    // scroll={{ x: 'max-content' }} → 出现横向滚动容器
    expect(container.querySelector('.ant-table-content')).toBeTruthy()

    // F-17：隐藏「网域」后表宽重算 —— 主标识列与操作列的 sticky 不受影响
    await hideColumnsByLabels('网域')
    expect(visibleHeaderTexts()).not.toContain('网域')
    const afterHeaders = Array.from(container.querySelectorAll('thead tr')[0].querySelectorAll('th'))
    expect(afterHeaders[0].className, '隐藏列后主标识列仍应 fix-left').toContain('ant-table-cell-fix-left')
    expect(afterHeaders[afterHeaders.length - 1].className, '隐藏列后操作列仍应 fix-right').toContain(
      'ant-table-cell-fix-right',
    )
    const afterCells = Array.from(
      (screen.getByText('prod-web-01').closest('tr') as HTMLElement).querySelectorAll('td'),
    )
    expect(afterCells[0].className).toContain('ant-table-cell-fix-left')
    expect(afterCells[afterCells.length - 1].className).toContain('ant-table-cell-fix-right')
  })

  // F-8-c：应用名称列头 tooltip
  it('F-8-c：应用名称列头提示「该资源归属的应用字典条目」', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // F-17：应用名称默认不可见，先经「列设置」勾选
    await showColumnsByLabels('应用名称')
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
    // F-17：云默认不可见，先经「列设置」勾选
    await showColumnsByLabels('云')
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
    // F-17：环境 / 集群 / 应用名称默认不可见，先经「列设置」勾选
    await showColumnsByLabels('环境', '集群', '应用名称')
    const headers = visibleHeaderTexts()
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
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('云')
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
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('云')
    expect(await screen.findByText('腾讯云（已停用）')).toBeInTheDocument()
  })

  it('决策 103：字典缺条目回退显示 cloud_code', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { cloud_code: 'PRI-TX' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('云')
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    expect(within(row).getAllByText('PRI-TX').length).toBeGreaterThanOrEqual(1)
  })

  it('决策 103：cloud_code 为空时云列渲染 "-"', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01', { cloud_code: '' })], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('云')
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
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
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('平台')
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
    // F-17：平台默认不可见，先经「列设置」勾选，否则该断言无意义（列不存在恒为 null）
    await showColumnsByLabels('平台')
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
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('平台')
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
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
    await screen.findByText('prod-web-01')
    await showColumnsByLabels('平台')
    expect(await screen.findByText('旧平台（已停用）')).toBeInTheDocument()
  })

  // 决策 103 + 红线④：五类 Tab 均**可配置**「云」列且不得出现 cloud_type / carrier 独立列。
// F-17 起「云」不是默认可见列，故断言口径改为「列设置下拉里存在云列，勾选后表头出现且仅一次」。
  it('决策 103 + 红线④：五类 Tab 均含「云」列且不得出现 cloud_type / carrier 独立列', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const name of ['主机', '数据库', '中间件', '应用服务', '其他监控目标']) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      await showColumnsByLabels('云')
      const headers = visibleHeaderTexts()
      expect(headers.filter((t) => t === '云').length, `${name} tab：云列应恰好出现一次`).toBe(1)
      expect(headers.some((t) => t.includes('云类型')), `${name} tab：不得出现云类型列`).toBe(false)
      expect(headers.some((t) => t.includes('云载体')), `${name} tab：不得出现云载体列`).toBe(false)
      closeColumnSettings()
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
    await screen.findByText('prod-web-01')
    // F-17：环境 / 集群默认不可见，先经「列设置」勾选
    await showColumnsByLabels('环境', '集群')
    const row = screen.getByText('prod-web-01').closest('tr') as HTMLElement
    expect(within(row).getAllByText('-').length).toBeGreaterThanOrEqual(2)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // F-18：四层模型查询侧下沉（决策110/111/112）——平台 / 应用 / 服务三维筛选
  // ─────────────────────────────────────────────────────────────────────────

  /** F-18：选中平台后，platform_code 进入列表请求参数（FilterBar 首级下拉）。 */
  it('F-18：选中平台后把 platform_code 下发给后端列表', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ platform_code: 'ecommerce', platform_name: '电商平台', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部平台'))
    fireEvent.click(await screen.findByText('电商平台'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ platform_code: 'ecommerce' })),
    )
  })

  /** F-18：停用平台不出现在筛选下拉（§5C 红线④：停用平台禁止新引用）。 */
  it('F-18：平台筛选下拉仅列启用平台，停用平台不可选', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { platform_code: 'ecommerce', platform_name: '电商平台', enabled: true },
          { platform_code: 'legacy', platform_name: '停用平台', enabled: false },
        ],
        total: 2,
      },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部平台'))
    expect(await screen.findByText('电商平台')).toBeInTheDocument()
    expect(screen.queryByText('停用平台')).toBeNull()
  })

  /** F-18：选中应用后 app_code 进入请求参数（app_code 查询侧补齐）。 */
  it('F-18：选中应用后把 app_code 下发给后端列表', async () => {
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ app_code: 'order', app_name: '订单服务', status: 'enabled' }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部应用'))
    fireEvent.click(await screen.findByText('订单服务 (order)'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ app_code: 'order' })))
  })

  /**
   * F-18 核心联动：应用下拉**按所选 platform_code 级联**（数据源 app_platform_rel，
   * 决策 111 M:N，与资源表单三级级联同源）——未关联到所选平台的应用不得出现在候选中。
   */
  it('F-18：应用下拉按所选平台级联过滤（app_platform_rel）', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ platform_code: 'ecommerce', platform_name: '电商平台', enabled: true }], total: 1 },
    })
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { app_code: 'order', app_name: '订单服务', status: 'enabled' },
          { app_code: 'payment', app_name: '支付服务', status: 'enabled' },
        ],
        total: 2,
      },
    })
    // 仅 order 关联到 ecommerce 平台
    appPlatformRelListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ rel_id: 'rel-1', app_code: 'order', platform_code: 'ecommerce', is_primary: true }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())

    // 先选平台 → ecommerce（order 关联、payment 未关联）
    fireEvent.mouseDown(screen.getByText('全部平台'))
    fireEvent.click(await screen.findByText('电商平台'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ platform_code: 'ecommerce' })),
    )

    // 应用下拉按平台收敛：仅订单服务在候选内，支付服务被过滤掉
    fireEvent.mouseDown(screen.getByText('全部应用'))
    expect(await screen.findByText('订单服务 (order)')).toBeInTheDocument()
    expect(screen.queryByText('支付服务 (payment)')).toBeNull()
  })

  /** F-18：未选平台时应用下拉不做平台过滤（保持「先选平台」非硬前置，同表单级联口径）。 */
  it('F-18：未选平台时应用下拉列出全部启用应用', async () => {
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { app_code: 'order', app_name: '订单服务', status: 'enabled' },
          { app_code: 'legacy', app_name: '停用应用', status: 'disabled' },
        ],
        total: 2,
      },
    })
    appPlatformRelListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ rel_id: 'rel-1', app_code: 'order', platform_code: 'ecommerce', is_primary: true }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部应用'))
    expect(await screen.findByText('订单服务 (order)')).toBeInTheDocument()
    expect(screen.queryByText('停用应用')).toBeNull()
  })

  /** F-18：切换平台时清空已选应用（避免跨平台后残留一个下拉候选外的生效筛选）。 */
  it('F-18：切换平台时清空已选应用', async () => {
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { platform_code: 'ecommerce', platform_name: '电商平台', enabled: true },
          { platform_code: 'retail', platform_name: '零售平台', enabled: true },
        ],
        total: 2,
      },
    })
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ app_code: 'order', app_name: '订单服务', status: 'enabled' }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部应用'))
    fireEvent.click(await screen.findByText('订单服务 (order)'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ app_code: 'order' })))
    fireEvent.mouseDown(screen.getByText('全部平台'))
    fireEvent.click(await screen.findByText('电商平台'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ platform_code: 'ecommerce', app_code: undefined }),
      ),
    )
  })

  /**
   * F-18 条件化断言（与列口径一致）：「服务」筛选器**仅** application / generic_target
   * 两个 Tab 出现；host / database / middleware 不渲染。
   */
  it('F-18：「服务」筛选器仅在应用服务/其他监控目标 Tab 出现', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())

    // host Tab：不出现
    expect(screen.queryByText('全部服务')).toBeNull()

    // database / middleware 同样不出现
    fireEvent.click(screen.getByText('数据库'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'database' })))
    expect(screen.queryByText('全部服务')).toBeNull()

    fireEvent.click(screen.getByText('中间件'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'middleware' })))
    expect(screen.queryByText('全部服务')).toBeNull()

    // application Tab：出现
    fireEvent.click(screen.getByText('应用服务'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'application' })))
    expect(await screen.findByText('全部服务')).toBeInTheDocument()

    // generic_target Tab：同样出现
    fireEvent.click(screen.getByText('其他监控目标'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'generic_target' })))
    expect(await screen.findByText('全部服务')).toBeInTheDocument()
  })

  /** F-18：application Tab 选中服务后 service_code 进入请求参数。 */
  it('F-18：选中服务后把 service_code 下发给后端列表', async () => {
    serviceDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ service_code: 'order-api', service_name: '订单接口', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    fireEvent.click(screen.getByText('应用服务'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'application' })))
    fireEvent.mouseDown(await screen.findByText('全部服务'))
    fireEvent.click(await screen.findByText('订单接口 (order-api)'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ service_code: 'order-api' })),
    )
  })

  /**
   * F-18 回归防护：service_code 生效时切到 host Tab，必须被清空——否则会带着一个
   * 下拉不可见的生效筛选器静默过滤行（用户无从感知、也无法清除）。
   */
  it('F-18：从应用服务切到主机 Tab 时清空已选服务', async () => {
    serviceDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ service_code: 'order-api', service_name: '订单接口', enabled: true }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    fireEvent.click(screen.getByText('应用服务'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ resource_category: 'application' })))
    fireEvent.mouseDown(await screen.findByText('全部服务'))
    fireEvent.click(await screen.findByText('订单接口 (order-api)'))
    await waitFor(() => expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ service_code: 'order-api' })))

    fireEvent.click(screen.getByText('主机'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ resource_category: 'host', service_code: undefined }),
      ),
    )
  })

  /**
   * F-18 回归防护：host Tab 选中应用（host 承载 app_code 语义）后，请求带 app_code，
   * 且**不带** service_code —— 服务维度对 host 无意义。
   */
  it('F-18：主机 Tab 应用筛选生效且不带 service_code', async () => {
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ app_code: 'order', app_name: '订单服务', status: 'enabled' }], total: 1 },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    fireEvent.mouseDown(screen.getByText('全部应用'))
    fireEvent.click(await screen.findByText('订单服务 (order)'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ resource_category: 'host', app_code: 'order', service_code: undefined }),
      ),
    )
  })

  // ─────────────────────────────────────────────────────────────────────────
  // F-17：资源列表列显隐配置（「列设置」下拉 + localStorage 按 category 分区）
  // ─────────────────────────────────────────────────────────────────────────

  /** F-17：五类 Tab 的 PM 裁定默认可见列（与 resourceColumnPrefs.DEFAULT_VISIBLE_COLUMN_KEYS 的标签形态对应） */
  const F17_DEFAULT_COLUMNS: Record<string, string[]> = {
    主机: ['实例名', '操作系统', '网域', '运行状态', '采集状态', '操作'],
    数据库: ['实例名', '数据库类型', '网域', '运行状态', '采集状态', '操作'],
    中间件: ['实例名', '中间件类型', '网域', '运行状态', '采集状态', '操作'],
    应用服务: ['服务名', '网域', '运行状态', '采集状态', '所属服务', '操作'],
    其他监控目标: ['目标名称', '网域', '运行状态', '采集状态', '所属服务', '操作'],
  }

  /** F-17：五类 Tab 的全量可配置列（下拉里应能看到的全部勾选项） */
  const F17_ALL_COLUMNS: Record<string, string[]> = {
    主机: ['实例名', 'IP 地址', '操作系统', '环境', '集群', '网域', '运行状态', '采集状态', '录入方式', '云', '平台', '应用名称', '业务名称', '操作'],
    数据库: ['实例名', '数据库类型', 'IP 地址', '端口', '版本', '网域', '运行状态', '采集状态', '录入方式', '云', '平台', '应用名称', '业务名称', '操作'],
    中间件: ['实例名', '中间件类型', 'IP 地址', '端口', '版本', '网域', '运行状态', '采集状态', '录入方式', '云', '平台', '应用名称', '业务名称', '操作'],
    应用服务: ['服务名', '健康检查 URL', '协议', '端点', '端口', '网域', '运行状态', '采集状态', '录入方式', '云', '平台', '应用名称', '所属服务', '业务名称', '操作'],
    其他监控目标: ['目标名称', 'Exporter 类型', 'IP 地址', '端口', '采集路径', '协议', '自定义标签', '网域', '运行状态', '采集状态', '录入方式', '云', '平台', '应用名称', '所属服务', '业务名称', '操作'],
  }

  it('F-17：工具栏提供「列设置」入口，可展开列出当前 Tab 的全部数据列', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    // 入口在 FilterBar 区（非表格浮层），按钮文案带当前已选 / 总数
    // 用正则匹配：antd 图标 span 会把aria-label 计入按钮可访问名（F-16 起各按钮均如此）
    expect(screen.getByRole('button', { name: /列设置（6\/14）/ })).toBeInTheDocument()
    // 初始未展开
    expect(screen.queryByRole('checkbox', { name: '环境' })).toBeNull()
    await openColumnSettings()
    // host 的 14 列全部可配置
    for (const label of F17_ALL_COLUMNS['主机']) {
      expect(screen.getByRole('checkbox', { name: label }), `host 下拉应含「${label}」`).toBeInTheDocument()
    }
    // 切到 application 后，下拉按当前 Tab 换列表（专属列不同）
    closeColumnSettings()
    fireEvent.click(screen.getByRole('tab', { name: '应用服务' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '应用服务' }).getAttribute('aria-selected')).toBe('true'))
    expect(screen.getByRole('button', { name: /列设置（6\/15）/ })).toBeInTheDocument()
    await openColumnSettings()
    expect(screen.getByRole('checkbox', { name: '健康检查 URL' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: '集群' })).toBeNull()
  })

  it('F-17：五类 Tab 默认可见列逐类等于 PM 裁定集合，且均为该类列集的子集', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    for (const [name, defaults] of Object.entries(F17_DEFAULT_COLUMNS)) {
      fireEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true'))
      const headers = visibleHeaderTexts()
      // 默认列齐全（不多不少、含列序）
      expect(headers, `${name} tab：默认可见列`).toEqual(defaults)
      // 可见列 ⊆ 该类全量列集（无列清单外的幽灵列）
      expect(headers.filter((h) => !F17_ALL_COLUMNS[name].includes(h)), `${name} tab：存在清单外列`).toEqual([])
      // 规范：列数 ≤ 8（tablePresets.ts）
      expect(headers.length, `${name} tab：默认列数`).toBeLessThanOrEqual(8)
    }
  })

  it('F-17：取消勾选某列后该列从表头消失、重新勾选后恢复', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // 默认可见：勾选「操作系统」再取消
    await showColumnsByLabels('操作系统')
    expect(visibleHeaderTexts()).toContain('操作系统')
    fireEvent.click(screen.getByRole('checkbox', { name: '操作系统' }))
    expect(visibleHeaderTexts()).not.toContain('操作系统')
    // 重新勾选后恢复，且列序回到原位
    fireEvent.click(screen.getByRole('checkbox', { name: '操作系统' }))
    expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['主机'])
    closeColumnSettings()
  })

  it('F-17：「列设置」下拉底部提供「恢复默认列」，一键回到 PM 裁定默认集并落库', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // 先把列取消到极简：勾掉全部可关闭的默认列（主标识 / 操作不可取消，仍留 2 列）
    await openColumnSettings()
    for (const label of ['操作系统', '网域', '运行状态', '采集状态']) {
      fireEvent.click(screen.getByRole('checkbox', { name: label }))
    }
    const minimal = visibleHeaderTexts()
    expect(minimal.length).toBeLessThan(F17_DEFAULT_COLUMNS['主机'].length)
    expect(minimal).toEqual(['实例名', '操作'])

    // 已是极简 ≠ 默认集，故「恢复默认列」此刻可点
    const resetBtn = screen.getByRole('button', { name: /恢复默认列/ })
    expect(resetBtn).not.toBeDisabled()
    fireEvent.click(resetBtn)

    // 一键回到默认集，列序亦恢复
    expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['主机'])
    // 落库同步为默认集（刷新 / 切 Tab 后仍恢复，不残留极简偏好）
    expect(JSON.parse(window.localStorage.getItem('mc_res_list_cols_host') ?? '[]')).toEqual([
      'name',
      'os_type',
      'network_domain_id',
      'status',
      'monitor_state',
      'actions',
    ])
    closeColumnSettings()
  })

  it('F-17：已是默认列集时「恢复默认列」禁用，改动后重新可用；且只作用于当前 Tab', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    await openColumnSettings()
    // 初始即默认集 → 禁用（避免无意义点击）
    expect(screen.getByRole('button', { name: /恢复默认列/ })).toBeDisabled()

    // host 改动 → 解禁
    fireEvent.click(screen.getByRole('checkbox', { name: '集群' }))
    expect(screen.getByRole('button', { name: /恢复默认列/ })).not.toBeDisabled()

    // 切到数据库 Tab：该分区仍是自己的默认集 → 同样禁用（恢复入口按 Tab 独立判断）
    closeColumnSettings()
    fireEvent.click(screen.getByRole('tab', { name: '数据库' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '数据库' }).getAttribute('aria-selected')).toBe('true'))
    await openColumnSettings()
    expect(screen.getByRole('button', { name: /恢复默认列/ })).toBeDisabled()

    // 恢复 host：切回去后仍是非默认状态（未被数据库的恢复动作误伤）
    closeColumnSettings()
    fireEvent.click(screen.getByRole('tab', { name: '主机' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '主机' }).getAttribute('aria-selected')).toBe('true'))
    expect(visibleHeaderTexts()).toContain('集群')
    closeColumnSettings()
  })

  it('F-17：主标识列与操作列不可取消勾选（勾选项 disabled，且点击不生效）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    await openColumnSettings()
    // 固定列归入「固定列」分组小标题
    expect(screen.getByText('固定列')).toBeInTheDocument()
    for (const label of ['实例名', '操作']) {
      const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
      expect(box.checked, `${label} 默认应勾选`).toBe(true)
      expect(box.disabled, `${label} 应不可取消勾选`).toBe(true)
      // 点击 disabled 勾选项不改变可见列集
      fireEvent.click(box)
      expect(visibleHeaderTexts()).toContain(label)
      expect((screen.getByRole('checkbox', { name: label }) as HTMLInputElement).checked).toBe(true)
    }
    closeColumnSettings()
    expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['主机'])
  })

  it('F-17：偏好按 resource_category 分区落库，切 Tab 各自恢复自己的偏好', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await screen.findByRole('tab', { name: '主机' })
    // host：勾选「集群」并取消「操作系统」
    await showColumnsByLabels('集群')
    fireEvent.click(screen.getByRole('checkbox', { name: '操作系统' }))
    expect(visibleHeaderTexts()).toContain('集群')
    expect(visibleHeaderTexts()).not.toContain('操作系统')
    // 落库键名含 resource_category，值为列 key 数组
    expect(JSON.parse(window.localStorage.getItem('mc_res_list_cols_host') ?? '[]')).toEqual([
      'name',
      'cluster',
      'network_domain_id',
      'status',
      'monitor_state',
      'actions',
    ])
    // database 分区未被影响，仍是自己的默认集
    expect(window.localStorage.getItem('mc_res_list_cols_database')).toBeNull()

    // 切到 database Tab → 默认列集（host 偏好不串台）
    closeColumnSettings()
    fireEvent.click(screen.getByRole('tab', { name: '数据库' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '数据库' }).getAttribute('aria-selected')).toBe('true'))
    expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['数据库'])
    expect(visibleHeaderTexts()).not.toContain('集群')

    // database：勾选自己的「端口」→ 独立分区键
    await showColumnsByLabels('端口')
    expect(window.localStorage.getItem('mc_res_list_cols_database')).not.toBeNull()
    expect(window.localStorage.getItem('mc_res_list_cols_middleware')).toBeNull()

    // 切回 host → 恢复 host 自己的偏好（未切走时的勾选仍在）
    closeColumnSettings()
    fireEvent.click(screen.getByRole('tab', { name: '主机' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '主机' }).getAttribute('aria-selected')).toBe('true'))
    const hostHeaders = visibleHeaderTexts()
    expect(hostHeaders).toContain('集群')
    expect(hostHeaders).not.toContain('操作系统')
    expect(hostHeaders).not.toContain('端口')
    closeColumnSettings()
  })

  it('F-17：重新挂载页面后从 localStorage 恢复偏好（无需每日重复配置）', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    const first = renderPage()
    await screen.findByRole('tab', { name: '主机' })
    await showColumnsByLabels('环境', '集群')
    first.unmount()
    // 同一 storageMap 下重新挂载 → 偏好被恢复
    renderPage()
    const headers = visibleHeaderTexts()
    expect(headers).toContain('环境')
    expect(headers).toContain('集群')
    expect(headers).not.toContain('IP 地址')
  })

  it('F-17：localStorage 脏数据（解析失败 / 含已不存在的 key）时静默回退默认列集且不抛错', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    // 非 JSON 文本
    window.localStorage.setItem('mc_res_list_cols_host', 'not-json{')
    const first = renderPage()
    await screen.findByRole('tab', { name: '主机' })
    expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['主机'])
    first.unmount()
    // 含已下线的列 key
    window.localStorage.setItem('mc_res_list_cols_host', JSON.stringify(['name', 'legacy_removed_col', 'actions']))
    renderPage()
    expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['主机'])
  })

  // frontend-reviewer M-1：`RESOURCE_COLUMN_META` 与 `buildColumns` 是两份独立列清单，
  // 缺机制保证同步 → 未来任一侧漏改会**静默丢列**（用户无法勾选、列永不渲染、测试全绿）。
  // 护栏：逐列断言「META 声明的每列都能经列设置勾选出对应表头」——
  // 若 buildColumns 少定义一列，勾了也不出现 → 本用例变红。
  it('F-17/M-1：RESOURCE_COLUMN_META 与实际表头列集一致（防静默丢列 / key 漂移）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // 一次全勾（非逐列，避免逐列开关浮层导致超时）
    await showColumnsByLabels(...RESOURCE_COLUMN_META.host.map((m) => m.label))
    // **数量对齐**：全部勾选后表头列数须等于 META 列数——
    // 若 buildColumns 少定义一列 / 某列 key 与 META 漂移，
    // 勾选时 orderColumnKeys 会因 key 不在 known 集合而丢弃它，表头数就会少于 META 数。
    expect(visibleHeaderTexts().length).toBe(RESOURCE_COLUMN_META.host.length)
  })

  // frontend-reviewer H-1：浮层「不关闭」此前依赖 rc-dropdown 内部短路（赌 antd 实现）。
  // ⚠️ 已知局限（实测得出，勿误以为本用例已完全防护）：jsdom 不实现真实布局，
  // `onPopupClick` 的关闭路径在 jsdom 下根本不触发——实测同时移除受控 `open` 与
  // `stopPropagation` 两处保护，本用例**仍然通过**。故它只能锁住「当前实现组合下浮层不关闭」，
  // 无法在 jsdom 内咬住「若 antd 升级导致一点就关」。真实防护由代码侧显式受控 + stopPropagation
  // 双重保证，本用例作为回归哨兵保留；真实浏览器行为须人工/ E2E 复核。
  it('F-17：连续勾选多列期间「列设置」浮层保持展开（H-1）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    renderPage()
    await screen.findByText('prod-web-01')
    // 列设置浮层受控展开（显式 open 状态，而非依赖 rc-dropdown 内部短路）
    await openColumnSettings()
    expect(document.querySelector('.ant-checkbox-group')).toBeTruthy()
    // 连勾3 列，浮层须始终保持展开
    for (const label of ['IP 地址', '环境', '集群']) {
      expect(document.querySelector('.ant-checkbox-group'), `勾选「${label}」前浮层应展开`).toBeTruthy()
      const box = screen.getByRole('checkbox', { name: label }) as HTMLInputElement
      if (!box.checked) fireEvent.click(box)
      expect(document.querySelector('.ant-checkbox-group'), `勾选「${label}」后浮层应仍展开`).toBeTruthy()
    }
    // 三列均已生效，且未因浮层反复开关而丢失状态
    expect(visibleHeaderTexts()).toEqual(expect.arrayContaining(['IP 地址', '环境', '集群']))
    closeColumnSettings()
  })

  // frontend-reviewer M-2：关联表加载失败时降级方向须「放宽」，不能「收紧」成空下拉
  it('F-18：应用↔平台关联加载失败时，应用下拉降级为全部启用应用（不按平台过滤）', async () => {
    // 关联表加载失败（reject）→ 应静默降级为「不按平台过滤」，而非收紧成空下拉
    appPlatformRelListMock.mockRejectedValue(new Error('network down'))
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ platform_code: 'ecommerce', platform_name: '电商平台', enabled: true }], total: 1 },
    })
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { app_code: 'order', app_name: '订单服务', status: 'enabled' },
          { app_code: 'payment', app_name: '支付服务', status: 'enabled' },
        ],
        total: 2,
      },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    // 等关联请求已发生（无论成功失败），确保降级状态已写入 state
    await waitFor(() => expect(appPlatformRelListMock).toHaveBeenCalled())
    // 让reject 的 catch链有机会跑完并触发 state 更新
    await waitFor(() => expect(applicationDictListMock).toHaveBeenCalled())
    await waitFor(() => expect(listMock).toHaveBeenCalled())

    // 先选平台 → 应用下拉仍应列出全部启用应用（而非空）
    fireEvent.mouseDown(screen.getByText('全部平台'))
    fireEvent.click(await screen.findByText('电商平台'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ platform_code: 'ecommerce' })),
    )

    fireEvent.mouseDown(screen.getByText('全部应用'))
    expect(await screen.findByText('订单服务 (order)')).toBeInTheDocument()
    expect(screen.queryByText('支付服务 (payment)')).not.toBeNull()
  })

  /**
   * M-2 另一侧：关联表**加载成功且该平台确实无关联**时，仍应按平台收敛（不得一律放宽）。
   * 与上一条互为对照，防止把降级做成「永远不过滤」。
   */
  it('F-18：关联表加载成功但平台确无关联时，应用下拉按平台收敛为空', async () => {
    appPlatformRelListMock.mockResolvedValue({
      status: 'success',
      data: { list: [{ rel_id: 'rel-1', app_code: 'order', platform_code: 'ecommerce', is_primary: true }], total: 1 },
    })
    platformDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { platform_code: 'ecommerce', platform_name: '电商平台', enabled: true },
          { platform_code: 'retail', platform_name: '零售平台', enabled: true },
        ],
        total: 2,
      },
    })
    applicationDictListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { app_code: 'order', app_name: '订单服务', status: 'enabled' },
          { app_code: 'payment', app_name: '支付服务', status: 'enabled' },
        ],
      },
    })
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    renderPage()
    await waitFor(() => expect(listMock).toHaveBeenCalled())
    // 选「零售平台」——该平台确实无任何应用关联
    fireEvent.mouseDown(screen.getByText('全部平台'))
    fireEvent.click(await screen.findByText('零售平台'))
    await waitFor(() =>
      expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ platform_code: 'retail' })),
    )
    fireEvent.mouseDown(screen.getByText('全部应用'))
    // 关联表非空（length > 0）→ 正常按平台收敛：retail 无任何关联 → 两个应用都不可见。
    // 这条与上一条（rels 为空 → 放宽）互为对照，防止降级被写成「永远不过滤」。
    await waitFor(() => expect(screen.queryByText('订单服务 (order)')).toBeNull())
    expect(screen.queryByText('支付服务 (payment)')).toBeNull()
  })

  it('F-17：localStorage 缺固定列的脏偏好不会把固定列挤出表头（sticky 不依赖偏好）', async () => {
    listMock.mockResolvedValue({
      status: 'success',
      data: { list: [hostItem('res-1', 'prod-web-01')], total: 1, page: 1, page_size: 50 },
    })
    window.localStorage.setItem('mc_res_list_cols_host', JSON.stringify(['os_type', 'network_domain_id']))
    renderPage()
    await screen.findByText('prod-web-01')
    const headers = visibleHeaderTexts()
    // 偏好里的合法 key 被尊重（此处即用户所选），固定列被强制并回
    expect(headers[0]).toBe('实例名')
    expect(headers[headers.length - 1]).toBe('操作')
    expect(headers).toEqual(['实例名', '操作系统', '网域', '操作'])
  })

  it('F-17：localStorage 不可用（隐私模式 / SSR 抛错）时降级为默认列集且不报错', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: localStorage is disabled')
      },
    })
    try {
      renderPage()
      await screen.findByRole('tab', { name: '主机' })
      // 不抛错，回退默认列集
      expect(visibleHeaderTexts()).toEqual(F17_DEFAULT_COLUMNS['主机'])
      // 交互仍可用（仅内存态）：勾选即时生效
      await showColumnsByLabels('环境')
      expect(visibleHeaderTexts()).toContain('环境')
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
      else Reflect.deleteProperty(window, 'localStorage')
    }
  })

  it('F-17：「列设置」下拉内含语义分组小标题，且不占表头', async () => {
    listMock.mockResolvedValue({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })
    const { container } = renderPage()
    await screen.findByRole('tab', { name: '主机' })
    await openColumnSettings()
    // 三组小标题（承载F-13 想解决的「哪些列是业务归属」认知问题）
    for (const g of ['固定列', '技术属性 / 位置', '业务归属']) {
      expect(screen.getByText(g), `下拉应含分组小标题「${g}」`).toBeInTheDocument()
    }
    closeColumnSettings()
    // 分组只在浮层内，表头仍是单行平铺、无分组父列
    expect(container.querySelectorAll('thead tr').length).toBe(1)
    expect(container.querySelectorAll('th[scope="colgroup"]').length).toBe(0)
    expect(container.textContent).not.toContain('技术属性 / 位置')
    expect(container.textContent).not.toContain('业务归属')
  })
})
