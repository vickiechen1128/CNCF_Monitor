/**
 * 资源领域类型
 *
 * 与 Module_07 §5 数据模型对齐。Phase 0 引入五类权威枚举 `ResourceCategory`
 * （host / database / middleware / application / generic_target），
 * `ResourceType` 保留为过渡别名（resource_type 字段仍用于向后兼容）。
 */

/** 五类资源权威枚举（Phase 0） */
export type ResourceCategory = 'host' | 'database' | 'middleware' | 'application' | 'generic_target'

/** 过渡别名，与后端 resource_type 字段一致（保留兼容） */
export type ResourceType = ResourceCategory

/** 共享基座字段（ResourceBase），五类资源共同承载 */
export interface ResourceBaseShape {
  id: number
  resource_id: string
  tenant_id: string
  resource_type: ResourceType
  resource_category: ResourceCategory
  network_domain_id: string
  biz_code: string
  env: string
  owner: string
  status: string
  created_at: string
  updated_at: string
  deleted_at?: string
}

export interface Host extends ResourceBaseShape {
  resource_type: 'host'
  resource_category: 'host'
  cloud_code: string
  app_code: string
  sub_app_code: string
  env_flag: 'SIT' | 'PRD'
  server_id: string
  instance_name: string
  cluster: string
  region: string
  zone_env: 'INT' | 'GOV'
  instance_spec: string
  vcpu: number
  memory_gb: number
  image: string
  system_disk_gb: number
  data_disk_gb: number
  public_ip: string
  bandwidth: number
  private_subnet: string
  private_ip: string
  purpose: string
  vpc: string
  security_group: string
  expired_at?: string
}

export interface Database extends ResourceBaseShape {
  resource_type: 'database'
  resource_category: 'database'
  app_name: string | null
  cluster: string | null
  source_type: 'manual' | 'import' | 'cmdb'
  database_type: string
  instance_ip: string
  port: number
  version: string
  connection_string: string
}

export interface Middleware extends ResourceBaseShape {
  resource_type: 'middleware'
  resource_category: 'middleware'
  app_name: string
  cluster: string
  middleware_type: string
  instance_ip: string
  port: number
  version: string
  connection_string: string
}

export interface Application extends ResourceBaseShape {
  resource_type: 'application'
  resource_category: 'application'
  app_name: string
  cluster: string
  service_name: string
  health_check_url: string
  protocol: string
  endpoint: string
  port: number
}

export interface GenericTarget extends ResourceBaseShape {
  resource_type: 'generic_target'
  resource_category: 'generic_target'
  app_name: string | null
  cluster: string | null
  source_type: 'manual' | 'import' | 'cmdb'
  target_name: string
  instance_ip: string
  port: number
  metrics_path: string
  scheme: string
  exporter_type: string
  custom_labels: Record<string, string>
}

export type Resource = Host | Database | Middleware | Application | GenericTarget

/**
 * 资源写请求 / 导入 / 业务字典 / 标签相关类型（T07-F1）
 *
 * 与 Module_07 §5.2/§5.3/§5.16/§6.2/§6.4 对齐。
 */

/** 资源运行状态（§5.2 / §8.1，UI 展示名「运行状态」） */
export type ResourceStatus = 'online' | 'offline' | 'maintenance'

/** 资源创建公共字段（resource_category 创建必传，§5.2；biz_code 全类型必填） */
export interface ResourceCreateBaseShape {
  resource_category: ResourceCategory
  network_domain_id: string
  biz_code: string
  app_name?: string
  env: string
  cluster?: string
  owner?: string
  status?: ResourceStatus
}

/** 主机差异化字段（§5.6） */
export interface HostResourceFields {
  instance_name: string
  hostname?: string
  instance_ip: string
  os_type?: string
}

/** 数据库差异化字段（§5.7.1） */
export interface DatabaseResourceFields {
  database_type: string
  instance_ip: string
  port: number
  version?: string
}

