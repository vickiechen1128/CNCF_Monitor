// ============================================================
// Module_07 监控对象管理 - 数据模型与 mock 数据
// 对齐 PRD v2.6（Module_07_Monitoring_Object_Management.md）
// ============================================================

// ---------- 基础枚举 ----------
// PRD 5.1：四类资源类型
export type ResourceType = 'host' | 'middleware' | 'application' | 'generic_target'
// PRD 5.2：数据来源；cmdb 为 v0.4+ 预留（由 Module_04 同步写入）
export type SourceType = 'manual' | 'import' | 'cmdb'
// PRD 5.2：资源状态；orphan 为 v0.4+ 预留（孤儿资源，由 Module_04 生命周期管理）
export type ResourceStatus = 'online' | 'offline' | 'maintenance' | 'orphan'
export type Env = 'dev' | 'test' | 'staging' | 'prod'
// PRD 5.3：标签来源；cmdb 为 v0.4+ 预留
export type LabelSource = 'system' | 'user' | 'cmdb'
export type AppProtocol = 'http' | 'https' | 'tcp'
export type TargetScheme = 'http' | 'https'
export type ImportStatus = 'success' | 'partial' | 'failed'
// PRD 5.11：标签模板字段来源；cmdb_field 为 v0.4+ 预留
export type LabelTemplateSource = 'resource_field' | 'prometheus_builtin' | 'composite' | 'cmdb_field'
// PRD 5.5.3：状态映射规则适用的资源类型；'all' 表示通用
export type StatusMappingResourceType = ResourceType | 'all'

// ---------- 资源基础结构（PRD 5.2） ----------
export interface ResourceBase {
  resource_id: string
  resource_type: ResourceType
  network_domain_id: string
  source_type: SourceType
  instance_name?: string
  hostname?: string
  instance_ip?: string
  os_type?: string
  app_name?: string
  env?: Env
  cluster?: string
  owner?: string
  status: ResourceStatus
  is_monitored: boolean
  // v0.4+ 预留字段：CMDB 接入后由 Module_04 同步（mock 可为空，UI 标注 {v0.4+}）
  cmdb_ci_id?: string
  cmdb_business_path?: string
  cmdb_module_path?: string
  cmdb_maintainer?: string
  created_at: string
  updated_at: string
}

// ---------- 主机资源（PRD 5.6） ----------
export interface HostResource extends ResourceBase {
  resource_type: 'host'
  hostname: string
  instance_ip: string
  os_type?: string
  os_version?: string
}

// ---------- 中间件资源（PRD 5.7） ----------
export interface MiddlewareResource extends ResourceBase {
  resource_type: 'middleware'
  middleware_type: string
  instance_ip: string
  port: number
  version?: string
  connection_string?: string
}

// ---------- 应用服务资源（PRD 5.8） ----------
export interface ApplicationResource extends ResourceBase {
  resource_type: 'application'
  service_name: string
  health_check_url?: string
  protocol?: AppProtocol
  endpoint?: string
  port?: number
}

// ---------- 通用指标目标（PRD 5.9） ----------
export interface GenericTargetResource extends ResourceBase {
  resource_type: 'generic_target'
  target_name: string
  instance_ip: string
  port?: number
  metrics_path?: string
  scheme?: TargetScheme
  custom_labels?: string
  exporter_type?: string
}

export type Resource = HostResource | MiddlewareResource | ApplicationResource | GenericTargetResource

// ---------- 类型守卫 ----------
export function isHostResource(r: Resource): r is HostResource {
  return r.resource_type === 'host'
}
export function isMiddlewareResource(r: Resource): r is MiddlewareResource {
  return r.resource_type === 'middleware'
}
export function isApplicationResource(r: Resource): r is ApplicationResource {
  return r.resource_type === 'application'
}
export function isGenericTargetResource(r: Resource): r is GenericTargetResource {
  return r.resource_type === 'generic_target'
}

// ---------- 资源 Label（PRD 5.3） ----------
export interface ResourceLabel {
  label_id: string
  resource_id: string
  label_key: string
  label_value: string
  source: LabelSource
  is_editable: boolean
  conflict_hint?: string
  created_at: string
  updated_at: string
}

// ---------- 网域（PRD 5.4，仅引用，生命周期由 Module_09 负责） ----------
export interface NetworkDomain {
  id: string
  name: string
  status: 'online' | 'offline' | 'unknown'
}

