/**
 * M01 v3 采集策略契约类型（/api/v3/platform/*）。
 *
 * 与 `docs/05-execution-records/rewrite/v2.0/modules/module-01/api-contract-snapshot-v3.md`
 * 对齐：ID 统一为字符串 UUID；`change_status` 被 `sync` 取代；凭证只回
 * `credential_configured`。
 */

export type SyncStatus = 'draft' | 'pending' | 'syncing' | 'synced' | 'failed'

export interface SyncState {
  status: SyncStatus
  version: string
  error: string
  synced_at: string | null
}

export type JobType = 'standard' | 'blackbox'
export type JobDraftStatus = 'draft' | 'ready'
export type JobAuthType = 'none' | 'basic' | 'bearer'
export type ResourceCategory =
  | 'host'
  | 'database'
  | 'middleware'
  | 'application'
  | 'generic_target'
  | 'interface_service'

export interface MappingOverride {
  field: string
  value: string
}

export interface ExporterTemplateV3 {
  id: string
  name: string
  version: string
  default_port: number
  metrics_path: string
  scheme: string
  os: string
  arch: string
  download_url: string
  homepage: string
  install_guide: string
  description: string
  is_builtin: boolean
  source: 'official' | 'third_party' | 'internal'
  created_at: string
  updated_at: string
}

export type {
  CandidateField,
  CollectionTemplate,
  CollectionTemplateImpact,
  CollectionTemplateInput,
  Selector,
  SelectorFilter,
  SelectorLogic,
  SelectorOperator,
} from './collectionTemplate'

// 兼容旧命名：页面迁移到 collectionTemplate 类型后可删除该别名。
export type { CollectionTemplate as CollectionTemplateV3 } from './collectionTemplate'

export interface ScrapeJobV3 {
  id: string
  job_name: string
  job_type: JobType
  resource_category: ResourceCategory
  template_code: string
  selector: import('./collectionTemplate').Selector
  exporter_template_id: string
  exporter_template_name: string
  network_domain_id: string
  network_domain_name: string
  /** 所属监控任务组（空 = 传统单域 Job） */
  job_group_id?: string
  job_group_name?: string
  instance_selection_mode: 'manual' | 'filter'
  selected_instance_ids: string[]
  selected_instance_count: number
  scrape_interval: string
  scrape_timeout: string
  metrics_path: string
  scheme: string
  auth_type: JobAuthType
  username: string
  credential_configured: boolean
  tls_skip_verify: boolean
  ca_file: string
  label_template_id: string
  label_template_name: string
  blackbox_module: string
  target_field: string
  mapping_overrides: MappingOverride[]
  draft_status: JobDraftStatus
  enabled: boolean
  sync: SyncState
  created_at: string
  updated_at: string
}

export interface InstanceCandidateV3 {
  resource_id: string
  resource_category: ResourceCategory
  template_code: string
  display_name: string
  instance_ip: string
  port: number
  target_address: string
  network_domain_id: string
  status: string
  selectable: boolean
  disabled_reason: string
}

export interface InstallationV3 {
  status: string
  actual_port: number
  confirmed_by: string
  notes: string
  confirmed_at: string | null
}

export interface JobInstanceV3 {
  resource_id: string
  display_name: string
  instance_ip: string
  port: number
  /** 生效端口来源：instance / mapping / template / business / default / unresolved */
  port_source?: string
  status: string
  target_address: string
  installation: InstallationV3 | null
}

export interface PreviewTargetsV3 {
  job_name: string
  targets: { targets: string[]; labels: Record<string, string> }[]
  skipped: { resource_id: string; reason: string }[]
}

export type RuleContentMode = 'yaml_passthrough' | 'structured'

export interface MonitoringRuleV3 {
  id: string
  name: string
  content_mode: RuleContentMode
  rule_content: string
  group_count: number
  rule_count: number
  rule_type: string
  expr: string
  duration: string
  labels: Record<string, string>
  annotations: Record<string, string>
  template_code: string
  exporter_template_id: string
  scope: 'central' | 'edge' | 'both'
  enabled: boolean
  draft_status: JobDraftStatus
  ack_job_ref_errors: boolean
  ack_reason: string
  sync: SyncState
  created_at: string
  updated_at: string
}

export interface JobRefIssueV3 {
  group: string
  rule_name: string
  expr: string
  matcher: string
  referenced_job: string
  type: string
  severity: 'error' | 'warning'
  message: string
}

export interface RuleValidationV3 {
  valid: boolean
  error: string
  groups: number
  rules: number
  job_ref: JobRefIssueV3[]
  promql: { status: 'passed' | 'failed' | 'unavailable'; error: string }
}

export interface MetricAnchorV3 {
  template_code: string
  source_exporter?: string
}

export interface MetricV3 {
  id: string
  metric_name: string
  metric_type: string
  help: string
  unit: string
  labels: string[]
  collection_templates: MetricAnchorV3[]
  category: string
  exporter_template_id: string
  is_builtin: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface BusinessMetricV3 {
  id: string
  metric_id: string
  metric_name: string
  description: string
  metric_type: string
  unit: string
  business_domain: string
  app_name: string
  threshold_suggestion: string
  owner: string
  register_source: 'self' | 'agent'
  status: 'pending' | 'instrumented' | 'online'
  created_at: string
  updated_at: string
}

export interface ProbeModuleV3 {
  id: string
  name: string
  content: string
  is_builtin: boolean
  enabled: boolean
  referenced_job_count: number
  created_at: string
  updated_at: string
}