/** 中间件差异化字段（§5.7） */
export interface MiddlewareResourceFields {
  middleware_type: string
  instance_ip: string
  port: number
  version?: string
}

/** 应用服务差异化字段（§5.8） */
export interface ApplicationResourceFields {
  service_name: string
  endpoint: string
  health_check_url?: string
  protocol?: string
  port?: number
}

/** 通用指标目标差异化字段（§5.9） */
export interface GenericTargetResourceFields {
  target_name: string
  instance_ip: string
  port?: number
  metrics_path?: string
  scheme?: string
  exporter_type?: string
  custom_labels?: Record<string, string>
}

/** 资源创建输入（按 resource_category 判别联合；biz_code 必填，resource_category 创建必传） */
export type ResourceCreateInput =
  | ({ resource_category: 'host' } & ResourceCreateBaseShape & HostResourceFields)
  | ({ resource_category: 'database' } & ResourceCreateBaseShape & DatabaseResourceFields)
  | ({ resource_category: 'middleware' } & ResourceCreateBaseShape & MiddlewareResourceFields)
  | ({ resource_category: 'application' } & ResourceCreateBaseShape & ApplicationResourceFields)
  | ({ resource_category: 'generic_target' } & ResourceCreateBaseShape & GenericTargetResourceFields)

/** 资源更新公共字段（resource_category/source_type 创建后不可改，不随请求体，§6.1/T07-06） */
export interface ResourceUpdateBaseShape {
  network_domain_id?: string
  biz_code?: string
  app_name?: string
  env?: string
  cluster?: string
  owner?: string
  status?: ResourceStatus
}

/** 资源更新输入（各类型差异化字段均可选，按类型部分更新） */
export type ResourceUpdateInput =
  | (ResourceUpdateBaseShape & Partial<HostResourceFields>)
  | (ResourceUpdateBaseShape & Partial<DatabaseResourceFields>)
  | (ResourceUpdateBaseShape & Partial<MiddlewareResourceFields>)
  | (ResourceUpdateBaseShape & Partial<ApplicationResourceFields>)
  | (ResourceUpdateBaseShape & Partial<GenericTargetResourceFields>)

/** 业务分组字典条目（§3.1 / T07-02，MVP 只读接口） */
export interface BusinessDomain {
  code: string
  name: string
  description?: string
  enabled: boolean
}

/** 操作系统内置字典条目（os_dict.go，GET /api/v2/platform/os-options）：规范名 + 家族 */
export interface OSOption {
  name: string
  /** 监控家族：linux / windows（对齐 host_linux / host_windows） */
  family: 'linux' | 'windows'
}

/** 资源标签来源（§5.3 / §8.2） */
export type ResourceLabelSource = 'system' | 'user' | 'cmdb'

/** 资源标签项（§5.3 / §6.2，GET /resources/:resource_id/labels 返回 {items,total}） */
export interface ResourceLabelItem {
  id: number
  key: string
  value: string
  source: ResourceLabelSource
  /** system 标签来源映射标注，如 "app_name→app"（§5.3 联动呈现） */
  source_map?: string
}

/** 导入错误行（§5.16.3） */
export interface ImportError {
  row: number
  resource_category: ResourceCategory
  field: string
  value?: string
  reason: string
}

/** Excel 导入结果（§5.16.3；upsert 含 updated，create_only 无 updated） */
export interface ImportResult {
  total: number
  success: number
  updated?: number
  failed: number
  errors: ImportError[]
}

/** 导入模式（§6.1 / T07-10） */
export type ImportMode = 'create_only' | 'upsert'

/** 导入记录（§6.4 / T07-10，status: success / partial / failed） */
export interface ImportRecord {
  id: number
  import_no: string
  resource_category: ResourceCategory
  mode: ImportMode
  total: number
  success: number
  updated: number
  failed: number
  status: 'success' | 'partial' | 'failed'
  errors: ImportError[]
  operator: string
  created_at: string
}