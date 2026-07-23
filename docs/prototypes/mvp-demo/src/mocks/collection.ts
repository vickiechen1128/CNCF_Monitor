export interface ScrapeTarget {
  id: string
  job: string
  instance: string
  resource_type: string
  app: string
  env: string
  cluster: string
  status: 'up' | 'down' | 'unknown'
  last_scrape: string
  last_error: string
}

export interface ProbeResult {
  id: string
  target: string
  job: string
  probe_success: number
  probe_duration: number
  last_scrape: string
}

export const scrapeTargets: ScrapeTarget[] = [
  { id: 't1', job: 'node-exporter-prod', instance: '10.0.1.10:9100', resource_type: 'host', app: 'order-service', env: 'prod', cluster: 'bj-01', status: 'up', last_scrape: '2026-07-21 10:05:00', last_error: '' },
  { id: 't2', job: 'node-exporter-prod', instance: '10.0.1.11:9100', resource_type: 'host', app: 'order-service', env: 'prod', cluster: 'bj-01', status: 'up', last_scrape: '2026-07-21 10:05:12', last_error: '' },
  { id: 't3', job: 'mysqld-exporter-prod', instance: '10.0.1.50:9104', resource_type: 'middleware', app: 'order-service', env: 'prod', cluster: 'bj-01', status: 'up', last_scrape: '2026-07-21 10:04:58', last_error: '' },
  { id: 't4', job: 'simple-agent-staging', instance: '10.0.2.30:8080', resource_type: 'application', app: 'user-service', env: 'staging', cluster: 'sh-01', status: 'down', last_scrape: '2026-07-21 10:03:20', last_error: 'connection refused' },
]

export const probeResults: ProbeResult[] = [
  { id: 'p1', target: 'https://order.example.com/api/health', job: 'blackbox-http', probe_success: 1, probe_duration: 0.023, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p2', target: 'https://user.example.com/api/health', job: 'blackbox-http', probe_success: 1, probe_duration: 0.031, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p3', target: 'https://pay.example.com/api/health', job: 'blackbox-http', probe_success: 0, probe_duration: 0.512, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p4', target: '10.0.1.50:3306', job: 'blackbox-tcp', probe_success: 1, probe_duration: 0.005, last_scrape: '2026-07-21 10:05:00' },
]
