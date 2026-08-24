import { useCallback, useEffect, useState } from 'react'
import { scrapeJobApi, type ScrapeJobListParams } from '../../api/scrapeJobs'
import type { Paginated } from '../../types/api'
import type { JobType, MonitorType, ScrapeJob } from '../../types/strategy'

/**
 * 采集 Job 列表筛选参数（F3，Module_01 §11.1）。
 * 网域（仅已纳管非冻结）/ 监控对象类型 / 关键字均走后端；分页默认 20/页。
 */
export interface ScrapeJobFilters {
  network_domain_id?: string
  monitor_type?: MonitorType
  job_type?: JobType
  keyword?: string
}

const EMPTY_PAGE: Paginated<ScrapeJob> = { list: [], total: 0, page: 1, page_size: 20 }

export interface UseScrapeJobsResult {
  data: Paginated<ScrapeJob>
  loading: boolean
  error: string | null
  filters: ScrapeJobFilters
  setFilters: (f: ScrapeJobFilters) => void
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
}

/**
 * 采集 Job 列表数据 Hook（Module_01 §8 / §11.1）。
 * 沿用 M06 useDomains 模式：筛选、分页在用户事件回调内设置 loading 触发重新加载，
 * 异步请求回调内完成 setState，不作 effect 内同步 setState。
 */
export function useScrapeJobs(): UseScrapeJobsResult {
  const [data, setData] = useState<Paginated<ScrapeJob>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFiltersState] = useState<ScrapeJobFilters>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    const params: ScrapeJobListParams = {
      network_domain_id: filters.network_domain_id,
      monitor_type: filters.monitor_type,
      job_type: filters.job_type,
      keyword: filters.keyword,
      page,
      page_size: pageSize,
    }
    try {
      const res = await scrapeJobApi.list(params)
      setData(res.data ?? EMPTY_PAGE)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }, [filters.network_domain_id, filters.monitor_type, filters.job_type, filters.keyword, page, pageSize])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const setFilters = useCallback((f: ScrapeJobFilters) => {
    setFiltersState(f)
    setPage(1)
  }, [])

  const onPageChange = useCallback((p: number) => {
    setPage(p)
  }, [])

  const onPageSizeChange = useCallback((p: number, pz: number) => {
    setPage(p)
    setPageSize(pz)
  }, [])

  return { data, loading, error, filters, setFilters, page, pageSize, onPageChange, onPageSizeChange, reload }
}