/**
 * 历史告警页数据 Hook（Module_08 v1.13 MVP 增量，M02 /api/v1/alerts/history）。
 * 基于 Prometheus ALERTS 时间序列重建规则级触发/恢复区间，展示触发时间、恢复时间与持续时长。
 * 默认时间窗 24h，最大 7d；服务端强制注入授权网域过滤，前端 Query 仅作 UX 筛选透传。
 */
import { useCallback, useEffect, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { isApiError } from '../../api/client'
import { alertStatusApi } from '../../api/alertmanager'
import { networkDomainApi } from '../../api/domain'
import type { AlertHistoryItem, AlertHistoryState } from '../../types/alertmanager'

/** 历史告警查询参数 */
export interface HistoryAlertsQuery {
  networkDomain: string
  alertname: string
  instance: string
  state: 'all' | AlertHistoryState
  timeRange: [Dayjs, Dayjs]
  page: number
  pageSize: number
}

export interface HistoryAlertsResult {
  items: AlertHistoryItem[]
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

/** 网域下拉选项 */
export interface DomainOption {
  id: string
  name: string
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const DEFAULT_WINDOW_HOURS = 24
const MAX_WINDOW_HOURS = 7 * 24

export function useHistoryAlerts(q: HistoryAlertsQuery): HistoryAlertsResult {
  const [items, setItems] = useState<AlertHistoryItem[]>([])
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
    if (next < 1) next = DEFAULT_PAGE_SIZE
    setPageSizeState(next)
    setPageState(1)
    setLoading(true)
  }, [])

  const load = useCallback(async () => {
    const [start, end] = clampTimeRange(q.timeRange)
    const params: Record<string, string | number | undefined> = {
      page,
      page_size: pageSize,
      start: start.toISOString(),
      end: end.toISOString(),
    }
    if (q.networkDomain && q.networkDomain !== 'all') {
      params.network_domain = q.networkDomain
    }
    if (q.alertname) params.alertname = q.alertname
    if (q.instance) params.instance = q.instance
    if (q.state !== 'all') params.state = q.state

    try {
      const res = await alertStatusApi.getAlertHistory(params)
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

/** 初始化默认时间窗：最近 24h */
export function defaultTimeRange(): [Dayjs, Dayjs] {
  const end = dayjs()
  return [end.subtract(DEFAULT_WINDOW_HOURS, 'hour'), end]
}

/** 限制时间窗不超过 7d，并保证 end >= start */
function clampTimeRange(range: [Dayjs, Dayjs]): [Dayjs, Dayjs] {
  let [start, end] = range
  if (!start || !end || start.isAfter(end)) {
    end = dayjs()
    start = end.subtract(DEFAULT_WINDOW_HOURS, 'hour')
  }
  if (end.diff(start, 'hour') > MAX_WINDOW_HOURS) {
    start = end.subtract(MAX_WINDOW_HOURS, 'hour')
  }
  return [start, end]
}
