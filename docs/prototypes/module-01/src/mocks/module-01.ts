export type ResourceType = 'host' | 'middleware' | 'application' | 'generic_target'

export interface ExporterTemplate {
  exporter_template_id: string
  name: string
  version: string
  default_port: number
  metrics_path: string
  scheme: 'http' | 'https'
  supported_resource_types: ResourceType[]
  description?: string
}

export interface CITypeExporterMapping {
  mapping_id: string
  resource_type: ResourceType
  exporter_template_id: string
  default_port: number
  metrics_path: string
  scheme: 'http' | 'https'
  scrape_interval: string
  scrape_timeout: string
  label_template_id?: string
}

export type InstanceSelectionMode = 'manual' | 'filter'
export type ExporterInstallStatus = 'pending' | 'installed' | 'not_installed' | 'unregistered'

export interface ScrapeJob {
  job_id: string
  job_name: string
  resource_type: ResourceType
  exporter_template_id: string
  network_domain_id: string
  instance_selection_mode: InstanceSelectionMode
  selected_instance_ids: string[]
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: 'http' | 'https'
  label_template_id?: string
  enabled: boolean
  exporter_status: Record<string, ExporterInstallStatus>
}

export type RuleType = 'alerting' | 'recording'

export interface MonitoringRule {
  rule_id: string
  rule_type: RuleType
  name: string
  expr: string
  duration: string
  labels: Record<string, string>
  annotations: Record<string, string>
  resource_type: ResourceType
  enabled: boolean
}

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary'

export interface MetricLibraryItem {
  metric_id: string
  metric_name: string
  metric_type: MetricType
  help: string
  unit?: string
  labels: string[]
  exporter_template_id: string
}

export interface BlackboxProbe {
  probe_id: string
  module: string
  target: string
  protocol: 'http' | 'https' | 'tcp' | 'icmp' | 'dns'
  url?: string
  interval: string
  timeout: string
  enabled: boolean
}

export const mockExporterTemplates: ExporterTemplate[] = [
  { exporter_template_id: 'et-node', name: 'node_exporter', version: '1.8.2', default_port: 9100, metrics_path: '/metrics', scheme: 'http', supported_resource_types: ['host'], description: '主机节点指标采集器' },
  { exporter_template_id: 'et-redis', name: 'redis_exporter', version: '1.58.0', default_port: 9121, metrics_path: '/metrics', scheme: 'http', supported_resource_types: ['middleware'], description: 'Redis 指标采集器' },
  { exporter_template_id: 'et-kafka', name: 'kafka_exporter', version: '1.7.0', default_port: 9308, metrics_path: '/metrics', scheme: 'http', supported_resource_types: ['middleware'], description: 'Kafka 指标采集器' },
  { exporter_template_id: 'et-app', name: 'application_exporter', version: '0.5.0', default_port: 8080, metrics_path: '/actuator/prometheus', scheme: 'http', supported_resource_types: ['application'], description: '应用自定义指标' },
  { exporter_template_id: 'et-generic', name: 'snmp_exporter', version: '0.25.0', default_port: 9116, metrics_path: '/snmp', scheme: 'http', supported_resource_types: ['generic_target'], description: 'SNMP 通用采集' },
]

export const mockCITypeExporterMappings: CITypeExporterMapping[] = [
  { mapping_id: 'map-001', resource_type: 'host', exporter_template_id: 'et-node', default_port: 9100, metrics_path: '/metrics', scheme: 'http', scrape_interval: '15s', scrape_timeout: '10s', label_template_id: 'lt-h-001' },
  { mapping_id: 'map-002', resource_type: 'middleware', exporter_template_id: 'et-redis', default_port: 9121, metrics_path: '/metrics', scheme: 'http', scrape_interval: '30s', scrape_timeout: '10s', label_template_id: 'lt-mw-001' },
  { mapping_id: 'map-003', resource_type: 'application', exporter_template_id: 'et-app', default_port: 8080, metrics_path: '/actuator/prometheus', scheme: 'http', scrape_interval: '15s', scrape_timeout: '10s', label_template_id: 'lt-app-001' },
  { mapping_id: 'map-004', resource_type: 'generic_target', exporter_template_id: 'et-generic', default_port: 9116, metrics_path: '/snmp', scheme: 'http', scrape_interval: '60s', scrape_timeout: '30s', label_template_id: 'lt-gen-001' },
]

