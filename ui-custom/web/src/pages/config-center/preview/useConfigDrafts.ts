import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../../api/client'
import { configDraftApi, networkDomainMonitorApi } from '../../../api/configCenter'
import type { ConfigDraft, DraftStatus, NetworkDomain, PaginatedItems } from '../../../types/config-center'

/** 变更状态筛选（决策 21）：默认 pending；all 传后端透传（契约 §4 status 支持 all） */
export type DraftStatusFilter = DraftStatus | 'all'

/** 「全部网域」的显式选项值（LOW-2）：选中时向后端传 network_domain_id=undefined 跨全部网域查询 */
export const ALL_DOMAINS_ID = '__all__'

/** 变更检测状态轮询间隔（PRD §11.2 全局行为规则：30s 轮询变更检测） */
export const POLL_INTERVAL_MS = 30_000

export interface UseConfigDraftsResult {
  data: PaginatedItems<ConfigDraft>
  loading: boolean
  error: string | null
  permissionDenied: boolean
  /** 当前切换网域；undefined = 未选择 */
  domainId?: string
  status: DraftStatusFilter
  setDomainId: (id?: string) => void
  setStatus: (s: DraftStatusFilter) => void
  page: number
  pageSize: number
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
}

const EMPTY_PAGE: PaginatedItems<ConfigDraft> = { items: [], total: 0 }

/**
 * 配置变更确认列表数据 Hook（Module_09，契约 §4 / §11.2）。
 * 消费 `GET /api/v2/platform/config-drafts`（信封 items；status 默认 pending）。
 * 覆盖：网域切换 / 状态筛选 / 分页 / 加载 / 接口错误 / 权限不足 / 30s 变更检测轮询。
 */
export function useConfigDrafts(): UseConfigDraftsResult {
  const [data, setData] = useState<PaginatedItems<ConfigDraft>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [domainId, setDomainIdState] = useState<string | undefined>(undefined)
  const [status, setStatusState] = useState<DraftStatusFilter>('pending')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await configDraftApi.list({
        network_domain_id: domainId === ALL_DOMAINS_ID ? undefined : domainId,
        status,
        page,
        page_size: pageSize,
      } as Record<string, string | number | undefined>)
      setData(res.data)
    } catch (e) {
      if (isApiError(e) && e.code === 403) {
        setPermissionDenied(true)
      } else {
        setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [domainId, status, page, pageSize])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；加载态由 setStatus/setDomainId/onPageSizeChange/reload 触发
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  // PRD §11.2：变更检测状态 30s 轮询（仅选定网域后生效，卸载时清理）
  useEffect(() => {
    if (!domainId) return
    const timer = window.setInterval(() => {
      setError(null)
      setPermissionDenied(false)
      setLoading(true)
      void load()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [domainId, load])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const setDomainId = useCallback((id?: string) => {
    setDomainIdState(id)
    setPage(1)
    setLoading(true)
  }, [])

  const setStatus = useCallback((s: DraftStatusFilter) => {
    setStatusState(s)
    setPage(1)
    setLoading(true)
  }, [])

  const onPageSizeChange = useCallback((p: number, pz: number) => {
    setPage(p)
    setPageSize(pz)
    setLoading(true)
  }, [])

  return {
    data,
    loading,
    error,
    permissionDenied,
    domainId,
    status,
    setDomainId,
    setStatus,
    page,
    pageSize,
    onPageSizeChange,
    reload,
  }
}

/** 已纳管网域（可生成变更单的候选网域，作为变更页网域切换器选项） */
export async function fetchMonitoredDomains(): Promise<NetworkDomain[]> {
  const res = await networkDomainMonitorApi.list({ page: 1, page_size: 100 })
  return res.data.items.filter((d) => d.is_monitored)
}