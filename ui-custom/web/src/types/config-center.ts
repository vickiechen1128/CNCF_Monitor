/**
 * Module_09 配置与查询中心 类型定义（config-center）。
 * 权威契约：docs/05-execution-records/rewrite/v2.0/modules/module-09/api-contract-snapshot-v3.md（第一权威）。
 * v3 变更即自动同步，配置只读历史为「配置快照」；草稿 / 配置版本 / 下发记录类型已删除。
 * 字段名使用 snake_case 对齐后端 JSON；禁止反向以 platform/models/*.go 为实现依据。
 */

/** 页面归一化分页信封：网域列表把 v3 `{list,total}` 归一为 `{items,total}` 后供既有组件消费。 */
export interface PaginatedItems<T> {
  items: T[]
  total: number
}

/**
 * 下发通道：v3 仅 `agent_pull`（采集节点主动拉取配置包）。
 * 原 `local`（中心同机写盘）随「中心直连域」一并取消，见 Module_09 SRS §3.2 / NFR-02。
 */
export type Channel = 'agent_pull'

/** Agent 类型：MVP 前端仅 vmagent */
export type AgentType = 'vmagent' | 'prometheus-agent'

/** 域类型（M06 行政字段，M09 只读引用）：v3 只有采集节点域，`management`（中心直连域）已取消 */
export type DomainType = 'edge'

/** 网域运行态（按采集节点心跳聚合） */
export type MonitoredStatus = 'normal' | 'partial' | 'offline' | 'unknown'

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
  tenant_id: string
  /** 下发通道：v3 固定 agent_pull */
  channel: Channel
  /** MVP 固定 vmagent */
  agent_type?: AgentType
  /** 中心接入地址；{v0.4+} 网闸映射场景预留，当前实现不消费（心跳地址走安装时 CENTER_ENDPOINT 环境变量） */
  center_endpoint?: string
  /** 指标回传地址（采集节点侧可达） */
  remote_write_url?: string
  /** vmagent 持久队列磁盘上限（F-42，网域级回传参数）；空 = 未配置，agent 按 env > 硬兜底解析 */
  max_disk_usage_per_url?: string
  description?: string
  /** 完全脱敏；明文仅 reset-token 单次返回 */
  token?: string
  token_masked?: string
  /** 已纳管监控标记（M09 写）；派生注册态 monitored/created */
  is_monitored: boolean
  /** 运行态，按采集节点心跳聚合 */
  monitored_status?: MonitoredStatus
  last_heartbeat?: string
  agent_version?: string
  status?: DomainEnabledStatus
  created_at?: string
  updated_at?: string
  // v3 enriched 视图（GET /api/v3/platform/network-domains）透出字段
  /** v3 注册态（created/monitored/retired）；is_monitored 由其派生以兼容既有组件 */
  registration_status?: RegistrationStatus
  /** 云归属（M06 行政字段） */
  cloud_code?: string
  /** 纳管时间（未纳管为 null） */
  monitored_at?: string | null
  /** 网域内采集节点总数 / 在线数（v3 聚合字段） */
  agent_count?: number
  online_agent_count?: number
  /** 当前生效配置快照版本 */
  last_config_version?: string
}

/** 网域注册态（v3 契约 §2.1 枚举；前端展示统一走该枚举） */
export type RegistrationStatus = 'monitored' | 'created' | 'retired'

/**
 * v3 纳管网域视图（GET /api/v3/platform/network-domains）。
 * 由 M09 提供 enriched 视图：行政字段 + 纳管运行态；不含明文 Token。
 */
