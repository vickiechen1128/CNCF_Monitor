import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { MainLayout } from '../../layouts/MainLayout'
import { RoutesPage } from './RoutesPage'
import { buildEditRows, buildRouteRows, type UseRouteEditorResult } from './useRoutes'
import { blankRouteNode, type RouteEditNode } from './routeTree'
import type { RouteMatcher, RouteNode, RouteTreeData } from '../../types/alertmanager'

// 数据 Hook 单独 mock：隔离真实 API 请求，聚焦页面渲染契约（与 alert 模块既有测试模式一致）
const useRoutesMock = vi.fn()
const useRouteEditorMock = vi.fn()
vi.mock('./useRoutes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useRoutes')>()
  return {
    ...actual,
    useRoutes: (...a: unknown[]) => useRoutesMock(...a),
    useRouteEditor: (...a: unknown[]) => useRouteEditorMock(...a),
  }
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

/** 编辑态节点工厂（编辑树用例用） */
function editNode(over: Partial<RouteEditNode> & Pick<RouteEditNode, 'id' | 'parent_id'>): RouteEditNode {
  return { ...blankRouteNode(over.id, over.parent_id), ...over }
}

/** 编辑态 Hook 返回（T08-F11）：默认「未导入」空态 */
function editorResult(over: Partial<UseRouteEditorResult> = {}): UseRouteEditorResult {
  const tree = over.tree ?? []
  return {
    tree,
    rows: over.rows ?? buildEditRows(tree),
    importState: over.importState ?? 'empty',
    importNotice: over.importNotice ?? null,
    rawYAML: over.rawYAML ?? '',
    issues: over.issues ?? [],
    blocking: over.blocking ?? [],
    warnings: over.warnings ?? [],
    knownReceivers: over.knownReceivers ?? [],
    saving: over.saving ?? false,
    saveResult: over.saveResult ?? null,
    importFromCurrent: over.importFromCurrent ?? vi.fn(),
    move: over.move ?? vi.fn(),
    reorder: over.reorder ?? vi.fn(),
    remove: over.remove ?? vi.fn(),
    upsert: over.upsert ?? vi.fn(),
    reset: over.reset ?? vi.fn(),
    save: over.save ?? vi.fn(async () => true),
  }
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <App>
        <RoutesPage />
      </App>
    </MemoryRouter>,
  )

