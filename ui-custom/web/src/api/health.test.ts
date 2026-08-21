import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getHealth, getHealthDb, getStatus } from './health'

describe('health API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(body: unknown) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  }

  function lastPath(): string {
    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    return new URL(call[0]).pathname
  }

  it('getHealth hits /api/v1/health and returns status', async () => {
    mockFetch({ status: 'success', data: { status: 'ok' } })

    const res = await getHealth()

    expect(lastPath()).toBe('/api/v1/health')
    expect(res.status).toBe('success')
    expect(res.data.status).toBe('ok')
  })

  it('getHealthDb hits /api/v1/health/db and parses db_status', async () => {
    mockFetch({ status: 'success', data: { status: 'ok', db_status: 'connected' } })

    const res = await getHealthDb()

    expect(lastPath()).toBe('/api/v1/health/db')
    expect(res.data.db_status).toBe('connected')
  })

  it('getStatus hits /api/v1/status and parses version/mode', async () => {
    mockFetch({ status: 'success', data: { version: 'v0.1.0', mode: 'standalone' } })

    const res = await getStatus()

    expect(lastPath()).toBe('/api/v1/status')
    expect(res.data.version).toBe('v0.1.0')
    expect(res.data.mode).toBe('standalone')
  })
})