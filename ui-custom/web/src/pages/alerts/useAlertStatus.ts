/**
 * 告警状态页数据 Hook（Module_08 v1.12 MVP 增量，契约快照 §10，双视图）。
 * useAmAlerts：Alertmanager 通知状态四态（M08 代理 /api/v2/platform/alertmanager/alerts）；
 * usePromAlerts：Prometheus 当前触发告警（M02 代理 /api/v1/alerts，firing/pending）。
 * network_domain 为 UX 筛选透传（过滤由后端承担，前端不重复过滤）；
 * 授权过滤由服务端强制注入（决策 56，MVP 单租户恒通过）。
 * 状态矩阵覆盖：加载 / 空态 / 接口错误 / 权限不足（403）。
 */
import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../api/client'
import { alertStatusApi } from '../../api/alertmanager'
import { networkDomainApi } from '../../api/domain'
import type { AmAlertItem, PromAlertItem } from '../../types/alertmanager'

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

/** Prometheus 当前触发告警拉取（契约 §10.1，data.alerts 空结果兜底 []） */
async function fetchPromAlerts(networkDomain?: string): Promise<PromAlertItem[]> {
  const res = await alertStatusApi.getPromAlerts({ network_domain: networkDomain })
  return res.data?.alerts ?? []
}

/** Alertmanager 通知状态拉取（契约 §10.2，data.items 空结果兜底 []） */
async function fetchAmAlerts(networkDomain?: string): Promise<AmAlertItem[]> {
  const res = await alertStatusApi.getAlertmanagerAlerts({ network_domain: networkDomain })
  return res.data?.items ?? []
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

/** Alertmanager 通知状态视图数据（四态由服务端归一 notify_status） */
export function useAmAlerts(networkDomain?: string): AlertViewState<AmAlertItem> {
  return useAlertView(fetchAmAlerts, networkDomain)
}

/** Prometheus 当前触发告警视图数据（firing/pending） */
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
