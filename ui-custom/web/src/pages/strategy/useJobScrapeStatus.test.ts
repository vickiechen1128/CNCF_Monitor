import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { useJobScrapeStatus } from './useJobScrapeStatus'
import type { ScrapeJob } from '../../types/strategy'
import type { PromVectorItem } from '../../types/query'

const instancesMock = vi.fn()
const previewTargetsMock = vi.fn()
const queryMock = vi.fn()

vi.mock('../../api/scrapeJobs', () => ({
  scrapeJobApi: {
    instances: (...args: unknown[]) => instancesMock(...args),
    previewTargets: (...args: unknown[]) => previewTargetsMock(...args),
  },
}))

vi.mock('../../api/query', () => ({
  queryApi: { query: (...args: unknown[]) => queryMock(...args) },
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

/** 构造一条 up 样本（Prometheus vector item） */
function up(over: Partial<PromVectorItem['metric']> = {}, value = '1'): PromVectorItem {
  return {
    metric: { __name__: 'up', job: 'job-x', instance: '10.0.0.1:9104', ...over },
    value: [1735780000, value],
  }
}

function vector(result: PromVectorItem[]) {
  return { status: 'success', data: { resultType: 'vector' as const, result } }
}

describe('useJobScrapeStatus（Job 维度采集状态聚合，F-10：up 指标）', () => {
  beforeEach(() => {
    instancesMock.mockReset()
    previewTargetsMock.mockReset()
    queryMock.mockReset()
  })

  // 20s 自动刷新 interval：确保每个用例卸载释放定时器
  afterEach(() => {
    cleanup()
  })

  it('空列表时立即返回空映射且不发起请求', () => {
    const { result } = renderHook(() => useJobScrapeStatus([]))
    expect(Object.keys(result.current)).toHaveLength(0)
    expect(instancesMock).not.toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('未下发（change_status!=deployed）时全体实例归为待采集且不调 query', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    const { result } = renderHook(() => useJobScrapeStatus([job({ change_status: 'confirmed' })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'pending', online: 0, down: 0, pending: 2, total: 2 })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('已下发：online>0 聚合为采集中，并带上在线/总数计数', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    queryMock.mockResolvedValue(vector([up({ resource_id: 'srv-1' }), up({ resource_id: 'srv-2' })]))
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(queryMock).toHaveBeenCalledWith({ query: 'up{job="job-x"}' })
    expect(result.current[1]).toMatchObject({ state: 'collecting', online: 2, down: 0, pending: 0, total: 2 })
  })

  it('已下发：响应 missing_count 透传到视图（资源软删后失效引用不计入分母，F-38/F-39）', async () => {
    instancesMock.mockResolvedValue({
      status: 'success',
      data: { items: [instance('srv-1'), instance('srv-2')], total: 2, missing_count: 3 },
    })
    queryMock.mockResolvedValue(vector([up({ resource_id: 'srv-1' }), up({ resource_id: 'srv-2' })]))
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    // total=2 仅含有效实例（分母同源）；missingCount=3 为已软删/失效引用，供 Tooltip 提示
    expect(result.current[1]).toMatchObject({ state: 'collecting', online: 2, total: 2, missingCount: 3 })
  })

  it('已下发：无 online 但有 down 聚合为已下发未采到', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    queryMock.mockResolvedValue(vector([up({ resource_id: 'srv-1' }, '0'), up({ resource_id: 'srv-2' }, '0')]))
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'down', online: 0, down: 2, pending: 0 })
  })

  it('F-40：无 online/down 但有 stale 聚合为回传延迟中（up 瞬时空、1h 内有样本）', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1'), instance('srv-2')], total: 2 } })
    // up（瞬时）为空；last_over_time 命中 srv-1 → stale=1，srv-2 1h 内也无样本 → pending=1
    queryMock.mockImplementation(({ query }: { query: string }) => {
      if (query.startsWith('timestamp(last_over_time(')) {
        return Promise.resolve(vector([up({ resource_id: 'srv-1' })]))
      }
      return Promise.resolve(vector([]))
    })
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'stale', online: 0, down: 0, stale: 1, pending: 1, total: 2 })
  })

  it('实例拉取失败时降级为无已选实例（待采集，total=0）', async () => {
    instancesMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'pending', online: 0, total: 0 })
  })

  it('query（up 指标）拉取失败时降级为全部待采集', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1')], total: 1 } })
    queryMock.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })]))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    expect(result.current[1]).toMatchObject({ state: 'pending', online: 0, pending: 1, total: 1 })
  })

  it('拨测 Job（blackbox）按 preview-targets 目标 + probe_success 聚合「通过 x / 总数 y」，不查实例（F-12）', async () => {
    previewTargetsMock.mockResolvedValue({
      status: 'success',
      data: {
        targets: [
          { resource_id: 'res-1', address: 'http://1.1.1.1:3000/login', protocol: 'http' },
          { resource_id: 'res-2', address: 'http://2.2.2.2:3000/login', protocol: 'http' },
        ],
      },
    })
    queryMock.mockResolvedValue(
      vector([
        {
          metric: { __name__: 'probe_success', job: 'bb', instance: 'http://1.1.1.1:3000/login', resource_id: 'res-1' },
          value: [1735780000, '1'],
        },
        {
          metric: { __name__: 'probe_success', job: 'bb', instance: 'http://2.2.2.2:3000/login', resource_id: 'res-2' },
          value: [1735780000, '0'],
        },
      ]),
    )
    const bb = job({
      id: 9,
      job_name: 'bb',
      job_type: 'blackbox',
      selected_instance_ids: ['res-1', 'res-2'],
    })
    const { result } = renderHook(() => useJobScrapeStatus([bb]))
    await waitFor(() => expect(result.current[9]?.loaded).toBe(true))
    expect(previewTargetsMock).toHaveBeenCalledWith(9)
    expect(queryMock).toHaveBeenCalledWith({ query: 'probe_success{job="bb"}' })
    expect(instancesMock).not.toHaveBeenCalled()
    expect(result.current[9]).toMatchObject({ state: 'collecting', online: 1, down: 1, pending: 0, total: 2 })
  })

  it('拨测 Job 未下发时不查 probe_success，目标统一「待拨测」（F-12）', async () => {
    previewTargetsMock.mockResolvedValue({
      status: 'success',
      data: { targets: [{ resource_id: 'res-1', address: 'http://1.1.1.1:3000/login', protocol: 'http' }] },
    })
    const bb = job({
      id: 9,
      job_name: 'bb',
      job_type: 'blackbox',
      change_status: 'confirmed',
      selected_instance_ids: ['res-1'],
    })
    const { result } = renderHook(() => useJobScrapeStatus([bb]))
    await waitFor(() => expect(result.current[9]?.loaded).toBe(true))
    expect(result.current[9]).toMatchObject({ state: 'pending', online: 0, down: 0, pending: 1, total: 1 })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('拨测 Job preview-targets 解析失败时降级为无目标（total=0）', async () => {
    previewTargetsMock.mockRejectedValue(new Error('boom'))
    const bb = job({ id: 9, job_name: 'bb', job_type: 'blackbox', selected_instance_ids: ['res-1'] })
    const { result } = renderHook(() => useJobScrapeStatus([bb]))
    await waitFor(() => expect(result.current[9]?.loaded).toBe(true))
    expect(result.current[9]).toMatchObject({ state: 'pending', online: 0, down: 0, pending: 0, total: 0 })
    expect(queryMock).not.toHaveBeenCalled()
  })

  it('20s 自动刷新触发重新聚合（F-10 只读消费，短周期传参验证）', async () => {
    instancesMock.mockResolvedValue({ status: 'success', data: { items: [instance('srv-1')], total: 1 } })
    queryMock.mockResolvedValue(vector([up({ resource_id: 'srv-1' })]))
    // 用短周期 refreshMs 快速触发 tick 递增以验证自动刷新；业务默认 20000ms
    const { result } = renderHook(() => useJobScrapeStatus([job({ id: 1 })], 30))
    await waitFor(() => expect(result.current[1]?.loaded).toBe(true))
    // 自动刷新（短周期 30ms）会持续重新聚合：等待出现至少第二次调用即可证明 tick 驱动刷新
    await waitFor(() => expect(instancesMock.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 })
  })
})