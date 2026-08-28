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
  /** blackbox Job 的拨测目标（job_type=blackbox 必填，§5.4） */
  blackbox_targets?: BlackboxTarget[]
  /** 认证TLS密文仅存储不回显明文，编辑回填一律置空（决策31） */
  password?: string
  /** 参数继承映射快照可覆盖项（§5.4，UI「参数同步」列概览） */
  mapping_overrides?: ScrapeJobMappingOverride[]
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
  /** M07 只读透传：该映射是否已挂标签模板（列表附加，§6.2.1） */
  has_label_template?: boolean
  /** 未被任何 ScrapeJob 引用（采集器池「未被引用」标记，§11.1） */
  is_referenced?: boolean
  /** 采集器安装指引：只读透传自 ExporterTemplate（§11.1） */
  install_guide?: string
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
  description: string
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

/** 拨测目标协议（BlackboxTarget.protocol，§9） */
export type BlackboxTargetProtocol = 'http' | 'https' | 'tcp' | 'icmp' | 'dns'

/** 拨测目标（§5.4：target 必填，protocol∈{http,https,tcp,icmp,dns}，url 可选） */
export interface BlackboxTarget {
  target: string
  protocol: BlackboxTargetProtocol
  url?: string
}

/**
 * 监控对象类型（MONITOR_TYPE_DERIVATION_MAP 推导，§9）。
 * 两级级联：资源类别（host/database/middleware/application/generic_target）→ 细粒度。
 */
export type MonitorType =
  | 'host_linux'
  | 'host_windows'
  | 'mysql'
  | 'redis'
  | 'kafka'
  | 'elasticsearch'
  | 'nginx'
  | 'application_http'
  | 'snmp'

/** 拨测模块（blackbox.yml 模块名，§9） */
export type BlackboxModule = 'http_2xx' | 'icmp_ping' | 'tcp_connect' | 'dns_query'

/** 指标类型（§5.3 / §9） */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary' | 'unknown'

/** 指标库多对多锚点：monitor_type + 来源采集器（source_exporter，同名不同义区分，§5.3） */
export interface ExporterMetricAnchor {
  monitor_type: string
  source_exporter?: string
}

/** 技术指标库条目（§5.3 / §6.2.3） */
export interface ExporterMetricLibraryItem {
  id: number
  metric_name: string
  metric_type: MetricType
  help: string
  unit: string
  labels: string[]
  monitor_types: ExporterMetricAnchor[]
  category?: string
  exporter_template_id?: string
  is_builtin: boolean
  enabled: boolean
  created_at: string
  updated_at: string
  deleted_at?: string
}

/** 实例候选（GET /scrape-jobs/instance-candidates，item，§6.2.5 / 决策29） */
export interface InstanceCandidate {
  resource_id: string
  instance_name: string
  instance_ip: string
  status: string
  /** status=offline 时 true，置灰不可选（决策29） */
  disabled: boolean
}

/** 安装确认状态（§8 统一枚举：unconfirmed → confirmed；blackbox/application 用 not_applicable） */
export type InstallationStatus = 'unconfirmed' | 'confirmed' | 'not_applicable'

/** Exporter 安装确认记录（PK=(resource_id, scrape_job_id)，§6.2.5 / §8 ④） */
export interface ExporterInstallationRecord {
  resource_id: string
  scrape_job_id: number
  exporter_template_id?: string
  status: InstallationStatus
  confirmed_by?: string
  confirmed_at?: string
  notes?: string
  actual_port?: number
}

/** 已选实例 + 安装状态条目（GET /scrape-jobs/:id/instances，§6.2.5） */
export interface ScrapeJobInstanceItem {
  resource_id: string
  instance_name: string
  instance_ip: string
  status: InstallationStatus
}

/** 参数继承映射快照可覆盖项（§5.4，UI「参数同步」列概览） */
export interface ScrapeJobMappingOverride {
  field: string
  value: string
}