import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ciExporterMappingApi } from './ciExporterMappings'

describe('ciExporterMappings API', () => {
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

  it('list sends monitor_type/is_default/page/page_size params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await ciExporterMappingApi.list({ monitor_type: 'mysql', is_default: true, page: 1, page_size: 20 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/ci-exporter-mappings')
    expect(url.searchParams.get('monitor_type')).toBe('mysql')
    expect(url.searchParams.get('is_default')).toBe('true')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('20')
  })

  it('create POSTs body with is_default', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 4,
        monitor_type: 'mysql',
        exporter_template_id: 'mysqld-exporter',
        is_default: true,
        default_port: 9104,
        metrics_path: '/metrics',
        scheme: 'http',
      },
    })

    const res = await ciExporterMappingApi.create({
      monitor_type: 'mysql',
      exporter_template_id: 'mysqld-exporter',
      is_default: true,
      default_port: 9104,
      metrics_path: '/metrics',
      scheme: 'http',
      scrape_interval: '15s',
      scrape_timeout: '10s',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/ci-exporter-mappings')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      monitor_type: 'mysql',
      exporter_template_id: 'mysqld-exporter',
      is_default: true,
      default_port: 9104,
      metrics_path: '/metrics',
      scheme: 'http',
      scrape_interval: '15s',
      scrape_timeout: '10s',
    })
    expect(res.data.is_default).toBe(true)
  })

  it('update PUTs /:id', async () => {
    mockFetch({
      status: 'success',
      data: { id: 4, monitor_type: 'mysql', exporter_template_id: 'mysqld-exporter', is_default: false },
    })

    await ciExporterMappingApi.update(4, { is_default: false })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/ci-exporter-mappings/4')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ is_default: false })
  })

  it('remove DELETEs /:id and returns id', async () => {
    mockFetch({ status: 'success', data: { id: 4 } })

    const res = await ciExporterMappingApi.remove(4)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/ci-exporter-mappings/4')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.id).toBe(4)
  })

  it('throws on bad_request duplicate default', async () => {
    mockFetch(
      { status: 'error', errorType: 'bad_request', error: 'multiple default mappings for mysql' },
      { status: 400 },
    )

    await expect(
      ciExporterMappingApi.create({ monitor_type: 'mysql', exporter_template_id: 'x', is_default: true }),
    ).rejects.toThrow('multiple default mappings for mysql')
  })
})