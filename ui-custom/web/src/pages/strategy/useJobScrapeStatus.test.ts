import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useJobScrapeStatus } from './useJobScrapeStatus'
import type { ScrapeJob } from '../../types/strategy'

const instancesMock = vi.fn()
const targetsListMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: { instances: (...args: unknown[]) => instancesMock(...args) },
}))

vi.mock('../../api/targets', () => ({
  targetsApi: { list: (...args: unknown[]) => targetsListMock(...args) },
}))

const job = (over: Partial<ScrapeJob> = {}): ScrapeJob =>
  ({
    id: 1,
    job_name: 'job-x',
    job_type: 'node_exporter',
    resource_type: 'host',
    monitor_type: 'host_linux',
    network_domain_id: 'nd-1',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['srv-1', 'srv-2', 'srv-3'],
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    auth_type: 'none',
    tls_skip_verify: false,
    filter_rules: '',
    draft_status: 'ready',
    change_status: 'deployed',
    enabled: true,
    created_at: '',
    updated_at: '',
    ...over,
  }) as ScrapeJob

function instance(resourceId: string) {
  return { resource_id: resourceId, instance_name: resourceId, instance_ip: `10.0.0.${resourceId.slice(-1)}`, status: 'confirmed' as const }
}

function target(over: Record<string, unknown> = {}) {
  return {
    scrapePool: 'job-x',
    job: 'job-x',
    instance: '10.0.0.1:9104',
    network_domain: 'default',
    health: 'up',
    resource_id: 'srv-1',
    ...over,
  }
}

describe('useJobScrapeStatus（Job 维度采集状态聚合）', () => {
  beforeEach(() => {
    instancesMock.mockReset()
    targetsListMock.mockReset()
  })

  it('空列表时立即返回空映射且不发起请求', () => {
    const { result } = renderHook(() => useJobScrapeStatus([]))
    expect(Object.keys(result.current)).toHaveLength(0)
    expect(instancesMock).not.toHaveBeenCalled()
    expect(targetsListMock).not.toHaveBeenCalled()
  })

  it('未下发（change_status!=deployed）时全体实例归为待采集且不调 targets', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    const { result } = renderHook(() => useJobScrapeStatus([job({ change_status: 'confirmed' })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'pending', online: 0, down: 0, pending: 2, total: 2 })
    expect(targetsListMock).not.toHaveBeenCalled()
  })

  it('已下发：online>0 聚合为采集中，并带上在线/总数计数', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: { activeTargets: [target(), target({ resource_id: 'srv-2', instance: '10.0.0.2:9104' })], droppedTargets: [], targetsByJob: {} },
    })
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(targetsListMock).toHaveBeenCalledWith({ job: 'job-x' })
    expect(result.current[1]).toMatchObject({ state: 'collecting', online: 2, down: 0, pending: 0, total: 2 })
  })

  it('已下发：无 online 但有 down 聚合为已下发未采到', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    targetsListMock.mockResolvedValue({
      status: 'success',
      data: { activeTargets: [target({ health: 'down' }), target({ resource_id: 'srv-2', instance: '10.0.0.2:9104', health: 'down' })], droppedTargets: [], targetsByJob: {} },
    })
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'down', online: 0, down: 2, pending: 0 })
  })

  it('实例拉取失败时降级为无已选实例（待采集，total=0）', async () => {
    instancesMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'pending', online: 0, total: 0 })
  })
})