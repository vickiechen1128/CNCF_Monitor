export interface MonitoringSource {
  id: string
  name: string
  source_type: 'edge_agent' | 'external_prometheus' | 'zabbix' | 'cloud_monitor' | 'opentelemetry'
  network_domain_id: string
  status: 'online' | 'offline' | 'disabled' | 'unknown'
  ingest_method: 'remote_write_push' | 'adapter_pull' | 'api_sync'
  ingest_endpoint: string
  auth_type: 'token' | 'mtls' | 'basic_auth'
  auth_config: Record<string, string>
  remote_write_url: string
  labels: Record<string, string>
  last_heartbeat: string
  last_error: string
  created_at: string
  updated_at: string
}

export interface IngestionStats {
  source_id: string
  network_domain_id: string
  samples_per_second: number
  requests_per_minute: number
  error_rate: number
  last_sample_timestamp: string
}

export const monitoringSources: MonitoringSource[] = [
  {
    id: 'ms-default',
    name: '默认网域 Edge Agent',
    source_type: 'edge_agent',
    network_domain_id: 'default',
    status: 'online',
    ingest_method: 'remote_write_push',
    ingest_endpoint: 'http://localhost:8428/api/v1/write',
    auth_type: 'token',
    auth_config: { token: 'tk_default_xxxxxxxx' },
    remote_write_url: 'http://localhost:8428/api/v1/write',
    labels: { source_type: 'edge_agent', source_id: 'ms-default' },
    last_heartbeat: '2026-07-24 14:30:00',
    last_error: '',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-07-24 14:30:00',
  },
  {
    id: 'ms-gov-a',
    name: '政务网 A Edge Agent',
    source_type: 'edge_agent',
    network_domain_id: 'gov-cloud-a',
    status: 'online',
    ingest_method: 'remote_write_push',
    ingest_endpoint: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    auth_type: 'token',
    auth_config: { token: 'tk_gova_xxxxxxxx' },
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    labels: { source_type: 'edge_agent', source_id: 'ms-gov-a', network_domain: 'gov-cloud-a' },
    last_heartbeat: '2026-07-24 14:28:00',
    last_error: '',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-07-24 14:28:00',
  },
  {
    id: 'ms-business-prom',
    name: '业务网已有 Prometheus',
    source_type: 'external_prometheus',
    network_domain_id: 'finance-dmz',
    status: 'online',
    ingest_method: 'remote_write_push',
    ingest_endpoint: 'https://metriccenter.example.com/api/v2/ingest/prometheus/ms-business-prom',
    auth_type: 'token',
    auth_config: { token: 'tk_business_prom_xxxxxxxx' },
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus/ms-business-prom',
    labels: { source_type: 'external_prometheus', source_id: 'ms-business-prom', network_domain: 'finance-dmz' },
    last_heartbeat: '2026-07-24 14:29:00',
    last_error: '',
    created_at: '2026-07-15 00:00:00',
    updated_at: '2026-07-24 14:29:00',
  },
  {
    id: 'ms-zabbix-gov',
    name: '政务网 Zabbix',
    source_type: 'zabbix',
    network_domain_id: 'gov-cloud-a',
    status: 'offline',
    ingest_method: 'adapter_pull',
    ingest_endpoint: 'http://zabbix-adapter-gov:8080/metrics',
    auth_type: 'basic_auth',
    auth_config: { username: 'metriccenter', password: '***' },
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus/ms-zabbix-gov',
    labels: { source_type: 'zabbix', source_id: 'ms-zabbix-gov', network_domain: 'gov-cloud-a' },
    last_heartbeat: '2026-07-24 12:00:00',
    last_error: 'adapter pull timeout after 30s',
    created_at: '2026-07-16 00:00:00',
    updated_at: '2026-07-24 12:00:00',
  },
  {
    id: 'ms-cloudwatch',
    name: 'AWS CloudWatch',
    source_type: 'cloud_monitor',
    network_domain_id: 'default',
    status: 'disabled',
    ingest_method: 'api_sync',
    ingest_endpoint: 'https://monitoring.us-east-1.amazonaws.com',
    auth_type: 'token',
    auth_config: { access_key_id: 'AKIA***', secret_access_key: '***' },
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus/ms-cloudwatch',
    labels: { source_type: 'cloud_monitor', source_id: 'ms-cloudwatch', network_domain: 'default' },
    last_heartbeat: '-',
    last_error: '',
    created_at: '2026-07-18 00:00:00',
    updated_at: '2026-07-24 10:00:00',
  },
]

export const ingestionStats: IngestionStats[] = [
  { source_id: 'ms-default', network_domain_id: 'default', samples_per_second: 1200, requests_per_minute: 45, error_rate: 0, last_sample_timestamp: '2026-07-24 14:30:00' },
  { source_id: 'ms-gov-a', network_domain_id: 'gov-cloud-a', samples_per_second: 3500, requests_per_minute: 120, error_rate: 0.001, last_sample_timestamp: '2026-07-24 14:28:00' },
  { source_id: 'ms-business-prom', network_domain_id: 'finance-dmz', samples_per_second: 2800, requests_per_minute: 95, error_rate: 0, last_sample_timestamp: '2026-07-24 14:29:00' },
  { source_id: 'ms-zabbix-gov', network_domain_id: 'gov-cloud-a', samples_per_second: 0, requests_per_minute: 0, error_rate: 1, last_sample_timestamp: '2026-07-24 12:00:00' },
]
