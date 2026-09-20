import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, clearToken } from './client'
import { edgeAgentsApi } from './edgeAgents'

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

describe('edgeAgents API（M11 §1）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(body: unknown, status = 200) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  }
  function lastFetchCall() {
    return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
  }
  function lastUrlInstance(): URL {
    return new URL(String(lastFetchCall()[0]), window.location.origin)
  }

  const responseBody = {
    overall: 'partial',
    summary: { total: 3, online: 2, partial: 1, offline: 0 },
    agents: [
      {
        id: 1,
        network_domain_id: 'gov-cloud-a',
        hostname: 'edge01',
        ip: '10.0.2.15',
        agent_type: 'vmagent',
        version: 'v1.2.0',
        status: 'online',
        last_heartbeat: '2026-09-20T08:00:00Z',
        heartbeat_rtt_ms: 45,
        queue_backlog_bytes: 1048576,
        collector_status: 'running',
        collector_version: 'v1.101.0',
        config_sync_status: 'in_sync',
        components: [{ type: 'collector', name: 'vmagent', status: 'running', version: 'v1.101.0' }],
      },
    ],
  }

  it('edgeAgentsApi.list GETs /edge-agents with five-dim filter params', async () => {
    mockFetch({ status: 'success', data: responseBody })

    await edgeAgentsApi.list({
      network_domain_id: 'gov-cloud-a',
      overall: 'partial',
      collector_status: 'crash_loop',
      blackbox_status: 'running',
      config_sync_status: 'out_of_sync',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/edge-agents')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(url.searchParams.get('network_domain_id')).toBe('gov-cloud-a')
    expect(url.searchParams.get('overall')).toBe('partial')
    expect(url.searchParams.get('collector_status')).toBe('crash_loop')
    expect(url.searchParams.get('blackbox_status')).toBe('running')
    expect(url.searchParams.get('config_sync_status')).toBe('out_of_sync')
  })

  it('edgeAgentsApi.list drops empty filter params', async () => {
    mockFetch({ status: 'success', data: responseBody })

    await edgeAgentsApi.list({ network_domain_id: undefined, overall: '', collector_status: '' })

    const url = lastUrlInstance()
    expect(url.searchParams.has('overall')).toBe(false)
    expect(url.searchParams.has('collector_status')).toBe(false)
    expect(url.searchParams.has('network_domain_id')).toBe(false)
  })

  it('edgeAgentsApi.list parses data: overall + summary + agents', async () => {
    mockFetch({ status: 'success', data: responseBody })

    const res = await edgeAgentsApi.list()

    expect(res.data.overall).toBe('partial')
    expect(res.data.summary.total).toBe(3)
    expect(res.data.summary.partial).toBe(1)
    expect(res.data.agents).toHaveLength(1)
    expect(res.data.agents[0].hostname).toBe('edge01')
    expect(res.data.agents[0].queue_backlog_bytes).toBe(1048576)
    expect(res.data.agents[0].components?.[0].status).toBe('running')
  })

  it('edgeAgentsApi.list throws ApiError on error envelope', async () => {
    mockFetch({ status: 'error', errorType: 'not_found', error: 'boom' }, 404)

    await expect(edgeAgentsApi.list()).rejects.toThrow(ApiError)
  })
})