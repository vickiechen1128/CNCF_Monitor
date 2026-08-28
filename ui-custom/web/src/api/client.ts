import type { ApiResponse, ApiStatus } from '../types/api'

// Vite 构建期可通过 VITE_API_BASE_URL 注入后端地址；不注入时默认使用相对路径
//（此时需要前端与后端同域部署，或由 nginx 做反向代理）。
const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

interface RequestOptions extends Omit<RequestInit, 'body'> {
  params?: Record<string, string | number | boolean | undefined>
  body?: unknown
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.append(key, String(value))
      }
    })
  }
  return url.toString()
}

async function parseResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const json = await res.json()
    const status: ApiStatus = json.status ?? (res.ok ? 'success' : 'error')
    return {
      status,
      data: json.data as T,
      error: json.error,
      errorType: json.errorType,
    }
  }

  const text = await res.text()
  const status: ApiStatus = res.ok ? 'success' : 'error'
  return {
    status,
    data: undefined as T,
    error: text || res.statusText,
  }
}

export class ApiError extends Error {
  code: number
  errorType?: string

  constructor(message: string, code: number, errorType?: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.errorType = errorType
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { params, body, headers, ...rest } = options
  const url = buildUrl(path, params)

  const init: RequestInit = {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...headers,
    },
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const res = await fetch(url, init)
  const data = await parseResponse<T>(res)

  if (!res.ok || data.status === 'error') {
    throw new ApiError(data.error || res.statusText, res.status, data.errorType)
  }

  return data
}

export const apiClient = {
  get<T>(path: string, options?: Omit<RequestOptions, 'method'>) {
    return request<T>(path, { ...options, method: 'GET' })
  },
  post<T>(path: string, options?: Omit<RequestOptions, 'method'>) {
    return request<T>(path, { ...options, method: 'POST' })
  },
  put<T>(path: string, options?: Omit<RequestOptions, 'method'>) {
    return request<T>(path, { ...options, method: 'PUT' })
  },
  delete<T>(path: string, options?: Omit<RequestOptions, 'method'>) {
    return request<T>(path, { ...options, method: 'DELETE' })
  },
  patch<T>(path: string, options?: Omit<RequestOptions, 'method'>) {
    return request<T>(path, { ...options, method: 'PATCH' })
  },
}
