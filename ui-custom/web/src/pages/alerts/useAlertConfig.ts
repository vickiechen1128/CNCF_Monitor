/**
 * Module_08 告警配置页数据 Hook（「文件挂载」决策 59/60）。
 * 权威契约：docs/05-execution-records/module-08/api-contract-snapshot.md（§3）。
 * 消费 GET /config/current、GET /config/versions；submit / remount 直接走契约 API。
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足；提交挂载后刷新当前生效与版本列表。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { alertmanagerConfigApi } from '../../api/alertmanager'
import type {
  AlertmanagerConfigVersion,
  AlertmanagerConfigVersionListItem,
  PaginatedItems,
} from '../../types/alertmanager'

export interface UseAlertConfigResult {
  current: AlertmanagerConfigVersion | null
  versions: AlertmanagerConfigVersionListItem[]
  total: number
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
  /** 提交挂载：校验失败时抛出，由调用方按行级错误展示；成功后触发刷新 */
  submit: (content: string, uploaded_by?: string) => Promise<AlertmanagerConfigVersion>
  /** 重新挂载历史版本（P0 回滚）：再次走校验 + M09 变更单 */
  remount: (id: string, uploaded_by?: string) => Promise<AlertmanagerConfigVersion>
}

const EMPTY_PAGE: PaginatedItems<AlertmanagerConfigVersionListItem> = { items: [], total: 0 }

export function useAlertConfig(): UseAlertConfigResult {
  const [current, setCurrent] = useState<AlertmanagerConfigVersion | null>(null)
  const [versions, setVersions] = useState<PaginatedItems<AlertmanagerConfigVersionListItem>>(EMPTY_PAGE)
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
      const [cur, ver] = await Promise.all([
        alertmanagerConfigApi.getCurrent(),
        alertmanagerConfigApi.getVersions({ page: 1, page_size: 20 }),
      ])
      setCurrent(cur.data)
      setVersions(ver.data)
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
    // 数据请求回调内在异步完成后才 setState；初始/刷新加载态由 useState(reload) 触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const submit = useCallback(async (content: string, uploaded_by?: string): Promise<AlertmanagerConfigVersion> => {
    const res = await alertmanagerConfigApi.submit({ content, uploaded_by })
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  const remount = useCallback(async (id: string, uploaded_by?: string): Promise<AlertmanagerConfigVersion> => {
    const res = await alertmanagerConfigApi.remount(id, uploaded_by ? { uploaded_by } : {})
    setRefresh((r) => r + 1)
    return res.data
  }, [])

  return { current, versions: versions.items, total: versions.total, loading, error, permissionDenied, reload, submit, remount }
}