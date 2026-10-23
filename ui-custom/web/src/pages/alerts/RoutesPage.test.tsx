import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { App } from 'antd'
import { setupAntdTest, mockAntdModal } from '../../test/antdTestUtils'
import { MainLayout } from '../../layouts/MainLayout'
import { RoutesPage } from './RoutesPage'
import { buildEditRows, buildRouteRows, type UseRouteEditorResult } from './useRoutes'
import { blankRouteNode, emptyRouteTree, type RouteEditNode } from './routeTree'
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
  ready: boolean
  reload: () => void
}> = {}) {
  const data = over.data ?? { items: [rootNode] }
  return {
    data,
    // 真实 Hook 由 data.items 派生 rows；mock 同构派生，避免测试只喂 data 时空表
    rows: over.rows ?? (data?.items ? buildRouteRows(data.items) : []),
    loading: over.loading ?? false,
    error: over.error ?? null,
    // 真实 Hook = !loading。默认 true：绝大多数用例关心的是「已加载完成」这一常态，
    // loading 专项用例显式覆盖。页面把它传给 useRouteEditor 作首屏自动导入门控。
    ready: over.ready ?? ((over.loading ?? false) === false),
    effectiveChecksum: data?.effective_checksum ?? '',
    pending: data?.pending ?? null,
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
    dirty: over.dirty ?? false,
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
  })

  // 契约①：「路由顺序 = 生效顺序：先匹配到的先生效」常驻路由树卡标题行。
  it('顺序提示随路由树卡标题常驻', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByText('路由顺序 = 生效顺序：先匹配到的先生效')).toBeInTheDocument()
    // 2026-10-22：路由设置卡（模式 / 兜底控件）已删除，本页不再有模式徽标
    expect(screen.queryByTestId('route-mode-badge')).toBeNull()
    expect(screen.queryByLabelText('路由规则由谁维护')).toBeNull()
  })

  it('PageIntro：页头副标一行定位，机制说明收进默认收起的说明区（与常驻区不重复）', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('routes-intro')).toBeInTheDocument()
    expect(screen.getByTestId('routes-intro-subtitle').textContent ?? '').toContain('查看告警路由树')
    // 说明区默认收起：要点不在 DOM
    expect(screen.getByTestId('routes-intro-guide-label')).toBeInTheDocument()
    expect(screen.queryByTestId('routes-intro-guide-points')).toBeNull()
    fireEvent.click(screen.getByTestId('routes-intro-guide-label'))
    const points = screen.getByTestId('routes-intro-guide-points')
    expect(points.textContent ?? '').toContain('一条规则包含')
    expect(points.textContent ?? '').toContain('确认下发后才会生效')
    // 读表须知常驻在路由树表格正上方
    expect(screen.getByText(/顶层路由是所有告警的总入口/)).toBeInTheDocument()
  })

  // 契约②：树形缩进展示层级（按 parent_id / order 建树）；根路由置顶锁定
  it('树形层级渲染：按 parent_id/order 建树前序展开，根路由置顶并锁定', () => {
    // items 故意乱序传入，验证前端按结构重建（不依赖后端返回顺序）
    const items = [childA, grandchild, rootNode, childB]
    useRoutesMock.mockReturnValue(result({ data: { items } }))

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
    useRoutesMock.mockReturnValue(result({ data: { items: [rootNode, childGhost] } }))
    // knownReceivers 含 default（根路由接收人），但不含 ghost-receiver
    useRouteEditorMock.mockReturnValue(editorResult({ knownReceivers: ['default'] }))
    renderPage()
    const badge = screen.getByTestId('route-receiver-undefined')
    expect(badge).toHaveTextContent('未定义')
    expect(badge).toHaveClass('ant-typography-danger')
    // 已知接收人（default）按「默认（不通知）」正常渲染、不标红
    expect(screen.getAllByText('默认（不通知）').length).toBeGreaterThan(0)
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
        data: { items: [rootNode, childChannel, childFeishu] },
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

  // 契约④：解析失败降级为原始 YAML 只读展示 + 提示（不白屏、不报错页）
  it('解析失败：降级为原文只读展示 + 提示，不渲染路由表', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
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
    // 降级态不渲染路由表（无列头、无报错页；编辑抽屉 forceRender 的表单标签不算）
    expect(screen.queryByRole('columnheader', { name: '路由名称' })).toBeNull()
  })

  // 2026-10-22：页面默认只读，只提供一个「编辑路由」入口。
  it('只读态：只提供「编辑路由」入口，不显示新建 / 保存 / 放弃', () => {
    useRoutesMock.mockReturnValue(result())
    renderPage()
    expect(screen.getByTestId('route-enter-edit-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('route-new-btn')).toBeNull()
    expect(screen.queryByTestId('route-save-btn')).toBeNull()
    expect(screen.queryByTestId('route-reset-btn')).toBeNull()
    expect(screen.getByText('路由树')).toBeInTheDocument()
    expect(screen.getByText('只读')).toBeInTheDocument()
    // 未进入编辑态时行内编辑 / 删除 / 排序入口不出现
    expect(screen.queryByRole('button', { name: /编辑 root/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除 root/ })).toBeNull()
  })

  it('点「编辑路由」：先刷新配置，加载完成后载入编辑区', async () => {
    const importFromCurrent = vi.fn()
    const reload = vi.fn((after?: (ok: boolean, data: null) => void) => after?.(true, null))
    useRoutesMock.mockReturnValue(result({ reload }))
    useRouteEditorMock.mockReturnValue(editorResult({ importFromCurrent }))
    renderPage()

    fireEvent.click(screen.getByTestId('route-enter-edit-btn'))
    expect(reload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(importFromCurrent).toHaveBeenCalledTimes(1))
  })

  it('空配置：空白树根路由预填「默认（不通知）」，预检不阻断保存', () => {
    useRouteEditorMock.mockReturnValue(editorResult({ tree: emptyRouteTree(), importState: 'imported' }))
    renderPage()
    // 根路由的接收人显示为「默认（不通知）」
    expect(screen.getByTestId('route-receiver-default')).toHaveTextContent('默认（不通知）')
    // 不再出现「根路由必须指定兜底接收人」的阻断项
    expect(screen.queryByTestId('route-precheck-blocking')).toBeNull()
    expect(screen.queryByText(/根路由必须指定兜底接收人/)).toBeNull()
  })

  it('空态：无生效配置时展示空表引导，不再合成「未配置」占位', () => {
    useRoutesMock.mockReturnValue(result({ data: { items: [] } }))
    renderPage()
    expect(screen.getByText('当前暂无路由配置，点右上角「编辑路由」开始配置')).toBeInTheDocument()
    expect(screen.queryByText('未配置')).toBeNull()
    expect(screen.queryByTestId('route-unconfigured-tip')).toBeNull()
    // 仍然是只读态：没有行内编辑 / 删除入口
    expect(screen.queryByRole('button', { name: /编辑 root/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /删除 root/ })).toBeNull()
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
      result({ data: { items: [rootNode] } }),
    )
    useRouteEditorMock.mockReset()
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
  })

  // 编辑态只提供「新建 / 保存 / 放弃」三个动作
  it('编辑态：提供「新建路由规则」「保存并提交变更」「放弃编辑」，不再有载入按钮', () => {
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()
    expect(screen.getByTestId('route-new-btn')).toBeEnabled()
    expect(screen.getByTestId('route-save-btn')).toBeEnabled()
    expect(screen.getByTestId('route-reset-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('route-import-btn')).toBeNull()
    expect(screen.queryByTestId('route-enter-edit-btn')).toBeNull()
    expect(screen.getByText('可编辑')).toBeInTheDocument()
  })

  // 验收 2：解析失败 → 无法完整解析提示 + 仍渲染编辑树供手动校正
  it('配置无法完整解析：给出提示并保留手动校正通道（编辑树仍可渲染）', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
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
    expect(screen.getByTestId('route-import-notice')).toHaveTextContent('当前配置无法完整解析，已从空白路由树开始，请手动补齐')
    expect(screen.getByText(/无法被平台完整解析/)).toBeInTheDocument()
    // 手动校正通道：编辑树仍在，且带删除 / 排序入口
    expect(screen.getByText('严重告警 → SRE')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑 root/0' })).toBeInTheDocument()
  })

  // 2026-10-13 问题① 修复接线：导入成功提示不再用卡片外的整条绿色 Alert（会把「保存并提交变更」
  // 挤出首要视线，且 message 与 description 重复「已载入当前配置」），改为操作区内单行小字，
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

  // 2026-10-14 布局优化：条件提示四合一。
  // 原先 blocking / warnings / partial / saveResult 各占一条满宽 Alert，最坏情况四条同屏——
  // 同样醒目、同样占宽的色块把「真正阻断保存的那条」淹没了。现收敛为一张「需要处理」卡，
  // 条目按 severity 从高到低排列。
  it('需要处理卡：多条提示收敛进同一张卡，且 error 级排在最前', () => {
    useRouteEditorMock.mockReturnValue(
      editorResult({
        tree: editTree,
        importState: 'partial',
        importNotice: '有 2 条规则无法被平台完整解析，请手动校正后再保存',
        issues: [],
        blocking: [
          {
            level: 'error',
            code: 'receiver_dangling',
            node_id: 'root/0',
            field: 'receiver',
            message: '接收人「sre-critical」未定义（对应通知渠道未启用或已删除），告警将无处可发',
          },
        ],
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
    const card = screen.getByTestId('route-notices')
    expect(within(card).getByText('需要处理')).toBeInTheDocument()
    // 三条提示同在卡内
    expect(within(card).getByTestId('route-precheck-blocking')).toHaveTextContent('必须修正后才能保存')
    expect(within(card).getByTestId('route-precheck-warning')).toHaveTextContent('有 1 项建议确认')
    expect(within(card).getByTestId('route-import-notice')).toHaveTextContent('当前配置无法完整解析')
    // 排序护栏：阻断项必须排在警告/建议之前，否则「先看哪条」失去意义
    const alertOrder = Array.from(card.querySelectorAll('[data-testid]')).map((el) =>
      el.getAttribute('data-testid'),
    )
    expect(alertOrder.indexOf('route-precheck-blocking')).toBeLessThan(
      alertOrder.indexOf('route-import-notice'),
    )
  })

  // 收敛后的反向护栏：没有任何待处理项时不该留空壳卡。
  it('需要处理卡：无待处理项时不渲染', () => {
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()
    expect(screen.queryByTestId('route-notices')).toBeNull()
  })

  // 编辑抽屉：点「编辑」打开三段式抽屉（标题 = 编辑路由规则）
  it('编辑入口：点击行内「编辑」打开三段式抽屉', async () => {
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '编辑 root/0' }))
    expect(await screen.findByText('编辑路由规则')).toBeInTheDocument()
    expect(screen.getByText('① 这条规则管什么')).toBeInTheDocument()
  })

  // 只读态（解析失败降级）：原文只读展示 + 唯一的「编辑路由」入口
  it('只读态（解析失败降级）：显示原文与「编辑路由」入口，不显示新建 / 保存', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          parse_error: 'route.routes 不是列表，无法解析子路由',
          raw_yaml: 'route:\n  receiver: default\n',
        },
      }),
    )
    useRouteEditorMock.mockReturnValue(editorResult())
    renderPage()
    expect(screen.getByTestId('route-enter-edit-btn')).toBeInTheDocument()
    expect(screen.queryByTestId('route-new-btn')).toBeNull()
    expect(screen.queryByTestId('route-save-btn')).toBeNull()
  })

  it('未修改时点「放弃编辑」：不弹确认，直接退出编辑态', () => {
    const modal = mockAntdModal()
    const reset = vi.fn()
    const reload = vi.fn()
    useRoutesMock.mockReturnValue(result({ reload }))
    useRouteEditorMock.mockReturnValue(
      editorResult({ tree: editTree, importState: 'imported', dirty: false, reset }),
    )
    renderPage()

    fireEvent.click(screen.getByTestId('route-reset-btn'))
    expect(modal.confirm).not.toHaveBeenCalled()
    expect(reset).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalled()
  })

  it('有未保存改动时点「放弃编辑」：弹二次确认，确认后才退出', async () => {
    const modal = mockAntdModal()
    const reset = vi.fn()
    useRouteEditorMock.mockReturnValue(
      editorResult({ tree: editTree, importState: 'imported', dirty: true, reset }),
    )
    renderPage()

    fireEvent.click(screen.getByTestId('route-reset-btn'))
    expect(modal.confirm).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
    await modal.confirm.mock.calls[0][0].onOk?.()
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('保存成功后回到只读并提示「已提交，待确认下发」', async () => {
    const reset = vi.fn()
    useRouteEditorMock.mockReturnValue(
      editorResult({ tree: editTree, importState: 'imported', reset }),
    )
    renderPage()
    fireEvent.click(screen.getByTestId('route-save-btn'))
    await waitFor(() => expect(reset).toHaveBeenCalled())
    expect(screen.getByTestId('route-submitted-notice')).toBeInTheDocument()
  })

  /**
   * 页面层接线护栏：baseChecksum（GET /routes 的 effective_checksum）必须传给编辑器，
   * 保存时用于后端乐观锁；sourceItems 同样透传。
   */
  it('接线：effective_checksum 与 sourceItems 透传给 useRouteEditor', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          items: [rootNode, childA],
          effective_checksum: 'base-sha256',
        },
      }),
    )
    useRouteEditorMock.mockReturnValue(editorResult({ tree: editTree, importState: 'imported' }))
    renderPage()

    const opts = useRouteEditorMock.mock.calls[0][0] as Record<string, unknown>
    expect(opts.baseChecksum).toBe('base-sha256')
    expect(opts.sourceItems).toHaveLength(2)
  })

  it('有 pending 变更单时展示「待确认版本」横幅', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
          items: [rootNode],
          pending: { change_no: 'CHG-20261022-009', created_at: '2026-10-22T10:00:00Z' },
        },
      }),
    )
    renderPage()
    const banner = screen.getByTestId('route-pending-banner')
    expect(banner).toHaveTextContent('当前显示的是待确认版本')
    expect(banner).toHaveTextContent('CHG-20261022-009')
  })

  it('接线：解析失败时把 parseError 传下去', () => {
    useRoutesMock.mockReturnValue(
      result({
        data: {
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
