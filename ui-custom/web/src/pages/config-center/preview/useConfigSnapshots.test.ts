import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { ApiError } from '../../../api/client'
import type { ConfigSnapshot } from '../../../types/config-center'
import { useConfigSnapshots } from './useConfigSnapshots'

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
  id: 42,
  network_domain_id: 'mc-a',
  version: '20261111-0a1b',
  checksum: 'sha256:deadbeef',
  validation_status: 'passed',
  validation_cause: 'none',
  validation_details: {},
  is_current: true,
  generated_by: 'system',
  created_at: '2026-11-11T10:00:00Z',
  ...over,
})

describe('useConfigSnapshots（v3 快照列表）', () => {
  beforeEach(() => {
    domainsListMock.mockReset()
    snapshotListMock.mockReset()
  })

  it('加载已纳管网域并默认选中首个，按 v3 路径拉取该域快照', async () => {
    domainsListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { network_domain_id: 'mc-a', name: '演示域', registration_status: 'monitored' },
          { network_domain_id: 'mc-b', name: '未纳管域', registration_status: 'created' },
        ],
        total: 2,
      },
    })
    snapshotListMock.mockResolvedValue({
      status: 'success',
      data: { list: [snapshot()], total: 1 },
    })

    const { result } = renderHook(() => useConfigSnapshots())

    await waitFor(() => expect(result.current.domainId).toBe('mc-a'))
    await waitFor(() => expect(result.current.snapshots).toHaveLength(1))
    // 仅保留已纳管网域，且网域列表固定 page/page_size（v3）
    expect(domainsListMock).toHaveBeenCalledWith({ page: 1, page_size: 100 })
    expect(result.current.domains.map((d) => d.id)).toEqual(['mc-a'])
    expect(snapshotListMock).toHaveBeenCalledWith('mc-a')
    expect(result.current.loading).toBe(false)
  })

  it('网域列表失败：domainError 置位', async () => {
    domainsListMock.mockRejectedValue(new Error('domain list failed'))
    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.domainError).toBe(true))
    expect(result.current.loading).toBe(false)
  })

  it('快照列表 403：permissionDenied 置位', async () => {
    domainsListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [{ network_domain_id: 'mc-a', name: '演示域', registration_status: 'monitored' }],
        total: 1,
      },
    })
    snapshotListMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))
    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.permissionDenied).toBe(true))
  })
})
