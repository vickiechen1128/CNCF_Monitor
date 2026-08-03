// ============================================================
// Module_01 监控策略与指标管理 - 数据模型与 mock 数据
// 对齐 PRD v1.1（Module_01_Metric_Collection_Center.md）
// ============================================================

// ---------- CI 类型与资源类别（PRD 5.1 / 与 Module_07 四大类别对齐） ----------

/**
 * CiType：细粒度 CI 类型（PRD 5.1 resource_type 枚举值 host/mysql/redis/...）
 * 用于 CITypeExporterMapping.resource_type 与 ScrapeJob.resource_type。
 */
export type CiType =
  | 'host'
  | 'mysql'
  | 'redis'
  | 'kafka'
  | 'elasticsearch'
  | 'nginx'
  | 'application_http'
  | 'snmp'

/**
 * ResourceCategory：Module_07 的四大资源类别。
 * 用于与 Module_07 的 Resource.resource_type 对齐，以及 LabelTemplate 归属。
 */
export type ResourceCategory = 'host' | 'middleware' | 'application' | 'generic_target'

/** CiType → ResourceCategory 映射（与 Module_07 四大类别对齐） */
export const CI_TYPE_CATEGORY_MAP: Record<CiType, ResourceCategory> = {
  host: 'host',
  mysql: 'middleware',
  redis: 'middleware',
  kafka: 'middleware',
  elasticsearch: 'middleware',
  nginx: 'middleware',
  application_http: 'application',
  snmp: 'generic_target',
}

export const CI_TYPE_LABEL: Record<CiType, string> = {
  host: '主机',
  mysql: 'MySQL',
  redis: 'Redis',
  kafka: 'Kafka',
  elasticsearch: 'Elasticsearch',
  nginx: 'Nginx',
  application_http: 'HTTP 应用',
  snmp: 'SNMP 通用目标',
}

export const CI_TYPES: CiType[] = [
  'host',
  'mysql',
  'redis',
  'kafka',
  'elasticsearch',
  'nginx',
  'application_http',
  'snmp',
]

export const RESOURCE_CATEGORY_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  middleware: '中间件',
  application: '应用',
  generic_target: '通用目标',
}

// ---------- 通用枚举 ----------
export type Scheme = 'http' | 'https'
export type InstanceSelectionMode = 'manual' | 'filter'
export type ExporterInstallStatus = 'pending' | 'installed' | 'not_installed' | 'unregistered'
export type RuleType = 'alerting' | 'recording'
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'unknown'
export type Env = 'dev' | 'test' | 'staging' | 'prod'
export type ResourceStatus = 'online' | 'offline' | 'maintenance'
export type ProbeProtocol = 'http' | 'https' | 'tcp' | 'icmp' | 'dns'

export const ENV_VALUES: Env[] = ['dev', 'test', 'staging', 'prod']
export const STATUS_VALUES: ResourceStatus[] = ['online', 'offline', 'maintenance']
export const METRIC_TYPES: MetricType[] = ['counter', 'gauge', 'histogram', 'summary', 'unknown']
export const SCHEMES: Scheme[] = ['http', 'https']

// ---------- 网域（引用 Module_09，本模块只读） ----------
export interface NetworkDomain {
  id: string
  name: string
  status: 'online' | 'offline' | 'unknown'
}

export const mockNetworkDomains: NetworkDomain[] = [
  { id: 'default', name: '默认网域', status: 'online' },
  { id: 'gov-cloud-a', name: '政务云 A 区', status: 'online' },
]

export const NETWORK_DOMAIN_IDS: string[] = mockNetworkDomains.map((d) => d.id)

// ---------- 标签模板（引用 Module_07，本模块只读选择） ----------
export interface LabelTemplate {
  template_id: string
  name: string
  resource_category: ResourceCategory
  is_default: boolean
}

export const mockLabelTemplates: LabelTemplate[] = [
  { template_id: 'lt-h-001', name: '主机默认标签模板', resource_category: 'host', is_default: true },
  { template_id: 'lt-mw-001', name: '中间件默认标签模板', resource_category: 'middleware', is_default: true },
  { template_id: 'lt-app-001', name: '应用默认标签模板', resource_category: 'application', is_default: true },
  { template_id: 'lt-gen-001', name: '通用目标默认标签模板', resource_category: 'generic_target', is_default: true },
  { template_id: 'lt-mw-002', name: 'Redis 自定义标签模板', resource_category: 'middleware', is_default: false },
]

