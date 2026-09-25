import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError, clearToken, setToken } from './client'
import { edgePackageApi } from './edgePackages'

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

describe('edgePackages API（M11 §2）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    clearToken()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function lastFetchCall() {
    return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
  }

  function lastUrlInstance(): URL {
    return new URL(String(lastFetchCall()[0]), window.location.origin)
  }

  it('edgePackageApi.list GETs /edge-packages and parses data array（M11 §2）', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: [
            {
              id: 'release-v1.2.0',
              version: 'v1.2.0',
              sha256: 'a3f2abc',
              size_bytes: 84212533,
              components: [
                { name: 'edge-sync-agent', version: 'v1.2.0' },
                { name: 'vmagent', version: 'v1.101.0' },
              ],
              download_url: '/api/v2/platform/edge-packages/v1.2.0/download',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const res = await edgePackageApi.list()

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/edge-packages')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // 契约 §2：data 为 PackageArtifact[] 数组（非 {packages}）
    expect(res.data).toHaveLength(1)
    expect(res.data[0].id).toBe('release-v1.2.0')
    expect(res.data[0].version).toBe('v1.2.0')
    expect(res.data[0].components[0].name).toBe('edge-sync-agent')
  })

  it('edgePackageApi.download GETs versioned zip blob via native fetch', async () => {
    const body = new TextEncoder().encode('zip-content')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/zip' },
      }),
    )

    const result = await edgePackageApi.download('v1.2.0')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/edge-packages/v1.2.0/download')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // 结构断言而非 instanceof：res.blob() 的 Blob 类身份随运行时（undici / jsdom）而异
    expect(result).toHaveProperty('size', body.byteLength)
    expect(result).toHaveProperty('type', 'application/zip')
  })

  it('edgePackageApi.download URL-encodes version path segment', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('x', { status: 200 }))

    await edgePackageApi.download('v1.0/2')

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/edge-packages/v1.0%2F2/download')
  })

  it('edgePackageApi.download attaches Authorization Bearer token（rawRequest 认证，au-02）', async () => {
    setToken('tok-m11')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('x', { status: 200 }))

    await edgePackageApi.download('v1.2.0')

    const headers = (lastFetchCall()[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-m11')
  })

  it('edgePackageApi.download throws ApiError on non-2xx error envelope', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'error', errorType: 'not_found', error: 'package not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(edgePackageApi.download('v9.9.9')).rejects.toThrow(ApiError)
  })
})