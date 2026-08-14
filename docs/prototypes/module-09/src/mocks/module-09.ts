export type NetworkDomainStatus = 'online' | 'offline' | 'unknown'
export type DomainType = 'management' | 'edge'
export type AgentType = 'vmagent' | 'prometheus-agent'
export type ConfigSyncStatus = 'in_sync' | 'out_of_sync' | 'unknown' | 'manual_override'
/** 采集器运行状态（PRD 3.2 采集器进程管理 / 6.3 第 1 条：Edge Sync Agent 部署守护本节点采集器，运行状态纳入心跳上报与 Agent 状态展示） */
export type CollectorStatus = 'running' | 'stopped' | 'unknown'

/**
 * 边缘节点组件类型（PRD 3.2 组件分类 / 3.9 边缘节点组件构成 / 4.2 components，决策 15）：
 * 一个边缘节点（EdgeAgent 部署实例）由多个组件构成，Agent 状态页按组件类型分类展示：
 * - edge_sync_agent：Edge Sync Agent（必装独立组件，负责心跳 / 配置拉取 / 控制本节点组件，非中心平台内置）
 * - collector：指标采集器（vmagent / prometheus-agent 二选一，由 NetworkDomain.agent_type 登记）
 * - blackbox_exporter：拨测器（可选，网域存在 job_type=blackbox 的 ScrapeJob 时随一体化包附带）
 * - vmalert / alertmanager：边缘自治告警组件（v0.4+，随 rules.yml / alertmanager.yml 下发后启用）
 */
export type EdgeComponentType = 'edge_sync_agent' | 'collector' | 'blackbox_exporter' | 'vmalert' | 'alertmanager'

/**
 * 边缘节点组件实例（PRD 4.2 EdgeAgent.components / 4.3 心跳附带组件清单，决策 15）：
 * 由 Edge Sync Agent 心跳附带上报（组件类型 / 版本 / 运行状态 / 配置版本 / 最近错误），
 * Agent 状态页「网域为主 + 组件分类」展开子表按组件类型分类展示。
 */
export interface EdgeComponent {
  /** 组件类型（分类展示维度） */
  type: EdgeComponentType
  /** 组件实例名（如 edge-agent-gova-01 上的 vmagent / blackbox-exporter） */
  name: string
  /** 组件运行状态：Edge Sync Agent 用 online/offline/unknown，采集器与拨测器等进程组件用 running/stopped/unknown */
  status: 'online' | 'offline' | 'running' | 'stopped' | 'unknown'
  /** 组件版本（如 vmagent v1.102.0、blackbox exporter v0.25.0） */
  version: string
  /** 组件当前生效配置版本（与 EdgeAgent.config_version 对齐；无配置概念的可省略） */
  config_version?: string
  /** 组件最近错误（如配置 reload 失败 / 拉包校验失败 / 本地手工覆盖提示） */
  last_error?: string
}
export type ConfigDraftStatus = 'pending' | 'confirmed' | 'discarded'
export type DraftValidationStatus = 'passed' | 'failed' | 'pending'
export type DeploymentStatus = 'pending' | 'running' | 'success' | 'failed' | 'rolled_back'
export type DeploymentTargetType = 'central_prometheus' | 'edge_agent' | 'vmagent'
export type DeploymentValidationStatus = 'passed' | 'failed' | 'pending'

/**
 * file_sd 目标文件条目（targets/<job_name>.json 中一个 target group，PRD 3.3 / 6.2）：
 * - targets：实例列表（host:port 或 URL）
 * - labels：由 LabelTemplate 静态展开的资源标签（app / env / network_domain 等，PRD 3.3 映射语义）
 */
export interface TargetsFileEntry {
  targets: string[]
  labels: Record<string, string>
}

/**
 * ConfigDraft / ConfigVersion.targets_files（PRD 4.4 / 4.5）：按 job 名组织的 targets 列表（file_sd 目标文件内容），
 * 下发时按 job 拆分为 targets/<job_name>.json（固定文件名覆盖写，PRD 6.2）。
 * 特殊值 string 表示该文件内容为原始文本（用于校验失败演示，如未闭合 JSON），
 * 实际系统由 configgen 侧 targets schema 校验拦截（PRD 3.5.1）。
 */
export type ConfigTargetsFiles = Record<string, TargetsFileEntry[] | string>

/**
 * ConfigDraft / ConfigVersion 的 metadata（PRD 4.4 / 4.5）：
 * - source_data_version：各源表 max(updated_at) 聚合的「源数据版本」
 * - trigger_summary：触发来源（变更的 job / rule / 表 + 时间）
 * - checksum：联合 checksum，sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)
 *   （缺失文件按空串拼接；targets 内容为按固定顺序拼接的本域全部 targets/*.json，PRD 3.3.3）
 */
export interface ConfigDraftMetadata {
  generated_by: string
  generator_version: string
  reason: string
  source_data_version: string
  trigger_summary: string
  checksum: string
  source_summary: string
}

/**
 * 变更对象分类（决策 22「变更对象 = 源数据对象」）：用户在 Module_01 / 07 中操作的**根源对象**，
 * 而非配置文件本身——新增实例（targets 变化）与修改抓取频率（prometheus.yml 变化）源头都在「采集 Job」功能，
 * 但影响的配置文件不同，由 affected_files 派生区分。
 */
export type ConfigChangeTarget =
  | 'scrape_job' // 采集 Job（含频率 / 路径 / relabel 等 job 骨架参数）
  | 'scrape_target' // 采集目标（实例增删 / 标签变化，来自资源或 Job 实例选择）
  | 'alert_rule' // 告警规则（MonitoringRule）
  | 'blackbox_target' // 拨测目标（blackbox ScrapeJob 的 target）
  | 'label_template' // 标签模板（LabelTemplate）

/** 影响的配置文件（决策 22）：configgen 对比「当前生效版本」与「新草稿」产物差异派生的维度 */
export type AffectedConfigFile = 'prometheus.yml' | 'targets' | 'rules.yml' | 'blackbox.yml'

/**
 * 结构化变更清单项（决策 18「变更确认心智」/ 22）：
 * 由 configgen 对比「当前生效版本」与「新草稿」的**产物差异**生成（数据层 diff，非 YAML 文本 diff），
 * 面向不了解 Prometheus 的运维工程师，回答「这次变更会带来什么影响」。
 * - type：变更类型（新增 / 修改 / 移除）
 * - target：变更对象 = 源数据对象（采集 job / 采集目标 / 告警规则 / 拨测目标 / 标签模板，决策 22 统一枚举）
 * - description：人话描述（如「node-exporter 新增实例 10.0.1.11:9100」）
 * - risk：风险等级（low=新增目标低风险；high=删除目标 / 告警规则变更，误报漏报风险）
 * - affected_files：影响的配置文件（决策 22，configgen 派生），如仅 targets 变化 → ['targets']
 */