describe('RoutesPage（路由规则 v0.3-a 只读路由树）', () => {
  setupAntdTest()

  beforeEach(() => {
    window.localStorage.clear()
    useRoutesMock.mockReset()
    useRoutesMock.mockReturnValue(result())
    useRouteEditorMock.mockReset()
    useRouteEditorMock.mockReturnValue(editorResult())
  })

  // 契约①：常驻状态区「路由顺序 = 生效顺序：先匹配到的先生效」+ 模式徽标（按 mode 渲染）
  // 2026-10-02 四页说明区统一：页头改用 PageIntro（标题 + 一行副标 + 折叠说明区）；
  // 「顺序即优先级 + 模式徽标」随 mode 变化，属状态信息，仍留在页头下方常驻（不进折叠区）。
  it('常驻状态区含「路由顺序 = 生效顺序」与手写模式徽标，并给出去「告警配置」的只读引导', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('路由顺序 = 生效顺序：先匹配到的先生效')).toBeInTheDocument()
    expect(screen.getByTestId('route-mode-badge')).toHaveTextContent('手写接管')
    expect(screen.getByText(/本页为只读展示：不提供新建 \/ 编辑 \/ 拖拽入口/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '前往告警配置' })).toHaveAttribute('href', '/alert-config')
  })

  it('PageIntro：页头副标一行定位，机制说明收进默认收起的说明区', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('routes-intro')).toBeInTheDocument()
    expect(screen.getByTestId('routes-intro-subtitle').textContent ?? '').toContain('哪条告警发给谁')
    // 说明区默认收起：要点不在 DOM
    expect(screen.getByTestId('routes-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('routes-intro-guide-points')).toBeNull()
    // 展开后含「当前由你手写维护 → 本页只读」的模式说明
    fireEvent.click(screen.getByTestId('routes-intro-guide-label'))
    const points = screen.getByTestId('routes-intro-guide-points')
    expect(points.textContent ?? '').toContain('当前由你手写维护')
  })

  it('平台管理模式：模式徽标渲染为「平台管理」', () => {
    useRoutesMock.mockReturnValue(result({ data: { mode: 'managed', items: [rootNode], dead_receivers: [] } }))
    renderPage()
    expect(screen.getByTestId('route-mode-badge')).toHaveTextContent('平台管理')
    // 平台模式下说明区给出「可新建 / 编辑 / 拖拽」而非手写只读引导
    fireEvent.click(screen.getByTestId('routes-intro-guide-label'))
    const points = screen.getByTestId('routes-intro-guide-points')
    expect(points.textContent ?? '').toContain('当前由平台管理')
    expect(points.textContent ?? '').not.toContain('当前由你手写维护')
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

  // 验收 F13-1：路由引用了未定义的接收人（不在已知接收人集合）→ 红色「未定义」显式告警
  it('H2：列表对未定义接收人渲染红色「未定义」', () => {
    const childGhost = node({
      id: 'root/0',
      parent_id: 'root',
      order: 0,
      name: '严重告警',
      receiver: 'ghost-receiver',
    })
    useRoutesMock.mockReturnValue(result({ data: { mode: 'handwritten', items: [rootNode, childGhost], dead_receivers: [] } }))
    // knownReceivers 含 default（根路由接收人），但不含 ghost-receiver
    useRouteEditorMock.mockReturnValue(editorResult({ knownReceivers: ['default'] }))
    renderPage()
    const badge = screen.getByTestId('route-receiver-undefined')
    expect(badge).toHaveTextContent('未定义')
    expect(badge).toHaveClass('ant-typography-danger')
    // 已知接收人（default）正常渲染、不标红
    expect(screen.getAllByText('default').length).toBeGreaterThan(0)
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

/** 编辑态树：根 + 两条子路由（其中一条带子路由，供删除确认与排序用例） */
const editRoot = editNode({ id: 'root', parent_id: '', receiver: 'default', group_by: ['alertname'] })
const editChildA = editNode({
  id: 'root/0',
  parent_id: 'root',
  name: '严重告警 → SRE',
  receiver: 'sre-critical',
  matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
  continue: true,
})
const editGrandchild = editNode({ id: 'root/0/0', parent_id: 'root/0', name: '网域 A 专线', receiver: 'gov-team' })
const editChildB = editNode({ id: 'root/1', parent_id: 'root', name: '其他告警', receiver: 'default' })
const editTree = [editRoot, editChildA, editGrandchild, editChildB]

describe('RoutesPage v0.3-b 编辑态（T08-F11）', () => {
  setupAntdTest()

  beforeEach(() => {
    window.localStorage.clear()
    useRoutesMock.mockReset()
    useRoutesMock.mockReturnValue(
      result({ data: { mode: 'managed', items: [rootNode], dead_receivers: [] } }),
    )
    useRouteEditorMock.mockReset()
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
  })

  // 验收 2：平台管理模式提供「新建 / 从当前配置导入 / 保存并提交变更」，点击导入触发 Hook
  it('平台管理模式：提供「新建路由规则」「从当前配置导入」「保存并提交变更」入口，点击导入触发导入', () => {
    const importFromCurrent = vi.fn()
    useRouteEditorMock.mockReturnValue(editorResult({ importFromCurrent }))
    renderPage()
    expect(screen.getByTestId('route-import-btn')).toBeInTheDocument()
    expect(screen.getByTestId('route-save-btn')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('route-import-btn'))
    expect(importFromCurrent).toHaveBeenCalled()
  })

  // 验收 6：手写模式下本页整体只读——无导入 / 保存 / 新建入口
  it('手写模式：本页整体只读，不提供导入 / 保存 / 新建入口', () => {
    useRoutesMock.mockReturnValue(result({ data: { mode: 'handwritten', items: [rootNode], dead_receivers: [] } }))
    renderPage()
    expect(screen.queryByTestId('route-import-btn')).toBeNull()
    expect(screen.queryByTestId('route-save-btn')).toBeNull()
    expect(screen.queryByTestId('route-new-btn')).toBeNull()
    expect(screen.queryByRole('button', { name: /上移/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除/ })).toBeNull()
  })

  // 验收 2：解析失败 → 部分导入提示 + 仍渲染编辑树供手动校正
  it('不可无损导入：解析失败时给出「部分导入」提示并保留手动校正通道（编辑树仍可渲染）', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          mode: 'managed',
          parse_error: '解析 alertmanager.yml 失败: 平台未建模键 match',
          raw_yaml: 'route:\n  match:\n    severity: critical\n',
        },
      }),
    )
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'partial',
        importNotice: '当前 route 段无法被平台完整解析，已按空白根路由导入（可在下方手动校正补齐）：解析失败',
      }),
    )
    renderPage()
    expect(screen.getByTestId('route-import-notice')).toHaveTextContent('部分导入：不可无损导入，请手动校正')
    expect(screen.getByText(/无法被平台完整解析/)).toBeInTheDocument()
    // 手动校正通道：编辑树仍在，且带删除 / 排序入口
    expect(screen.getByText('严重告警 → SRE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑 root/0' })).toBeInTheDocument()
  })

  // 验收 3：顺序用上移 / 下移表达（根路由锁定不可移动）
  it('顺序调整：上移 / 下移按钮触发 Hook；顶层路由锁定不提供移动入口', () => {
    const move = vi.fn()
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported', move }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '上移 root/1' }))
    expect(move).toHaveBeenCalledWith('root/1', -1)
    // 顶层路由：排序列显示「锁定」，无上移 / 下移按钮
    expect(screen.getAllByText('锁定').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: '上移 root' })).toBeNull()
  })

  // 验收 3（增强）：拖拽行调整同级顺序（原生 HTML5 draggable，零新增依赖）
  it('顺序调整（增强）：拖拽行落点触发重排', () => {
    const reorder = vi.fn()
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported', reorder }))
    renderPage()
    const rowOf = (text: string) =>
      screen.getAllByRole('row').find((r) => (r.textContent ?? '').includes(text))
    fireEvent.dragStart(rowOf('其他告警')!)
    fireEvent.drop(rowOf('严重告警 → SRE')!)
    expect(reorder).toHaveBeenCalledWith('root/1', 'root/0')
  })

  // 验收 4：删除带子路由的节点二次确认，明示「将同时删除 N 条子路由」
  it('删除带子路由：二次确认明示「将同时删除 1 条子路由」，确认后执行删除', async () => {
    const modal = mockAntdModal()
    const remove = vi.fn()
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported', remove }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '删除 root/0' }))
    await waitFor(() => expect(modal.confirm).toHaveBeenCalled())
    const options = modal.confirm.mock.calls[0][0]
    expect(String(options.content)).toContain('将同时删除 1 条子路由')
    expect(String(options.okText)).toContain('同时删除 1 条子路由')
    await options.onOk?.()
    expect(remove).toHaveBeenCalledWith('root/0')
  })

  it('删除无子路由节点：二次确认不出现子路由条数话术', async () => {
    const modal = mockAntdModal()
    const remove = vi.fn()
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported', remove }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '删除 root/1' }))
    await waitFor(() => expect(modal.confirm).toHaveBeenCalled())
    const options = modal.confirm.mock.calls[0][0]
    expect(String(options.content)).not.toContain('将同时删除')
    await options.onOk?.()
    expect(remove).toHaveBeenCalledWith('root/1')
  })

  // 验收 1：保存 = 生成整份配置 → 复用既有挂载端点 → M09 变更单（不即时生效）
  it('保存：点击「保存并提交变更」触发保存链路，并明示不即时生效', async () => {
    const save = vi.fn(async () => true)
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported', save }))
    renderPage()
    expect(screen.getByText(/进入变更单人工确认后下发生效，不即时生效/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('route-save-btn'))
    await waitFor(() => expect(save).toHaveBeenCalled())
  })

  it('保存结果：成功后展示「已提交，待变更单确认下发」', () => {
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'imported',
        saveResult: {
          ok: true,
          message: '已生成整份 alertmanager.yml 并提交挂载，进入变更单人工确认后下发生效（不即时生效）。',
        },
      }),
    )
    renderPage()
    expect(screen.getByTestId('route-save-result')).toHaveTextContent('已提交，待变更单确认下发')
  })

  // 验收 5：接收人悬空 → 红字阻断
  it('保存前预检：接收人悬空 → 红字阻断并说明原因', () => {
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'imported',
        issues: [
          {
            level: 'error',
            code: 'receiver_dangling',
            node_id: 'root/0',
            field: 'receiver',
            message: '接收人「sre-critical」未定义（对应通知渠道未启用或已删除），告警将无处可发',
          },
        ],
        blocking: [
          {
            level: 'error',
            code: 'receiver_dangling',
            node_id: 'root/0',
            field: 'receiver',
            message: '接收人「sre-critical」未定义（对应通知渠道未启用或已删除），告警将无处可发',
          },
        ],
      }),
    )
    renderPage()
    expect(screen.getByTestId('route-precheck-blocking')).toHaveTextContent('保存前预检未通过（1 项，必须修正后才能保存）')
    expect(screen.getByText(/接收人「sre-critical」未定义/)).toBeInTheDocument()
  })

  // 验收 5：时长不整除 → 警告不阻断
  it('保存前预检：时长不整除 → 警告级提示，不阻断保存', () => {
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'imported',
        warnings: [
          {
            level: 'warning',
            code: 'repeat_interval_not_multiple_of_group_interval',
            node_id: 'root/0',
            field: 'repeat_interval',
            message: '重复间隔 7m 不是分组间隔 5m 的整数倍，Alertmanager 会向上取整（可保存）',
          },
        ],
      }),
    )
    renderPage()
    expect(screen.getByTestId('route-precheck-warning')).toHaveTextContent('可以保存，但有 1 项建议确认')
    expect(screen.getByText(/Alertmanager 会向上取整/)).toBeInTheDocument()
    expect(screen.queryByTestId('route-precheck-blocking')).toBeNull()
    expect(screen.getByTestId('route-save-btn')).toBeEnabled()
  })

  // 编辑抽屉：点「编辑」打开三段式抽屉（标题 = 编辑路由规则）
  it('编辑入口：点击行内「编辑」打开三段式抽屉', async () => {
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '编辑 root/0' }))
    expect(await screen.findByText('编辑路由规则')).toBeInTheDocument()
    expect(screen.getByText('① 这条规则管什么')).toBeInTheDocument()
  })

  // 未导入时：新建 / 保存禁用（先导入或新建才有可保存的树）
  it('未导入时：新建与保存禁用，仅「从当前配置导入」可用', () => {
    useRouteEditorMock.mockReturnValue(editorResult())
    renderPage()
    expect(screen.getByTestId('route-new-btn')).toBeDisabled()
    expect(screen.getByTestId('route-save-btn')).toBeDisabled()
    expect(screen.getByTestId('route-import-btn')).toBeEnabled()
  })
})