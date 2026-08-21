export type ResourceType = 'host' | 'middleware' | 'application'

export interface Host {
  id: number
  resource_type: 'host'
  cloud_code: string
  app_code: string
  sub_app_code: string
  env_flag: 'SIT' | 'PRD'
  server_id: string
  instance_name: string
  status: string
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
  created_at: string
  updated_at: string
  expired_at?: string
  deleted_at?: string
}

export interface Middleware {
  id: number
  resource_id: string
  resource_type: 'middleware'
  app_name: string
  env: string
  cluster: string
  owner: string
  status: string
  middleware_type: string
  instance_ip: string
  port: number
  version: string
  connection_string: string
  created_at: string
  updated_at: string
  deleted_at?: string
}

export interface Application {
  id: number
  resource_id: string
  resource_type: 'application'
  app_name: string
  env: string
  cluster: string
  owner: string
  status: string
  service_name: string
  health_check_url: string
  protocol: string
  endpoint: string
  port: number
  created_at: string
  updated_at: string
  deleted_at?: string
}

export type Resource = Host | Middleware | Application
