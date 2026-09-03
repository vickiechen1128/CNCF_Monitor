import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { targetsApi } from './targets'

describe('targets API', () => {
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

  it('list sends job/network_domain/health params and reads data.activeTargets', async () => {
    mockFetch({
      status: 'success',
      data: {
        activeTargets: [
          {
            scrapePool: 'prod-mysql-01',
            job: 'prod-mysql-01',
            instance: '10.0.0.1:9104',
            network_domain: 'default',
            health: 'up',
            lastScrape: '2026-09-01T10:00:00Z',
            lastError: '',
            scrapeDuration: 0.023,
            resource_id: 'res-1',
          },
        ],
        droppedTargets: [],
        targetsByJob: {},
      },
    })

    const res = await targetsApi.list({ job: 'prod-mysql-01', network_domain: 'default', health: 'up' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v1/targets')
    expect(url.searchParams.get('job')).toBe('prod-mysql-01')
    expect(url.searchParams.get('network_domain')).toBe('default')
    expect(url.searchParams.get('health')).toBe('up')
    expect(res.data.activeTargets[0].health).toBe('up')
    expect(res.data.activeTargets[0].resource_id).toBe('res-1')
  })

  it('list with no params issues GET only (透传语义，不强制过滤)', async () => {
    mockFetch({
      status: 'success',
      data: { activeTargets: [], droppedTargets: [], targetsByJob: {} },
    })

    await targetsApi.list()

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v1/targets')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // 未传参时不附带任何 query
    expect(url.searchParams.toString()).toBe('')
  })

  it('list supports state passthrough', async () => {
    mockFetch({ status: 'success', data: { activeTargets: [], droppedTargets: [], targetsByJob: {} } })

    await targetsApi.list({ state: 'active' })

    expect(lastUrlInstance().searchParams.get('state')).toBe('active')
  })
})