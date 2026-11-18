import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
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

describe('useConfigSnapshots（v3 配置快照：单域 + 跨域聚合）', () => {
  beforeEach(() => {
    domainsListMock.mockReset()
    snapshotListMock.mockReset()
  })

  it('默认「全部网域」：过滤出已纳管网域，并发拉取快照并按 created_at 倒序合并', async () => {
    domainsListMock.mockResolvedValue({
      status: 'success',
      data: {
        list: [
          { network_domain_id: 'mc-a', name: '演示域', registration_status: 'monitored' },
          { network_domain_id: 'mc-b', name: '边缘域', registration_status: 'monitored' },
          { network_domain_id: 'mc-off', name: '未纳管域', registration_status: 'created' },
        ],
        total: 3,
      },
    })
    snapshotListMock.mockImplementation((domainId: string) =>
      Promise.resolve({
        status: 'success',
        data:
          domainId === 'mc-a'
            ? { list: [snapshot({ id: 1, version: 'a-old', created_at: '2026-11-10T10:00:00Z' })], total: 1 }
            : { list: [snapshot({ id: 2, network_domain_id: 'mc-b', version: 'b-new', created_at: '2026-11-12T10:00:00Z' })], total: 1 },
      }),
    )

    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 仅已纳管网域参与聚合
    expect(result.current.domains.map((d) => d.id)).toEqual(['mc-a', 'mc-b'])
    expect(domainsListMock).toHaveBeenCalledWith({ page: 1, page_size: 100 })
    expect(snapshotListMock).toHaveBeenCalledTimes(2)
    expect(result.current.rows.map((r) => r.version)).toEqual(['b-new', 'a-old'])
    expect(result.current.rows[0].network_domain_name).toBe('边缘域')
    expect(result.current.partialErrors).toHaveLength(0)
  })

  it('选中某一网域：只发该域一条请求（保留原单域页的低成本路径）', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockResolvedValue({
      status: 'success',
      data: { list: [snapshot({ network_domain_id: 'mc-b', version: 'only-b' })], total: 1 },
    })

    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => {
      result.current.setDomainFilter('mc-b')
    })
    await waitFor(() => expect(result.current.rows[0]?.version).toBe('only-b'))

    // 首次聚合 = 2 次；切换后仅追加 1 次单域请求
    expect(snapshotListMock).toHaveBeenCalledTimes(3)
    expect(snapshotListMock).toHaveBeenLastCalledWith('mc-b')
    expect(result.current.rows[0].network_domain_name).toBe('域-mc-b')
  })

  it('深链 initialDomainId 命中已纳管网域：直接进入单域模式', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockResolvedValue({
      status: 'success',
      data: { list: [snapshot({ network_domain_id: 'mc-b' })], total: 1 },
    })

    const { result } = renderHook(() => useConfigSnapshots({ initialDomainId: 'mc-b' }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.domainFilter).toBe('mc-b')
    expect(snapshotListMock).toHaveBeenCalledTimes(1)
    expect(snapshotListMock).toHaveBeenCalledWith('mc-b')
  })

  it('深链 initialDomainId 未命中已纳管网域：回落为全部网域聚合', async () => {
    mockDomains(['mc-a'])
    snapshotListMock.mockResolvedValue({
      status: 'success',
      data: { list: [snapshot()], total: 1 },
    })

    const { result } = renderHook(() => useConfigSnapshots({ initialDomainId: 'mc-gone' }))
    await waitFor(() => expect(result.current.loading).toBe(false))

    // 生效筛选值回落为空（= 全部网域），避免下拉展示一个不存在的选项
    expect(result.current.domainFilter).toBeUndefined()
    // 未命中 → 走聚合分支（只有 1 个已纳管网域，故仍是一条请求）
    expect(snapshotListMock).toHaveBeenCalledWith('mc-a')
    expect(result.current.rows).toHaveLength(1)
  })

  it('单域失败降级：其他域正常出数并记录部分失败', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockImplementation((domainId: string) =>
      domainId === 'mc-b'
        ? Promise.reject(new Error('请求超时'))
        : Promise.resolve({ status: 'success', data: { list: [snapshot()], total: 1 } }),
    )

    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.rows).toHaveLength(1)
    expect(result.current.partialErrors).toEqual([
      { domain_id: 'mc-b', network_domain_name: '域-mc-b', message: '请求超时' },
    ])
  })

  it('全部网域 403：permissionDenied 置位', async () => {
    mockDomains(['mc-a', 'mc-b'])
    snapshotListMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))

    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.permissionDenied).toBe(true)
  })

  it('单域 403：permissionDenied 置位', async () => {
    mockDomains(['mc-a'])
    snapshotListMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))

    const { result } = renderHook(() => useConfigSnapshots({ initialDomainId: 'mc-a' }))
    await waitFor(() => expect(result.current.permissionDenied).toBe(true))
  })

  it('接口错误（非 403）：error 置位且不误判权限不足', async () => {
    mockDomains(['mc-a'])
    snapshotListMock.mockRejectedValue(new Error('boom'))

    const { result } = renderHook(() => useConfigSnapshots({ initialDomainId: 'mc-a' }))
    await waitFor(() => expect(result.current.error).toBe('boom'))
    expect(result.current.permissionDenied).toBe(false)
  })

  it('网域列表失败：domainError 置位，覆盖层为空', async () => {
    domainsListMock.mockRejectedValue(new Error('domain list failed'))
    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.domainError).toBe(true))
    expect(result.current.loading).toBe(false)
    expect(result.current.rows).toHaveLength(0)
  })

  it('网域列表 403：按权限不足处理', async () => {
    domainsListMock.mockRejectedValue(new ApiError('forbidden', 403, 'forbidden'))
    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.permissionDenied).toBe(true))
  })

  it('reload：重新拉取网域与快照', async () => {
    mockDomains(['mc-a'])
    snapshotListMock.mockResolvedValue({
      status: 'success',
      data: { list: [snapshot()], total: 1 },
    })

    const { result } = renderHook(() => useConfigSnapshots())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(domainsListMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.reload()
    })
    await waitFor(() => expect(domainsListMock).toHaveBeenCalledTimes(2))
  })
})
