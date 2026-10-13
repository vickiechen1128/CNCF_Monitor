import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { MainLayout } from '../../layouts/MainLayout'
import { ApiError } from '../../api/client'
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

// 路由设定 Hook mock（T08-SPLIT-01，2026-10-13）：「路由与收敛策略」卡连同两个控件
// （兜底渠道 Select + 路由模式 Segmented）由告警配置页迁入本页常驻「路由设置」卡，
// 故本页开始消费 route-setting / notify-channels，需隔离真实请求。
const useRouteSettingMock = vi.fn()
const saveRouteSettingMock = vi.fn()
const reloadRouteSettingMock = vi.fn()
vi.mock('./useRouteSetting', () => ({
  useRouteSetting: (...a: unknown[]) => useRouteSettingMock(...a),
  NONE_RECEIVER_VALUE: -1,
  ROUTE_SETTING_NONE_LABEL: '不接管（保留配置文件里已有的值）',
}))

/**
 * 路由设定 Hook 返回（T08-SPLIT-01）：默认「未设定 + 有已启用渠道」的自动建议态
 * （`enabled=false` + `effective_source=auto_first_enabled`，契约 §11.9：建议值仅供预填、
 * 平台并未接管、产物字节不变）。选项标签为**纯渠道名**（2026-10-08 已摘除接收人后缀）。
 */
