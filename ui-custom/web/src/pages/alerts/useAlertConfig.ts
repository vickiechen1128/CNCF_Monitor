/**
 * Module_08 告警配置页数据 Hook（v3：当前生效 + 只读历史 + 最近 reload）。
 * 权威契约：docs/05-execution-records/rewrite/v2.0/modules/module-08/api-contract-snapshot-v3.md。
 * 消费 GET /config、GET /config/versions、GET /config/reload-logs。
 * 覆盖：加载 / 空态 / 接口错误 / 权限不足。
 *
 * 2026-10-22：本页删除「导入整份配置文件」能力（路由在「路由规则」页直接配置），
 * 故 Hook 同步移除 submit——写路径统一走路由树保存。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { alertmanagerConfigApi } from '../../api/alertmanager'
import type {
  AlertmanagerConfigVersion,
  AlertmanagerConfigVersionListItem,
  PaginatedItems,
} from '../../types/alertmanager'

/** 最近一次 reload 尝试（只读展示；失败不阻断页面）。 */
export interface LastReload {
  id: string
  status: string
  trigger: string
  started_at: string
  duration_ms: number
  error?: string
}

export interface UseAlertConfigResult {
  current: AlertmanagerConfigVersion | null
  /** 最近一次 reload 记录；无记录 / 无权限时为 null */
  lastReload: LastReload | null
  versions: AlertmanagerConfigVersionListItem[]
  total: number
  loading: boolean
  error: string | null
  permissionDenied: boolean
  /** 服务端分页参数（契约 §1.4：page/page_size，上限 100），版本历史超 20 条可翻页/回滚 */
  page: number
  pageSize: number
  onPageSizeChange: (page: number, pageSize: number) => void
  reload: () => void
}

const EMPTY_PAGE: PaginatedItems<AlertmanagerConfigVersionListItem> = { items: [], total: 0 }

export function useAlertConfig(): UseAlertConfigResult {
  const [current, setCurrent] = useState<AlertmanagerConfigVersion | null>(null)
  const [lastReload, setLastReload] = useState<LastReload | null>(null)
  const [versions, setVersions] = useState<PaginatedItems<AlertmanagerConfigVersionListItem>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const load = useCallback(async () => {
    try {
      const [cur, ver, logs] = await Promise.all([
        alertmanagerConfigApi.getCurrent(),
        alertmanagerConfigApi.getVersions({ page, page_size: pageSize }),
        alertmanagerConfigApi.getReloadLogs({ page: 1, page_size: 1 }).catch(() => null),
      ])
      setCurrent(cur.data)
      setVersions(ver.data)
      setLastReload(logs?.data?.items?.[0] ?? null)
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
  }, [page, pageSize])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；初始/刷新/翻页加载态由 state 触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const onPageSizeChange = useCallback((p: number, pz: number) => {
    setPage(p)
    setPageSize(pz)
    setLoading(true)
  }, [])

  return {
    current,
    lastReload,
    versions: versions.items,
    total: versions.total,
    page,
    pageSize,
    onPageSizeChange,
    loading,
    error,
    permissionDenied,
    reload,
  }
}