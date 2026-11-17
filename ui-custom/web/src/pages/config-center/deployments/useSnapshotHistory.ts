import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../../api/client'
import { configSnapshotApi } from '../../../api/configCenter'
import type { ConfigSnapshotHistoryRow, NetworkDomain } from '../../../types/config-center'
import { sortSnapshotsNewestFirst } from '../preview/snapshotHelpers'
import { fetchMonitoredDomains } from '../preview/useConfigSnapshots'

/** 单网域快照拉取失败（部分域降级展示用） */
export interface SnapshotDomainFailure {
  domain_id: string
  network_domain_name: string
  message: string
}

export interface UseSnapshotHistoryResult {
  /** 全部已纳管网域的快照合并结果（created_at 倒序） */
  rows: ConfigSnapshotHistoryRow[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  /** 部分网域失败：该域不产生行，其余域正常展示 */
  partialErrors: SnapshotDomainFailure[]
  domains: NetworkDomain[]
  domainsLoading: boolean
  domainError: boolean
  reload: () => void
}

/**
 * 快照历史数据 Hook（Module_09，v3 契约 §4）。
 *
 * v3 没有全局快照列表：先拉取全部已纳管网域（/network-domains?page=1&page_size=100），
 * 再并发拉取每个网域的快照列表，合并后按 created_at 倒序。
 * 单域失败不影响其他域（Promise.allSettled），失败域在页面提示条中列出。
 */
export function useSnapshotHistory(): UseSnapshotHistoryResult {
  const [rows, setRows] = useState<ConfigSnapshotHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [partialErrors, setPartialErrors] = useState<SnapshotDomainFailure[]>([])
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    // 重新拉取时恢复加载态（非级联渲染）
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    setDomainsLoading(true)
    setError(null)
    setPermissionDenied(false)
    setPartialErrors([])
    /* eslint-enable react-hooks/set-state-in-effect */

    fetchMonitoredDomains()
      .then(async (list) => {
        if (cancelled) return
        setDomains(list)
        setDomainError(false)
        const results = await Promise.allSettled(list.map((domain) => configSnapshotApi.list(domain.id)))
        if (cancelled) return

        const merged: ConfigSnapshotHistoryRow[] = []
        const failures: SnapshotDomainFailure[] = []
        let forbidden = 0
        results.forEach((result, index) => {
          const domain = list[index]
          if (result.status === 'fulfilled') {
            const items = result.value.data.list ?? []
            items.forEach((snapshot) => {
              merged.push({ ...snapshot, network_domain_name: domain.name })
            })
            return
          }
          const reason = result.reason
          if (isApiError(reason) && (reason.code === 403 || reason.errorType === 'forbidden')) {
            forbidden += 1
          }
          failures.push({
            domain_id: domain.id,
            network_domain_name: domain.name,
            message: reason instanceof Error ? reason.message : '加载失败',
          })
        })

        setRows(sortSnapshotsNewestFirst(merged))
        setPartialErrors(failures)
        // 全部网域均无权限时按权限不足处理（单域无权限只做部分失败提示）
        setPermissionDenied(list.length > 0 && forbidden === list.length)
      })
      .catch((e) => {
        if (cancelled) return
        setDomains([])
        setDomainError(true)
        setRows([])
        if (isApiError(e) && (e.code === 403 || e.errorType === 'forbidden')) {
          setPermissionDenied(true)
        } else {
          setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
        }
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setDomainsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setRefresh((r) => r + 1)
  }, [])

  return {
    rows,
    loading,
    error,
    permissionDenied,
    partialErrors,
    domains,
    domainsLoading,
    domainError,
    reload,
  }
}
