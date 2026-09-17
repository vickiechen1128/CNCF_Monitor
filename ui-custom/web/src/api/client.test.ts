import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient, clearToken, getToken, request, setToken, setUnauthorizedNavigate } from './client'

// vitest jsdom 环境的 window.localStorage 存储行为不可靠，用内存 Map 替换以验证 token 持久化。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

describe('apiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    storageMap.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(response: Response) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response)
  }

  function createJsonResponse<T>(body: T, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  }

  it('returns data for success response', async () => {
    mockFetch(createJsonResponse({ status: 'success', data: { version: '1.0.0' } }))

    const res = await apiClient.get<{ version: string }>('/api/v1/status')

    expect(res.status).toBe('success')
    expect(res.data).toEqual({ version: '1.0.0' })
  })

  it('throws ApiError when status is error even if HTTP is 200', async () => {
    mockFetch(
      createJsonResponse({
        status: 'error',
        error: 'service unavailable',
        errorType: 'internal',
      }),
    )

    await expect(apiClient.get('/api/v1/status')).rejects.toMatchObject({
      message: 'service unavailable',
      code: 200,
      errorType: 'internal',
    })
  })

  it('throws ApiError for non-2xx HTTP responses', async () => {
    mockFetch(
      createJsonResponse(
        { status: 'error', error: 'not found', errorType: 'not_found' },
        { status: 404 },
      ),
    )

    await expect(apiClient.get('/api/v1/status')).rejects.toMatchObject({
      message: 'not found',
      code: 404,
      errorType: 'not_found',
    })
  })

  it('throws ApiError with status text when response is not JSON', async () => {
    mockFetch(
      new Response('bad gateway', {
        status: 502,
        statusText: 'Bad Gateway',
      }),
    )

    await expect(apiClient.get('/api/v1/status')).rejects.toMatchObject({
      message: 'bad gateway',
      code: 502,
    })
  })

  it('builds URL with query params', async () => {
    mockFetch(createJsonResponse({ status: 'success', data: [] }))

    await apiClient.get('/api/v2/platform/config', {
      params: { page: 1, limit: 10, empty: '', nil: undefined },
    })

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const url = new URL(call[0])
    expect(url.pathname).toBe('/api/v2/platform/config')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.has('empty')).toBe(false)
    expect(url.searchParams.has('nil')).toBe(false)
  })

  it('preserves full path prefix for both v1 and v2/platform routes', async () => {
    mockFetch(createJsonResponse({ status: 'success', data: null }))

    await request('/api/v1/query')
    const v1Call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(new URL(v1Call[0]).pathname).toBe('/api/v1/query')

    mockFetch(createJsonResponse({ status: 'success', data: null }))
    await request('/api/v2/platform/config')
    const v2Call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1]
    expect(new URL(v2Call[0]).pathname).toBe('/api/v2/platform/config')
  })

  it('attaches Authorization Bearer token from localStorage', async () => {
    setToken('tok-123')
    mockFetch(createJsonResponse({ status: 'success', data: null }))

    await apiClient.get('/api/v2/platform/auth/me')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers.Authorization).toBe('Bearer tok-123')
  })

  it('omits Authorization header when no token is stored', async () => {
    mockFetch(createJsonResponse({ status: 'success', data: null }))

    await apiClient.get('/api/v2/platform/auth/me')

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call[1].headers).not.toHaveProperty('Authorization')
  })

  it('clears token and redirects to login on 401 unauthorized', async () => {
    const navigate = vi.fn()
    setUnauthorizedNavigate(navigate)
    setToken('tok-expired')
    mockFetch(createJsonResponse({ status: 'error', error: 'unauthorized', errorType: 'unauthorized' }, { status: 401 }))

    await expect(apiClient.get('/api/v2/platform/dashboard/summary')).rejects.toThrow()

    expect(getToken()).toBeNull()
    expect(navigate).toHaveBeenCalled()
  })

  it('does not redirect when the login endpoint itself returns 401', async () => {
    const navigate = vi.fn()
    setUnauthorizedNavigate(navigate)
    mockFetch(createJsonResponse({ status: 'error', error: 'bad credentials', errorType: 'unauthorized' }, { status: 401 }))

    await expect(apiClient.post('/api/v2/platform/auth/login', { body: { username: 'a', password: 'b' } })).rejects.toThrow()

    expect(navigate).not.toHaveBeenCalled()
  })

  it('clears token and user info via clearToken', async () => {
    setToken('tok')
    expect(getToken()).toBe('tok')
    clearToken()
    expect(getToken()).toBeNull()
  })
})