export interface ConfigChangeItem {
  type: 'add' | 'modify' | 'remove'
  target: ConfigChangeTarget
  description: string
  risk: 'low' | 'high'
  affected_files: AffectedConfigFile[]
}

export interface Tenant {
  id: string
  name: string
  multi_site_enabled: boolean
}

export interface NetworkDomain {
  id: string
  name: string
  description: string
  domain_type: DomainType
  tenant_id: string
  token: string
  agent_type: AgentType
  remote_write_url: string
  status: NetworkDomainStatus
  last_heartbeat: string
  agent_version: string
  created_at: string
  updated_at: string
}

/**
 * EdgeAgent（PRD 4.2 模型语义）：实例代表「边缘节点上的 Agent 部署 = Edge Sync Agent + 采集器组合」；
 * agent_type 为采集器类型（vmagent / prometheus-agent，由 NetworkDomain.agent_type 登记），
 * Edge Sync Agent 为必装独立组件、无需登记。
 */
export interface EdgeAgent {
  id: string
  network_domain_id: string
  agent_type: AgentType
  /** Edge Sync Agent 版本（PRD 4.2 version=Agent 版本；与采集器版本拆分展示，见 collector_version） */
  version: string
  /** 采集器版本（PRD 3.2 采集器进程管理 / 6.3 第 1 条：采集器版本纳入心跳上报与 Agent 状态展示；按 agent_type 区分 vmagent / prometheus-agent） */
  collector_version: string
  /** 采集器运行状态（PRD 3.2 采集器进程管理 / 6.3 第 1 条：Edge Sync Agent 部署守护本节点采集器，进程异常自动重启并上报健康状态） */
  collector_status: CollectorStatus
  hostname: string
  /** Agent IP：心跳上报的登记信息（PRD 3.2 Agent 注册 / 6.3），仅展示，不参与配置下发 */
  agent_ip: string
  status: NetworkDomainStatus
  last_heartbeat: string
  heartbeat_rtt_ms: number
  last_config_pull: string
  config_version: string
  config_sync_status: ConfigSyncStatus
  wal_backlog_bytes: number
  remote_write_url: string
  last_error: string
  /**
   * 边缘节点组件清单（PRD 4.2 / 决策 15）：Edge Sync Agent + 采集器（必装）+ blackbox exporter（可选，blackbox job 网域）
   * + v0.4+ 边缘告警组件（vmalert / alertmanager）；由 Edge Sync Agent 心跳附带上报（PRD 4.3），
   * Agent 状态页「网域为主 + 组件分类」展开子表按组件类型分类展示。
   */
  components: EdgeComponent[]
  created_at: string
  updated_at: string
}

export interface ConfigDraft {
  id: string
  /**
   * 变更单号（决策 20）：用户可读的唯一标识（如 CHG-20260803-001），类比工单号 / PR 号，
   * 用于变更沟通、审计追溯（「回滚变更单 CHG-20260803-003」）；`id` 仍为内部技术键。
   */
  change_no: string
  network_domain_id: string
  source_version: string
  prometheus_yml: string
  rules_yml: string
  blackbox_yml: string
  /** 生成的 targets 内容（PRD 4.4）：按 job 名组织的 targets 列表，下发时拆分为 targets/<job_name>.json */
  targets_files: ConfigTargetsFiles
  metadata: ConfigDraftMetadata
  status: ConfigDraftStatus
  /** 下发前校验结果（PRD 3.5.1：promtool check config / blackbox_exporter --config.check） */
  validation_status: DraftValidationStatus
  validation_error: string
  /**
   * 人话变更摘要（决策 18）：configgen 对比当前生效版本与草稿的**产物差异**生成，
   * 面向不了解 Prometheus 的运维工程师回答「为什么发生了变更」，如「新增 1 台服务器（10.0.1.11）加入 node-exporter 采集」。
   */
  summary: string
  /** 结构化变更清单（决策 18）：变更类型 / 对象 / 人话描述 / 风险等级，是「变更确认」页的核心决策信息 */
  change_items: ConfigChangeItem[]
  created_at: string
  updated_at: string
  confirmed_by?: string
  confirmed_at?: string
}

export interface ConfigVersion {
  id: string
  network_domain_id: string
  draft_id: string
  /** 来源变更单号（决策 22）：draft 确认后生成 ConfigVersion 时继承，全链路追溯 change_no → cv → deploy */
  change_no: string
  prometheus_yml: string
  rules_yml: string
  blackbox_yml: string
  /** 生效的 targets 内容（PRD 4.5）：与草稿一致，随配置包按 targets/<job_name>.json 落地 */
  targets_files: ConfigTargetsFiles
  metadata: Record<string, unknown>
  created_at: string
  created_by: string
}

export interface ConfigDeployment {
  id: string
  network_domain_id: string
  config_version_id: string
  /** 来源变更单号（决策 22）：经 config_version_id → ConfigVersion.change_no 透传，全链路可追溯「哪个变更发的、回滚它」 */
  source_change_no: string
  target_type: DeploymentTargetType
  target_address: string
  status: DeploymentStatus
  /** 下发前校验结果（PRD 3.5.1），失败时 error_message 记录校验失败原因 */
  validation_status: DeploymentValidationStatus
  validation_error: string
  /** 本次下发配置包是否包含 blackbox.yml（PRD 4.5） */
  includes_blackbox: boolean
  error_message: string
  triggered_by: string
  triggered_at: string
  completed_at: string
  created_at: string
}

/** 本轮变更检测结果类型（PRD 3.3.3「检测状态可观测」P1） */
export type ChangeDetectionOutcome = 'changes_found' | 'no_change' | 'checksum_same'

/**
 * 变更检测状态（PRD 3.3.3「检测状态可观测」P1）：每个网域最近一次轮询（pull 模式，默认 30s）的检测结果，
 * 供 UI 展示：上次检测时间 / 当前源数据版本（source_data_version）/ 检测结果。
 */
export interface ChangeDetectionStatus {
  network_domain_id: string
  /** 上次检测时间：最近一次轮询执行时间 */
  last_checked_at: string
  /** 当前源数据版本：各源表 max(updated_at) 聚合（PRD 3.3.3 版本触发预筛） */
  source_data_version: string
  /**
   * 检测结果：
   * - changes_found：本轮检测到变更 → 生成了草稿（引用草稿 ID / 触发摘要）
   * - no_change：源数据版本未变化 → 本轮无变更，跳过重算
   * - checksum_same：源数据版本变化但重算后联合 checksum 与生效版本一致 → 内容无变化，自动丢弃，不进入确认
   */
  outcome: ChangeDetectionOutcome
  /** 本轮检测生成的草稿（changes_found 时） */
  generated_drafts: { id: string; trigger_summary: string }[]
  /** 检测结果摘要（原型演示文字） */
  summary: string
}

