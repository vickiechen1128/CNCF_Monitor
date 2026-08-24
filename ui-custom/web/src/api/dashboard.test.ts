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

  it('GETs /api/v2/platform/dashboard/summary', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_count: 12,
        pending_draft_count: 3,
        domain_count: 4,
        recent_deployments: [],
      },
    })

    const res = await dashboardApi.getSummary()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/dashboard/summary')
    const method = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.method
    expect(method).toBe('GET')
    expect(res.status).toBe('success')
    expect(res.data.resource_count).toBe(12)
    expect(res.data.recent_deployments).toEqual([])
  })

  it('parses recent deployments list', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_count: 1,
        pending_draft_count: 0,
        domain_count: 1,
        recent_deployments: [
          {
            id: 'd1',
            change_no: 'CHG-001',
            network_domain_name: '政务网A区',
            status: 'success',
            triggered_at: '2026-08-24T10:00:00Z',
          },
        ],
      },
    })

    const res = await dashboardApi.getSummary()

    expect(res.data.recent_deployments).toHaveLength(1)
    expect(res.data.recent_deployments[0].change_no).toBe('CHG-001')
    expect(res.data.recent_deployments[0].network_domain_name).toBe('政务网A区')
  })
})