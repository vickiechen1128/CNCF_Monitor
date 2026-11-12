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

const AGENTS_PATH = '/api/v3/platform/edge-agents'

describe('edgeAgents API（M09 v3 §3）', () => {
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

  const agent = (over: Record<string, unknown> = {}) => ({
    id: 1,
    network_domain_id: 'gov-cloud-a',
    hostname: 'edge01',
    ip: '10.0.2.15',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    status: 'online',
    last_heartbeat_at: '2026-09-20T08:00:00Z',
    heartbeat_rtt_ms: 45,
    queue_backlog_bytes: 1048576,
    collector_status: 'running',
    collector_version: 'v1.101.0',
    config_sync_status: 'in_sync',
    components: [{ type: 'collector', name: 'vmagent', status: 'running', version: 'v1.101.0' }],
    ...over,
  })

  it('list GETs v3 /edge-agents with pagination defaults', async () => {
    mockFetch({ status: 'success', data: { list: [agent()], total: 1, page: 1, page_size: 100 } })

    await edgeAgentsApi.list()

    const url = lastUrlInstance()
    expect(url.pathname).toBe(AGENTS_PATH)
    expect(lastFetchCall()[1]?.method).toBe('GET')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('page_size')).toBe('100')
  })

  it('list forwards server-side filters', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0 } })

    await edgeAgentsApi.list({ network_domain_id: 'mc-a', status: 'online', keyword: 'edge' })

    const url = lastUrlInstance()
    expect(url.searchParams.get('network_domain_id')).toBe('mc-a')
    expect(url.searchParams.get('status')).toBe('online')
    expect(url.searchParams.get('keyword')).toBe('edge')
  })

  it('list maps {list,total} to overall + summary + agents and normalizes heartbeat', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          agent(),
          agent({ id: 2, status: 'offline', last_heartbeat_at: null }),
          agent({ id: 3, status: 'online', components: [{ type: 'collector', name: 'vmagent', status: 'crash_loop' }] }),
        ],
        total: 3,
      },
    })

    const res = await edgeAgentsApi.list()

    expect(res.data.agents).toHaveLength(3)
    expect(res.data.summary).toEqual({ total: 3, online: 2, partial: 1, offline: 1 })
    expect(res.data.overall).toBe('partial')
    expect(res.data.agents[0].hostname).toBe('edge01')
    // v3 last_heartbeat_at 归一为页面字段 last_heartbeat
    expect(res.data.agents[0].last_heartbeat).toBe('2026-09-20T08:00:00Z')
    expect(res.data.agents[1].last_heartbeat).toBeUndefined()
    expect(res.data.agents[0].queue_backlog_bytes).toBe(1048576)
    expect(res.data.agents[0].components?.[0].status).toBe('running')
  })

  it('list derives overall=offline when all nodes are offline', async () => {
    mockFetch({ status: 'success', data: { list: [agent({ status: 'offline' })], total: 1 } })

    const res = await edgeAgentsApi.list()

    expect(res.data.overall).toBe('offline')
    expect(res.data.summary.offline).toBe(1)
  })

  it('list throws ApiError on error envelope', async () => {
    mockFetch({ status: 'error', errorType: 'not_found', error: 'boom' }, 404)

    await expect(edgeAgentsApi.list()).rejects.toThrow(ApiError)
  })
})
