export type QueryResultType = 'matrix' | 'vector' | 'scalar' | 'string'
export type DataSourceType = 'central_scrape' | 'edge_remote_write'
export type TargetStatus = 'up' | 'down' | 'unknown'
export type AlertState = 'firing' | 'pending'
export type AlertSeverity = 'critical' | 'warning' | 'info'

export interface QueryEnvelope {
  status: 'success' | 'error'
  data: {
    resultType: QueryResultType
    result: QueryRecord[]
  }
  meta: {
    data_source: DataSourceType
    freshness_at: string
    network_domain: string
  }
}

export interface QueryRecord {
  metric: Record<string, string>
  values: [number, string][]
  value?: [number, string]
}

export interface ScrapeTarget {
  id: string
  job: string
  instance: string
  status: TargetStatus
  last_scrape: string
  last_error: string
  network_domain: string
  labels: Record<string, string>
}

export interface PrometheusAlert {
  id: string
  alertname: string
  state: AlertState
  severity: AlertSeverity
  instance: string
  active_since: string
  network_domain: string
  description: string
  labels: Record<string, string>
}

export const queryEnvelope: QueryEnvelope = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      {
        metric: {
          __name__: 'node_cpu_seconds_total',
          instance: '10.0.1.10:9100',
          mode: 'idle',
          network_domain: 'default',
          source_type: 'edge_agent',
        },
        values: [
          [1721541600, '1234567.89'],
          [1721541660, '1234597.34'],
          [1721541720, '1234626.78'],
        ],
      },
      {
        metric: {
          __name__: 'node_cpu_seconds_total',
          instance: '10.0.1.11:9100',
          mode: 'idle',
          network_domain: 'default',
          source_type: 'edge_agent',
        },
        values: [
          [1721541600, '987654.32'],
          [1721541660, '987684.76'],
          [1721541720, '987715.20'],
        ],
      },
      {
        metric: {
          __name__: 'node_cpu_seconds_total',
          instance: '10.0.2.20:9100',
          mode: 'idle',
          network_domain: 'gov-cloud-a',
          source_type: 'edge_agent',
        },
        values: [
          [1721541600, '456789.12'],
          [1721541660, '456819.56'],
          [1721541720, '456850.00'],
        ],
      },
    ],
  },
  meta: {
    data_source: 'edge_remote_write',
    freshness_at: '2026-08-02 14:30:00',
    network_domain: 'default,gov-cloud-a',
  },
}

export const queryTemplates = [
  { id: '1', name: 'CPU 使用率', expr: '100 - (avg by (instance, network_domain) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' },
  { id: '2', name: '内存可用率', expr: 'node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes * 100' },
  { id: '3', name: '拨测成功率', expr: 'probe_success' },
  { id: '4', name: '跨网域统一查询', expr: 'up{network_domain=~"default|gov-cloud-a"}' },
  { id: '5', name: '磁盘使用率', expr: '100 - (node_filesystem_avail_bytes / node_filesystem_size_bytes * 100)' },
  { id: '6', name: '网络接收速率', expr: 'rate(node_network_receive_bytes_total[5m])' },
]

export const scrapeTargets: ScrapeTarget[] = [
  {
    id: 'target-001',
    job: 'node-exporter',
    instance: '10.0.1.10:9100',
    status: 'up',
    last_scrape: '2026-08-02 14:30:00',
    last_error: '',
    network_domain: 'default',
    labels: { env: 'production', app: '电商前台' },
  },
  {
    id: 'target-002',
    job: 'node-exporter',
    instance: '10.0.1.11:9100',
    status: 'up',
    last_scrape: '2026-08-02 14:29:55',
    last_error: '',
    network_domain: 'default',
    labels: { env: 'production', app: '订单服务' },
  },
  {
    id: 'target-003',
    job: 'node-exporter',
    instance: '10.0.2.20:9100',
    status: 'up',
    last_scrape: '2026-08-02 14:29:50',
    last_error: '',
    network_domain: 'gov-cloud-a',
    labels: { env: 'production', app: '政务网关' },
  },
  {
    id: 'target-004',
    job: 'node-exporter',
    instance: '10.0.2.21:9100',
    status: 'down',
    last_scrape: '2026-08-02 14:25:00',
    last_error: 'connection refused',
    network_domain: 'gov-cloud-a',
    labels: { env: 'production', app: '政务数据库' },
  },
  {
    id: 'target-005',
    job: 'blackbox-tcp',
    instance: '10.0.3.20:22',
    status: 'down',
    last_scrape: '2026-08-02 14:28:00',
    last_error: 'dial tcp 10.0.3.20:22: i/o timeout',
    network_domain: 'finance-dmz',
    labels: { env: 'production', app: '金融核心' },
  },
  {
    id: 'target-006',
    job: 'blackbox-http',
    instance: 'https://api.example.com/health',
    status: 'up',
    last_scrape: '2026-08-02 14:29:58',
    last_error: '',
    network_domain: 'default',
    labels: { env: 'production', app: 'API 网关' },
  },
]

export const prometheusAlerts: PrometheusAlert[] = [
  {
    id: 'alert-001',
    alertname: 'HighCPUUsage',
    state: 'firing',
    severity: 'warning',
    instance: '10.0.1.11:9100',
    active_since: '2026-08-02 14:15:00',
    network_domain: 'default',
    description: 'CPU 使用率超过 80% 持续 5 分钟',
    labels: { job: 'node-exporter', severity: 'warning' },
  },
  {
    id: 'alert-002',
    alertname: 'InstanceDown',
    state: 'firing',
    severity: 'critical',
    instance: '10.0.3.20:22',
    active_since: '2026-08-02 14:20:00',
    network_domain: 'finance-dmz',
    description: '目标实例持续不可达',
    labels: { job: 'blackbox-tcp', severity: 'critical' },
  },
  {
    id: 'alert-003',
    alertname: 'HighMemoryUsage',
    state: 'pending',
    severity: 'warning',
    instance: '10.0.2.20:9100',
    active_since: '2026-08-02 14:25:00',
    network_domain: 'gov-cloud-a',
    description: '内存使用率接近阈值',
    labels: { job: 'node-exporter', severity: 'warning' },
  },
  {
    id: 'alert-004',
    alertname: 'DiskSpaceLow',
    state: 'firing',
    severity: 'critical',
    instance: '10.0.1.10:9100',
    active_since: '2026-08-02 14:10:00',
    network_domain: 'default',
    description: '磁盘可用空间低于 10%',
    labels: { job: 'node-exporter', severity: 'critical' },
  },
  {
    id: 'alert-005',
    alertname: 'ProbeFailed',
    state: 'pending',
    severity: 'info',
    instance: 'https://api.example.com/health',
    active_since: '2026-08-02 14:28:00',
    network_domain: 'default',
    description: '拨测探针失败一次',
    labels: { job: 'blackbox-http', severity: 'info' },
  },
]
