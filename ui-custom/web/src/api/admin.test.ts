import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { userApi, loginLogApi, tenantAdminApi } from './admin'

describe('admin API (v3)', () => {
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

  const userItem = {
    id: 'u1',
    tenant_id: 'platform_admin',
    username: 'ops01',
    display_name: '运维一号',
    role: 'user',
    status: 'active',
    last_login_at: null,
    created_at: '2026-11-11T10:00:00Z',
  }

  const loginLogItem = {
    id: 'l1',
    username: 'ops01',
    success: false,
    created_at: '2026-11-11T10:00:00Z',
  }

  const tenantItem = {
    id: 'platform_admin',
    name: '系统平台租户',
    network_domain_ids: [],
    multi_site_enabled: false,
    is_platform_admin: true,
    status: 'active',
    created_at: '2026-11-11T10:00:00Z',
    updated_at: '2026-11-11T10:00:00Z',
  }

  it('userApi.list hits /api/v3/platform/users and parses the v3 {list,total,page,page_size} envelope', async () => {
    mockFetch({ status: 'success', data: { list: [userItem], total: 1, page: 1, page_size: 20 } })

    const res = await userApi.list({ keyword: 'ops', status: 'active', page: 1, page_size: 20 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/users')
    expect(url.searchParams.get('keyword')).toBe('ops')
    expect(url.searchParams.get('status')).toBe('active')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('20')
    // v3 handler 不支持 username 参数，用户名检索走 keyword
    expect(url.searchParams.has('username')).toBe(false)
    expect(res.status).toBe('success')
    expect(res.data.list).toHaveLength(1)
    expect(res.data.list[0].tenant_id).toBe('platform_admin')
    expect(res.data.list[0].last_login_at).toBeNull()
    expect(res.data.total).toBe(1)
    expect(res.data.page_size).toBe(20)
  })

  it('userApi.create POSTs only username/display_name/password/role', async () => {
    mockFetch({ status: 'success', data: userItem })

    await userApi.create({
      username: 'ops01',
      display_name: '运维一号',
      password: 'secret123',
      role: 'user',
    })

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/users')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      username: 'ops01',
      display_name: '运维一号',
      password: 'secret123',
      role: 'user',
    })
  })

  it('userApi.update PUTs only mutable fields (no id/username/status)', async () => {
    mockFetch({ status: 'success', data: { ...userItem, display_name: '运维一号(改)', role: 'admin' } })

    await userApi.update('u1', { display_name: '运维一号(改)', role: 'admin' })

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/users/u1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toEqual({ display_name: '运维一号(改)', role: 'admin' })
    // v3 严格解码：夹带不可变字段会 400
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('username')
    expect(body).not.toHaveProperty('status')
  })

  it('userApi.updateStatus PATCHes /status with the status body', async () => {
    mockFetch({ status: 'success', data: { ...userItem, status: 'disabled' } })

    await userApi.updateStatus('u1', 'disabled')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/users/u1/status')
    expect(lastFetchCall()[1]?.method).toBe('PATCH')
    expect(lastInitBody()).toEqual({ status: 'disabled' })
  })

  it('userApi.resetPassword PUTs /password with new_password', async () => {
    mockFetch({ status: 'success', data: { id: 'u1', password_reset: true } })

    await userApi.resetPassword('u1', { new_password: 'newpass123' })

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/users/u1/password')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ new_password: 'newpass123' })
  })

  it('userApi.remove DELETEs /api/v3/platform/users/:id', async () => {
    mockFetch({ status: 'success', data: { id: 'u1', deleted: true } })

    await userApi.remove('u1')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/users/u1')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
  })

  it('loginLogApi.list hits /api/v3/platform/login-logs and forwards username/success/pagination', async () => {
    mockFetch({ status: 'success', data: { list: [loginLogItem], total: 1, page: 2, page_size: 10 } })

    const res = await loginLogApi.list({ username: 'ops01', success: 'false', page: 2, page_size: 10 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/login-logs')
    expect(url.searchParams.get('username')).toBe('ops01')
    expect(url.searchParams.get('success')).toBe('false')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('10')
    expect(res.data.page).toBe(2)
    expect(res.data.list[0].success).toBe(false)
  })

  it('tenantAdminApi.list hits /api/v3/platform/tenants with the supported status filter', async () => {
    mockFetch({ status: 'success', data: { list: [tenantItem], total: 1, page: 1, page_size: 20 } })

    const res = await tenantAdminApi.list({ status: 'active' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/tenants')
    expect(url.searchParams.get('status')).toBe('active')
    expect(res.data.list[0].is_platform_admin).toBe(true)
    expect(res.data.total).toBe(1)
  })

  it('tenantAdminApi.get hits the v3 detail path', async () => {
    mockFetch({ status: 'success', data: tenantItem })

    const res = await tenantAdminApi.get('platform_admin')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/tenants/platform_admin')
    expect(res.data.updated_at).toBe('2026-11-11T10:00:00Z')
  })

  it('tenantAdminApi.update PUTs only name/multi_site_enabled (no id/status/is_platform_admin)', async () => {
    mockFetch({ status: 'success', data: { ...tenantItem, name: '新租户名', multi_site_enabled: true } })

    await tenantAdminApi.update('platform_admin', { name: '新租户名', multi_site_enabled: true })

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/tenants/platform_admin')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toEqual({ name: '新租户名', multi_site_enabled: true })
    expect(body).not.toHaveProperty('id')
    expect(body).not.toHaveProperty('status')
    expect(body).not.toHaveProperty('is_platform_admin')
  })
})
