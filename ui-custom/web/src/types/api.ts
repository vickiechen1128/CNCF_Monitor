export type ApiStatus = 'success' | 'error'

export interface ApiResponse<T = unknown> {
  status: ApiStatus
  data: T
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
