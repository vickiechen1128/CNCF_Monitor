export interface LabelTemplate {
  id: string
  name: string
  resource_type: string
  mappings: { source_field: string; target_label: string; source_type: string }[]
}

export interface ScrapeJob {
  id: string
  network_domain_id: string
  job_name: string
  resource_type: string
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: string
  enabled: boolean
}

export interface ProbeConfig {
  id: string
  network_domain_id: string
  job_name: string
  module: string
  targets: string[]
  scrape_interval: string
  enabled: boolean
}

export const labelTemplates: LabelTemplate[] = [
  {
    id: 'lt-host',
    name: '主机默认标签模板',
    resource_type: 'host',
    mappings: [
      { source_field: 'app_name', target_label: 'app', source_type: 'cmdb' },
      { source_field: 'env', target_label: 'env', source_type: 'cmdb' },
      { source_field: 'cluster', target_label: 'cluster', source_type: 'cmdb' },
      { source_field: 'hostname', target_label: 'hostname', source_type: 'cmdb' },
      { source_field: 'instance_ip:port', target_label: 'instance', source_type: 'composite' },
    ],
  },
  {
    id: 'lt-middleware',
    name: '中间件默认标签模板',
    resource_type: 'middleware',
    mappings: [
      { source_field: 'app_name', target_label: 'app', source_type: 'cmdb' },
      { source_field: 'env', target_label: 'env', source_type: 'cmdb' },
      { source_field: 'cluster', target_label: 'cluster', source_type: 'cmdb' },
      { source_field: 'middleware_type', target_label: 'middleware_type', source_type: 'cmdb' },
      { source_field: 'instance_ip:port', target_label: 'instance', source_type: 'composite' },
    ],
  },
]

export const scrapeJobs: ScrapeJob[] = [
  { id: 'sj1', network_domain_id: 'default', job_name: 'node-exporter-prod', resource_type: 'host', scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http', enabled: true },
  { id: 'sj2', network_domain_id: 'default', job_name: 'mysqld-exporter-prod', resource_type: 'middleware', scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http', enabled: true },
  { id: 'sj3', network_domain_id: 'gov-cloud-a', job_name: 'simple-agent-staging', resource_type: 'application', scrape_interval: '30s', scrape_timeout: '15s', metrics_path: '/metrics', scheme: 'http', enabled: true },
  { id: 'sj4', network_domain_id: 'finance-dmz', job_name: 'node-exporter-finance', resource_type: 'host', scrape_interval: '15s', scrape_timeout: '10s', metrics_path: '/metrics', scheme: 'http', enabled: true },
]

export const probeConfigs: ProbeConfig[] = [
  { id: 'pc1', network_domain_id: 'default', job_name: 'blackbox-http', module: 'http_2xx', targets: ['https://order.example.com/api/health'], scrape_interval: '60s', enabled: true },
  { id: 'pc2', network_domain_id: 'default', job_name: 'blackbox-tcp', module: 'tcp_connect', targets: ['10.0.1.50:3306', '10.0.1.51:6379'], scrape_interval: '60s', enabled: true },
  { id: 'pc3', network_domain_id: 'gov-cloud-a', job_name: 'blackbox-http-gov', module: 'http_2xx', targets: ['https://user-gov.example.com/api/health'], scrape_interval: '60s', enabled: true },
]

export const generatedConfig = `# 按网域生成配置示例（default 网域）
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'default'
    datacenter: 'default-dc'

scrape_configs:
  - job_name: 'node-exporter-prod'
    scrape_interval: 15s
    metrics_path: '/metrics'
    scheme: 'http'
    static_configs:
      - targets:
          - '10.0.1.10:9100'
          - '10.0.1.11:9100'
        labels:
          app: 'order-service'
          env: 'prod'
          cluster: 'bj-01'
          hostname: 'host-01'

  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - 'https://order.example.com/api/health'
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - target_label: __address__
        replacement: blackbox-exporter:9115

# 按网域生成配置示例（gov-cloud-a 网域）
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'gov-cloud-a'
    datacenter: 'gov-a-dc'

scrape_configs:
  - job_name: 'simple-agent-staging'
    scrape_interval: 30s
    metrics_path: '/metrics'
    scheme: 'http'
    static_configs:
      - targets:
          - '10.0.2.30:8080'
        labels:
          app: 'user-service'
          env: 'staging'
          cluster: 'sh-01'

  - job_name: 'blackbox-http-gov'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - 'https://user-gov.example.com/api/health'
`