/**
 * MVP 采集器类型（决策 12）：MVP 阶段采集器类型固定仅 vmagent（网域注册时无需选择）；
 * prometheus-agent 保留枚举（AgentType）、v0.2+ 开放为可选。
 */
export const MVP_AGENT_TYPE: AgentType = 'vmagent'

// 当前租户上下文：通过切换 multi_site_enabled 演示单网域/多网域模式差异
export const currentTenant: Tenant = {
  id: 'platform_admin',
  name: '平台默认租户',
  multi_site_enabled: true,
}

// 原型演示用伪 sha256（64 位十六进制，按 seed 稳定生成，64 个采样点均匀覆盖整个 seed）；
// 实际系统由配置内容联合计算
function demoChecksum(seed: string): string {
  const hex = '0123456789abcdef'
  const len = Math.max(seed.length, 1)
  let out = ''
  let acc = 0
  for (let i = 0; i < 64; i++) {
    // 64 个采样点均匀覆盖整个 seed，保证 seed 任一部分变化都会改变结果
    const idx = Math.floor((i / 64) * len)
    acc = (acc * 33 + (seed.charCodeAt(idx) || 0) + i) % 256
    out += hex[acc % 16]
  }
  return out
}

/**
 * 将 targets_files 序列化为每个 job 落盘的原始文本（targets/<job_name>.json 内容，PRD 6.2）：
 * 结构化条目序列化为缩进 JSON；string 特殊值（校验失败演示）原样透传。
 */
export function targetsFilesToText(targetsFiles: ConfigTargetsFiles | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [job, content] of Object.entries(targetsFiles ?? {})) {
    out[job] = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
  }
  return out
}

/**
 * 联合 checksum（PRD 3.3.3 / 4.4 / 4.5 / 6.2）：
 * sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)
 * 缺失文件按空串拼接；targets 内容按 job 名固定顺序拼接本域全部 targets/*.json。
 */
export function computeJointChecksum(
  prometheus_yml: string,
  rules_yml: string,
  blackbox_yml: string,
  targets_files?: ConfigTargetsFiles
): string {
  const targetsText = targetsFilesToText(targets_files)
  const parts = [
    prometheus_yml,
    rules_yml ?? '',
    blackbox_yml ?? '',
    ...Object.keys(targetsText)
      .sort()
      .map((job) => targetsText[job]),
  ]
  return demoChecksum(parts.join('\u0001'))
}

/**
 * Token 完全脱敏展示形态（PRD 3.1 Token 管理）：UI 不展示任何明文片段（含首尾 6 位与前缀），
 * 所有网域统一展示该固定脱敏串；完整值仅保留在数据中、通过「复制」按钮获取。
 */
export const TOKEN_MASK = '••••••••'

/**
 * 网域 Remote Write URL 自动推导（决策 14）：中心平台已知自身 ingest ingress，
 * 注册网域时默认按「中心 ingress 地址 + 网域路径」自动生成（可手动覆盖），减少人工填写项；
 * 边缘 Agent 通过该地址回传本域指标（outbound HTTPS 443，PRD 3.1 / 6.x）。
 */
export function deriveRemoteWriteUrl(domainId: string): string {
  return `https://metriccenter.example.com/api/v2/ingest/${domainId}/prometheus`
}

/**
 * 校验分层说明（PRD 6.4 决策 10「中心/边缘校验分层与衔接」，v1.9 同步 PRD v1.13）：
 * 中心侧控制（configgen 生成草稿 → 中心内容校验 → 预览/diff/确认 → ConfigVersion）与
 * 边缘侧消费（心跳拉 zip → 边缘传输校验 → 原子替换 → 回执 config_sync_status）由
 * 同一份配置产物（ConfigVersion / zip 包）衔接的同一条链路的两段。
 */
export const validationLayeringNote = {
  center:
    '中心①内容校验（生成阶段）：promtool check config 校验 prometheus.yml、blackbox_exporter --config.check 校验 blackbox.yml、configgen 侧 targets schema 校验（JSON 结构 / host:port / labels 合法性）；结果以 validation_status 展示，失败阻止确认下发（防止生成错误进入上线流程）',
  edge:
    '边缘②传输校验（Agent 拉包阶段）：拉包后按 metadata.json 联合 checksum 做完整性校验，并对解压后的 targets/*.json 做解析校验；结果体现于 Agent 状态页 config_sync_status 与最近错误（防止传输损坏 / 篡改 / 半写文件）',
  agentDumbCheck:
    'Agent 为「哑校验」：只做传输层机械校验（checksum 完整性 + targets JSON 解析），不做 promtool 级语法校验；产物合法性由中心内容校验保证——校验①失败会阻止确认下发，边缘侧拿到的必然是已通过中心校验的产物',
  checksumDualUse:
    '联合校验值双用途：同一份 sha256(prometheus.yml + rules_yml + blackbox_yml + targets 内容)，中心侧用于草稿去重裁决（内容是否变化），边缘侧用于拉包完整性校验（传输字节是否完整）',
}

export const networkDomains: NetworkDomain[] = [
  {
    id: 'default',
    name: 'default',
    description: '默认中心管理域，承载单机与中心采集模式；可修改名称以匹配云区域命名',
    domain_type: 'management',
    tenant_id: 'platform_admin',
    token: 'tk_default_a1b2c3d4e5f6',
    agent_type: 'vmagent',
    remote_write_url: 'http://localhost:8428/api/v1/write',
    status: 'online',
    last_heartbeat: '2026-08-03 14:30:00',
    agent_version: 'v1.102.0',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-08-03 14:30:00',
  },
  {
    id: 'gov-cloud-a',
    name: '政务网 A 区',
    description: '物理隔离政务网，通过 Edge Agent 单向 HTTPS 出站接入',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    token: 'tk_gova_7g8h9i0j1k2l',
    agent_type: 'vmagent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'online',
    last_heartbeat: '2026-08-03 14:28:00',
    agent_version: 'v1.102.0',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-03 14:28:00',
  },
  {
    id: 'finance-dmz',
    name: '金融 DMZ',
    description: '金融专网 DMZ 区，部署 Prometheus Agent Mode',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    token: 'tk_finance_3m4n5o6p7q8r',
    agent_type: 'prometheus-agent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'offline',
    last_heartbeat: '2026-08-03 13:50:00',
    agent_version: 'v2.54.0',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-03 13:50:00',
  },
  {
    id: 'manufacturing-edge',
    name: '制造边缘节点',
    description: '工厂边缘网关，网络不稳定，启用 WAL 本地缓冲',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    token: 'tk_mfg_9s0t1u2v3w4x',
    agent_type: 'vmagent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'online',
    last_heartbeat: '2026-08-03 14:25:00',
    agent_version: 'v1.102.0',
    created_at: '2026-07-20 00:00:00',
    updated_at: '2026-08-03 14:25:00',
  },
]

