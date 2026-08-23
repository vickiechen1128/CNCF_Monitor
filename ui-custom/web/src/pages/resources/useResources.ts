import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isApiError } from '../../api/client'
import { resourceApi } from '../../api/resources'
import type { ResourceListParams } from '../../api/resources'
import type { Paginated } from '../../types/api'
import type { ResourceCategory } from '../../types/resource'

/**
 * 资源列表 item（对齐 T07-05 列表契约 Module_07 §5.2）：共享字段 + 五类差异化字段平铺。
 * 后端 list 接口按 resource_category 分表返回归一化字段；is_monitored 由 M01 维护、
 * M07 只读映射（决策 31-M1），本阶段列表不返回该字段，故不含。
 */
export interface ResourceListItem {
  resource_id: string
  resource_category: ResourceCategory
  network_domain_id: string
  biz_code?: string
  app_name?: string
  env?: string
  cluster?: string
  owner?: string
  status: string
  source_type: string
  // host（T07-03 legacy 映射：instance_ip→private_ip、hostname→instance_name、os_type→image）
  instance_name?: string
  hostname?: string
  instance_ip?: string
  os_type?: string
  // database / middleware
  database_type?: string
  middleware_type?: string
  port?: number
  version?: string
  // application
  service_name?: string
  health_check_url?: string
  protocol?: string
  endpoint?: string
  // generic_target
  target_name?: string
  metrics_path?: string
  scheme?: string
  exporter_type?: string
  custom_labels?: string
}

/**
 * 资源列表筛选参数。
 * 网域 / 关键字 / 未监控走后端（T07-05 支持 network_domain_id / keyword / is_monitored）；
 * 业务 / 运行状态后端列表接口未提供，前端在当前页数据上过滤（MVP 分页从简，见 filteredList 注释）。
 */
export interface ResourceFilters {
  network_domain_id?: string
  biz_code?: string
  status?: string
  is_monitored?: boolean
  keyword?: string
}

/** 默认空分页（避免未加载完成时空指针；MVP 默认 page_size=50，PRD §11.2） */
const EMPTY_PAGE: Paginated<ResourceListItem> = { list: [], total: 0, page: 1, page_size: 50 }

/**
 * 「网域 / 业务」筛选器默认记忆上次选择（PRD §5.4 / §11.2）：以 localStorage 持久化
 * network_domain_id / biz_code，下次进入页面默认按上次选择过滤，仍可切「全部网域/全部业务」。
 */
const FILTERS_STORAGE_KEY = 'metriccenter:resources:filters'

function loadSavedFilters(): ResourceFilters {
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<Record<'network_domain_id' | 'biz_code', unknown>>
    const saved: ResourceFilters = {}
    if (typeof parsed.network_domain_id === 'string' && parsed.network_domain_id) {
      saved.network_domain_id = parsed.network_domain_id
    }
    if (typeof parsed.biz_code === 'string' && parsed.biz_code) {
      saved.biz_code = parsed.biz_code
    }
    return saved
  } catch {
    // 存储数据损坏 / 不可用时降级为默认（全部）
    return {}
  }
}

function persistFilters(f: ResourceFilters) {
  try {
    window.localStorage.setItem(
      FILTERS_STORAGE_KEY,
      JSON.stringify({ network_domain_id: f.network_domain_id ?? null, biz_code: f.biz_code ?? null }),
    )
  } catch {
    // localStorage 不可用（隐私模式 / 存储满）时静默降级，不影响列表功能
  }
}

export interface UseResourcesResult {
  /** 当前资源类型 Tab（五类之一），切换后带 resource_category 重新请求列表 */
  category: ResourceCategory
  setCategory: (c: ResourceCategory) => void
  /** 后端分页数据（total 为服务端全量总数） */
  data: Paginated<ResourceListItem>
  /** 当前页经 biz_code / status 前端过滤后的行（后端不支持该两筛选） */
  filteredList: ResourceListItem[]
  loading: boolean
  error: string | null
  permissionDenied: boolean
  filters: ResourceFilters
  setFilters: (f: ResourceFilters) => void
  page: number
  pageSize: number
  onPageChange: (p: number) => void
  onPageSizeChange: (p: number, pz: number) => void
  reload: () => void
}

/**
 * 资源列表数据 Hook：五类 Tab 切换 + 分页 / 筛选 / 加载 / 错误 / 权限不足。
 * 沿用 M06 useDomains 模式：分页、筛选、Tab 切换均在用户事件回调内设置 loading 并
 * 触发重新加载；异步请求回调内完成 setState，不作 effect 内同步 setState。
 */
export function useResources(initialCategory: ResourceCategory = 'host'): UseResourcesResult {
  const [category, setCategoryState] = useState<ResourceCategory>(initialCategory)
  const [data, setData] = useState<Paginated<ResourceListItem>>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [permissionDenied, setPermissionDenied] = useState(false)
  // 网域/业务筛选默认记忆上次选择（PRD §5.4 / §11.2）；filtersRef 与 state 同步的最新快照，供合并持久化
  const [filters, setFiltersState] = useState<ResourceFilters>(loadSavedFilters)
  const filtersRef = useRef<ResourceFilters>(filters)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [refresh, setRefresh] = useState(0)

  const load = useCallback(async () => {
    try {
      const params: ResourceListParams = {
        resource_category: category,
        page,
        page_size: pageSize,
        network_domain_id: filters.network_domain_id,
        keyword: filters.keyword,
        // 未监控筛选：M01 维护、M07 只读透传（决策 31-M1），M01 未实现时后端不生效
        is_monitored: filters.is_monitored,
      }
      // 后端列表 item 为平铺 map，与 ResourceListItem 结构兼容（见该类型注释）
      const res = await resourceApi.list(params)
      setData(res.data as unknown as Paginated<ResourceListItem>)
    } catch (e) {
      if (isApiError(e) && e.code === 403) {
        setPermissionDenied(true)
      } else {
        setError(e instanceof Error ? e.message : '加载失败，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [category, page, pageSize, filters])

  useEffect(() => {
    // 数据请求回调内在异步完成后才 setState；沿用本模块既有抓取 effect 模式
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refresh])

  const reload = useCallback(() => {
    setError(null)
    setPermissionDenied(false)
    setLoading(true)
    setRefresh((r) => r + 1)
  }, [])

  const setFilters = useCallback((f: ResourceFilters) => {
    // 基于最新快照合并（而非本次变更子集），确保持久化完整「网域/业务」记忆
    const next = { ...filtersRef.current, ...f }
    filtersRef.current = next
    persistFilters(next)
    setFiltersState(next)
    setPage(1)
    setLoading(true)
  }, [])

  const setCategory = useCallback((c: ResourceCategory) => {
    setCategoryState(c)
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

  // 业务 / 运行状态后端列表接口未提供筛选（T07-05 仅支持 network_domain_id / keyword /
  // is_monitored），前端在当前页数据上过滤。MVP 分页从简（默认 50/页、优先搜索/筛选，
  // PRD §11.2），数据量小场景下该近似可接受；total 仍为服务端全量总数。
  const filteredList = useMemo(() => {
    const { biz_code, status } = filters
    return data.list.filter((item) => {
      if (biz_code && item.biz_code !== biz_code) return false
      if (status && item.status !== status) return false
      return true
    })
  }, [data.list, filters])

  return {
    category,
    setCategory,
    data,
    filteredList,
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
