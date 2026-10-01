import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, clearToken, setToken } from './client'
import {
  resourceApi,
  businessDomainApi,
  serviceDictApi,
  appPlatformRelApi,
  cloudDictApi,
  importApi,
} from './resources'

// vitest jsdom 环境的 window.localStorage 存储行为不可靠，用内存 Map 替换（与 client.test.ts 一致）。
const storageMap = new Map<string, string>()
const localStorageMock: Storage = {
  get length() {
    return storageMap.size
  },
  clear: () => storageMap.clear(),
  getItem: (key) => storageMap.get(key) ?? null,
  key: (index) => Array.from(storageMap.keys())[index] ?? null,
  removeItem: (key) => storageMap.delete(key),
  setItem: (key, value) => storageMap.set(key, String(value)),
}
Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true })

describe('resources API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearToken()
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
    // 响应体用 Uint8Array 构造：jsdom 的 Blob 无 .stream()，undici Response 拒收
    const body = new TextEncoder().encode('file-content')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      }),
    )

    const result = await resourceApi.template('host')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/host/template')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // 结构断言而非 instanceof：res.blob() 的 Blob 类身份随运行时（undici / jsdom）而异
    expect(result).toHaveProperty('size', body.byteLength)
    expect(result).toHaveProperty(
      'type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  })

  it('resourceApi.template throws ApiError on not_found error envelope', async () => {
    mockFetch(
      { status: 'error', errorType: 'not_found', error: 'unknown resource type' },
      { status: 404 },
    )

    await expect(resourceApi.template('generic_target')).rejects.toThrow(ApiError)
  })

  // 回归：模板下载 / Excel 导入走 rawRequest，必须携带 Authorization Bearer Token，
  // 否则后端 au-02 认证中间件会以 401「未认证或会话已失效」拒绝。
  it('resourceApi.template attaches Authorization Bearer token', async () => {
    setToken('tok-m07')
    // 字符串响应体：jsdom 的 Blob 无 .stream()，undici Response 拒收
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('x', { status: 200 }),
    )

    await resourceApi.template('host')

    const headers = (lastFetchCall()[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-m07')
  })

  it('resourceApi.importExcel attaches Authorization Bearer token', async () => {
    setToken('tok-m07')
    mockFetch({ status: 'success', data: { total: 0, success: 0, failed: 0, errors: [] } })

    await resourceApi.importExcel('host', new File(['x'], 'hosts.xlsx'), 'create_only')

    const headers = (lastFetchCall()[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-m07')
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
    // 不手动设置 Content-Type：浏览器自动带 multipart boundary（rawRequest 只注入认证头）
    const headers = (call[1]?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
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
          { id: 1, key: 'app', value: 'web', source: 'system', source_map: 'app_code→app' },
          { id: 2, key: 'team', value: 'ops', source: 'user' },
        ],
      },
    })

    const res = await resourceApi.labels('r-1')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/resources/r-1/labels')
    expect(res.data.total).toBe(2)
    expect(res.data.items[0].source).toBe('system')
    expect(res.data.items[0].source_map).toBe('app_code→app')
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

  // 决策 98 / 102-③：云字典部署级只读——只有 list，不得给前端留任何写入口
  it('cloudDictApi.list GETs /cloud-dict and parses {list,total}', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          { cloud_code: 'PUB-TX', cloud_name: '腾讯云', cloud_type: 'PUB', carrier: 'TX', enabled: true },
          { cloud_code: 'GM-CU', cloud_name: '政务云（联通）', cloud_type: 'GM', carrier: 'CU', enabled: true },
        ],
        total: 2,
      },
    })

    const res = await cloudDictApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/cloud-dict')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(res.data.total).toBe(2)
    expect(res.data.list[0]).toMatchObject({
      cloud_code: 'PUB-TX',
      cloud_name: '腾讯云',
      cloud_type: 'PUB',
      carrier: 'TX',
      enabled: true,
    })
  })

  it('cloudDictApi exposes read-only list only (no create/update/remove)', () => {
    expect(Object.keys(cloudDictApi)).toEqual(['list'])
    expect(cloudDictApi).not.toHaveProperty('create')
    expect(cloudDictApi).not.toHaveProperty('update')
    expect(cloudDictApi).not.toHaveProperty('remove')
    expect(cloudDictApi).not.toHaveProperty('delete')
  })

  it('resourceApi.list items tolerate missing cloud_code / zone_type (host derived read-only)', async () => {
    // 决策 102 / 101：非 host 四类不带 zone_type；五类缺值不崩、由 UI 兜底 '-'
    mockFetch({
      status: 'success',
      data: {
        list: [
          { resource_id: 'r-1', resource_category: 'application', network_domain_id: 'mc-a', status: 'online' },
          {
            resource_id: 'r-2',
            resource_category: 'host',
            network_domain_id: 'mc-a',
            status: 'online',
            cloud_code: 'PUB-TX',
            zone_type: 'internet',
          },
        ],
        total: 2,
        page: 1,
        page_size: 50,
      },
    })

    const res = await resourceApi.list({ resource_category: 'host' })

    expect(res.data.list).toHaveLength(2)
    const [app, host] = res.data.list as unknown as Record<string, unknown>[]
    expect(app.cloud_code).toBeUndefined()
    expect(app.zone_type).toBeUndefined()
    expect(host.cloud_code).toBe('PUB-TX')
    expect(host.zone_type).toBe('internet')
  })

  // ---- 决策 111：应用↔平台关联 app_platform_rel（§5.24 / §6.1）----

  const relFixture = {
    rel_id: 'rel-1',
    app_code: 'order-service',
    platform_code: 'ecommerce',
    is_primary: true,
    created_at: '2026-09-28T10:00:00Z',
  }

  it('appPlatformRelApi.list GETs /app-platform-rel with filters and parses {list,total}', async () => {
    mockFetch({ status: 'success', data: { list: [relFixture], total: 1 } })

    const res = await appPlatformRelApi.list({ app_code: 'order-service', platform_code: 'ecommerce' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/app-platform-rel')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(url.searchParams.get('app_code')).toBe('order-service')
    expect(url.searchParams.get('platform_code')).toBe('ecommerce')
    // 信封键为 list（非分页接口的 items），total 同级下发
    expect(res.data.total).toBe(1)
    expect(Object.keys(res.data).sort()).toEqual(['list', 'total'])
    expect(res.data.list[0]).toMatchObject({
      rel_id: 'rel-1',
      app_code: 'order-service',
      platform_code: 'ecommerce',
      is_primary: true,
    })
  })

  it('appPlatformRelApi.list drops undefined filters', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0 } })

    await appPlatformRelApi.list({ app_code: 'order-service', platform_code: undefined })

    const url = lastUrlInstance()
    expect(url.searchParams.get('app_code')).toBe('order-service')
    expect(url.searchParams.has('platform_code')).toBe(false)
  })

  it('appPlatformRelApi.create POSTs {app_code,platform_code,is_primary}', async () => {
    mockFetch({ status: 'success', data: { ...relFixture, is_primary: false } })

    const res = await appPlatformRelApi.create({
      app_code: 'order-service',
      platform_code: 'public-data-auth',
    })

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/app-platform-rel')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    // is_primary 省略即不发送，由服务端默认 false
    expect(lastInitBody()).toEqual({
      app_code: 'order-service',
      platform_code: 'public-data-auth',
    })
    expect(res.data.rel_id).toBe('rel-1')
  })

  it('appPlatformRelApi.update PUTs /app-platform-rel/:rel_id with is_primary', async () => {
    mockFetch({ status: 'success', data: relFixture })

    const res = await appPlatformRelApi.update('rel-1', { is_primary: true })

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/app-platform-rel/rel-1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ is_primary: true })
    expect(res.data.is_primary).toBe(true)
  })

  it('appPlatformRelApi.remove DELETEs /app-platform-rel/:rel_id', async () => {
    mockFetch({ status: 'success', data: { rel_id: 'rel-1' } })

    const res = await appPlatformRelApi.remove('rel-1')

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/app-platform-rel/rel-1')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.rel_id).toBe('rel-1')
  })

  // ---- 决策 112：服务字典关系字段（app_code / biz_code）透传 ----

  it('serviceDictApi.create carries app_code / biz_code relation fields', async () => {
    mockFetch({
      status: 'success',
      data: {
        service_code: 'order-api',
        service_name: '订单接口服务',
        app_code: 'order-service',
        biz_code: 'payment',
        enabled: true,
      },
    })

    await serviceDictApi.create({
      service_code: 'order-api',
      service_name: '订单接口服务',
      app_code: 'order-service',
      biz_code: 'payment',
    })

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/service-dict')
    expect(lastInitBody()).toEqual({
      service_code: 'order-api',
      service_name: '订单接口服务',
      app_code: 'order-service',
      biz_code: 'payment',
    })
  })

  it('serviceDictApi.create omits unset relation fields (undefined, not empty string)', async () => {
    mockFetch({ status: 'success', data: { service_code: 'pay-api', service_name: '支付服务', enabled: true } })

    await serviceDictApi.create({ service_code: 'pay-api', service_name: '支付服务' })

    const body = lastInitBody() as Record<string, unknown>
    expect(Object.keys(body)).not.toContain('app_code')
    expect(Object.keys(body)).not.toContain('biz_code')
    expect(body.app_code).toBeUndefined()
    expect(body.biz_code).toBeUndefined()
  })

  it('serviceDictApi.update PUTs relation fields and never service_code', async () => {
    mockFetch({
      status: 'success',
      data: { service_code: 'order-api', service_name: '订单接口服务', app_code: null, biz_code: 'payment', enabled: true },
    })

    await serviceDictApi.update('order-api', {
      service_name: '订单接口服务',
      // null 表达「摘除」所属应用；biz_code 表达主归属
      app_code: null,
      biz_code: 'payment',
      enabled: true,
    })

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/service-dict/order-api')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toMatchObject({ service_name: '订单接口服务', app_code: null, biz_code: 'payment', enabled: true })
    expect(body).not.toHaveProperty('service_code')
  })

  it('serviceDictApi.list parses nullable relation fields', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          { service_code: 'order-api', service_name: '订单接口服务', app_code: 'order-service', biz_code: 'payment', enabled: true },
          { service_code: 'orphan-api', service_name: '游离服务', app_code: null, biz_code: null, enabled: true },
        ],
        total: 2,
      },
    })

    const res = await serviceDictApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/service-dict')
    expect(res.data.list[0].app_code).toBe('order-service')
    expect(res.data.list[1].app_code).toBeNull()
    expect(res.data.list[1].biz_code).toBeNull()
  })

  // ---- 决策 110：platform_code 为资源行一等字段（创建 / 更新输入通用）----

  it('resourceApi.create omits unset platform_code (undefined, not empty string)', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1', resource_category: 'host' } })

    await resourceApi.create({
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'infra',
      env: 'prod',
      instance_name: 'web-01',
      instance_ip: '10.0.0.1',
    })

    const body = lastInitBody() as Record<string, unknown>
    expect(Object.keys(body)).not.toContain('platform_code')
    expect(body.platform_code).toBeUndefined()
  })

  it('resourceApi.create sends platform_code when provided', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1', resource_category: 'database' } })

    await resourceApi.create({
      resource_category: 'database',
      network_domain_id: 'default',
      biz_code: 'payment',
      platform_code: 'ecommerce',
      env: 'prod',
      database_type: 'mysql',
      instance_ip: '10.0.0.2',
      port: 3306,
    })

    expect(lastInitBody()).toMatchObject({ platform_code: 'ecommerce' })
  })

  it('resourceApi.update sends platform_code when provided', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1', resource_category: 'database' } })

    await resourceApi.update('r-1', { platform_code: 'ecommerce', biz_code: 'payment' })

    expect(lastInitBody()).toEqual({ platform_code: 'ecommerce', biz_code: 'payment' })
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
