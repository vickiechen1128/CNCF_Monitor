import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../../api/client'
import { configArtifactApi } from '../../../api/configCenter'
import type { ConfigArtifact, ConfigSnapshotHistoryRow, NetworkDomain } from '../../../types/config-center'
import { fetchMonitoredDomains } from './useConfigSnapshots'

/** 部分产物加载失败（保留旧页面接口；统一接口为单请求，正常为空） */
export interface ArtifactLoadFailure {
  domain_id: string
  network_domain_name: string
  message: string
}

export interface UseConfigArtifactsOptions {
  /** 深链预筛网域（`?network_domain=<id>`）；缺省 = 全部产物（含中心规则/告警配置） */
  initialDomainId?: string
}

export interface UseConfigArtifactsResult {
  /** 统一历史行（已按 created_at 倒序，附带展示名） */
  rows: ConfigSnapshotHistoryRow[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  /** 兼容旧页面结构；统一接口单请求，正常为空 */
  partialErrors: ArtifactLoadFailure[]
  /** 已纳管网域（网域筛选下拉数据源） */
  domains: NetworkDomain[]
  domainsLoading: boolean
  domainError: boolean
  domainFilter?: string
  setDomainFilter: (id?: string) => void
  reload: () => void
}

function isForbidden(reason: unknown): boolean {
  return isApiError(reason) && (reason.code === 403 || reason.errorType === 'forbidden')
}

function displayName(item: ConfigArtifact, domains: NetworkDomain[]): string {
  switch (item.artifact_type) {
    case 'center':
      return '中心规则'
    case 'alertmanager':
      return '告警配置'
    default:
      return domains.find((d) => d.id === item.network_domain_id)?.name ?? item.network_domain_id
  }
}

function sortNewestFirst<T extends Pick<ConfigArtifact, 'id' | 'created_at'>>(rows: T[]): T[] {
  const time = (value: string): number => {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return [...rows].sort((a, b) => {
    const diff = time(b.created_at) - time(a.created_at)
    return diff !== 0 ? diff : b.id - a.id
  })
}

/**
 * 统一配置产物历史 Hook（SRS v1.5 FR-13/13.1）。
 *
 * 一次请求 `GET /api/v3/platform/config-artifacts` 拿到网域采集配置、中心规则、
 * 告警配置三类产物；网域筛选只做服务端过滤，不再按域扇出。
 * 列表/详情登录可见；内容预览与导出由详情抽屉按 admin 权限调用。
 */
export function useConfigArtifacts(options: UseConfigArtifactsOptions = {}): UseConfigArtifactsResult {
  const { initialDomainId } = options
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [domainError, setDomainError] = useState(false)
  const [domainFilter, setDomainFilterState] = useState<string | undefined>(initialDomainId)
  const [rows, setRows] = useState<ConfigSnapshotHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setDomainsLoading(true)
    setDomainError(false)
    /* eslint-enable react-hooks/set-state-in-effect */
    fetchMonitoredDomains()
      .then((list) => {
        if (cancelled) return
        setDomains(list)
      })
      .catch((e) => {
        if (cancelled) return
        setDomains([])
        setDomainError(true)
        if (isForbidden(e)) setPermissionDenied(true)
      })
      .finally(() => {
        if (!cancelled) setDomainsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [refresh])

  // 深链网域若已不在已纳管网域内（退纳管/无权限），回落为全部产物。
  const activeFilter =
    domainFilter && domains.some((d) => d.id === domainFilter) ? domainFilter : undefined

  useEffect(() => {
    if (domainsLoading) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true)
    setError(null)
    setPermissionDenied(false)
    /* eslint-enable react-hooks/set-state-in-effect */
    configArtifactApi
      .list({
        network_domain_id: activeFilter,
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return
        const mapped: ConfigSnapshotHistoryRow[] = (res.data.list ?? []).map((item) => ({
          ...item,
          artifact_type: item.artifact_type ?? 'domain',
          network_domain_id: item.network_domain_id ?? '',
          network_domain_name: displayName(item, domains),
        }))
        setRows(sortNewestFirst(mapped))
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
    partialErrors: [],
    domains,
    domainsLoading,
    domainError,
    domainFilter: activeFilter,
    setDomainFilter,
    reload,
  }
}
