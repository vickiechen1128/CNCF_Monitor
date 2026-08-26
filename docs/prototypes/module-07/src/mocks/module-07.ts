// ============================================================
// Module_07 监控对象管理 - 数据模型与 mock 数据
// 对齐 PRD v2.20（Module_07_Monitoring_Object_Management.md）
// 决策 13/14/17/19/21/22：业务分组字典 + biz_code 全资源必填（biz 标签只承载不可变编码），展示取 biz_name；强制预置兜底条目 infra
// 决策 31-M1：is_monitored 由 M01 维护、M07 只读映射（原「已监控/未监控」列恢复为只读采集状态，MVP 资源列表仅按 is_monitored 筛选，M07 不计算）
// 决策 29：offline 资源下一配置生成周期即从 targets/*.json 移除、不触发采集器 reload（批量下线动线为真，见 STATUS_MAPPING 注释）
// ============================================================

// ---------- 基础枚举 ----------
// PRD 5.1：五大类资源类别（{v2.13} 由四大类拆分，新增 database，决策 D19；{v2.14} 字段更名 resource_category，决策 D24）
export type ResourceCategory = 'host' | 'database' | 'middleware' | 'application' | 'generic_target'
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
// PRD 5.5.3：状态映射规则适用的资源类别；'all' 表示通用
export type StatusMappingResourceCategory = ResourceCategory | 'all'

// ---------- 资源基础结构（PRD 5.2） ----------
export interface ResourceBase {
  resource_id: string
  // {v2.14} 粗粒度资源类别（原 resource_type 更名，决策 D24）
  resource_category: ResourceCategory
  network_domain_id: string
  source_type: SourceType
  instance_name?: string
  hostname?: string
  instance_ip?: string
  os_type?: string
  // {v2.8} 业务类型/业务域归属（如 payment / data-api）；任意资源类别可挂，MVP 以 application 维护；映射为 `biz` label
  biz_code?: string
  app_name?: string
  env?: Env
  cluster?: string
  owner?: string
  status: ResourceStatus
  // {v2.20} 决策 31-M1：是否被任意采集 Job 纳入监控。由 Module_01（监控策略）维护、M07 只读映射，M07 不据此计算/不写回。
  // 资源列表「未监控」筛选即依据此字段；注：is_monitored=false 不代表 status=offline，两者独立。
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
  resource_category: 'host'
  hostname: string
  instance_ip: string
  os_type?: string
  os_version?: string
}

// ---------- 数据库资源（PRD 5.7.1，{v2.13} 新增，决策 D19） ----------
export interface DatabaseResource extends ResourceBase {
  resource_category: 'database'
  database_type: string
  instance_ip: string
  port: number
  version?: string
  connection_string?: string
}

// ---------- 中间件资源（PRD 5.7） ----------
export interface MiddlewareResource extends ResourceBase {
  resource_category: 'middleware'
  middleware_type: string
  instance_ip: string
  port: number
  version?: string
  connection_string?: string
}

// ---------- 应用服务资源（PRD 5.8） ----------
export interface ApplicationResource extends ResourceBase {
  resource_category: 'application'
  service_name: string
  health_check_url?: string
  protocol?: AppProtocol
  endpoint?: string
  port?: number
}

// ---------- 通用指标目标（PRD 5.9） ----------
export interface GenericTargetResource extends ResourceBase {
  resource_category: 'generic_target'
  target_name: string
  instance_ip: string
  port?: number
  metrics_path?: string
  scheme?: TargetScheme
  custom_labels?: string
  exporter_type?: string
}

export type Resource = HostResource | DatabaseResource | MiddlewareResource | ApplicationResource | GenericTargetResource

