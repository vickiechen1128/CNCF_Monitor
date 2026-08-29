import { useCallback, useEffect, useState } from 'react'
import { loginLogApi } from '../../../api/admin'
import type { ItemsResult, LoginLogItem } from '../../../types/admin'

/** 登录日志筛选条件（契约 §2：username / success 可选） */
export interface LoginLogFilters {
  username?: string
  success?: '' | 'true' | 'false'
}

const EMPTY: ItemsResult<LoginLogItem> = { items: [], total: 0 }

export interface UseLoginLogsResult {
  data: ItemsResult<LoginLogItem>
  loading: boolean
  error: string | null
  filters: LoginLogFilters
  setFilters: (f: LoginLogFilters) => void
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
}

/**
 * 登录日志数据 Hook：分页 / 筛选 / 加载 / 错误。
 * 契约 §2：接口按时间倒序返回，前端不做二次排序；分页/筛选变更重置到第 1 页。
 */
export function useLoginLogs(): UseLoginLogsResult {
  const [data, setData] = useState<ItemsResult<LoginLogItem>>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFiltersState] = useState<LoginLogFilters>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const res = await loginLogApi.list({
        page,
        page_size: pageSize,
        username: filters.username,
        success: filters.success || undefined,
      })
      setData(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, filters])

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

  const setFilters = useCallback((f: LoginLogFilters) => {
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
    filters,
    setFilters,
    page,
    pageSize,
    onPageChange,
    onPageSizeChange,
    reload,
  }
}