/**
 * 配置产物形态分层（决策 6）：按域类型区分——management（管理域，如 default）=本地文件集
 * （写入中心 Prometheus 配置目录，无 zip / metadata.json 下载校验）；edge（边缘域）=zip 配置包
 * （含 metadata.json 供拉取后 checksum 校验）。分层依据是域类型而非单/多网域开关。
 */
export type ConfigArtifactShape = 'local_files' | 'zip_package'

export function domainArtifactShape(domain: Pick<NetworkDomain, 'domain_type'>): ConfigArtifactShape {
  return domain.domain_type === 'edge' ? 'zip_package' : 'local_files'
}

export const edgeAgents: EdgeAgent[] = [
  // 注意：default 管理域不部署 Edge Agent（中心直接采集，PRD 3.11 / 决策 16），
  // 因此不存在 network_domain_id='default' 的 EdgeAgent 实例；Agent 状态页仅展示有 Agent 的 edge 网域。
  {
    id: 'ea-gov-a-01',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-gova-01',
    agent_ip: '10.20.1.11',
    status: 'online',
    last_heartbeat: '2026-08-03 14:28:00',
    heartbeat_rtt_ms: 45,
    last_config_pull: '2026-08-03 14:20:00',
    config_version: '20260803-141500',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 1048576,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-141500',
      },
      {
        type: 'collector',
        name: 'vmagent',
        status: 'running',
        version: 'v1.102.0',
        config_version: '20260803-141500',
      },
      {
        type: 'blackbox_exporter',
        name: 'blackbox-exporter',
        status: 'running',
        version: 'v0.25.0',
        config_version: '20260803-141500',
      },
    ],
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-03 14:28:00',
  },
  {
    id: 'ea-gov-a-02',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'stopped',
    hostname: 'edge-agent-gova-02',
    agent_ip: '10.20.1.12',
    status: 'online',
    last_heartbeat: '2026-08-03 14:27:00',
    heartbeat_rtt_ms: 52,
    last_config_pull: '2026-08-03 14:15:00',
    config_version: '20260803-141500',
    config_sync_status: 'out_of_sync',
    wal_backlog_bytes: 2097152,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: 'config reload: timeout waiting for response',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-141500',
      },
      {
        type: 'collector',
        name: 'vmagent',
        status: 'stopped',
        version: 'v1.102.0',
        config_version: '20260803-141500',
        last_error: 'config reload: timeout waiting for response',
      },
      {
        type: 'blackbox_exporter',
        name: 'blackbox-exporter',
        status: 'stopped',
        version: 'v0.25.0',
        config_version: '20260803-141500',
        last_error: 'config reload: timeout waiting for response',
      },
    ],
    created_at: '2026-07-15 00:00:00',
    updated_at: '2026-08-03 14:27:00',
  },
  {
    id: 'ea-finance-01',
    network_domain_id: 'finance-dmz',
    agent_type: 'prometheus-agent',
    version: 'v1.2.0',
    collector_version: 'v2.54.0',
    collector_status: 'unknown',
    hostname: 'edge-agent-finance-01',
    agent_ip: '10.30.2.21',
    status: 'offline',
    last_heartbeat: '2026-08-03 13:50:00',
    heartbeat_rtt_ms: 120,
    last_config_pull: '2026-08-03 13:45:00',
    config_version: '20260803-130000',
    config_sync_status: 'unknown',
    wal_backlog_bytes: 5368709120,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: 'remote write: connection reset by peer',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'offline',
        version: 'v1.2.0',
        config_version: '20260803-130000',
        last_error: 'remote write: connection reset by peer',
      },
      {
        type: 'collector',
        name: 'prometheus-agent',
        status: 'unknown',
        version: 'v2.54.0',
        config_version: '20260803-130000',
      },
    ],
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-03 13:50:00',
  },
  {
    id: 'ea-mfg-01',
    network_domain_id: 'manufacturing-edge',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-mfg-01',
    agent_ip: '192.168.10.11',
    status: 'online',
    last_heartbeat: '2026-08-03 14:25:00',
    heartbeat_rtt_ms: 88,
    last_config_pull: '2026-08-03 14:10:00',
    config_version: '20260803-140000',
    config_sync_status: 'in_sync',
    wal_backlog_bytes: 268435456,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-140000',
      },
      {
        type: 'collector',
        name: 'vmagent',
        status: 'running',
        version: 'v1.102.0',
        config_version: '20260803-140000',
      },
    ],
    created_at: '2026-07-20 00:00:00',
    updated_at: '2026-08-03 14:25:00',
  },
  {
    id: 'ea-gov-a-03',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-gova-03',
    agent_ip: '10.20.1.13',
    status: 'online',
    last_heartbeat: '2026-08-03 14:29:00',
    heartbeat_rtt_ms: 47,
    last_config_pull: '2026-08-03 14:20:00',
    config_version: '20260803-141500',
    config_sync_status: 'out_of_sync',
    wal_backlog_bytes: 524288,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error:
      '配置包 checksum 校验失败：metadata.json 联合 checksum 不匹配（期望 f4d2… 实际 3c7a…），已保留最后一份有效配置',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-141500',
        last_error:
          '配置包 checksum 校验失败：metadata.json 联合 checksum 不匹配（期望 f4d2… 实际 3c7a…），已保留最后一份有效配置',
      },
      {
        type: 'collector',
        name: 'vmagent',
        status: 'running',
        version: 'v1.102.0',
        config_version: '20260803-141500',
      },
      {
        type: 'blackbox_exporter',
        name: 'blackbox-exporter',
        status: 'running',
        version: 'v0.25.0',
        config_version: '20260803-141500',
      },
    ],
    created_at: '2026-07-16 00:00:00',
    updated_at: '2026-08-03 14:29:00',
  },
  {
    id: 'ea-mfg-02',
    network_domain_id: 'manufacturing-edge',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-mfg-02',
    agent_ip: '192.168.10.12',
    status: 'online',
    last_heartbeat: '2026-08-03 14:24:00',
    heartbeat_rtt_ms: 92,
    last_config_pull: '2026-08-03 14:05:00',
    config_version: '20260803-140000',
    config_sync_status: 'manual_override',
    wal_backlog_bytes: 134217728,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error:
      '本地手工修改 prometheus.yml（平台不强制回拉覆盖），需人工重新确认下发以恢复一致性',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-140000',
        last_error:
          '本地手工修改 prometheus.yml（平台不强制回拉覆盖），需人工重新确认下发以恢复一致性',
      },
      {
        type: 'collector',
        name: 'vmagent',
        status: 'running',
        version: 'v1.102.0',
        config_version: '20260803-140000',
      },
    ],
    created_at: '2026-07-21 00:00:00',
    updated_at: '2026-08-03 14:24:00',
  },
]

