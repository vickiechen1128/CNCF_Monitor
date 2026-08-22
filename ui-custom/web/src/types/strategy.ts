/**
 * 采集策略领域类型：ScrapeJob / CITypeExporterMapping / ExporterTemplate / MonitoringRule
 *
 * 与 Module_01 §5 对齐。
 */

/** 采集任务类型 */
export type JobType = 'standard' | 'blackbox'

/** 采集认证方式 */
export type AuthType = 'none' | 'basic' | 'bearer'

/** 变更下发状态 */
export type ChangeStatus = 'none' | 'pending' | 'confirmed' | 'deployed'

/** 实例选择方式 */
export type InstanceSelectionMode = 'manual' | 'filter'

/** 采集任务 */
export interface ScrapeJob {
  id: number
  job_name: string
  job_type: JobType
  resource_type: string
  monitor_type: string
  exporter_template_id?: string
  network_domain_id: string
  instance_selection_mode: InstanceSelectionMode
  selected_instance_ids: string[]
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: string
  auth_type: AuthType
  username?: string
  token?: string
  tls_skip_verify: boolean
  ca_file?: string
  label_template_id?: string
  filter_rules: string
  blackbox_module?: string
  draft_status: string
  change_status: ChangeStatus
  enabled: boolean
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** CI 类型 → Exporter 映射（各 monitor_type 下的默认采集实现） */
export interface CITypeExporterMapping {
  id: number
  monitor_type: string
  exporter_template_id: string
  is_default: boolean
  default_port: number
  metrics_path: string
  scheme: string
  scrape_interval: string
  scrape_timeout: string
  label_template_id?: string
  is_builtin: boolean
  created_at: string
  updated_at: string
}

/** Exporter 来源 */
export type ExporterSource = 'official' | 'third_party' | 'internal'

/** Exporter 模板（采集实现片段） */
export interface ExporterTemplate {
  id: number
  name: string
  version: string
  default_port: number
  metrics_path: string
  scheme: string
  supported_monitor_types: string[]
  os: string
  arch: string
  download_url: string
  homepage: string
  install_guide: string
  is_builtin: boolean
  source: ExporterSource
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** 规则内容模式 */
export type RuleContentMode = 'yaml_passthrough' | 'structured'

/** 规则求值范围 */
export type ScopeType = 'central' | 'edge' | 'both'

/** 监控规则（告警/录制） */
export interface MonitoringRule {
  id: number
  name: string
  content_mode: RuleContentMode
  rule_content?: string
  rule_type?: string
  expr?: string
  duration?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  monitor_type?: string
  exporter_template_id?: string
  scope: ScopeType
  enabled: boolean
  draft_status: string
  change_status: ChangeStatus
  created_at: string
  updated_at: string
  deleted_at?: string
}