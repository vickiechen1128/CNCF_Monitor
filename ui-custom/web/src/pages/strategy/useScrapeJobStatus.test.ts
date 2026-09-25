import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useScrapeJobStatus, type JobInstanceScrapeStatus } from './useScrapeJobStatus'
import type { ScrapeJobInstanceItem } from '../../types/strategy'
import type { PromVectorItem } from '../../types/query'

const queryMock = vi.fn()

vi.mock('../../api/query', () => ({
  queryApi: { query: (...args: unknown[]) => queryMock(...args) },
}))

const items: ScrapeJobInstanceItem[] = [
  { resource_id: 'srv-1', instance_name: 'web-1', instance_ip: '10.0.0.1', status: 'confirmed' },
  { resource_id: 'srv-2', instance_name: 'web-2', instance_ip: '10.0.0.2', status: 'confirmed' },
  { resource_id: 'srv-3', instance_name: 'db-1', instance_ip: '10.0.0.3', status: 'unconfirmed' },
]

/** 构造一条 up 样本（Prometheus vector item） */
function up(over: Partial<PromVectorItem['metric']> = {}, value = '1'): PromVectorItem {
  return {
    metric: { __name__: 'up', job: 'job-x', instance: '10.0.0.1:9104', ...over },
    value: [1735780000, value],
  }
}

/** 包装为 query 接口返回体（vector resultType） */
function vector(result: PromVectorItem[]) {
  return { status: 'success', data: { resultType: 'vector' as const, result } }
}

describe('useScrapeJobStatus（F-10：up 指标推导）', () => {
  beforeEach(() => {
    queryMock.mockReset()
  })

  it('未确认下发（deployed=false）时全部待采集且不调 query API', () => {
    const { result } = renderHook(() => useScrapeJobStatus('job-x', false, items))
    expect(result.current.summary).toEqual({ online: 0, total: 3, pending: 3 })
    expect(Object.values(result.current.statusMap).every((s) => s === 'pending')).toBe(true)
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('已确认下发时按 up 值推导 collecting/down/待采集，并带上缓存计数', async () => {
    // srv-1：up=1 -> collecting；srv-2：up=0 -> down；srv-3：无样本 -> pending
    queryMock.mockResolvedValue(vector([up({ resource_id: 'srv-1' }), up({ resource_id: 'srv-2' }, '0')]))
    const { result } = renderHook(() => useScrapeJobStatus('job-x', true, items))
    expect(queryMock).toHaveBeenCalledWith({ query: 'up{job="job-x"}' })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const expected: Record<string, JobInstanceScrapeStatus> = {
      'srv-1': 'collecting',
      'srv-2': 'down',
      'srv-3': 'pending', // 无对应 up 样本
    }
    expect(result.current.statusMap).toEqual(expected)
    expect(result.current.summary).toEqual({ online: 1, total: 3, pending: 1 })
  })

  it('up 样本 resource_id 缺失时回落 host 匹配', async () => {
    queryMock.mockResolvedValue(vector([up({ resource_id: undefined, instance: '10.0.0.3:9104' })]))
    const { result } = renderHook(() => useScrapeJobStatus('job-x', true, items))
    await waitFor(() => expect(result.current.statusMap['srv-3']).toBe('collecting'))
  })

  it('query 失败时降级为全部待采集', async () => {
    queryMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useScrapeJobStatus('job-x', true, items))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(Object.values(result.current.statusMap).every((s) => s === 'pending')).toBe(true)
  })

  it('无 jobName 时不发起请求', () => {
    renderHook(() => useScrapeJobStatus(undefined, true, items))
    expect(queryMock).not.toHaveBeenCalled()
  })
})