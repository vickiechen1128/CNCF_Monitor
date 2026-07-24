export interface ScrapeTarget {
  id: string
  network_domain_id: string
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
  network_domain_id: string
  target: string
  job: string
  probe_success: number
  probe_duration: number
  last_scrape: string
}

export const scrapeTargets: ScrapeTarget[] = [
  { id: 't1', network_domain_id: 'default', job: 'node-exporter-prod', instance: '10.0.1.10:9100', resource_type: 'host', app: 'order-service', env: 'prod', cluster: 'bj-01', status: 'up', last_scrape: '2026-07-21 10:05:00', last_error: '' },
  { id: 't2', network_domain_id: 'default', job: 'node-exporter-prod', instance: '10.0.1.11:9100', resource_type: 'host', app: 'order-service', env: 'prod', cluster: 'bj-01', status: 'up', last_scrape: '2026-07-21 10:05:12', last_error: '' },
  { id: 't3', network_domain_id: 'default', job: 'mysqld-exporter-prod', instance: '10.0.1.50:9104', resource_type: 'middleware', app: 'order-service', env: 'prod', cluster: 'bj-01', status: 'up', last_scrape: '2026-07-21 10:04:58', last_error: '' },
  { id: 't4', network_domain_id: 'gov-cloud-a', job: 'simple-agent-staging', instance: '10.0.2.30:8080', resource_type: 'application', app: 'user-service', env: 'staging', cluster: 'sh-01', status: 'down', last_scrape: '2026-07-21 10:03:20', last_error: 'connection refused' },
  { id: 't5', network_domain_id: 'finance-dmz', job: 'node-exporter-finance', instance: '10.0.3.10:9100', resource_type: 'host', app: 'payment-service', env: 'staging', cluster: 'sh-01', status: 'unknown', last_scrape: '2026-07-21 09:50:00', last_error: 'site offline, inhibited' },
]

export const probeResults: ProbeResult[] = [
  { id: 'p1', network_domain_id: 'default', target: 'https://order.example.com/api/health', job: 'blackbox-http', probe_success: 1, probe_duration: 0.023, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p2', network_domain_id: 'default', target: 'https://user.example.com/api/health', job: 'blackbox-http', probe_success: 1, probe_duration: 0.031, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p3', network_domain_id: 'finance-dmz', target: 'https://pay.example.com/api/health', job: 'blackbox-http', probe_success: 0, probe_duration: 0.512, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p4', network_domain_id: 'default', target: '10.0.1.50:3306', job: 'blackbox-tcp', probe_success: 1, probe_duration: 0.005, last_scrape: '2026-07-21 10:05:00' },
  { id: 'p5', network_domain_id: 'gov-cloud-a', target: 'https://user-gov.example.com/api/health', job: 'blackbox-http-gov', probe_success: 1, probe_duration: 0.041, last_scrape: '2026-07-21 10:05:00' },
]
