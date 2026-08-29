import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupAntdTest } from '../test/antdTestUtils'
import { MainLayout } from './MainLayout'

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

describe('MainLayout', () => {
  setupAntdTest()

  it('shows 采集器管理 as a Sider sub-item under 采集策略 module (F-09)', () => {
    render(
      <MemoryRouter initialEntries={['/collectors']}>
        <Routes>
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab 用 PRD 模块名「采集策略」
    expect(screen.getByText('采集策略')).toBeInTheDocument()
    // Sider 二级含「采集器管理」，且位于「采集 Job」之前（动线：先采集器、后 Job）
    const siderTexts = screen
      .getAllByRole('menuitem')
      .map((el) => el.textContent ?? '')
    expect(siderTexts.some((t) => t.includes('采集器管理'))).toBe(true)
    expect(siderTexts.some((t) => t.includes('采集 Job'))).toBe(true)
    const collectorsIdx = siderTexts.findIndex((t) => t.includes('采集器管理'))
    const jobsIdx = siderTexts.findIndex((t) => t.includes('采集 Job'))
    expect(collectorsIdx).toBeGreaterThan(-1)
    expect(collectorsIdx).toBeLessThan(jobsIdx)
    expect(screen.getByText('collector-content')).toBeInTheDocument()
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
    // 点击一级 tab 应默认定位到第一个子项「采集器管理」（/collectors），而非「采集 Job」
    await waitFor(() => expect(screen.getByText('collector-content')).toBeInTheDocument())
    expect(screen.queryByText('jobs-content')).toBeNull()
  })

  it('navigates to /collectors when 采集器管理 sub-item clicked', () => {
    render(
      <MemoryRouter initialEntries={['/scrape-jobs']}>
        <Routes>
          <Route path="/scrape-jobs" element={<MainLayout>jobs-content</MainLayout>} />
          <Route path="/collectors" element={<MainLayout>collector-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('jobs-content')).toBeInTheDocument()
    fireEvent.click(screen.getByText('采集器管理'))
    // 真实路由导航：Content 由 jobs-content 切换为 collector-content
    expect(screen.getByText('collector-content')).toBeInTheDocument()
    expect(screen.queryByText('jobs-content')).toBeNull()
  })

  it('renders M06 网域管理 + M09 独立顶级模块「网域与边缘配置中心」的两个一级子菜单（N2-1）', async () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<MainLayout>deployments-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab：M09 独立为「网域与边缘配置中心」顶级模块
    expect(screen.getByText('网域与边缘配置中心')).toBeInTheDocument()
    expect(screen.getByText('系统与平台管理')).toBeInTheDocument()
    // 「网域与节点管理」为低频折叠子菜单：默认折叠（/deployments 非其激活路由），子项不显示
    expect(screen.getByText('网域与节点管理')).toBeInTheDocument()
    expect(screen.queryByText('网域纳管')).toBeNull()
    expect(screen.queryByText('采集节点状态')).toBeNull()
    // 「配置下发」为激活折叠组（/deployments 配置面路由）时自动展开，子项可见
    expect(screen.getByText('配置下发')).toBeInTheDocument()
    expect(await screen.findByText('配置变更确认')).toBeInTheDocument()
    expect(screen.getByText('下发记录')).toBeInTheDocument()
    expect(screen.getByText('deployments-content')).toBeInTheDocument()
  })

  it('toggles 网域与节点管理 submenu on click（低频接入面可折叠）', async () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<MainLayout>deployments-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // /deployments 不激活「网域与节点管理」，默认折叠，子项不显示
    expect(screen.queryByText('网域纳管')).toBeNull()
    expect(screen.queryByText('采集节点状态')).toBeNull()
    // 点击组标题展开
    fireEvent.click(screen.getByText('网域与节点管理'))
    expect(await screen.findByText('网域纳管')).toBeInTheDocument()
    expect(screen.getByText('采集节点状态')).toBeInTheDocument()
  })

  it('auto-expands 网域与节点管理 when active route is in that group (/domain-onboarding)', async () => {
    render(
      <MemoryRouter initialEntries={['/domain-onboarding']}>
        <Routes>
          <Route
            path="/domain-onboarding"
            element={<MainLayout>onboarding-content</MainLayout>}
          />
        </Routes>
      </MemoryRouter>,
    )
    // 激活路由归属「网域与节点管理」：自动展开，子项可见
    expect(screen.getByText('网域与节点管理')).toBeInTheDocument()
    expect(await screen.findByText('网域纳管')).toBeInTheDocument()
    expect(screen.getByText('采集节点状态')).toBeInTheDocument()
    // 「配置下发」非激活：默认折叠，子项不显示
    expect(screen.queryByText('配置变更确认')).toBeNull()
    expect(screen.queryByText('下发记录')).toBeNull()
    expect(screen.getByText('onboarding-content')).toBeInTheDocument()
  })

  it('collapses 网域与节点管理 on manual toggle even when active route is in that group（激活页可手动折叠）', async () => {
    render(
      <MemoryRouter initialEntries={['/domain-onboarding']}>
        <Routes>
          <Route
            path="/domain-onboarding"
            element={<MainLayout>onboarding-content</MainLayout>}
          />
        </Routes>
      </MemoryRouter>,
    )
    // antd Menu 折叠/展开由 SubMenu 的 ant-menu-submenu-open class 标记（jsdom 下
    // CSSMotion 不生效、DOM 不随折叠移除，故用 className 而非可见性/存在性断言）
    const submenuTitle = screen.getByText('网域与节点管理')
    const submenuLi = submenuTitle.closest('li.ant-menu-submenu') as HTMLElement
    // 首次进入该组自动展开
    await waitFor(() => {
      expect(submenuLi.classList.contains('ant-menu-submenu-open')).toBe(true)
    })
    // 用户手动折叠应立即生效，不再被强制展开
    fireEvent.click(submenuTitle)
    await waitFor(() => {
      expect(submenuLi.classList.contains('ant-menu-submenu-open')).toBe(false)
    })
    // 再次点击展开
    fireEvent.click(submenuTitle)
    await waitFor(() => {
      expect(submenuLi.classList.contains('ant-menu-submenu-open')).toBe(true)
    })
  })

  it('highlights 下发记录 sub-item when route is /deployments (M09)', async () => {
    render(
      <MemoryRouter initialEntries={['/deployments']}>
        <Routes>
          <Route path="/deployments" element={<MainLayout>deployments-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // /deployments 属「配置下发」组：自动展开后子项渲染，且「下发记录」处于选中态
    await waitFor(() => {
      const selected = screen
        .getAllByRole('menuitem')
        .find((el) => (el.textContent || '').includes('下发记录'))
      expect(selected).toBeDefined()
      expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    })
  })

  it('resolves /domain-onboarding、/node-status、/config-preview to 网域与边缘配置中心 module tab', () => {
    render(
      <MemoryRouter initialEntries={['/config-preview']}>
        <Routes>
          <Route path="/config-preview" element={<MainLayout>preview-content</MainLayout>} />
        </Routes>
      </MemoryRouter>,
    )
    // 顶部一级 tab「网域与边缘配置中心」处于 active
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('网域与边缘配置中心'))
    expect(tab?.className ?? '').toContain('active')
    expect(screen.getByText('preview-content')).toBeInTheDocument()
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
})