// ---------- 类型守卫 ----------
export function isHostResource(r: Resource): r is HostResource {
  return r.resource_category === 'host'
}
export function isDatabaseResource(r: Resource): r is DatabaseResource {
  return r.resource_category === 'database'
}
export function isMiddlewareResource(r: Resource): r is MiddlewareResource {
  return r.resource_category === 'middleware'
}
export function isApplicationResource(r: Resource): r is ApplicationResource {
  return r.resource_category === 'application'
}
export function isGenericTargetResource(r: Resource): r is GenericTargetResource {
  return r.resource_category === 'generic_target'
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

// ---------- 业务分组字典（PRD 5.2 / 决策 13/14/17） ----------
// MVP 由配置文件预置，只读，不提供维护页面；v0.2+ 评估维护入口（code 不可变、停用不删除）
export interface BusinessDomain {
  /** 业务编码，进 biz 标签，创建后不可变 */
  biz_code: string
  /** 展示名，可改，不影响监控配置；UI 一律展示 biz_name */
  biz_name: string
  description?: string
  /** enabled = 启用（可被资源引用）；disabled = 停用（仅可改展示名，不可删除） */
  status: 'enabled' | 'disabled'
}

export const mockBusinessDomains: BusinessDomain[] = [
  { biz_code: 'order', biz_name: '订单业务', description: '订单服务相关资源', status: 'enabled' },
  { biz_code: 'payment', biz_name: '支付业务', description: '支付 / 资金相关资源', status: 'enabled' },
  { biz_code: 'infra', biz_name: '基础设施', description: '公共基础设施资源（INF 兜底，设备类无业务归属资源挂此）', status: 'enabled' },
  { biz_code: 'data-api', biz_name: '数据接口', description: '数据接口服务资源', status: 'enabled' },
  { biz_code: 'retired-biz', biz_name: '已下线业务', description: '停用中，不可再被资源引用', status: 'disabled' },
  // 注：settlement / after-sale 等未登记编码刻意不预置，用于演示「业务未登记 → 引导联系平台管理员」误导入场景（§5.16.1/§11.2）
]

/** 业务字典展示名解析：code → biz_name；未登记或空值返回 code 本身或 '-' */
export function resolveBizName(code?: string): string {
  if (!code) return '-'
  return mockBusinessDomains.find((d) => d.biz_code === code)?.biz_name || code
}

/** 业务字典条目是否停用（disabled）：停用业务不可再被资源引用，但存量资源保留历史值 */
export function isBizDisabled(code?: string): boolean {
  if (!code) return false
  return mockBusinessDomains.find((d) => d.biz_code === code)?.status === 'disabled'
}

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
  resource_category: ResourceCategory
  is_default: boolean
  mappings: Mapping[]
  created_at: string
  updated_at: string
}

// ---------- Excel 导入（PRD 7.3） ----------
export interface ImportError {
  row: number
  resource_category: ResourceCategory
  field: string
  value: string
  reason: string
}

