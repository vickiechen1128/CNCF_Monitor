import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { labelTemplateApi } from './labelTemplates'

describe('labelTemplateApi', () => {
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

  it('list hits /api/v2/platform/label-templates and sends all filter params', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          {
            id: 1,
            name: '主机默认模板',
            resource_category: 'host',
            is_default: true,
            mappings: [],
            instance_count: 3,
            created_at: '2026-08-21T00:00:00Z',
            updated_at: '2026-08-21T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 50,
      },
    })

    const res = await labelTemplateApi.list({
      resource_category: 'host',
      is_default: true,
      keyword: '主机',
      page: 1,
      page_size: 50,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(url.searchParams.get('resource_category')).toBe('host')
    expect(url.searchParams.get('is_default')).toBe('true')
    expect(url.searchParams.get('keyword')).toBe('主机')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('50')
    expect(res.data.total).toBe(1)
    expect(res.data.list[0].instance_count).toBe(3)
    expect(res.data.list[0].is_default).toBe(true)
  })

  it('create POSTs body with name/resource_category/description/mappings', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 10,
        name: '新模板',
        resource_category: 'application',
        is_default: false,
        mappings: [],
        created_at: '2026-08-21T00:00:00Z',
        updated_at: '2026-08-21T00:00:00Z',
      },
    })

    const res = await labelTemplateApi.create({
      name: '新模板',
      resource_category: 'application',
      description: '应用服务模板',
      mappings: [
        {
          target_label: 'app',
          source_type: 'resource_field',
          source_field: 'app_name',
          transform_rule: 'lower',
        },
      ],
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      name: '新模板',
      resource_category: 'application',
      description: '应用服务模板',
      mappings: [
        {
          target_label: 'app',
          source_type: 'resource_field',
          source_field: 'app_name',
          transform_rule: 'lower',
        },
      ],
    })
    expect(res.data.id).toBe(10)
    expect(res.data.is_default).toBe(false)
  })

  it('update PUTs /:template_id with name/description only (no resource_category)', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 10,
        name: '改名后',
        resource_category: 'host',
        is_default: false,
        mappings: [],
        created_at: '2026-08-21T00:00:00Z',
        updated_at: '2026-08-22T00:00:00Z',
      },
    })

    await labelTemplateApi.update(10, { name: '改名后', description: '新描述' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    const body = lastInitBody() as Record<string, unknown>
    expect(body).toEqual({ name: '改名后', description: '新描述' })
    expect(body).not.toHaveProperty('resource_category')
  })

  it('remove DELETEs /:template_id', async () => {
    mockFetch({ status: 'success', data: null })

    await labelTemplateApi.remove(10)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
  })

  it('clone POSTs /:template_id/clone with optional name', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 11,
        name: '主机模板副本',
        resource_category: 'host',
        is_default: false,
        mappings: [],
        created_at: '2026-08-22T00:00:00Z',
        updated_at: '2026-08-22T00:00:00Z',
      },
    })

    const res = await labelTemplateApi.clone(10, { name: '主机模板副本' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10/clone')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ name: '主机模板副本' })
    expect(res.data.id).toBe(11)
    expect(res.data.is_default).toBe(false)
  })

  it('resources GETs /:template_id/resources and parses pagination (items envelope)', async () => {
    mockFetch({
      status: 'success',
      data: {
        items: [
          { resource_id: 'res-1', instance_name: 'web-01', status: 'online' },
          { resource_id: 'res-2', instance_name: 'web-02', status: 'maintenance' },
        ],
        total: 12,
        page: 2,
        page_size: 10,
      },
    })

    const res = await labelTemplateApi.resources(10, { page: 2, page_size: 10 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10/resources')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('10')
    expect(res.data.items).toHaveLength(2)
    expect(res.data.items[0].instance_name).toBe('web-01')
    expect(res.data.total).toBe(12)
    expect(res.data.page).toBe(2)
  })

  it('addMapping POSTs /:template_id/mappings with mapping body', async () => {
    mockFetch({
      status: 'success',
      data: [
        {
          source_field: 'app_name',
          source_type: 'resource_field',
          target_label: 'app',
          enabled: true,
        },
      ],
    })

    const res = await labelTemplateApi.addMapping(10, {
      target_label: 'app',
      source_type: 'resource_field',
      source_field: 'app_name',
      transform_rule: 'lower',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10/mappings')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      target_label: 'app',
      source_type: 'resource_field',
      source_field: 'app_name',
      transform_rule: 'lower',
    })
    expect(res.data).toHaveLength(1)
  })

  it('updateMapping PUTs /:template_id/mappings/:mapping_id', async () => {
    mockFetch({ status: 'success', data: [] })

    await labelTemplateApi.updateMapping(10, 3, { transform_rule: 'upper' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10/mappings/3')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ transform_rule: 'upper' })
  })

  it('removeMapping DELETEs /:template_id/mappings/:mapping_id', async () => {
    mockFetch({ status: 'success', data: { mapping_id: 3 } })

    const res = await labelTemplateApi.removeMapping(10, 3)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/label-templates/10/mappings/3')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.mapping_id).toBe(3)
  })
})
