import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from './client'
import { resourceApi, businessDomainApi, importApi } from './resources'

describe('resources API', () => {
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

  it('resourceApi.list sends pagination + filter params', async () => {
    mockFetch({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })

    await resourceApi.list({
      resource_category: 'host',
      network_domain_id: 'mc-zhw-a',
      keyword: 'web',
      is_monitored: false,
      page: 2,
      page_size: 50,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources')
    expect(url.searchParams.get('resource_category')).toBe('host')
    expect(url.searchParams.get('network_domain_id')).toBe('mc-zhw-a')
    expect(url.searchParams.get('keyword')).toBe('web')
    expect(url.searchParams.get('is_monitored')).toBe('false')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('50')
  })

  it('resourceApi.list drops undefined params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 50 } })

    await resourceApi.list({ resource_category: 'database', keyword: undefined })

    const url = lastUrlInstance()
    expect(url.searchParams.get('resource_category')).toBe('database')
    expect(url.searchParams.has('keyword')).toBe(false)
  })

  it('resourceApi.create POSTs resource body', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_id: 'r-1',
        resource_category: 'host',
        network_domain_id: 'default',
        biz_code: 'infra',
        env: 'prod',
        instance_name: 'web-01',
        instance_ip: '10.0.0.1',
        status: 'online',
      },
    })

    const res = await resourceApi.create({
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'infra',
      env: 'prod',
      instance_name: 'web-01',
      instance_ip: '10.0.0.1',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'infra',
      env: 'prod',
      instance_name: 'web-01',
      instance_ip: '10.0.0.1',
    })
    expect(res.data.resource_id).toBe('r-1')
  })

  it('resourceApi.update PUTs /:resource_id with editable body', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_id: 'r-1',
        resource_category: 'application',
        biz_code: 'payment',
        service_name: 'pay-api',
        endpoint: '10.0.0.5:8080',
      },
    })

    await resourceApi.update('r-1', {
      biz_code: 'payment',
      status: 'maintenance',
      service_name: 'pay-api',
      endpoint: '10.0.0.5:8080',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({
      biz_code: 'payment',
      status: 'maintenance',
      service_name: 'pay-api',
      endpoint: '10.0.0.5:8080',
    })
  })

  it('resourceApi.remove DELETEs /:resource_id', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1' } })

    const res = await resourceApi.remove('r-1')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.resource_id).toBe('r-1')
  })

  it('resourceApi.template downloads xlsx blob via native fetch', async () => {
    const blob = new Blob(['file-content'], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      }),
    )

    const result = await resourceApi.template('host')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/host/template')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(result).toBeInstanceOf(Blob)
  })

  it('resourceApi.template throws ApiError on not_found error envelope', async () => {
    mockFetch(
      { status: 'error', errorType: 'not_found', error: 'unknown resource type' },
      { status: 404 },
    )

    await expect(resourceApi.template('generic_target')).rejects.toThrow(ApiError)
  })

  it('resourceApi.importExcel builds FormData(file+mode) and posts multipart', async () => {
    mockFetch({
      status: 'success',
      data: { total: 1, success: 1, failed: 0, errors: [] },
    })

    const file = new File(['x'], 'hosts.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const res = await resourceApi.importExcel('host', file, 'create_only')

    const call = lastFetchCall()
    const url = new URL(String(call[0]), window.location.origin)
    expect(url.pathname).toBe('/api/v2/platform/resources/host/import')
    expect(call[1]?.method).toBe('POST')
    // 不手动设置 Content-Type：浏览器自动带 multipart boundary
    expect(call[1]?.headers).toBeUndefined()
    const body = call[1]?.body
    expect(body).toBeInstanceOf(FormData)
    const formData = body as FormData
    expect(formData.get('file')).toBe(file)
    expect(formData.get('mode')).toBe('create_only')
    expect(res.data.success).toBe(1)
  })

  it('resourceApi.importExcel parses upsert result with updated count', async () => {
    mockFetch({
      status: 'success',
      data: {
        total: 100,
        success: 83,
        updated: 15,
        failed: 2,
        errors: [
          {
            row: 5,
            resource_category: 'host',
            field: 'instance_ip',
            value: '999.999.999.999',
            reason: 'IP 格式不正确',
          },
        ],
      },
    })

    const file = new File(['x'], 'hosts.xlsx')
    const res = await resourceApi.importExcel('host', file, 'upsert')

    expect(res.data.updated).toBe(15)
    expect(res.data.failed).toBe(2)
    expect(res.data.errors[0].row).toBe(5)
    expect(res.data.errors[0].reason).toBe('IP 格式不正确')
  })

  it('resourceApi.labels GETs {items,total} with source_map', async () => {
    mockFetch({
      status: 'success',
      data: {
        total: 2,
        items: [
          { id: 1, key: 'app', value: 'web', source: 'system', source_map: 'app_name→app' },
          { id: 2, key: 'team', value: 'ops', source: 'user' },
        ],
      },
    })

    const res = await resourceApi.labels('r-1')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1/labels')
    expect(res.data.total).toBe(2)
    expect(res.data.items[0].source).toBe('system')
    expect(res.data.items[0].source_map).toBe('app_name→app')
    expect(res.data.items[1].source).toBe('user')
  })

  it('resourceApi.createLabel POSTs {key,value}', async () => {
    mockFetch({
      status: 'success',
      data: { id: 3, key: 'team', value: 'ops', source: 'user' },
    })

    await resourceApi.createLabel('r-1', { key: 'team', value: 'ops' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1/labels')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ key: 'team', value: 'ops' })
  })

  it('resourceApi.updateLabel PUTs /labels/:label_id with value', async () => {
    mockFetch({
      status: 'success',
      data: { id: 3, key: 'team', value: 'sre', source: 'user' },
    })

    await resourceApi.updateLabel('r-1', 3, { value: 'sre' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1/labels/3')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ value: 'sre' })
  })

  it('resourceApi.removeLabel DELETEs /labels/:label_id', async () => {
    mockFetch({ status: 'success', data: { label_id: 3 } })

    const res = await resourceApi.removeLabel('r-1', 3)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1/labels/3')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.label_id).toBe(3)
  })

  it('businessDomainApi.list GETs /business-domains and parses {list,total}', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          { code: 'infra', name: '公共基础设施', description: '兜底', enabled: true },
          { code: 'payment', name: '支付业务', enabled: true },
        ],
        total: 2,
      },
    })

    const res = await businessDomainApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/business-domains')
    expect(res.data.total).toBe(2)
    expect(res.data.list[0].code).toBe('infra')
    expect(res.data.list[0].enabled).toBe(true)
  })

  it('importApi.list GETs /imports with filter params', async () => {
    mockFetch({
      status: 'success',
      data: { list: [], total: 0, page: 1, page_size: 50 },
    })

    await importApi.list({
      resource_category: 'host',
      status: 'partial',
      page: 1,
      page_size: 50,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/imports')
    expect(url.searchParams.get('resource_category')).toBe('host')
    expect(url.searchParams.get('status')).toBe('partial')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('50')
  })

  it('importApi.get GETs /imports/:import_id and parses detail with errors', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 7,
        import_no: 'IMP-20260822-001',
        resource_category: 'host',
        mode: 'upsert',
        total: 100,
        success: 83,
        updated: 15,
        failed: 2,
        status: 'partial',
        operator: 'platform_admin',
        created_at: '2026-08-22T10:00:00Z',
        errors: [{ row: 5, resource_category: 'host', field: 'instance_ip', reason: 'IP 格式不正确' }],
      },
    })

    const res = await importApi.get(7)

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/imports/7')
    expect(res.data.import_no).toBe('IMP-20260822-001')
    expect(res.data.mode).toBe('upsert')
    expect(res.data.status).toBe('partial')
    expect(res.data.errors[0].field).toBe('instance_ip')
  })
})
