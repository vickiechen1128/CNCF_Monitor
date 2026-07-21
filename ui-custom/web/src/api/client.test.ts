import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { apiClient, request } from './client'

describe('apiClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
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
})