export const mockScrapeJobs: ScrapeJob[] = [
  {
    job_id: 'job-001',
    job_name: 'prod-hosts',
    resource_type: 'host',
    exporter_template_id: 'et-node',
    network_domain_id: 'nd-default',
    instance_selection_mode: 'filter',
    selected_instance_ids: ['res-host-001', 'res-host-002'],
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    label_template_id: 'lt-h-001',
    enabled: true,
    exporter_status: { 'res-host-001': 'installed', 'res-host-002': 'installed' },
  },
  {
    job_id: 'job-002',
    job_name: 'prod-redis',
    resource_type: 'middleware',
    exporter_template_id: 'et-redis',
    network_domain_id: 'nd-default',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-mw-001'],
    scrape_interval: '30s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    label_template_id: 'lt-mw-001',
    enabled: true,
    exporter_status: { 'res-mw-001': 'installed' },
  },
  {
    job_id: 'job-003',
    job_name: 'staging-apps',
    resource_type: 'application',
    exporter_template_id: 'et-app',
    network_domain_id: 'nd-edge',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-app-002'],
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/actuator/prometheus',
    scheme: 'http',
    label_template_id: 'lt-app-001',
    enabled: false,
    exporter_status: { 'res-app-002': 'pending' },
  },
  {
    job_id: 'job-004',
    job_name: 'network-generic',
    resource_type: 'generic_target',
    exporter_template_id: 'et-generic',
    network_domain_id: 'nd-edge',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-gen-001', 'res-gen-002'],
    scrape_interval: '60s',
    scrape_timeout: '30s',
    metrics_path: '/snmp',
    scheme: 'http',
    label_template_id: 'lt-gen-001',
    enabled: true,
    exporter_status: { 'res-gen-001': 'installed', 'res-gen-002': 'not_installed' },
  },
]

export const mockMonitoringRules: MonitoringRule[] = [
  {
    rule_id: 'rule-001',
    rule_type: 'alerting',
    name: 'HostHighCpuUsage',
    expr: '100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80',
    duration: '5m',
    labels: { severity: 'warning', team: 'sre' },
    annotations: { summary: '主机 CPU 使用率过高', description: '实例 {{ $labels.instance }} CPU 使用率超过 80%' },
    resource_type: 'host',
    enabled: true,
  },
  {
    rule_id: 'rule-002',
    rule_type: 'alerting',
    name: 'RedisMemoryHigh',
    expr: 'redis_memory_used_bytes / redis_memory_max_bytes > 0.85',
    duration: '2m',
    labels: { severity: 'critical', team: 'middleware' },
    annotations: { summary: 'Redis 内存使用率过高', description: 'Redis 实例 {{ $labels.instance }} 内存使用率超过 85%' },
    resource_type: 'middleware',
    enabled: true,
  },
  {
    rule_id: 'rule-003',
    rule_type: 'recording',
    name: 'job:app_request_rate:5m',
    expr: 'sum by (job, app) (rate(app_http_requests_total[5m]))',
    duration: '',
    labels: { team: 'platform' },
    annotations: { description: '应用 QPS 记录规则' },
    resource_type: 'application',
    enabled: true,
  },
  {
    rule_id: 'rule-004',
    rule_type: 'alerting',
    name: 'AppErrorRateHigh',
    expr: 'rate(app_http_requests_total{status=~"5.."}[5m]) / rate(app_http_requests_total[5m]) > 0.05',
    duration: '3m',
    labels: { severity: 'warning', team: 'app' },
    annotations: { summary: '应用 5xx 错误率过高', description: '应用 {{ $labels.app }} 5xx 错误率超过 5%' },
    resource_type: 'application',
    enabled: false,
  },
]

