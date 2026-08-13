// ============================================================
// Module_01 监控策略与指标管理 - 数据模型与 mock 数据
// 对齐 PRD v3.3（Module_01_Metric_Collection_Center.md）
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

/** 资源类别 → 细粒度 CI 类型（问题 5：两级级联选择） */
export const CI_TYPES_BY_CATEGORY: Record<ResourceCategory, CiType[]> = {
  host: ['host'],
  middleware: ['mysql', 'redis', 'kafka', 'elasticsearch', 'nginx'],
  application: ['application_http'],
  generic_target: ['snmp'],
}

export const RESOURCE_CATEGORIES: ResourceCategory[] = [
  'host',
  'middleware',
  'application',
  'generic_target',
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

/** ScrapeJob 类型：standard 标准采集 / blackbox 拨测（PRD v2.0 决策 4） */
export type ScrapeJobType = 'standard' | 'blackbox'

/** blackbox_exporter 探测模块 */
export type BlackboxModule = 'http_2xx' | 'http_post_2xx' | 'tcp_connect' | 'icmp_ping' | 'dns_query'

export const ENV_VALUES: Env[] = ['dev', 'test', 'staging', 'prod']
export const STATUS_VALUES: ResourceStatus[] = ['online', 'offline', 'maintenance']
export const METRIC_TYPES: MetricType[] = ['counter', 'gauge', 'histogram', 'summary', 'unknown']
export const SCHEMES: Scheme[] = ['http', 'https']

export const BLACKBOX_MODULES: BlackboxModule[] = [
  'http_2xx',
  'http_post_2xx',
  'tcp_connect',
  'icmp_ping',
  'dns_query',
]

export const BLACKBOX_MODULE_LABEL: Record<BlackboxModule, string> = {
  http_2xx: 'HTTP 2xx',
  http_post_2xx: 'HTTP POST 2xx',
  tcp_connect: 'TCP 连接',
  icmp_ping: 'ICMP Ping',
  dns_query: 'DNS 查询',
}

export const BLACKBOX_PROTOCOL_BY_MODULE: Record<BlackboxModule, ProbeProtocol> = {
  http_2xx: 'http',
  http_post_2xx: 'http',
  tcp_connect: 'tcp',
  icmp_ping: 'icmp',
  dns_query: 'dns',
}

// ---------- 租户上下文（对齐 Module_09 / 演示单网域-多网域模式） ----------
export interface Tenant {
  id: string
  name: string
  /** 租户级多网域开关（web-development 规范）：false 时仅面向 default 管理域，网域选择固定 default */
  multi_site_enabled: boolean
}

/** 当前租户上下文：通过切换 multi_site_enabled 演示单网域/多网域模式差异 */
export const currentTenant: Tenant = {
  id: 'tenant-001',
  name: 'AIDC 运维租户',
  multi_site_enabled: true,
}

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

// ---------- 标签模板（引用 Module_07，本模块只读选择 + 只读预览映射内容） ----------
export interface LabelTemplateMapping {
  source_field: string
  source_type: 'resource_field' | 'composite' | 'prometheus_builtin' | 'cmdb_field'
  target_label: string
  enabled: boolean
}

export interface LabelTemplate {
  template_id: string
  name: string
  resource_category: ResourceCategory
  is_default: boolean
  /** 只读预览用：模板映射内容（Module_07 维护，本模块展示） */
  mappings: LabelTemplateMapping[]
}

export const mockLabelTemplates: LabelTemplate[] = [
  {
    template_id: 'lt-h-001',
    name: '主机默认标签模板',
    resource_category: 'host',
    is_default: true,
    mappings: [
      { source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true },
      { source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true },
      { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
      { source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true },
      { source_field: 'hostname', source_type: 'resource_field', target_label: 'hostname', enabled: true },
      { source_field: 'instance_name', source_type: 'resource_field', target_label: 'instance_name', enabled: true },
      { source_field: 'os_type', source_type: 'resource_field', target_label: 'os_type', enabled: true },
    ],
  },
  {
    template_id: 'lt-mw-001',
    name: '中间件默认标签模板',
    resource_category: 'middleware',
    is_default: true,
    mappings: [
      { source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true },
      { source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true },
      { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
      { source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true },
      { source_field: 'middleware_type', source_type: 'resource_field', target_label: 'middleware_type', enabled: true },
    ],
  },
  {
    template_id: 'lt-app-001',
    name: '应用默认标签模板',
    resource_category: 'application',
    is_default: true,
    mappings: [
      { source_field: 'service_name', source_type: 'resource_field', target_label: 'service_name', enabled: true },
      { source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true },
      { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
      { source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true },
      { source_field: 'health_check_url', source_type: 'resource_field', target_label: 'health_check_url', enabled: true },
    ],
  },
  {
    template_id: 'lt-gen-001',
    name: '通用目标默认标签模板',
    resource_category: 'generic_target',
    is_default: true,
    mappings: [
      { source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true },
      { source_field: 'target_name', source_type: 'resource_field', target_label: 'target_name', enabled: true },
      { source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true },
      { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
      { source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true },
      { source_field: 'custom_labels.*', source_type: 'resource_field', target_label: 'custom_labels.*', enabled: true },
    ],
  },
  {
    template_id: 'lt-mw-002',
    name: 'Redis 高可用标签模板',
    resource_category: 'middleware',
    is_default: false,
    mappings: [
      { source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true },
      { source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true },
      { source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true },
      { source_field: 'middleware_type', source_type: 'resource_field', target_label: 'middleware_type', enabled: true },
      { source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true },
      { source_field: 'instance_name', source_type: 'resource_field', target_label: 'instance_name', enabled: true },
    ],
  },
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
    install_guide: '运行 ./kafka_exporter --kafka.server=localhost:9092 --web.listen-address=:9308。',
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
    description: '黑盒拨测采集器（HTTP/TCP/ICMP/DNS），通过 ScrapeJob.job_type=blackbox 使用',
    install_guide:
      'blackbox exporter 随 Edge Agent / 中心采集器同域部署；拨测目标由 ScrapeJob.blackbox_targets 维护。',
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
  /** {v3.1} 该 CI 类型是否已有标签模板，供前端判断是否提示创建引导 */
  has_label_template: boolean
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
    has_label_template: true,
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
    has_label_template: true,
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
    has_label_template: true,
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
    has_label_template: true,
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
    has_label_template: true,
    is_builtin: false,
    created_at: '2026-07-22T14:00:00Z',
    updated_at: '2026-07-22T14:00:00Z',
  },
  {
    // {v3.2} 演示「标签模板待配置」：该 CI 类型（nginx）尚未创建标签模板，
    // 作为创建引导 / 待配置 Badge / Job 层「标签待配置」提示的触发样本
    mapping_id: 'map-006',
    resource_type: 'nginx',
    exporter_template_id: 'et-nginx',
    default_port: 9113,
    metrics_path: '/metrics',
    scheme: 'http',
    scrape_interval: '15s',
    scrape_timeout: '10s',
    label_template_id: undefined,
    has_label_template: false,
    is_builtin: false,
    created_at: '2026-07-23T11:00:00Z',
    updated_at: '2026-08-12T15:00:00Z',
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
    has_label_template: true,
    is_builtin: true,
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-15T09:00:00Z',
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
    has_label_template: true,
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
  /** {P1} 实例上 exporter 实际监听端口；配置生成时与生效端口（映射 default_port / 网域覆盖）不一致则提示，不自动改配置（PRD 5.6 v2.7） */
  actual_port?: number
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
    actual_port: 9100,
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
export interface BlackboxTarget {
  target: string
  protocol: ProbeProtocol
  url?: string
}

export interface ScrapeJob {
  job_id: string
  job_name: string
  /** standard job 必须设置；blackbox job 使用 application_http 作为占位 */
  resource_type: CiType
  /** standard job 必须设置；blackbox job 使用 et-blackbox 作为占位 */
  exporter_template_id: string
  network_domain_id: string
  /** Job 类型：standard 标准采集 / blackbox 拨测（PRD v2.0） */
  job_type: ScrapeJobType
  instance_selection_mode: InstanceSelectionMode
  selected_instance_ids: string[]
  /** filter 模式下的筛选条件（v0.3+ 预留，MVP mock 为 null） */
  instance_filter: Record<string, unknown> | null
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: Scheme
  label_template_id?: string
  /** 手动覆盖过映射默认值的参数字段名（PRD 5.4 决策 14）：「同步映射默认值」时跳过这些字段 */
  mapping_overrides?: string[]
  /** 高级 relabel 规则（P2 预留，mock 为空数组） */
  relabel_configs: Record<string, unknown>[]
  /** blackbox job 必填：引用的 blackbox module */
  blackbox_module?: BlackboxModule
  /** blackbox job 必填：拨测目标列表 */
  blackbox_targets?: BlackboxTarget[]
  enabled: boolean
  /** 冗余快速查找：resource_id → 安装状态（详情展示使用 ExporterInstallationConfirmation） */
  exporter_status: Record<string, ExporterInstallStatus>
  /** 演示决策 14：最近一次从映射（含网域覆盖）同步默认采集参数的时间；早于映射 updated_at 时视为「映射默认值已变更」 */
  mapping_synced_at?: string
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
    job_type: 'standard',
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
    // 演示决策 14：metrics_path 被手动覆盖，同步映射默认值时该字段不刷新
    mapping_overrides: ['metrics_path'],
    mapping_synced_at: '2026-07-05T10:10:00Z',
    created_at: '2026-07-05T10:10:00Z',
    updated_at: '2026-07-20T11:00:00Z',
  },
  {
    job_id: 'job-002',
    job_name: 'prod-redis',
    resource_type: 'redis',
    exporter_template_id: 'et-redis',
    network_domain_id: 'default',
    job_type: 'standard',
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
    job_type: 'standard',
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
    job_type: 'standard',
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
    mapping_overrides: ['scrape_interval'],
    mapping_synced_at: '2026-07-12T13:00:00Z',
    created_at: '2026-07-12T13:00:00Z',
    updated_at: '2026-07-12T13:00:00Z',
  },
  {
    job_id: 'job-005',
    job_name: 'network-snmp',
    resource_type: 'snmp',
    exporter_template_id: 'et-snmp',
    network_domain_id: 'gov-cloud-a',
    job_type: 'standard',
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
  // {v3.2} 演示「Job 标签待配置」：引用 map-006（nginx 无标签模板），label_template_id 为空，
  // 列表 / 详情 / 编辑表单显示「标签待配置」，引导先前往 CI-Exporter 映射页补配（补配后自动继承）
  {
    job_id: 'job-006',
    job_name: 'prod-nginx',
    resource_type: 'nginx',
    exporter_template_id: 'et-nginx',
    network_domain_id: 'default',
    job_type: 'standard',
    instance_selection_mode: 'manual',
    selected_instance_ids: ['res-mw-004'],
    instance_filter: null,
    scrape_interval: '15s',
    scrape_timeout: '10s',
    metrics_path: '/metrics',
    scheme: 'http',
    label_template_id: undefined,
    relabel_configs: [],
    enabled: true,
    exporter_status: { 'res-mw-004': 'installed' },
    mapping_overrides: [],
    mapping_synced_at: '2026-08-12T16:00:00Z',
    created_at: '2026-08-12T16:00:00Z',
    updated_at: '2026-08-12T16:00:00Z',
  },
  // blackbox 拨测 Job：由原先独立「拨测配置」合并而来（PRD v2.0 决策 4）
  {
    job_id: 'job-bb-001',
    job_name: 'blackbox-http-default',
    resource_type: 'application_http',
    exporter_template_id: 'et-blackbox',
    network_domain_id: 'default',
    job_type: 'blackbox',
    instance_selection_mode: 'manual',
    selected_instance_ids: [],
    instance_filter: null,
    scrape_interval: '30s',
    scrape_timeout: '10s',
    metrics_path: '/probe',
    scheme: 'http',
    relabel_configs: [],
    blackbox_module: 'http_2xx',
    blackbox_targets: [
      { target: 'https://api.example.com/health', protocol: 'https', url: 'https://api.example.com/health' },
    ],
    enabled: true,
    exporter_status: {},
    created_at: '2026-07-15T10:00:00Z',
    updated_at: '2026-07-15T10:00:00Z',
  },
  {
    job_id: 'job-bb-002',
    job_name: 'blackbox-tcp-default',
    resource_type: 'application_http',
    exporter_template_id: 'et-blackbox',
    network_domain_id: 'default',
    job_type: 'blackbox',
    instance_selection_mode: 'manual',
    selected_instance_ids: [],
    instance_filter: null,
    scrape_interval: '30s',
    scrape_timeout: '5s',
    metrics_path: '/probe',
    scheme: 'http',
    relabel_configs: [],
    blackbox_module: 'tcp_connect',
    blackbox_targets: [{ target: 'redis-cache-01.mw:6379', protocol: 'tcp' }],
    enabled: true,
    exporter_status: {},
    created_at: '2026-07-16T10:00:00Z',
    updated_at: '2026-07-16T10:00:00Z',
  },
  {
    job_id: 'job-bb-003',
    job_name: 'blackbox-icmp-gov',
    resource_type: 'application_http',
    exporter_template_id: 'et-blackbox',
    network_domain_id: 'gov-cloud-a',
    job_type: 'blackbox',
    instance_selection_mode: 'manual',
    selected_instance_ids: [],
    instance_filter: null,
    scrape_interval: '60s',
    scrape_timeout: '5s',
    metrics_path: '/probe',
    scheme: 'http',
    relabel_configs: [],
    blackbox_module: 'icmp_ping',
    blackbox_targets: [{ target: '10.0.1.11', protocol: 'icmp' }],
    enabled: false,
    exporter_status: {},
    created_at: '2026-07-17T10:00:00Z',
    updated_at: '2026-07-17T10:00:00Z',
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
  /** 规则作用域：central / edge / both（PRD 5.5，MVP~v0.3 固定 central、不暴露给用户） */
  scope: 'central' | 'edge' | 'both'
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
    scope: 'central',
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
    scope: 'central',
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
    scope: 'central',
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
    scope: 'central',
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
    scope: 'central',
    enabled: true,
    created_at: '2026-07-22T15:00:00Z',
    updated_at: '2026-07-22T15:00:00Z',
  },
  {
    rule_id: 'rule-006',
    rule_type: 'alerting',
    name: 'ProbeFailed',
    expr: 'probe_success{job="blackbox-http-default"} == 0',
    duration: '1m',
    labels: { severity: 'critical', team: 'sre' },
    annotations: { summary: '拨测失败', description: '目标 {{ $labels.instance }} 拨测失败' },
    resource_type: 'application_http',
    exporter_template_id: 'et-blackbox',
    scope: 'central',
    enabled: true,
    created_at: '2026-07-25T15:00:00Z',
    updated_at: '2026-07-25T15:00:00Z',
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

// MVP 指标库最小集：按 CI 类型 / Exporter 预置静态指标库（PRD v2.0 5.3）
const nodeMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'node_cpu_seconds_total', metric_type: 'counter', help: 'CPU 各模式累计耗时', unit: 's', labels: ['cpu', 'mode', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_cpu_guest_seconds_total', metric_type: 'counter', help: 'CPU guest 模式累计耗时', unit: 's', labels: ['cpu', 'mode', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_MemTotal_bytes', metric_type: 'gauge', help: '物理内存总量', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_MemAvailable_bytes', metric_type: 'gauge', help: '可用内存字节数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_MemFree_bytes', metric_type: 'gauge', help: '空闲内存字节数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_Buffers_bytes', metric_type: 'gauge', help: 'Buffer Cache 字节数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_Cached_bytes', metric_type: 'gauge', help: 'Page Cache 字节数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_SwapTotal_bytes', metric_type: 'gauge', help: 'Swap 总量', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_memory_SwapFree_bytes', metric_type: 'gauge', help: 'Swap 空闲量', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_filesystem_size_bytes', metric_type: 'gauge', help: '文件系统总容量', unit: 'bytes', labels: ['device', 'fstype', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_filesystem_avail_bytes', metric_type: 'gauge', help: '文件系统可用空间', unit: 'bytes', labels: ['device', 'fstype', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_filesystem_free_bytes', metric_type: 'gauge', help: '文件系统剩余空间', unit: 'bytes', labels: ['device', 'fstype', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_disk_io_time_seconds_total', metric_type: 'counter', help: '磁盘 I/O 耗时累计', unit: 's', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_disk_read_bytes_total', metric_type: 'counter', help: '磁盘读取字节总数', unit: 'bytes', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_disk_written_bytes_total', metric_type: 'counter', help: '磁盘写入字节总数', unit: 'bytes', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_disk_reads_completed_total', metric_type: 'counter', help: '磁盘读完成次数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_disk_writes_completed_total', metric_type: 'counter', help: '磁盘写完成次数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_receive_bytes_total', metric_type: 'counter', help: '网卡接收字节总数', unit: 'bytes', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_receive_packets_total', metric_type: 'counter', help: '网卡接收包总数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_receive_errs_total', metric_type: 'counter', help: '网卡接收错误数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_receive_drop_total', metric_type: 'counter', help: '网卡接收丢包数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_transmit_bytes_total', metric_type: 'counter', help: '网卡发送字节总数', unit: 'bytes', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_transmit_packets_total', metric_type: 'counter', help: '网卡发送包总数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_transmit_errs_total', metric_type: 'counter', help: '网卡发送错误数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_network_transmit_drop_total', metric_type: 'counter', help: '网卡发送丢包数', unit: '', labels: ['device', 'instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_load1', metric_type: 'gauge', help: '1 分钟平均负载', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_load5', metric_type: 'gauge', help: '5 分钟平均负载', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_load15', metric_type: 'gauge', help: '15 分钟平均负载', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_uname_info', metric_type: 'gauge', help: '系统信息', unit: '', labels: ['instance', 'machine', 'nodename', 'release', 'sysname', 'version'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_boot_time_seconds', metric_type: 'gauge', help: '系统启动时间', unit: 's', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_time_seconds', metric_type: 'gauge', help: '当前系统时间', unit: 's', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_context_switches_total', metric_type: 'counter', help: '上下文切换次数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_intr_total', metric_type: 'counter', help: '中断次数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_exporter_build_info', metric_type: 'gauge', help: 'Exporter 构建信息', unit: '', labels: ['instance', 'version', 'revision'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_arp_entries', metric_type: 'gauge', help: 'ARP 表项数', unit: '', labels: ['instance', 'device'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_filefd_allocated', metric_type: 'gauge', help: '已分配文件描述符', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_filefd_maximum', metric_type: 'gauge', help: '文件描述符上限', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_vmstat_pgpgin', metric_type: 'gauge', help: '分页换入数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_vmstat_pgpgout', metric_type: 'gauge', help: '分页换出数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_netstat_Tcp_CurrEstab', metric_type: 'gauge', help: '当前 ESTABLISHED TCP 连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_netstat_Tcp_ActiveOpens', metric_type: 'gauge', help: '主动打开 TCP 连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
  { metric_name: 'node_netstat_Tcp_PassiveOpens', metric_type: 'gauge', help: '被动打开 TCP 连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-node', is_builtin: true, enabled: true },
]

const mysqlMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'mysql_global_status_threads_connected', metric_type: 'gauge', help: 'MySQL 当前连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_threads_running', metric_type: 'gauge', help: 'MySQL 活跃线程数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_threads_cached', metric_type: 'gauge', help: 'MySQL 缓存线程数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_connections', metric_type: 'gauge', help: 'MySQL 总连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_max_used_connections', metric_type: 'gauge', help: 'MySQL 历史最大连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_aborted_connects', metric_type: 'counter', help: 'MySQL 异常连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_slow_queries', metric_type: 'counter', help: 'MySQL 慢查询数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_questions', metric_type: 'counter', help: 'MySQL 总查询数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_queries', metric_type: 'counter', help: 'MySQL 语句执行数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_com_select', metric_type: 'counter', help: 'MySQL SELECT 次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_com_insert', metric_type: 'counter', help: 'MySQL INSERT 次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_com_update', metric_type: 'counter', help: 'MySQL UPDATE 次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_com_delete', metric_type: 'counter', help: 'MySQL DELETE 次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_innodb_buffer_pool_pages_total', metric_type: 'gauge', help: 'InnoDB Buffer Pool 总页数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_innodb_buffer_pool_pages_free', metric_type: 'gauge', help: 'InnoDB Buffer Pool 空闲页数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_innodb_buffer_pool_pages_dirty', metric_type: 'gauge', help: 'InnoDB Buffer Pool 脏页数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_innodb_row_lock_waits', metric_type: 'counter', help: 'InnoDB 行锁等待次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_variables_max_connections', metric_type: 'gauge', help: 'MySQL 最大连接数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_variables_innodb_buffer_pool_size', metric_type: 'gauge', help: 'InnoDB Buffer Pool 大小', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_slave_lag_seconds', metric_type: 'gauge', help: '主从复制延迟', unit: 's', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_slave_sql_running', metric_type: 'gauge', help: 'SQL 线程运行状态', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_slave_io_running', metric_type: 'gauge', help: 'IO 线程运行状态', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_info_schema_table_rows', metric_type: 'gauge', help: '表行数估计', unit: '', labels: ['instance', 'schema', 'table'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_info_schema_table_size', metric_type: 'gauge', help: '表大小', unit: 'bytes', labels: ['instance', 'schema', 'table'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_perf_schema_events_statements_total', metric_type: 'counter', help: 'Performance Schema 语句事件总数', unit: '', labels: ['instance', 'schema', 'digest'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_perf_schema_table_io_waits_total', metric_type: 'counter', help: 'Performance Schema 表 I/O 等待总数', unit: '', labels: ['instance', 'schema', 'table'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_table_locks_waited', metric_type: 'counter', help: '表锁等待次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_table_locks_immediate', metric_type: 'counter', help: '表锁立即获得次数', unit: '', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_bytes_received', metric_type: 'counter', help: '接收字节总数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
  { metric_name: 'mysql_global_status_bytes_sent', metric_type: 'counter', help: '发送字节总数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-mysql', is_builtin: true, enabled: true },
]

const redisMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'redis_connected_clients', metric_type: 'gauge', help: '当前连接客户端数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_blocked_clients', metric_type: 'gauge', help: '阻塞客户端数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_rejected_connections_total', metric_type: 'counter', help: '拒绝连接总数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_memory_used_bytes', metric_type: 'gauge', help: 'Redis 已用内存', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_memory_used_rss_bytes', metric_type: 'gauge', help: 'Redis RSS 内存', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_memory_max_bytes', metric_type: 'gauge', help: 'Redis 最大可用内存', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_memory_used_peak_bytes', metric_type: 'gauge', help: 'Redis 历史峰值内存', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_keys_total', metric_type: 'gauge', help: 'Redis 总键数', unit: '', labels: ['instance', 'db'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_expired_keys_total', metric_type: 'counter', help: '过期键总数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_evicted_keys_total', metric_type: 'counter', help: '淘汰键总数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_keyspace_hits_total', metric_type: 'counter', help: 'Keyspace 命中次数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_keyspace_misses_total', metric_type: 'counter', help: 'Keyspace 未命中次数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_instantaneous_ops_per_sec', metric_type: 'gauge', help: '每秒操作数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_instantaneous_input_kbps', metric_type: 'gauge', help: '瞬时输入流量', unit: 'kbps', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_instantaneous_output_kbps', metric_type: 'gauge', help: '瞬时输出流量', unit: 'kbps', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_cpu_sys_seconds_total', metric_type: 'counter', help: '系统 CPU 耗时', unit: 's', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_cpu_user_seconds_total', metric_type: 'counter', help: '用户 CPU 耗时', unit: 's', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_net_input_bytes_total', metric_type: 'counter', help: '网络输入字节总数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_net_output_bytes_total', metric_type: 'counter', help: '网络输出字节总数', unit: 'bytes', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_replication_master_link_up', metric_type: 'gauge', help: '主从连接状态', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_replication_lag_seconds', metric_type: 'gauge', help: '主从复制延迟', unit: 's', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_slowlog_length', metric_type: 'gauge', help: '慢查询日志长度', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_commands_processed_total', metric_type: 'counter', help: '处理命令总数', unit: '', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_commands_duration_seconds_total', metric_type: 'counter', help: '命令执行耗时累计', unit: 's', labels: ['instance'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
  { metric_name: 'redis_exporter_build_info', metric_type: 'gauge', help: 'Exporter 构建信息', unit: '', labels: ['instance', 'version'], exporter_template_id: 'et-redis', is_builtin: true, enabled: true },
]

const kafkaMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'kafka_brokers', metric_type: 'gauge', help: 'Broker 数量', unit: '', labels: ['instance'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_topic_partition_current_offset', metric_type: 'gauge', help: '分区当前 offset', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_topic_partition_oldest_offset', metric_type: 'gauge', help: '分区最旧 offset', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_topic_partition_in_sync_replica', metric_type: 'gauge', help: '分区 ISR 副本数', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_topic_partition_leader', metric_type: 'gauge', help: '分区 Leader', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_topic_partition_replicas', metric_type: 'gauge', help: '分区副本数', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_topic_partition_under_replicated_partition', metric_type: 'gauge', help: '分区 under-replicated 标记', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_consumergroup_lag', metric_type: 'gauge', help: '消费组 lag', unit: '', labels: ['instance', 'topic', 'partition', 'consumergroup'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_consumergroup_current_offset', metric_type: 'gauge', help: '消费组当前 offset', unit: '', labels: ['instance', 'topic', 'partition', 'consumergroup'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_consumergroup_lag_sum', metric_type: 'gauge', help: '消费组 lag 总和', unit: '', labels: ['instance', 'topic', 'consumergroup'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_consumer_lag_sum', metric_type: 'gauge', help: '消费者 lag 总和', unit: '', labels: ['instance', 'consumergroup'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_consumer_fetch_rate', metric_type: 'gauge', help: '消费者 fetch 速率', unit: '', labels: ['instance', 'consumergroup'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_request_rate', metric_type: 'gauge', help: 'Broker 请求速率', unit: '', labels: ['instance', 'request'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_request_duration_seconds', metric_type: 'histogram', help: '请求耗时分布', unit: 's', labels: ['instance', 'request'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_request_size_bytes', metric_type: 'histogram', help: '请求大小分布', unit: 'bytes', labels: ['instance', 'request'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_response_rate', metric_type: 'gauge', help: 'Broker 响应速率', unit: '', labels: ['instance', 'request'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_network_io_total', metric_type: 'counter', help: '网络 I/O 总量', unit: 'bytes', labels: ['instance', 'name'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_network_io_rate', metric_type: 'gauge', help: '网络 I/O 速率', unit: 'bytes/s', labels: ['instance', 'name'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_log_log_size_sum', metric_type: 'gauge', help: 'Log 总大小', unit: 'bytes', labels: ['instance', 'topic'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_log_log_end_offset', metric_type: 'gauge', help: 'Log end offset', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_log_log_start_offset', metric_type: 'gauge', help: 'Log start offset', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_controller_active_count', metric_type: 'gauge', help: '活跃 Controller 数', unit: '', labels: ['instance'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_purgatory_size', metric_type: 'gauge', help: 'Purgatory 大小', unit: '', labels: ['instance', 'delayedOperation'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_isr_shrink_total', metric_type: 'counter', help: 'ISR 收缩总数', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_isr_expand_total', metric_type: 'counter', help: 'ISR 扩展总数', unit: '', labels: ['instance', 'topic', 'partition'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
  { metric_name: 'kafka_exporter_build_info', metric_type: 'gauge', help: 'Exporter 构建信息', unit: '', labels: ['instance', 'version'], exporter_template_id: 'et-kafka', is_builtin: true, enabled: true },
]

const blackboxMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'probe_success', metric_type: 'gauge', help: '拨测是否成功', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_duration_seconds', metric_type: 'gauge', help: '拨测耗时', unit: 's', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_http_status_code', metric_type: 'gauge', help: 'HTTP 拨测返回状态码', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_http_duration_seconds', metric_type: 'gauge', help: 'HTTP 拨测各阶段耗时', unit: 's', labels: ['instance', 'job', 'module', 'phase'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_http_ssl', metric_type: 'gauge', help: 'HTTP 拨测是否使用 SSL', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_http_redirects', metric_type: 'gauge', help: 'HTTP 拨测重定向次数', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_tcp_connection_established_seconds', metric_type: 'gauge', help: 'TCP 连接建立耗时', unit: 's', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_tls_earliest_cert_expiry', metric_type: 'gauge', help: 'TLS 证书最早过期时间', unit: 's', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_ssl_earliest_cert_expiry', metric_type: 'gauge', help: 'SSL 证书最早过期时间', unit: 's', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_dns_lookup_time_seconds', metric_type: 'gauge', help: 'DNS 查询耗时', unit: 's', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_dns_answer_rrs', metric_type: 'gauge', help: 'DNS 回答记录数', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_dns_authority_rrs', metric_type: 'gauge', help: 'DNS 权威记录数', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_icmp_duration_seconds', metric_type: 'gauge', help: 'ICMP 拨测各阶段耗时', unit: 's', labels: ['instance', 'job', 'module', 'phase'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_icmp_reply_hop_limit', metric_type: 'gauge', help: 'ICMP 回复跳数限制', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
  { metric_name: 'probe_failed_due_to_regex', metric_type: 'gauge', help: '是否因正则匹配失败', unit: '', labels: ['instance', 'job', 'module'], exporter_template_id: 'et-blackbox', is_builtin: true, enabled: true },
]

const appMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'app_http_requests_total', metric_type: 'counter', help: 'HTTP 请求总数', unit: '', labels: ['status', 'path', 'app'], exporter_template_id: 'et-app', is_builtin: true, enabled: true },
  { metric_name: 'app_http_request_duration_seconds', metric_type: 'histogram', help: 'HTTP 请求耗时分布', unit: 's', labels: ['status', 'path', 'app'], exporter_template_id: 'et-app', is_builtin: true, enabled: true },
  { metric_name: 'app_business_orders_total', metric_type: 'counter', help: '业务订单总数（用户扩展示例）', unit: '', labels: ['app', 'region'], exporter_template_id: 'et-app', is_builtin: false, enabled: true },
]

const snmpMetrics: Omit<MetricLibraryItem, 'metric_id'>[] = [
  { metric_name: 'snmp_ifInOctets', metric_type: 'counter', help: '接口入流量', unit: 'bytes', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifOutOctets', metric_type: 'counter', help: '接口出流量', unit: 'bytes', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifInUcastPkts', metric_type: 'counter', help: '接口单播入包数', unit: '', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifOutUcastPkts', metric_type: 'counter', help: '接口单播出包数', unit: '', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifOperStatus', metric_type: 'gauge', help: '接口操作状态', unit: '', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifAdminStatus', metric_type: 'gauge', help: '接口管理状态', unit: '', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifHighSpeed', metric_type: 'gauge', help: '接口速率', unit: 'Mbps', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
  { metric_name: 'snmp_ifMtu', metric_type: 'gauge', help: '接口 MTU', unit: '', labels: ['ifIndex', 'instance'], exporter_template_id: 'et-snmp', is_builtin: true, enabled: true },
]

let metricIdCounter = 1
const withIds = (items: Omit<MetricLibraryItem, 'metric_id'>[]): MetricLibraryItem[] =>
  items.map((item) => ({ ...item, metric_id: `m-${String(metricIdCounter++).padStart(3, '0')}` }))

export const mockMetricLibrary: MetricLibraryItem[] = [
  ...withIds(nodeMetrics),
  ...withIds(mysqlMetrics),
  ...withIds(redisMetrics),
  ...withIds(kafkaMetrics),
  ...withIds(blackboxMetrics),
  ...withIds(appMetrics),
  ...withIds(snmpMetrics),
]

/**
 * 指标库运行时共享容器（模块级单例，刷新页面后随 mock 重置）：
 * MetricLibraryPage 的增删改同步写入该容器，RulesPage 的 PromQL 校验与指标预览实时读取，
 * 演示「必须先有指标库才能编写 PromQL」的依赖关系（PRD 决策 5）。
 */
export const metricLibraryStore: MetricLibraryItem[] = [...mockMetricLibrary]

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
  // {v3.2} nginx 实例：配合 map-006（无标签模板）演示「Job 标签待配置」链路
  { resource_id: 'res-mw-004', resource_type: 'nginx', instance_name: 'nginx-edge-01', hostname: 'nginx-edge-01.mw', instance_ip: '10.0.2.41', network_domain_id: 'default', env: 'prod', app_name: 'gateway-nginx', cluster: 'cluster-prod', status: 'online' },
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
