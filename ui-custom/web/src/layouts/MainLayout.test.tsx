import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../test/antdTestUtils'
import { MainLayout } from './MainLayout'
import { SIDER_COLLAPSED_KEY } from './siderPreference'
import { SkinProvider } from '../SkinProvider'
import { DEFAULT_PRODUCT_NAME, PRODUCT_NAME_STORAGE_KEY } from '../productNamePreference'

// 顶部栏右上角展示依赖 api/client.getStoredUser（jsdom 无 localStorage 可用），
// 此处 mock 返回一个已登录的管理员账号。
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    getStoredUser: () => ({
      id: 'admin',
      username: 'admin',
      display_name: '系统管理员',
      tenant_id: 'platform_admin',
      role: 'admin',
    }),
  }
})

// vitest jsdom 环境的 window.localStorage 存储行为不可靠，用内存 Map 替换（与 client.test.ts 一致），
// 否则 beforeEach 的 localStorage.clear() 因 clear 非函数而全量报错。
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

const { listPanelsMock } = vi.hoisted(() => ({ listPanelsMock: vi.fn() }))
vi.mock('../api/dashboardPanels', () => ({
  dashboardPanelApi: { list: listPanelsMock },
}))

// 账号下拉菜单的登出动作：只断言「调用了登出并回到登录页」，真实 API 调用由
// api/auth.ts 的单元职责覆盖，布局测试不触网。
const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }))
vi.mock('../api/auth', () => ({ logout: logoutMock }))

