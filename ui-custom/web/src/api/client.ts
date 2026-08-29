import type { ApiResponse, ApiStatus } from '../types/api'
import type { AuthUser } from '../types/auth'

// Vite 构建期可通过 VITE_API_BASE_URL 注入后端地址；不注入时默认使用相对路径
//（此时需要前端与后端同域部署，或由 nginx 做反向代理）。
const BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

// 认证 Token / 用户信息的 localStorage 持久化 key（与后端会话关联，见 module-06 契约快照）。
// 401 拦截、路由守卫、登录页均依赖这里的存取助手。
const TOKEN_STORAGE_KEY = 'metriccenter:auth:token'
const USER_STORAGE_KEY = 'metriccenter:auth:user'
// 登录接口本身返回 401 表示「用户名或密码错误」，由登录页处理，不触发全局跳转，避免无限循环。
const LOGIN_ENDPOINT = '/api/v2/platform/auth/login'

/** 读取当前会话 Token；localStorage 不可用（隐私模式 / 存储满）时返回 null，不影响渲染 */
export function getToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

/** 写入当前会话 Token（登录成功后调用） */
export function setToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    /* localStorage 不可用时静默降级 */
  }
}

/** 清除当前会话 Token 与缓存用户信息（登出 / 401 会话失效时调用） */
export function clearToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    window.localStorage.removeItem(USER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

/** 缓存当前登录用户信息（首页 / 布局展示 display_name 等用） */
export function setStoredUser(user: AuthUser): void {
  try {
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
  } catch {
    /* ignore */
  }
}

/** 读取当前登录用户信息 */
export function getStoredUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

type UnauthorizedNavigate = (to: string) => void
let unauthorizedNavigate: UnauthorizedNavigate | null = null

/**
 * 注册 401 统一跳转处理（由 App 路由层注入 useNavigate；额外提供替换点便于单元测试，
 * 也避免 client 直接依赖 window 导航）。
 * 传入 null 表示注销；未注册时回退为整页跳转。
 */
export function setUnauthorizedNavigate(handler: UnauthorizedNavigate | null): void {
  unauthorizedNavigate = handler
}

function defaultUnauthorizedNavigate(to: string): void {
  window.location.href = to
}

/** 由当前 URL 构造登录跳转目标，携带 redirect 便于登录后回跳原页面 */
function buildLoginUrl(): string {
  const current = `${window.location.pathname}${window.location.search}`
  if (current.startsWith('/login')) return '/login'
  return `/login?redirect=${encodeURIComponent(current)}`
}

/** 会话失效统一处理：清 Token 并跳转登录页 */
function handleUnauthorized(): void {
  clearToken()
  const go = unauthorizedNavigate ?? defaultUnauthorizedNavigate
  go(buildLoginUrl())
}

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

  const token = getToken()
  const init: RequestInit = {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  const res = await fetch(url, init)
  const data = await parseResponse<T>(res)

  // 401 / unauthorized 统一清 Token 并跳登录（auth/login 除外，避免登录失败也被重定向）
  const unauthorized = res.status === 401 || data.errorType === 'unauthorized'
  if (unauthorized && path !== LOGIN_ENDPOINT) {
    handleUnauthorized()
  }

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
