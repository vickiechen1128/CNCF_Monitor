/**
 * 告警状态页数据 Hook（Module_08 告警收敛与通知管理，双视图）。
 * useCurrentAlerts：当前告警（M08 历史告警事件表的未结三态 firing/silenced/inhibited，
 *   与历史告警、首页四格同源；status=open 为服务端分组别名）；
 * useOpenAlertStats：未结三态计数（当前告警页三张统计卡，随网域筛选）；
 * usePromAlerts：Prometheus 规则评估结果（M02 代理 /api/v1/alerts，firing/pending）。
 * network_domain 为 UX 筛选透传（过滤由后端承担，前端不重复过滤）；
 * 授权过滤由服务端强制注入（决策 56，MVP 单租户恒通过）。
 * 状态矩阵覆盖：加载 / 空态 / 接口错误 / 权限不足（403）。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { alertStatusApi } from '../../api/alertmanager'
import { networkDomainApi } from '../../api/domain'
import type { AlertEventItem, AlertEventStatus, PromAlertItem } from '../../types/alertmanager'

/** 单视图状态（两视图共用形状） */
export interface AlertViewState<T> {
  items: T[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
}

/** 网域筛选下拉项（复用 M06 网域管理数据源，与 TargetStatusPage 同构） */
export interface DomainOption {
  id: string
  name: string
}

/** 当前告警的未结三态（event 表停止更新前始终属于这三态之一） */
export type OpenAlertStatus = Extract<AlertEventStatus, 'firing' | 'silenced' | 'inhibited'>

/** 当前告警状态筛选：全部 = 未结三态并集（服务端 status=open） */
export type CurrentAlertStatusFilter = 'all' | OpenAlertStatus

export interface CurrentAlertsQuery {
  networkDomain: string
  status: CurrentAlertStatusFilter
  page: number
  pageSize: number
}

export interface CurrentAlertsResult {
  items: AlertEventItem[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: string | null
  permissionDenied: boolean
  reload: () => void
  setPage: (p: number) => void
  setPageSize: (ps: number) => void
}

export const CURRENT_ALERTS_PAGE_SIZE = 20

const MAX_PAGE_SIZE = 100

/** 当前告警查询参数：status=open 表示未结三态并集，与首页右栏同口径。 */
export function currentAlertParams(
  q: CurrentAlertsQuery,
  page: number,
  pageSize: number,
): Record<string, string | number | undefined> {
  const params: Record<string, string | number | undefined> = {
    page,
    page_size: pageSize,
    status: q.status === 'all' ? 'open' : q.status,
    sort: 'starts_at desc',
  }
  if (q.networkDomain && q.networkDomain !== 'all') params.network_domain = q.networkDomain
  return params
}

/** 当前告警拉取（event 表未结三态，服务端分页）。 */
export function useCurrentAlerts(q: CurrentAlertsQuery): CurrentAlertsResult {
  const [items, setItems] = useState<AlertEventItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPageState] = useState(q.page)
  const [pageSize, setPageSizeState] = useState(q.pageSize)
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

  const setPage = useCallback((p: number) => {
    setPageState(p)
    setLoading(true)
  }, [])

  const setPageSize = useCallback((ps: number) => {
    let next = ps
    if (next > MAX_PAGE_SIZE) next = MAX_PAGE_SIZE
    if (next < 1) next = CURRENT_ALERTS_PAGE_SIZE
    setPageSizeState(next)
    setPageState(1)
    setLoading(true)
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await alertStatusApi.getAlertEvents(currentAlertParams(q, page, pageSize))
      setItems(res.data?.list ?? [])
      setTotal(res.data?.total ?? 0)
      setPageState(res.data?.page ?? page)
      setPageSizeState(res.data?.page_size ?? pageSize)
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
  }, [q, page, pageSize])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  return {
    items,
    total,
    page,
    pageSize,
    loading,
    error,
    permissionDenied,
    reload,
    setPage,
    setPageSize,
  }
}

/** 未结三态计数（当前告警页统计卡；与列表 status=open 同口径）。 */
export interface OpenAlertStats {
  total: number
  firing: number
  silenced: number
  inhibited: number
}

export interface OpenAlertStatsState {
  stats: OpenAlertStats | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** 统计接口不可用时的占位（卡片显示 '-'，不把失败静默成 0）。 */
export function useOpenAlertStats(networkDomain?: string): OpenAlertStatsState {
  const [stats, setStats] = useState<OpenAlertStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    // 不在 effect 体内同步 setLoading（react-hooks/set-state-in-effect）：初始为 true，
    // 刷新由 reload() 显式置 true；网域切换时保留上一份数字直到新结果返回。
    alertStatusApi
      .getAlertEventStats({ network_domain: networkDomain })
      .then((res) => {
        if (cancelled) return
        const d = res.data
        // 字段缺失按不可用处理（显示 '-'），不把契约异常静默成 0。
        if (!d || typeof d.open_total !== 'number') {
          setStats(null)
          setError('未结统计响应缺少字段')
          return
        }
        setStats({
          total: d.open_total,
          firing: d.open_firing ?? 0,
          silenced: d.open_silenced ?? 0,
          inhibited: d.open_inhibited ?? 0,
        })
        setError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setStats(null)
        setError(e instanceof Error ? e.message : '统计加载失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [networkDomain, refresh])

  return { stats, loading, error, reload }
}

/** Prometheus 当前触发告警拉取（契约 §10.1，data.alerts 空结果兜底 []） */
async function fetchPromAlerts(networkDomain?: string): Promise<PromAlertItem[]> {
  const res = await alertStatusApi.getPromAlerts({ network_domain: networkDomain })
  return res.data?.alerts ?? []
}

function useAlertView<T>(fetcher: (networkDomain?: string) => Promise<T[]>, networkDomain?: string): AlertViewState<T> {
  const [items, setItems] = useState<T[]>([])
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
      const list = await fetcher(networkDomain)
      setItems(list)
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
  }, [fetcher, networkDomain])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；初始/刷新/网域筛选加载态由依赖变化触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  return { items, loading, error, permissionDenied, reload }
}

/** Prometheus 规则评估视图数据（firing/pending） */
export function usePromAlerts(networkDomain?: string): AlertViewState<PromAlertItem> {
  return useAlertView(fetchPromAlerts, networkDomain)
}

/** 网域下拉选项（M06 网域管理数据源；拉取失败降级为空选项，不阻断页面） */
export function useNetworkDomains(): DomainOption[] {
  const [domains, setDomains] = useState<DomainOption[]>([])
  useEffect(() => {
    networkDomainApi
      .list({ page: 1, page_size: 100 })
      .then((res) => setDomains((res.data?.list ?? []).map((d) => ({ id: d.id, name: d.name }))))
      .catch(() => setDomains([]))
  }, [])
  return domains
}
