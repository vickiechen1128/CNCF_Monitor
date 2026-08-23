import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { metricLibraryApi } from './metricLibrary'

describe('metricLibrary API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(body: unknown, init: ResponseInit = {}) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
      }),
    )
  }

  function lastFetchCall() {
    return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
  }

  function lastUrlInstance(): URL {
    return new URL(String(lastFetchCall()[0]), window.location.origin)
  }

  function lastInitBody(): unknown {
    const text = String(lastFetchCall()[1]?.body ?? '')
    return text ? JSON.parse(text) : undefined
  }

  it('list sends monitor_type/metric_type/category/keyword/page params', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [],
        total: 0,
        page: 1,
        page_size: 20,
      },
    })

    await metricLibraryApi.list({ monitor_type: 'host_linux', metric_type: 'gauge', category: 'cpu', keyword: 'cpu', page: 2, page_size: 20 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/metric-library')
    expect(url.searchParams.get('monitor_type')).toBe('host_linux')
    expect(url.searchParams.get('metric_type')).toBe('gauge')
    expect(url.searchParams.get('category')).toBe('cpu')
    expect(url.searchParams.get('keyword')).toBe('cpu')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('create POSTs user-extended metric with monitor_types anchors', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 1,
        metric_name: 'mysql_slow_queries_total',
        metric_type: 'counter',
        is_builtin: false,
        enabled: true,
      },
    })

    const res = await metricLibraryApi.create({
      metric_name: 'mysql_slow_queries_total',
      metric_type: 'counter',
      monitor_types: [{ monitor_type: 'mysql', source_exporter: 'mysqld-exporter' }],
      help: 'Total slow queries',
      unit: 'count',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/metric-library')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      metric_name: 'mysql_slow_queries_total',
      metric_type: 'counter',
      monitor_types: [{ monitor_type: 'mysql', source_exporter: 'mysqld-exporter' }],
      help: 'Total slow queries',
      unit: 'count',
    })
    expect(res.data.is_builtin).toBe(false)
  })

  it('update PUTs /:metric_id with builtin-edit restricted fields', async () => {
    mockFetch({
      status: 'success',
      data: { id: 1, metric_name: 'mysql_slow_queries_total', metric_type: 'counter', help: 'Updated', enabled: true },
    })

    await metricLibraryApi.update(1, { help: 'Updated', enabled: true })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/metric-library/1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ help: 'Updated', enabled: true })
  })

  it('throws on forbidden error envelope for builtin metric edit', async () => {
    mockFetch({ status: 'error', errorType: 'forbidden', error: 'builtin metric is read-only' }, { status: 403 })

    await expect(metricLibraryApi.update(1, { help: 'x' })).rejects.toThrow('builtin metric is read-only')
  })
})