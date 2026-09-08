/**
 * Module_09 网域与边缘配置中心 类型定义（config-center）。
 * 权威契约：docs/05-execution-records/module-09/api-contract-snapshot.md（第一权威）。
 * 字段名使用 snake_case 对齐后端 JSON；禁止反向以 platform/models/*.go 为实现依据。
 */

/** M09 分页信封：本模块接口统一返回 `{ items, total }`（非 M06 的 `list`）。 */
export interface PaginatedItems<T> {
  items: T[]
  total: number
}

/** 下发通道（决策 31/32/33）：default=local，其他=agent_pull */
export type Channel = 'local' | 'agent_pull'

/** Agent 类型：MVP 前端仅 vmagent */
export type AgentType = 'vmagent' | 'prometheus-agent'

/** 域类型（M06 行政字段，M09 只读引用） */
export type DomainType = 'management' | 'edge'

/** 网域运行态（agent_pull 心跳更新；MVP local 恒空） */
export type MonitoredStatus = 'online' | 'offline' | 'unknown'

/** 行政启用态（M06；disabled=冻结域） */
export type DomainEnabledStatus = 'enabled' | 'disabled'

/**
 * 网域（M06 行政 + M09 监控纳管合并）。
 * is_monitored 为 M09 写；前端据此派生注册态 monitored/created。
 */
export interface NetworkDomain {
  id: string
  name: string
  domain_type: DomainType
  zone_type?: string
  tenant_id: string
  /** 下发通道：default 固定 local；其他固定 agent_pull */
  channel: Channel
  /** MVP 固定 vmagent；agent_pull 必填，local 空 */
  agent_type?: AgentType
  /** 中心接入地址；agent_pull 必填，local 空 */
  center_endpoint?: string
  /** agent_pull 必填；local 空 */
  remote_write_url?: string
  description?: string
  /** 完全脱敏；明文仅 reset-token 单次返回 */
  token?: string
  token_masked?: string
  /** 已纳管监控标记（M09 写）；派生注册态 monitored/created */
  is_monitored: boolean
  /** 运行态，agent_pull 心跳更新；MVP local 恒空 */
  monitored_status?: MonitoredStatus
  last_heartbeat?: string
  agent_version?: string
  status?: DomainEnabledStatus
  created_at?: string
  updated_at?: string
}

/** 网域注册态（前端由 is_monitored 派生，非接口枚举） */
export type RegistrationStatus = 'monitored' | 'created'

/** 纳管请求体（POST/PUT /monitor） */
export interface MonitorDomainInput {
  agent_type?: AgentType
  remote_write_url?: string
  description?: string
  is_monitored?: boolean
}

/** 重置 Token 响应：一次性明文 + 完全脱敏 */
export interface ResetTokenResult {
  token: string
  token_masked: string
}

/** 草稿状态 */
export type DraftStatus = 'pending' | 'confirmed' | 'discarded'

/** 下发前校验状态 */
export type DraftValidationStatus = 'passed' | 'failed' | 'pending' | 'rejected'

/** 校验失败归因（决策 45-3） */
export type DraftValidationCause = 'user_config' | 'platform_fault'

/** 结构化校验失败定位（对齐原型 validation_details） */
export interface ValidationDetail {
  file?: string
  line?: number
  message: string
}

/** 风险等级 */
export type Risk = 'low' | 'high'

/** 变更对象（源数据对象；决策 60 追加 alertmanager_config 告警配置） */
export type ChangeTarget =
  | 'scrape_job'
  | 'target_instance'
  | 'monitoring_rule'
  | 'probe_target'
  | 'label_template'
  | 'alertmanager_config'

/** 变更类型 */
export type ChangeType = 'add' | 'update' | 'delete'

/** 影响的配置文件（决策 60 追加 alertmanager） */
export type AffectedFile = 'prometheus' | 'targets' | 'rules' | 'blackbox' | 'alertmanager'

/** 结构化变更清单项 */
export interface ConfigChangeItem {
  id: string
  type: ChangeType
  target: ChangeTarget
  description: string
  affected_files: AffectedFile[]
  risk: Risk
}

/** 技术信息（折叠展示，仅排障） */
export interface ConfigDraftMetadata {
  source_data_version: string
  trigger_summary: string
  checksum: string
  generator_version: string
  superseded_by_change_no?: string
}

/**
 * 配置草稿（变更单）。
 * 列表返回 DraftListItem；详情（GET /config-drafts/{change_no}）含产物与 change_items/metadata。
 */
export interface ConfigDraft {
  change_no: string
  network_domain_id: string
  network_domain_name?: string
  channel: Channel
  status: DraftStatus
  summary: string
  risk: Risk
  affected_files: AffectedFile[]
  validation_status: DraftValidationStatus
  /** 校验失败/待校验的具体原因（PRD §3.5.1，重校验失败亦透传） */
  validation_message?: string
  /** 校验失败归因（user_config 用户配置可修复 / platform_fault 平台故障自动重试，决策 45-3） */
  validation_cause?: DraftValidationCause
  /** 结构化校验失败定位（对齐原型 validation_details） */
  validation_details?: ValidationDetail[]
  confirmed_by?: string
  confirmed_at?: string
  created_at: string
  /** 基于哪个 ConfigVersion（版本对比 Tab） */
  source_version?: string
  prometheus_yml?: string
  rules_yml?: string
  blackbox_yml?: string
  /** 告警配置产物（决策 60：仅管理域 default 变更单含 alertmanager.yml 时返回，多文件预览 Tab 用） */
  alertmanager_yml?: string
  targets_files?: Record<string, string>
  metadata?: ConfigDraftMetadata
  change_items?: ConfigChangeItem[]
}

/** 配置版本（确认后生成，含产物供 diff） */
export interface ConfigVersion {
  id: string
  network_domain_id: string
  draft_id?: string
  change_no?: string
  prometheus_yml?: string
  rules_yml?: string
  blackbox_yml?: string
  alertmanager_yml?: string
  targets_files?: Record<string, string>
  created_at?: string
}

/** 下发记录状态 */
export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'

/** 废弃配置草稿对源数据的影响统计（决策 43-7） */
export interface DiscardImpact {
  new_reverted: number
  modified_kept: number
  deleted_restored: number
  missing: number
}

/** 下发记录（ConfigDeployment） */
export interface ConfigDeployment {
  id: string
  network_domain_id: string
  config_version_id: string
  source_change_no: string
  channel: Channel
  status: DeploymentStatus
  validation_status: DraftValidationStatus
  includes_blackbox?: boolean
  /** failed 时后端返回错误信息（前端 Tooltip） */
  error_message?: string
  triggered_by: string
  /** 开始时间 */
  triggered_at: string
  completed_at?: string
}