describe('MainLayout', () => {
  setupAntdTest()

  // 侧栏折叠偏好落在 localStorage（跨模块 / 跨刷新共用），用例间必须清干净，避免相互污染
  beforeEach(() => {
    window.localStorage.clear()
    logoutMock.mockReset()
    listPanelsMock.mockReset()
    listPanelsMock.mockResolvedValue({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 100 },
    })
  })

  it('renders the 可视化大屏 secondary nav and an empty custom dashboard group', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout>home-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('概览 Dashboard')).toBeInTheDocument()
    // M05 SRS v1.2：「使用引导」独立子页已下线，导航不再出现该入口。
    expect(screen.queryByText('使用引导')).not.toBeInTheDocument()
    const selected = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent || '').includes('概览 Dashboard'))
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    expect(screen.getByText('自定义大屏')).toBeInTheDocument()
    expect(screen.queryByText('v0.2')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('自定义大屏'))
    expect(await screen.findByText('暂无挂载面板')).toBeInTheDocument()
    // M05 FR-09：管理员空态提供「去登记面板」引导，普通用户不展示（写操作 403）。
    expect(screen.getByText('去登记面板')).toBeInTheDocument()
  })

  it('merges the former 首页 into the single 可视化大屏 primary tab', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout>big-screen-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )

    const tabs = screen.getAllByRole('button').filter((el) => el.className.includes('app-module-tab'))
    expect(tabs[0]).toHaveTextContent('可视化大屏')
    expect(tabs[0].className).toContain('active')
    // 原独立「可视化大屏」一级入口已合并，导航中只应有一个同名一级 tab。
    expect(tabs.filter((tab) => (tab.textContent || '').includes('可视化大屏'))).toHaveLength(1)
    expect(screen.queryByText('首页')).not.toBeInTheDocument()
    expect(screen.getByText('big-screen-content')).toBeInTheDocument()
  })

  it('builds custom dashboard menus from mounted panels and highlights the current panel', async () => {
    listPanelsMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [{ id: 7, name: '节点监控大屏', url: 'http://grafana.example.com/d/node' }],
        total: 1,
        page: 1,
        page_size: 100,
      },
    })
    render(
      <MemoryRouter initialEntries={['/dashboard/panels/7']}>
        <Routes>
          <Route path="/dashboard/panels/7" element={<MainLayout>panel-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )

    const menuItem = await screen.findByText('节点监控大屏')
    await waitFor(() => {
      expect(menuItem.closest('li')?.className ?? '').toContain('ant-menu-item-selected')
    })
    expect(screen.getByText('panel-content')).toBeInTheDocument()
  })

  it('collapses and expands the sider from the header toggle and persists the preference', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout>home-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )

    const siderClass = () => (document.querySelector('.ant-layout-sider') as HTMLElement).className
    // 默认展开（宽 200px 的二级导航）
    expect(siderClass()).not.toContain('ant-layout-sider-collapsed')

    // 折叠：仅留图标列，偏好写入 localStorage
    fireEvent.click(screen.getByTestId('sider-toggle'))
    expect(siderClass()).toContain('ant-layout-sider-collapsed')
    expect(window.localStorage.getItem(SIDER_COLLAPSED_KEY)).toBe('1')

    // 再点：展开并回写偏好
    fireEvent.click(screen.getByTestId('sider-toggle'))
    expect(siderClass()).not.toContain('ant-layout-sider-collapsed')
    expect(window.localStorage.getItem(SIDER_COLLAPSED_KEY)).toBe('0')
  })

  it('restores the stored collapsed preference on first render（跨刷新 / 跨模块保持一致）', () => {
    window.localStorage.setItem(SIDER_COLLAPSED_KEY, '1')

    render(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route path="/scrape-jobs" element={<MainLayout>jobs-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )

    // 其他模块同样读取同一份偏好：上次折叠后切到别的模块仍是折叠态
    expect((document.querySelector('.ant-layout-sider') as HTMLElement).className).toContain(
      'ant-layout-sider-collapsed',
    )
  })

  it('shows 采集模板 as a Sider sub-item under 采集策略 module (M01 v2.0)', () => {
    render(
      <MemoryRouter initialEntries={['/collectors']}>
        <Routes>
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab 用 PRD 模块名「采集策略」
    expect(screen.getByText('采集策略')).toBeInTheDocument()
    // 「监控对象类型」概念已下线：采集策略下只剩 采集模板 / 采集 Job / 规则编辑 / 指标库
    const siderTexts = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent ?? '')
    expect(siderTexts.some((t) => t.includes('监控对象类型'))).toBe(false)
    expect(siderTexts.some((t) => t.includes('采集器管理'))).toBe(false)
    expect(siderTexts.some((t) => t.includes('采集模板'))).toBe(true)
    expect(siderTexts.some((t) => t.includes('采集 Job'))).toBe(true)
    // 动线不变：先采集模板、后采集 Job
    const templatesIdx = siderTexts.findIndex((t) => t.includes('采集模板'))
    const jobsIdx = siderTexts.findIndex((t) => t.includes('采集 Job'))
    expect(templatesIdx).toBeGreaterThan(-1)
    expect(templatesIdx).toBeLessThan(jobsIdx)
    expect(screen.getByText('collector-content')).toBeInTheDocument()
  })

  // M01 v2.0：/monitor-types 路由与「监控对象类型」菜单项整体下线（模板 + 任务选择器取代），
  // 点击一级 tab「采集策略」仍默认落在首个子项「采集模板」（/collectors）。

  // D-1b ⓐ：规则编辑保持原名称与归属（方案丙），菜单项补副标题「含告警规则、记录规则」。
  it('D-1b：规则编辑菜单项带副标题「含告警规则、记录规则」，且 /rules 仍归属采集策略', () => {
    render(
      <MemoryRouter initialEntries={['/rules']}>
        <Routes>
          <Route path="/rules" element={<MainLayout>rules-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab：采集策略保持激活（/rules 归属判定不变，导航零变更）
    expect(screen.getByText('采集策略')).toBeInTheDocument()
    expect(screen.getByText('rules-content')).toBeInTheDocument()
    // 菜单项文本 = 主标题 + 副标题
    const menuTexts = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent ?? '')
    const rulesIdx = menuTexts.findIndex((t) => t.includes('规则编辑'))
    expect(rulesIdx).toBeGreaterThanOrEqual(0)
    expect(menuTexts[rulesIdx]).toContain('含告警规则、记录规则')
  })

  it('navigates to /collectors (首个子项) when top-module 采集策略 clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout>home-content</MainLayout>} />
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
          <Route path="/scrape-jobs" element={<MainLayout>jobs-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('home-content')).toBeInTheDocument()
    fireEvent.click(screen.getByText('采集策略'))
    // 点击一级 tab 应默认定位到第一个子项「采集模板」（/collectors），而非「采集 Job」
    await waitFor(() => expect(screen.getByText('collector-content')).toBeInTheDocument())
    expect(screen.queryByText('jobs-content')).toBeNull()
  })

  it('navigates to /collectors when 采集模板 sub-item clicked', () => {
    render(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route path="/scrape-jobs" element={<MainLayout>jobs-content</MainLayout>} />
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('jobs-content')).toBeInTheDocument()
    fireEvent.click(screen.getByText('采集模板'))
    // 真实路由导航：Content 由 jobs-content 切换为 collector-content
    expect(screen.getByText('collector-content')).toBeInTheDocument()
    expect(screen.queryByText('jobs-content')).toBeNull()
  })

  it('M09 侧栏平铺 5 项：含指标查询，不再有折叠分组与两页快照入口', async () => {
    render(
      <MemoryRouter initialEntries={['/config-snapshots']}>
        <Routes>
          <Route path="/config-snapshots" element={<MainLayout>snapshots-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab：M09 独立为「配置与查询中心」顶级模块
    expect(screen.getByText('配置与查询中心')).toBeInTheDocument()
    expect(screen.getByText('系统与平台管理')).toBeInTheDocument()
    // 平铺：5 个二级页面常态可见，无需展开任何分组
    expect(await screen.findByText('网域纳管')).toBeInTheDocument()
    expect(screen.getByText('采集节点状态')).toBeInTheDocument()
    expect(screen.getByText('监控目标状态')).toBeInTheDocument()
    expect(screen.getByText('指标查询')).toBeInTheDocument()
    expect(screen.getByText('配置产物历史')).toBeInTheDocument()
    // 分组标题与已合并的「快照历史」入口均不再出现
    expect(screen.queryByText('网域与节点管理')).toBeNull()
    expect(screen.queryByText('配置下发')).toBeNull()
    expect(screen.queryByText('快照历史')).toBeNull()
    expect(screen.getByText('snapshots-content')).toBeInTheDocument()
  })

  it('M09 二级导航不含可折叠 SubMenu（平铺后无 ant-menu-submenu 节点）', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/domain-onboarding']}>
        <Routes>
          <Route
            path="/domain-onboarding"
            element={<MainLayout>onboarding-content</MainLayout>}
          />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('网域纳管')
    expect(container.querySelector('.app-sider .ant-menu-submenu')).toBeNull()
    expect(container.querySelectorAll('.app-sider .ant-menu-item').length).toBe(5)
  })

  it('highlights 采集节点状态 when route is /node-status (M09 平铺菜单选中态)', async () => {
    render(
      <MemoryRouter initialEntries={['/node-status']}>
        <Routes>
          <Route path="/node-status" element={<MainLayout>node-status-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => {
      const selected = screen
        .getAllByRole('menuitem')
        .find((el) => (el.textContent || '').includes('采集节点状态'))
      expect(selected).toBeDefined()
      expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    })
  })

  it('resolves /domain-onboarding、/node-status、/config-snapshots 到配置与查询中心 tab', () => {
    render(
      <MemoryRouter initialEntries={['/config-snapshots']}>
        <Routes>
          <Route path="/config-snapshots" element={<MainLayout>preview-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab「配置与查询中心」处于 active
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('配置与查询中心'))
    expect(tab?.className ?? '').toContain('active')
    expect(screen.getByText('preview-content')).toBeInTheDocument()
  })

  it('resolves /query 到配置与查询中心 tab 并选中「指标查询」', async () => {
    render(
      <MemoryRouter initialEntries={['/query']}>
        <Routes>
          <Route path="/query" element={<MainLayout>query-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('配置与查询中心'))
    expect(tab?.className ?? '').toContain('active')
    await waitFor(() => {
      const selected = screen
        .getAllByRole('menuitem')
        .find((el) => (el.textContent || '').includes('指标查询'))
      expect(selected).toBeDefined()
      expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    })
    expect(screen.getByText('query-content')).toBeInTheDocument()
  })

  it('shows role + username info in the header top-right when signed in', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout>home-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 右上角：管理员角色标签 + 用户名（精简版，不含显示名称）
    expect(screen.getByText('管理员')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('home-content')).toBeInTheDocument()
  })

  it('opens the account dropdown and logs out back to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<MainLayout>home-content</MainLayout>} />
          <Route path="/login" element={<div>login-content</div>} />
        </Routes>
      </MemoryRouter>,
    )

    // 点击右上角账号名展开下拉菜单，菜单中有「退出登录」
    fireEvent.click(screen.getByTestId('account-menu-trigger'))
    const logoutItem = await screen.findByText('退出登录')
    fireEvent.click(logoutItem)

    // 调用登出（服务端会话销毁 + 本地凭据清理），并跳转登录页
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('login-content')).toBeInTheDocument()
  })

  it('renders M08 独立顶级模块「告警收敛与通知管理」及两个二级子项并高亮（/alert-config）', async () => {
    render(
      <MemoryRouter initialEntries={['/alert-config']}>
        <Routes>
          <Route path="/alert-config" element={<MainLayout>alert-config-content</MainLayout>} />
          <Route path="/silences" element={<MainLayout>silences-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab 用 PRD 模块名「告警收敛与通知管理」，且处于 active
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('告警收敛与通知管理'))
    expect(tab).toBeDefined()
    expect(tab?.className ?? '').toContain('active')
    // Sider 二级导航同时展示「告警配置 / 静默管理」，且当前路由高亮「告警配置」
    expect(screen.getByText('告警配置')).toBeInTheDocument()
    expect(screen.getByText('静默管理')).toBeInTheDocument()
    await waitFor(() => {
      const selected = screen
        .getAllByRole('menuitem')
        .find((el) => (el.textContent || '').includes('告警配置'))
      expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    })
    expect(screen.getByText('alert-config-content')).toBeInTheDocument()
  })

  it('renders M08 alert sidebar in IA order: 查看 → 收敛 → 分发 → 通知 → 只读产物', async () => {
    render(
      <MemoryRouter initialEntries={['/alert-status']}>
        <Routes>
          <Route path="/alert-status" element={<MainLayout>alert-status-content</MainLayout>} />
          <Route path="/alert-history" element={<MainLayout>alert-history-content</MainLayout>} />
          <Route path="/silences" element={<MainLayout>silences-content</MainLayout>} />
          <Route path="/inhibitions" element={<MainLayout>inhibitions-content</MainLayout>} />
          <Route path="/routes" element={<MainLayout>routes-content</MainLayout>} />
          <Route path="/notify-channels" element={<MainLayout>notify-channels-content</MainLayout>} />
          <Route path="/notify-templates" element={<MainLayout>notify-templates-content</MainLayout>} />
          <Route path="/alert-config" element={<MainLayout>alert-config-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 侧栏信息架构（用户反馈原顺序无逻辑后重排）：
    // 查看（告警状态 / 历史告警）→ 收敛（静默管理 / 告警抑制）
    // → 分发（路由规则）→ 通知（通知渠道 / 通知模板）→ 只读产物（告警配置）
    const expectedOrder = [
      '告警状态',
      '历史告警',
      '静默管理',
      '告警抑制',
      '路由规则',
      '通知渠道',
      '通知模板',
      '告警配置',
    ]
    const siderLabels = screen
      .getAllByRole('menuitem')
      .map((el) => (el.textContent ?? '').trim())
      .filter((text) => expectedOrder.includes(text))
    // 八项齐全且顺序完全一致（首项告警状态、末项告警配置）
    expect(siderLabels).toEqual(expectedOrder)
  })

  /**
   * F-12 修复：监控对象管理二级导航中「平台 → 应用」按归属层级相邻成组
   * （平台承载应用），「业务管理」作为横切分类维度单独置后。
   */
  it('orders 监控对象管理 sub-items: 平台 → 应用 as a consecutive group, 业务 last (F-12)', async () => {
    render(
      <MemoryRouter initialEntries={['/resources']}>
        <Routes>
          <Route path="/resources" element={<MainLayout>resources-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )

    // 顶部一级 tab 用 PRD 模块名「监控对象管理」
    expect(screen.getByText('监控对象管理')).toBeInTheDocument()
    // 全部子项都在 Sider 二级导航中
    const siderTexts = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent ?? '')
    const platformIdx = siderTexts.findIndex((t) => t.includes('平台管理'))
    const applicationIdx = siderTexts.findIndex((t) => t.includes('应用管理'))
    const businessIdx = siderTexts.findIndex((t) => t.includes('业务管理'))
    expect([platformIdx, applicationIdx, businessIdx]).not.toContain(-1)
    // 组成链相邻：平台 → 应用 连续排列
    expect(applicationIdx).toBe(platformIdx + 1)
    // 「业务管理」不与组成链交错，置后（位于应用之后）
    expect(businessIdx).toBeGreaterThan(applicationIdx)
  })

  /**
   * 外观设置（用户 2026-09-18 补充）：皮肤与产品名称的入口落在「系统与平台管理」模块，
   * **不再挂在顶栏**（顶栏只保留角色标签与账号）。
   */
  it('exposes 外观设置 under 系统与平台管理 and highlights it on /admin/appearance', () => {
    render(
      <MemoryRouter initialEntries={['/admin/appearance']}>
        <Routes>
          <Route
            path="/admin/appearance"
            element={<MainLayout>appearance-content</MainLayout>}
          />
        </Routes>
      </MemoryRouter>,
    )

    // 一级 tab 归「系统与平台管理」（resolveActiveModule 按 /admin/ 前缀收口）
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('系统与平台管理'))
    expect(tab?.className ?? '').toContain('active')

    // 二级导航含「外观设置」，且当前路由高亮该项
    const selected = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent || '').includes('外观设置'))
    expect(selected).toBeDefined()
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    expect(screen.getByText('appearance-content')).toBeInTheDocument()

    // 顶栏不再提供皮肤开关
    expect(screen.queryByTestId('skin-switch')).toBeNull()
  })

  /**
   * 云字典（D37：admin 只增维护）：维护页入口落在
   * 「系统与平台管理」模块，靠近「网域管理」（云归属是网域登记取值来源）。
   */
  it('exposes 云字典 under 系统与平台管理 and highlights it on /admin/cloud-dict', () => {
    render(
      <MemoryRouter initialEntries={['/admin/cloud-dict']}>
        <Routes>
          <Route
            path="/admin/cloud-dict"
            element={<MainLayout>cloud-dict-content</MainLayout>}
          />
        </Routes>
      </MemoryRouter>,
    )

    // 一级 tab 归「系统与平台管理」（resolveActiveModule 按 /admin/ 前缀收口）
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('系统与平台管理'))
    expect(tab?.className ?? '').toContain('active')

    // 二级导航含「云字典」，且当前路由高亮该项
    const selected = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent || '').includes('云字典'))
    expect(selected).toBeDefined()
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    expect(screen.getByText('cloud-dict-content')).toBeInTheDocument()
  })

  /**
   * PL-3 通知渲染桥（T08-F10）：通知渠道为 M08 新增能力页，
   * 归属「告警收敛与通知管理」一级模块，且在 Sider 二级导航高亮。
   */
  it('resolves /notify-channels to 告警收敛与通知管理 and highlights 通知渠道 sub-item', async () => {
    render(
      <MemoryRouter initialEntries={['/notify-channels']}>
        <Routes>
          <Route path="/notify-channels" element={<MainLayout>notify-channels-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 一级 tab 归「告警收敛与通知管理」并处于 active（否则会落到首页）
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('告警收敛与通知管理'))
    expect(tab?.className ?? '').toContain('active')
    // 二级导航含「通知渠道」且当前路由高亮该项
    const selected = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent || '').includes('通知渠道'))
    expect(selected).toBeDefined()
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    expect(screen.getByText('notify-channels-content')).toBeInTheDocument()
  })

  /**
   * PL-3 通知渲染桥（T08-F12）：通知模板同为 M08 新增能力页，
   * 归属「告警收敛与通知管理」一级模块，且在 Sider 二级导航高亮。
   */
  it('resolves /notify-templates to 告警收敛与通知管理 and highlights 通知模板 sub-item', async () => {
    render(
      <MemoryRouter initialEntries={['/notify-templates']}>
        <Routes>
          <Route path="/notify-templates" element={<MainLayout>notify-templates-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('告警收敛与通知管理'))
    expect(tab?.className ?? '').toContain('active')
    const selected = screen
      .getAllByRole('menuitem')
      .find((el) => (el.textContent || '').includes('通知模板'))
    expect(selected).toBeDefined()
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    expect(screen.getByText('notify-templates-content')).toBeInTheDocument()
  })

  it('renders the brand title from the stored product name and mirrors it to the tab title', async () => {
    window.localStorage.setItem(PRODUCT_NAME_STORAGE_KEY, '仪电监控中心')

    render(
      <MemoryRouter initialEntries={['/']}>
        <SkinProvider>
          <Routes>
            <Route path="/" element={<MainLayout>home-content</MainLayout>} />
          </Routes>
        </SkinProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('仪电监控中心')).toBeInTheDocument()
    expect(document.title).toBe('仪电监控中心')
  })

  it('falls back to the default product name when the stored value is blank', () => {
    window.localStorage.setItem(PRODUCT_NAME_STORAGE_KEY, '   ')

    render(
      <MemoryRouter initialEntries={['/']}>
        <SkinProvider>
          <Routes>
            <Route path="/" element={<MainLayout>home-content</MainLayout>} />
          </Routes>
        </SkinProvider>
      </MemoryRouter>,
    )

    // 品牌位永不出现空字符串：空白值回落默认名
    expect(screen.getByText(DEFAULT_PRODUCT_NAME)).toBeInTheDocument()
    expect(document.title).toBe(DEFAULT_PRODUCT_NAME)
  })
})