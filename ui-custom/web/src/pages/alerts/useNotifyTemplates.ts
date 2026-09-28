/**
 * Module_08 通知模板管理页数据 Hook（PL-3 通知渲染桥，2026-09-28）。
 * 契约权威：设计提案 §3.3（PL-3 端点尚未写入 api-contract-snapshot.md，待回写）。
 * 消费 GET / POST /api/v2/platform/alertmanager/notify-templates 与 POST .../{id}/remount；
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { notifyTemplatesApi } from '../../api/alertmanager'
import type { NotifyTemplate, SubmitNotifyTemplatePayload } from '../../types/alertmanager'

export interface UseNotifyTemplatesResult {
  templates: NotifyTemplate[]
  total: number
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
  /** 提交自定义模板：服务端校验失败（400）抛出，由抽屉按行级错误展示 */
  submit: (payload: SubmitNotifyTemplatePayload) => Promise<NotifyTemplate>
  /** 回滚：把该历史版本内容重新提交为新的留痕 */
  remount: (id: string, name: string) => Promise<NotifyTemplate>
}

export function useNotifyTemplates(): UseNotifyTemplatesResult {
  const [templates, setTemplates] = useState<NotifyTemplate[]>([])
  const [total, setTotal] = useState(0)
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
      const res = await notifyTemplatesApi.list()
      setTemplates(res.data?.items ?? [])
      setTotal(res.data?.total ?? 0)
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

  const submit = useCallback(async (payload: SubmitNotifyTemplatePayload): Promise<NotifyTemplate> => {
    const res = await notifyTemplatesApi.submit(payload)
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  const remount = useCallback(async (id: string, name: string): Promise<NotifyTemplate> => {
    const res = await notifyTemplatesApi.remount(id, name)
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  return { templates, total, loading, error, permissionDenied, reload, submit, remount }
}
