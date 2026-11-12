import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '../../api/client'
import { resourceApi } from '../../api/resources'
import type { ResourceListParams } from '../../api/resources'
import type { Paginated } from '../../types/api'
import type { ResourceCategory, ResourceListItem } from '../../types/resource'

/**
 * 资源列表 item 采用 `types/resource.ts` 中的 v3 归一化平铺模型。
 * 此处保留 re-export，兼容既有页面 / 测试从 `./useResources` 导入的路径。
 */
export type { ResourceListItem } from '../../types/resource'

/**
 * 资源列表筛选参数。
 *
 * 全部筛选（网域 / 业务 / 运行状态 / 平台 / 应用 / 关键字）均**走后端**列表接口，
 * 不在当前页数据上做前端过滤——否则筛选只对当页生效、与分页总数不一致（PRD §11.1）。
 * F-18 起 biz_code / status 由前端过滤下沉为后端等值条件（K-1 闭环）。
 */
export interface ResourceFilters {
  network_domain_id?: string
  biz_code?: string
  status?: string
  /** 平台归属编码（决策 110），五类均支持 */
  platform_code?: string
  /** 应用归属编码（决策 92），五类均支持；下拉按所选 platform_code 级联 */
  app_code?: string
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
  /** 后端分页数据（total 为服务端按全部筛选条件统计的总数） */
  data: Paginated<ResourceListItem>
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
        // F-18：业务 / 运行状态由前端过滤下沉为后端等值条件（PRD §11.1），
        // 使筛选作用于全量数据且分页总数与筛选一致。
        biz_code: filters.biz_code,
        status: filters.status,
        // F-18：四层模型查询侧（决策 110/111）——平台 → 应用两维筛选。
        platform_code: filters.platform_code,
        app_code: filters.app_code,
        // 未监控筛选：M01 维护、M07 只读透传（决策 31-M1），M01 未实现时后端不生效
        is_monitored: filters.is_monitored,
      }
      // v3 响应已在 api 适配层展平为 ResourceListItem，无需再做结构转换
      const res = await resourceApi.list(params)
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

  return {
    category,
    setCategory,
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
