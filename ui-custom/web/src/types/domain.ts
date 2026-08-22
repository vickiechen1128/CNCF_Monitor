/**
 * 域对象领域类型：ZoneType / NetworkDomain / Tenant
 *
 * 与 Module_06 §5（行政）和 Module_09 §5（纳管）对齐。
 */

/** 网域类型：管理域 / 边缘域 */
export type DomainType = 'management' | 'edge'

/** 网域行政状态 */
export type DomainStatus = 'enabled' | 'disabled'

/** 配置下发通道 */
export type ChannelType = 'local' | 'agent_pull'

/** 边缘采集器类型 */
export type AgentType = 'vmagent' | 'prometheus-agent'

/** 区域类型字典（部署级只读） */
export interface ZoneType {
  id: number
  code: string
  display_name: string
  description: string
  enabled: boolean
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** 网域（M06 行政字段 + M09 纳管字段同表） */
export interface NetworkDomain {
  id: string
  name: string
  description: string
  domain_type: DomainType
  zone_type: string
  tenant_id: string
  authorized_tenant_ids: string[]
  cmdb_cloud_area_id: string
  cmdb_cloud_area_path: string
  // M09 纳管监控字段
  channel: ChannelType
  token?: string
  agent_type?: AgentType
  center_endpoint?: string
  remote_write_url?: string
  monitored_status?: 'online' | 'offline' | 'unknown'
  last_heartbeat?: string
  agent_version?: string
  is_monitored: boolean
  status: DomainStatus
  created_at: string
  updated_at: string
  deleted_at?: string
}

/**
 * 禁用网域返回的影响范围（该网域下 M07 资源数 / 已纳管 EdgeAgent 数）。
 * Module_06 §6.2/§9.2——禁用 = 冻结，禁用时后端在响应中返回影响范围供前端二次确认弹窗展示。
 */
export interface NetworkDomainImpact {
  resource_count: number
  managed_edge_agent_count: number
  /** 兼容别名：后端可能以 `edge_agent_count` 命名已纳管 EdgeAgent 数（review 阶段按后端汇报对齐）。 */
  edge_agent_count?: number
}

/**
 * PATCH /api/v2/platform/network-domains/:id/status 的响应 data 结构。
 * 契约兼容：禁用的影响范围可能嵌套在 `data.impact`，或直接平铺在 `data.{resource_count,...}`。
 */
export interface NetworkDomainStatusResult {
  id?: string
  status?: DomainStatus
  impact?: NetworkDomainImpact
  resource_count?: number
  managed_edge_agent_count?: number
  edge_agent_count?: number
}

/** 租户生命周期状态 */
export type TenantStatus = 'active' | 'suspended' | 'disabled'

/** 租户 */
export interface Tenant {
  id: string
  name: string
  network_domain_ids: string[]
  multi_site_enabled: boolean
  is_platform_admin: boolean
  status: TenantStatus
  created_at: string
  updated_at: string
  deleted_at?: string
}
