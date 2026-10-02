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
    // 批量、单次请求，而非逐渠道 N+1
    expect(listMock).toHaveBeenCalledTimes(1)
  })

  it('list 取数失败降级为空集合（不阻断，仅无法判定悬空）', async () => {
    listMock.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => useRouteEditor({}))

    await waitFor(() => expect(result.current.knownReceivers).toEqual([]))
  })
})

describe('useRouteEditor — H4 部分导入保存护栏', () => {
  it('部分导入：保存前弹二次确认，取消则中止保存（submit 不调用、返回 false）', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useRouteEditor({ effectiveYaml: '', confirmPartialImport: confirm }))

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
    const { result } = renderHook(() => useRouteEditor({ effectiveYaml: '', confirmPartialImport: confirm }))

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
    const { result } = renderHook(() =>
      useRouteEditor({ sourceItems, effectiveYaml: EFFECTIVE_YAML, confirmPartialImport: confirm }),
    )

    act(() => {
      result.current.importFromCurrent()
    })
    await waitFor(() => expect(result.current.importState).toBe('imported'))

    await act(async () => result.current.save())

    expect(confirm).not.toHaveBeenCalled()
    expect(submitMock).toHaveBeenCalledTimes(1)
  })
})