// ---------- Exporter 模板（PRD 5.2） ----------
export interface ExporterTemplate {
  exporter_template_id: string
  name: string
  version: string
  default_port: number
  metrics_path: string
  scheme: Scheme
  supported_resource_types: CiType[]
  description?: string
  /** 离线/隔离网域安装说明（PRD 5.2） */
  install_guide: string
  /** 是否平台内置（PRD 5.2） */
  is_builtin: boolean
}

export const mockExporterTemplates: ExporterTemplate[] = [
  {
    exporter_template_id: 'et-node',
    name: 'node_exporter',
    version: '1.8.2',
    default_port: 9100,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_resource_types: ['host'],
    description: '主机节点指标采集器',
    install_guide:
      '在目标主机解压二进制后执行 ./node_exporter --web.listen-address=:9100；隔离网域可使用内网镜像离线安装，并开放 9100 端口。',
    is_builtin: true,
  },
  {
    exporter_template_id: 'et-mysql',
    name: 'mysqld_exporter',
    version: '0.15.1',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_resource_types: ['mysql'],
    description: 'MySQL 指标采集器',
    install_guide:
      '创建只读监控账号后，配置 .my.cnf 连接串，运行 ./mysqld_exporter --config.my-cnf=.my.cnf --web.listen-address=:9104。',
    is_builtin: true,
  },
  {
    exporter_template_id: 'et-redis',
    name: 'redis_exporter',
    version: '1.58.0',
    default_port: 9121,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_resource_types: ['redis'],
    description: 'Redis 指标采集器',
    install_guide:
      '运行 ./redis_exporter --redis.addr=localhost:6379 --web.listen-address=:9121；隔离网域需确保 Agent 可达 Redis 实例。',
    is_builtin: true,
  },
  {
    exporter_template_id: 'et-kafka',
    name: 'kafka_exporter',
    version: '1.7.0',
    default_port: 9308,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_resource_types: ['kafka'],
    description: 'Kafka 指标采集器',
    install_guide:
      '运行 ./kafka_exporter --kafka.server=localhost:9092 --web.listen-address=:9308。',
    is_builtin: true,
  },
  {
    exporter_template_id: 'et-elasticsearch',
    name: 'elasticsearch_exporter',
    version: '1.7.0',
    default_port: 9114,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_resource_types: ['elasticsearch'],
    description: 'Elasticsearch 指标采集器',
    install_guide:
      '运行 ./elasticsearch_exporter --es.uri=http://localhost:9200 --web.listen-address=:9114。',
    is_builtin: false,
  },
  {
    exporter_template_id: 'et-nginx',
    name: 'nginx_exporter',
    version: '0.11.0',
    default_port: 9113,
    metrics_path: '/metrics',
    scheme: 'http',
    supported_resource_types: ['nginx'],
    description: 'Nginx stub_status 指标采集器',
    install_guide:
      '在 Nginx 开启 stub_status 后，运行 ./nginx_exporter --nginx.scrape-uri=http://localhost:80/stub_status。',
    is_builtin: false,
  },
  {
    exporter_template_id: 'et-app',
    name: 'application_exporter',
    version: '0.5.0',
    default_port: 8080,
    metrics_path: '/actuator/prometheus',
    scheme: 'http',
    supported_resource_types: ['application_http'],
    description: '应用自定义指标（Spring Boot Actuator）',
    install_guide:
      '应用引入 micrometer-registry-prometheus 依赖并暴露 /actuator/prometheus 端点；保证 Agent 可达。',
    is_builtin: true,
  },
  {
    exporter_template_id: 'et-snmp',
    name: 'snmp_exporter',
    version: '0.25.0',
    default_port: 9116,
    metrics_path: '/snmp',
    scheme: 'http',
    supported_resource_types: ['snmp'],
    description: 'SNMP 通用采集器',
    install_guide:
      '生成 snmp.yml 模块配置后运行 ./snmp_exporter --config.file=snmp.yml；交换机/路由器需开启 SNMP v2c 只读团体字。',
    is_builtin: true,
  },
  {
    exporter_template_id: 'et-blackbox',
    name: 'blackbox_exporter',
    version: '0.25.0',
    default_port: 9115,
    metrics_path: '/probe',
    scheme: 'http',
    supported_resource_types: [],
    description: '黑盒拨测采集器（HTTP/TCP/ICMP/DNS）',
    install_guide:
      '运行 ./blackbox_exporter --config.file=blackbox.yml；拨测目标由本模块「拨测配置」维护，不绑定 CI 类型。',
    is_builtin: true,
  },
]

