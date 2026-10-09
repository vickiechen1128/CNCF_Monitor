/**
 * 「默认接收人（根兜底）」数据 Hook 测试（T08-F8，决策 113 口径 C）。
 * 覆盖：默认未设定 → 自动建议（auto_first_enabled） / 生效态（explicit） / 下拉选项（含首项「不接管」，
 * 仅已启用渠道，**只展示渠道名**——2026-10-08 起不再拼「（接收人 X)」） / 保存（null=关闭接管、渠道 id） /
 * 400 错误透传 / 加载失败错误态。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../../api/client'
import type { ApiResponse } from '../../types/api'
import type { NotifyChannel, ReceiverSnippetData, RouteSetting } from '../../types/alertmanager'
import { useRouteSetting, ROUTE_SETTING_NONE_LABEL, NONE_RECEIVER_VALUE } from './useRouteSetting'

const getMock = vi.fn()
const updateMock = vi.fn()
const listMock = vi.fn()
const snippetMock = vi.fn()

vi.mock('../../api/alertmanager', () => ({
  routeSettingApi: {
    get: (...a: unknown[]) => getMock(...a),
    update: (...a: unknown[]) => updateMock(...a),
  },
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
    created_at: '2026-09-30T10:00:00Z',
    ...over,
  }
}

function channels(items: NotifyChannel[]): ApiResponse<{ items: NotifyChannel[] }> {
  return { status: 'success', data: { items } }
}

function snippet(receiverName: string): ApiResponse<ReceiverSnippetData> {
  return {
    status: 'success',
    data: {
      receiver_name: receiverName,
      url: 'http://127.0.0.1:18081/api/v1/webhooks/notify?channel=1',
      snippet: `  - name: ${receiverName}\n`,
      token_configured: true,
    },
  }
}

function setting(over: Partial<RouteSetting> = {}): ApiResponse<RouteSetting> {
  return {
    status: 'success',
    data: {
      enabled: false,
      default_receiver_channel_id: null,
      effective_receiver_name: '',
      effective_source: 'none',
      ...over,
    },
  }
}

describe('useRouteSetting（默认接收人 / 根兜底）', () => {
  beforeEach(() => {
    getMock.mockReset()
    updateMock.mockReset()
    listMock.mockReset()
    snippetMock.mockReset()
  })

  it('默认未设定但有已启用渠道：派生为 auto_first_enabled 建议，下拉首项为「不接管」且仅含已启用渠道', async () => {
    getMock.mockResolvedValue(
      setting({ enabled: false, effective_source: 'auto_first_enabled', effective_receiver_name: 'sre-feishu-qun' }),
    )
    listMock.mockResolvedValue(
      channels([
        channel({ id: '1', name: 'SRE 飞书群', enabled: true }),
        channel({ id: '2', name: '停用渠道', enabled: false }),
      ]),
    )
    snippetMock.mockResolvedValue(snippet('sre-feishu-qun'))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.setting?.effective_source).toBe('auto_first_enabled')
    expect(result.current.setting?.enabled).toBe(false)
    // 首项恒为「不接管」= NONE_RECEIVER_VALUE 哨兵（-1，避免 antd Select 空值告警）
    expect(result.current.options[0]).toEqual({ value: NONE_RECEIVER_VALUE, label: ROUTE_SETTING_NONE_LABEL })
    // 仅已启用渠道进入选项
    expect(result.current.options).toHaveLength(2)
    // 2026-10-08：选项**只展示渠道名**。receiver 名是平台内部标识（`sre-feishu-qun`），
    //   对「我选了哪个渠道」无帮助，混进选项像技术串；实测用户正是因此看不出下拉框与
    //   兜底策略是同一个东西。
    expect(result.current.options[1]).toEqual({ value: 1, label: 'SRE 飞书群' })
    expect(result.current.error).toBeNull()
    // 展示去掉内部标识后，逐渠道调 admin-only 的片段接口已无消费方 → N+1 一并摘除
    expect(snippetMock).not.toHaveBeenCalled()
  })

  it('已设定默认接收人且渠道可用：派生为 explicit（平台接管中）', async () => {
    getMock.mockResolvedValue(
      setting({
        enabled: true,
        default_receiver_channel_id: 7,
        effective_source: 'explicit',
        effective_receiver_name: 'sre-qun',
      }),
    )
    listMock.mockResolvedValue(channels([channel({ id: '7', name: 'SRE 群' })]))
    snippetMock.mockResolvedValue(snippet('sre-qun'))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.setting?.enabled).toBe(true)
    expect(result.current.setting?.default_receiver_channel_id).toBe(7)
    expect(result.current.setting?.effective_receiver_name).toBe('sre-qun')
  })

  it('渠道列表取数失败：整体降级为错误态（设定与选项一并不可用）', async () => {
    // 2026-10-08：原用例覆盖「片段接口 403 → 降级为渠道名」。选项改为只展示渠道名后
    //   片段接口已不再被调用（连同 N+1 一并摘除），故降级面改为「渠道列表取数失败」。
    // 记录**既有行为**：list 与 get 在同一个 Promise.all 里，list 失败 → 整体 reject →
    //   setting 被清空、error 透传。（「设定已取到却因列表失败被丢弃」是可改进点，
    //   但那是独立议题，本轮不改动行为，只如实断言现状。）
    getMock.mockResolvedValue(setting({ effective_source: 'auto_first_enabled', effective_receiver_name: 'x' }))
    listMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.setting).toBeNull()
    expect(result.current.error).toBe('forbidden')
    // 片段接口确实未被调用（N+1 已摘除的旁证）
    expect(snippetMock).not.toHaveBeenCalled()
  })

  it('关闭接管：save(null) 以 default_receiver_channel_id=null 写入（护栏③），并更新生效态', async () => {
    getMock.mockResolvedValue(
      setting({ enabled: true, default_receiver_channel_id: 1, effective_source: 'explicit', effective_receiver_name: 'a' }),
    )
    listMock.mockResolvedValue(channels([channel({ id: '1', name: 'A' })]))
    snippetMock.mockResolvedValue(snippet('a'))
    updateMock.mockResolvedValue(setting({ effective_source: 'none', effective_receiver_name: '' }))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await result.current.save(null)
    expect(updateMock).toHaveBeenCalledWith({ default_receiver_channel_id: null })
    await waitFor(() => expect(result.current.setting?.enabled).toBe(false))
    expect(result.current.saving).toBe(false)
  })

  it('选定默认接收人：save(id) 以该渠道 id 写入并更新生效态', async () => {
    getMock.mockResolvedValue(setting())
    listMock.mockResolvedValue(channels([channel({ id: '5', name: 'SRE' })]))
    snippetMock.mockResolvedValue(snippet('sre'))
    updateMock.mockResolvedValue(
      setting({ enabled: true, default_receiver_channel_id: 5, effective_source: 'explicit', effective_receiver_name: 'sre' }),
    )

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const updated = await result.current.save(5)
    expect(updateMock).toHaveBeenCalledWith({ default_receiver_channel_id: 5 })
    expect(updated.enabled).toBe(true)
    await waitFor(() => expect(result.current.setting?.default_receiver_channel_id).toBe(5))
  })

  it('T08-F12：保存时透传 mode（handwritten/managed），后端持久化后回读', async () => {
    getMock.mockResolvedValue(setting())
    listMock.mockResolvedValue(channels([channel({ id: '5', name: 'SRE' })]))
    snippetMock.mockResolvedValue(snippet('sre'))
    updateMock.mockResolvedValue(setting({ mode: 'managed', effective_source: 'none', effective_receiver_name: '' }))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const updated = await result.current.save(5, 'managed')
    expect(updateMock).toHaveBeenCalledWith({ default_receiver_channel_id: 5, mode: 'managed' })
    expect(updated.mode).toBe('managed')
    await waitFor(() => expect(result.current.setting?.mode).toBe('managed'))
  })

  it('保存失败（400 渠道不存在 / 未启用）向上抛出并透传错误消息，由调用方提示', async () => {
    getMock.mockResolvedValue(setting())
    listMock.mockResolvedValue(channels([channel({ id: '9', name: 'X' })]))
    snippetMock.mockResolvedValue(snippet('x'))
    updateMock.mockRejectedValue(new ApiError('指定的通知渠道不存在或未启用', 400, 'bad_request'))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(result.current.save(9)).rejects.toThrow('指定的通知渠道不存在或未启用')
    // 保存失败不改动已加载的设定
    expect(result.current.setting?.default_receiver_channel_id).toBeNull()
    expect(result.current.saving).toBe(false)
  })

  it('设定加载失败：返回错误态且 setting 为 null', async () => {
    getMock.mockRejectedValue(new Error('backend unreachable'))
    listMock.mockResolvedValue(channels([]))

    const { result } = renderHook(() => useRouteSetting())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.setting).toBeNull()
    expect(result.current.error).toBe('backend unreachable')
  })
})