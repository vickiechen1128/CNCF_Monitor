/**
 * useRouteEditor 单元测（C1 / H1 / H4）：
 * - C1：保存合并基 = admin「生效产品视图」端点 GET /config/product（含平台物化 receivers），
 *       仅覆盖 route 段、原样保留 receivers；该端点 RequireAdmin，与保存提交 POST /config 同级，
 *       故保存链路整体 admin 一致（非 admin 仅能查看/编辑，不能提交）。
 * - H1：knownReceivers 由非 admin 的 notifyChannelsApi.list() 批量派生，不调用 admin getReceiverSnippet。
 * - H4：部分导入保存前弹二次确认，取消则中止保存、确认才提交。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import type { ApiResponse } from '../../types/api'
import type { NotifyChannel, RouteNode } from '../../types/alertmanager'
import { useRouteEditor } from './useRoutes'
import { blankRouteNode } from './routeTree'

const submitMock = vi.fn()
const getCurrentMock = vi.fn()
const getProductMock = vi.fn()
const getRoutesMock = vi.fn()
const listMock = vi.fn()

vi.mock('../../api/alertmanager', () => ({
  alertmanagerConfigApi: {
    submit: (...a: unknown[]) => submitMock(...a),
    getCurrent: (...a: unknown[]) => getCurrentMock(...a),
    getProduct: (...a: unknown[]) => getProductMock(...a),
  },
  alertmanagerRoutesApi: {
    getRoutes: (...a: unknown[]) => getRoutesMock(...a),
  },
  notifyChannelsApi: {
    list: (...a: unknown[]) => listMock(...a),
  },
}))

function channel(over: Partial<NotifyChannel> = {}): NotifyChannel {
  return {
    id: '1',
    name: 'SRE 飞书群',
    type: 'feishu',
    webhook_url: 'https://open.feishu.cn/***',
    secret_set: true,
    enabled: true,
    created_at: '2026-09-30T10:00:00Z',
    ...over,
  }
}

function channels(items: NotifyChannel[]): ApiResponse<{ items: NotifyChannel[] }> {
  return { status: 'success', data: { items } }
}

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

/** 含平台物化 receivers 的「生效产品视图」YAML（C1 合并基） */
const EFFECTIVE_YAML = `global:
  resolve_timeout: 5m
route:
  receiver: 'default'
  group_by: ['alertname']
receivers:
  - name: 'platform-recv-1'
  - name: 'platform-recv-2'
# 尾部注释保留
`

beforeEach(() => {
  vi.clearAllMocks()
  getProductMock.mockResolvedValue({ status: 'success', data: { yaml: EFFECTIVE_YAML } })
  getCurrentMock.mockResolvedValue({ status: 'success', data: { id: 'v1', content: EFFECTIVE_YAML, checksum: '', status: 'applied' } })
  submitMock.mockResolvedValue({ status: 'success', data: { id: 'v2', content: '', checksum: '', status: 'applied' } })
  listMock.mockResolvedValue(channels([]))
})

describe('useRouteEditor — C1 保存合并基（非 admin 生效产品视图）', () => {
  it('保存以非 admin 生效产品视图 YAML 为合并基，保留平台物化 receivers，且不调用 admin 端点', async () => {
    const sourceItems = [
      readNode({ id: 'root', parent_id: '', receiver: 'default', group_by: ['alertname'], locked: true }),
      readNode({
        id: 'root/0',
        parent_id: 'root',
        order: 0,
        name: '严重告警 → SRE',
        receiver: 'platform-recv-1',
        matchers: [{ name: 'severity', value: 'critical', is_equal: true, is_regex: false }],
      }),
    ]

    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, onSaved: vi.fn() }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.tree.length).toBe(2))

    const ok = await act(async () => result.current.save())

    expect(ok).toBe(true)
    // 合并基取自 admin GET /config/product（含平台物化 receivers），不回落 /config/current
    expect(getProductMock).toHaveBeenCalledTimes(1)
    expect(getCurrentMock).not.toHaveBeenCalled()
    expect(submitMock).toHaveBeenCalledTimes(1)

    const content = submitMock.mock.calls[0][0].content as string
    // receivers 段被原样保留（平台物化接收人不丢）
    expect(content).toContain("name: 'platform-recv-1'")
    expect(content).toContain("name: 'platform-recv-2'")
    // route 段被覆盖为用户编辑内容
    expect(content).toContain('route:')
    expect(content).toContain('severity="critical"')
    // 非 route 顶层段保留（global / 尾部注释）
    expect(content).toContain('resolve_timeout: 5m')
    expect(content).toContain('# 尾部注释保留')
  })

  it('getProduct 失败时回落到 admin 的 /config/current 作为合并基', async () => {
    getProductMock.mockRejectedValueOnce(new Error('product unavailable'))
    const sourceItems = [readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true })]
    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, onSaved: vi.fn() }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.tree.length).toBe(1))

    await act(async () => result.current.save())

    expect(getProductMock).toHaveBeenCalledTimes(1)
    expect(getCurrentMock).toHaveBeenCalledTimes(1)
    expect(submitMock).toHaveBeenCalledTimes(1)
  })
})

