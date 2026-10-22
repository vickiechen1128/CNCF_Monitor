/**
 * Module_08 通知模板管理页数据 Hook（2026-10-22 模板改为可编辑实体）。
 * 消费 GET / GET :id / POST / PUT / DELETE /api/v2/platform/alertmanager/notify-templates。
 * 模板不再有版本历史 / remount；列表不含 content，详情按需拉取。
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { notifyTemplatesApi } from '../../api/alertmanager'
import type {
  NotifyTemplate,
  NotifyTemplateDetail,
  SubmitNotifyTemplatePayload,
} from '../../types/alertmanager'

export interface UseNotifyTemplatesResult {
  templates: NotifyTemplate[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
  /** 新建自定义模板：服务端校验失败（400）抛出，由抽屉按行级错误展示 */
  create: (payload: SubmitNotifyTemplatePayload) => Promise<NotifyTemplateDetail>
  /** 编辑自定义模板（原地更新，不新增版本） */
  update: (id: string, payload: SubmitNotifyTemplatePayload) => Promise<NotifyTemplateDetail>
  /** 删除自定义模板（内置 / 被绑定模板后端拒绝） */
  remove: (id: string) => Promise<void>
  /** 拉取模板详情（含 content），供查看 / 编辑 / 复制 */
  getDetail: (id: string) => Promise<NotifyTemplateDetail>
}

export function useNotifyTemplates(): UseNotifyTemplatesResult {
  const [templates, setTemplates] = useState<NotifyTemplate[]>([])
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

  const getDetail = useCallback(async (id: string): Promise<NotifyTemplateDetail> => {
    const res = await notifyTemplatesApi.get(id)
    return res.data
  }, [])

  const create = useCallback(async (payload: SubmitNotifyTemplatePayload): Promise<NotifyTemplateDetail> => {
    const res = await notifyTemplatesApi.create(payload)
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  const update = useCallback(
    async (id: string, payload: SubmitNotifyTemplatePayload): Promise<NotifyTemplateDetail> => {
      const res = await notifyTemplatesApi.update(id, payload)
      setRefresh((r) => r + 1)
      return res.data
    },
    [],
  )

  const remove = useCallback(async (id: string): Promise<void> => {
    await notifyTemplatesApi.remove(id)
    setRefresh((r) => r + 1)
  }, [])

  return { templates, loading, error, permissionDenied, reload, create, update, remove, getDetail }
}
