import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  businessMetricApiV3,
  ciMappingApiV3,
  exporterTemplateApiV3,
  metricApiV3,
  probeModuleApiV3,
  ruleApiV3,
  scrapeJobApiV3,
} from './strategyV3'

function lastCall() {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
}

function lastUrl(): URL {
  return new URL(String(lastCall()[0]), window.location.origin)
}

function lastBody(): unknown {
  const text = String(lastCall()[1]?.body ?? '')
  return text ? JSON.parse(text) : undefined
}

function mockSuccess(data: unknown) {
  ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(JSON.stringify({ status: 'success', data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('M01 v3 API clients', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses the v3 exporter templates path and list envelope', async () => {
    mockSuccess({ list: [], total: 0, page: 1, page_size: 20 })
    const res = await exporterTemplateApiV3.list({ keyword: 'node', page: 2, page_size: 10 })
    expect(lastUrl().pathname).toBe('/api/v3/platform/exporter-templates')
    expect(lastUrl().searchParams.get('keyword')).toBe('node')
    expect(lastUrl().searchParams.get('page')).toBe('2')
    expect(res.data.list).toEqual([])
  })

  it('creates a scrape job with v3 payload', async () => {
    mockSuccess({ id: 'job-1', job_name: 'host-prod' })
    await scrapeJobApiV3.create({
      job_name: 'host-prod',
      job_type: 'standard',
      resource_category: 'host',
      monitor_type: 'host_linux',
      network_domain_id: 'mc-demo',
      selected_instance_ids: ['res-1'],
    })
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs')
    expect(lastBody()).toMatchObject({ job_name: 'host-prod', network_domain_id: 'mc-demo' })
  })

  it('lists candidates and instances with v3 paths', async () => {
    mockSuccess({ list: [], total: 0, page: 1, page_size: 20 })
    await scrapeJobApiV3.candidates({ monitor_type: 'host_linux', network_domain_id: 'mc-demo' })
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs/instance-candidates')

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear()
    mockSuccess({ list: [], total: 0 })
    await scrapeJobApiV3.instances('job-1')
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs/job-1/instances')
  })

  it('changes mapping label templates through the dedicated endpoint', async () => {
    mockSuccess({ id: 'map-1' })
    await ciMappingApiV3.setLabelTemplate('map-1', 'lt-1')
    expect(lastUrl().pathname).toBe('/api/v3/platform/ci-exporter-mappings/map-1/label-template')
    expect(lastBody()).toEqual({ label_template_id: 'lt-1' })
  })

  it('validates rules through POST /monitoring-rules/validate', async () => {
    mockSuccess({ valid: true, groups: 1, rules: 1, job_ref: [], promql: { status: 'passed', error: '' } })
    const res = await ruleApiV3.validate({ id: 'rule-1', rule_content: 'groups: []' })
    expect(lastUrl().pathname).toBe('/api/v3/platform/monitoring-rules/validate')
    expect(lastBody()).toEqual({ id: 'rule-1', rule_content: 'groups: []' })
    expect(res.data.valid).toBe(true)
  })

  it('uses v3 metric / business metric / probe module paths', async () => {
    mockSuccess({ list: [], total: 0, page: 1, page_size: 20 })
    await metricApiV3.list({ category: 'cpu' })
    expect(lastUrl().pathname).toBe('/api/v3/platform/metric-library')

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear()
    mockSuccess({ list: [], total: 0, page: 1, page_size: 20 })
    await businessMetricApiV3.list({ status: 'pending' })
    expect(lastUrl().pathname).toBe('/api/v3/platform/business-metrics')

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear()
    mockSuccess({ list: [], total: 0, page: 1, page_size: 20 })
    await probeModuleApiV3.list()
    expect(lastUrl().pathname).toBe('/api/v3/platform/blackbox-modules')
  })
})
