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