// ---------- CI 类型 ↔ Exporter 模板绑定（PRD 5.1） ----------
export interface CITypeExporterMapping {
  mapping_id: string
  resource_type: CiType
  exporter_template_id: string
  default_port: number
  metrics_path: string
  scheme: Scheme
  scrape_interval: string
  scrape_timeout: string
  label_template_id?: string
  /** 是否平台内置绑定（PRD 5.1），内置绑定禁止删除 */
  is_builtin: boolean
  created_at: string
  updated_at: string
}

export const mockCITypeExporterMappings: CITypeExporterMapping[] = [
  {
    mapping_id: 'map-001',
    resource_type: 'host',
    exporter_template_id: 'et-node',
    default_port: 9100,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    label_template_id: 'lt-h-001',
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-20T10:30:00Z',
  },
  {
    mapping_id: 'map-002',
    resource_type: 'mysql',
    exporter_template_id: 'et-mysql',
    default_port: 9104,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '30s',
    scrape_timeout: '10s',
    label_template_id: 'lt-mw-001',
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:00:00Z',
  },
  {
    mapping_id: 'map-003',
    resource_type: 'redis',
    exporter_template_id: 'et-redis',
    default_port: 9121,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '30s',
    scrape_timeout: '10s',
    label_template_id: 'lt-mw-001',
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:00:00Z',
  },
  {
    mapping_id: 'map-004',
    resource_type: 'kafka',
    exporter_template_id: 'et-kafka',
    default_port: 9308,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '30s',
    scrape_timeout: '10s',
    label_template_id: 'lt-mw-001',
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:00:00Z',
  },
  {
    mapping_id: 'map-005',
    resource_type: 'elasticsearch',
    exporter_template_id: 'et-elasticsearch',
    default_port: 9114,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '30s',
    scrape_timeout: '10s',
    label_template_id: 'lt-mw-001',
    is_builtin: false,
    created_at: '2026-07-22T14:00:00Z',
    updated_at: '2026-07-22T14:00:00Z',
  },
  {
    mapping_id: 'map-006',
    resource_type: 'nginx',
    exporter_template_id: 'et-nginx',
    default_port: 9113,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    label_template_id: 'lt-mw-001',
    is_builtin: false,
    created_at: '2026-07-23T11:00:00Z',
    updated_at: '2026-07-23T11:00:00Z',
  },
  {
    mapping_id: 'map-007',
    resource_type: 'application_http',
    exporter_template_id: 'et-app',
    default_port: 8080,
    metrics_path: '/actuator/prometheus',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    label_template_id: 'lt-app-001',
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:00:00Z',
  },
  {
    mapping_id: 'map-008',
    resource_type: 'snmp',
    exporter_template_id: 'et-snmp',
    default_port: 9116,
    metrics_path: '/snmp',
    scheme: 'http',
    scrape_interval: '60s',
    scrape_timeout: '30s',
    label_template_id: 'lt-gen-001',
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-01T09:00:00Z',
  },
]

// ---------- Exporter 安装/注册确认（PRD 5.6） ----------
export interface ExporterInstallationConfirmation {
  id: string
  resource_id: string
  exporter_template_id: string
  status: ExporterInstallStatus
  confirmed_by: string
  confirmed_at: string
  notes: string
}