function routeSettingResult(over: Record<string, unknown> = {}) {
  return {
    setting: {
      enabled: false,
      default_receiver_channel_id: null,
      effective_receiver_name: 'auto-default-recv',
      effective_source: 'auto_first_enabled',
      mode: 'handwritten',
    },
    options: [
      { value: -1, label: '不接管（保留配置文件里已有的值）' },
      { value: 1, label: 'SRE 飞书群' },
    ],
    loading: false,
    error: null,
    saving: false,
    reload: reloadRouteSettingMock,
    save: saveRouteSettingMock,
    ...over,
  }
}

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
  ready: boolean
  reload: () => void
}> = {}) {
  const data = over.data ?? { mode: 'handwritten', items: [rootNode], dead_receivers: [] }
  return {
    data,
    // 真实 Hook 由 data.items 派生 rows；mock 同构派生，避免测试只喂 data 时空表
    rows: over.rows ?? (data?.items ? buildRouteRows(data.items) : []),
    loading: over.loading ?? false,
    error: over.error ?? null,
    // 真实 Hook = !loading。默认 true：绝大多数用例关心的是「已加载完成」这一常态，
    // loading 专项用例显式覆盖。页面把它传给 useRouteEditor 作首屏自动导入门控。
    ready: over.ready ?? ((over.loading ?? false) === false),
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
    receiverChannelNames: over.receiverChannelNames ?? {},
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
    // 路由设置（T08-SPLIT-01 迁入本页）：默认未接管 + 建议值
    useRouteSettingMock.mockReset()
    useRouteSettingMock.mockReturnValue(routeSettingResult())
    saveRouteSettingMock.mockReset()
    saveRouteSettingMock.mockResolvedValue(routeSettingResult().setting)
    reloadRouteSettingMock.mockReset()
  })

  // 契约①：常驻状态区「路由顺序 = 生效顺序：先匹配到的先生效」+ 模式徽标（按 mode 渲染）
  // 2026-10-02 四页说明区统一：页头改用 PageIntro（标题 + 一行副标 + 折叠说明区）；
  // 「顺序即优先级 + 模式徽标」随 mode 变化，属状态信息，仍留在页头下方常驻（不进折叠区）。
  //
  // 2026-10-13（T08-SPLIT-01 / A5）：「前往告警配置」反向链接**已删除**——模式开关已迁至
  // 本页常驻「路由设置」卡，为改一个开关跨页跳转是纯粹的绕路。改为就地指引（指向本卡控件 A）。
  it('常驻状态区含「路由顺序 = 生效顺序」与模式徽标；只读时给出去「告警配置」的切换引导', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('路由顺序 = 生效顺序：先匹配到的先生效')).toBeInTheDocument()
    expect(screen.getByTestId('route-mode-badge')).toHaveTextContent('我来编辑')
    // 门禁：handwritten=本页只读（isRouteEditable），常驻区据此明说无编辑入口
    expect(screen.getByText(/本页为只读展示/)).toBeInTheDocument()
    // A5：反向链接已删，改为指向本卡控件 A 的就地指引
    expect(screen.queryByRole('link', { name: '前往告警配置' })).toBeNull()
    expect(screen.getByText(/在上方/)).toBeInTheDocument()
    expect(screen.getByText('「路由设置」')).toBeInTheDocument()
    expect(screen.getByText(/切换为「平台生成」/)).toBeInTheDocument()
  })

  it('PageIntro：页头副标一行定位，机制说明收进默认收起的说明区（与常驻区不重复）', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('routes-intro')).toBeInTheDocument()
    // 2026-10-13（提案 §2.2）：副标改为同时兜住本页两件事——谁产出路由规则 + 没匹配到规则的告警发给谁
    expect(screen.getByTestId('routes-intro-subtitle').textContent ?? '').toContain('谁产出路由规则')
    expect(screen.getByTestId('routes-intro-subtitle').textContent ?? '').toContain('没匹配到规则的告警发给谁')
    // 说明区默认收起：要点不在 DOM
    expect(screen.getByTestId('routes-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('routes-intro-guide-points')).toBeNull()
    // 展开后只含不随状态变化的机制说明——「顺序提示 / 模式引导」已去重，只留在下方常驻区
    // （2026-10-13 去重修复，避免同屏两份、且模式说明方向曾写反）
    fireEvent.click(screen.getByTestId('routes-intro-guide-label'))
    const points = screen.getByTestId('routes-intro-guide-points')
    expect(points.textContent ?? '').toContain('一条规则包含')
    expect(points.textContent ?? '').toContain('顶层路由')
  })

  it('平台生成模式：模式徽标渲染为「平台生成」，常驻区说明本页可直接编辑', () => {
    useRoutesMock.mockReturnValue(result({ data: { mode: 'managed', items: [rootNode], dead_receivers: [] } }))
    // 模式以 useRouteSetting 为准（保存后即刻生效，无需等只读树重新拉取），故同步 mock 为 managed
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: null,
          effective_receiver_name: 'auto-default-recv',
          effective_source: 'auto_first_enabled',
          mode: 'managed',
        },
      }),
    )
    renderPage()
    expect(screen.getByTestId('route-mode-badge')).toHaveTextContent('平台生成')
    // 门禁（isRouteEditable）：managed=本页可写（PRD §11.7「平台管理模式可写」），
    // 常驻区据此给出编辑引导，而非此前写反的「只读视图」提示
    expect(screen.getByText(/本页可直接新建/)).toBeInTheDocument()
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

  // 接收人命名可读性：平台物化的 `notify-1` 显示成「渠道名（notify-1）」，
  // 手写 receiver（如预置 feishu）标注「手写」来源，避免用户看不懂两个名字的关系
  it('接收人列：平台 receiver 显示渠道名，手写 receiver 标注来源', () => {
    const childChannel = node({
      id: 'root/0',
      parent_id: 'root',
      order: 0,
      name: '严重告警',
      receiver: 'notify-1',
    })
    const childFeishu = node({
      id: 'root/1',
      parent_id: 'root',
      order: 1,
      name: '备份通道',
      receiver: 'feishu',
    })
    useRoutesMock.mockReturnValue(
      result({
        data: { mode: 'managed', items: [rootNode, childChannel, childFeishu], dead_receivers: [] },
      }),
    )
    useRouteEditorMock.mockReturnValue(
      editorResult({
        knownReceivers: ['default', 'notify-1', 'feishu'],
        receiverChannelNames: { 'notify-1': '运维告警飞书群' },
      }),
    )
    renderPage()
    // 平台 receiver → 「运维告警飞书群（notify-1）」+ data-testid
    const channelCell = screen.getByTestId('route-receiver-channel')
    expect(channelCell).toHaveTextContent('运维告警飞书群（notify-1）')
    // 手写 receiver → 原样 + 「手写」来源标注（根路由 default 与 feishu 均属文件声明），且不标红「未定义」
    expect(screen.getByText('feishu')).toBeInTheDocument()
    expect(screen.getAllByText('手写').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('route-receiver-undefined')).not.toBeInTheDocument()
  })

  // 契约③：dead_receivers 显性标出「平台已生成但没有任何路由指向」，点击跳「通知渠道」页
  // 2026-10-08 文案修订 + 消解路径补全：旧标题「孤立接收人（平台已生成但没有任何路由指向）」
  // 主语是「平台」，易被读成「平台内置了路由规则却没指向它」；而真实情况是**用户的路由全指向了
  // 别的接收人**（本例中多为手写 `feishu`），平台那条通道空着。同时旧文案只说"去通知渠道页处理"，
  // 而"去渠道页停用渠道"只是两种消解方式之一 —— 用户若想用这个接收人，得新建/编辑一条路由。
  it('有接收人没有路由指向它：说明真实原因并给出两种消解方式', () => {
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
    // 标题与正文讲清「该渠道收不到告警」，而非「平台没指向它」
    expect(screen.getByText(/有接收人没有路由指向它/)).toBeInTheDocument()
    expect(screen.getByText(/所属的渠道收不到告警/)).toBeInTheDocument()
    // 消解方式①：想用它 → 新建/编辑路由时把接收人选成它
    expect(screen.getByText(/新建或编辑一条规则/)).toBeInTheDocument()
    // 消解方式②：暂不用 → 去渠道页停用/删除
    const link = screen.getByTestId('dead-receiver-channels-link')
    expect(link).toHaveAttribute('href', '/notify-channels')
    expect(screen.getByText(/停用或删除对应渠道/)).toBeInTheDocument()
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
    // 路由设置（T08-SPLIT-01 迁入本页）：默认未接管 + 建议值。
    // ⚠ 模式以 `useRouteSetting` 为准（保存后即刻生效，无需等只读树重新拉取），
    // 故本组用例默认 mode='managed'，与上面 useRoutesMock 的 data.mode 保持一致。
    useRouteSettingMock.mockReset()
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: null,
          effective_receiver_name: 'auto-default-recv',
          effective_source: 'auto_first_enabled',
          mode: 'managed',
        },
      }),
    )
    saveRouteSettingMock.mockReset()
    saveRouteSettingMock.mockResolvedValue(routeSettingResult().setting)
    reloadRouteSettingMock.mockReset()
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
    useRouteSettingMock.mockReturnValue(
      routeSettingResult({
        setting: {
          enabled: false,
          default_receiver_channel_id: null,
          effective_receiver_name: 'auto-default-recv',
          effective_source: 'auto_first_enabled',
          mode: 'handwritten',
        },
      }),
    )
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

  // 2026-10-13 问题① 修复接线：导入成功提示不再用卡片外的整条绿色 Alert（会把「保存并提交变更」
  // 挤出首要视线，且 message 与 description 重复「已从当前配置导入」），改为操作区内单行小字，
  // 并明说「当前配置」= 平台当前生效的 alertmanager.yml、下一步点上方保存按钮。
  it('导入成功提示：收进操作区内单行呈现，文案讲清来源与下一步（指路上方保存按钮）', () => {
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'imported',
        importNotice:
          '已载入平台当前生效的 alertmanager.yml 中的 4 个路由（名称由注释还原），请核对下方列表，无误后点上方「保存并提交变更」提交。',
      }),
    )
    renderPage()
    const notice = screen.getByTestId('route-import-notice')
    expect(notice).toHaveTextContent('alertmanager.yml')
    expect(notice).toHaveTextContent('保存并提交变更')
    // 与保存按钮同在操作区那张卡片内，不再单独占一条全宽 Alert
    expect(screen.getByTestId('route-save-btn').closest('.ant-card')).toContainElement(notice)
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

  // 验收 1：保存 = 生成整份配置 → 复用既有挂载端点 → 产 M09 pending 变更单（需人工确认才生效）
  // 2026-10-09（立场 1，关闭自动闭环）：文案口径随之修订——提交**不再**自动生效，
  // 必须由用户在 M09「配置变更确认」人工确认。
  it('保存：点击「保存并提交变更」触发保存链路，并明示需在「配置变更确认」人工确认', async () => {
    const save = vi.fn(async () => true)
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported', save }))
    renderPage()
    expect(screen.getByText(/需在「配置变更确认」中人工确认后才会写入并 reload/)).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('route-save-btn'))
    await waitFor(() => expect(save).toHaveBeenCalled())
  })

  it('保存结果：成功后明示等待人工确认，并给出「配置变更确认」跳转入口', () => {
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'imported',
        saveResult: {
          ok: true,
          message: '已生成整份 alertmanager.yml 并提交挂载。改动不会自动生效——请前往「配置变更确认」人工确认，确认后才会写入并 reload Alertmanager。',
        },
      }),
    )
    renderPage()
    const result = screen.getByTestId('route-save-result')
    expect(result).toHaveTextContent('已提交，等待你在「配置变更确认」中确认下发')
    // 护栏：成功后的唯一下一步是去 M09 确认，必须有可点入口（否则用户无路可走，
    // 会重现「提示要去确认、却找不到入口」的断链）。
    const link = within(result).getByRole('link', { name: '前往「配置变更确认」' })
    expect(link).toHaveAttribute('href', '/config-preview')
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
  //
  // 2026-10-08 语义变更：编辑态改为**首屏自动导入**（只读树加载完成即灌入），故正常路径下
  // 页面加载完就已经是 imported 态、按钮可点；「未导入」只在**解析失败降级**时出现
  // （自动导入对 parse_error 场景刻意不生效，见 useRouteEditor 的 autoImportedRef 注释）。
  it('未导入态（解析失败降级）：新建与保存禁用，导入按钮可用并说明如何进入编辑', () => {
    useRouteEditorMock.mockReturnValue(editorResult())
    renderPage()
    expect(screen.getByTestId('route-new-btn')).toBeDisabled()
    expect(screen.getByTestId('route-save-btn')).toBeDisabled()
    expect(screen.getByTestId('route-import-btn')).toBeEnabled()
    // 按钮文案：未进入编辑态时说「从当前配置导入」，并解释它能干什么
    expect(screen.getByTestId('route-import-btn').textContent ?? '').toContain('从当前配置导入')
  })

  it('已导入态：新建与保存可点，导入按钮改称「重新载入」', () => {
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()
    expect(screen.getByTestId('route-new-btn')).toBeEnabled()
    expect(screen.getByTestId('route-save-btn')).toBeEnabled()
    expect(screen.getByTestId('route-import-btn').textContent ?? '').toContain('重新载入')
  })

  /**
   * 2026-10-08 两个阻断修复的**接线护栏**（页面层）：
   *   - `ready`（只读树加载完成）必须传给 useRouteEditor —— 否则首屏自动导入不触发，
   *     「新建 / 保存」按钮会退回恒灰的老症状；
   *   - `declaredReceivers`（文件 receivers: 段已声明名，含手写）必须传下去 ——
   *     否则 knownReceivers 只有平台物化名，手写 receiver 被判悬空、预检整片阻断。
   * 这两条只靠 useRouteEditor 的 Hook 单测覆盖不到（mock 掉了 Hook），故在页面层断言。
   */
  it('接线：ready 与 declaredReceivers 透传给 useRouteEditor', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          mode: 'handwritten',
          items: [rootNode, childA],
          dead_receivers: [],
          declared_receivers: ['feishu', 'notify-1'],
        },
      }),
    )
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()

    const opts = useRouteEditorMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.ready).toBe(true)
    expect(opts.declaredReceivers).toEqual(['feishu', 'notify-1'])
    // 源数据与解析状态同样透传（自动导入依赖二者）
    expect(opts.sourceItems).toHaveLength(2)
  })

  it('接线：加载中（ready=false）不得触发自动导入', () => {
    useRoutesMock.mockReturnValue(result({ loading: true, ready: false }))
    useRouteEditorMock.mockReturnValue(editorResult())
    renderPage()
    const opts = useRouteEditorMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.ready).toBe(false)
  })

  it('接线：解析失败时把 parseError 传下去（自动导入据此不触发）', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          mode: 'handwritten',
          parse_error: 'route.routes 不是列表，无法解析子路由',
          raw_yaml: 'route:\n  receiver: default\n',
        },
      }),
    )
    useRouteEditorMock.mockReturnValue(editorResult())
    renderPage()
    const opts = useRouteEditorMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.parseError).toContain('不是列表')
  })
})

