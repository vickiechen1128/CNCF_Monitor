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

const PACKAGES_PATH = '/api/v3/platform/edge-packages'

describe('edgePackages API（M09 v3 §5）', () => {
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

  it('edgePackageApi.list GETs v3 /edge-packages and maps {list,total} to EdgePackage[]', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'success',
          data: {
            list: [
              {
                version: 'v1.2.0',
                file: 'edge-sync-agent-v1.2.0-linux-amd64.tar.gz',
                sha256: 'a3f2abc',
                size_bytes: 84212533,
                released_at: '2026-11-11T10:00:00Z',
                components: [
                  { name: 'edge-sync-agent', version: 'v1.2.0' },
                  { name: 'vmagent', version: 'v1.101.0' },
                ],
              },
            ],
            total: 1,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const res = await edgePackageApi.list()

    expect(lastUrlInstance().pathname).toBe(PACKAGES_PATH)
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // v3 信封 {list,total} 归一化为页面使用的数组
    expect(res.data).toHaveLength(1)
    expect(res.data[0].id).toBe('v1.2.0')
    expect(res.data[0].version).toBe('v1.2.0')
    expect(res.data[0].file).toBe('edge-sync-agent-v1.2.0-linux-amd64.tar.gz')
    expect(res.data[0].download_url).toBe(
      `${PACKAGES_PATH}/edge-sync-agent-v1.2.0-linux-amd64.tar.gz`,
    )
    expect(res.data[0].components[0].name).toBe('edge-sync-agent')
  })

  it('空清单返回空数组（未打包 200，不硬编码占位）', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: { list: [], total: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const res = await edgePackageApi.list()

    expect(res.data).toEqual([])
  })

  it('edgePackageApi.download GETs /edge-packages/:file tar.gz via native fetch', async () => {
    const body = new TextEncoder().encode('tarball-content')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/gzip' },
      }),
    )

    const result = await edgePackageApi.download('edge-sync-agent-v1.2.0-linux-amd64.tar.gz')

    const url = lastUrlInstance()
    expect(url.pathname).toBe(`${PACKAGES_PATH}/edge-sync-agent-v1.2.0-linux-amd64.tar.gz`)
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // 结构断言而非 instanceof：res.blob() 的 Blob 类身份随运行时（undici / jsdom）而异
    expect(result).toHaveProperty('size', body.byteLength)
    expect(result).toHaveProperty('type', 'application/gzip')
  })

  it('edgePackageApi.download URL-encodes file path segment', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('x', { status: 200 }))

    await edgePackageApi.download('v1.0/2.tar.gz')

    expect(lastUrlInstance().pathname).toBe(`${PACKAGES_PATH}/v1.0%2F2.tar.gz`)
  })

  it('edgePackageApi.download attaches Authorization Bearer token（rawRequest 认证）', async () => {
    setToken('tok-m09')
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('x', { status: 200 }))

    await edgePackageApi.download('pkg.tar.gz')

    const headers = (lastFetchCall()[1]?.headers ?? {}) as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok-m09')
  })

  it('edgePackageApi.download throws ApiError on non-2xx error envelope', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(
        JSON.stringify({ status: 'error', errorType: 'not_found', error: 'package not found' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(edgePackageApi.download('missing.tar.gz')).rejects.toThrow(ApiError)
  })
})
