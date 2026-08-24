import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { monitoringRuleApi } from './monitoringRules'

describe('monitoringRules API', () => {
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

  it('list sends rule_type/enabled/keyword/page params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await monitoringRuleApi.list({ rule_type: 'alert', enabled: true, keyword: 'cpu', page: 1, page_size: 20 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/monitoring-rules')
    expect(url.searchParams.get('rule_type')).toBe('alert')
    expect(url.searchParams.get('enabled')).toBe('true')
    expect(url.searchParams.get('keyword')).toBe('cpu')
    expect(url.searchParams.get('page')).toBe('1')
  })

  it('create POSTs yaml_passthrough rule content', async () => {
    mockFetch({
      status: 'success',
      data: { id: 5, name: 'cpu-rules', content_mode: 'yaml_passthrough', change_status: 'pending' },
    })

    const res = await monitoringRuleApi.create({
      content_mode: 'yaml_passthrough',
      rule_content: 'groups:\n  - name: cpu\n    rules: []',
      name: 'cpu-rules',
      enabled: true,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/monitoring-rules')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      content_mode: 'yaml_passthrough',
      rule_content: 'groups:\n  - name: cpu\n    rules: []',
      name: 'cpu-rules',
      enabled: true,
    })
    expect(res.data.change_status).toBe('pending')
  })

  it('update PUTs /:id with editable fields', async () => {
    mockFetch({ status: 'success', data: { id: 5, name: 'cpu-rules', enabled: false } })

    await monitoringRuleApi.update(5, { enabled: false })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/monitoring-rules/5')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ enabled: false })
  })

  it('remove DELETEs /:id', async () => {
    mockFetch({ status: 'success', data: { id: 5 } })

    const res = await monitoringRuleApi.remove(5)

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/monitoring-rules/5')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.id).toBe(5)
  })

  it('validateYaml POSTs {rule_content} and parses {valid,error}', async () => {
    mockFetch({ status: 'success', data: { valid: true } })

    const res = await monitoringRuleApi.validateYaml(5, 'groups: []')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/monitoring-rules/5/validate-yaml')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ rule_content: 'groups: []' })
    expect(res.data.valid).toBe(true)
  })

  it('get GETs /:id for detail', async () => {
    mockFetch({
      status: 'success',
      data: { id: 5, name: 'cpu-rules', content_mode: 'yaml_passthrough', rule_content: 'groups: []' },
    })

    const res = await monitoringRuleApi.get(5)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/monitoring-rules/5')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(res.data.rule_content).toBe('groups: []')
  })
})