export const mockExporterInstallations: ExporterInstallationConfirmation[] = [
  {
    id: 'eic-001',
    resource_id: 'res-host-001',
    exporter_template_id: 'et-node',
    status: 'installed',
    confirmed_by: 'alice',
    confirmed_at: '2026-07-05T10:00:00Z',
    notes: '已通过内网镜像离线安装 node_exporter 1.8.2',
  },
  {
    id: 'eic-002',
    resource_id: 'res-host-002',
    exporter_template_id: 'et-node',
    status: 'installed',
    confirmed_by: 'alice',
    confirmed_at: '2026-07-05T10:05:00Z',
    notes: '',
  },
  {
    id: 'eic-003',
    resource_id: 'res-mw-001',
    exporter_template_id: 'et-redis',
    status: 'installed',
    confirmed_by: 'bob',
    confirmed_at: '2026-07-06T09:00:00Z',
    notes: 'Redis 6.2，已开放 9121',
  },
  {
    id: 'eic-004',
    resource_id: 'res-mw-002',
    exporter_template_id: 'et-mysql',
    status: 'unregistered',
    confirmed_by: '',
    confirmed_at: '',
    notes: '',
  },
  {
    id: 'eic-005',
    resource_id: 'res-app-002',
    exporter_template_id: 'et-app',
    status: 'pending',
    confirmed_by: '',
    confirmed_at: '',
    notes: '待研发确认 actuator 端点暴露',
  },
  {
    id: 'eic-006',
    resource_id: 'res-gen-001',
    exporter_template_id: 'et-snmp',
    status: 'installed',
    confirmed_by: 'carol',
    confirmed_at: '2026-07-10T14:00:00Z',
    notes: '交换机 SNMP v2c 已配置',
  },
  {
    id: 'eic-007',
    resource_id: 'res-gen-002',
    exporter_template_id: 'et-snmp',
    status: 'not_installed',
    confirmed_by: 'carol',
    confirmed_at: '2026-07-10T14:10:00Z',
    notes: 'LB 未开启 SNMP，待网络组处理',
  },
]

// ---------- 采集任务（PRD 5.4） ----------
export interface ScrapeJob {
  job_id: string
  job_name: string
  resource_type: CiType
  exporter_template_id: string
  network_domain_id: string
  instance_selection_mode: InstanceSelectionMode
  selected_instance_ids: string[]
  /** filter 模式下的筛选条件（v0.3+ 预留，MVP mock 为 null） */
  instance_filter: Record<string, unknown> | null
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: Scheme
  label_template_id?: string
  /** 高级 relabel 规则（P2 预留，mock 为空数组） */
  relabel_configs: Record<string, unknown>[]
  enabled: boolean
  /** 冗余快速查找：resource_id → 安装状态（详情展示使用 ExporterInstallationConfirmation） */
  exporter_status: Record<string, ExporterInstallStatus>
  created_at: string
  updated_at: string
}

export const mockScrapeJobs: ScrapeJob[] = [
  {
    job_id: 'job-001',
    job_name: 'prod-hosts',
    resource_type: 'host',
    exporter_template_id: 'et-node',
    network_domain_id: 'default',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-host-001', 'res-host-002'],
    instance_filter: null,
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    label_template_id: 'lt-h-001',
    relabel_configs: [],
    enabled: true,
    exporter_status: { 'res-host-001': 'installed', 'res-host-002': 'installed' },
    created_at: '2026-07-05T10:10:00Z',
    updated_at: '2026-07-20T11:00:00Z',
  },
  {
    job_id: 'job-002',
    job_name: 'prod-redis',
    resource_type: 'redis',
    exporter_template_id: 'et-redis',
    network_domain_id: 'default',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-mw-001'],
    instance_filter: null,
    scrape_interval: '30s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    label_template_id: 'lt-mw-001',
    relabel_configs: [],
    enabled: true,
    exporter_status: { 'res-mw-001': 'installed' },
    created_at: '2026-07-06T09:10:00Z',
    updated_at: '2026-07-06T09:10:00Z',
  },
  {
    job_id: 'job-003',
    job_name: 'prod-mysql',
    resource_type: 'mysql',
    exporter_template_id: 'et-mysql',
    network_domain_id: 'default',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-mw-002'],
    instance_filter: null,
    scrape_interval: '30s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    label_template_id: 'lt-mw-001',
    relabel_configs: [],
    enabled: false,
    exporter_status: { 'res-mw-002': 'unregistered' },
    created_at: '2026-07-21T15:00:00Z',
    updated_at: '2026-07-21T15:00:00Z',
  },
  {
    job_id: 'job-004',
    job_name: 'staging-apps',
    resource_type: 'application_http',
    exporter_template_id: 'et-app',
    network_domain_id: 'gov-cloud-a',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-app-002'],
    instance_filter: null,
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/actuator/prometheus',
    scheme: 'http',
    label_template_id: 'lt-app-001',
    relabel_configs: [],
    enabled: false,
    exporter_status: { 'res-app-002': 'pending' },
    created_at: '2026-07-12T13:00:00Z',
    updated_at: '2026-07-12T13:00:00Z',
  },
  {
    job_id: 'job-005',
    job_name: 'network-snmp',
    resource_type: 'snmp',
    exporter_template_id: 'et-snmp',
    network_domain_id: 'gov-cloud-a',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-gen-001', 'res-gen-002'],
    instance_filter: null,
    scrape_interval: '60s',
    scrape_timeout: '30s',
    metrics_path: '/snmp',
    scheme: 'http',
    label_template_id: 'lt-gen-001',
    relabel_configs: [],
    enabled: true,
    exporter_status: { 'res-gen-001': 'installed', 'res-gen-002': 'not_installed' },
    created_at: '2026-07-10T14:20:00Z',
    updated_at: '2026-07-10T14:20:00Z',
  },
]

