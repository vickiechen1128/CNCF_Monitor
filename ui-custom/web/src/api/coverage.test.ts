import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { coverageApi } from './coverage'

describe('coverage API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(body: unknown) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

  function lastFetchCall() {
    return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
  }

  function lastUrlInstance(): URL {
    return new URL(String(lastFetchCall()[0]), window.location.origin)
  }

  it('list sends network_domain/resource_category/state/page/page_size params', async () => {
    mockFetch({
      status: 'success',
      data: {
        items: [
          { resource_id: 'srv-1', resource_category: 'host', instance_name: 'web-01', monitor_state: 'collecting', health: 'up', last_error: '' },
          { resource_id: 'srv-2', resource_category: 'host', instance_name: 'web-02', monitor_state: 'pending_down', health: 'down', last_error: 'connection refused' },
          { resource_id: 'srv-3', resource_category: 'host', instance_name: 'web-03', monitor_state: 'not_monitored', health: null, last_error: '' },
        ],
        total: 3,
        summary: { total: 3, collecting: 1, pending_down: 1, not_monitored: 1, coverage_rate: 0.33 },
      },
    })

    const res = await coverageApi.list({
      network_domain: 'default',
      resource_category: 'host',
      state: 'collecting',
      page: 1,
      page_size: 500,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v1/health/coverage')
    expect(url.searchParams.get('network_domain')).toBe('default')
    expect(url.searchParams.get('resource_category')).toBe('host')
    expect(url.searchParams.get('state')).toBe('collecting')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('500')
    // 信封 items 键
    expect(res.data.items).toHaveLength(3)
    expect(res.data.total).toBe(3)
  })

  it('list returns summary with coverage_rate', async () => {
    mockFetch({
      status: 'success',
      data: {
        items: [],
        total: 0,
        summary: { total: 0, collecting: 0, pending_down: 0, not_monitored: 0, coverage_rate: 0 },
      },
    })

    const res = await coverageApi.list({ page: 1, page_size: 500 })

    expect(res.data.summary.coverage_rate).toBe(0)
    expect(res.data.items).toEqual([])
  })
})