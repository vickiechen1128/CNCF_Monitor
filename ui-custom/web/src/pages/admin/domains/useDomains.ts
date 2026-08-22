import { useCallback, useEffect, useState } from 'react'
import { isApiError, networkDomainApi } from '../../../api/domain'
import type { ListParams } from '../../../api/domain'
import type { Paginated } from '../../../types/api'
import type { NetworkDomain } from '../../../types/domain'

/** 网域列表筛选参数（Module_06 §6.2 / §11.1） */
export type DomainFilters = Pick<ListParams, 'status' | 'zone_type' | 'tenant_id' | 'name'>

/** 默认空分页（避免未加载完成时空指针） */
const EMPTY_PAGE: Paginated<NetworkDomain> = { list: [], total: 0, page: 1, page_size: 20 }

export interface UseDomainsResult {
  data: Paginated<NetworkDomain>
  loading: boolean
  error: string | null
  permissionDenied: boolean
  filters: DomainFilters
  setFilters: (f: DomainFilters) => void
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
}

/**
 * 网域列表数据 Hook：分页 / 筛选 / 加载 / 错误 / 权限不足。
 * 分页与筛选变更、reload 均在用户事件回调内设置 loading 并触发重新加载；
 * 异步请求的回调内完成 setState，不作 effect 内同步 setState。
 */
export function useDomains(): UseDomainsResult {
  const [data, setData] = useState<Paginated<NetworkDomain>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  const [filters, setFiltersState] = useState<DomainFilters>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await networkDomainApi.list({
        page,
        page_size: pageSize,
        status: filters.status,
        zone_type: filters.zone_type,
        tenant_id: filters.tenant_id,
        name: filters.name,
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
    // 数据请求回调内在异步完成后才 setState；初版沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const setFilters = useCallback((f: DomainFilters) => {
    setFiltersState((prev) => ({ ...prev, ...f }))
    setPage(1)
    setLoading(true)
  }, [])

  const onPageChange = useCallback((p: number) => {
    setPage(p)
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
    onPageChange,
    onPageSizeChange,
    reload,
  }
}
