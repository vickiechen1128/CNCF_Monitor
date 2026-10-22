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

const saveRoutesMock = vi.fn()
const getRoutesMock = vi.fn()
const listMock = vi.fn()

vi.mock('../../api/alertmanager', () => ({
  alertmanagerRoutesApi: {
    getRoutes: (...a: unknown[]) => getRoutesMock(...a),
    saveRoutes: (...a: unknown[]) => saveRoutesMock(...a),
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

beforeEach(() => {
  vi.clearAllMocks()
  saveRoutesMock.mockResolvedValue({
    status: 'success',
    data: {
      version: { id: 'v1', content: '', checksum: 'abc', status: 'applied' },
      change_no: 'CHG-20261022-001',
    },
  })
  listMock.mockResolvedValue(channels([]))
})

describe('useRouteEditor — 保存只提交结构化路由树', () => {
  it('save 发送 base_checksum + route_tree，不发送整份 YAML', async () => {
    listMock.mockResolvedValue(
      channels([channel({ id: '1', name: 'A', receiver_name: 'platform-recv-1' })]),
    )
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
    const onSaved = vi.fn()
    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, baseChecksum: 'base-sha256', onSaved }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.tree.length).toBe(2))
    // 已启用渠道 receiver 进入合法集合
    await waitFor(() => expect(result.current.knownReceivers).toContain('platform-recv-1'))

    const ok = await act(async () => result.current.save())

    expect(ok).toBe(true)
    expect(saveRoutesMock).toHaveBeenCalledTimes(1)
    const payload = saveRoutesMock.mock.calls[0][0] as {
      base_checksum: string
      route_tree: { receiver: string; matchers: unknown[] }[]
      content?: string
    }
    expect(payload.base_checksum).toBe('base-sha256')
    expect(payload.route_tree).toHaveLength(2)
    expect(payload.route_tree[1].receiver).toBe('platform-recv-1')
    expect(payload.route_tree[1].matchers).toHaveLength(1)
    expect(payload.content).toBeUndefined()
    expect(onSaved).toHaveBeenCalled()
    expect(result.current.saveResult?.message).toContain('CHG-20261022-001')
  })

  it('base_checksum 冲突（409）时保存失败并展示后端文案', async () => {
    saveRoutesMock.mockRejectedValueOnce(new Error('路由配置已被更新，请重新载入后再保存'))
    const sourceItems = [readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true })]
    const { result } = renderHook(() => useRouteEditor({ sourceItems, baseChecksum: 'stale' }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.tree.length).toBe(1))

    const ok = await act(async () => result.current.save())
    expect(ok).toBe(false)
    expect(result.current.saveResult?.ok).toBe(false)
    expect(result.current.saveResult?.message).toContain('已被更新')
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

    await waitFor(() => expect(result.current.knownReceivers).toEqual(['default', 'recv-a', 'recv-c']))
    // 同一次请求顺带建「receiver → 渠道名」映射（供 UI 把 notify-N 显示成渠道名）
    await waitFor(() =>
      expect(result.current.receiverChannelNames).toEqual({ 'recv-a': 'A', 'recv-c': 'C' }),
    )
    // 批量、单次请求，而非逐渠道 N+1
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('list 取数失败降级：仅保留平台内置默认接收人（不阻断，仅无法判定渠道悬空）', async () => {
    listMock.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useRouteEditor({}))

    await waitFor(() => expect(result.current.knownReceivers).toEqual(['default']))
    expect(result.current.receiverChannelNames).toEqual({})
  })
})

/**
 * 2026-10-22 交互调整：页面默认只读，只有用户点「编辑路由」才把当前树载入编辑区。
 */
describe('useRouteEditor — 显式进入编辑态', () => {
  const sourceItems = [
    readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true }),
    readNode({ id: 'root/0', parent_id: 'root', order: 0, receiver: 'recv-a' }),
  ]

  it('初始为 empty（只读态），不自动载入编辑区', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems }))

    await waitFor(() => expect(result.current.importState).toBe('empty'))
    expect(result.current.tree).toHaveLength(0)
  })

  it('importFromCurrent → imported，载入当前只读树', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))
    expect(result.current.tree.length).toBe(2)
  })

  it('解析失败 → importFromCurrent 给空白树 + partial 提示（根路由预填 default）', async () => {
    const { result } = renderHook(() =>
      useRouteEditor({ parseError: 'routes 不是列表，无法解析子路由' }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('partial'))
    expect(result.current.tree).toHaveLength(1)
    expect(result.current.tree[0].receiver).toBe('default')
  })

  it('载入后 sourceItems 变化不重置用户正在进行的编辑', async () => {
    const { result, rerender } = renderHook(
      ({ items }: { items: RouteNode[] }) => useRouteEditor({ sourceItems: items }),
      { initialProps: { items: sourceItems } },
    )
    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    act(() => {
      result.current.upsert({ ...blankRouteNode('root/0', 'root'), receiver: 'recv-a' })
    })
    expect(result.current.tree.length).toBe(2)

    const changed = [...sourceItems, readNode({ id: 'root/1', parent_id: 'root', order: 1, receiver: 'recv-b' })]
    rerender({ items: changed })
    await waitFor(() => expect(result.current.tree.length).toBe(2))
  })

  it('dirty：载入后为 false，修改后为 true，reset 后回到 false', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems }))
    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))
    expect(result.current.dirty).toBe(false)

    act(() => {
      result.current.upsert({ ...blankRouteNode('root/0', 'root'), receiver: 'default' })
    })
    expect(result.current.dirty).toBe(true)

    act(() => {
      result.current.reset()
    })
    expect(result.current.dirty).toBe(false)
  })

  it('reset（放弃编辑）回到 empty，可再次显式载入', async () => {
    const { result } = renderHook(() => useRouteEditor({ sourceItems }))
    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    act(() => {
      result.current.reset()
    })
    expect(result.current.importState).toBe('empty')

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))
  })
})

describe('useRouteEditor — H4 配置无法完整解析时的保存护栏', () => {
  it('解析失败：保存前弹二次确认，取消则中止保存（saveRoutes 不调用、返回 false）', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() =>
      useRouteEditor({ parseError: 'route 段无法完整解析', confirmPartialImport: confirm }),
    )

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
    expect(saveRoutesMock).not.toHaveBeenCalled()
  })

  it('解析失败：用户确认后真正提交（saveRoutes 调用、返回 true）', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() =>
      useRouteEditor({ parseError: 'route 段无法完整解析', confirmPartialImport: confirm }),
    )

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
    expect(saveRoutesMock).toHaveBeenCalledTimes(1)
  })

  it('完整导入（imported）：保存不弹 H4 二次确认，直接提交', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const sourceItems = [readNode({ id: 'root', parent_id: '', receiver: 'default', locked: true })]
    const { result } = renderHook(() => useRouteEditor({ sourceItems, confirmPartialImport: confirm }))

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    await act(async () => result.current.save())

    expect(confirm).not.toHaveBeenCalled()
    expect(saveRoutesMock).toHaveBeenCalledTimes(1)
  })
})
