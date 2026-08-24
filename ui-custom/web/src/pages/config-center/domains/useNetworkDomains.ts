import { useCallback, useEffect, useState } from 'react'
import { isApiError } from '../../../api/client'
import { networkDomainMonitorApi } from '../../../api/configCenter'
import type { ConfigListParams } from '../../../api/configCenter'
import type { NetworkDomain, PaginatedItems } from '../../../types/config-center'

/**
 * 网域纳管列表数据 Hook（Module_09，契约 §3）。
 * 消费 `GET /api/v2/platform/network-domains`（信封 `items`，与 M06 的 `list` 区分）。
 * 覆盖：分页 / keyword 筛选 / 加载 / 接口错误 / 权限不足（越权其他租户 forbidden）。
 */
export interface UseNetworkDomainsResult {
  data: PaginatedItems<NetworkDomain>
  loading: boolean
  error: string | null
  permissionDenied: boolean
  filters: Pick<ConfigListParams, 'keyword'>
  setFilters: (f: Pick<ConfigListParams, 'keyword'>) => void
  page: number
  pageSize: number
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
}

const EMPTY_PAGE: PaginatedItems<NetworkDomain> = { items: [], total: 0 }

export function useNetworkDomains(): UseNetworkDomainsResult {
  const [data, setData] = useState<PaginatedItems<NetworkDomain>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [filters, setFiltersState] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await networkDomainMonitorApi.list({
        page,
        page_size: pageSize,
        keyword: filters.keyword || undefined,
      })
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
  }, [page, pageSize, filters])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；沿用 M06 useDomains 既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const setFilters = useCallback((f: Record<string, string>) => {
    setFiltersState((prev) => ({ ...prev, ...f }))
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
    filters,
    setFilters,
    page,
    pageSize,
    onPageSizeChange,
    reload,
  }
}