// =====================================================================
// T08-SPLIT-01（2026-10-13）：「路由与收敛策略」卡由**告警配置页迁入本页**常驻「路由设置」卡。
//
// 迁移动因：兜底控件（顶层路由接收人）与顶层路由行分处两页，用户改一处、另一处会被后端
// `materializeRootRouteReceiver`（**不判 mode**，决策 113 口径 C）静默覆盖。现两控件与顶层路由同屏。
//
// 本组用例由 AlertConfigPage.test.tsx **整体迁入**（覆盖点一一对应，无删减）：
//   · T08-F8 兜底渠道下拉：建议值诚实口径 / 二次确认（护栏①）/ 选「不接管」（护栏③）/
//     保存 400 错误文案 / 结论 Tag 只说状态不复述渠道名 / 未接管不得写「发往」
//   · T08-F12 模式 Segmented：二选一 + 二次确认透传 mode / **决策二+三**切手写自动置「不接管」
//     且合并为同一次 PUT / **决策四**切回「平台生成」不自动接管 / 后果说明随 mode 切换 /
//     二次确认明说页面可编辑性 / §6.3 手写模式下平台仍接管兜底
//   · 决策五原句常驻落位、顶层路由行内兜底结论 Tag
// =====================================================================
describe('RoutesPage 路由设置卡（T08-SPLIT-01 迁入）', () => {
  setupAntdTest()

  const openFallbackSelect = () =>
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '没匹配到具体规则的告警，发给哪个渠道' }))
  const pickFallbackOption = async (text: string | RegExp) => {
    const opts = await screen.findAllByText(text)
    // 下拉项挂在 body 末尾的 portal 中；已选中值也在选择器内展示，故取最后一个（下拉项）
    fireEvent.click(opts[opts.length - 1])
  }
  const modeSegment = (label: '我来编辑' | '平台生成') => screen.getByRole('radio', { name: label })
  const clickModeSegment = (label: '我来编辑' | '平台生成') => fireEvent.click(modeSegment(label))

  /** 构造 route-setting 返回值（setting 局部覆盖） */
  const settingOf = (over: Record<string, unknown>) =>
    routeSettingResult({
      setting: {
        enabled: false,
        default_receiver_channel_id: null,
        effective_receiver_name: 'auto-default-recv',
        effective_source: 'auto_first_enabled',
        mode: 'handwritten',
        ...over,
      },
    })

  beforeEach(() => {
    window.localStorage.clear()
    useRoutesMock.mockReset()
    useRoutesMock.mockReturnValue(result({ data: { mode: 'handwritten', items: [rootNode], dead_receivers: [] } }))
    useRouteEditorMock.mockReset()
    useRouteEditorMock.mockReturnValue(editorResult())
    useRouteSettingMock.mockReset()
    useRouteSettingMock.mockReturnValue(routeSettingResult())
    saveRouteSettingMock.mockReset()
    saveRouteSettingMock.mockResolvedValue(routeSettingResult().setting)
    reloadRouteSettingMock.mockReset()
  })

  // 迁入后的基本形态：一张**常驻**「路由设置」卡，两个控件同屏（不再藏在告警配置页）
  it('迁入形态：常驻「路由设置」卡同时承载兜底渠道下拉与模式 Segmented', () => {
    renderPage()
    const card = screen.getByTestId('route-setting-card')
    expect(card).toBeInTheDocument()
    expect(screen.getByText('路由设置')).toBeInTheDocument()
    expect(card).toContainElement(screen.getByRole('combobox', { name: '没匹配到具体规则的告警，发给哪个渠道' }))
    expect(card).toContainElement(screen.getByLabelText('路由规则由谁维护'))
    // 两个控件均为常驻，无需任何展开动作
    expect(card.querySelector('.ant-segmented')).not.toBeNull()
  })

  // 决策五（原句落位，不得改写）：手写整份文件 ≠ 交出兜底。后端 materializeRootRouteReceiver
  // 不判 mode，手写模式下平台仍会替换顶层路由接收人——不明写会被理解成「交出全部控制权」。
  it('决策五：兜底控件旁常驻「手写整份文件 ≠ 交出兜底」原句', () => {
    renderPage()
    const tip = screen.getByTestId('route-setting-independence-tip')
    expect(tip.textContent ?? '').toContain('即使你选择自己手写整份配置')
    expect(tip.textContent ?? '').toContain('想完全自己控制，请选『不接管』')
  })

  // 顶层路由行内明写「接收人由上方路由设置决定」，避免用户盯着这一行反复找接收人下拉
  it('顶层路由行内展示兜底结论 Tag（仅平台生成模式，本页可编辑时才需要提示改入口在哪）', () => {
    // handwritten：整页只读，用户改不了，无提示必要
    renderPage()
    expect(screen.queryByTestId('route-root-fallback-tag')).toBeNull()

    // managed：行内出现指向「路由设置」的 Tag
    useRoutesMock.mockReturnValue(result({ data: { mode: 'managed', items: [rootNode], dead_receivers: [] } }))
    useRouteSettingMock.mockReturnValue(settingOf({ mode: 'managed' }))
    renderPage()
    expect(screen.getByTestId('route-root-fallback-tag')).toHaveTextContent('兜底接收人由上方「路由设置」决定')
  })

  // T08-F8-①：未设定（auto_first_enabled）时**平台不接管**，effective_receiver_name 仅为建议值。
  // 旧实现渲染成「发往 X」，与下拉框显示的「不接管」自相矛盾，用户实测判为界面不可信。
  it('T08-F8：未设定时展示自动建议来源，下拉首项为「不接管」，结论不得写「发往」', () => {
    renderPage()
    // 下拉首项 = 「不接管」且为当前选中值（NONE_RECEIVER_VALUE = -1）
    expect(screen.getByText('不接管（保留配置文件里已有的值）')).toBeInTheDocument()
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('未接管')
    expect(conclusion).toContain('建议值')
    expect(conclusion).not.toContain('发往')
    // 不展示平台内部 receiver 名（对"我选了哪个渠道"无帮助）
    expect(conclusion).not.toContain('auto-default-recv')
    expect(conclusion).toContain('已启用渠道')
  })

  // T08-F8-②：护栏①——选定渠道 = 授权平台接管，必须先经二次确认，且文案不得暴露实现字段名
  it('T08-F8：选定渠道触发二次确认（护栏①），文案不含实现字段名，确认后写入该渠道', async () => {
    const modal = mockAntdModal()
    renderPage()
    openFallbackSelect()
    await pickFallbackOption('SRE 飞书群')
    expect(modal.confirm).toHaveBeenCalled()
    const cfg = modal.confirm.mock.calls[0][0]
    expect(String(cfg.title)).toContain('确认由平台接管这类告警')
    // 术语去技术化护栏：确认弹窗不得暴露 route 段字段名
    expect(String(cfg.content)).not.toContain('route.receiver')
    expect(String(cfg.content)).not.toContain('route.routes[]')
    // 仍需明示「只替换一个值」这一关键语义（决策 113 口径 C）
    expect(String(cfg.content)).toContain('不受影响')
    expect(String(cfg.content)).toContain('不触碰 group_by')
    // 未确认前不写入
    expect(saveRouteSettingMock).not.toHaveBeenCalled()
    await (cfg.onOk as () => Promise<void>)()
    expect(saveRouteSettingMock).toHaveBeenCalledWith(1)
  })

  // T08-F8-③：护栏③——选「不接管」= 停止替换、不删最后写入的值；无阻断交互，保存后明示结果
  it('T08-F8：选「不接管」以 null 关闭接管，并提示已停止替换、最后写入值保留（护栏③）', async () => {
    useRouteSettingMock.mockReturnValue(
      settingOf({ enabled: true, default_receiver_channel_id: 1, effective_receiver_name: 'sre-feishu-qun', effective_source: 'explicit' }),
    )
    renderPage()
    openFallbackSelect()
    await pickFallbackOption('不接管（保留配置文件里已有的值）')
    await waitFor(() => expect(saveRouteSettingMock).toHaveBeenCalledWith(null))
    expect(await screen.findByText(/已停止由平台指定这条兜底接收人/)).toBeInTheDocument()
    expect(await screen.findByText(/最后写入的值保留在配置文件中/)).toBeInTheDocument()
  })

  it('T08-F8：保存返回 400（渠道不存在 / 未启用）时提示后端错误文案', async () => {
    saveRouteSettingMock.mockRejectedValue(new ApiError('指定的通知渠道不存在或未启用', 400, 'bad_request'))
    const modal = mockAntdModal()
    renderPage()
    openFallbackSelect()
    await pickFallbackOption('SRE 飞书群')
    await (modal.confirm.mock.calls[0][0].onOk as () => Promise<void>)()
    expect(await screen.findByText('指定的通知渠道不存在或未启用')).toBeInTheDocument()
  })

  // T08-F8-④：已接管（explicit + enabled）时结论才可说「发往」；且**不复述渠道名 / 接收人名**
  // —— 结论 Tag 与下拉框是并列的两个独立元素，复述渠道名会让用户做一道连线题（2026-10-08 用户实测）。
  it('T08-F8：已接管时展示「已接管」结论，且不复述渠道名（消除左右对应关系歧义）', () => {
    useRouteSettingMock.mockReturnValue(
      settingOf({ enabled: true, default_receiver_channel_id: 1, effective_receiver_name: 'notify-1', effective_source: 'explicit' }),
    )
    renderPage()
    const conclusion = screen.getByTestId('fallback-conclusion').textContent ?? ''
    expect(conclusion).toContain('已接管')
    expect(conclusion).toContain('发往')
    // 用「你选中的渠道」回指控件，明确左右是同一个
    expect(conclusion).toContain('你选中的渠道')
    // 不得复述平台内部接收人标识
    expect(conclusion).not.toContain('notify-1')
  })

  // §6.3 的非直觉事实必须有回归护栏：「我来编辑」模式下平台**仍**接管根兜底接收人单键。
  // 若未来有人给 MaterializeRootRouteReceiver 补上 mode 门禁，本用例会失败并提示同步更新口径。
  it('§6.3：「我来编辑」模式下平台仍接管兜底接收人，关系结论不得谎报「平台不接管」', () => {
    useRouteSettingMock.mockReturnValue(
      settingOf({ enabled: true, default_receiver_channel_id: 1, effective_receiver_name: 'sre-feishu-qun', effective_source: 'explicit' }),
    )
    renderPage()
    const summary = screen.getByTestId('route-setting-summary').textContent ?? ''
    expect(summary).toContain('路由规则由你来编辑')
    expect(summary).toContain('未匹配任何规则的告警发往 sre-feishu-qun')
    expect(summary).toContain('平台已接管')
  })

  // T08-F12-①：Segmented 二选一切换即二次确认，确认后透传 mode=managed
  it('T08-F12：「路由规则由谁维护」以 Segmented 二选一呈现，我来编辑→平台生成 触发二次确认并透传 mode=managed', async () => {
    const modal = mockAntdModal()
    renderPage()
    // 二选一语义：两个 radio 而非一个开关
    expect(screen.getByLabelText('路由规则由谁维护')).toBeInTheDocument()
    expect(modeSegment('我来编辑')).toBeChecked()
    expect(modeSegment('平台生成')).not.toBeChecked()
    // 初始态关系结论点明「由你来编辑」
    expect(screen.getByTestId('route-setting-summary').textContent ?? '').toContain('路由规则由你来编辑')
    // 切到「平台生成」→ 二次确认
    clickModeSegment('平台生成')
    expect(modal.confirm).toHaveBeenCalled()
    const cfg = modal.confirm.mock.calls[0][0]
    expect(String(cfg.title)).toContain('切换为「平台生成」')
    // 术语去技术化护栏：确认弹窗不得暴露「route 段」这类实现术语
    expect(String(cfg.title)).not.toContain('route 段')
    expect(String(cfg.content)).not.toContain('route 段')
    // 未确认前不写入
    expect(saveRouteSettingMock).not.toHaveBeenCalled()
    await (cfg.onOk as () => Promise<void>)()
    // 当前未选定兜底渠道 → channelId=null，连同 mode='managed' 一并写入
    expect(saveRouteSettingMock).toHaveBeenCalledWith(null, 'managed')
  })

  /**
   * 决策二 + 决策三（2026-10-13）：切到「我来编辑」时兜底**自动置「不接管」**。
   *
   * - 决策二为何选「不接管」而非「禁用渠道」：渠道一旦停用，根路由里已写入的
   *   `receiver: notify-N` 会变成悬空引用，`amtool check-config` 失败 / AM 拒绝加载。
   * - 决策三为何合并提交：拆成两次 `PUT route-setting` 会产生**用户未主动发起**的独立变更单，
   *   违反决策 42-1（抑制空变更单 / 每条变更项须自解释）。
   */
  it('决策二+三：平台生成→我来编辑 自动把兜底置「不接管」，并与 mode 合并进**同一次**保存', async () => {
    useRouteSettingMock.mockReturnValue(
      settingOf({ enabled: true, default_receiver_channel_id: 3, effective_receiver_name: 'sre-qun', effective_source: 'explicit', mode: 'managed' }),
    )
    const modal = mockAntdModal()
    renderPage()
    expect(modeSegment('平台生成')).toBeChecked()
    clickModeSegment('我来编辑')
    const cfg = modal.confirm.mock.calls[0][0]
    expect(String(cfg.title)).toContain('切换为「我来编辑」')
    // 护栏§11.6：切到「我来编辑」明示「不删除已生成的路由内容」
    expect(String(cfg.content)).toContain('已生成')
    // 决策二：弹窗须明说兜底将由「当前渠道」变为「不接管」（含当前渠道名，便于用户核对）
    expect(String(cfg.content)).toContain('平台将不再接管顶层路由的兜底接收人')
    expect(String(cfg.content)).toContain('不接管')
    await (cfg.onOk as () => Promise<void>)()
    // 决策三：**一次**调用同时携带 null（不接管）与 mode（handwritten），不发第二个请求
    expect(saveRouteSettingMock).toHaveBeenCalledTimes(1)
    expect(saveRouteSettingMock).toHaveBeenCalledWith(null, 'handwritten')
  })

  // 决策四：切回「平台生成」**不自动接管**——兜底保持「不接管」等用户显式选择，
  // 否则用户会莫名其妙多出一个变更项（他只点了模式开关）。
  it('决策四：切回「平台生成」不自动接管兜底（保持当前「不接管」值）', async () => {
    useRouteSettingMock.mockReturnValue(settingOf({ mode: 'handwritten' }))
    const modal = mockAntdModal()
    renderPage()
    clickModeSegment('平台生成')
    const cfg = modal.confirm.mock.calls[0][0]
    // 切回走「平台产出」分支：文案只讲路由由谁产出 + 手写内容会被覆盖
    expect(String(cfg.content)).toContain('路由规则由平台产出')
    expect(String(cfg.content)).toContain('会被平台生成内容覆盖')
    // 决策四：当前未接管 → 弹窗不得出现「将不再接管」这类释放话术
    expect(String(cfg.content)).not.toContain('平台将不再接管顶层路由的兜底接收人')
    await (cfg.onOk as () => Promise<void>)()
    expect(saveRouteSettingMock).toHaveBeenCalledTimes(1)
    // 核心判据：兜底仍传 null（不接管），**没有**被自动接管
    expect(saveRouteSettingMock).toHaveBeenCalledWith(null, 'managed')
    expect(await screen.findByText(/已切换为「平台生成」：可在路由规则页直接编辑/)).toBeInTheDocument()
  })

  // 已在接管某渠道时切回「平台生成」：**保留**当前渠道 ID（不释放），仅改 mode
  it('决策四（续）：切回「平台生成」时保留已接管的兜底渠道，不释放', async () => {
    useRouteSettingMock.mockReturnValue(
      settingOf({ enabled: true, default_receiver_channel_id: 1, effective_receiver_name: 'sre-feishu-qun', effective_source: 'explicit', mode: 'handwritten' }),
    )
    const modal = mockAntdModal()
    renderPage()
    clickModeSegment('平台生成')
    await (modal.confirm.mock.calls[0][0].onOk as () => Promise<void>)()
    expect(saveRouteSettingMock).toHaveBeenCalledWith(1, 'managed')
  })

  // 2026-10-08：Segmented 只有两个短词，承载不了「选了之后路由规则页会怎样」——
  // 而这正是实测中被误解的点（选「我来编辑」→ 页面变只读 → 判为故障）。
  // 故控件下方必须常驻一行后果说明，且**随 mode 切换**（方向以门禁 isRouteEditable 为准）。
  it('模式控件下方常驻一行后果说明，且随 mode 切换措辞（handwritten=只读 / managed=可编辑）', () => {
    const { unmount } = renderPage()
    expect(screen.getByTestId('route-setting-mode-tip').textContent ?? '').toContain('只读视图')
    unmount()

    useRouteSettingMock.mockReturnValue(settingOf({ mode: 'managed' }))
    renderPage()
    expect(screen.getByTestId('route-setting-mode-tip').textContent ?? '').toContain('直接增删改路由')
  })

  // 二次确认弹窗必须**明说页面可编辑性**，而不只讲产物归属——旧文案只说"平台停止生成 /
  // 平台接管"，用户无法据此判断路由页还能不能编辑。
  it('模式切换二次确认明说页面可编辑性后果', () => {
    const modal = mockAntdModal()
    const { unmount } = renderPage()

    // 切到「平台生成」→ 弹窗须说「可直接编辑」
    clickModeSegment('平台生成')
    const cfgManaged = modal.confirm.mock.calls[0][0]
    expect(String(cfgManaged.content)).toContain('直接增删改')
    unmount()

    // 切到「我来编辑」→ 弹窗须说页面只读 + 保留已生成内容
    useRouteSettingMock.mockReturnValue(settingOf({ mode: 'managed' }))
    renderPage()
    clickModeSegment('我来编辑')
    const cfgHandwritten = modal.confirm.mock.calls[1][0]
    expect(String(cfgHandwritten.content)).toContain('路由规则页')
    expect(String(cfgHandwritten.content)).toContain('只读')
    expect(String(cfgHandwritten.content)).toContain('已生成')
  })

  // 「不即时生效 / 需经变更单确认」口径不因迁移而丢失
  it('口径保持：路由改动仍需经「配置变更确认」，不即时生效', () => {
    useRoutesMock.mockReturnValue(result({ data: { mode: 'managed', items: [rootNode], dead_receivers: [] } }))
    useRouteSettingMock.mockReturnValue(settingOf({ mode: 'managed' }))
    renderPage()
    expect(screen.getByText(/不即时生效/)).toBeInTheDocument()
  })

  it('route-setting 加载失败：卡内展示错误与「重试」，点击触发 reload', () => {
    useRouteSettingMock.mockReturnValue(routeSettingResult({ error: 'boom' }))
    renderPage()
    expect(screen.getByText(/设定加载失败：boom/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(reloadRouteSettingMock).toHaveBeenCalled()
  })
})