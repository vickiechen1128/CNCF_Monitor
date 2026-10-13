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
  /** 回传积压：vmagent 发送链路积压字节数（F-39：max 内存缓冲/磁盘持久队列；展示名「回传积压」，非「WAL 积压」） */
  queue_backlog_bytes?: number
  /** 累计丢块+丢包总数（F-39）：非零即发生过回传数据丢失 */
  remote_write_dropped_total?: number
  /** 累计发送重试次数（F-39）：增速高即回传链路不稳信号 */
  remote_write_retries_total?: number
  /** 回传延迟（F-40 延展）：中心视角该网域 up 样本距今秒数的 p95 分位（quantile by network_domain_id，反映大部分样本滞后而非仅最新一条）；缺省=无数据（24h 内无样本/中心 Prom 不可用），与 0（新鲜）严格区分 */
  remote_write_lag_seconds?: number | null
  /** 积压数据龄（F-40 延展①）：当前积压字节 ÷ 近期积压增速（相邻心跳差分）的估算秒数；缺省=无数据（窗口内心跳不足/积压未上涨/心跳过期），与 0 严格区分。网域级派生值，同域节点相同 */
  backlog_age_seconds?: number | null
  /** 近期积压增速（字节/秒，负值表示积压在消化）；缺省=无差分依据。对应「展示心跳中的积压增长趋势」口径 */
  backlog_growth_bytes_per_sec?: number | null
  /** 回传通道态（F-40 延展③）：'abnormal'=积压上涨且错误持续（≥2 条心跳报错或窗口内重试增长）；缺省/空=正常或无从判定 */
  channel_status?: string
  /** 回传错误：vmagent remote_write 最近一次失败摘要（非空即代表回传通道异常，可区分「程序坏了」与「仅积压排队」） */
  remote_write_last_error?: string
  collector_status?: string
  collector_version?: string
  last_error?: string
  /** 当前生效配置目录 metadata.json 的 remote_write_url（F-42 回传参数指纹，随心跳上报落库）；空 = 未下发，agent 按 env > 硬兜底解析 */
  metadata_remote_write_url?: string
  /** 当前生效配置目录 metadata.json 的 max_disk_usage_per_url（F-42：持久队列磁盘上限）；空 = 未下发，agent 内置兜底 */
  metadata_max_disk_usage_per_url?: string
  /** 已登记的人工重启采集进程指令序号（F-42）：中心每次受理重启请求原子递增 */
  vm_agent_restart_seq?: number
  /** 最近一次人工重启指令发起人（留痕） */
  restart_requested_by?: string
  /** 最近一次人工重启指令发起时间（RFC3339，留痕） */
  restart_requested_at?: string | null
  /** 已登记的「清空回传积压」破坏性指令序号（F-43，机制同 vm_agent_restart_seq）：中心每次受理清积压请求原子递增 */
  flush_backlog_seq?: number
  /** 最近一次清积压指令发起人（留痕） */
  flush_requested_by?: string
  /** 最近一次清积压指令发起时间（RFC3339，留痕） */
  flush_requested_at?: string | null
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