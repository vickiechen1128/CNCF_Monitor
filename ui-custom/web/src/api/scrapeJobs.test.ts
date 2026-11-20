import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scrapeJobApi } from './scrapeJobs'

describe('scrapeJobs v3 adapter', () => {
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

  const v3Job = {
    id: 'job-1',
    job_name: 'host-prod',
    job_type: 'standard',
    resource_category: 'host',
    monitor_type: 'host_linux',
    exporter_template_id: 'exp-1',
    exporter_template_name: 'node-exporter',
    network_domain_id: 'mc-demo',
    network_domain_name: '演示采集域',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-1'],
    selected_instance_count: 1,
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    auth_type: 'none',
    username: '',
    credential_configured: false,
    tls_skip_verify: false,
    ca_file: '',
    label_template_id: '',
    label_template_name: '',
    blackbox_module: '',
    target_field: '',
    mapping_overrides: [],
    draft_status: 'ready',
    enabled: true,
    sync: { status: 'synced', version: 'v1', error: '', synced_at: null },
    created_at: '2026-11-16T10:00:00Z',
    updated_at: '2026-11-16T10:00:00Z',
  }

  it('lists from /api/v3 and maps sync/resource_category', async () => {
    mockFetch({ status: 'success', data: { list: [v3Job], total: 1, page: 1, page_size: 20 } })
    const res = await scrapeJobApi.list({ network_domain_id: 'mc-demo', page: 1, page_size: 20 })

    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs')
    expect(res.data.list[0]).toMatchObject({
      id: 'job-1',
      resource_type: 'host',
      sync: { status: 'synced', version: 'v1' },
      change_status: 'none',
    })
  })

  it('creates with v3 payload and drops legacy-only fields', async () => {
    mockFetch({ status: 'success', data: v3Job })
    await scrapeJobApi.create({
      job_name: 'host-prod',
      resource_type: 'host',
      template_code: 'host_linux',
      selector: { logic: 'all', filters: [{ field: 'os_family', operator: 'eq', values: ['linux'] }] },
      network_domain_id: 'mc-demo',
      selected_instance_ids: ['res-1'],
      mapping_overrides: [{ field: 'scrape_interval', value: '30s' }],
      blackbox_targets: [],
    })

    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs')
    const body = lastBody() as Record<string, unknown>
    expect(body.resource_category).toBe('host')
    expect(body.template_code).toBe('host_linux')
    expect(body).not.toHaveProperty('monitor_type')
    expect(body).not.toHaveProperty('mapping_overrides')
    expect(body).not.toHaveProperty('blackbox_targets')
  })

  it('maps candidates to the legacy view', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [{
          resource_id: 'res-1', resource_category: 'host', template_code: 'host_linux',
          display_name: 'web-01', instance_ip: '10.0.0.1', port: 0,
          target_address: '10.0.0.1:9100', network_domain_id: 'mc-demo',
          status: 'online', selectable: true, disabled_reason: '',
        }],
        total: 1, page: 1, page_size: 20,
      },
    })
    const res = await scrapeJobApi.instanceCandidates({ template_code: 'host_linux', network_domain_id: 'mc-demo' })
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs/instance-candidates')
    expect(res.data.list[0]).toMatchObject({ resource_id: 'res-1', instance_name: 'web-01', disabled: false })
  })

  it('maps instances list envelope to items', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [{
          resource_id: 'res-1', display_name: 'web-01', instance_ip: '10.0.0.1', port: 9100,
          status: 'online', target_address: '10.0.0.1:9100',
          installation: { status: 'confirmed', actual_port: 9100, confirmed_by: 'ops', notes: '', confirmed_at: null },
        }],
        total: 1,
      },
    })
    const res = await scrapeJobApi.instances('job-1')
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs/job-1/instances')
    expect(res.data.items[0]).toMatchObject({ resource_id: 'res-1', instance_name: 'web-01', status: 'confirmed' })
  })

  it('flattens preview target groups', async () => {
    mockFetch({
      status: 'success',
      data: {
        job_name: 'host-prod',
        targets: [{ targets: ['10.0.0.1:9100'], labels: { resource_id: 'res-1' } }],
        skipped: [],
      },
    })
    const res = await scrapeJobApi.previewTargets('job-1')
    expect(res.data.targets).toEqual([{ resource_id: 'res-1', address: '10.0.0.1:9100', port_source: '' }])
  })

  it('uses v3 delete and confirm paths', async () => {
    mockFetch({ status: 'success', data: { job_id: 'job-1' } })
    await scrapeJobApi.remove('job-1')
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs/job-1')

    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockClear()
    mockFetch({
      status: 'success',
      data: {
        resource_id: 'res-1', job_id: 'job-1',
        installation: { status: 'confirmed', actual_port: 9100, confirmed_by: 'ops', notes: '', confirmed_at: null },
      },
    })
    const res = await scrapeJobApi.confirmInstance('job-1', 'res-1', { confirmed_by: 'ops', actual_port: 9100 })
    expect(lastUrl().pathname).toBe('/api/v3/platform/scrape-jobs/job-1/instances/res-1/confirm')
    expect(res.data).toMatchObject({ resource_id: 'res-1', scrape_job_id: 'job-1', status: 'confirmed' })
  })
})
