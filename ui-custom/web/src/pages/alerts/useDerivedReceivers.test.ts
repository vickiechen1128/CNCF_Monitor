/**
 * 「派生预览」数据 Hook 测试（B 路线 / 决策 74）。
 * 覆盖：仅已启用渠道参与派生 + 顺序取片段 / 无启用渠道不请求 / 片段 403 降级 /
 * 列表 403 降级 / 列表其它错误 / 令牌未配置透传。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../../api/client'
import type { ApiResponse } from '../../types/api'
import type { NotifyChannel, ReceiverSnippetData } from '../../types/alertmanager'
import { useDerivedReceivers } from './useDerivedReceivers'

const listMock = vi.fn()
const snippetMock = vi.fn()

vi.mock('../../api/alertmanager', () => ({
  notifyChannelsApi: {
    list: (...a: unknown[]) => listMock(...a),
    getReceiverSnippet: (...a: unknown[]) => snippetMock(...a),
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
    created_at: '2026-09-28T10:00:00Z',
    ...over,
  }
}

function snippet(receiverName: string, over: Partial<ReceiverSnippetData> = {}): ApiResponse<ReceiverSnippetData> {
  return {
    status: 'success',
    data: {
      receiver_name: receiverName,
      url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1',
      snippet: `  - name: ${receiverName}\n`,
      token_configured: true,
      ...over,
    },
  }
}

function channels(items: NotifyChannel[]): ApiResponse<{ items: NotifyChannel[] }> {
  return { status: 'success', data: { items } }
}

describe('useDerivedReceivers（派生预览数据）', () => {
  beforeEach(() => {
    listMock.mockReset()
    snippetMock.mockReset()
  })

  it('仅已启用渠道参与派生，且顺序拉取片段', async () => {
    listMock.mockResolvedValue(
      channels([
        channel({ id: '1', name: 'A', enabled: true }),
        channel({ id: '2', name: 'B', enabled: false }),
        channel({ id: '3', name: 'C', enabled: true }),
      ]),
    )
    snippetMock.mockImplementation((id: string) => Promise.resolve(snippet(`recv-${id}`)))

    const { result } = renderHook(() => useDerivedReceivers())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(snippetMock).toHaveBeenCalledTimes(2)
    expect(snippetMock.mock.calls.map((c) => c[0])).toEqual(['1', '3'])
    expect(result.current.rows.map((r) => r.receiverName)).toEqual(['recv-1', 'recv-3'])
    expect(result.current.permissionDenied).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('无已启用渠道时不请求片段，返回空列表', async () => {
    listMock.mockResolvedValue(channels([channel({ enabled: false })]))
    const { result } = renderHook(() => useDerivedReceivers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(snippetMock).not.toHaveBeenCalled()
    expect(result.current.rows).toEqual([])
  })

  it('片段接口 403 时降级为无权限，不抛错', async () => {
    listMock.mockResolvedValue(channels([channel({ id: '1' })]))
    snippetMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))

    const { result } = renderHook(() => useDerivedReceivers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.permissionDenied).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('渠道列表 403 时降级为无权限', async () => {
    listMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))
    const { result } = renderHook(() => useDerivedReceivers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.permissionDenied).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('渠道列表其它错误时返回错误态', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useDerivedReceivers())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('boom')
    expect(result.current.permissionDenied).toBe(false)
  })

  it('令牌未配置时透传 tokenConfigured=false', async () => {
    listMock.mockResolvedValue(channels([channel({ id: '1' })]))
    snippetMock.mockResolvedValue(snippet('recv', { token_configured: false }))
    const { result } = renderHook(() => useDerivedReceivers())
    await waitFor(() => expect(result.current.rows.length).toBe(1))
    expect(result.current.rows[0].tokenConfigured).toBe(false)
  })
})