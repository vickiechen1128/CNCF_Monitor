import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupAntdTest } from '../../test/antdTestUtils'
import { MainLayout } from '../../layouts/MainLayout'
import { RoutesPage } from './RoutesPage'
import { buildRouteRows } from './useRoutes'
import type { RouteMatcher, RouteNode, RouteTreeData } from '../../types/alertmanager'

// 数据 Hook 单独 mock：隔离真实 API 请求，聚焦页面渲染契约（与 alert 模块既有测试模式一致）
const useRoutesMock = vi.fn()
vi.mock('./useRoutes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useRoutes')>()
  return { ...actual, useRoutes: (...a: unknown[]) => useRoutesMock(...a) }
})

// MainLayout 顶部栏依赖 api/client.getStoredUser（jsdom localStorage 行为不可靠），
// 导航用例走 MainLayout，故用内存 Map 替换 window.localStorage（与 MainLayout.test 一致）。
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

const matcher = (
  name: string,
  value: string,
  is_regex = false,
  is_equal = true,
): RouteMatcher => ({ name, value, is_regex, is_equal })

const node = (over: Partial<RouteNode> & Pick<RouteNode, 'id' | 'parent_id'>): RouteNode => ({
  name: '',
  matchers: [],
  receiver: '',
  group_by: [],
  group_wait: '',
  group_interval: '',
  repeat_interval: '',
  continue: false,
  order: 0,
  locked: false,
  ...over,
})

const rootNode = node({
  id: 'root',
  parent_id: '',
  receiver: 'default',
  group_by: ['alertname'],
  group_wait: '30s',
  group_interval: '5m',
  repeat_interval: '4h',
  locked: true,
})
const childA = node({
  id: 'root/0',
  parent_id: 'root',
  order: 0,
  name: '严重告警 → SRE',
  matchers: [matcher('severity', 'critical')],
  receiver: 'sre-critical',
  continue: true,
})
const grandchild = node({
  id: 'root/0/0',
  parent_id: 'root/0',
  order: 0,
  name: '网域 A 专线',
  matchers: [matcher('network_domain', 'gov-*', true)],
  receiver: 'gov-team',
})
const childB = node({ id: 'root/1', parent_id: 'root', order: 1 })

function result(over: Partial<{
  data: RouteTreeData | null
  rows: ReturnType<typeof buildRouteRows>
  loading: boolean
  error: string | null
  reload: () => void
}> = {}) {
  const data = over.data ?? { mode: 'handwritten', items: [rootNode], dead_receivers: [] }
  return {
    data,
    // 真实 Hook 由 data.items 派生 rows；mock 同构派生，避免测试只喂 data 时空表
    rows: over.rows ?? (data?.items ? buildRouteRows(data.items) : []),
    loading: over.loading ?? false,
    error: over.error ?? null,
    reload: over.reload ?? vi.fn(),
  }
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <RoutesPage />
    </MemoryRouter>,
  )

