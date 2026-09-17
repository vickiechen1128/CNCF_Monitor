import { useCallback, useEffect, useState } from 'react'
import { tenantAdminApi } from '../../../api/admin'
import type { ItemsResult } from '../../../types/admin'
import type { Tenant } from '../../../types/domain'

/** 租户列表筛选条件（契约 §3：status 可选） */
export interface TenantFilters {
  status?: string
}

const EMPTY: ItemsResult<Tenant> = { items: [], total: 0 }

export interface UseTenantsResult {
  data: ItemsResult<Tenant>
  loading: boolean
  error: string | null
  filters: TenantFilters
  setFilters: (f: TenantFilters) => void
  reload: () => void
}

/**
 * 租户列表数据 Hook：加载 / 按状态筛选 / 错误 / 重载。
 * 契约 §3：GET /tenants 返回 {items, total}（MVP 仅 platform_admin）。
 */
export function useTenants(): UseTenantsResult {
  const [data, setData] = useState<ItemsResult<Tenant>>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFiltersState] = useState<TenantFilters>({})
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await tenantAdminApi.list({ status: filters.status })
      setData(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => {
    // 初版沿用本模块既有抓取 effect 模式：异步回调内 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const setFilters = useCallback((f: TenantFilters) => {
    setFiltersState((prev) => ({ ...prev, ...f }))
    setLoading(true)
  }, [])

  return { data, loading, error, filters, setFilters, reload }
}