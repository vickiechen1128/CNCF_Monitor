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
