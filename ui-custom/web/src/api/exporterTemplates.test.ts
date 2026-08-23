import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exporterTemplateApi } from './exporterTemplates'

describe('exporterTemplates API', () => {
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

  it('list sends monitor_type/source/page/page_size params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await exporterTemplateApi.list({ monitor_type: 'mysql', source: 'official', page: 2, page_size: 20 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/exporter-templates')
    expect(url.searchParams.get('monitor_type')).toBe('mysql')
    expect(url.searchParams.get('source')).toBe('official')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('page_size')).toBe('20')
  })

  it('list drops undefined params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await exporterTemplateApi.list({ source: 'internal', monitor_type: undefined })

    const url = lastUrlInstance()
    expect(url.searchParams.get('source')).toBe('internal')
    expect(url.searchParams.has('monitor_type')).toBe(false)
  })

  it('create POSTs body and returns created object', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 9,
        name: 'custom-exporter',
        version: '1.0.0',
        default_port: 9100,
        metrics_path: '/metrics',
        scheme: 'http',
        is_builtin: false,
        source: 'internal',
      },
    })

    const res = await exporterTemplateApi.create({
      name: 'custom-exporter',
      default_port: 9100,
      metrics_path: '/metrics',
      scheme: 'http',
      source: 'internal',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/exporter-templates')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      name: 'custom-exporter',
      default_port: 9100,
      metrics_path: '/metrics',
      scheme: 'http',
      source: 'internal',
    })
    expect(res.data.source).toBe('internal')
  })

  it('update PUTs /:id with editable body', async () => {
    mockFetch({
      status: 'success',
      data: { id: 9, name: 'custom-exporter', version: '1.1.0', is_builtin: false, source: 'internal' },
    })

    await exporterTemplateApi.update(9, { version: '1.1.0' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/exporter-templates/9')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ version: '1.1.0' })
  })

  it('remove DELETEs /:id', async () => {
    mockFetch({ status: 'success', data: { id: 9 } })

    const res = await exporterTemplateApi.remove(9)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/exporter-templates/9')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.id).toBe(9)
  })

  it('throws on forbidden error envelope for builtin template', async () => {
    mockFetch(
      { status: 'error', errorType: 'forbidden', error: 'builtin template is read-only' },
      { status: 403 },
    )

    await expect(exporterTemplateApi.remove(1)).rejects.toThrow('builtin template is read-only')
  })
})