// ---------- 规则编辑模型（PRD 5.5） ----------
export interface MonitoringRule {
  rule_id: string
  rule_type: RuleType
  name: string
  expr: string
  /** for 字段，仅告警规则 */
  duration: string
  labels: Record<string, string>
  /** 仅告警规则 */
  annotations: Record<string, string>
  resource_type: CiType
  /** 关联 Exporter 模板，用于指标提示（PRD 5.5） */
  exporter_template_id: string
  enabled: boolean
  created_at: string
  updated_at: string
}

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
    exporter_template_id: 'et-node',
    enabled: true,
    created_at: '2026-07-02T09:00:00Z',
    updated_at: '2026-07-18T10:00:00Z',
  },
  {
    rule_id: 'rule-002',
    rule_type: 'alerting',
    name: 'RedisMemoryHigh',
    expr: 'redis_memory_used_bytes / redis_memory_max_bytes > 0.85',
    duration: '2m',
    labels: { severity: 'critical', team: 'middleware' },
    annotations: { summary: 'Redis 内存使用率过高', description: 'Redis 实例 {{ $labels.instance }} 内存使用率超过 85%' },
    resource_type: 'redis',
    exporter_template_id: 'et-redis',
    enabled: true,
    created_at: '2026-07-02T09:00:00Z',
    updated_at: '2026-07-02T09:00:00Z',
  },
  {
    rule_id: 'rule-003',
    rule_type: 'recording',
    name: 'job:app_request_rate:5m',
    expr: 'sum by (job, app) (rate(app_http_requests_total[5m]))',
    duration: '',
    labels: { team: 'platform' },
    annotations: {},
    resource_type: 'application_http',
    exporter_template_id: 'et-app',
    enabled: true,
    created_at: '2026-07-03T09:00:00Z',
    updated_at: '2026-07-03T09:00:00Z',
  },
  {
    rule_id: 'rule-004',
    rule_type: 'alerting',
    name: 'AppErrorRateHigh',
    expr: 'rate(app_http_requests_total{status=~"5.."}[5m]) / rate(app_http_requests_total[5m]) > 0.05',
    duration: '3m',
    labels: { severity: 'warning', team: 'app' },
    annotations: { summary: '应用 5xx 错误率过高', description: '应用 {{ $labels.app }} 5xx 错误率超过 5%' },
    resource_type: 'application_http',
    exporter_template_id: 'et-app',
    enabled: false,
    created_at: '2026-07-04T09:00:00Z',
    updated_at: '2026-07-04T09:00:00Z',
  },
  {
    rule_id: 'rule-005',
    rule_type: 'alerting',
    name: 'MysqlHighConnections',
    expr: 'mysql_global_status_threads_connected / mysql_global_variables_max_connections > 0.8',
    duration: '5m',
    labels: { severity: 'warning', team: 'middleware' },
    annotations: { summary: 'MySQL 连接数过高', description: '实例 {{ $labels.instance }} 活跃连接占比超过 80%' },
    resource_type: 'mysql',
    exporter_template_id: 'et-mysql',
    enabled: true,
    created_at: '2026-07-22T15:00:00Z',
    updated_at: '2026-07-22T15:00:00Z',
  },
]

// ---------- Exporter 指标库（PRD 5.3） ----------
export interface MetricLibraryItem {
  metric_id: string
  metric_name: string
  metric_type: MetricType
  help: string
  unit?: string
  labels: string[]
  exporter_template_id: string
  /** 是否平台内置（PRD 5.3），内置指标禁止编辑/删除 */
  is_builtin: boolean
  /** 是否启用（PRD 5.3），禁用指标不参与规则编辑提示 */
  enabled: boolean
}

