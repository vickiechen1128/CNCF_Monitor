export type SourceType =
  | 'edge_agent'
  | 'external_prometheus'
  | 'zabbix'
  | 'cloud_monitor'
  | 'opentelemetry'

export type SourceStatus = 'online' | 'offline' | 'pending' | 'error'

export type IngestMethod =
  | 'remote_write'
  | 'pull'
  | 'opentelemetry'
  | 'zabbix_proxy'

export type AuthType = 'token' | 'basic' | 'mtls' | 'none'

export interface MonitoringSource {
  id: string
  name: string
  source_type: SourceType
  network_domain_id: string
  status: SourceStatus
  ingest_method: IngestMethod
  ingest_endpoint: string
  auth_type: AuthType
  auth_config: Record<string, unknown>
  remote_write_url: string
  labels: Record<string, string>
  normalization_enabled: boolean
  metric_drop_rules: string[]
  max_series_per_metric: number
}

export interface IngestionStats {
  samples_per_second: number
  requests_per_minute: number
  error_rate: number
  last_sample_timestamp: string
}

export interface NormalizationRule {
  id: string
  source_label: string
  target_label: string
  priority: number
  enabled: boolean
}

export type DropRuleType =
  | 'metric_name'
  | 'metric_prefix'
  | 'label_match'
  | 'cardinality_limit'

export type DropAction = 'keep' | 'drop' | 'sample'

export interface MetricDropRule {
  id: string
  source_id: string
  rule_type: DropRuleType
  match_value: string
  action: DropAction
  priority: number
  enabled: boolean
  sample_ratio?: number
}

const now = new Date()

export const mockMonitoringSources: MonitoringSource[] = [
  {
    id: 'src-edge-sh-01',
    name: '上海边缘 Agent-01',
    source_type: 'edge_agent',
    network_domain_id: 'default',
    status: 'online',
    ingest_method: 'remote_write',
    ingest_endpoint: '/api/v2/ingest/prometheus/src-edge-sh-01',
    auth_type: 'token',
    auth_config: {
      token: 'edge-token-xxxxxxxx',
      inject_labels: { region: 'shanghai', role: 'edge' },
    },
    remote_write_url: 'https://gateway.metric-center.local/api/v2/ingest/prometheus/src-edge-sh-01',
    labels: { env: 'production', region: 'shanghai', role: 'edge' },
    normalization_enabled: true,
    metric_drop_rules: ['dr-001'],
    max_series_per_metric: 10000,
  },
  {
    id: 'src-legacy-dc',
    name: 'Legacy DC Prometheus',
    source_type: 'external_prometheus',
    network_domain_id: 'default',
    status: 'online',
    ingest_method: 'remote_write',
    ingest_endpoint: '/api/v2/ingest/prometheus/src-legacy-dc',
    auth_type: 'basic',
    auth_config: { username: 'prometheus', password: 'legacy-pass' },
    remote_write_url: 'https://gateway.metric-center.local/api/v2/ingest/prometheus/src-legacy-dc',
    labels: { env: 'legacy', region: 'beijing', team: 'infra' },
    normalization_enabled: true,
    metric_drop_rules: ['dr-002'],
    max_series_per_metric: 20000,
  },
  {
    id: 'src-zabbix-history',
    name: 'Zabbix 历史数据',
    source_type: 'zabbix',
    network_domain_id: 'default',
    status: 'offline',
    ingest_method: 'zabbix_proxy',
    ingest_endpoint: '/api/v2/ingest/zabbix/src-zabbix-history',
    auth_type: 'token',
    auth_config: { token: 'zabbix-token-yyyyyyyy' },
    remote_write_url: '',
    labels: { env: 'production', source: 'zabbix' },
    normalization_enabled: false,
    metric_drop_rules: [],
    max_series_per_metric: 5000,
  },
  {
    id: 'src-aliyun-cloud',
    name: '阿里云监控',
    source_type: 'cloud_monitor',
    network_domain_id: 'default',
    status: 'online',
    ingest_method: 'remote_write',
    ingest_endpoint: '/api/v2/ingest/prometheus/src-aliyun-cloud',
    auth_type: 'token',
    auth_config: { token: 'cloud-token-zzzzzzzz' },
    remote_write_url: 'https://gateway.metric-center.local/api/v2/ingest/prometheus/src-aliyun-cloud',
    labels: { env: 'hybrid', cloud: 'aliyun' },
    normalization_enabled: true,
    metric_drop_rules: ['dr-003'],
    max_series_per_metric: 15000,
  },
  {
    id: 'src-k8s-otel',
    name: 'K8s OpenTelemetry',
    source_type: 'opentelemetry',
    network_domain_id: 'default',
    status: 'online',
    ingest_method: 'opentelemetry',
    ingest_endpoint: '/api/v2/ingest/otlp/src-k8s-otel',
    auth_type: 'mtls',
    auth_config: { cert_path: '/certs/otel.crt', key_path: '/certs/otel.key' },
    remote_write_url: 'https://gateway.metric-center.local/api/v2/ingest/otlp/src-k8s-otel',
    labels: { env: 'production', cluster: 'k8s-prod' },
    normalization_enabled: true,
    metric_drop_rules: ['dr-004'],
    max_series_per_metric: 50000,
  },
]

