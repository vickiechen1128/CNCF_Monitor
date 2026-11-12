import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { targetsApi } from './targets'

describe('targets API（M09 v3 §7）', () => {
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

  it('list sends filters (search→keyword) and maps {list} to activeTargets', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          {
            job: 'prod-mysql-01',
            instance: '10.0.0.1:9104',
            network_domain: 'default',
            instance_name: '生产MySQL01',
            health: 'up',
            last_scrape: '2026-09-01T10:00:00Z',
            last_error: '',
            source: 'edge',
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
      },
    })

    const res = await targetsApi.list({
      job: 'prod-mysql-01',
      network_domain: 'default',
      health: 'up',
      search: 'mysql',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v1/targets')
    expect(url.searchParams.get('job')).toBe('prod-mysql-01')
    expect(url.searchParams.get('network_domain')).toBe('default')
    expect(url.searchParams.get('health')).toBe('up')
    expect(url.searchParams.get('keyword')).toBe('mysql')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('100')

    expect(res.data.activeTargets).toHaveLength(1)
    expect(res.data.activeTargets[0].scrapePool).toBe('prod-mysql-01')
    expect(res.data.activeTargets[0].instance_name).toBe('生产MySQL01')
    expect(res.data.activeTargets[0].lastScrape).toBe('2026-09-01T10:00:00Z')
    expect(res.data.activeTargets[0].source).toBe('edge')
    expect(res.data.activeTargets[0].health).toBe('up')
  })

  it('list defaults to page=1&page_size=100 when no params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0 } })

    await targetsApi.list()

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v1/targets')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('100')
  })

  it('list supports health passthrough and unknown fallback', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [{ job: 'j', instance: 'i', network_domain: 'd', health: '' }],
        total: 1,
      },
    })

    const res = await targetsApi.list({ health: 'down' })

    expect(lastUrlInstance().searchParams.get('health')).toBe('down')
    expect(res.data.activeTargets[0].health).toBe('unknown')
  })
})
