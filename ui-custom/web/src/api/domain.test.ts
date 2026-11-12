import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  zoneTypeApi,
  networkDomainApi,
  tenantApi,
  resolveNetworkDomainImpact,
} from './domain'

describe('domain API (v3)', () => {
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
    return new URL(String(lastFetchCall()[0]))
  }

  function lastInitBody(): unknown {
    const text = String(lastFetchCall()[1]?.body ?? '')
    return text ? JSON.parse(text) : undefined
  }

  const onboardingItem = {
    network_domain_id: 'mc-zhw-a',
    name: '政务网A区',
    description: '示例',
    domain_type: 'edge',
    domain_type_label: '采集节点域',
    tenant_id: 'platform_admin',
    authorized_tenant_ids: ['platform_admin'],
    status: 'enabled',
    cloud_code: 'PUB-TX',
    zone_type: 'internet',
    registration_status: 'created',
    monitored_at: null,
    token_masked: '',
    agent_count: 0,
    online_agent_count: 0,
    last_heartbeat_at: null,
    last_config_version: '',
    center_endpoint: '',
    remote_write_url: '',
    created_at: '2026-11-11T10:00:00Z',
    updated_at: '2026-11-11T10:00:00Z',
  }

  it('zoneTypeApi.list hits /api/v3/platform/zone-types and unwraps {list,total}', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          { code: 'internet', display_name: '互联网区', enabled: true },
          { code: 'extranet', display_name: '政务外网区', enabled: false },
        ],
        total: 2,
      },
    })

    const res = await zoneTypeApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/zone-types')
    expect(res.status).toBe('success')
    expect(res.data).toHaveLength(2)
    expect(res.data[0].code).toBe('internet')
  })

  it('networkDomainApi.list sends admin view + pagination/filter params and maps the enriched item', async () => {
    mockFetch({
      status: 'success',
      data: { list: [onboardingItem], total: 1, page: 2, page_size: 20 },
    })

    const res = await networkDomainApi.list({
      view: 'admin',
      page: 2,
      page_size: 20,
      status: 'enabled',
      zone_type: 'internet',
      tenant_id: 'platform_admin',
      keyword: '政务',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/network-domains')
    expect(url.searchParams.get('view')).toBe('admin')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('20')
    expect(url.searchParams.get('status')).toBe('enabled')
    expect(url.searchParams.get('zone_type')).toBe('internet')
    expect(url.searchParams.get('tenant_id')).toBe('platform_admin')
    expect(url.searchParams.get('keyword')).toBe('政务')
    expect(res.data.page).toBe(2)
    expect(res.data.list[0]).toMatchObject({
      id: 'mc-zhw-a',
      name: '政务网A区',
      domain_type: 'edge',
      tenant_id: 'platform_admin',
      authorized_tenant_ids: ['platform_admin'],
      status: 'enabled',
      is_monitored: false,
      has_online_agents: false,
    })
  })

  it('networkDomainApi.get hits the v3 detail and maps network_domain_id to id', async () => {
    mockFetch({ status: 'success', data: { ...onboardingItem, registration_status: 'monitored', agent_count: 2, online_agent_count: 1 } })

    const res = await networkDomainApi.get('mc-zhw-a')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/network-domains/mc-zhw-a')
    expect(res.data.id).toBe('mc-zhw-a')
    expect(res.data.is_monitored).toBe(true)
    expect(res.data.has_online_agents).toBe(true)
  })

  it('networkDomainApi.create POSTs body without tenant_id / domain_type', async () => {
    mockFetch({
      status: 'success',
      data: { id: 'mc-zhw-a', name: '政务网A区', domain_type: 'edge' },
    })

    await networkDomainApi.create({
      name: '政务网A区',
      cloud_code: 'PUB-TX',
      zone_type: 'internet',
      authorized_tenant_ids: ['platform_admin'],
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/network-domains')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      name: '政务网A区',
      cloud_code: 'PUB-TX',
      zone_type: 'internet',
      authorized_tenant_ids: ['platform_admin'],
    })
  })

  it('networkDomainApi.update PUTs editable fields only (no tenant_id/cloud_code)', async () => {
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
    expect(url.pathname).toBe('/api/v3/platform/network-domains/mc-zhw-a')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toEqual({
      name: '政务网A区(改)',
      zone_type: 'extranet',
      authorized_tenant_ids: ['platform_admin', 't-tenant-b'],
    })
    expect(body).not.toHaveProperty('tenant_id')
    expect(body).not.toHaveProperty('cloud_code')
  })

  it('networkDomainApi.updateStatus PATCHes /:id/status with status body', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 'mc-zhw-a',
        status: 'disabled',
        impact: { resource_count: 5, managed_edge_agent_count: 2 },
      },
    })

    const res = await networkDomainApi.updateStatus('mc-zhw-a', 'disabled')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/network-domains/mc-zhw-a/status')
    expect(lastFetchCall()[1]?.method).toBe('PATCH')
    expect(lastInitBody()).toEqual({ status: 'disabled' })
    expect(res.data.impact?.resource_count).toBe(5)
  })

  it('networkDomainApi.remove DELETEs /:id', async () => {
    mockFetch({ status: 'success', data: { id: 'mc-zhw-a', deleted: true } })

    await networkDomainApi.remove('mc-zhw-a')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/network-domains/mc-zhw-a')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
  })

  it('resolveNetworkDomainImpact reads data.impact', () => {
    const impact = resolveNetworkDomainImpact({
      status: 'success',
      data: {
        id: 'mc-a',
        status: 'disabled',
        impact: {
          resource_count: 3,
          managed_edge_agent_count: 1,
          has_online_agents: true,
          monitoring_available: false,
          sample_resources: [{ resource_id: 'r-1', resource_category: 'host', name: 'web-01' }],
        },
      },
    })
    expect(impact).toEqual({
      resource_count: 3,
      managed_edge_agent_count: 1,
      has_online_agents: true,
      monitoring_available: false,
      sample_resources: [{ resource_id: 'r-1', resource_category: 'host', name: 'web-01' }],
    })
  })

  it('resolveNetworkDomainImpact returns null when data or impact is missing', () => {
    expect(resolveNetworkDomainImpact({ status: 'success', data: null })).toBeNull()
    expect(resolveNetworkDomainImpact({ status: 'success', data: { id: 'mc-a' } })).toBeNull()
  })

  it('tenantApi.list hits /api/v3/platform/tenants', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await tenantApi.list({ page: 1, page_size: 20 })

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/tenants')
  })

  it('tenantApi.get hits /api/v3/platform/tenants/:id with encoded id', async () => {
    mockFetch({
      status: 'success',
      data: { id: 'platform_admin', name: '平台管理员', status: 'active' },
    })

    const res = await tenantApi.get('platform_admin')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/tenants/platform_admin')
    expect(res.data.id).toBe('platform_admin')
  })
})
