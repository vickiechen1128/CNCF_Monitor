import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { zoneTypeApi, networkDomainApi, tenantApi } from './domain'

describe('domain API', () => {
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

  function lastUrl(): string {
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    return new URL(call[0]).toString()
  }

  function lastUrlInstance(): URL {
    return new URL(lastUrl())
  }

  it('zoneTypeApi.list hits /api/v2/platform/zone-types and parses ApiResponse<Paginated>', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [{ code: 'internet', display_name: '互联网', enabled: true }],
        total: 1,
        page: 1,
        page_size: 20,
      },
    })

    const res = await zoneTypeApi.list({ page: 1, page_size: 20 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/zone-types')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('20')
    expect(res.status).toBe('success')
    expect(res.data.total).toBe(1)
    expect(res.data.list[0].code).toBe('internet')
  })

  it('networkDomainApi.list hits /api/v2/platform/network-domains', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    const res = await networkDomainApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/network-domains')
    expect(res.status).toBe('success')
  })

  it('tenantApi.get hits /api/v2/platform/tenants/:id with encoded id', async () => {
    mockFetch({
      status: 'success',
      data: { id: 'platform_admin', name: '平台管理员', status: 'active' },
    })

    const res = await tenantApi.get('platform_admin')

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/tenants/platform_admin')
    expect(res.data.id).toBe('platform_admin')
  })
})