export const mockMetricLibrary: MetricLibraryItem[] = [
  { metric_id: 'm-001', metric_name: 'node_cpu_seconds_total', metric_type: 'counter', help: 'CPU 各模式累计耗时', unit: 's', labels: ['cpu', 'mode', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_id: 'm-002', metric_name: 'node_memory_MemAvailable_bytes', metric_type: 'gauge', help: '可用内存字节数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_id: 'm-003', metric_name: 'node_filesystem_avail_bytes', metric_type: 'gauge', help: '文件系统可用空间', unit: 'bytes', labels: ['device', 'fstype', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_id: 'm-004', metric_name: 'node_network_receive_bytes_total', metric_type: 'counter', help: '网卡接收字节总数', unit: 'bytes', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_id: 'm-005', metric_name: 'redis_memory_used_bytes', metric_type: 'gauge', help: 'Redis 已用内存', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_id: 'm-006', metric_name: 'redis_connected_clients', metric_type: 'gauge', help: '当前连接客户端数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_id: 'm-007', metric_name: 'mysql_global_status_threads_connected', metric_type: 'gauge', help: 'MySQL 当前连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_id: 'm-008', metric_name: 'mysql_global_variables_max_connections', metric_type: 'gauge', help: 'MySQL 最大连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_id: 'm-009', metric_name: 'app_http_requests_total', metric_type: 'counter', help: 'HTTP 请求总数', unit: '', labels: ['status', 'path', 'app'], exporter_template_id: 'et-app', is_builtin: true, enabled: true },
  { metric_id: 'm-010', metric_name: 'app_http_request_duration_seconds', metric_type: 'histogram', help: 'HTTP 请求耗时分布', unit: 's', labels: ['status', 'path', 'app'], exporter_template_id: 'et-app', is_builtin: true, enabled: true },
  { metric_id: 'm-011', metric_name: 'app_business_orders_total', metric_type: 'counter', help: '业务订单总数（用户扩展）', unit: '', labels: ['app', 'region'], exporter_template_id: 'et-app', is_builtin: false, enabled: true },
  { metric_id: 'm-012', metric_name: 'kafka_consumergroup_lag', metric_type: 'gauge', help: '消费组 lag', unit: '', labels: ['topic', 'consumergroup', 'instance'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_id: 'm-013', metric_name: 'probe_success', metric_type: 'gauge', help: '拨测是否成功（指标定义）', unit: '', labels: ['instance', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_id: 'm-014', metric_name: 'probe_duration_seconds', metric_type: 'gauge', help: '拨测耗时（指标定义）', unit: 's', labels: ['instance', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_id: 'm-015', metric_name: 'snmp_ifInOctets', metric_type: 'counter', help: '接口入流量', unit: 'bytes', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
]

// ---------- 拨测配置（PRD 3.1） ----------
export interface BlackboxProbe {
  probe_id: string
  module: string
  target: string
  protocol: ProbeProtocol
  url?: string
  /** 拨测目标归属网域（PRD 5.4 网域隔离） */
  network_domain_id: string
  interval: string
  timeout: string
  enabled: boolean
}

export const mockProbes: BlackboxProbe[] = [
  { probe_id: 'probe-001', module: 'http_2xx', target: 'https://api.example.com/health', protocol: 'https', url: 'https://api.example.com/health', network_domain_id: 'default', interval: '30s', timeout: '10s', enabled: true },
  { probe_id: 'probe-002', module: 'tcp_connect', target: 'redis-cache-01.mw:6379', protocol: 'tcp', network_domain_id: 'default', interval: '30s', timeout: '5s', enabled: true },
  { probe_id: 'probe-003', module: 'dns_query', target: 'example.com', protocol: 'dns', network_domain_id: 'gov-cloud-a', interval: '60s', timeout: '10s', enabled: false },
  { probe_id: 'probe-004', module: 'icmp_ping', target: '10.0.1.11', protocol: 'icmp', network_domain_id: 'default', interval: '60s', timeout: '5s', enabled: true },
]

// ---------- Resource（由 Module_07 维护，本模块只读引用，用于实例选择） ----------
export interface Resource {
  resource_id: string
  resource_type: CiType
  instance_name: string
  hostname: string
  instance_ip: string
  network_domain_id: string
  env: Env
  app_name: string
  cluster: string
  status: ResourceStatus
}

export const mockResources: Resource[] = [
  { resource_id: 'res-host-001', resource_type: 'host', instance_name: 'prod-web-01', hostname: 'prod-web-01.volc', instance_ip: '10.0.1.11', network_domain_id: 'default', env: 'prod', app_name: 'web-portal', cluster: 'cluster-prod', status: 'online' },
  { resource_id: 'res-host-002', resource_type: 'host', instance_name: 'prod-db-01', hostname: 'prod-db-01.volc', instance_ip: '10.0.1.21', network_domain_id: 'default', env: 'prod', app_name: 'mysql-core', cluster: 'cluster-prod', status: 'online' },
  { resource_id: 'res-mw-001', resource_type: 'redis', instance_name: 'redis-cache-01', hostname: 'redis-cache-01.mw', instance_ip: '10.0.2.11', network_domain_id: 'default', env: 'prod', app_name: 'cache-service', cluster: 'cluster-prod', status: 'online' },
  { resource_id: 'res-mw-002', resource_type: 'mysql', instance_name: 'mysql-primary-01', hostname: 'mysql-primary-01.mw', instance_ip: '10.0.2.21', network_domain_id: 'default', env: 'prod', app_name: 'mysql-core', cluster: 'cluster-prod', status: 'maintenance' },
  { resource_id: 'res-mw-003', resource_type: 'kafka', instance_name: 'kafka-broker-01', hostname: 'kafka-broker-01.mw', instance_ip: '10.0.2.31', network_domain_id: 'gov-cloud-a', env: 'staging', app_name: 'mq-platform', cluster: 'cluster-staging', status: 'online' },
  { resource_id: 'res-app-002', resource_type: 'application_http', instance_name: 'pay-service-v1', hostname: 'pay-service-v1.app', instance_ip: '192.168.3.12', network_domain_id: 'gov-cloud-a', env: 'staging', app_name: 'pay-service', cluster: 'cluster-staging', status: 'offline' },
  { resource_id: 'res-gen-001', resource_type: 'snmp', instance_name: 'switch-core-01', hostname: 'switch-core-01.net', instance_ip: '172.16.0.1', network_domain_id: 'gov-cloud-a', env: 'prod', app_name: 'network-infra', cluster: 'cluster-net', status: 'online' },
  { resource_id: 'res-gen-002', resource_type: 'snmp', instance_name: 'loadbalancer-02', hostname: 'lb-02.net', instance_ip: '172.16.0.2', network_domain_id: 'gov-cloud-a', env: 'prod', app_name: 'network-infra', cluster: 'cluster-net', status: 'online' },
]

// ---------- 字典：安装状态 ----------
export const INSTALL_STATUS_MAP: Record<ExporterInstallStatus, { text: string; color: string }> = {
  pending: { text: '待安装', color: '#FA8C16' },
  installed: { text: '已安装', color: '#00B578' },
  not_installed: { text: '未安装', color: '#FF4C3A' },
  unregistered: { text: '未注册', color: '#86909C' },
}

/** 安装状态循环顺序：pending → installed → not_installed → unregistered → pending */
export const INSTALL_STATUS_CYCLE: ExporterInstallStatus[] = [
  'pending',
  'installed',
  'not_installed',
  'unregistered',
]

export const RULE_TYPE_MAP: Record<RuleType, { text: string; color: string }> = {
  alerting: { text: '告警', color: '#FF4C3A' },
  recording: { text: '记录', color: '#1481FD' },
}

export const METRIC_TYPE_COLOR: Record<MetricType, string> = {
  counter: '#00B578',
  gauge: '#1481FD',
  histogram: '#FA8C16',
  summary: '#722ED1',
  unknown: '#86909C',
}

export const METRIC_TYPE_LABEL: Record<MetricType, string> = {
  counter: 'Counter',
  gauge: 'Gauge',
  histogram: 'Histogram',
  summary: 'Summary',
  unknown: 'Unknown',
}

export const ENV_LABEL: Record<Env, string> = {
  dev: '开发',
  test: '测试',
  staging: '预发',
  prod: '生产',
}

export const STATUS_LABEL: Record<ResourceStatus, string> = {
  online: '在线',
  offline: '离线',
  maintenance: '维护中',
}
