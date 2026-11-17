import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../../api/client'
import { configSnapshotApi, networkDomainMonitorApi } from '../../../api/configCenter'
import type { ConfigSnapshot, NetworkDomain } from '../../../types/config-center'
import { sortSnapshotsNewestFirst } from './snapshotHelpers'

export interface UseConfigSnapshotsResult {
  /** 当前选中网域的历史快照（最新在前） */
  snapshots: ConfigSnapshot[]
  total: number
  loading: boolean
  error: string | null
  permissionDenied: boolean
  /** 已纳管网域（网域选择器数据源） */
  domains: NetworkDomain[]
  domainsLoading: boolean
  domainError: boolean
  domainId?: string
  setDomainId: (id: string) => void
  reload: () => void
}

/** 已纳管网域（v3 列表信封 {list,total}；过滤出 registration_status=monitored 的网域） */
export async function fetchMonitoredDomains(): Promise<NetworkDomain[]> {
  const res = await networkDomainMonitorApi.list({ page: 1, page_size: 100 })
  const list = (res.data.list ?? []).map(networkDomainMonitorApi.toNetworkDomain)
  return list.filter((d) => d.is_monitored)
}

/**
 * 配置快照列表数据 Hook（Module_09，v3 契约 §4.2）。
 * 先加载已纳管网域并默认选中第一个，再按网域拉取只读快照列表。
 * 覆盖：网域切换 / 加载 / 空态 / 接口错误 / 权限不足 / 手动刷新。
 */
export function useConfigSnapshots(): UseConfigSnapshotsResult {
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState(false)
  const [domainId, setDomainIdState] = useState<string | undefined>(undefined)
  const [snapshots, setSnapshots] = useState<ConfigSnapshot[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [refresh, setRefresh] = useState(0)

  // 网域列表：挂载与手动刷新时拉取；默认选中首个已纳管网域（用户已手动选择时不覆盖）。
  useEffect(() => {
    let cancelled = false
    // 重新进入 / 刷新时恢复加载态，属「重新拉取」语义而非级联渲染
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDomainsLoading(true)
    fetchMonitoredDomains()
      .then((list) => {
        if (cancelled) return
        setDomains(list)
        setDomainError(false)
        setDomainIdState((prev) => prev ?? list[0]?.id)
      })
      .catch(() => {
        if (cancelled) return
        setDomains([])
        setDomainError(true)
      })
      .finally(() => {
        if (!cancelled) setDomainsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  // 快照列表：网域确定后拉取；切换网域或刷新时重建加载态。
  useEffect(() => {
    if (!domainId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSnapshots([])
      setTotal(0)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    configSnapshotApi
      .list(domainId)
      .then((res) => {
        if (cancelled) return
        setSnapshots(sortSnapshotsNewestFirst(res.data.list ?? []))
        setTotal(res.data.total ?? res.data.list?.length ?? 0)
      })
      .catch((e) => {
        if (cancelled) return
        if (isApiError(e) && (e.code === 403 || e.errorType === 'forbidden')) {
          setPermissionDenied(true)
        } else {
          setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [domainId, refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setRefresh((r) => r + 1)
  }, [])

  const setDomainId = useCallback((id: string) => {
    setDomainIdState(id)
    setLoading(true)
  }, [])

  return {
    snapshots,
    total,
    loading,
    error,
    permissionDenied,
    domains,
    domainsLoading,
    domainError,
    domainId,
    setDomainId,
    reload,
  }
}
