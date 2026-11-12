/**
 * 域对象领域类型：ZoneType / NetworkDomain / Tenant
 *
 * 与 Module_06 §5（行政）和 Module_09 §5（纳管）对齐。
 * v3 只创建采集节点域（edge）；`collection` 仅读兼容（D16）。
 */

/** 网域类型：采集节点域 / 历史采集域（只读兼容） */
export type DomainType = 'edge' | 'collection'

/** 网域行政状态 */
export type DomainStatus = 'enabled' | 'disabled'

/** 配置下发通道（v3 固定 agent_pull） */
export type ChannelType = 'local' | 'agent_pull'

/** 边缘采集器类型 */
export type AgentType = 'vmagent' | 'prometheus-agent'

/** 网域注册态（M09 v3 契约 §2.1） */
export type RegistrationStatus = 'created' | 'monitored' | 'retired'

/** 区域类型字典（部署级只读；v3 返回 code/display_name/enabled） */
export interface ZoneType {
  id?: number
  code: string
  display_name: string
  description?: string
  enabled: boolean
  created_at?: string
  updated_at?: string
  deleted_at?: string
}

/**
 * M09 v3 网域 enriched 视图（行政字段 + 运行态，D34）。
 * 列表/详情共用；运行时字段只读。
 */
export interface OnboardingNetworkDomain {
  network_domain_id: string
  name: string
  description: string
  domain_type: DomainType
  domain_type_label: string
  tenant_id: string
  authorized_tenant_ids: string[]
  status: DomainStatus
  cloud_code: string
  zone_type: string
  registration_status: RegistrationStatus
  monitored_at: string | null
  token_masked: string
  agent_count: number
  online_agent_count: number
  last_heartbeat_at: string | null
  last_config_version: string
  center_endpoint: string
  remote_write_url: string
  created_at: string
  updated_at: string
}

/**
 * 网域页面模型（v3 行政字段 + 由 M09 enriched 视图派生的运行态）。
 */
export interface NetworkDomain {
  id: string
  name: string
  description: string
  domain_type: DomainType
  /**
   * 云归属（M06 §5.2，必填）：`cloud_code` 是云归属的**唯一事实来源**，
   * 取值须为云字典（M07 §5.20）启用条目；资源的 `cloud` label 经所属网域派生注入。
   */
  cloud_code?: string
  zone_type: string
  tenant_id: string
  authorized_tenant_ids: string[]
  // M09 纳管监控字段（由 enriched 视图派生，只读）
  channel: ChannelType
  token_masked?: string
  agent_type?: AgentType
  /** {v0.4+} 网闸映射场景预留，当前实现不消费 */
  center_endpoint?: string
  remote_write_url?: string
  monitored_status?: 'normal' | 'partial' | 'offline' | 'unknown'
  last_heartbeat?: string
  agent_version?: string
  is_monitored: boolean
  /** M06 R2：是否存在 online 状态 EdgeAgent（由 online_agent_count 派生） */
  has_online_agents?: boolean
  /** M06 R2：接入进度四态（1 已登记 / 2 已纳管 / 3 采集节点已上线 / 4 已出数据），由后端聚合派生 */
  access_step?: number
  /** v3 注册态（created / monitored / retired） */
  registration_status?: RegistrationStatus
  monitored_at?: string | null
  agent_count?: number
  online_agent_count?: number
  last_config_version?: string
  status: DomainStatus
  created_at: string
  updated_at: string
  deleted_at?: string
}

/**
 * 禁用网域返回的影响范围（该网域下 M07 资源数 / 已纳管 EdgeAgent 数）。
 * v3 ImpactResponse：含样本资源与监控退场可用性。
 */
export interface NetworkDomainImpact {
  resource_count: number
  managed_edge_agent_count: number
  /** 存在 online 状态 Agent（供前端判断是否展示「行政冻结」补强提示） */
  has_online_agents?: boolean
  /** M09 是否已将真实 MonitoringRetirer 全量接入（MVP 可能为 false） */
  monitoring_available?: boolean
  sample_resources?: Array<{
    resource_id: string
    resource_category: string
    name: string
  }>
}

/**
 * 删除网域时返回的级联影响清单（v3 复用 ImpactResponse）。
 */
export type CascadeImpact = NetworkDomainImpact

/**
 * 删除网域响应结构（v3 契约 §3.2）。
 */
export interface NetworkDomainDeleteResult {
  id: string
  deleted: boolean
  impact: NetworkDomainImpact
  cascade_impact: NetworkDomainImpact
}

/**
 * PATCH /api/v3/platform/network-domains/:id/status 的响应 data 结构。
 */
export interface NetworkDomainStatusResult {
  id?: string
  status?: DomainStatus
  impact?: NetworkDomainImpact
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
