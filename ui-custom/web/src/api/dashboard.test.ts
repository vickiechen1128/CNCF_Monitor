import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dashboardApi } from './dashboard'

describe('dashboardApi.getSummary', () => {
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

  function lastUrlInstance(): URL {
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    return new URL(String(calls[0][0]))
  }

  it('GETs /api/v3/platform/dashboard/summary', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_count: 12,
        monitored_count: 8,
        scrape_job_count: 5,
        scrape_job_enabled_count: 4,
        domain_count: 4,
      },
    })

    const res = await dashboardApi.getSummary()

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/dashboard/summary')
    const method = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.method
    expect(method).toBe('GET')
    expect(res.status).toBe('success')
    expect(res.data.resource_count).toBe(12)
    expect(res.data.monitored_count).toBe(8)
    expect(res.data.scrape_job_count).toBe(5)
    expect(res.data.scrape_job_enabled_count).toBe(4)
  })
})