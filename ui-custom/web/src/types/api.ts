export type ApiStatus = 'success' | 'error'

/**
 * 查询类接口追加的 meta 信封（v3 契约 §1.3）：
 * data_source 恒为 prometheus；freshness_at 为本次查询数据新鲜度；network_domains 为
 * 本次查询实际覆盖的授权网域列表。
 */
export interface ApiMeta {
  data_source?: string
  freshness_at?: string
  network_domains?: string[]
}

export interface ApiResponse<T = unknown> {
  status: ApiStatus
  data: T
  meta?: ApiMeta
  error?: string
  errorType?: string
}

export interface ApiErrorResponse {
  status: 'error'
  data: null
  error: string
  errorType: string
}

export type ApiError = ApiErrorResponse

/** 平台业务接口统一分页响应信封（03_API_Standard §7.2） */
export interface Paginated<T> {
  list: T[]
  total: number
  page: number
  page_size: number
}
