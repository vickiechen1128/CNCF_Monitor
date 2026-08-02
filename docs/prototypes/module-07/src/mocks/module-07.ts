export type ResourceType = 'host' | 'middleware' | 'application' | 'generic_target'
export type SourceType = 'manual' | 'cmdb_sync' | 'discovery' | 'import'
export type ResourceStatus = 'online' | 'offline' | 'maintenance'
export type LabelSource = 'system' | 'user' | 'cmdb'

export interface Resource {
  resource_id: string
  resource_type: ResourceType
  network_domain_id: string
  source_type: SourceType
  instance_name: string
  hostname: string
  instance_ip: string
  os_type?: string
  app_name?: string
  env?: string
  cluster?: string
  owner?: string
  status: ResourceStatus
  is_monitored: boolean
  cmdb_id?: string
  cmdb_model?: string
  cmdb_business?: string
  cmdb_dc?: string
}

export interface ResourceLabel {
  label_id: string
  resource_id: string
  label_key: string
  label_value: string
  source: LabelSource
  is_editable: boolean
  conflict_hint?: string
}

export type LabelTemplateSource = 'resource_field' | 'prometheus_builtin' | 'composite' | 'cmdb_field'

export interface LabelTemplate {
  template_id: string
  resource_type: ResourceType
  source_field: string
  source_type: LabelTemplateSource
  target_label: string
  transform?: string
  enabled: boolean
  created_at: string
}

export interface ImportHistory {
  import_id: string
  filename: string
  resource_type: ResourceType
  total: number
  success: number
  failed: number
  status: 'success' | 'partial' | 'failed'
  created_at: string
  error_report_url?: string
}

export const STATUS_MAP: Record<ResourceStatus, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
}

