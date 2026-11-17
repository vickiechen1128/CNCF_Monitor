import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../../../api/client'
import type { ConfigSnapshot } from '../../../types/config-center'
import { useSnapshotHistory } from './useSnapshotHistory'

const domainsListMock = vi.fn()
const snapshotListMock = vi.fn()

vi.mock('../../../api/configCenter', () => ({
  networkDomainMonitorApi: {
    list: (...args: unknown[]) => domainsListMock(...args),
    toNetworkDomain: (item: {
      network_domain_id: string
      name: string
      registration_status: string
    }) => ({
      id: item.network_domain_id,
      name: item.name,
      is_monitored: item.registration_status === 'monitored',
    }),
  },
  configSnapshotApi: {
    list: (...args: unknown[]) => snapshotListMock(...args),
  },
}))

const snapshot = (over: Partial<ConfigSnapshot> = {}): ConfigSnapshot => ({
  id: 1,
  network_domain_id: 'mc-a',
  version: 'v-1',
  checksum: 'sha256:aa',
  validation_status: 'passed',
  validation_cause: 'none',
  validation_details: {},
  is_current: true,
  generated_by: 'system',
  created_at: '2026-11-11T10:00:00Z',
  ...over,
})

function mockDomains(ids: string[]) {
  domainsListMock.mockResolvedValue({
    status: 'success',
    data: {
      list: ids.map((id) => ({ network_domain_id: id, name: `域-${id}`, registration_status: 'monitored' })),
      total: ids.length,
    },
  })
}

describe('useSnapshotHistory（v3 跨网域快照聚合）', () => {
  beforeEach(() => {
    domainsListMock.mockReset()
    snapshotListMock.mockReset()
  })

  it('并发拉取各网域快照，按 created_at 倒序合并并附网域名', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockImplementation((domainId: string) =>
      Promise.resolve({
        status: 'success',
        data:
          domainId === 'mc-a'
            ? { list: [snapshot({ id: 1, version: 'a-old', created_at: '2026-11-10T10:00:00Z' })], total: 1 }
            : { list: [snapshot({ id: 2, network_domain_id: 'mc-b', version: 'b-new', created_at: '2026-11-12T10:00:00Z' })], total: 1 },
      }),
    )

    const { result } = renderHook(() => useSnapshotHistory())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.rows.map((r) => r.version)).toEqual(['b-new', 'a-old'])
    expect(result.current.rows[0].network_domain_name).toBe('域-mc-b')
    expect(result.current.partialErrors).toHaveLength(0)
    expect(domainsListMock).toHaveBeenCalledWith({ page: 1, page_size: 100 })
  })

  it('单域失败降级：其他域正常出数并记录部分失败', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockImplementation((domainId: string) =>
      domainId === 'mc-b'
        ? Promise.reject(new Error('请求超时'))
        : Promise.resolve({ status: 'success', data: { list: [snapshot()], total: 1 } }),
    )

    const { result } = renderHook(() => useSnapshotHistory())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.partialErrors).toEqual([
      { domain_id: 'mc-b', network_domain_name: '域-mc-b', message: '请求超时' },
    ])
  })

  it('全部网域 403：permissionDenied 置位', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))

    const { result } = renderHook(() => useSnapshotHistory())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.permissionDenied).toBe(true)
  })

  it('网域列表失败：domainError 置位', async () => {
    domainsListMock.mockRejectedValue(new Error('domain list failed'))
    const { result } = renderHook(() => useSnapshotHistory())
    await waitFor(() => expect(result.current.domainError).toBe(true))
    expect(result.current.rows).toHaveLength(0)
  })
})