export interface OnboardingDomain {
  network_domain_id: string
  name: string
  cloud_code: string
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

/** 纳管响应中的标准安装指引（v3 契约 §2.3） */
export interface InstallGuide {
  steps: string[]
  package_download_url: string
}

/** 纳管成功响应（v3 契约 §2.3；token 明文仅本次返回） */
export interface MonitorDomainResult {
  network_domain_id: string
  registration_status: RegistrationStatus
  token: string
  token_masked: string
  center_endpoint: string
  remote_write_url: string
  install_guide: InstallGuide
}

/** 退纳管响应（v3 契约 §2.2） */
export interface UnmonitorDomainResult {
  network_domain_id: string
  registration_status: RegistrationStatus
}

/** 纳管请求体（POST/PUT /monitor） */
export interface MonitorDomainInput {
  agent_type?: AgentType
  remote_write_url?: string
  /** vmagent 持久队列磁盘上限（F-42，网域级回传参数） */
  max_disk_usage_per_url?: string
  description?: string
  is_monitored?: boolean
}

/** 重置 Token 响应：一次性明文 + 完全脱敏（v3 契约 §2.4） */
export interface ResetTokenResult {
  token: string
  token_masked: string
  reset_at?: string
}

/**
 * 草稿状态 / 下发前校验状态 / 风险等级 / 变更维度等 v2 枚举。
 *
 * v3 已删除草稿与下发机制（配置变更即自动同步），页面不再消费这些类型；
 * 但 `configCenterConstants.ts` 仍导出对应展示映射，保留类型以维持该公共常量的编译，
 * 待常量模块随 v3 一并收敛后删除。
 */
export type DraftStatus = 'pending' | 'confirmed' | 'discarded'

/** 下发前校验状态 */
export type DraftValidationStatus = 'passed' | 'failed' | 'pending' | 'rejected'

/** 风险等级 */
export type Risk = 'low' | 'high'

/** 变更对象（源数据对象；决策 60 追加 alertmanager_config 告警配置；决策 68-2 补丁追加 prom_alerting） */
export type ChangeTarget =
  | 'scrape_job'
  | 'target_instance'
  | 'monitoring_rule'
  | 'probe_target'
  | 'label_template'
  | 'alertmanager_config'
  | 'prom_alerting'

/** 变更类型 */
export type ChangeType = 'add' | 'update' | 'delete'

/** 影响的配置文件（决策 60 追加 alertmanager） */
export type AffectedFile = 'prometheus' | 'targets' | 'rules' | 'blackbox' | 'alertmanager'

/** 下发记录状态（v2 遗留；configCenterConstants 仍导出展示映射，v3 页面不再消费） */
export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'

/** 配置快照校验状态（v3 契约 §4.1） */
export type SnapshotValidationStatus = 'passed' | 'failed'

/** 配置快照校验失败归因（v3 契约 §4.1；passed 快照为 none） */
export type SnapshotValidationCause = 'user_config' | 'platform_fault' | 'none'

/**
 * 配置快照（v3 契约 §4.1）：v3 配置变更即自动同步，快照是自动生成的历史记录。
 * 只读；不提供确认 / 重校 / 废弃 / 回滚动作。
 */
export interface ConfigSnapshot {
  id: number
  network_domain_id: string
  version: string
  checksum: string
  validation_status: SnapshotValidationStatus
  validation_cause: SnapshotValidationCause
  /** 校验明细（后端 json.RawMessage，通常为对象，可能为空对象 {}） */
  validation_details: unknown
  /** 是否为该网域当前生效版本（每域仅一个 true） */
  is_current: boolean
  /** 生成来源，如 system / alertmanager */
  generated_by: string
  created_at: string
}

/** 单网域快照列表信封（v3 契约 §4.2，最新在前） */
export interface ConfigSnapshotListResponse {
  list: ConfigSnapshot[]
  total: number
}

/** 配置产物类型（SRS v1.5 FR-13）：网域采集配置 / 中心规则 / 告警配置 */
export type ConfigArtifactType = 'domain' | 'center' | 'alertmanager'

/**
 * 统一配置产物（SRS v1.5 FR-13/13.1）。
 * 三类产物共用一张历史表；artifact_type 区分来源，network_domain_id 仅 domain 类型有值。
 */
export interface ConfigArtifact {
  id: number
  /** 旧接口/测试兼容：缺省按 domain 处理 */
  artifact_type?: ConfigArtifactType
  network_domain_id: string
  version: string
  checksum: string
  validation_status: SnapshotValidationStatus
  validation_cause: SnapshotValidationCause
  validation_details: unknown
  is_current: boolean
  generated_by: string
  generated_at?: string
  created_at: string
  /** 历史内容是否仍可预览/导出 */
  content_available?: boolean
}

/** 统一配置产物列表信封（最新在前） */
export interface ConfigArtifactListResponse {
  list: ConfigArtifact[]
  total: number
}

/** 详情抽屉中的单个配置文件 */
export interface ConfigArtifactFile {
  name: string
  content: string
}

/** 配置产物内容预览（admin） */
export interface ConfigArtifactPreview {
  artifact: ConfigArtifact
  files: ConfigArtifactFile[]
}

/** 统一历史页聚合行：附带展示名（网域名 / 中心规则 / 告警配置） */
export interface ConfigSnapshotHistoryRow extends ConfigArtifact {
  network_domain_name: string
}

/** 即时同步触发范围：网域 / 中心规则 / 全部 */
export type ConfigSyncTriggerScope = 'domain' | 'center' | 'all'

/** POST /config-sync/trigger 请求体 */
export interface ConfigSyncTriggerRequest {
  scope: ConfigSyncTriggerScope
  network_domain_ids?: string[]
  /** true 时后端同步执行并返回结果；默认 false（后台队列，前端轮询状态） */
  wait?: boolean
}

export interface ConfigSyncTriggerDomainResult {
  network_domain_id: string
  version: string
  validation_status: SnapshotValidationStatus
  validation_cause: SnapshotValidationCause
  validation_details?: string
  error?: string
}

export interface ConfigSyncTriggerCenterResult {
  version: string
  validation_status: SnapshotValidationStatus
  validation_cause: SnapshotValidationCause
  validation_details?: string
  error?: string
}

export interface ConfigSyncTriggerResponse {
  accepted: boolean
  completed: boolean
  domains?: ConfigSyncTriggerDomainResult[]
  center?: ConfigSyncTriggerCenterResult
}

/**
 * 边缘离线安装包组成组件（M11 契约 §2：Edge Sync Agent 交付物内含的二进制组件）。
 * 权威契约：docs/05-execution-records/module-11/api-contract-snapshot.md §2。
 */
export interface EdgePackageComponent {
  name: string
  version: string
}

/** 边缘离线安装包元信息（GET /edge-packages 单条，M11 契约 §2；data 为 PackageArtifact[] 数组） */
export interface EdgePackage {
  /** 包标识，如 release-v0.2.0（对齐契约 PackageArtifact.id） */
  id: string
  version: string
  sha256: string
  size_bytes: number
  components: EdgePackageComponent[]
  /** 指定产物下载路径，如 /api/v3/platform/edge-packages/<file> */
  download_url: string
  /**
   * tar.gz 真实产物文件名，由后端读取 build 目录 `release_meta.json` 的 `file` 字段提供，
   * 如 edge-sync-agent-v0.2.0-linux-amd64-20260922-121018.tar.gz；下载时优先以此命名。
   */
  file?: string
}