export const RESOURCE_TYPE_MAP: Record<ResourceType, string> = {
  host: '主机',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

export const SOURCE_TYPE_MAP: Record<SourceType, string> = {
  manual: '手动录入',
  cmdb_sync: 'CMDB 同步',
  discovery: '自动发现',
  import: 'Excel 导入',
}

export const mockResources: Resource[] = [
  {
    resource_id: 'res-host-001',
    resource_type: 'host',
    network_domain_id: 'nd-default',
    source_type: 'cmdb_sync',
    instance_name: 'prod-web-01',
    hostname: 'prod-web-01.volc',
    instance_ip: '10.0.1.11',
    os_type: 'Linux',
    app_name: '电商前台',
    env: 'production',
    cluster: 'web-cluster-a',
    owner: '张三',
    status: 'online',
    is_monitored: true,
    cmdb_id: 'CMDB-H-1101',
    cmdb_model: '物理机',
    cmdb_business: '电商',
    cmdb_dc: '上海 A 区',
  },
  {
    resource_id: 'res-host-002',
    resource_type: 'host',
    network_domain_id: 'nd-default',
    source_type: 'cmdb_sync',
    instance_name: 'prod-db-01',
    hostname: 'prod-db-01.volc',
    instance_ip: '10.0.1.21',
    os_type: 'Linux',
    app_name: '订单服务',
    env: 'production',
    cluster: 'db-cluster-a',
    owner: '李四',
    status: 'online',
    is_monitored: true,
    cmdb_id: 'CMDB-H-1102',
    cmdb_model: '物理机',
    cmdb_business: '电商',
    cmdb_dc: '上海 A 区',
  },
  {
    resource_id: 'res-host-003',
    resource_type: 'host',
    network_domain_id: 'nd-edge',
    source_type: 'manual',
    instance_name: 'test-gateway-01',
    hostname: 'test-gateway-01.volc',
    instance_ip: '192.168.1.31',
    os_type: 'Linux',
    app_name: '网关服务',
    env: 'test',
    cluster: 'gateway-cluster',
    owner: '王五',
    status: 'maintenance',
    is_monitored: false,
  },
  {
    resource_id: 'res-mw-001',
    resource_type: 'middleware',
    network_domain_id: 'nd-default',
    source_type: 'discovery',
    instance_name: 'redis-cache-01',
    hostname: 'redis-cache-01.mw',
    instance_ip: '10.0.2.11',
    os_type: 'Linux',
    app_name: '缓存服务',
    env: 'production',
    cluster: 'cache-cluster',
    owner: '赵六',
    status: 'online',
    is_monitored: true,
    cmdb_id: 'CMDB-MW-201',
    cmdb_model: 'Redis',
    cmdb_business: '基础组件',
    cmdb_dc: '上海 A 区',
  },
  {
    resource_id: 'res-mw-002',
    resource_type: 'middleware',
    network_domain_id: 'nd-default',
    source_type: 'cmdb_sync',
    instance_name: 'kafka-01',
    hostname: 'kafka-01.mw',
    instance_ip: '10.0.2.21',
    os_type: 'Linux',
    app_name: '消息队列',
    env: 'production',
    cluster: 'kafka-cluster',
    owner: '孙七',
    status: 'offline',
    is_monitored: true,
    cmdb_id: 'CMDB-MW-202',
    cmdb_model: 'Kafka',
    cmdb_business: '基础组件',
    cmdb_dc: '上海 B 区',
  },
  {
    resource_id: 'res-app-001',
    resource_type: 'application',
    network_domain_id: 'nd-default',
    source_type: 'discovery',
    instance_name: 'order-service-v2',
    hostname: 'order-service-v2.app',
    instance_ip: '10.0.3.11',
    os_type: '容器',
    app_name: '订单服务',
    env: 'production',
    cluster: 'k8s-prod',
    owner: '周八',
    status: 'online',
    is_monitored: true,
    cmdb_id: 'CMDB-APP-301',
    cmdb_model: '微服务',
    cmdb_business: '电商',
    cmdb_dc: '上海 A 区',
  },
  {
    resource_id: 'res-app-002',
    resource_type: 'application',
    network_domain_id: 'nd-edge',
    source_type: 'manual',
    instance_name: 'pay-service-v1',
    hostname: 'pay-service-v1.app',
    instance_ip: '192.168.3.12',
    os_type: '容器',
    app_name: '支付服务',
    env: 'staging',
    cluster: 'k8s-staging',
    owner: '吴九',
    status: 'online',
    is_monitored: false,
  },
  {
    resource_id: 'res-gen-001',
    resource_type: 'generic_target',
    network_domain_id: 'nd-edge',
    source_type: 'import',
    instance_name: 'switch-core-01',
    hostname: 'switch-core-01.net',
    instance_ip: '172.16.0.1',
    os_type: '网络设备',
    app_name: '核心交换',
    env: 'production',
    cluster: 'network-core',
    owner: '郑十',
    status: 'online',
    is_monitored: true,
  },
  {
    resource_id: 'res-gen-002',
    resource_type: 'generic_target',
    network_domain_id: 'nd-edge',
    source_type: 'manual',
    instance_name: 'loadbalancer-02',
    hostname: 'lb-02.net',
    instance_ip: '172.16.0.2',
    os_type: '负载均衡',
    app_name: '入口负载',
    env: 'production',
    cluster: 'lb-cluster',
    owner: '钱十一',
    status: 'offline',
    is_monitored: false,
  },
]

export const mockResourceLabels: Record<string, ResourceLabel[]> = {
  'res-host-001': [
    { label_id: 'l1', resource_id: 'res-host-001', label_key: 'instance', label_value: 'prod-web-01.volc:9100', source: 'system', is_editable: false },
    { label_id: 'l2', resource_id: 'res-host-001', label_key: 'env', label_value: 'production', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高' },
    { label_id: 'l3', resource_id: 'res-host-001', label_key: 'team', label_value: 'sre', source: 'user', is_editable: true },
    { label_id: 'l4', resource_id: 'res-host-001', label_key: 'business', label_value: '电商', source: 'cmdb', is_editable: false },
  ],
  'res-mw-001': [
    { label_id: 'l5', resource_id: 'res-mw-001', label_key: 'instance', label_value: 'redis-cache-01.mw:9121', source: 'system', is_editable: false },
    { label_id: 'l6', resource_id: 'res-mw-001', label_key: 'middleware', label_value: 'redis', source: 'user', is_editable: true },
    { label_id: 'l7', resource_id: 'res-mw-001', label_key: 'dc', label_value: '上海 A 区', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值' },
  ],
}

export const mockLabelTemplates: LabelTemplate[] = [
  // host
  { template_id: 'lt-h-001', resource_type: 'host', source_field: 'hostname', source_type: 'resource_field', target_label: 'instance', transform: 'concat(:9100)', enabled: true, created_at: '2026-07-20 10:00:00' },
  { template_id: 'lt-h-002', resource_type: 'host', source_field: 'cmdb_dc', source_type: 'cmdb_field', target_label: 'dc', transform: '', enabled: true, created_at: '2026-07-20 10:00:00' },
  { template_id: 'lt-h-003', resource_type: 'host', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', transform: '', enabled: true, created_at: '2026-07-20 10:05:00' },
  { template_id: 'lt-h-004', resource_type: 'host', source_field: '__name__', source_type: 'prometheus_builtin', target_label: 'job', transform: '', enabled: false, created_at: '2026-07-21 09:00:00' },
  // middleware
  { template_id: 'lt-mw-001', resource_type: 'middleware', source_field: 'instance_name', source_type: 'resource_field', target_label: 'instance', transform: '', enabled: true, created_at: '2026-07-20 10:10:00' },
  { template_id: 'lt-mw-002', resource_type: 'middleware', source_field: 'cmdb_model', source_type: 'cmdb_field', target_label: 'middleware_type', transform: 'lower()', enabled: true, created_at: '2026-07-20 10:10:00' },
  { template_id: 'lt-mw-003', resource_type: 'middleware', source_field: 'env', source_type: 'resource_field', target_label: 'env', transform: '', enabled: true, created_at: '2026-07-20 10:15:00' },
  { template_id: 'lt-mw-004', resource_type: 'middleware', source_field: 'cluster', source_type: 'composite', target_label: 'cluster_id', transform: 'md5(prefix)', enabled: false, created_at: '2026-07-21 09:30:00' },
  // application
  { template_id: 'lt-app-001', resource_type: 'application', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', transform: '', enabled: true, created_at: '2026-07-20 10:20:00' },
  { template_id: 'lt-app-002', resource_type: 'application', source_field: 'cmdb_business', source_type: 'cmdb_field', target_label: 'business', transform: '', enabled: true, created_at: '2026-07-20 10:20:00' },
  { template_id: 'lt-app-003', resource_type: 'application', source_field: 'instance_ip', source_type: 'resource_field', target_label: 'pod_ip', transform: '', enabled: true, created_at: '2026-07-20 10:25:00' },
  { template_id: 'lt-app-004', resource_type: 'application', source_field: 'cluster', source_type: 'composite', target_label: 'k8s_cluster', transform: '', enabled: true, created_at: '2026-07-21 10:00:00' },
  // generic_target
  { template_id: 'lt-gen-001', resource_type: 'generic_target', source_field: 'instance_name', source_type: 'resource_field', target_label: 'target', transform: '', enabled: true, created_at: '2026-07-20 10:30:00' },
  { template_id: 'lt-gen-002', resource_type: 'generic_target', source_field: 'cmdb_model', source_type: 'cmdb_field', target_label: 'device_type', transform: '', enabled: true, created_at: '2026-07-20 10:30:00' },
  { template_id: 'lt-gen-003', resource_type: 'generic_target', source_field: 'network_domain_id', source_type: 'resource_field', target_label: 'network_domain', transform: '', enabled: true, created_at: '2026-07-20 10:35:00' },
  { template_id: 'lt-gen-004', resource_type: 'generic_target', source_field: 'owner', source_type: 'resource_field', target_label: 'owner', transform: '', enabled: false, created_at: '2026-07-21 10:30:00' },
]

export const mockImportHistory: ImportHistory[] = [
  { import_id: 'imp-001', filename: 'host_resources_20260725.xlsx', resource_type: 'host', total: 120, success: 118, failed: 2, status: 'partial', created_at: '2026-07-25 14:30:00', error_report_url: '#' },
  { import_id: 'imp-002', filename: 'middleware_resources_20260726.xlsx', resource_type: 'middleware', total: 45, success: 45, failed: 0, status: 'success', created_at: '2026-07-26 09:15:00' },
  { import_id: 'imp-003', filename: 'app_resources_20260728.xlsx', resource_type: 'application', total: 80, success: 0, failed: 80, status: 'failed', created_at: '2026-07-28 11:00:00', error_report_url: '#' },
]