export const mockNetworkDomains: NetworkDomain[] = [
  { id: 'default', name: '默认网域', status: 'online' },
  { id: 'gov-cloud-a', name: '政务云 A 区', status: 'online' },
]

// ---------- 标签模板（PRD 5.10 / 5.11） ----------
export interface Mapping {
  mapping_id: string
  source_field: string
  source_type: LabelTemplateSource
  target_label: string
  enabled: boolean
  transform?: string
}

export interface LabelTemplate {
  template_id: string
  name: string
  resource_type: ResourceType
  is_default: boolean
  mappings: Mapping[]
  created_at: string
  updated_at: string
}

// ---------- Excel 导入（PRD 7.3） ----------
export interface ImportError {
  row: number
  resource_type: ResourceType
  field: string
  value: string
  reason: string
}

export interface ImportHistory {
  import_id: string
  filename: string
  resource_type: ResourceType
  total: number
  success: number
  failed: number
  status: ImportStatus
  created_at: string
  errors: ImportError[]
}

// ---------- 状态映射可配置数据结构（PRD 5.5.2 / 5.5.3） ----------
export interface StatusMappingRule {
  id: string
  source_status: string
  target_status: ResourceStatus
  resource_type: StatusMappingResourceType
  priority: number
  is_builtin: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface StatusMappingConfig {
  case_sensitive: boolean
  default_target: ResourceStatus
  rules: StatusMappingRule[]
}

// ---------- CMDBProvider 扩展接口（PRD 8，v0.4+ 由 Module_04 实现） ----------
export interface CMDBProvider {
  name: string
  /** MVP 仅 ExcelProvider / SQLiteProvider；v0.4+ 由 Module_04 扩展 BlueKing/HTTP/Nacos/K8s */
  listResources(resourceType: ResourceType, networkDomainID: string): Resource[]
}

export const MOCK_PROVIDERS: { name: string; version: string; status: 'active' | 'planned'; note: string }[] = [
  { name: 'ExcelProvider', version: 'MVP', status: 'active', note: 'Excel 导入（本模块实现）' },
  { name: 'SQLiteProvider', version: 'MVP', status: 'active', note: '本地 SQLite 存储（本模块实现）' },
  { name: 'BlueKingProvider', version: 'v0.4+', status: 'planned', note: '腾讯蓝鲸 CMDB（Module_04 实现）' },
  { name: 'HTTPProvider', version: 'v0.4+', status: 'planned', note: '通用 HTTP CMDB（Module_04 实现）' },
  { name: 'NacosProvider', version: 'v0.4+', status: 'planned', note: 'Nacos 注册中心（Module_04 实现）' },
  { name: 'KubernetesProvider', version: 'v0.4+', status: 'planned', note: 'K8s Endpoints/Service（Module_04 实现）' },
]

// ---------- 常量与字典 ----------
export const RESOURCE_TYPES: ResourceType[] = ['host', 'middleware', 'application', 'generic_target']
export const ENV_VALUES: Env[] = ['dev', 'test', 'staging', 'prod']
/** MVP 可选状态；orphan 为 v0.4+ 预留，不在表单选项中展示 */
export const STATUS_VALUES: ResourceStatus[] = ['online', 'offline', 'maintenance']
/** 全部状态（含 v0.4+ orphan），用于只读展示与测试 */
export const ALL_STATUS_VALUES: ResourceStatus[] = ['online', 'offline', 'maintenance', 'orphan']
export const MIDDLEWARE_TYPE_OPTIONS = ['mysql', 'redis', 'kafka', 'elasticsearch', 'mongodb', 'rabbitmq']
export const PROTOCOL_OPTIONS: AppProtocol[] = ['http', 'https', 'tcp']
export const SCHEME_OPTIONS: TargetScheme[] = ['http', 'https']

/** Prometheus 内置 label 保护清单（PRD 5.3 / 3.3） */
export const PROTECTED_PROMETHEUS_LABELS = [
  'instance',
  'job',
  'scheme',
  '__address__',
  '__scheme__',
  '__metrics_path__',
  '__name__',
  'alertname',
  'quantile',
]

/** Excel 状态映射字典（PRD 5.5.1） */
export const STATUS_MAPPING_RULES: { source: string[]; target: ResourceStatus }[] = [
  { source: ['运行中', '正常', 'online', 'active', 'running', 'up'], target: 'online' },
  { source: ['已停止', '停止', 'offline', 'stopped', 'down', '关机'], target: 'offline' },
  { source: ['维护中', '维修中', 'maintenance', 'maintaining'], target: 'maintenance' },
]

/** 状态映射可配置规则（PRD 5.5.2 / 5.5.3，mock 演示） */
export const mockStatusMappingConfig: StatusMappingConfig = {
  case_sensitive: false,
  default_target: 'offline',
  rules: [
    { id: 'sm-01', source_status: '运行中|正常|online|running', target_status: 'online', resource_type: 'host', priority: 100, is_builtin: true, enabled: true, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { id: 'sm-02', source_status: '已停止|停止|offline|stopped', target_status: 'offline', resource_type: 'host', priority: 100, is_builtin: true, enabled: true, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { id: 'sm-03', source_status: '维护中|维修中|maintenance', target_status: 'maintenance', resource_type: 'all', priority: 90, is_builtin: true, enabled: true, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
  ],
}

/** 四类资源固定列导入模板（PRD 7.1，含 network_domain 列） */
export const IMPORT_TEMPLATE_COLUMNS: Record<ResourceType, string[]> = {
  host: ['network_domain', 'hostname', 'instance_ip', 'os_type', 'app_name', 'env', 'cluster', 'owner', 'status'],
  middleware: ['network_domain', 'middleware_type', 'instance_ip', 'port', 'version', 'app_name', 'env', 'cluster', 'owner', 'status'],
  application: ['network_domain', 'service_name', 'health_check_url', 'protocol', 'endpoint', 'port', 'app_name', 'env', 'cluster', 'owner', 'status'],
  generic_target: ['network_domain', 'target_name', 'instance_ip', 'port', 'metrics_path', 'scheme', 'exporter_type', 'custom_labels', 'app_name', 'env', 'cluster', 'owner', 'status'],
}

/** 标签模板映射：Resource 字段选项（PRD 5.12 A） */
export const RESOURCE_FIELD_OPTIONS: Record<ResourceType, string[]> = {
  host: ['instance_name', 'hostname', 'instance_ip', 'os_type', 'os_version', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  middleware: ['instance_name', 'middleware_type', 'instance_ip', 'port', 'version', 'connection_string', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  application: ['instance_name', 'service_name', 'health_check_url', 'protocol', 'endpoint', 'port', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  generic_target: ['instance_name', 'target_name', 'instance_ip', 'port', 'metrics_path', 'scheme', 'exporter_type', 'custom_labels', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
}

/** Prometheus 内置字段（PRD 5.12 B，不含 __name__） */
export const PROMETHEUS_BUILTIN_OPTIONS = ['__address__', '__scheme__', '__metrics_path__', 'job', 'instance']

/** 组合字段（PRD 5.12 C） */
export const COMPOSITE_OPTIONS = ['instance_ip:port']

/** v0.4+ CMDB 字段选项（PRD 5.12 A，预留） */
export const CMDB_FIELD_OPTIONS = ['cmdb_ci_id', 'cmdb_business_path', 'cmdb_module_path', 'cmdb_maintainer']

export const STATUS_MAP: Record<ResourceStatus, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
  orphan: '孤儿 {v0.4+}',
}

export const RESOURCE_TYPE_MAP: Record<ResourceType, string> = {
  host: '主机',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

/** 数据来源映射；cmdb 为 v0.4+ 预留 */
export const SOURCE_TYPE_MAP: Record<SourceType, string> = {
  manual: '手动录入',
  import: 'Excel 导入',
  cmdb: 'CMDB 同步 {v0.4+}',
}

export const LABEL_SOURCE_MAP: Record<LabelSource, string> = {
  system: '系统',
  user: '用户',
  cmdb: 'CMDB',
}

/** 标签来源优先级（PRD 5.3）：cmdb > user > system */
export const LABEL_SOURCE_PRIORITY: Record<LabelSource, number> = {
  cmdb: 3,
  user: 2,
  system: 1,
}

// ---------- mock 资源数据 ----------
export const mockResources: Resource[] = [
  // ----- host（PRD 5.6） -----
  {
    resource_id: 'res-host-001',
    resource_type: 'host',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'prod-web-01',
    hostname: 'prod-web-01.volc',
    instance_ip: '10.0.1.11',
    os_type: 'Linux',
    os_version: '7.9',
    app_name: '电商前台',
    env: 'prod',
    cluster: 'web-cluster-a',
    owner: '张三',
    status: 'online',
    is_monitored: true,
    cmdb_ci_id: 'bk_inst_1101',
    cmdb_business_path: '/电商/前台',
    cmdb_module_path: '/电商/前台/web',
    cmdb_maintainer: '张三',
    created_at: '2026-07-01 10:00:00',
    updated_at: '2026-07-20 18:30:00',
  },
  {
    resource_id: 'res-host-002',
    resource_type: 'host',
    network_domain_id: 'default',
    source_type: 'import',
    instance_name: 'prod-db-01',
    hostname: 'prod-db-01.volc',
    instance_ip: '10.0.1.21',
    os_type: 'Linux',
    os_version: '7.9',
    app_name: '订单服务',
    env: 'prod',
    cluster: 'db-cluster-a',
    owner: '李四',
    status: 'online',
    is_monitored: true,
    created_at: '2026-07-02 09:00:00',
    updated_at: '2026-07-22 11:20:00',
  },
  {
    resource_id: 'res-host-003',
    resource_type: 'host',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'test-gateway-01',
    hostname: 'test-gateway-01.volc',
    instance_ip: '192.168.1.31',
    os_type: 'Linux',
    os_version: '8.6',
    app_name: '网关服务',
    env: 'test',
    cluster: 'gateway-cluster',
    owner: '王五',
    status: 'maintenance',
    is_monitored: false,
    created_at: '2026-07-03 14:00:00',
    updated_at: '2026-07-24 16:45:00',
  },
  // ----- middleware（PRD 5.7） -----
  {
    resource_id: 'res-mw-001',
    resource_type: 'middleware',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'redis-cache-01',
    middleware_type: 'redis',
    instance_ip: '10.0.2.11',
    port: 6379,
    version: '7.2',
    connection_string: 'redis://:****@10.0.2.11:6379/0',
    app_name: '缓存服务',
    env: 'prod',
    cluster: 'cache-cluster',
    owner: '赵六',
    status: 'online',
    is_monitored: true,
    created_at: '2026-07-05 10:00:00',
    updated_at: '2026-07-25 09:10:00',
  },
  {
    resource_id: 'res-mw-002',
    resource_type: 'middleware',
    network_domain_id: 'default',
    source_type: 'import',
    instance_name: 'kafka-01',
    middleware_type: 'kafka',
    instance_ip: '10.0.2.21',
    port: 9092,
    version: '3.6',
    connection_string: '10.0.2.21:9092',
    app_name: '消息队列',
    env: 'prod',
    cluster: 'kafka-cluster',
    owner: '孙七',
    status: 'offline',
    is_monitored: true,
    created_at: '2026-07-06 10:00:00',
    updated_at: '2026-07-26 09:10:00',
  },
  // ----- application（PRD 5.8） -----
  {
    resource_id: 'res-app-001',
    resource_type: 'application',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'order-service-v2',
    service_name: 'order-service',
    health_check_url: 'http://10.0.3.11:9100/-/healthy',
    protocol: 'http',
    endpoint: '10.0.3.11:9100',
    port: 9100,
    app_name: '订单服务',
    env: 'prod',
    cluster: 'k8s-prod',
    owner: '周八',
    status: 'online',
    is_monitored: true,
    created_at: '2026-07-08 10:00:00',
    updated_at: '2026-07-27 09:10:00',
  },
  {
    resource_id: 'res-app-002',
    resource_type: 'application',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'pay-service-v1',
    service_name: 'pay-service',
    health_check_url: 'http://192.168.3.12:9100/-/healthy',
    protocol: 'http',
    endpoint: '192.168.3.12:9100',
    port: 9100,
    app_name: '支付服务',
    env: 'staging',
    cluster: 'k8s-staging',
    owner: '吴九',
    status: 'online',
    is_monitored: false,
    created_at: '2026-07-09 10:00:00',
    updated_at: '2026-07-28 09:10:00',
  },
  // ----- generic_target（PRD 5.9） -----
  {
    resource_id: 'res-gen-001',
    resource_type: 'generic_target',
    network_domain_id: 'gov-cloud-a',
    source_type: 'import',
    instance_name: 'switch-core-01',
    target_name: '核心交换-01',
    instance_ip: '172.16.0.1',
    port: 9116,
    metrics_path: '/snmp',
    scheme: 'http',
    exporter_type: 'snmp_exporter',
    custom_labels: 'device_type=snmp_switch;vendor=h3c',
    app_name: '核心交换',
    env: 'prod',
    cluster: 'network-core',
    owner: '郑十',
    status: 'online',
    is_monitored: true,
    created_at: '2026-07-10 10:00:00',
    updated_at: '2026-07-29 09:10:00',
  },
  {
    resource_id: 'res-gen-002',
    resource_type: 'generic_target',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'loadbalancer-02',
    target_name: '负载均衡-02',
    instance_ip: '172.16.0.2',
    port: 9131,
    metrics_path: '/metrics',
    scheme: 'http',
    exporter_type: 'haproxy_exporter',
    custom_labels: 'device_type=lb;vendor=f5',
    app_name: '入口负载',
    env: 'staging',
    cluster: 'lb-cluster',
    owner: '钱十一',
    status: 'offline',
    is_monitored: false,
    created_at: '2026-07-11 10:00:00',
    updated_at: '2026-07-30 09:10:00',
  },
]

// ---------- mock 资源标签（PRD 5.3） ----------
export const mockResourceLabels: Record<string, ResourceLabel[]> = {
  'res-host-001': [
    { label_id: 'l1', resource_id: 'res-host-001', label_key: 'instance', label_value: '10.0.1.11:9100', source: 'system', is_editable: false, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { label_id: 'l2', resource_id: 'res-host-001', label_key: 'app', label_value: '电商前台', source: 'system', is_editable: false, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { label_id: 'l3', resource_id: 'res-host-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-01 10:00:00', updated_at: '2026-07-15 08:00:00' },
    { label_id: 'l4', resource_id: 'res-host-001', label_key: 'business', label_value: '电商', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值', created_at: '2026-07-01 10:00:00', updated_at: '2026-07-15 08:00:00' },
    { label_id: 'l5', resource_id: 'res-host-001', label_key: 'team', label_value: 'sre', source: 'user', is_editable: true, created_at: '2026-07-05 14:00:00', updated_at: '2026-07-05 14:00:00' },
  ],
  'res-mw-001': [
    { label_id: 'l6', resource_id: 'res-mw-001', label_key: 'instance', label_value: '10.0.2.11:6379', source: 'system', is_editable: false, created_at: '2026-07-05 10:00:00', updated_at: '2026-07-05 10:00:00' },
    { label_id: 'l7', resource_id: 'res-mw-001', label_key: 'middleware', label_value: 'redis', source: 'user', is_editable: true, created_at: '2026-07-06 09:00:00', updated_at: '2026-07-06 09:00:00' },
    { label_id: 'l8', resource_id: 'res-mw-001', label_key: 'dc', label_value: '上海 A 区', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值', created_at: '2026-07-05 10:00:00', updated_at: '2026-07-15 08:00:00' },
    { label_id: 'l9', resource_id: 'res-mw-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-05 10:00:00', updated_at: '2026-07-15 08:00:00' },
  ],
  'res-app-001': [
    { label_id: 'l10', resource_id: 'res-app-001', label_key: 'service_name', label_value: 'order-service', source: 'system', is_editable: false, created_at: '2026-07-08 10:00:00', updated_at: '2026-07-08 10:00:00' },
    { label_id: 'l11', resource_id: 'res-app-001', label_key: 'cluster', label_value: 'k8s-prod', source: 'system', is_editable: false, created_at: '2026-07-08 10:00:00', updated_at: '2026-07-08 10:00:00' },
    { label_id: 'l12', resource_id: 'res-app-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-08 10:00:00', updated_at: '2026-07-15 08:00:00' },
  ],
  'res-gen-001': [
    { label_id: 'l13', resource_id: 'res-gen-001', label_key: 'instance', label_value: '172.16.0.1:9116', source: 'system', is_editable: false, created_at: '2026-07-10 10:00:00', updated_at: '2026-07-10 10:00:00' },
    { label_id: 'l14', resource_id: 'res-gen-001', label_key: 'device_type', label_value: 'snmp_switch', source: 'user', is_editable: true, created_at: '2026-07-11 09:00:00', updated_at: '2026-07-11 09:00:00' },
    { label_id: 'l15', resource_id: 'res-gen-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-10 10:00:00', updated_at: '2026-07-15 08:00:00' },
  ],
}

// ---------- mock 标签模板（PRD 5.10 / 5.13） ----------
export const mockLabelTemplates: LabelTemplate[] = [
  // ----- host -----
  {
    template_id: 'tpl-host-default',
    name: '主机默认模板',
    resource_type: 'host',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-host-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-host-02', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-host-03', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-host-04', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-host-05', source_field: 'hostname', source_type: 'resource_field', target_label: 'hostname', enabled: true, transform: '' },
      { mapping_id: 'mp-host-06', source_field: 'instance_name', source_type: 'resource_field', target_label: 'instance_name', enabled: true, transform: '' },
      { mapping_id: 'mp-host-07', source_field: 'os_type', source_type: 'resource_field', target_label: 'os_type', enabled: true, transform: 'lower' },
    ],
    created_at: '2026-07-20 10:00:00',
    updated_at: '2026-07-20 10:00:00',
  },
  // ----- middleware -----
  {
    template_id: 'tpl-mw-default',
    name: '中间件默认模板',
    resource_type: 'middleware',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-mw-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-02', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-03', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-04', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-05', source_field: 'middleware_type', source_type: 'resource_field', target_label: 'middleware_type', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:10:00',
    updated_at: '2026-07-20 10:10:00',
  },
  {
    template_id: 'tpl-mw-redis-ha',
    name: 'Redis 高可用标签模板',
    resource_type: 'middleware',
    is_default: false,
    mappings: [
      { mapping_id: 'mp-mw-06', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-07', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-08', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-09', source_field: 'middleware_type', source_type: 'resource_field', target_label: 'middleware_type', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-10', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-11', source_field: 'instance_name', source_type: 'resource_field', target_label: 'instance_name', enabled: true, transform: '' },
    ],
    created_at: '2026-07-22 09:30:00',
    updated_at: '2026-07-22 09:30:00',
  },
  // ----- application -----
  {
    template_id: 'tpl-app-default',
    name: '应用默认模板',
    resource_type: 'application',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-app-01', source_field: 'service_name', source_type: 'resource_field', target_label: 'service_name', enabled: true, transform: '' },
      { mapping_id: 'mp-app-02', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-app-03', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-app-04', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-app-05', source_field: 'health_check_url', source_type: 'resource_field', target_label: 'health_check_url', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:20:00',
    updated_at: '2026-07-20 10:20:00',
  },
  // ----- generic_target -----
  {
    template_id: 'tpl-gen-default',
    name: '通用目标默认模板',
    resource_type: 'generic_target',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-gen-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-02', source_field: 'target_name', source_type: 'resource_field', target_label: 'target_name', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-03', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-04', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-05', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-06', source_field: 'custom_labels.*', source_type: 'resource_field', target_label: 'custom_labels.*', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:30:00',
    updated_at: '2026-07-20 10:30:00',
  },
]

// ---------- mock 导入记录（PRD 7.3） ----------
export const mockImportHistory: ImportHistory[] = [
  {
    import_id: 'imp-001',
    filename: 'host_resources_20260725.xlsx',
    resource_type: 'host',
    total: 120,
    success: 118,
    failed: 2,
    status: 'partial',
    created_at: '2026-07-25 14:30:00',
    errors: [
      { row: 5, resource_type: 'host', field: 'instance_ip', value: '999.999.999.999', reason: 'IP 格式不正确' },
      { row: 12, resource_type: 'host', field: 'env', value: 'production', reason: 'env 必须是 dev/test/staging/prod 之一' },
    ],
  },
  {
    import_id: 'imp-002',
    filename: 'middleware_resources_20260726.xlsx',
    resource_type: 'middleware',
    total: 45,
    success: 45,
    failed: 0,
    status: 'success',
    created_at: '2026-07-26 09:15:00',
    errors: [],
  },
  {
    import_id: 'imp-003',
    filename: 'app_resources_20260728.xlsx',
    resource_type: 'application',
    total: 80,
    success: 0,
    failed: 80,
    status: 'failed',
    created_at: '2026-07-28 11:00:00',
    errors: [
      { row: 3, resource_type: 'application', field: 'service_name', value: '', reason: '必填字段为空' },
      { row: 8, resource_type: 'application', field: 'health_check_url', value: 'not-a-url', reason: 'URL 格式不正确' },
      { row: 15, resource_type: 'application', field: 'protocol', value: 'grpc', reason: 'protocol 必须是 http/https/tcp 之一' },
    ],
  },
]
