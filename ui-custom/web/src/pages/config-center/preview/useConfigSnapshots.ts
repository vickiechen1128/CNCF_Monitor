import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../../api/client'
import { configSnapshotApi, networkDomainMonitorApi } from '../../../api/configCenter'
import type { ConfigSnapshotHistoryRow, NetworkDomain } from '../../../types/config-center'
import { sortSnapshotsNewestFirst } from './snapshotHelpers'

/** 单网域快照拉取失败（部分域降级展示用） */
export interface SnapshotDomainFailure {
  domain_id: string
  network_domain_name: string
  message: string
}

export interface UseConfigSnapshotsOptions {
  /** 深链预筛网域（`?network_domain=<id>`）；缺省 / 未命中已纳管网域 = 全部网域 */
  initialDomainId?: string
}

export interface UseConfigSnapshotsResult {
  /** 快照行（已按 created_at 倒序，附带网域名） */
  rows: ConfigSnapshotHistoryRow[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  /** 部分网域失败：该域不产生行，其余域正常展示（仅「全部网域」模式会出现） */
  partialErrors: SnapshotDomainFailure[]
  /** 已纳管网域（网域筛选下拉数据源） */
  domains: NetworkDomain[]
  domainsLoading: boolean
  domainError: boolean
  /** 网域筛选；undefined = 全部已纳管网域 */
  domainFilter?: string
  setDomainFilter: (id?: string) => void
  reload: () => void
}

/** 已纳管网域（v3 列表信封 {list,total}；过滤出 registration_status=monitored 的网域） */
export async function fetchMonitoredDomains(): Promise<NetworkDomain[]> {
  const res = await networkDomainMonitorApi.list({ page: 1, page_size: 100 })
  const list = (res.data.list ?? []).map(networkDomainMonitorApi.toNetworkDomain)
  return list.filter((d) => d.is_monitored)
}

function isForbidden(reason: unknown): boolean {
  return isApiError(reason) && (reason.code === 403 || reason.errorType === 'forbidden')
}

/**
 * 配置快照数据 Hook（Module_09，v3 契约 §4.2）。
 *
 * 原「配置快照（单域）」与「快照历史（跨域聚合）」两页合并为一个数据源：
 * - 网域筛选为空 → 并发拉取全部已纳管网域的快照并合并按时间倒序（单域失败降级为 partialErrors）；
 * - 选中某一网域 → 只发该域一条请求（保留原单域页的低成本路径）。
 *
 * 覆盖：网域切换 / 加载 / 空态 / 接口错误 / 权限不足 / 手动刷新。
 */
export function useConfigSnapshots(
  options: UseConfigSnapshotsOptions = {},
): UseConfigSnapshotsResult {
  const { initialDomainId } = options
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState(false)
  const [domainFilter, setDomainFilterState] = useState<string | undefined>(initialDomainId)
  const [rows, setRows] = useState<ConfigSnapshotHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [partialErrors, setPartialErrors] = useState<SnapshotDomainFailure[]>([])
  const [refresh, setRefresh] = useState(0)

  // 网域列表：挂载与手动刷新时拉取（不再默认选中首个网域：默认视图即「全部网域」）。
  useEffect(() => {
    let cancelled = false
    // 重新拉取时恢复加载态（重新拉取语义，非级联渲染）
    /* eslint-disable react-hooks/set-state-in-effect */
    setDomainsLoading(true)
    setDomainError(false)
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchMonitoredDomains()
      .then((list) => {
        if (cancelled) return
        setDomains(list)
        setDomainError(false)
      })
      .catch((e) => {
        if (cancelled) return
        setDomains([])
        setDomainError(true)
        // 网域列表整体无权限：直接按权限不足处理（页面不再展示空表）
        if (isForbidden(e)) setPermissionDenied(true)
      })
      .finally(() => {
        if (!cancelled) setDomainsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  // 深链 / 下拉选中的网域若不在已纳管网域内（被退纳管、无权限），回落为「全部网域」，
  // 避免对着一个不存在的域反复报错。
  const activeFilter =
    domainFilter && domains.some((d) => d.id === domainFilter) ? domainFilter : undefined

  useEffect(() => {
    if (domainsLoading) return
    if (domains.length === 0) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setRows([])
      setPartialErrors([])
      setLoading(false)
      /* eslint-enable react-hooks/set-state-in-effect */
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    setPartialErrors([])

    if (activeFilter) {
      // 单域：一条请求，行为对齐原「配置快照」页
      const domainName = domains.find((d) => d.id === activeFilter)?.name ?? activeFilter
      configSnapshotApi
        .list(activeFilter)
        .then((res) => {
          if (cancelled) return
          const items: ConfigSnapshotHistoryRow[] = (res.data.list ?? []).map((item) => ({
            ...item,
            network_domain_name: domainName,
          }))
          setRows(sortSnapshotsNewestFirst(items))
        })
        .catch((e) => {
          if (cancelled) return
          setRows([])
          if (isForbidden(e)) {
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
    }

    // 全部网域：v3 无全局快照接口，扇出拉取后合并；单域失败不影响其他域。
    Promise.allSettled(domains.map((domain) => configSnapshotApi.list(domain.id)))
      .then((results) => {
        if (cancelled) return
        const merged: ConfigSnapshotHistoryRow[] = []
        const failures: SnapshotDomainFailure[] = []
        let forbidden = 0
        results.forEach((result, index) => {
          const domain = domains[index]
          if (result.status === 'fulfilled') {
            ;(result.value.data.list ?? []).forEach((item) => {
              merged.push({ ...item, network_domain_name: domain.name })
            })
            return
          }
          if (isForbidden(result.reason)) forbidden += 1
          failures.push({
            domain_id: domain.id,
            network_domain_name: domain.name,
            message: result.reason instanceof Error ? result.reason.message : '加载失败',
          })
        })
        setRows(sortSnapshotsNewestFirst(merged))
        setPartialErrors(failures)
        // 全部网域均无权限时按权限不足处理（单域无权限只做部分失败提示）
        setPermissionDenied(forbidden === domains.length)
      })
      .catch((e) => {
        if (cancelled) return
        setRows([])
        setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [domains, domainsLoading, activeFilter, refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setRefresh((r) => r + 1)
  }, [])

  const setDomainFilter = useCallback((id?: string) => {
    setDomainFilterState(id)
    setLoading(true)
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
    // 返回**生效中**的筛选值：深链 id 若已不在已纳管网域内（被退纳管 / 无权限），下拉回落「全部网域」，
    // 避免出现「筛选项不存在于下拉、表格却已聚合全部」的错位展示。
    domainFilter: activeFilter,
    setDomainFilter,
    reload,
  }
}
