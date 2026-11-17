import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, clearToken, setToken } from '../../../api/client'
import { configSnapshotApi } from '../../../api/configCenter'
import type { ConfigSnapshot } from '../../../types/config-center'

/**
 * v3 配置快照 API 契约（docs/05-execution-records/rewrite/v2.0/modules/module-09/
 * api-contract-snapshot-v3.md §4.2）。
 * 页面测试 mock 高层 API，本文件锁定真实请求路径与原始内容读取方式。
 */

// jsdom 环境 localStorage 行为不稳定，用内存 Map 替换（与 client.test.ts / edgePackages.test.ts 一致）。
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

const DOMAINS_PATH = '/api/v3/platform/network-domains'

const snapshot: ConfigSnapshot = {
  id: 42,
  network_domain_id: 'mc-demo',
  version: '20261111-0a1b',
  checksum: 'sha256:deadbeef',
  validation_status: 'passed',
  validation_cause: 'none',
  validation_details: {},
  is_current: true,
  generated_by: 'system',
  created_at: '2026-11-11T10:00:00Z',
}

function lastCall(): [string, RequestInit | undefined] {
  const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
  return fetchMock.mock.calls[0] as [string, RequestInit | undefined]
}

function lastUrl(): URL {
  return new URL(String(lastCall()[0]), window.location.origin)
}

describe('configSnapshotApi（v3 快照路径）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearToken()
    setToken('test-token')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('list GETs /network-domains/:id/config-snapshots', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: { list: [snapshot], total: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const res = await configSnapshotApi.list('mc-demo')

    expect(lastUrl().pathname).toBe(`${DOMAINS_PATH}/mc-demo/config-snapshots`)
    expect(lastCall()[1]?.method).toBe('GET')
    expect(res.data.total).toBe(1)
    expect(res.data.list[0].version).toBe('20261111-0a1b')
  })

  it('get GETs /network-domains/:id/config-snapshots/:snapshot_id', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: snapshot }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const res = await configSnapshotApi.get('mc-demo', 42)

    expect(lastUrl().pathname).toBe(`${DOMAINS_PATH}/mc-demo/config-snapshots/42`)
    expect(res.data.is_current).toBe(true)
  })

  it('content GETs .../content 并读取原始配置文本（非统一 JSON 信封）', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('prometheus_yml: |\n  scrape_interval: 15s\n', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const text = await configSnapshotApi.content('mc-demo', 42)

    expect(lastUrl().pathname).toBe(`${DOMAINS_PATH}/mc-demo/config-snapshots/42/content`)
    expect(text).toContain('scrape_interval: 15s')
  })

  it('content 403：转成 ApiError（页面提示需管理员权限）', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: 'error', error: 'forbidden', errorType: 'forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    await expect(configSnapshotApi.content('mc-demo', 42)).rejects.toMatchObject({
      code: 403,
      errorType: 'forbidden',
    } satisfies Partial<ApiError>)
  })
})
