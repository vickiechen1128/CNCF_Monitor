import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { labelTemplateApi } from './labelTemplates'
import type { LabelTemplate, Mapping } from '../types/label'

const BASE = '/api/v3/platform/label-templates'

describe('labelTemplateApi (v3)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function fetchMock() {
    return globalThis.fetch as ReturnType<typeof vi.fn>
  }

  function jsonResponse(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  }

  /** 按顺序压入多次请求响应（v3 映射写操作 = GET 模板 + PUT 整模板） */
  function mockFetchSequence(...bodies: unknown[]) {
    bodies.forEach((body) => fetchMock().mockResolvedValueOnce(jsonResponse(body)))
    return fetchMock()
  }

  function success<T>(data: T) {
    return { status: 'success', data }
  }

  function nthFetchCall(index: number) {
    return fetchMock().mock.calls[index]
  }

  function nthUrl(index: number): URL {
    return new URL(String(nthFetchCall(index)[0]))
  }

  function nthInitBody(index: number): unknown {
    const text = String(nthFetchCall(index)[1]?.body ?? '')
    return text ? JSON.parse(text) : undefined
  }

  function mapping(over: Partial<Mapping> = {}): Mapping {
    return {
      source_field: 'app_code',
      source_type: 'resource_field',
      target_label: 'app',
      enabled: true,
      ...over,
    }
  }

  function template(over: Partial<LabelTemplate> = {}): LabelTemplate {
    return {
      id: 'lt-1',
      name: '主机默认模板',
      resource_category: 'host',
      is_default: false,
      mappings: [],
      created_at: '2026-11-16T10:00:00Z',
      updated_at: '2026-11-16T10:00:00Z',
      ...over,
    }
  }

  it('list hits /api/v3/platform/label-templates and sends all filter params', async () => {
    mockFetchSequence(
      success({
        list: [template({ id: 'lt-host-1', name: '主机默认模板', is_default: true })],
        total: 1,
        page: 1,
        page_size: 50,
      }),
    )

    const res = await labelTemplateApi.list({
      resource_category: 'host',
      is_default: true,
      keyword: '主机',
      page: 1,
      page_size: 50,
    })

    const url = nthUrl(0)
    expect(url.pathname).toBe(BASE)
    expect(nthFetchCall(0)[1]?.method).toBe('GET')
    expect(url.searchParams.get('resource_category')).toBe('host')
    expect(url.searchParams.get('is_default')).toBe('true')
    expect(url.searchParams.get('keyword')).toBe('主机')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('50')
    // v3 信封带 total；模板对象无 instance_count / description / deleted_at
    expect(res.data.total).toBe(1)
    expect(res.data.page).toBe(1)
    expect(res.data.page_size).toBe(50)
    expect(res.data.list[0].id).toBe('lt-host-1')
    expect(res.data.list[0].is_default).toBe(true)
    expect(res.data.list[0]).not.toHaveProperty('instance_count')
  })

  it('get GETs /:template_id with string id', async () => {
    mockFetchSequence(success(template({ id: 'lt-9' })))

    const res = await labelTemplateApi.get('lt-9')

    expect(nthUrl(0).pathname).toBe(`${BASE}/lt-9`)
    expect(nthFetchCall(0)[1]?.method).toBe('GET')
    expect(res.data.id).toBe('lt-9')
  })

  it('setDefault GETs the template then PUTs the whole template with is_default=true (v2.56)', async () => {
    mockFetchSequence(
      success(template({ name: '主机模板', mappings: [mapping()] })),
      success(template({ name: '主机模板', is_default: true, mappings: [mapping({ transform: '' })] })),
    )

    const res = await labelTemplateApi.setDefault('lt-1')

    // v3 PUT 全量替换：先 GET 原模板，再带 name + 完整 mappings 提交；不能只传 is_default
    expect(fetchMock()).toHaveBeenCalledTimes(2)
    expect(nthUrl(0).pathname).toBe(`${BASE}/lt-1`)
    expect(nthFetchCall(0)[1]?.method).toBe('GET')
    expect(nthUrl(1).pathname).toBe(`${BASE}/lt-1`)
    expect(nthFetchCall(1)[1]?.method).toBe('PUT')
    expect(nthInitBody(1)).toEqual({
      name: '主机模板',
      is_default: true,
      mappings: [mapping({ transform: '' })],
    })
    expect(nthInitBody(1)).not.toHaveProperty('resource_category')
    expect(res.data.is_default).toBe(true)
  })

  it('create POSTs body with name/resource_category/mappings (no description)', async () => {
    mockFetchSequence(success(template({ id: 'lt-10', name: '新模板', resource_category: 'application' })))

    const res = await labelTemplateApi.create({
      name: '新模板',
      resource_category: 'application',
      mappings: [
        {
          target_label: 'app',
          source_type: 'resource_field',
          source_field: 'app_code',
          transform: 'lower',
        },
      ],
    })

    expect(nthUrl(0).pathname).toBe(BASE)
    expect(nthFetchCall(0)[1]?.method).toBe('POST')
    expect(nthInitBody(0)).toEqual({
      name: '新模板',
      resource_category: 'application',
      mappings: [
        {
          target_label: 'app',
          source_type: 'resource_field',
          source_field: 'app_code',
          transform: 'lower',
        },
      ],
    })
    expect(nthInitBody(0)).not.toHaveProperty('description')
    expect(res.data.id).toBe('lt-10')
  })

  it('update PUTs /:template_id without resource_category (immutable in v3)', async () => {
    mockFetchSequence(success(template({ id: 'lt-10', name: '改名后' })))

    await labelTemplateApi.update('lt-10', { name: '改名后' })

    const url = nthUrl(0)
    expect(url.pathname).toBe(`${BASE}/lt-10`)
    expect(nthFetchCall(0)[1]?.method).toBe('PUT')
    const body = nthInitBody(0) as Record<string, unknown>
    expect(body).toEqual({ name: '改名后' })
    expect(body).not.toHaveProperty('resource_category')
  })

  it('remove DELETEs /:template_id', async () => {
    mockFetchSequence(success({ id: 'lt-10' }))

    const res = await labelTemplateApi.remove('lt-10')

    expect(nthUrl(0).pathname).toBe(`${BASE}/lt-10`)
    expect(nthFetchCall(0)[1]?.method).toBe('DELETE')
    expect(res.data.id).toBe('lt-10')
  })

  it('remove surfaces backend 409 (template referenced by M01) instead of swallowing it', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(
        { status: 'error', errorType: 'conflict', error: 'label template "lt-1" is referenced by 2 M01 record(s)' },
        { status: 409 },
      ),
    )

    await expect(labelTemplateApi.remove('lt-1')).rejects.toThrow(/referenced by 2 M01 record/)
  })

  it('clone GETs the original then POSTs a new template named "<原名> 副本"', async () => {
    mockFetchSequence(
      success(
        template({
          id: 'lt-1',
          name: '主机模板',
          resource_category: 'host',
          is_default: true,
          mappings: [mapping({ transform: 'lower' })],
        }),
      ),
      success(template({ id: 'lt-2', name: '主机模板 副本' })),
    )

    const res = await labelTemplateApi.clone('lt-1')

    expect(nthUrl(0).pathname).toBe(`${BASE}/lt-1`)
    expect(nthFetchCall(0)[1]?.method).toBe('GET')
    expect(nthUrl(1).pathname).toBe(BASE)
    expect(nthFetchCall(1)[1]?.method).toBe('POST')
    expect(nthInitBody(1)).toEqual({
      name: '主机模板 副本',
      resource_category: 'host',
      is_default: false,
      mappings: [mapping({ transform: 'lower' })],
    })
    expect(res.data.id).toBe('lt-2')
  })

  it('clone honours an explicit name override', async () => {
    mockFetchSequence(success(template({ name: '源模板' })), success(template({ id: 'lt-3', name: '自用模板' })))

    await labelTemplateApi.clone('lt-1', { name: '自用模板' })

    expect((nthInitBody(1) as Record<string, unknown>).name).toBe('自用模板')
  })

  it('addMapping GETs the template then PUTs the whole template with the appended mapping', async () => {
    mockFetchSequence(
      success(template({ mappings: [mapping({ source_field: 'env', target_label: 'env' })] })),
      success(
        template({
          mappings: [mapping({ source_field: 'env', target_label: 'env' }), mapping({ transform: 'lower' })],
        }),
      ),
    )

    const res = await labelTemplateApi.addMapping('lt-1', {
      target_label: 'app',
      source_type: 'resource_field',
      source_field: 'app_code',
      transform: 'lower',
    })

    expect(nthUrl(0).pathname).toBe(`${BASE}/lt-1`)
    expect(nthFetchCall(0)[1]?.method).toBe('GET')
    expect(nthUrl(1).pathname).toBe(`${BASE}/lt-1`)
    expect(nthFetchCall(1)[1]?.method).toBe('PUT')
    expect(nthInitBody(1)).toEqual({
      name: '主机默认模板',
      is_default: false,
      mappings: [
        mapping({ source_field: 'env', target_label: 'env', transform: '' }),
        mapping({ transform: 'lower' }),
      ],
    })
    expect(res.data).toHaveLength(2)
  })

  it('replaceMappings GETs the template then PUTs the whole template (no mapping sub-endpoint)', async () => {
    mockFetchSequence(
      success(template({ name: '应用模板', resource_category: 'application' })),
      success(template({ name: '应用模板', resource_category: 'application', mappings: [mapping()] })),
    )

    const res = await labelTemplateApi.replaceMappings('lt-1', [
      { target_label: 'app', source_type: 'resource_field', source_field: 'app_code', transform: '', enabled: true },
    ])

    // 只有两次请求：GET 模板 + PUT 整模板；不再调用 /mappings 子端点
    expect(fetchMock()).toHaveBeenCalledTimes(2)
    expect(nthUrl(0).pathname).toBe(`${BASE}/lt-1`)
    expect(nthUrl(1).pathname).toBe(`${BASE}/lt-1`)
    expect(nthFetchCall(1)[1]?.method).toBe('PUT')
    expect(nthInitBody(1)).toEqual({
      name: '应用模板',
      is_default: false,
      mappings: [mapping({ transform: '' })],
    })
    expect(nthInitBody(1)).not.toHaveProperty('resource_category')
    expect(res.data).toHaveLength(1)
  })

  it('updateMapping replaces the mapping at the given index and PUTs the whole template', async () => {
    mockFetchSequence(
      success(
        template({
          mappings: [mapping({ source_field: 'app_code', target_label: 'app' }), mapping({ source_field: 'env', target_label: 'env' })],
        }),
      ),
      success(template({ mappings: [mapping(), mapping({ source_field: 'env', target_label: 'env', transform: 'upper' })] })),
    )

    await labelTemplateApi.updateMapping('lt-1', 1, { transform: 'upper' })

    expect(nthFetchCall(1)[1]?.method).toBe('PUT')
    expect(nthInitBody(1)).toEqual({
      name: '主机默认模板',
      is_default: false,
      mappings: [mapping({ transform: '' }), mapping({ source_field: 'env', target_label: 'env', transform: 'upper' })],
    })
  })

  it('removeMapping removes the mapping at the given index and PUTs the whole template', async () => {
    mockFetchSequence(
      success(
        template({
          mappings: [mapping({ source_field: 'env', target_label: 'env' }), mapping({ source_field: 'app_code', target_label: 'app' })],
        }),
      ),
      success(template({ mappings: [mapping({ transform: '' })] })),
    )

    const res = await labelTemplateApi.removeMapping('lt-1', 0)

    expect(nthFetchCall(1)[1]?.method).toBe('PUT')
    expect((nthInitBody(1) as { mappings: Mapping[] }).mappings).toEqual([
      mapping({ source_field: 'app_code', target_label: 'app', transform: '' }),
    ])
    expect(res.data).toHaveLength(1)
  })

  it('rejects out-of-range mapping index without issuing a write', async () => {
    mockFetchSequence(success(template({ mappings: [mapping()] })))

    await expect(labelTemplateApi.removeMapping('lt-1', 5)).rejects.toThrow(/越界/)
    expect(fetchMock()).toHaveBeenCalledTimes(1)
  })
})
