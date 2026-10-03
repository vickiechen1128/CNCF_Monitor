import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupAntdTest } from '../../test/antdTestUtils'
import { RouteEditorDrawer } from './RouteEditorDrawer'
import {
  ROUTE_LABEL_OPTION_LIMIT,
  filterRouteLabelOptions,
  flattenRouteLabelOptions,
  isRouteLabelClipped,
  toRouteLabelSelectOptions,
} from './routeLabels'
import {
  blankRouteNode,
  countDescendants,
  emptyRouteTree,
  flattenRouteTree,
  fromRouteNodes,
  generateRouteSection,
  hasBlockingIssue,
  mergeRouteSection,
  moveSibling,
  parseRouteDuration,
  removeSubtree,
  reorderSibling,
  validateRouteTree,
  type RouteEditNode,
} from './routeTree'
import type { RouteMatcher, RouteNode } from '../../types/alertmanager'

// 分组键联想：复用 GET /silences/label-options（决策 71，零后端改动）
const getLabelOptionsMock = vi.fn()
vi.mock('../../api/alertmanager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/alertmanager')>()
  return {
    ...actual,
    alertmanagerSilenceApi: {
      ...actual.alertmanagerSilenceApi,
      getLabelOptions: (...a: unknown[]) => getLabelOptionsMock(...a),
    },
  }
})

/** 编辑态节点工厂（默认一条子路由） */
function editNode(over: Partial<RouteEditNode> & Pick<RouteEditNode, 'id' | 'parent_id'>): RouteEditNode {
  return { ...blankRouteNode(over.id, over.parent_id), ...over }
}

const sampleNode = editNode({
  id: 'root/0',
  parent_id: 'root',
  name: '严重告警',
  matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
  receiver: 'sre-critical',
  group_by: ['alertname'],
  group_wait: '15s',
  group_interval: '3m',
  repeat_interval: '1h',
  continue: true,
})

const renderDrawer = (over: Partial<Parameters<typeof RouteEditorDrawer>[0]> = {}) => {
  const onSubmit = over.onSubmit ?? vi.fn()
  const utils = render(
    <RouteEditorDrawer
      open
      node={sampleNode}
      parentOptions={[
        { value: 'root', label: '顶层路由（兜底）' },
        { value: 'root/1', label: '其他路由' },
      ]}
      receiverOptions={['sre-critical', 'default']}
      issues={[]}
      onClose={vi.fn()}
      onSubmit={onSubmit}
      {...over}
    />,
  )
  return { ...utils, onSubmit }
}

