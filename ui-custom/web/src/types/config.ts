/**
 * 配置中心领域类型：ConfigDraft / ConfigVersion / ConfigDeployment
 *
 * 与 Module_09 §5.4~§5.6 配置生成 / 变更下发契约对齐。
 */

/** 草稿状态 */
export type DraftStatus = 'pending' | 'confirmed' | 'discarded'

/** 部署状态 */
export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'

/** 配置草稿（待确认的生成配置） */
export interface ConfigDraft {
  id: number
  network_domain_id: string
  change_no: string
  source_version?: string
  prometheus_yml: string
  rules_yml?: string
  blackbox_yml?: string
  targets_files?: string
  metadata?: string
  summary?: string
  change_items?: string
  status: DraftStatus
  validation_status: string
  confirmed_by?: string
  confirmed_at?: string
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** 配置版本（各网域已确认的不可变配置快照） */
export interface ConfigVersion {
  id: number
  network_domain_id: string
  draft_id: string
  change_no: string
  prometheus_yml: string
  rules_yml?: string
  blackbox_yml?: string
  targets_files?: string
  metadata?: string
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** 配置部署记录 */
export interface ConfigDeployment {
  id: number
  network_domain_id: string
  config_version_id: string
  source_change_no: string
  channel: 'local' | 'agent_pull'
  target_address?: string
  status: DeploymentStatus
  validation_status: string
  includes_blackbox: boolean
  error_message?: string
  triggered_by: string
  triggered_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
  deleted_at?: string
}