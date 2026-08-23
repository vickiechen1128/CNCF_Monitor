import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { scrapeJobApi } from './scrapeJobs'

describe('scrapeJobs API', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mockFetch(body: unknown, init: ResponseInit = {}) {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
      }),
    )
  }

  function lastFetchCall() {
    return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
  }

  function lastUrlInstance(): URL {
    return new URL(String(lastFetchCall()[0]), window.location.origin)
  }

  function lastInitBody(): unknown {
    const text = String(lastFetchCall()[1]?.body ?? '')
    return text ? JSON.parse(text) : undefined
  }

  it('list sends network_domain_id/monitor_type/job_type/enabled/keyword params', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await scrapeJobApi.list({
      network_domain_id: 'mc-a',
      monitor_type: 'mysql',
      job_type: 'standard',
      enabled: false,
      keyword: 'prod',
      page: 1,
      page_size: 20,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs')
    expect(url.searchParams.get('network_domain_id')).toBe('mc-a')
    expect(url.searchParams.get('monitor_type')).toBe('mysql')
    expect(url.searchParams.get('job_type')).toBe('standard')
    expect(url.searchParams.get('enabled')).toBe('false')
    expect(url.searchParams.get('keyword')).toBe('prod')
  })

  it('list supports label_template_id reverse lookup', async () => {
    mockFetch({ status: 'success', data: { list: [], total: 0, page: 1, page_size: 20 } })

    await scrapeJobApi.list({ label_template_id: 3 })

    expect(lastUrlInstance().searchParams.get('label_template_id')).toBe('3')
  })

  it('create POSTs a full standard job input', async () => {
    mockFetch({
      status: 'success',
      data: {
        id: 1,
        job_name: 'prod-mysql-01',
        job_type: 'standard',
        monitor_type: 'mysql',
        scrap_interval: '15s',
        change_status: 'pending',
      },
    })

    const res = await scrapeJobApi.create({
      job_name: 'prod-mysql-01',
      monitor_type: 'mysql',
      exporter_template_id: 'mysqld-exporter',
      network_domain_id: 'mc-a',
      instance_selection_mode: 'manual',
      selected_instance_ids: ['r-1'],
      scrape_interval: '15s',
      metrics_path: '/metrics',
      scheme: 'http',
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      job_name: 'prod-mysql-01',
      monitor_type: 'mysql',
      exporter_template_id: 'mysqld-exporter',
      network_domain_id: 'mc-a',
      instance_selection_mode: 'manual',
      selected_instance_ids: ['r-1'],
      scrape_interval: '15s',
      metrics_path: '/metrics',
      scheme: 'http',
    })
    expect(res.data.job_name).toBe('prod-mysql-01')
  })

  it('create POSTs blackbox input with blackbox_targets', async () => {
    mockFetch({
      status: 'success',
      data: { id: 2, job_name: 'probe-web', job_type: 'blackbox', blackbox_module: 'http_2xx' },
    })

    await scrapeJobApi.create({
      job_name: 'probe-web',
      job_type: 'blackbox',
      network_domain_id: 'mc-a',
      blackbox_module: 'http_2xx',
      blackbox_targets: [{ target: 'https://example.com', protocol: 'https', url: '/health' }],
      scrape_interval: '30s',
    })

    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({
      job_name: 'probe-web',
      job_type: 'blackbox',
      network_domain_id: 'mc-a',
      blackbox_module: 'http_2xx',
      blackbox_targets: [{ target: 'https://example.com', protocol: 'https', url: '/health' }],
      scrape_interval: '30s',
    })
  })

  it('update PUTs /:id', async () => {
    mockFetch({ status: 'success', data: { id: 1, job_name: 'prod-mysql-01' } })

    await scrapeJobApi.update(1, { job_name: 'prod-mysql-01', scrape_interval: '30s' })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs/1')
    expect(lastFetchCall()[1]?.method).toBe('PUT')
    expect(lastInitBody()).toEqual({ job_name: 'prod-mysql-01', scrape_interval: '30s' })
  })

  it('remove DELETEs /:id', async () => {
    mockFetch({ status: 'success', data: { id: 1 } })

    const res = await scrapeJobApi.remove(1)

    expect(lastUrlInstance().pathname).toBe('/api/v2/platform/scrape-jobs/1')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.id).toBe(1)
  })

  it('instanceCandidates sends monitor_type+network_domain_id+keyword params', async () => {
    mockFetch({
      status: 'success',
      data: {
        list: [
          { resource_id: 'r-1', instance_name: 'web-01', instance_ip: '10.0.0.1', status: 'online', disabled: false },
          { resource_id: 'r-2', instance_name: 'web-02', instance_ip: '10.0.0.2', status: 'offline', disabled: true },
        ],
        total: 2,
        page: 1,
        page_size: 20,
      },
    })

    const res = await scrapeJobApi.instanceCandidates({
      monitor_type: 'mysql',
      network_domain_id: 'mc-a',
      keyword: 'web',
      page: 1,
      page_size: 20,
    })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs/instance-candidates')
    expect(url.searchParams.get('monitor_type')).toBe('mysql')
    expect(url.searchParams.get('network_domain_id')).toBe('mc-a')
    expect(url.searchParams.get('keyword')).toBe('web')
    expect(res.data.list[1].disabled).toBe(true)
  })

  it('instances GETs {items,total} envelope for sub-resource', async () => {
    mockFetch({
      status: 'success',
      data: {
        items: [{ resource_id: 'r-1', instance_name: 'web-01', instance_ip: '10.0.0.1', status: 'confirmed' }],
        total: 1,
      },
    })

    const res = await scrapeJobApi.instances(3)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs/3/instances')
    expect(lastFetchCall()[1]?.method).toBe('GET')
    // 子资源信封为 items（§1.3），而非主资源 list
    expect(res.data.total).toBe(1)
    expect(res.data.items[0].status).toBe('confirmed')
  })

  it('confirmInstance POSTs {confirmed_by,...} to /confirm', async () => {
    mockFetch({
      status: 'success',
      data: { resource_id: 'r-1', scrape_job_id: 3, status: 'confirmed', confirmed_by: 'platform_admin' },
    })

    await scrapeJobApi.confirmInstance(3, 'r-1', { confirmed_by: 'platform_admin', actual_port: 9104 })

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs/3/instances/r-1/confirm')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(lastInitBody()).toEqual({ confirmed_by: 'platform_admin', actual_port: 9104 })
  })

  it('unconfirmInstance DELETEs /confirm and returns {resource_id, job_id}', async () => {
    mockFetch({ status: 'success', data: { resource_id: 'r-1', job_id: 3 } })

    const res = await scrapeJobApi.unconfirmInstance(3, 'r-1')

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs/3/instances/r-1/confirm')
    expect(lastFetchCall()[1]?.method).toBe('DELETE')
    expect(res.data.job_id).toBe(3)
  })

  it('previewTargets POSTs /preview-targets', async () => {
    mockFetch({
      status: 'success',
      data: { targets: [{ address: '10.0.0.1:9104' }, { address: '10.0.0.2:9104' }] },
    })

    const res = await scrapeJobApi.previewTargets(3)

    const url = lastUrlInstance()
    expect(url.pathname).toBe('/api/v2/platform/scrape-jobs/3/preview-targets')
    expect(lastFetchCall()[1]?.method).toBe('POST')
    expect(res.data.targets.length).toBe(2)
  })
})