export interface ImportHistory {
  import_id: string
  filename: string
  resource_category: ResourceCategory
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
  resource_category: StatusMappingResourceCategory
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
  listResources(resourceType: ResourceCategory, networkDomainID: string): Resource[]
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
// {v2.13} 五大类资源类别（决策 D19）
export const RESOURCE_TYPES: ResourceCategory[] = ['host', 'database', 'middleware', 'application', 'generic_target']
export const ENV_VALUES: Env[] = ['dev', 'test', 'staging', 'prod']
/** {v2.2+} 操作系统内置字典（AutoComplete 可搜索/自定义，对应后端 /api/v2/platform/os-options）：规范名 → 家族，host 必填 */
export const OS_OPTIONS: { label: string; value: string }[] = [
  { label: 'Ubuntu', value: 'Ubuntu' },
  { label: 'CentOS', value: 'CentOS' },
  { label: 'RedHat Enterprise Linux', value: 'RedHat' },
  { label: 'openEuler', value: 'openEuler' },
  { label: 'Kylin', value: 'Kylin' },
  { label: 'Debian', value: 'Debian' },
  { label: 'AIX', value: 'AIX' },
  { label: 'Solaris', value: 'Solaris' },
  { label: 'Windows Server', value: 'Windows Server' },
  { label: 'Windows 10', value: 'Windows 10' },
  { label: 'Windows 11', value: 'Windows 11' },
]
/** MVP 可选状态；orphan 为 v0.4+ 预留，不在表单选项中展示 */
export const STATUS_VALUES: ResourceStatus[] = ['online', 'offline', 'maintenance']
/** 全部状态（含 v0.4+ orphan），用于只读展示与测试 */
export const ALL_STATUS_VALUES: ResourceStatus[] = ['online', 'offline', 'maintenance', 'orphan']
// {v2.13} 子类型拆分（决策 D19）：数据库产品线用 database_type，中间件不再承载数据库
export const DATABASE_TYPE_OPTIONS = ['mysql', 'redis', 'mongodb', 'dm8', 'postgresql', 'oracle', 'sqlserver']
export const MIDDLEWARE_TYPE_OPTIONS = ['kafka', 'elasticsearch', 'nginx', 'rabbitmq', 'zookeeper']
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

/** Excel 状态映射字典（PRD 5.5.1）
 * {v2.20} 决策 29 说明：目标状态 offline 后，Module_09 下一配置生成周期即把它从 targets/*.json 移除、
 * 不触发采集器 reload（批量下线动线为真）；本模块仅维护 Resource.status，采集生效由配置中心消费。 */
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
    { id: 'sm-01', source_status: '运行中|正常|online|running', target_status: 'online', resource_category: 'host', priority: 100, is_builtin: true, enabled: true, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { id: 'sm-02', source_status: '已停止|停止|offline|stopped', target_status: 'offline', resource_category: 'host', priority: 100, is_builtin: true, enabled: true, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
    { id: 'sm-03', source_status: '维护中|维修中|maintenance', target_status: 'maintenance', resource_category: 'all', priority: 90, is_builtin: true, enabled: true, created_at: '2026-07-01 10:00:00', updated_at: '2026-07-01 10:00:00' },
  ],
}

/** 五大类资源固定列导入模板（PRD 5.16.1，含 network_domain / biz_code 列；{v2.17} 全资源类必填 biz_code） */
export const IMPORT_TEMPLATE_COLUMNS: Record<ResourceCategory, string[]> = {
  host: ['network_domain', 'instance_name', 'hostname', 'instance_ip', 'os_type', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'status'],
  database: ['network_domain', 'database_type', 'instance_ip', 'port', 'version', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'status'],
  middleware: ['network_domain', 'middleware_type', 'instance_ip', 'port', 'version', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'status'],
  application: ['network_domain', 'service_name', 'biz_code', 'health_check_url', 'protocol', 'endpoint', 'port', 'app_name', 'env', 'cluster', 'owner', 'status'],
  generic_target: ['network_domain', 'target_name', 'instance_ip', 'port', 'metrics_path', 'scheme', 'exporter_type', 'custom_labels', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'status'],
}

/** 标签模板映射：Resource 字段选项（PRD 5.12 A；{v2.13} 新增 database 键；{v2.17} 全资源类补 biz_code → biz） */
export const RESOURCE_FIELD_OPTIONS: Record<ResourceCategory, string[]> = {
  host: ['instance_name', 'hostname', 'instance_ip', 'os_type', 'os_version', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  database: ['instance_name', 'database_type', 'instance_ip', 'port', 'version', 'connection_string', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  middleware: ['instance_name', 'middleware_type', 'instance_ip', 'port', 'version', 'connection_string', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  application: ['instance_name', 'service_name', 'biz_code', 'health_check_url', 'protocol', 'endpoint', 'port', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
  generic_target: ['instance_name', 'target_name', 'instance_ip', 'port', 'metrics_path', 'scheme', 'exporter_type', 'custom_labels', 'biz_code', 'app_name', 'env', 'cluster', 'owner', 'network_domain_id'],
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

// {v2.14} 资源类别展示名（原 RESOURCE_TYPE_MAP 更名，决策 D24；{v2.13} 新增 database）
export const RESOURCE_TYPE_MAP: Record<ResourceCategory, string> = {
  host: '主机',
  database: '数据库',
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
    resource_category: 'host',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'prod-web-01',
    biz_code: 'infra',
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
    resource_category: 'host',
    network_domain_id: 'default',
    source_type: 'import',
    instance_name: 'prod-db-01',
    biz_code: 'order',
    hostname: 'prod-db-01.volc',
    instance_ip: '10.0.1.21',
    os_type: 'Linux',
    os_version: '7.9',
    app_name: '订单服务',
    env: 'prod',
    cluster: 'db-cluster-a',
    owner: '李四',
    status: 'online',
    is_monitored: false,
    created_at: '2026-07-02 09:00:00',
    updated_at: '2026-07-22 11:20:00',
  },
  {
    resource_id: 'res-host-003',
    resource_category: 'host',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'test-gateway-01',
    biz_code: 'infra',
    hostname: 'test-gateway-01.volc',
    instance_ip: '192.168.1.31',
    os_type: 'Linux',
    os_version: '8.6',
    app_name: '网关服务',
    env: 'test',
    cluster: 'gateway-cluster',
    owner: '王五',
    status: 'maintenance',
    is_monitored: true,
    created_at: '2026-07-03 14:00:00',
    updated_at: '2026-07-24 16:45:00',
  },
  // ----- database（PRD 5.7.1，{v2.13} 新增，决策 D19） -----
  {
    resource_id: 'res-db-001',
    resource_category: 'database',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'redis-cache-01',
    biz_code: 'infra',
    database_type: 'redis',
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
    resource_id: 'res-db-002',
    resource_category: 'database',
    network_domain_id: 'default',
    source_type: 'import',
    instance_name: 'mysql-order-01',
    biz_code: 'order',
    database_type: 'mysql',
    instance_ip: '10.0.2.12',
    port: 3306,
    version: '8.0',
    connection_string: 'mysql://order:****@10.0.2.12:3306/order',
    app_name: '订单库',
    env: 'prod',
    cluster: 'db-cluster-a',
    owner: '李四',
    status: 'online',
    is_monitored: true,
    created_at: '2026-07-05 11:00:00',
    updated_at: '2026-07-25 09:15:00',
  },
  {
    resource_id: 'res-db-003',
    resource_category: 'database',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'dm-master-01',
    biz_code: 'infra',
    database_type: 'dm8',
    instance_ip: '192.168.1.41',
    port: 5236,
    version: 'dm8',
    connection_string: 'dm://system:****@192.168.1.41:5236',
    app_name: '政务数据库',
    env: 'prod',
    cluster: 'dm-cluster',
    owner: '王五',
    status: 'online',
    is_monitored: false,
    created_at: '2026-07-06 09:00:00',
    updated_at: '2026-07-26 09:10:00',
  },
  // ----- middleware（PRD 5.7） -----
  {
    resource_id: 'res-mw-001',
    resource_category: 'middleware',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'kafka-01',
    biz_code: 'infra',
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
    is_monitored: false,
    created_at: '2026-07-06 10:00:00',
    updated_at: '2026-07-26 09:10:00',
  },
  {
    resource_id: 'res-mw-002',
    resource_category: 'middleware',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'nginx-gw-01',
    biz_code: 'infra',
    middleware_type: 'nginx',
    instance_ip: '10.0.2.22',
    port: 80,
    version: '1.24',
    connection_string: '10.0.2.22:80',
    app_name: '网关 Nginx',
    env: 'prod',
    cluster: 'gw-cluster',
    owner: '周八',
    status: 'online',
    is_monitored: true,
    created_at: '2026-07-07 10:00:00',
    updated_at: '2026-07-27 09:10:00',
  },
  // ----- application（PRD 5.8） -----
  {
    resource_id: 'res-app-001',
    resource_category: 'application',
    network_domain_id: 'default',
    source_type: 'manual',
    instance_name: 'order-service-v2',
    service_name: 'order-service',
    biz_code: 'order',
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
    resource_category: 'application',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'pay-service-v1',
    service_name: 'pay-service',
    biz_code: 'payment',
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
    resource_category: 'generic_target',
    network_domain_id: 'gov-cloud-a',
    source_type: 'import',
    instance_name: 'switch-core-01',
    biz_code: 'retired-biz',
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
    resource_category: 'generic_target',
    network_domain_id: 'gov-cloud-a',
    source_type: 'manual',
    instance_name: 'loadbalancer-02',
    biz_code: 'data-api',
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
    // {v2.8} 静态资源只读：user 来源标签为 Excel 带入（数据治理在 CMDB/Excel 侧），is_editable=false
    { label_id: 'l5', resource_id: 'res-host-001', label_key: 'team', label_value: 'sre', source: 'user', is_editable: false, created_at: '2026-07-05 14:00:00', updated_at: '2026-07-05 14:00:00' },
  ],
  'res-mw-001': [
    { label_id: 'l6', resource_id: 'res-mw-001', label_key: 'instance', label_value: '10.0.2.11:6379', source: 'system', is_editable: false, created_at: '2026-07-05 10:00:00', updated_at: '2026-07-05 10:00:00' },
    { label_id: 'l7', resource_id: 'res-mw-001', label_key: 'middleware', label_value: 'redis', source: 'user', is_editable: false, created_at: '2026-07-06 09:00:00', updated_at: '2026-07-06 09:00:00' },
    { label_id: 'l8', resource_id: 'res-mw-001', label_key: 'dc', label_value: '上海 A 区', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值', created_at: '2026-07-05 10:00:00', updated_at: '2026-07-15 08:00:00' },
    { label_id: 'l9', resource_id: 'res-mw-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-05 10:00:00', updated_at: '2026-07-15 08:00:00' },
  ],
  'res-app-001': [
    { label_id: 'l10', resource_id: 'res-app-001', label_key: 'service_name', label_value: 'order-service', source: 'system', is_editable: false, created_at: '2026-07-08 10:00:00', updated_at: '2026-07-08 10:00:00' },
    { label_id: 'l11', resource_id: 'res-app-001', label_key: 'cluster', label_value: 'k8s-prod', source: 'system', is_editable: false, created_at: '2026-07-08 10:00:00', updated_at: '2026-07-08 10:00:00' },
    { label_id: 'l12', resource_id: 'res-app-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-08 10:00:00', updated_at: '2026-07-15 08:00:00' },
    // {v2.8} biz 标签 = biz_code 字段由标签模板映射生成（system 来源，实时计算不落库；mock 静态展示）
    { label_id: 'l16', resource_id: 'res-app-001', label_key: 'biz', label_value: 'order', source: 'system', is_editable: false, created_at: '2026-07-08 10:00:00', updated_at: '2026-07-08 10:00:00' },
    // {v2.8} application 为业务类型资源：user 来源标签可编辑（is_editable=true），如业务维度标注「核心链路」
    { label_id: 'l17', resource_id: 'res-app-001', label_key: 'tier', label_value: 'core', source: 'user', is_editable: true, created_at: '2026-07-12 14:00:00', updated_at: '2026-07-12 14:00:00' },
  ],
  'res-gen-001': [
    { label_id: 'l13', resource_id: 'res-gen-001', label_key: 'instance', label_value: '172.16.0.1:9116', source: 'system', is_editable: false, created_at: '2026-07-10 10:00:00', updated_at: '2026-07-10 10:00:00' },
    { label_id: 'l14', resource_id: 'res-gen-001', label_key: 'device_type', label_value: 'snmp_switch', source: 'user', is_editable: false, created_at: '2026-07-11 09:00:00', updated_at: '2026-07-11 09:00:00' },
    { label_id: 'l15', resource_id: 'res-gen-001', label_key: 'env', label_value: 'prod', source: 'cmdb', is_editable: false, conflict_hint: 'CMDB 同步值，优先级最高', created_at: '2026-07-10 10:00:00', updated_at: '2026-07-15 08:00:00' },
  ],
}

// ---------- mock 标签模板（PRD 5.10 / 5.13） ----------
export const mockLabelTemplates: LabelTemplate[] = [
  // ----- host -----
  {
    template_id: 'tpl-host-default',
    name: '主机默认模板',
    resource_category: 'host',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-host-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-host-02', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-host-03', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-host-04', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-host-05', source_field: 'hostname', source_type: 'resource_field', target_label: 'hostname', enabled: true, transform: '' },
      { mapping_id: 'mp-host-06', source_field: 'instance_name', source_type: 'resource_field', target_label: 'instance_name', enabled: true, transform: '' },
      { mapping_id: 'mp-host-07', source_field: 'os_type', source_type: 'resource_field', target_label: 'os_type', enabled: true, transform: 'lower' },
      // {v2.17} 全资源类通用业务标签：biz_code → biz（决策 13/14/17）
      { mapping_id: 'mp-host-08', source_field: 'biz_code', source_type: 'resource_field', target_label: 'biz', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:00:00',
    updated_at: '2026-07-20 10:00:00',
  },
  // ----- middleware -----
  // ----- database（{v2.13} 新增，决策 D19/D18） -----
  {
    template_id: 'tpl-db-default',
    name: '数据库默认模板',
    resource_category: 'database',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-db-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-db-02', source_field: 'resource_id', source_type: 'resource_field', target_label: 'resource_id', enabled: true, transform: '' },
      { mapping_id: 'mp-db-03', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-db-04', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-db-05', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-db-06', source_field: 'database_type', source_type: 'resource_field', target_label: 'database_type', enabled: true, transform: '' },
      // {v2.17} 全资源类通用业务标签：biz_code → biz（决策 13/14/17）
      { mapping_id: 'mp-db-07', source_field: 'biz_code', source_type: 'resource_field', target_label: 'biz', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:05:00',
    updated_at: '2026-07-20 10:05:00',
  },
  {
    template_id: 'tpl-mw-default',
    name: '中间件默认模板',
    resource_category: 'middleware',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-mw-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-02', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-03', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-04', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-05', source_field: 'middleware_type', source_type: 'resource_field', target_label: 'middleware_type', enabled: true, transform: '' },
      // {v2.17} 全资源类通用业务标签：biz_code → biz（决策 13/14/17）
      { mapping_id: 'mp-mw-def-01', source_field: 'biz_code', source_type: 'resource_field', target_label: 'biz', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:10:00',
    updated_at: '2026-07-20 10:10:00',
  },
  {
    template_id: 'tpl-mw-redis-ha',
    name: 'Redis 高可用标签模板',
    // {v2.13} redis 归 database（决策 D19）
    resource_category: 'database',
    is_default: false,
    mappings: [
      { mapping_id: 'mp-mw-06', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-07', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-08', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-mw-09', source_field: 'database_type', source_type: 'resource_field', target_label: 'database_type', enabled: true, transform: '' },
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
    resource_category: 'application',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-app-01', source_field: 'service_name', source_type: 'resource_field', target_label: 'service_name', enabled: true, transform: '' },
      { mapping_id: 'mp-app-02', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-app-03', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-app-04', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-app-05', source_field: 'health_check_url', source_type: 'resource_field', target_label: 'health_check_url', enabled: true, transform: '' },
      // {v2.8} 业务类型归属：biz_code → biz（业务指标按业务类型聚合的关联键，见 PRD 5.12 A / 5.15）
      { mapping_id: 'mp-app-06', source_field: 'biz_code', source_type: 'resource_field', target_label: 'biz', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:20:00',
    updated_at: '2026-07-20 10:20:00',
  },
  // ----- generic_target -----
  {
    template_id: 'tpl-gen-default',
    name: '通用目标默认模板',
    resource_category: 'generic_target',
    is_default: true,
    mappings: [
      { mapping_id: 'mp-gen-01', source_field: 'instance_ip:port', source_type: 'composite', target_label: 'instance', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-02', source_field: 'target_name', source_type: 'resource_field', target_label: 'target_name', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-03', source_field: 'app_name', source_type: 'resource_field', target_label: 'app', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-04', source_field: 'env', source_type: 'resource_field', target_label: 'env', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-05', source_field: 'cluster', source_type: 'resource_field', target_label: 'cluster', enabled: true, transform: '' },
      { mapping_id: 'mp-gen-06', source_field: 'custom_labels.*', source_type: 'resource_field', target_label: 'custom_labels.*', enabled: true, transform: '' },
      // {v2.17} 全资源类通用业务标签：biz_code → biz（决策 13/14/17）
      { mapping_id: 'mp-gen-07', source_field: 'biz_code', source_type: 'resource_field', target_label: 'biz', enabled: true, transform: '' },
    ],
    created_at: '2026-07-20 10:30:00',
    updated_at: '2026-07-20 10:30:00',
  },
]

// ---------- 模板被引用 Job（PRD 6.3 {v2.7}，策略层消费方只读展示） ----------
// 引用关系由 Module_01 ScrapeJob.label_template_id 派生；本模块只读展示「被引用采集 Job N 个」
export interface TemplateReferencingJob {
  job_id: string
  job_name: string
  network_domain_id: string
  enabled: boolean
  /** 模板变更后的确认状态：pending = 模板已变更、待确认（v0.2+ 与 Module_09 变更单联动，MVP 演示「已变更」）；confirmed = 已确认 */
  change_status: 'pending' | 'confirmed'
}

// mock：演示「主机默认模板」刚被修改（引用 Job 显示待确认），其余模板已确认
export const mockTemplateReferencingJobs: TemplateReferencingJob[] = [
  { job_id: 'job-node-prod', job_name: 'prod-node-exporter', network_domain_id: 'default', enabled: true, change_status: 'pending' },
  { job_id: 'job-node-test', job_name: 'test-node-exporter', network_domain_id: 'gov-cloud-a', enabled: true, change_status: 'pending' },
  { job_id: 'job-redis-prod', job_name: 'prod-redis-exporter', network_domain_id: 'default', enabled: true, change_status: 'confirmed' },
  { job_id: 'job-kafka-prod', job_name: 'prod-kafka-exporter', network_domain_id: 'default', enabled: false, change_status: 'confirmed' },
  { job_id: 'job-redis-ha', job_name: 'prod-redis-ha-sentinel', network_domain_id: 'default', enabled: true, change_status: 'confirmed' },
  { job_id: 'job-app-order', job_name: 'prod-order-app', network_domain_id: 'default', enabled: true, change_status: 'confirmed' },
  { job_id: 'job-snmp-gov', job_name: 'gov-snmp-core', network_domain_id: 'gov-cloud-a', enabled: true, change_status: 'confirmed' },
]

/** 模板 → 引用 Job 的关联（按 template_id 索引，派生自 Module_01 策略层） */
export const TEMPLATE_REFERENCING_JOBS: Record<string, TemplateReferencingJob[]> = {
  'tpl-host-default': mockTemplateReferencingJobs.filter((j) => j.job_id.startsWith('job-node')),
  'tpl-mw-default': mockTemplateReferencingJobs.filter((j) => ['job-redis-prod', 'job-kafka-prod'].includes(j.job_id)),
  'tpl-mw-redis-ha': mockTemplateReferencingJobs.filter((j) => j.job_id === 'job-redis-ha'),
  'tpl-app-default': mockTemplateReferencingJobs.filter((j) => j.job_id === 'job-app-order'),
  'tpl-gen-default': mockTemplateReferencingJobs.filter((j) => j.job_id === 'job-snmp-gov'),
}

// ---------- mock 导入记录（PRD 7.3） ----------
export const mockImportHistory: ImportHistory[] = [
  {
    import_id: 'imp-001',
    filename: 'host_resources_20260725.xlsx',
    resource_category: 'host',
    total: 120,
    success: 118,
    failed: 2,
    status: 'partial',
    created_at: '2026-07-25 14:30:00',
    errors: [
      { row: 5, resource_category: 'host', field: 'instance_ip', value: '999.999.999.999', reason: 'IP 格式不正确' },
      { row: 12, resource_category: 'host', field: 'env', value: 'production', reason: 'env 必须是 dev/test/staging/prod 之一' },
    ],
  },
  {
    import_id: 'imp-002',
    filename: 'middleware_resources_20260726.xlsx',
    resource_category: 'middleware',
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
    resource_category: 'application',
    total: 80,
    success: 0,
    failed: 80,
    status: 'failed',
    created_at: '2026-07-28 11:00:00',
    errors: [
      { row: 3, resource_category: 'application', field: 'service_name', value: '', reason: '必填字段为空' },
      { row: 4, resource_category: 'application', field: 'biz_code', value: 'settlement', reason: '业务 settlement 未登记，请联系平台管理员在业务分组字典配置（platform/config/business_domains.yaml）中添加后重新导入' },
      { row: 8, resource_category: 'application', field: 'health_check_url', value: 'not-a-url', reason: 'URL 格式不正确' },
      { row: 11, resource_category: 'application', field: 'network_domain', value: 'edge-seattle', reason: '网域 edge-seattle 未登记，请先到「资源管理 → 业务分组」登记网域后重新导入（闭环到 Module_06）' },
      { row: 15, resource_category: 'application', field: 'protocol', value: 'grpc', reason: 'protocol 必须是 http/https/tcp 之一' },
    ],
  },
]

// ---------- 租户上下文（对齐 Module_01 / Module_09，演示单网域-多网域模式） ----------
export interface Tenant {
  id: string
  name: string
  /** 租户级多网域开关：false 时仅面向 default 管理域，网域选择固定 default */
  multi_site_enabled: boolean
}

/** 当前租户上下文：通过切换 multi_site_enabled 演示单网域/多网域模式差异 */
export const currentTenant: Tenant = {
  id: 'tenant-007',
  name: 'AIDC 运维租户',
  multi_site_enabled: true,
}

// ---------- 用户角色（动线分离演示：本模块按用户职责区分运维工程师1/2） ----------
export type UserRole = 'ops1' | 'ops2'
export const USER_ROLE_MAP: Record<UserRole, string> = {
  ops1: '运维工程师1',
  ops2: '运维工程师2',
}
