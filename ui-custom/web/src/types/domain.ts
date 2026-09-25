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
  /** M06 R2：网段（CIDR），资源导入时按 IP 自动推导网域归属；可留空 */
  ip_cidrs?: string[]
  // M09 纳管监控字段
  channel: ChannelType
  token?: string
  agent_type?: AgentType
  center_endpoint?: string
  remote_write_url?: string
  monitored_status?: 'normal' | 'partial' | 'offline' | 'unknown'
  last_heartbeat?: string
  agent_version?: string
  is_monitored: boolean
  /** M06 R2：是否存在 online 状态 EdgeAgent（决策 82-2；`has_online_agents` 仅基于 online 状态判断） */
  has_online_agents?: boolean
  /** M06 R2：接入进度四态（1 已登记 / 2 已纳管 / 3 采集节点已上线 / 4 已出数据），由后端聚合派生 */
  access_step?: number
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
  /** 决策 82-2：是否存在在线 Agent（供前端判断是否展示「行政冻结」补强提示） */
  has_online_agents?: boolean
}

/**
 * 决策 82-1：删除网域时返回的级联影响清单。
 * 已纳管场景（edge_agent_count > 0）时展示级联清退详情。
 * 契约对齐：docs/05-execution-records/module-06/api-contract-snapshot.md §5.1.2。
 */
export interface CascadeImpact {
  /** 将退场的采集节点总数 */
  edge_agent_count: number
  /** 将退场的 Agent 列表（最多展示 10 条，超出省略） */
  will_retire_agents: Array<{
    id: string
    hostname: string
    status: string
  }>
}

/**
 * 决策 82-1：DELETE /network-domains/:id 响应结构。
 * 契约对齐：docs/05-execution-records/module-06/api-contract-snapshot.md §5.1.2。
 * 无顶层 `deleted`、`cascade_retired` 字段。
 */
export interface NetworkDomainDeleteResult {
  id: string
  cascade_impact: CascadeImpact
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
  /** 决策 82-2：平铺时也可能直接返回是否存在在线 Agent（仅在未嵌套 impact 时采信） */
  has_online_agents?: boolean
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