describe('RouteEditorDrawer（路由规则三段式表单 v0.3-b）', () => {
  setupAntdTest()

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  // Step 3.7 回归：关闭 → 打开切换，首次打开即回显（forceRender，禁止 destroyOnHidden）
  it('首次打开即回显编辑值（forceRender 回归，禁止二次打开才出现）', async () => {
    const { rerender } = render(
      <RouteEditorDrawer
        open={false}
        node={sampleNode}
        parentOptions={[]}
        receiverOptions={['sre-critical']}
        issues={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    rerender(
      <RouteEditorDrawer
        open
        node={sampleNode}
        parentOptions={[]}
        receiverOptions={['sre-critical']}
        issues={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    )
    expect(await screen.findByDisplayValue('严重告警')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('15s')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('3m')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('1h')).toBeInTheDocument()
  })

  // 三段式：① 这条规则管什么 ② 匹配什么告警 ③ 发给谁、怎么发
  it('三段式表单：① 管什么 / ② 匹配什么 / ③ 发给谁怎么发', async () => {
    renderDrawer()
    expect(await screen.findByText('① 这条规则管什么')).toBeInTheDocument()
    expect(screen.getByText('② 匹配什么告警')).toBeInTheDocument()
    expect(screen.getByText('③ 发给谁、怎么发')).toBeInTheDocument()
    // 匹配条件回显 + 留空语义说明
    expect(screen.getByDisplayValue('severity')).toBeInTheDocument()
    expect(screen.getByDisplayValue('critical')).toBeInTheDocument()
    expect(screen.getByText(/多个条件为「且」关系；留空 = 匹配所有告警/)).toBeInTheDocument()
    // 发送节奏三件套
    expect(screen.getByText('初次等待')).toBeInTheDocument()
    expect(screen.getByText('分组间隔')).toBeInTheDocument()
    expect(screen.getByText('重复间隔')).toBeInTheDocument()
  })

  // 验收 5：时长不整除 → 警告（不阻断）
  it('时长不整除：重复间隔不是分组间隔整数倍 → 警告级提示，不阻断保存', async () => {
    renderDrawer({
      node: editNode({ id: 'root/0', parent_id: 'root', group_interval: '5m', repeat_interval: '7m' }),
    })
    await waitFor(() => expect(screen.getByTestId('route-editor-warning')).toBeInTheDocument())
    expect(screen.getByText(/重复间隔 7m 不是分组间隔 5m 的整数倍/)).toBeInTheDocument()
    expect(screen.queryByTestId('route-editor-blocking')).toBeNull()
  })

  // 验收 5：接收人悬空 → 红字阻断
  it('接收人悬空：引用未启用 / 不存在的渠道 → 红字阻断', async () => {
    renderDrawer({
      issues: [
        {
          level: 'error',
          code: 'receiver_dangling',
          node_id: 'root/0',
          field: 'receiver',
          message: '接收人「sre-critical」未定义（对应通知渠道未启用或已删除），告警将无处可发',
        },
      ],
    })
    await waitFor(() => expect(screen.getByTestId('route-editor-blocking')).toBeInTheDocument())
    expect(screen.getByText(/接收人「sre-critical」未定义/)).toBeInTheDocument()
    expect(screen.getByText('本条路由存在必须修正的问题（保存会被阻断）')).toBeInTheDocument()
  })

  it('正则非法：匹配条件正则值不可编译 → 红字阻断', async () => {
    renderDrawer({
      node: editNode({
        id: 'root/0',
        parent_id: 'root',
        matchers: [{ name: 'alertname', value: 'Host[Down', is_equal: true, is_regex: true }],
      }),
    })
    await waitFor(() => expect(screen.getByTestId('route-editor-blocking')).toBeInTheDocument())
    expect(screen.getByText(/正则值 "Host\[Down" 非法/)).toBeInTheDocument()
  })

  // 验收 F13-1：根路由兜底接收人为空 → 红字阻断 + 保存按钮禁用 + 提交不回传（H3）
  it('H3：根路由兜底接收人为空 → 红字阻断，保存按钮禁用且提交不回传', async () => {
    const { onSubmit } = renderDrawer({
      node: blankRouteNode('root', ''),
      issues: [
        {
          level: 'error',
          code: 'root_receiver_required',
          node_id: 'root',
          field: 'receiver',
          message: '根路由必须指定兜底接收人（Alertmanager 要求 root route must specify a default receiver）',
        },
      ],
    })
    await waitFor(() => expect(screen.getByTestId('route-editor-blocking')).toBeInTheDocument())
    expect(screen.getByText(/根路由必须指定兜底接收人/)).toBeInTheDocument()
    expect(screen.getByTestId('route-editor-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId('route-editor-save'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // 验收 1 前置：表单提交 → 回传编辑态节点（id 沿用，编辑态字段不落盘语义由生成器承担）
  it('提交：回传编辑态节点（id 沿用、匹配条件与开关按语义映射）', async () => {
    const { onSubmit } = renderDrawer()
    fireEvent.change(await screen.findByDisplayValue('严重告警'), { target: { value: 'P0 严重告警' } })
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      id: 'root/0',
      parent_id: 'root',
      name: 'P0 严重告警',
      receiver: 'sre-critical',
      group_by: ['alertname'],
      group_wait: '15s',
      group_interval: '3m',
      repeat_interval: '1h',
      continue: true,
      enabled: true,
    })
  })

  it('新建：标题为「新建路由规则」，提交回传的 id 为空串（由页面分配）', async () => {
    const { onSubmit } = renderDrawer({ node: blankRouteNode('', 'root') })
    expect(await screen.findByText('新建路由规则')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /保\s*存/ }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].id).toBe('')
    expect(onSubmit.mock.calls[0][0].parent_id).toBe('root')
  })

  it('顶层路由：父路由下拉禁用（不可删除、不可移动）', async () => {
    renderDrawer({ node: blankRouteNode('root', '') })
    expect(await screen.findByText('编辑路由规则')).toBeInTheDocument()
    expect(screen.getByText(/顶层路由，不可删除、不可移动/)).toBeInTheDocument()
  })
})

describe('routeTree 纯函数（镜像后端 T08-13 生成器 / 校验器口径）', () => {
  setupAntdTest()

  /** 只读视图节点（后端 GET /routes items 形态） */
  const readNode = (over: Partial<RouteNode> & Pick<RouteNode, 'id' | 'parent_id'>): RouteNode => ({
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

  it('generateRouteSection：顺序 = 数组顺序；matchers 落字符串简写；名称以注释落盘', () => {
    const tree: RouteEditNode[] = [
      editNode({ id: 'root', parent_id: '', receiver: 'default', group_by: ['alertname'] }),
      editNode({
        id: 'root/0',
        parent_id: 'root',
        name: '主机宕机专用',
        matchers: [{ name: 'alertname', value: 'HostDown|NodeExporterDown', is_equal: true, is_regex: true }],
        receiver: 'feishu',
        group_wait: '15s',
        group_interval: '10s',
        repeat_interval: '10s',
      }),
      editNode({
        id: 'root/1',
        parent_id: 'root',
        name: 'P0 严重告警',
        matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
        receiver: 'feishu',
      }),
    ]
    const yaml = generateRouteSection(tree)
    // 顺序 = 数组顺序（主机宕机专用 先于 P0 严重告警）
    expect(yaml.indexOf('主机宕机专用')).toBeLessThan(yaml.indexOf('P0 严重告警'))
    // matchers 字符串简写（正则 =  =~）
    expect(yaml).toContain('- alertname=~"HostDown|NodeExporterDown"')
    expect(yaml).toContain('- severity="critical"')
    // 名称以注释落盘
    expect(yaml).toContain('# 路由名称: 主机宕机专用')
    // continue 仅在 true 时输出（此处均 false）
    expect(yaml).not.toContain('continue')
    // 编辑态字段一律不落盘
    expect(yaml).not.toContain('parent_id')
    expect(yaml).not.toContain('enabled')
    expect(yaml).not.toContain('raw_yaml')
  })

  it('generateRouteSection：enabled=false 的节点及其整条子树整条剔除；continue=true 才输出', () => {
    const tree: RouteEditNode[] = [
      editNode({ id: 'root', parent_id: '', receiver: 'default' }),
      editNode({ id: 'root/0', parent_id: 'root', name: '停用分支', receiver: 'a', enabled: false }),
      editNode({ id: 'root/0/0', parent_id: 'root/0', name: '停用分支的子', receiver: 'b' }),
      editNode({ id: 'root/1', parent_id: 'root', name: '保留分支', receiver: 'c', continue: true }),
    ]
    const yaml = generateRouteSection(tree)
    expect(yaml).toContain('# 路由名称: 保留分支')
    expect(yaml).toContain('continue: true')
    expect(yaml).not.toContain('停用分支')
    expect(yaml).not.toContain('停用分支的子')
  })

  it('generateRouteSection：畸形树（无根 / 多根 / 根节点未启用）一律抛错，不产半截 route 段', () => {
    expect(() => generateRouteSection([])).toThrow(/为空/)
    expect(() =>
      generateRouteSection([editNode({ id: 'root/0', parent_id: 'root', receiver: 'x' })]),
    ).toThrow(/父节点/)
    expect(() =>
      generateRouteSection([
        editNode({ id: 'root', parent_id: '', receiver: 'x', enabled: false }),
      ]),
    ).toThrow(/根节点未启用/)
  })

  it('mergeRouteSection：只替换顶层 route 块，其余顶层段逐字保留', () => {
    const base = `global:
  resolve_timeout: 5m
route:
  receiver: 'old'
  routes:
    - receiver: 'a'
receivers:
  - name: 'old'
  - name: 'a'
# 尾部注释
`
    const merged = mergeRouteSection(base, generateRouteSection(emptyRouteTree()))
    expect(merged).toContain('global:')
    expect(merged).toContain('resolve_timeout: 5m')
    expect(merged).toContain("receivers:\n  - name: 'old'\n  - name: 'a'")
    expect(merged).toContain('# 尾部注释')
    expect(merged).not.toContain("receiver: 'old'")
  })

  it('mergeRouteSection：base 无 route 段时追加生成物而非丢弃', () => {
    const merged = mergeRouteSection("global:\n  resolve_timeout: 5m\n", 'route:\n  receiver: \'default\'\n')
    expect(merged).toContain('global:')
    expect(merged).toContain("receiver: 'default'")
  })

  it('validateRouteTree：根无兜底接收人 / 根带匹配条件 → 阻断；不整除 → 警告', () => {
    const noReceiver = validateRouteTree([blankRouteNode('root', '')])
    expect(hasBlockingIssue(noReceiver)).toBe(true)
    expect(noReceiver.some((i) => i.code === 'root_receiver_required')).toBe(true)

    const rootWithMatchers = validateRouteTree([
      editNode({
        id: 'root',
        parent_id: '',
        receiver: 'default',
        matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
      }),
    ])
    expect(rootWithMatchers.some((i) => i.code === 'root_matchers_forbidden')).toBe(true)

    const notMultiple = validateRouteTree([
      editNode({ id: 'root', parent_id: '', receiver: 'default', group_interval: '5m', repeat_interval: '7m' }),
    ])
    expect(notMultiple.some((i) => i.code === 'repeat_interval_not_multiple_of_group_interval')).toBe(true)
    expect(notMultiple.every((i) => i.level === 'warning')).toBe(true)
    expect(hasBlockingIssue(notMultiple)).toBe(false)
  })

  it('parseRouteDuration：支持组合时长；非法返回 null（与 ParseRouteDuration 同口径）', () => {
    expect(parseRouteDuration('30s')).toBe(30_000)
    expect(parseRouteDuration('1h30m')).toBe(5_400_000)
    expect(parseRouteDuration('0')).toBe(0)
    expect(parseRouteDuration('')).toBeNull()
    expect(parseRouteDuration('5x')).toBeNull()
    expect(parseRouteDuration('abc')).toBeNull()
  })

  // ⚠ Enabled 零值脚枪：导入必须显式置 true，否则整棵树被剔除
  it('fromRouteNodes：导入时 enabled 显式置 true（Go 零值脚枪）', () => {
    const items: RouteNode[] = [
      readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true }),
      readNode({
        id: 'root/0',
        parent_id: 'root',
        order: 0,
        name: '严重告警 → SRE',
        receiver: 'sre-critical',
        matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
      }),
    ]
    const tree = fromRouteNodes(items)
    expect(tree).toHaveLength(2)
    expect(tree.every((n) => n.enabled === true)).toBe(true)
    expect(tree[1].name).toBe('严重告警 → SRE')
    // 导入结果可直接生成（根已启用 → 不抛错）
    expect(generateRouteSection(tree)).toContain('# 路由名称: 严重告警 → SRE')
  })

  it('顺序调整：上移 / 下移与拖拽落点都只改同层数组顺序', () => {
    const tree: RouteEditNode[] = [
      editNode({ id: 'root', parent_id: '', receiver: 'default' }),
      editNode({ id: 'root/0', parent_id: 'root', name: 'A', receiver: 'a' }),
      editNode({ id: 'root/0/0', parent_id: 'root/0', name: 'A1', receiver: 'a1' }),
      editNode({ id: 'root/1', parent_id: 'root', name: 'B', receiver: 'b' }),
    ]
    const siblings = (t: RouteEditNode[]) =>
      t.filter((n) => n.parent_id === 'root').map((n) => n.name)

    expect(siblings(tree)).toEqual(['A', 'B'])
    expect(siblings(moveSibling(tree, 'root/1', -1))).toEqual(['B', 'A'])
    // 已是首位：上移无效
    expect(siblings(moveSibling(tree, 'root/0', -1))).toEqual(['A', 'B'])
    // 顶层路由不可移动
    expect(moveSibling(tree, 'root', -1)).toBe(tree)
    // 拖拽：A 落到 B 的位置
    expect(siblings(reorderSibling(tree, 'root/0', 'root/1'))).toEqual(['B', 'A'])
    // 不同父不生效
    expect(reorderSibling(tree, 'root/0', 'root/0/0')).toBe(tree)
    // 重排后仍可从根可达（前序重建）
    expect(flattenRouteTree(moveSibling(tree, 'root/1', -1)).map((n) => n.id)[0]).toBe('root')
  })

  it('删除：countDescendants 统计子路由条数（二次确认文案用）；removeSubtree 连带子树', () => {
    const tree: RouteEditNode[] = [
      editNode({ id: 'root', parent_id: '', receiver: 'default' }),
      editNode({ id: 'root/0', parent_id: 'root', name: 'A', receiver: 'a' }),
      editNode({ id: 'root/0/0', parent_id: 'root/0', name: 'A1', receiver: 'a1' }),
      editNode({ id: 'root/0/1', parent_id: 'root/0', name: 'A2', receiver: 'a2' }),
      editNode({ id: 'root/1', parent_id: 'root', name: 'B', receiver: 'b' }),
    ]
    expect(countDescendants(tree, 'root/0')).toBe(2)
    expect(countDescendants(tree, 'root/1')).toBe(0)
    expect(removeSubtree(tree, 'root/0').map((n) => n.id)).toEqual(['root', 'root/1'])
  })

  it('往返：只读 → 导入 → 生成 → 结构等价（name 经注释还原，顺序不变）', () => {
    const items: RouteNode[] = [
      readNode({
        id: 'root',
        parent_id: '',
        receiver: 'default',
        group_by: ['alertname'],
        group_wait: '30s',
        group_interval: '5m',
        repeat_interval: '4h',
        locked: true,
      }),
      readNode({
        id: 'root/0',
        parent_id: 'root',
        order: 0,
        name: '严重告警 → SRE',
        receiver: 'sre-critical',
        matchers: [
          { name: 'severity', value: 'critical', is_equal: true, is_regex: false } as RouteMatcher,
        ],
        continue: true,
      }),
      readNode({
        id: 'root/1',
        parent_id: 'root',
        order: 1,
        name: '网域 A 专线',
        receiver: 'gov-team',
        matchers: [
          { name: 'network_domain', value: 'gov-*', is_equal: true, is_regex: true } as RouteMatcher,
        ],
      }),
    ]
    const yaml = generateRouteSection(fromRouteNodes(items))
    expect(yaml).toContain('# 路由名称: 严重告警 → SRE')
    expect(yaml).toContain('# 路由名称: 网域 A 专线')
    expect(yaml.indexOf('严重告警 → SRE')).toBeLessThan(yaml.indexOf('网域 A 专线'))
    expect(yaml).toContain('- severity="critical"')
    expect(yaml).toContain('- network_domain=~"gov-*"')
    expect(yaml).toContain('continue: true')
    expect(yaml).toContain("group_by: [alertname]")
  })
})

describe('RouteEditorDrawer v0.3-c 联动（T08-F13）', () => {
  setupAntdTest()

  /** 分组键联想端点响应（决策 71 四层并集的简化样本） */
  const labelPayload = () => ({
    status: 'success',
    data: {
      groups: [
        {
          source: 'target_system' as const,
          label: '系统与采集标签',
          items: [
            { name: 'instance', description: '采集地址' },
            { name: 'resource_id', description: '资源唯一 ID' },
          ],
        },
        {
          source: 'rule' as const,
          label: '规则标签',
          items: [{ name: 'alertname' }, { name: 'severity' }],
        },
      ],
    },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    getLabelOptionsMock.mockResolvedValue(labelPayload())
  })

  /** 打开某个 antd 下拉（按 Form.Item label 定位内层输入框） */
  const openSelect = (label: string) => {
    const input = screen.getByLabelText(label)
    fireEvent.mouseDown(input)
    return input as unknown as HTMLInputElement
  }

  /** 下拉浮层里的候选项标题（不含已选中的 tag，避免「已选值」干扰过滤断言） */
  const optionTitles = () =>
    Array.from(document.querySelectorAll('.ant-select-item-option')).map((el) => el.getAttribute('title'))

  // 验收 1：接收人下拉数据源 = 已启用通知渠道（ReceiverName()），悬空项红字「未定义」
  it('接收人下拉：数据源 = 已启用渠道接收人，悬空引用红字标注「未定义」', async () => {
    renderDrawer({ knownReceivers: ['default'] })
    expect(await screen.findByText('③ 发给谁、怎么发')).toBeInTheDocument()
    openSelect('接收人')
    // 已启用渠道派生的接收人（= ReceiverName()）在下拉内
    await waitFor(() => expect(optionTitles()).toContain('default'))
    // 悬空引用（导入自存量配置、渠道已停用）保留在下拉但标红「未定义」
    expect(screen.getAllByText('未定义').length).toBeGreaterThan(0)
    expect(screen.getAllByText('sre-critical').length).toBeGreaterThan(0)
  })

  // 验收 1：引用悬空 → 红字「未定义」+ 保存阻断
  it('接收人悬空：红字「未定义」提示 + 保存被阻断（不回传页面）', async () => {
    const { onSubmit } = renderDrawer({ knownReceivers: ['default'] })
    const dangling = await screen.findByTestId('route-editor-receiver-dangling')
    expect(dangling).toHaveTextContent('未定义')
    // 阻断级结论 + 保存按钮禁用 → 点击不回传
    await waitFor(() => expect(screen.getByTestId('route-editor-blocking')).toBeInTheDocument())
    expect(screen.getByTestId('route-editor-save')).toBeDisabled()
    fireEvent.click(screen.getByTestId('route-editor-save'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('接收人清单取不到（非管理员）：不判定悬空、不阻断保存', async () => {
    const { onSubmit } = renderDrawer({ knownReceivers: [] })
    expect(screen.queryByTestId('route-editor-receiver-dangling')).toBeNull()
    expect(screen.getByTestId('route-editor-save')).toBeEnabled()
    fireEvent.click(screen.getByTestId('route-editor-save'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  // 验收 2：分组键 Tags 联想（复用 label-options，零后端改动）
  it('分组键联想：复用 label-options 端点，按分组渲染标签名', async () => {
    renderDrawer()
    await waitFor(() => expect(getLabelOptionsMock).toHaveBeenCalled())
    openSelect('分组键')
    expect(await screen.findByText('系统与采集标签')).toBeInTheDocument()
    expect(screen.getByText('规则标签')).toBeInTheDocument()
    const titles = optionTitles()
    expect(titles).toContain('alertname')
    expect(titles).toContain('instance')
    expect(titles).toContain('severity')
  })

  it('分组键联想是增强：未收录的标签名仍可回车自建（AM group_by 为自由数组）', async () => {
    const { onSubmit } = renderDrawer()
    await waitFor(() => expect(getLabelOptionsMock).toHaveBeenCalled())
    const input = openSelect('分组键')
    fireEvent.change(input, { target: { value: 'zone_type' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 })
    fireEvent.click(screen.getByTestId('route-editor-save'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].group_by).toEqual(['alertname', 'zone_type'])
  })

  it('分组键联想：输入关键词按前缀 / 包含过滤', async () => {
    renderDrawer()
    await waitFor(() => expect(getLabelOptionsMock).toHaveBeenCalled())
    const input = openSelect('分组键')
    await screen.findByText('规则标签')
    fireEvent.change(input, { target: { value: 'sev' } })
    await waitFor(() => expect(optionTitles()).toContain('severity'))
    expect(optionTitles()).not.toContain('alertname')
    expect(optionTitles()).not.toContain('instance')
  })

  // clipping：长列表限制条数（不引入虚拟滚动依赖）
  it('分组键联想 clipping：超长列表只渲染前 50 条并提示输入关键词', async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      name: `label-${String(i).padStart(2, '0')}`,
    }))
    getLabelOptionsMock.mockResolvedValue({
      status: 'success',
      data: { groups: [{ source: 'rule' as const, label: '规则标签', items: many }] },
    })
    renderDrawer()
    await waitFor(() => expect(getLabelOptionsMock).toHaveBeenCalled())
    expect(
      await screen.findByText(`标签较多：仅显示前 ${ROUTE_LABEL_OPTION_LIMIT} 个，输入关键词可精确查找`),
    ).toBeInTheDocument()
    openSelect('分组键')
    await waitFor(() => expect(optionTitles()).toContain('label-00'))
    // 传入下拉的候选项已被限条（≤ 50；antd 自身再按可视区虚拟渲染）
    expect(optionTitles().length).toBeLessThanOrEqual(ROUTE_LABEL_OPTION_LIMIT)
    expect(optionTitles()).not.toContain('label-50')
    expect(optionTitles()).not.toContain('label-59')
  })

  it('分组键联想取数失败：静默降级，不阻断编辑与保存', async () => {
    getLabelOptionsMock.mockRejectedValue(new Error('label-options 不可用'))
    const { onSubmit } = renderDrawer()
    await waitFor(() => expect(getLabelOptionsMock).toHaveBeenCalled())
    expect(screen.getByLabelText('分组键')).toBeInTheDocument()
    expect(screen.queryByTestId('route-editor-blocking')).toBeNull()
    fireEvent.click(screen.getByTestId('route-editor-save'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  // 验收 3：不整除 → 警告级（不阻断）+ 明示 AM 向上取整后的实际值
  it('时长不整除：警告不阻断，并明示「向上取整到 10m」', async () => {
    const { onSubmit } = renderDrawer({
      node: editNode({ id: 'root/0', parent_id: 'root', group_interval: '5m', repeat_interval: '7m' }),
    })
    const hint = await screen.findByTestId('route-editor-repeat-adjust')
    expect(hint).toHaveTextContent('向上取整到 10m')
    expect(screen.getByTestId('route-editor-warning')).toBeInTheDocument()
    expect(screen.queryByTestId('route-editor-blocking')).toBeNull()
    expect(screen.getByTestId('route-editor-save')).toBeEnabled()
    fireEvent.click(screen.getByTestId('route-editor-save'))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  // 验收 3：group_interval 兼作通知管道 timeout / continue 语义 → 解释性 Tooltip
  it('时长与 continue：分组间隔（兼作通知管道超时）与继续匹配均有解释性 Tooltip', async () => {
    renderDrawer()
    expect(await screen.findByText('③ 发给谁、怎么发')).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByText('分组间隔'))
    expect(await screen.findByText(/单次发送耗时超过它会被取消导致漏发/)).toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByText('继续匹配'))
    expect(await screen.findByText(/命中即停/)).toBeInTheDocument()
  })
})

describe('routeLabels 纯函数（分组键联想，T08-F13）', () => {
  setupAntdTest()

  const group = (label: string, names: string[]) => ({
    source: 'rule' as const,
    label,
    items: names.map((name) => ({ name })),
  })

  it('flattenRouteLabelOptions：跨分组去重 + 按标签名排序', () => {
    const flat = flattenRouteLabelOptions({
      groups: [group('系统与采集标签', ['instance', 'severity']), group('规则标签', ['severity', 'alertname'])],
    })
    expect(flat.map((o) => o.value)).toEqual(['alertname', 'instance', 'severity'])
    // 同名键保留首次出现的分组
    expect(flat.find((o) => o.value === 'severity')?.group).toBe('系统与采集标签')
  })

  it('filterRouteLabelOptions：前缀命中优先，空关键词仅限条', () => {
    const flat = flattenRouteLabelOptions({
      groups: [group('规则标签', ['severity', 'my_severity', 'alertname'])],
    })
    // 前缀命中优先于包含命中
    expect(filterRouteLabelOptions(flat, 'se').map((o) => o.value)).toEqual(['severity', 'my_severity'])
    // 限条：60 条 → 前 50 条
    const many = flattenRouteLabelOptions({
      groups: [group('规则标签', Array.from({ length: 60 }, (_, i) => `label-${i}`))],
    })
    expect(filterRouteLabelOptions(many, '')).toHaveLength(ROUTE_LABEL_OPTION_LIMIT)
    expect(isRouteLabelClipped(many.length, filterRouteLabelOptions(many, '').length)).toBe(true)
  })

  it('toRouteLabelSelectOptions：按分组聚合，空分组不渲染', () => {
    const flat = flattenRouteLabelOptions({
      groups: [group('系统与采集标签', ['instance']), group('规则标签', ['alertname'])],
    })
    const options = toRouteLabelSelectOptions(flat)
    expect(options.map((g) => g.label)).toEqual(['规则标签', '系统与采集标签'])
    expect(options[0].options).toEqual([{ value: 'alertname', label: 'alertname' }])
  })
})
