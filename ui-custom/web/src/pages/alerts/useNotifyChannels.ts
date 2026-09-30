/**
 * Module_08 通知渠道管理页数据 Hook（PL-3 通知渲染桥，2026-09-28）。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
 * 消费 GET / POST / PUT / DELETE /api/v2/platform/alertmanager/notify-channels；
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { notifyChannelsApi } from '../../api/alertmanager'
import type {
  CreateNotifyChannelPayload,
  NotifyChannel,
  UpdateNotifyChannelPayload,
} from '../../types/alertmanager'

export interface UseNotifyChannelsResult {
  channels: NotifyChannel[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
  /** 新建渠道：校验失败（400）抛出，由抽屉按字段映射展示 */
  create: (payload: CreateNotifyChannelPayload) => Promise<NotifyChannel>
  /** 更新渠道：仅传需修改字段，未传 webhook_url/secret 即保留原值 */
  update: (id: string, payload: UpdateNotifyChannelPayload) => Promise<NotifyChannel>
  /** 删除渠道：不存在抛出 not_found */
  remove: (id: string) => Promise<void>
}

export function useNotifyChannels(): UseNotifyChannelsResult {
  const [channels, setChannels] = useState<NotifyChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [refresh, setRefresh] = useState(0)

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await notifyChannelsApi.list()
      setChannels(res.data?.items ?? [])
      setError(null)
      setPermissionDenied(false)
    } catch (e) {
      if (isApiError(e) && e.code === 403) {
        setPermissionDenied(true)
      } else {
        setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；初始/刷新加载态由 state 触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const create = useCallback(async (payload: CreateNotifyChannelPayload): Promise<NotifyChannel> => {
    const res = await notifyChannelsApi.create(payload)
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  const update = useCallback(
    async (id: string, payload: UpdateNotifyChannelPayload): Promise<NotifyChannel> => {
      const res = await notifyChannelsApi.update(id, payload)
      setRefresh((r) => r + 1)
      return res.data
    },
    [],
  )

  const remove = useCallback(async (id: string): Promise<void> => {
    await notifyChannelsApi.remove(id)
    setRefresh((r) => r + 1)
  }, [])

  return { channels, loading, error, permissionDenied, reload, create, update, remove }
}