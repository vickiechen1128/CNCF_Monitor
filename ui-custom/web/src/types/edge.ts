/**
 * Module_11 边缘采集节点 类型定义（edge）。
 * 权威契约：docs/05-execution-records/module-11/api-contract-snapshot.md §1（第一权威），
 * 字段名与后端 DTO（platform/edge/management_service.go）对齐，全部 snake_case。
 */

/** 节点存活状态（存活视角，实时计算；partial 由采集器异常派生） */
export type AgentStatus = 'online' | 'offline' | 'unknown' | 'retired'

/** 列表整体聚合档（normal/partial/offline/unknown） */
export type AgentOverall = 'normal' | 'partial' | 'offline' | 'unknown'

/** 配置同步状态（五档） */
export type ConfigSyncStatus =
  | 'in_sync'
  | 'out_of_sync'
  | 'unknown'
  | 'manual_override'
  | 'no_version'

/**
 * out_of_sync 的成因（分档引导）。
 * apply_failed：已拉取最新配置但应用失败（已回滚至上一可用版本），展示为「同步失败」，
 * 与 pull_pending（等待拉取 →「同步中」）语义区分（M11 设计提案 D-2）。
 */
export type OutOfSyncCause = 'pending_draft' | 'pull_pending' | 'local_reset' | 'apply_failed'

/** 组件类型 */
export type EdgeComponentType = 'agent' | 'collector' | 'blackbox_exporter'

/** 组件守护状态 */
export type EdgeComponentStatus =
  | 'running'
  | 'restarting'
  | 'crash_loop'
  | 'not_deployed'
  | 'unknown'

/** 边缘组件运行态 + 守护扩展（对齐 models/edge_heartbeat.go EdgeComponent） */
export interface EdgeComponent {
  type: EdgeComponentType
  name: string
  status: EdgeComponentStatus
  version?: string
  config_version?: string
  last_error?: string
  restart_count?: number
  last_restart_at?: string
}

/** 边缘采集节点平铺 DTO（对齐 AgentView；queue_backlog_bytes 为 T11-21 改名后的字段） */
export interface AgentView {
  id: number
  network_domain_id: string
  hostname: string
  ip: string
  agent_type: string
  version: string
  status: AgentStatus
  last_heartbeat?: string
  heartbeat_rtt_ms?: number
  last_config_pull?: string
  config_version?: string
  config_sync_status?: ConfigSyncStatus
  out_of_sync_cause?: OutOfSyncCause
  /** 最近一次配置应用失败原因（与心跳契约 config_apply_error 同名同义；成功时清空） */
  config_apply_error?: string
  /** 应用失败的配置版本（用于抽屉展示「失败版本」） */
  config_apply_failed_version?: string
  /** 回传积压：vmagent 磁盘持久发送队列积压字节数（展示名「回传积压」，非「WAL 积压」） */
  queue_backlog_bytes?: number
  collector_status?: string
  collector_version?: string
  last_error?: string
  components?: EdgeComponent[]
}

/** 列表整体聚合三档（§3.2；total 不含 retired） */
export interface EdgeAgentsSummary {
  total: number
  online: number
  partial: number
  offline: number
}

/** GET /edge-agents 响应体（response.data） */
export interface EdgeAgentsResponse {
  overall: AgentOverall
  summary: EdgeAgentsSummary
  agents: AgentView[]
}