export const mockIngestionStats: Record<string, IngestionStats> = {
  'src-edge-sh-01': {
    samples_per_second: 1250,
    requests_per_minute: 45,
    error_rate: 0.001,
    last_sample_timestamp: now.toISOString(),
  },
  'src-legacy-dc': {
    samples_per_second: 8700,
    requests_per_minute: 120,
    error_rate: 0.0,
    last_sample_timestamp: new Date(now.getTime() - 30 * 1000).toISOString(),
  },
  'src-zabbix-history': {
    samples_per_second: 0,
    requests_per_minute: 0,
    error_rate: 0.0,
    last_sample_timestamp: new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString(),
  },
  'src-aliyun-cloud': {
    samples_per_second: 3200,
    requests_per_minute: 60,
    error_rate: 0.002,
    last_sample_timestamp: new Date(now.getTime() - 60 * 1000).toISOString(),
  },
  'src-k8s-otel': {
    samples_per_second: 18500,
    requests_per_minute: 300,
    error_rate: 0.0005,
    last_sample_timestamp: new Date(now.getTime() - 15 * 1000).toISOString(),
  },
}

export const mockNormalizationRules: NormalizationRule[] = [
  { id: 'nr-001', source_label: 'host', target_label: 'instance', priority: 100, enabled: true },
  { id: 'nr-002', source_label: 'hostname', target_label: 'instance', priority: 90, enabled: true },
  { id: 'nr-003', source_label: 'node', target_label: 'instance', priority: 80, enabled: true },
  { id: 'nr-004', source_label: 'application', target_label: 'app', priority: 100, enabled: true },
  { id: 'nr-005', source_label: 'service', target_label: 'app', priority: 90, enabled: true },
  { id: 'nr-006', source_label: 'app_name', target_label: 'app', priority: 80, enabled: false },
  { id: 'nr-007', source_label: 'environment', target_label: 'env', priority: 100, enabled: true },
  { id: 'nr-008', source_label: 'stage', target_label: 'env', priority: 90, enabled: true },
]

export const mockDropRules: MetricDropRule[] = [
  {
    id: 'dr-001',
    source_id: 'src-edge-sh-01',
    rule_type: 'metric_prefix',
    match_value: 'debug_',
    action: 'drop',
    priority: 10,
    enabled: true,
  },
  {
    id: 'dr-002',
    source_id: 'src-legacy-dc',
    rule_type: 'metric_name',
    match_value: 'node_boot_time_seconds',
    action: 'drop',
    priority: 20,
    enabled: true,
  },
  {
    id: 'dr-003',
    source_id: 'src-aliyun-cloud',
    rule_type: 'label_match',
    match_value: 'exported_job=legacy',
    action: 'drop',
    priority: 30,
    enabled: true,
  },
  {
    id: 'dr-004',
    source_id: 'src-k8s-otel',
    rule_type: 'cardinality_limit',
    match_value: '5000',
    action: 'sample',
    priority: 40,
    enabled: true,
    sample_ratio: 0.1,
  },
]