export const mockMetricLibrary: MetricLibraryItem[] = [
  { metric_id: 'm-001', metric_name: 'node_cpu_seconds_total', metric_type: 'counter', help: 'CPU 各模式累计耗时', unit: 's', labels: ['cpu', 'mode', 'instance'], exporter_template_id: 'et-node' },
  { metric_id: 'm-002', metric_name: 'node_memory_MemAvailable_bytes', metric_type: 'gauge', help: '可用内存字节数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node' },
  { metric_id: 'm-003', metric_name: 'node_filesystem_avail_bytes', metric_type: 'gauge', help: '文件系统可用空间', unit: 'bytes', labels: ['device', 'fstype', 'instance'], exporter_template_id: 'et-node' },
  { metric_id: 'm-004', metric_name: 'node_network_receive_bytes_total', metric_type: 'counter', help: '网卡接收字节总数', unit: 'bytes', labels: ['device', 'instance'], exporter_template_id: 'et-node' },
  { metric_id: 'm-005', metric_name: 'redis_memory_used_bytes', metric_type: 'gauge', help: 'Redis 已用内存', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis' },
  { metric_id: 'm-006', metric_name: 'redis_connected_clients', metric_type: 'gauge', help: '当前连接客户端数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis' },
  { metric_id: 'm-007', metric_name: 'app_http_requests_total', metric_type: 'counter', help: 'HTTP 请求总数', unit: '', labels: ['status', 'path', 'app'], exporter_template_id: 'et-app' },
  { metric_id: 'm-008', metric_name: 'app_http_request_duration_seconds', metric_type: 'histogram', help: 'HTTP 请求耗时分布', unit: 's', labels: ['status', 'path', 'app'], exporter_template_id: 'et-app' },
  { metric_id: 'm-009', metric_name: 'probe_success', metric_type: 'gauge', help: '拨测是否成功', unit: '', labels: ['instance', 'module'], exporter_template_id: 'et-generic' },
  { metric_id: 'm-010', metric_name: 'probe_duration_seconds', metric_type: 'gauge', help: '拨测耗时', unit: 's', labels: ['instance', 'module'], exporter_template_id: 'et-generic' },
]

export const mockProbes: BlackboxProbe[] = [
  { probe_id: 'probe-001', module: 'http_2xx', target: 'https://api.example.com/health', protocol: 'https', url: 'https://api.example.com/health', interval: '30s', timeout: '10s', enabled: true },
  { probe_id: 'probe-002', module: 'tcp_connect', target: 'redis-cache-01.mw:6379', protocol: 'tcp', interval: '30s', timeout: '5s', enabled: true },
  { probe_id: 'probe-003', module: 'dns_query', target: 'example.com', protocol: 'dns', interval: '60s', timeout: '10s', enabled: false },
  { probe_id: 'probe-004', module: 'icmp_ping', target: '10.0.1.11', protocol: 'icmp', interval: '60s', timeout: '5s', enabled: true },
]

export const RESOURCE_TYPE_MAP: Record<ResourceType, string> = {
  host: '主机',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

export interface Resource {
  resource_id: string
  resource_type: ResourceType
  instance_name: string
  hostname: string
  instance_ip: string
}

export const mockResources: Resource[] = [
  { resource_id: 'res-host-001', resource_type: 'host', instance_name: 'prod-web-01', hostname: 'prod-web-01.volc', instance_ip: '10.0.1.11' },
  { resource_id: 'res-host-002', resource_type: 'host', instance_name: 'prod-db-01', hostname: 'prod-db-01.volc', instance_ip: '10.0.1.21' },
  { resource_id: 'res-mw-001', resource_type: 'middleware', instance_name: 'redis-cache-01', hostname: 'redis-cache-01.mw', instance_ip: '10.0.2.11' },
  { resource_id: 'res-app-002', resource_type: 'application', instance_name: 'pay-service-v1', hostname: 'pay-service-v1.app', instance_ip: '192.168.3.12' },
  { resource_id: 'res-gen-001', resource_type: 'generic_target', instance_name: 'switch-core-01', hostname: 'switch-core-01.net', instance_ip: '172.16.0.1' },
  { resource_id: 'res-gen-002', resource_type: 'generic_target', instance_name: 'loadbalancer-02', hostname: 'lb-02.net', instance_ip: '172.16.0.2' },
]
