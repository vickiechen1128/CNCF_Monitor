import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { edgeAgentsApi } from '../../../api/edgeAgents'
import { networkDomainMonitorApi } from '../../../api/configCenter'
import type {
  AgentStatus,
  AgentView,
  ConfigSyncStatus,
  EdgeAgentsSummary,
  EdgeComponentStatus,
} from '../../../types/edge'
import type { NetworkDomain } from '../../../types/config-center'

/** 五维筛选（空串 = 不过滤） */
export interface EdgeFilters {
  network_domain_id?: string
  overall?: AgentStatus | ''
  collector_status?: EdgeComponentStatus | ''
  blackbox_status?: EdgeComponentStatus | ''
  config_sync_status?: ConfigSyncStatus | ''
}

export interface UseEdgeAgentsResult {
  /** 客户端过滤后的可见节点 */
  agents: AgentView[]
  /** 全量节点（未过滤） */
  rawAgents: AgentView[]
  summary: EdgeAgentsSummary | null
  loading: boolean
  error: string | null
  domains: NetworkDomain[]
  filters: EdgeFilters
  setFilters: (f: EdgeFilters) => void
  resetFilters: () => void
  hasActiveFilter: boolean
  reload: () => void
}

const EMPTY_FILTERS: EdgeFilters = {
  network_domain_id: '',
  overall: '',
  collector_status: '',
  blackbox_status: '',
  config_sync_status: '',
}

/** 组件是否含指定类型 + 守护状态（采集器/拨测器筛选；空值返回 true 不过滤） */
function hasComponentOfStatus(agent: AgentView, type: 'collector' | 'blackbox_exporter', status: EdgeComponentStatus | ''): boolean {
  if (!status) return true
  return (agent.components ?? []).some((c) => c.type === type && c.status === status)
}

/** 采集节点状态数据 Hook（M11 契约 §1）。拉取全量 + 网域字典，客户端按五维过滤：
 * 后端 handler 恒返回全量（不消费筛选参数），故筛选在本地兜底实现。
 * 深链预筛：首次加载命中 ?network_domain=<id> 时自动写入网域筛选（仅一次）。 */
export function useEdgeAgents(deepLinkDomain?: string): UseEdgeAgentsResult {
  const [rawAgents, setRawAgents] = useState<AgentView[]>([])
  const [summary, setSummary] = useState<EdgeAgentsSummary | null>(null)
  const [domains, setDomains] = useState<NetworkDomain[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [filters, setFiltersState] = useState<EdgeFilters>(EMPTY_FILTERS)
  const deepLinkApplied = useRef(false)

  const load = useCallback(async () => {
    try {
      const [agentsRes, domainsRes] = await Promise.all([
        edgeAgentsApi.list(),
        networkDomainMonitorApi.list({ page: 1, page_size: 100 }),
      ])
      const loadedDomains = (domainsRes.data as unknown as { list?: NetworkDomain[] }).list ?? []
      setRawAgents(agentsRes.data?.agents ?? [])
      setSummary(agentsRes.data?.summary ?? null)
      setDomains(loadedDomains)
      // 深链预筛：仅在首次加载且目标网域存在时写入（异步回调内 setState，符合 lint 约定）
      if (!deepLinkApplied.current && deepLinkDomain && loadedDomains.some((d) => d.id === deepLinkDomain)) {
        deepLinkApplied.current = true
        setFiltersState({ ...EMPTY_FILTERS, network_domain_id: deepLinkDomain })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [deepLinkDomain])

  useEffect(() => {
    // 请求回调内在异步完成后才 setState；沿用 useNetworkDomains 既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const agents = useMemo(() => {
    return rawAgents.filter(
      (a) =>
        (!filters.network_domain_id || a.network_domain_id === filters.network_domain_id) &&
        (!filters.overall || a.status === filters.overall) &&
        hasComponentOfStatus(a, 'collector', filters.collector_status ?? '') &&
        hasComponentOfStatus(a, 'blackbox_exporter', filters.blackbox_status ?? '') &&
        (!filters.config_sync_status || a.config_sync_status === filters.config_sync_status),
    )
  }, [rawAgents, filters])

  const hasActiveFilter = useMemo(
    () =>
      Boolean(
        filters.network_domain_id ||
          filters.overall ||
          filters.collector_status ||
          filters.blackbox_status ||
          filters.config_sync_status,
      ),
    [filters],
  )

  const setFilters = useCallback((f: EdgeFilters) => {
    setFiltersState(f)
  }, [])

  const resetFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS)
  }, [])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  return {
    agents,
    rawAgents,
    summary,
    loading,
    error,
    domains,
    filters,
    setFilters,
    resetFilters,
    hasActiveFilter,
    reload,
  }
}