describe('useRouteEditor — H1 非 admin knownReceivers', () => {
  it('knownReceivers 由 notifyChannelsApi.list() 批量派生（仅已启用渠道的 receiver_name），不调用 admin getReceiverSnippet', async () => {
    listMock.mockResolvedValue(
      channels([
        channel({ id: '1', name: 'A', enabled: true, receiver_name: 'recv-a' }),
        channel({ id: '2', name: 'B', enabled: false, receiver_name: 'recv-b' }),
        channel({ id: '3', name: 'C', enabled: true, receiver_name: 'recv-c' }),
      ]),
    )
    const { result } = renderHook(() => useRouteEditor({}))

    await waitFor(() => expect(result.current.knownReceivers).toEqual(['recv-a', 'recv-c']))
    // 同一次请求顺带建「receiver → 渠道名」映射（供 UI 把 notify-N 显示成渠道名）
    await waitFor(() =>
      expect(result.current.receiverChannelNames).toEqual({ 'recv-a': 'A', 'recv-c': 'C' }),
    )
    // 批量、单次请求，而非逐渠道 N+1
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('list 取数失败降级为空集合（不阻断，仅无法判定悬空）', async () => {
    listMock.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useRouteEditor({}))

    await waitFor(() => expect(result.current.knownReceivers).toEqual([]))
    expect(result.current.receiverChannelNames).toEqual({})
  })
})

/**
 * 2026-10-08 实测阻断回归：knownReceivers 此前只取「平台物化名」，把用户手写在
 * receivers: 段里的 receiver 判为悬空。实测生效配置里手写 `feishu` 与平台 `notify-1`
 * 共存，而根路由 + 4 条子路由全部引用 `feishu` → 5 个节点全命中 receiver_dangling，
 * 页面既不能保存也不能新建（死锁）。修复后 knownReceivers = 文件声明名 ∪ 平台物化名。
 */
describe('useRouteEditor — 接收人可达集合口径（2026-10-08 阻断修复）', () => {
  it('手写 receiver 出现在 declared_receivers 中时不再被判悬空（实测 feishu 场景）', async () => {
    // 平台物化名：渠道名全中文 → sanitize 为空 → 回落 notify-1
    listMock.mockResolvedValue(channels([channel({ id: '1', name: '腾讯云边缘域-飞书', enabled: true, receiver_name: 'notify-1' })]))
    const sourceItems = [
      readNode({ id: 'root', parent_id: '', receiver: 'feishu', locked: true }),
      ...['0', '1', '2', '3'].map((i) =>
        readNode({ id: `root/${i}`, parent_id: 'root', order: Number(i), receiver: 'feishu' }),
      ),
    ]
    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, declaredReceivers: ['feishu', 'notify-1'] }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.tree.length).toBe(5))

    await waitFor(() => expect(result.current.knownReceivers).toEqual(expect.arrayContaining(['feishu', 'notify-1'])))
    // 核心断言：引用手写 feishu 的 5 个节点全部不判悬空 → 无阻断项
    expect(result.current.blocking).toHaveLength(0)

    const ok = await act(async () => result.current.save())
    expect(ok).toBe(true)
    expect(submitMock).toHaveBeenCalledTimes(1)
  })

  it('未在文件 receivers: 段声明、也不在平台物化名中的引用仍判悬空（校验不被放宽成摆设）', async () => {
    listMock.mockResolvedValue(channels([channel({ id: '1', name: 'A', enabled: true, receiver_name: 'notify-1' })]))
    const sourceItems = [readNode({ id: 'root', parent_id: '', receiver: 'ghost', locked: true })]
    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, declaredReceivers: ['notify-1'] }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.blocking.length).toBeGreaterThan(0))
    expect(result.current.blocking[0].code).toBe('receiver_dangling')

    const ok = await act(async () => result.current.save())
    expect(ok).toBe(false)
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('平台已启用但配置尚未重新生成（物化名不在文件中）也算可达，不误判悬空', async () => {
    listMock.mockResolvedValue(channels([channel({ id: '1', name: 'A', enabled: true, receiver_name: 'notify-9' })]))
    const sourceItems = [readNode({ id: 'root', parent_id: '', receiver: 'notify-9', locked: true })]
    const { result } = renderHook(() => useRouteEditor({ sourceItems, declaredReceivers: [] }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.knownReceivers).toEqual(['notify-9']))
    expect(result.current.blocking).toHaveLength(0)
  })
})

/**
 * 2026-10-08 实测阻断回归：页面「新建路由规则」/「保存并提交变更」都是
 * `disabled={!editing}`，而 importState 此前恒从 'empty' 起步 ⇒ 两个主按钮首屏恒灰。
 * 修复为：只读树加载完成（ready）且解析成功 → 自动导入，首屏即可编辑。
 */