// prometheus.yml 为 file_sd 骨架（PRD 3.3 / 3.3.2）：仅含 job 结构（job_name / metrics_path / params / relabel / file_sd 引用），
// targets 列表统一放入 targets/*.json（file_sd_configs 引用，固定文件名覆盖写），不内联 static_configs。
const prometheusYmlDefault = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'default'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'http://localhost:8428/api/v1/write'

scrape_configs:
  - job_name: 'node-exporter'
    file_sd_configs:
      - files:
          - 'targets/node-exporter.json'

  - job_name: 'blackbox-tcp'
    metrics_path: /probe
    params:
      module: [tcp_connect]
    file_sd_configs:
      - files:
          - 'targets/blackbox-tcp.json'
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: 127.0.0.1:9115
`

const prometheusYmlGov = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'gov-cloud-a'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'https://metriccenter.example.com/api/v2/ingest/prometheus'
    headers:
      X-Network-Domain-Token: '***'

scrape_configs:
  - job_name: 'node-exporter'
    file_sd_configs:
      - files:
          - 'targets/node-exporter.json'

  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    file_sd_configs:
      - files:
          - 'targets/blackbox-http.json'
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: 127.0.0.1:9115
`

const prometheusYmlFinance = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'finance-dmz'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'https://metriccenter.example.com/api/v2/ingest/prometheus'
    headers:
      X-Network-Domain-Token: '***'

scrape_configs:
  - job_name: 'node-exporter'
    file_sd_configs:
      - files:
          - 'targets/node-exporter.json'
`

// 制造边缘域草稿：prometheus.yml 骨架合法（promtool 可通过），
// 语法错误体现在 targets/plc-gateway.json（JSON 数组未闭合），用于演示 configgen 侧 targets schema 校验失败（PRD 3.5.1）
const prometheusYmlMfgInvalid = `global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    network_domain: 'manufacturing-edge'
    tenant_id: 'platform_admin'

remote_write:
  - url: 'https://metriccenter.example.com/api/v2/ingest/prometheus'
    headers:
      X-Network-Domain-Token: '***'

scrape_configs:
  - job_name: 'node-exporter'
    file_sd_configs:
      - files:
          - 'targets/node-exporter.json'

  - job_name: 'plc-gateway'
    file_sd_configs:
      - files:
          - 'targets/plc-gateway.json'
