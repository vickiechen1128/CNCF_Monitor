import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, clearToken, setToken } from './client'
import {
  resourceApi,
  businessDomainApi,
  applicationDictApi,
  platformDictApi,
  appPlatformRelApi,
  cloudDictApi,
  importApi,
  toV3ResourcePayload,
  v3ResourceToListItem,
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

describe('resources API (v3)', () => {
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
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls
    return calls[calls.length - 1]
  }

  function lastUrlInstance(): URL {
    return new URL(String(lastFetchCall()[0]), window.location.origin)
  }

  function lastInitBody(): unknown {
    const text = String(lastFetchCall()[1]?.body ?? '')
    return text ? JSON.parse(text) : undefined
  }

  it('resourceApi.list sends pagination + filter params to v3 endpoint', async () => {
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
    expect(url.pathname).toBe('/api/v3/platform/resources')
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

  it('resourceApi.list flattens v3 attributes into ResourceListItem', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          {
            resource_id: 'r-1',
            resource_category: 'host',
            tenant_id: 't-1',
            network_domain_id: 'nd-1',
            biz_code: 'infra',
            env: 'PRD',
            status: 'online',
            source_type: 'manual',
            scrape_port: 9100,
            attributes: {
              hostname: 'web-01',
              instance_ip: '10.0.0.1',
              os_type: 'Linux',
              activated_at: '2026-10-29T00:00:00Z',
            },
          },
          {
            resource_id: 'r-2',
            resource_category: 'database',
            network_domain_id: 'nd-1',
            status: 'offline',
            attributes: {
              database_type: 'mysql',
              instance_ip: '10.0.0.2',
              port: 3306,
              version: '8.0',
            },
          },
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    const res = await resourceApi.list({ resource_category: 'host' })

    expect(res.data.list).toHaveLength(2)
    expect(res.data.list[0]).toMatchObject({
      resource_id: 'r-1',
      instance_name: 'web-01',
      instance_ip: '10.0.0.1',
      os_type: 'Linux',
      scrape_port: 9100,
    })
    // v3 已删除的字段不再出现在页面模型
    expect((res.data.list[0] as unknown as Record<string, unknown>).hostname).toBeUndefined()
    expect(res.data.list[1]).toMatchObject({
      resource_id: 'r-2',
      database_type: 'mysql',
      instance_ip: '10.0.0.2',
      port: 3306,
      version: '8.0',
    })
  })

  it('resourceApi.create POSTs nested v3 payload (hostname mapped from instance_name)', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_id: 'r-1',
        resource_category: 'host',
        network_domain_id: 'default',
        biz_code: 'infra',
        env: 'PRD',
        status: 'online',
        source_type: 'manual',
        attributes: { hostname: 'web-01', instance_ip: '10.0.0.1', os_type: 'Linux' },
      },
    })

    const res = await resourceApi.create({
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'infra',
      env: 'PRD',
      instance_name: 'web-01',
      instance_ip: '10.0.0.1',
      os_type: 'Linux',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'infra',
      env: 'PRD',
      attributes: { hostname: 'web-01', instance_ip: '10.0.0.1', os_type: 'Linux' },
    })
    expect(res.data.instance_name).toBe('web-01')
  })

  it('resourceApi.update PUTs /:resource_id with resource_category + attributes', async () => {
    mockFetch({
      status: 'success',
      data: {
        resource_id: 'r-1',
        resource_category: 'application',
        biz_code: 'payment',
        status: 'maintenance',
        attributes: { service_name: 'pay-api', endpoint: '10.0.0.5:8080' },
      },
    })

    await resourceApi.update('r-1', {
      resource_category: 'application',
      biz_code: 'payment',
      status: 'maintenance',
      service_name: 'pay-api',
      endpoint: '10.0.0.5:8080',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources/r-1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({
      resource_category: 'application',
      biz_code: 'payment',
      status: 'maintenance',
      attributes: { service_name: 'pay-api', endpoint: '10.0.0.5:8080' },
    })
  })

  it('resourceApi.remove DELETEs /:resource_id', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1' } })

    const res = await resourceApi.remove('r-1')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources/r-1')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.resource_id).toBe('r-1')
  })

  it('resourceApi.referencedBy GETs /:resource_id/referenced-by', async () => {
    mockFetch({
      status: 'success',
      data: { jobs: [{ job_name: 'host-job', network_domain_id: 'nd-1', enabled: true }], total: 1 },
    })

    const res = await resourceApi.referencedBy('r-1')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/resources/r-1/referenced-by')
    expect(res.data.total).toBe(1)
    expect(res.data.jobs[0].job_name).toBe('host-job')
  })

  it('resourceApi.template downloads xlsx blob via v3 template endpoint', async () => {
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
    expect(url.pathname).toBe('/api/v3/platform/import-templates/host')
    expect(url.searchParams.get('format')).toBe('xlsx')
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

  it('resourceApi.importExcel builds v3 multipart (file+resource_category+mode)', async () => {
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
    expect(url.pathname).toBe('/api/v3/platform/imports')
    expect(call[1]?.method).toBe('POST')
    // 不手动设置 Content-Type：浏览器自动带 multipart boundary（rawRequest 只注入认证头）
    const headers = (call[1]?.headers ?? {}) as Record<string, string>
    expect(headers['Content-Type']).toBeUndefined()
    const body = call[1]?.body
    expect(body).toBeInstanceOf(FormData)
    const formData = body as FormData
    expect(formData.get('file')).toBe(file)
    expect(formData.get('resource_category')).toBe('host')
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

  it('resourceApi.labels adapts v3 {list,total} to {items,total}', async () => {
    mockFetch({
      status: 'success',
      data: {
        total: 2,
        list: [
          { id: 'label-1', key: 'app', value: 'web', source: 'system' },
          { id: 'label-2', key: 'team', value: 'ops', source: 'user' },
        ],
      },
    })

    const res = await resourceApi.labels('r-1')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources/r-1/labels')
    expect(res.data.total).toBe(2)
    expect(res.data.items[0]).toMatchObject({ id: 'label-1', source: 'system' })
    expect(res.data.items[1].source).toBe('user')
  })

  it('resourceApi.createLabel POSTs {key,value}', async () => {
    mockFetch({
      status: 'success',
      data: { id: 'label-3', key: 'team', value: 'ops', source: 'user' },
    })

    await resourceApi.createLabel('r-1', { key: 'team', value: 'ops' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources/r-1/labels')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ key: 'team', value: 'ops' })
  })

  it('resourceApi.updateLabel PUTs /labels/:label_id with value', async () => {
    mockFetch({
      status: 'success',
      data: { id: 'label-3', key: 'team', value: 'sre', source: 'user' },
    })

    await resourceApi.updateLabel('r-1', 'label-3', { value: 'sre' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources/r-1/labels/label-3')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ value: 'sre' })
  })

  it('resourceApi.removeLabel DELETEs /labels/:label_id', async () => {
    mockFetch({ status: 'success', data: { label_id: 'label-3' } })

    const res = await resourceApi.removeLabel('r-1', 'label-3')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v3/platform/resources/r-1/labels/label-3')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.label_id).toBe('label-3')
  })

  it('v3ResourceToListItem keeps unknown attributes out of the flat model', () => {
    const item = v3ResourceToListItem({
      resource_id: 'r-9',
      resource_category: 'generic_target',
      network_domain_id: 'nd-1',
      status: 'online',
      attributes: {
        target_name: 'switch-01',
        instance_ip: '10.0.0.9',
        port: 9116,
        metrics_path: '/metrics',
        scheme: 'http',
        exporter_type: 'snmp_exporter',
      },
    })
    expect(item).toMatchObject({
      target_name: 'switch-01',
      instance_ip: '10.0.0.9',
      port: 9116,
      metrics_path: '/metrics',
      exporter_type: 'snmp_exporter',
    })
    expect((item as unknown as Record<string, unknown>).custom_labels).toBeUndefined()
  })

  it('toV3ResourcePayload trims page fields into attributes and keeps platform clear as null', () => {
    const payload = toV3ResourcePayload({
      resource_category: 'host',
      network_domain_id: 'nd-1',
      env: 'PRD',
      platform_code: null,
      scrape_port: 0,
      instance_name: 'web-01',
      instance_ip: '10.0.0.1',
    })
    expect(payload).toMatchObject({
      resource_category: 'host',
      network_domain_id: 'nd-1',
      platform_code: null,
      attributes: { hostname: 'web-01', instance_ip: '10.0.0.1' },
    })
    expect(payload.attributes).not.toHaveProperty('cloud_code')
  })

  it('businessDomainApi supports list + create + update on v3 endpoints', async () => {
    mockFetch({
      status: 'success',
      data: { list: [{ code: 'infra', name: '公共基础设施', description: '兜底', enabled: true }], total: 1 },
    })
    const list = await businessDomainApi.list()
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/business-domains')
    expect(list.data.list[0].description).toBe('兜底')

    mockFetch({
      status: 'success',
      data: { code: 'logistics', name: '物流', description: '物流业务域', enabled: true },
    })
    await businessDomainApi.create({ code: 'logistics', name: '物流', description: '物流业务域' })
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/business-domains')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ code: 'logistics', name: '物流', description: '物流业务域' })

    mockFetch({
      status: 'success',
      data: { code: 'logistics', name: '物流2', description: '改', enabled: false },
    })
    await businessDomainApi.update('logistics', { name: '物流2', enabled: false })
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/business-domains/logistics')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ name: '物流2', enabled: false })
  })

  it('applicationDictApi supports list + create + update on v3 endpoints', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0 } })
    await applicationDictApi.list()
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/application-dict')

    mockFetch({
      status: 'success',
      data: { app_code: 'inventory', app_name: '库存服务', description: '库存', status: 'enabled' },
    })
    await applicationDictApi.create({ app_code: 'inventory', app_name: '库存服务', description: '库存' })
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ app_code: 'inventory', app_name: '库存服务', description: '库存' })

    mockFetch({
      status: 'success',
      data: { app_code: 'inventory', app_name: '库存服务2', status: 'disabled' },
    })
    await applicationDictApi.update('inventory', { app_name: '库存服务2', status: 'disabled' })
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/application-dict/inventory')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
  })

  it('platformDictApi supports list + create + update on v3 endpoints', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0 } })
    await platformDictApi.list()
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/platform-dict')

    mockFetch({
      status: 'success',
      data: { platform_code: 'warehouse', platform_name: '仓储平台', enabled: true },
    })
    await platformDictApi.create({ platform_code: 'warehouse', platform_name: '仓储平台' })
    expect(lastFetchCall()[1]?.method).toBe('POST')

    mockFetch({
      status: 'success',
      data: { platform_code: 'warehouse', platform_name: '仓储平台2', enabled: false },
    })
    await platformDictApi.update('warehouse', { platform_name: '仓储平台2', enabled: false })
    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/platform-dict/warehouse')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
  })

  // 决策 98 / 102-③：云字典部署级只读——只有 list，不得给前端留任何写入口
  it('cloudDictApi.list GETs /cloud-dict and exposes read-only list only', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          { cloud_code: 'PUB-TX', cloud_name: '腾讯云', cloud_type: 'PUB', carrier: 'TX', enabled: true },
        ],
        total: 1,
      },
    })

    const res = await cloudDictApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/cloud-dict')
    expect(res.data.total).toBe(1)
    expect(res.data.list[0]).toMatchObject({ cloud_code: 'PUB-TX', cloud_name: '腾讯云' })
    expect(Object.keys(cloudDictApi)).toEqual(['list'])
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
    expect(url.pathname).toBe('/api/v3/platform/app-platform-rel')
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

  it('appPlatformRelApi.create POSTs {app_code,platform_code,is_primary}', async () => {
    mockFetch({ status: 'success', data: { ...relFixture, is_primary: false } })

    const res = await appPlatformRelApi.create({
      app_code: 'order-service',
      platform_code: 'public-data-auth',
    })

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/app-platform-rel')
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

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/app-platform-rel/rel-1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ is_primary: true })
    expect(res.data.is_primary).toBe(true)
  })

  it('appPlatformRelApi.remove DELETEs /app-platform-rel/:rel_id', async () => {
    mockFetch({ status: 'success', data: { rel_id: 'rel-1' } })

    const res = await appPlatformRelApi.remove('rel-1')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/app-platform-rel/rel-1')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.rel_id).toBe('rel-1')
  })

  // ---- 决策 110：platform_code 为资源行一等字段（创建 / 更新输入通用）----

  it('resourceApi.create omits unset platform_code (undefined, not empty string)', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1', resource_category: 'host' } })

    await resourceApi.create({
      resource_category: 'host',
      network_domain_id: 'default',
      biz_code: 'infra',
      env: 'PRD',
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
      env: 'PRD',
      database_type: 'mysql',
      instance_ip: '10.0.0.2',
      port: 3306,
    })

    expect(lastInitBody()).toMatchObject({ platform_code: 'ecommerce' })
  })

  it('resourceApi.update sends platform_code + resource_category', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1', resource_category: 'database' } })

    await resourceApi.update('r-1', {
      resource_category: 'database',
      platform_code: 'ecommerce',
      biz_code: 'payment',
    })

    expect(lastInitBody()).toMatchObject({
      resource_category: 'database',
      platform_code: 'ecommerce',
      biz_code: 'payment',
      attributes: {},
    })
  })

  it('importApi.list GETs /imports with page params', async () => {
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
    expect(url.pathname).toBe('/api/v3/platform/imports')
    expect(url.searchParams.get('resource_category')).toBe('host')
    expect(url.searchParams.get('status')).toBe('partial')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('50')
  })

  it('importApi.get GETs /imports/:import_id and parses detail with errors', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 'imp-7',
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

    const res = await importApi.get('imp-7')

    expect(lastUrlInstance().pathname).toBe('/api/v3/platform/imports/imp-7')
    expect(res.data.import_no).toBe('IMP-20260822-001')
    expect(res.data.mode).toBe('upsert')
    expect(res.data.status).toBe('partial')
    expect(res.data.errors[0].field).toBe('instance_ip')
  })
})
