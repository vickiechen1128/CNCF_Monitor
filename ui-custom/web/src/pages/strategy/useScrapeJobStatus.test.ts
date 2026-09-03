import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useScrapeJobStatus, type JobInstanceScrapeStatus } from './useScrapeJobStatus'
import type { ScrapeJobInstanceItem } from '../../types/strategy'

const targetsListMock = vi.fn()

vi.mock('../../api/targets', () => ({
  targetsApi: { list: (...args: unknown[]) => targetsListMock(...args) },
}))

const items: ScrapeJobInstanceItem[] = [
  { resource_id: 'srv-1', instance_name: 'web-1', instance_ip: '10.0.0.1', status: 'confirmed' },
  { resource_id: 'srv-2', instance_name: 'web-2', instance_ip: '10.0.0.2', status: 'confirmed' },
  { resource_id: 'srv-3', instance_name: 'db-1', instance_ip: '10.0.0.3', status: 'unconfirmed' },
]

function target(over: Record<string, unknown> = {}) {
  return {
    scrapePool: 'job-x',
    job: 'job-x',
    instance: '10.0.0.1:9104',
    network_domain: 'default',
    health: 'up',
    lastScrape: '2026-09-01T10:00:00Z',
    lastError: '',
    scrapeDuration: 0.02,
    resource_id: 'srv-1',
    ...over,
  }
}

describe('useScrapeJobStatus', () => {
  beforeEach(() => {
    targetsListMock.mockReset()
  })

  it('未确认下发（deployed=false）时全部待采集且不调 targets API', () => {
    const { result } = renderHook(() => useScrapeJobStatus('job-x', false, items))
    expect(result.current.summary).toEqual({ online: 0, total: 3, pending: 3 })
    expect(Object.values(result.current.statusMap).every((s) => s === 'pending')).toBe(true)
    expect(targetsListMock).not.toHaveBeenCalled()
  })

  it('已确认下发时按 target health 推导 up/down/待采集，并触发 3 个缓存计数', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: {
        activeTargets: [
          target(), // srv-1 host 10.0.0.1 -> collecting
          target({ resource_id: 'srv-2', instance: '10.0.0.2:9104', health: 'down' }), // down
        ],
        droppedTargets: [],
        targetsByJob: {},
      },
    })
    const { result } = renderHook(() => useScrapeJobStatus('job-x', true, items))
    expect(targetsListMock).toHaveBeenCalledWith({ job: 'job-x' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const expected: Record<string, JobInstanceScrapeStatus> = {
      'srv-1': 'collecting',
      'srv-2': 'down',
      'srv-3': 'pending', // 无对应 target
    }
    expect(result.current.statusMap).toEqual(expected)
    expect(result.current.summary).toEqual({ online: 1, total: 3, pending: 1 })
  })

  it('target resource_id 缺失时回落 host 匹配', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: {
        activeTargets: [target({ resource_id: undefined, instance: '10.0.0.3:9104', health: 'up' })],
        droppedTargets: [],
        targetsByJob: {},
      },
    })
    const { result } = renderHook(() => useScrapeJobStatus('job-x', true, items))
    await waitFor(() => expect(result.current.statusMap['srv-3']).toBe('collecting'))
  })

  it('target unknown 归为待采集', async () => {
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: {
        activeTargets: [target({ health: 'unknown' })],
        droppedTargets: [],
        targetsByJob: {},
      },
    })
    const { result } = renderHook(() => useScrapeJobStatus('job-x', true, items))
    await waitFor(() => expect(result.current.statusMap['srv-1']).toBe('pending'))
  })

  it('无 jobName 时不发起请求', () => {
    renderHook(() => useScrapeJobStatus(undefined, true, items))
    expect(targetsListMock).not.toHaveBeenCalled()
  })
})