`

// targets/*.json（file_sd 目标文件，PRD 6.2）：按 job 名组织；labels 为 LabelTemplate 静态展开的资源标签
// {v1.27} 对齐 Module_07 5.15 业务指标标签规范机制 A：app（app_name→app）/ biz（business_domain→biz）/ env / network_domain 注入（static_configs[].labels）
const targetsDefault: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['localhost:9100'],
      labels: { network_domain: 'default', app: 'app-center', biz: 'order', env: 'prod' },
    },
  ],
  'blackbox-tcp': [
    {
      targets: ['localhost:22'],
      labels: { network_domain: 'default', app: 'app-center', biz: 'order', env: 'prod' },
    },
  ],
}

// gov-cloud-a 基线版本：仅 1 台 node-exporter 实例
const targetsGovBaseline: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['10.0.1.10:9100'],
      labels: { network_domain: 'gov-cloud-a', app: 'app-gov-web', biz: 'data-api', env: 'prod' },
    },
  ],
  'blackbox-http': [
    {
      targets: ['https://api.example.com/health'],
      labels: { network_domain: 'gov-cloud-a', app: 'app-gov-web', biz: 'data-api', env: 'prod' },
    },
  ],
}

// gov-cloud-a 草稿：Resource#R-1024 新增实例 10.0.1.11（targets 变化，prometheus.yml 骨架不变，PRD 3.3 映射语义）
const targetsGovDraft: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['10.0.1.10:9100'],
      labels: { network_domain: 'gov-cloud-a', app: 'app-gov-web', biz: 'data-api', env: 'prod' },
    },
    {
      targets: ['10.0.1.11:9100'],
      labels: { network_domain: 'gov-cloud-a', app: 'app-gov-db', biz: 'data-api', env: 'prod' },
    },
  ],
  'blackbox-http': [
    {
      targets: ['https://api.example.com/health'],
      labels: { network_domain: 'gov-cloud-a', app: 'app-gov-web', biz: 'data-api', env: 'prod' },
    },
  ],
}

const targetsFinance: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['10.0.3.20:9100'],
      labels: { network_domain: 'finance-dmz', app: 'app-finance-pay', biz: 'payment', env: 'prod' },
    },
  ],
}

// 制造边缘域：node-exporter 正常；plc-gateway 文件故意未闭合（JSON 语法错误），
// 用于演示 configgen 侧 targets schema 校验失败（PRD 3.5.1：promtool 对 file_sd 内容不校验的缺口由生成器弥补）
const targetsMfg: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['192.168.10.20:9100'],
      labels: { network_domain: 'manufacturing-edge', app: 'app-mfg-line1', biz: 'manufacturing', env: 'prod' },
    },
  ],
  'plc-gateway': `[
  {
    "targets": ["192.168.10.30:9273"],
    "labels": {"network_domain": "manufacturing-edge", "app": "app-plc", "biz": "manufacturing", "env": "prod"}
  }`,
}

const rulesYml = `groups:
  - name: node.rules
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'High CPU usage on {{ $labels.instance }}'
`

// 规则变更草稿（draft-gov-002）用：HighCPUUsage 阈值 80 → 85（演示「告警规则变更 = high 风险」的确认场景）
const rulesYmlChanged = `groups:
  - name: node.rules
    rules:
      - alert: HighCPUUsage
        expr: 100 - (avg by (instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: 'High CPU usage on {{ $labels.instance }}'
`

const blackboxYml = `modules:
  tcp_connect:
    prober: tcp
    timeout: 5s
  http_2xx:
    prober: http
    timeout: 10s
`

export const configDrafts: ConfigDraft[] = [
  {
    id: 'draft-default-001',
    change_no: 'CHG-20260803-001',
    network_domain_id: 'default',
    source_version: '',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefault,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '初始生成',
      source_data_version: '2026-08-03 13:58:00',
      trigger_summary: '初始生成（无历史版本，系统初始化触发）',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefault),
      source_summary: 'ScrapeJob×2（node-exporter / blackbox-tcp）',
    },
    status: 'confirmed',
    validation_status: 'passed',
    validation_error: '',
    summary: '初始生成采集配置（node-exporter 主机采集 + blackbox-tcp 拨测）',
    change_items: [
      {
        type: 'add',
        target: 'scrape_job',
        description: '初始生成：node-exporter 主机采集与 blackbox-tcp 拨测',
        risk: 'low',
        affected_files: ['prometheus.yml', 'targets', 'blackbox.yml'],
      },
    ],
    created_at: '2026-08-03 14:00:00',
    updated_at: '2026-08-03 14:25:00',
    confirmed_by: 'system',
    confirmed_at: '2026-08-03 14:25:00',
  },
  // 自动丢弃演示（PRD 3.3.3 checksum 裁决）：源数据版本变化触发重算，但重算后联合 checksum
  // 与生效版本 cv-default-001 一致 → 草稿标记 discarded（自动丢弃），不进入人工确认列表
  {
    id: 'draft-default-002',
    change_no: 'CHG-20260803-002',
    network_domain_id: 'default',
    source_version: 'cv-default-001',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefault,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '内容无变化（联合 checksum 一致），自动丢弃，不进入人工确认',
      source_data_version: '2026-08-03 14:35:00',
      trigger_summary: 'LabelTemplate#LT-3 updated_at 变更（2026-08-03 14:35:00）触发重算，重算后联合 checksum 与生效版本 cv-default-001 一致 → 自动丢弃',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefault),
      source_summary: '重算结果与 cv-default-001 完全一致（联合 checksum 相同，无实际内容变化）',
    },
    status: 'discarded',
    validation_status: 'passed',
    validation_error: '',
    summary: '内容无变化，自动丢弃，无需确认',
    change_items: [],
    created_at: '2026-08-03 14:35:00',
    updated_at: '2026-08-03 14:35:00',
  },
  {
    id: 'draft-gov-001',
    change_no: 'CHG-20260803-003',
    network_domain_id: 'gov-cloud-a',
    source_version: 'cv-gov-001',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsGovDraft,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '新增节点实例',
      source_data_version: '2026-08-03 14:08:00',
      trigger_summary: 'Resource#R-1024 updated_at 变更（2026-08-03 14:08:00）触发重算',
      checksum: computeJointChecksum(prometheusYmlGov, rulesYml, blackboxYml, targetsGovDraft),
      source_summary: 'ScrapeJob#node-exporter 目标 +1（10.0.1.11），targets/node-exporter.json 更新（prometheus.yml 骨架不变）',
    },
    status: 'pending',
    validation_status: 'passed',
    validation_error: '',
    summary: '新增 1 台服务器（10.0.1.11）加入 node-exporter 采集',
    change_items: [
      {
        type: 'add',
        target: 'scrape_target',
        description: 'node-exporter 新增实例 10.0.1.11:9100（app-gov-db）',
        risk: 'low',
        affected_files: ['targets'],
      },
    ],
    created_at: '2026-08-03 14:10:00',
    updated_at: '2026-08-03 14:10:00',
  },
  // 规则变更演示（决策 18）：HighCPUUsage 阈值 80 → 85，告警规则变更为 high 风险，进入待确认列表
  {
    id: 'draft-gov-002',
    change_no: 'CHG-20260803-004',
    network_domain_id: 'gov-cloud-a',
    source_version: 'cv-gov-002',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYmlChanged,
    blackbox_yml: blackboxYml,
    targets_files: targetsGovDraft,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '规则阈值调整',
      source_data_version: '2026-08-03 14:40:00',
      trigger_summary: 'MonitoringRule#HighCPUUsage updated_at 变更（2026-08-03 14:40:00）触发重算',
      checksum: computeJointChecksum(prometheusYmlGov, rulesYmlChanged, blackboxYml, targetsGovDraft),
      source_summary: 'MonitoringRule#HighCPUUsage 阈值由 80 调整为 85（rules.yml 更新，prometheus.yml / targets 不变）',
    },
    status: 'pending',
    validation_status: 'passed',
    validation_error: '',
    summary: 'HighCPUUsage 告警规则阈值由 80 调整为 85',
    change_items: [
      {
        type: 'modify',
        target: 'alert_rule',
        description: 'HighCPUUsage 阈值由 80 调整为 85（severity=warning）',
        risk: 'high',
        affected_files: ['rules.yml'],
      },
    ],
    created_at: '2026-08-03 14:42:00',
    updated_at: '2026-08-03 14:42:00',
  },
  {
    id: 'draft-mfg-001',
    change_no: 'CHG-20260803-005',
    network_domain_id: 'manufacturing-edge',
    source_version: '',
    prometheus_yml: prometheusYmlMfgInvalid,
    rules_yml: rulesYml,
    blackbox_yml: '',
    targets_files: targetsMfg,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '工厂边缘网关新增 plc-gateway 采集',
      source_data_version: '2026-08-03 14:20:00',
      trigger_summary: 'LabelTemplate#LT-7 updated_at 变更（2026-08-03 14:20:00）触发重算',
      checksum: computeJointChecksum(prometheusYmlMfgInvalid, rulesYml, '', targetsMfg),
      source_summary: 'ScrapeJob#plc-gateway 新增，targets/plc-gateway.json 语法错误（JSON 数组未闭合）',
    },
    status: 'pending',
    validation_status: 'failed',
    validation_error:
      '中心内容校验失败：configgen 侧 targets schema 校验失败：targets/plc-gateway.json 解析失败（JSON 数组未闭合，unexpected end of input）；prometheus.yml 骨架本身可过 promtool 校验（file_sd 仅查文件存在性），草稿保持待确认，不进入下发流程',
    summary: '新增 plc-gateway 采集（校验未通过，待修复）',
    change_items: [
      {
        type: 'add',
        target: 'scrape_job',
        description: '新增 plc-gateway 采集（192.168.10.30:9273）',
        risk: 'low',
        affected_files: ['prometheus.yml', 'targets'],
      },
    ],
    created_at: '2026-08-03 14:22:00',
    updated_at: '2026-08-03 14:22:00',
  },
  {
    id: 'draft-finance-001',
    change_no: 'CHG-20260803-006',
    network_domain_id: 'finance-dmz',
    source_version: 'cv-finance-001',
    prometheus_yml: prometheusYmlFinance,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsFinance,
    metadata: {
      generated_by: 'user',
      generator_version: 'configgen v1.7.0',
      reason: '人工调整',
      source_data_version: '2026-08-03 13:25:00',
      trigger_summary: '人工调整（运维工程师手动触发生成）',
      checksum: computeJointChecksum(prometheusYmlFinance, rulesYml, blackboxYml, targetsFinance),
      source_summary: 'MonitoringRule#HighCPUUsage 阈值调整',
    },
    status: 'discarded',
    validation_status: 'passed',
    validation_error: '',
    summary: 'HighCPUUsage 告警规则阈值调整（已废弃）',
    change_items: [
      {
        type: 'modify',
        target: 'alert_rule',
        description: 'HighCPUUsage 阈值由 80 调整为 85（人工调整，后废弃）',
        risk: 'high',
        affected_files: ['rules.yml'],
      },
    ],
    created_at: '2026-08-03 13:30:00',
    updated_at: '2026-08-03 13:45:00',
  },
]

export const configVersions: ConfigVersion[] = [
  {
    id: 'cv-default-001',
    network_domain_id: 'default',
    draft_id: 'draft-default-001',
    change_no: 'CHG-20260803-001',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefault,
    metadata: {
      version_note: 'initial',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefault),
      source_data_version: '2026-08-03 13:58:00',
    },
    created_at: '2026-08-03 14:25:00',
    created_by: 'system',
  },
  {
    id: 'cv-gov-001',
    network_domain_id: 'gov-cloud-a',
    draft_id: 'draft-gov-001',
    change_no: 'CHG-20260803-003',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsGovBaseline,
    metadata: {
      version_note: 'baseline',
      checksum: computeJointChecksum(prometheusYmlGov, rulesYml, blackboxYml, targetsGovBaseline),
      source_data_version: '2026-08-03 13:58:00',
    },
    created_at: '2026-08-03 14:00:00',
    created_by: 'system',
  },
  {
    id: 'cv-gov-002',
    network_domain_id: 'gov-cloud-a',
    draft_id: 'draft-gov-001',
    change_no: 'CHG-20260803-003',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsGovDraft,
    metadata: {
      version_note: 'add second node',
      checksum: computeJointChecksum(prometheusYmlGov, rulesYml, blackboxYml, targetsGovDraft),
      source_data_version: '2026-08-03 14:08:00',
    },
    created_at: '2026-08-03 14:20:00',
    created_by: 'system',
  },
  {
    id: 'cv-finance-001',
    network_domain_id: 'finance-dmz',
    draft_id: 'draft-finance-001',
    change_no: 'CHG-20260803-006',
    prometheus_yml: prometheusYmlFinance,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsFinance,
    metadata: {
      version_note: 'baseline',
      checksum: computeJointChecksum(prometheusYmlFinance, rulesYml, blackboxYml, targetsFinance),
      source_data_version: '2026-08-03 13:25:00',
    },
    created_at: '2026-08-03 13:45:00',
    created_by: 'admin',
  },
]

export const configDeployments: ConfigDeployment[] = [
  {
    id: 'deploy-001',
    network_domain_id: 'default',
    config_version_id: 'cv-default-001',
    source_change_no: 'CHG-20260803-001',
    target_type: 'central_prometheus',
    target_address: 'metric-center-local',
    status: 'success',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: true,
    error_message: '',
    triggered_by: 'system',
    triggered_at: '2026-08-03 14:25:10',
    completed_at: '2026-08-03 14:25:12',
    created_at: '2026-08-03 14:25:10',
  },
  {
    id: 'deploy-002',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-001',
    source_change_no: 'CHG-20260803-003',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-01',
    status: 'success',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: '',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:15:10',
    completed_at: '2026-08-03 14:15:20',
    created_at: '2026-08-03 14:15:10',
  },
  {
    id: 'deploy-003',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-002',
    source_change_no: 'CHG-20260803-003',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-02',
    status: 'failed',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: 'config reload: timeout waiting for response',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:20:10',
    completed_at: '2026-08-03 14:21:10',
    created_at: '2026-08-03 14:20:10',
  },
  {
    id: 'deploy-004',
    network_domain_id: 'finance-dmz',
    config_version_id: 'cv-finance-001',
    source_change_no: 'CHG-20260803-006',
    target_type: 'edge_agent',
    target_address: 'edge-agent-finance-01',
    status: 'failed',
    validation_status: 'failed',
    validation_error: 'blackbox_exporter --config.check 校验失败：模块 http_2xx 定义非法（prober 参数缺失）',
    includes_blackbox: true,
    error_message: 'blackbox_exporter --config.check 校验失败：模块 http_2xx 定义非法（prober 参数缺失）',
    triggered_by: 'system',
    triggered_at: '2026-08-03 13:45:10',
    completed_at: '2026-08-03 13:45:15',
    created_at: '2026-08-03 13:45:10',
  },
  {
    id: 'deploy-005',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-001',
    source_change_no: 'CHG-20260803-003',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-02',
    status: 'rolled_back',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: '',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:05:10',
    completed_at: '2026-08-03 14:06:00',
    created_at: '2026-08-03 14:05:10',
  },
  {
    id: 'deploy-006',
    network_domain_id: 'manufacturing-edge',
    config_version_id: 'cv-default-001',
    source_change_no: 'CHG-20260803-001',
    target_type: 'edge_agent',
    target_address: 'edge-agent-mfg-01',
    status: 'success',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: '',
    triggered_by: 'system',
    triggered_at: '2026-08-03 14:10:10',
    completed_at: '2026-08-03 14:10:18',
    created_at: '2026-08-03 14:10:10',
  },
  {
    id: 'deploy-007',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-002',
    source_change_no: 'CHG-20260803-003',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-01',
    status: 'failed',
    validation_status: 'failed',
    validation_error:
      'promtool check config 校验失败：parse error: unexpected token "targets"（本地配置已被手工兜底修改，与期望态不一致）',
    includes_blackbox: false,
    error_message: 'promtool check config 校验失败：parse error: unexpected token "targets"',
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:30:10',
    completed_at: '2026-08-03 14:30:11',
    created_at: '2026-08-03 14:30:10',
  },
]

// 变更检测状态（PRD 3.3.3「检测状态可观测」P1）：每个网域最近一次轮询的检测结果，
// 三种结果均有演示：changes_found（gov / mfg）/ no_change（finance）/ checksum_same（default，与 draft-default-002 联动）
export const changeDetectionStatus: ChangeDetectionStatus[] = [
  {
    network_domain_id: 'default',
    last_checked_at: '2026-08-03 14:35:30',
    source_data_version: '2026-08-03 14:35:00',
    outcome: 'checksum_same',
    generated_drafts: [],
    summary:
      '源数据版本变化（LabelTemplate#LT-3，14:35:00）触发重算，重算后联合 checksum 与生效版本 cv-default-001 一致 → 内容无变化，自动丢弃（draft-default-002），不进入确认',
  },
  {
    network_domain_id: 'gov-cloud-a',
    last_checked_at: '2026-08-03 14:09:30',
    source_data_version: '2026-08-03 14:08:00',
    outcome: 'changes_found',
    generated_drafts: [
      {
        id: 'draft-gov-001',
        trigger_summary: 'Resource#R-1024 updated_at 变更（2026-08-03 14:08:00）触发重算',
      },
    ],
    summary: '本轮检测到变更：生成 draft-gov-001（targets/node-exporter.json 新增实例 10.0.1.11），进入确认列表',
  },
  {
    network_domain_id: 'manufacturing-edge',
    last_checked_at: '2026-08-03 14:21:30',
    source_data_version: '2026-08-03 14:20:00',
    outcome: 'changes_found',
    generated_drafts: [
      {
        id: 'draft-mfg-001',
        trigger_summary: 'LabelTemplate#LT-7 updated_at 变更（2026-08-03 14:20:00）触发重算',
      },
    ],
    summary: '本轮检测到变更：生成 draft-mfg-001（新增 plc-gateway 采集），进入确认列表（targets schema 校验失败，待修复）',
  },
  {
    network_domain_id: 'finance-dmz',
    last_checked_at: '2026-08-03 14:36:00',
    source_data_version: '2026-08-03 13:25:00',
    outcome: 'no_change',
    generated_drafts: [],
    summary: '源数据版本未变化（14:36:00 轮询）→ 本轮无变更，跳过重算',
  },
]

// Edge Agent 离线交付安装指引（PRD 3.9 / 6.3）：网域注册后引导运维线下安装，心跳自动认领
export interface EdgeAgentInstallGuideComponent {
  /** 组件名称 */
  name: string
  /** 组件职责 */
  role: string
  /** 是否必装：Edge Sync Agent 与采集器必装，blackbox exporter 可选 */
  required: boolean
}

export interface EdgeAgentInstallGuide {
  /** 部署定位（决策 9）：边缘监控代理节点的独立客户端程序，outbound HTTPS 443 + 每网域 Token 通信 */
  deployment: string
  /** 边缘节点组件构成（v1.6）：Edge Sync Agent（必装独立组件）+ 采集器（vmagent/prometheus-agent）+ blackbox exporter（可选） */
  components: EdgeAgentInstallGuideComponent[]
  /** 一体化交付 + 职责边界（v1.8/PRD v1.12）：离线二进制包为一体化包，Agent 负责本节点组件生命周期管理；不做下游节点 exporter 安装 */
  integration_note: string
  /** 交付方式（政务/金融专网默认离线二进制包 + systemd，不提供 curl | bash 一键脚本） */
  delivery: string
  checksum_algorithm: string
  systemd_unit: string
  env_vars: { NETWORK_DOMAIN_ID: string; TOKEN: string }
  steps: { title: string; description: string }[]
}

export const edgeAgentInstallGuide: EdgeAgentInstallGuide = {
  deployment:
    'Edge Sync Agent 是部署在边缘监控代理节点的独立客户端程序（非中心平台内置进程）；与中心通过 outbound HTTPS 443 + 每网域 Token 通信，心跳 / 配置拉取 / remote_write 全部由边缘主动出站，中心无入站端口；MVP 单网域不部署，v0.2+ 多网域模式下每个边缘节点部署一个（离线二进制包 + systemd 交付）',
  components: [
    {
      name: 'Edge Sync Agent',
      role: '必装独立组件：部署在边缘节点的客户端程序，非中心平台内置；负责与中心通信（outbound HTTPS 443 + 每网域 Token 的心跳 / 配置拉取）、管理本节点采集器与 blackbox exporter 进程（部署 / 守护 / reload）',
      required: true,
    },
    {
      name: '采集器（vmagent / prometheus-agent）',
      role: '由网域 agent_type 登记，二选一；负责抓取与 remote_write，由 Edge Sync Agent 自动部署并守护（一体化离线包自带，非手动安装）',
      required: true,
    },
    {
      name: 'blackbox exporter',
      role: '可选：网域存在 job_type=blackbox 的 ScrapeJob 时随一体化离线包附带，由 Edge Sync Agent 部署守护',
      required: false,
    },
  ],
  integration_note:
    '离线二进制包为一体化包（Edge Sync Agent + 采集器 vmagent/prometheus-agent 二选一 + blackbox exporter 可选），安装后由 Edge Sync Agent 自动部署并管理本节点采集器/blackbox 进程（启动守护、健康检查、配置包更新 reload、进程异常自动重启），无需手动分别安装采集器；启动顺序 blackbox exporter → 采集器。职责边界：Edge Sync Agent 只管理本节点组件，不做下游节点 exporter 安装（安全边界，暂不纳入）。',
  delivery:
    '离线二进制包 + systemd 服务文件（物理隔离政务网/金融专网默认交付方式；当网域存在 blackbox 拨测 Job 时，离线包同时包含 blackbox exporter 二进制并配置 setcap cap_net_raw+ep）',
  checksum_algorithm: 'sha256',
  systemd_unit: '/etc/systemd/system/metric-center-edge-agent.service',
  env_vars: {
    NETWORK_DOMAIN_ID: '网域 ID（本页注册生成）',
    TOKEN: '网域认证 Token（本页生成/重置）',
  },
  steps: [
    {
      title: '下载并校验一体化离线包',
      description:
        '一体化离线包包含 Edge Sync Agent + 采集器（MVP 固定 vmagent；prometheus-agent v0.2+ 开放）+ blackbox exporter（可选，blackbox 拨测 Job 时附带）；下载后校验 sha256 校验和，确认包完整性。',
    },
    {
      title: '配置 NETWORK_DOMAIN_ID / TOKEN 环境变量',
      description:
        '在边缘节点配置环境变量（或写入 systemd 环境文件）：NETWORK_DOMAIN_ID=本页注册的网域 ID，TOKEN=本页生成/重置的网域认证 Token。',
    },
    {
      title: '启动 Edge Sync Agent（systemd）',
      description:
        '启动 systemd 服务（metric-center-edge-agent）。Agent 启动后自动部署并守护本节点采集器（vmagent）与 blackbox exporter（可选）进程：启动顺序 blackbox → 采集器，健康检查、配置包更新 reload、进程异常自动重启；无需手动安装采集器。',
    },
  ],
}