describe('useRouteEditor — 首屏自动导入（2026-10-08 按钮恒灰修复）', () => {
  const sourceItems = [
    readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true }),
    readNode({ id: 'root/0', parent_id: 'root', order: 0, receiver: 'recv-a' }),
  ]

  it('ready=true 且解析成功 → 自动进入 imported 编辑态（无需用户先点导入）', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems, ready: true }))

    await waitFor(() => expect(result.current.importState).toBe('imported'))
    expect(result.current.tree.length).toBe(2)
  })

  it('ready=false → 不自动导入，保持 empty（避免先闪一棵空白树）', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems, ready: false }))

    await waitFor(() => expect(result.current.importState).toBe('empty'))
    expect(result.current.tree).toHaveLength(0)
  })

  it('ready=true 但解析失败 → 不自动导入（降级事实须让用户知晓，由显式点击走部分导入）', async () => {
    const { result } = renderHook(() =>
      useRouteEditor({ ready: true, parseError: 'routes 不是列表，无法解析子路由' }),
    )

    await waitFor(() => expect(result.current.importState).toBe('empty'))
    expect(result.current.tree).toHaveLength(0)
  })

  it('自动导入只发生一次：sourceItems 后续变化不重置用户正在进行的编辑', async () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: RouteNode[] }) => useRouteEditor({ sourceItems: items, ready: true }),
      { initialProps: { items: sourceItems } },
    )
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    // 用户新增一条（模拟正在编辑）
    act(() => {
      result.current.upsert({ ...blankRouteNode('root/0', 'root'), receiver: 'recv-a' })
    })
    expect(result.current.tree.length).toBe(2)

    // 只读树随后变化（如 reload）→ 不得把用户的编辑冲掉
    const changed = [...sourceItems, readNode({ id: 'root/1', parent_id: 'root', order: 1, receiver: 'recv-b' })]
    rerender({ items: changed })
    await waitFor(() => expect(result.current.tree.length).toBe(2))
  })

  it('重新载入（有未保存编辑）先经二次确认；取消则保留编辑，确认则丢弃并重载', async () => {
    const confirmReload = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, ready: true, confirmReload }),
    )
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    act(() => {
      result.current.upsert({ ...blankRouteNode('root/0', 'root'), receiver: 'edited-by-user' })
    })
    expect(result.current.tree.length).toBe(2)

    // 取消：编辑保留
    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(confirmReload).toHaveBeenCalledTimes(1))
    expect(result.current.tree.length).toBe(2)
    expect(result.current.tree.some((n) => n.receiver === 'edited-by-user')).toBe(true)

    // 确认：丢弃用户编辑，恢复为只读树内容
    confirmReload.mockResolvedValue(true)
    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.tree.some((n) => n.receiver === 'edited-by-user')).toBe(false))
    expect(result.current.tree.length).toBe(2)
  })

  it('reset（放弃编辑）后可再次自动导入，不退回「按钮恒灰」', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems, ready: true }))
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    act(() => {
      result.current.reset()
    })
    expect(result.current.importState).toBe('empty')

    // 重新触发自动导入门控（模拟 reload 后 ready 再次为 true 的等价路径）
    await waitFor(() => expect(result.current.importState).toBe('empty'))
    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))
  })
})

describe('useRouteEditor — H4 部分导入保存护栏', () => {
  it('部分导入：保存前弹二次确认，取消则中止保存（submit 不调用、返回 false）', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useRouteEditor({ confirmPartialImport: confirm }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('partial'))

    // 给根路由一个兜底接收人，使预检（非 guardrail 部分）通过
    act(() => {
      result.current.upsert({ ...blankRouteNode('root', ''), receiver: 'default' })
    })
    await waitFor(() => expect(result.current.blocking).toHaveLength(0))

    const ok = await act(async () => result.current.save())

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(ok).toBe(false)
    expect(submitMock).not.toHaveBeenCalled()
  })

  it('部分导入：用户确认后真正提交（submit 调用、返回 true）', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useRouteEditor({ confirmPartialImport: confirm }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('partial'))

    act(() => {
      result.current.upsert({ ...blankRouteNode('root', ''), receiver: 'default' })
    })
    await waitFor(() => expect(result.current.blocking).toHaveLength(0))

    const ok = await act(async () => result.current.save())

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(ok).toBe(true)
    expect(submitMock).toHaveBeenCalledTimes(1)
  })

  it('完整导入（imported）：保存不弹 H4 二次确认，直接提交', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const sourceItems = [readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true })]
    // 保存链路的合并基由 save() 内部 `GET /config/current` 取（见 useRoutes.ts L476-482），
    // 不再从 options 注入 effectiveYaml；beforeEach 已 mock getCurrent 返回 EFFECTIVE_YAML。
    const { result } = renderHook(() => useRouteEditor({ sourceItems, confirmPartialImport: confirm }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    await act(async () => result.current.save())

    expect(confirm).not.toHaveBeenCalled()
    expect(submitMock).toHaveBeenCalledTimes(1)
  })
})
