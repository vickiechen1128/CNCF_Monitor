import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  zoneTypeApi,
  networkDomainApi,
  tenantApi,
  resolveNetworkDomainImpact,
} from './domain'

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

  function lastFetchCall() {
    return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
  }

  function lastUrl(): string {
    return new URL(lastFetchCall()[0]).toString()
  }

  function lastUrlInstance(): URL {
    return new URL(lastUrl())
  }

  function lastInitBody(): unknown {
    const text = String(lastFetchCall()[1]?.body ?? '')
    return text ? JSON.parse(text) : undefined
  }

  it('zoneTypeApi.list hits /api/v2/platform/zone-types and parses raw array', async () => {
    mockFetch({
      status: 'success',
      data: [
        { code: 'internet', display_name: '互联网区', enabled: true },
        { code: 'extranet', display_name: '政务外网区', enabled: false },
      ],
    })

    const res = await zoneTypeApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/zone-types')
    expect(res.status).toBe('success')
    expect(Array.isArray(res.data)).toBe(true)
    expect(res.data[0].code).toBe('internet')
  })

  it('networkDomainApi.list sends pagination + filter params', async () => {
    mockFetch({
      status: 'success',
      data: { list: [], total: 0, page: 2, page_size: 20 },
    })

    await networkDomainApi.list({
      page: 2,
      page_size: 20,
      status: 'enabled',
      zone_type: 'internet',
      tenant_id: 'platform_admin',
      name: '政务',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/network-domains')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('20')
    expect(url.searchParams.get('status')).toBe('enabled')
    expect(url.searchParams.get('zone_type')).toBe('internet')
    expect(url.searchParams.get('tenant_id')).toBe('platform_admin')
    expect(url.searchParams.get('name')).toBe('政务')
  })

  it('networkDomainApi.create POSTs body without tenant_id', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 'mc-zhw-a',
        name: '政务网A区',
        domain_type: 'edge',
        zone_type: 'internet',
        tenant_id: 'platform_admin',
        authorized_tenant_ids: ['platform_admin'],
        status: 'enabled',
      },
    })

    const res = await networkDomainApi.create({
      name: '政务网A区',
      domain_type: 'edge',
      zone_type: 'internet',
      authorized_tenant_ids: ['platform_admin'],
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/network-domains')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toEqual({
      name: '政务网A区',
      domain_type: 'edge',
      zone_type: 'internet',
      authorized_tenant_ids: ['platform_admin'],
    })
    expect(body).not.toHaveProperty('tenant_id')
    expect(res.data.id).toBe('mc-zhw-a')
  })

  it('networkDomainApi.update PUTs editable fields only (no tenant_id)', async () => {
    mockFetch({
      status: 'success',
      data: { id: 'mc-zhw-a', name: '政务网A区(改)', tenant_id: 'platform_admin' },
    })

    await networkDomainApi.update('mc-zhw-a', {
      name: '政务网A区(改)',
      zone_type: 'extranet',
      authorized_tenant_ids: ['platform_admin', 't-tenant-b'],
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/network-domains/mc-zhw-a')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toEqual({
      name: '政务网A区(改)',
      zone_type: 'extranet',
      authorized_tenant_ids: ['platform_admin', 't-tenant-b'],
    })
    expect(body).not.toHaveProperty('tenant_id')
  })

  it('networkDomainApi.updateStatus PATCHes /:id/status with status body', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 'mc-zhw-a',
        status: 'disabled',
        resource_count: 5,
        managed_edge_agent_count: 2,
      },
    })

    const res = await networkDomainApi.updateStatus('mc-zhw-a', 'disabled')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/network-domains/mc-zhw-a/status')
    expect(lastFetchCall()[1]?.method).toBe('PATCH')
    expect(lastInitBody()).toEqual({ status: 'disabled' })
    expect(res.data.resource_count).toBe(5)
  })

  it('networkDomainApi.remove DELETEs /:id', async () => {
    mockFetch({ status: 'success', data: null })

    await networkDomainApi.remove('mc-zhw-a')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/network-domains/mc-zhw-a')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
  })

  it('resolveNetworkDomainImpact reads impact from data.impact', () => {
    const impact = resolveNetworkDomainImpact({
      status: 'success',
      data: { id: 'mc-a', status: 'disabled', impact: { resource_count: 3, managed_edge_agent_count: 1 } },
    })
    expect(impact).toEqual({ resource_count: 3, managed_edge_agent_count: 1 })
  })

  it('resolveNetworkDomainImpact reads flat data fields (incl. edge_agent_count alias)', () => {
    const impact = resolveNetworkDomainImpact({
      status: 'success',
      data: { id: 'mc-a', resource_count: 7, edge_agent_count: 4 },
    })
    expect(impact).toEqual({ resource_count: 7, managed_edge_agent_count: 4 })
  })

  it('resolveNetworkDomainImpact returns null when data is null', () => {
    expect(resolveNetworkDomainImpact({ status: 'success', data: null })).toBeNull()
  })

  it('tenantApi.list hits /api/v2/platform/tenants', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await tenantApi.list({ page: 1, page_size: 20 })

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/tenants')
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