describe('RoutesPage（路由规则 v0.3-a 只读路由树）', () => {
  setupAntdTest()

  beforeEach(() => {
    window.localStorage.clear()
    useRoutesMock.mockReset()
    useRoutesMock.mockReturnValue(result())
  })

  // 契约①：常驻顶部说明「路由顺序 = 生效顺序：先匹配到的先生效」+ 模式徽标（按 mode 渲染）
  it('常驻顶部说明「路由顺序 = 生效顺序」与手写模式徽标，并给出去「告警配置」的只读引导', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('路由顺序 = 生效顺序：先匹配到的先生效')).toBeInTheDocument()
    expect(screen.getByTestId('route-mode-badge')).toHaveTextContent('手写接管')
    expect(screen.getByText(/本页为只读展示：不提供新建 \/ 编辑 \/ 拖拽入口/)).toBeInTheDocument()
    expect(screen.getByText(/如需编辑路由规则，请先在「告警配置」页开启「路由规则由平台管理」/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '前往告警配置' })).toHaveAttribute('href', '/alert-config')
  })

  it('平台管理模式：模式徽标渲染为「平台管理」', () => {
    useRoutesMock.mockReturnValue(result({ data: { mode: 'platform', items: [rootNode], dead_receivers: [] } }))
    renderPage()
    expect(screen.getByTestId('route-mode-badge')).toHaveTextContent('平台管理')
    // 平台模式下不再展示「先开启平台管理」的手写引导
    expect(screen.queryByText(/如需编辑路由规则，请先在「告警配置」页开启/)).toBeNull()
  })

  // 契约②：树形缩进展示层级（按 parent_id / order 建树）；根路由置顶锁定
  it('树形层级渲染：按 parent_id/order 建树前序展开，根路由置顶并锁定', () => {
    // items 故意乱序传入，验证前端按结构重建（不依赖后端返回顺序）
    const items = [childA, grandchild, rootNode, childB]
    useRoutesMock.mockReturnValue(result({ data: { mode: 'handwritten', items, dead_receivers: [] } }))

    // 单测：建树结果的 id 序与缩进深度
    const built = buildRouteRows(items)
    expect(built.map((r) => r.node.id)).toEqual(['root', 'root/0', 'root/0/0', 'root/1'])
    expect(built.map((r) => r.depth)).toEqual([0, 1, 2, 1])

    renderPage()
    // 列头齐备
    ;['路由名称', '匹配条件', '接收人', '分组键', '发送节奏', '继续匹配'].forEach((h) => {
      expect(screen.getAllByText(h).length).toBeGreaterThan(0)
    })
    // DOM 行顺序 = 根 → 子 → 孙 → 次子（根置顶）
    const rowTexts = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    const idx = (t: string) => rowTexts.findIndex((x) => x.includes(t))
    expect(idx('顶层路由')).toBeGreaterThanOrEqual(0)
    expect(idx('顶层路由')).toBeLessThan(idx('严重告警'))
    expect(idx('严重告警')).toBeLessThan(idx('网域 A 专线'))
    expect(idx('网域 A 专线')).toBeLessThan(idx('（未命名路由）'))
    // 顶层路由锁定：仅顶层节点带锁标记与「顶层」标签
    expect(screen.getAllByTestId('route-root-lock')).toHaveLength(1)
    // 匹配条件按 matcher 语义格式化（=~ 正则）
    expect(screen.getByText('severity="critical"')).toBeInTheDocument()
    expect(screen.getByText('network_domain=~"gov-*"')).toBeInTheDocument()
  })

  // 契约③：dead_receivers 显性标出「平台已生成但没有任何路由指向」，点击跳「通知渠道」页
  it('孤立接收人区：显性标出无路由指向的接收人，点击跳「通知渠道」页', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          mode: 'handwritten',
          items: [rootNode],
          dead_receivers: [{ name: 'alpha', url: 'https://open.feishu.cn/***' }],
        },
      }),
    )
    renderPage()
    expect(screen.getByText(/孤立接收人（平台已生成但没有任何路由指向）/)).toBeInTheDocument()
    expect(screen.getByText(/告警永远不会发往它们/)).toBeInTheDocument()
    const link = screen.getByTestId('dead-receiver-alpha')
    expect(link).toHaveAttribute('href', '/notify-channels')
    expect(screen.getByText(/https:\/\/open\.feishu\.cn/)).toBeInTheDocument()
  })

  it('无孤立接收人时不渲染孤立接收人卡片（避免空卡片占位）', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.queryByText(/孤立接收人（平台已生成但没有任何路由指向）/)).toBeNull()
  })

  // 契约④：解析失败降级为原始 YAML 只读展示 + 提示（不白屏、不报错页）
  it('解析失败：降级为原文只读展示 + 提示，不渲染路由表', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          mode: 'handwritten',
          parse_error: '解析 alertmanager.yml 失败: yaml: line 3: did not find expected key',
          raw_yaml: 'route: [broken\nglobal:  x\n',
        },
      }),
    )
    renderPage()
    expect(screen.getByText('路由配置解析失败，已降级为原文只读展示')).toBeInTheDocument()
    expect(screen.getByText('无法解析当前 alertmanager.yml 的 route 段')).toBeInTheDocument()
    expect(screen.getByText(/did not find expected key/)).toBeInTheDocument()
    expect(screen.getByText(/route: \[broken/)).toBeInTheDocument()
    // 降级态不渲染路由表（无列头、无报错页）
    expect(screen.queryByText('路由名称')).toBeNull()
  })

  // 契约⑤：只读态——无新建 / 编辑 / 拖拽入口
  it('只读态：不提供任何写入口（新建 / 编辑 / 删除按钮）', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.queryByRole('button', { name: /新建/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
    expect(screen.getByText('路由树')).toBeInTheDocument()
  })

  it('空态：无生效配置 / route 为空时展示空态引导', () => {
    useRoutesMock.mockReturnValue(result({ data: { mode: 'handwritten', items: [], dead_receivers: [] } }))
    renderPage()
    expect(screen.getByText('当前无生效配置，或 route 段为空')).toBeInTheDocument()
  })

  it('接口错误：展示错误态与「重新加载」，点击触发 reload', () => {
    const reload = vi.fn()
    useRoutesMock.mockReturnValue(result({ data: null, error: 'boom', reload }))
    renderPage()
    expect(screen.getByText('路由规则加载失败，请稍后重试')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(reload).toHaveBeenCalled()
  })

  // 契约⑥：菜单挂载——/routes 归入告警顶级模块且高亮「路由规则」
  it('导航注册：/routes 归属「告警收敛与通知管理」并高亮「路由规则」子项', () => {
    render(
      <MemoryRouter initialEntries={['/routes']}>
        <Routes>
          <Route
            path="/routes"
            element={
              <MainLayout>
                <span>routes-content</span>
              </MainLayout>
            }
          />
        </Routes>
      </MemoryRouter>,
    )
    const tab = screen
      .getAllByRole('button')
      .find((el) => (el.textContent || '').includes('告警收敛与通知管理'))
    expect(tab?.className ?? '').toContain('active')
    const selected = screen.getAllByRole('menuitem').find((el) => (el.textContent || '').includes('路由规则'))
    expect(selected).toBeDefined()
    expect(selected?.className ?? '').toContain('ant-menu-item-selected')
    expect(screen.getByText('routes-content')).toBeInTheDocument()
  })
})