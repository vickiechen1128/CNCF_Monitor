export type NetworkDomainStatus = 'online' | 'offline' | 'unknown'
export type DomainType = 'management' | 'edge'
export type AgentType = 'vmagent' | 'prometheus-agent'
/**
 * 下发通道（{v1.33}/{v1.34} 决策 31/32/33）：
 * - `local`：采集器与中心同机/同 Pod，中心直接写盘并 reload（MVP 固定 `default` 域）
 * - `agent_pull`：采集器位于中心无法直接触及的远端节点（隔离网域等），由 Edge Sync Agent 心跳拉取 zip 配置包
 * 通道绑定到**采集节点位置**而非域类型（决策 32）；MVP 按网域固定、不提供切换、不支持同域混合通道（决策 33）。
 */
export type Channel = 'local' | 'agent_pull'
/** {v1.29} 网域生命周期状态：created = 已由 Module_06 行政创建但未纳管监控；monitored = 已完成监控纳管 */
export type NetworkDomainRegistrationStatus = 'created' | 'monitored'
/** {v1.37} 配置同步状态（决策 37-1）：in_sync / out_of_sync / unknown / manual_override / no_version（未下发配置：网域尚无成功下发过的 ConfigVersion）；`channel=local` 网域由下发记录派生，`channel=agent_pull` 网域由心跳回执派生 */
export type ConfigSyncStatus = 'in_sync' | 'out_of_sync' | 'unknown' | 'manual_override' | 'no_version'
/** {v1.40} 未同步成因（决策 40-1）：`out_of_sync` 时的引导成因（仅 out_of_sync 有值）——pending_draft=中心存在待确认变更草稿（→「前往配置确认」）/ pull_pending=无待确认变更、Agent 拉包/生效延迟（→ 纯展示等待 +「查看下发记录」）/ local_reset=Agent 本地环境/地址变化、checksum 校验失败保留旧配置、人工覆盖后恢复一致性（→「立即同步」） */
export type OutOfSyncCause = 'pending_draft' | 'pull_pending' | 'local_reset'
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
  /** 组件最近错误（如配置 reload 失败 / 拉包校验失败 / 人工覆盖提示） */
  last_error?: string
}
export type ConfigDraftStatus = 'pending' | 'confirmed' | 'discarded'
export type DraftValidationStatus = 'passed' | 'failed' | 'pending'
/** {v1.39 决策 39-1/39-3} 校验失败归因分类：user_config=用户配置问题 / platform_fault=平台技术故障 */
export type ValidationCause = 'user_config' | 'platform_fault'
/**
 * {v1.39 决策 39-1} 校验失败定位详情（行内 Popover 展示：失败文件 + 行号 + 错误信息）：
 * 用户配置问题定位到 M01 / M07 对应 Job / 规则修复；平台技术故障仅提示（不提供用户修复动作）
 */
export interface ValidationErrorDetail {
  file: string
  line?: number
  message: string
}
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
  /**
   * 下发通道（{v1.33}/{v1.34} 决策 31/32/33）：`local`（中心同机写盘 reload）/ `agent_pull`（Edge Sync Agent 心跳拉包）；
   * MVP 按网域固定（`default` 域 = `local`，其他网域 = `agent_pull`），不提供切换（决策 33）；
   * `channel` 决定哪些字段必填 / 展示（Token / Agent 类型 / Remote Write URL / 运行态心跳字段 / 安装指引仅 `agent_pull` 展示）。
   */
  channel: Channel
  /**
   * 网络区域类型（{v1.31}，M06 行政字段，纳管只读引用）：网络隔离/位置语义分类，
   * 值集为部署级字典（政务云预置 `internet` 互联网区 / `extranet` 政务外网区等，公有云预置 region 列表）；
   * 配置生成时注入 `external_labels.zone_type`（PRD 4.1 / 9.2）。
   */
  zone_type: string
  /**
   * 中心接入地址（{v1.31}）：该网域视角的中心可达地址（如 `https://10.8.0.5:8443`，
   * 网闸/防火墙地址映射后的地址）；`domain_type=edge` 纳管时必填，由运维按该区网闸策略填写，
   * 用于合成心跳响应中的配置包绝对下载地址（PRD 6.1）；管理域（default）为空。
   */
  center_endpoint: string
  /** {v1.33} 认证 Token（脱敏展示）：`channel=agent_pull` 时必填（纳管时自动签发）；`channel=local` 时为空且不展示 */
  token: string
  /** {v1.33} Agent 类型：`channel=agent_pull` 时必填（采集器类型）；`channel=local` 时为空 */
  agent_type: AgentType | ''
  /** {v1.33} 该网域 Agent Remote Write 目标地址（PRD 4.1）：语义为该网域视角的可达地址（网闸映射后地址），非中心自认地址；`channel=agent_pull` 时必填，`channel=local` 时为空 */
  remote_write_url: string
  /** {v1.33} 状态（运行态字段）：`channel=agent_pull` 时由心跳上报更新；`channel=local` 时为空 */
  status: NetworkDomainStatus | ''
  /** {v1.33} 最后心跳（运行态字段）：`channel=agent_pull` 时由心跳上报更新；`channel=local` 时为空 */
  last_heartbeat: string
  /** {v1.33} Agent 版本（运行态字段）：`channel=agent_pull` 时由心跳上报更新；`channel=local` 时为空 */
  agent_version: string
  /** {v1.29} 网域生命周期：created（仅行政创建）/ monitored（已监控纳管） */
  registration_status: NetworkDomainRegistrationStatus
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
  /** {v1.40} 未同步成因（决策 40-1）：`out_of_sync` 时的引导成因（仅 out_of_sync 有值）；由心跳回执的拉包结果与中心待确认变更草稿联合判定（见 PRD 4.8 ③） */
  out_of_sync_cause?: OutOfSyncCause
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
   * {v1.39 决策 39-1/39-3} 校验失败归因分类：user_config=用户配置问题（行内展示「重新校验」+「前往修改」跳 M01 修复源数据）；
   * platform_fault=平台技术故障（校验层自动重试、用户无感，仅提示联系平台侧，不展示「重新校验」）
   */
  validation_cause?: ValidationCause
  /** {v1.39 决策 39-1} 校验失败定位详情（失败文件 + 行号 + 错误信息），行内 Popover 展示；详细校验信息一律在行内，不进抽屉 */
  validation_details?: ValidationErrorDetail[]
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
  /** 下发通道（{v1.33}）：`local`（中心直接 reload）/ `agent_pull`（Edge Sync Agent 拉包），与对应 NetworkDomain.channel 一致 */
  channel: Channel
  target_type: DeploymentTargetType
  target_address: string
  status: DeploymentStatus
  /** 下发前校验结果（PRD 3.5.1），失败时 error_message 记录校验失败原因 */
  validation_status: DeploymentValidationStatus
  validation_error: string
  /** 本次下发配置包是否包含 blackbox.yml（PRD 4.5） */
  includes_blackbox: boolean
  error_message: string
  /** {v1.37} 下发失败后的重试次数（决策 37-2）：0=未重试；重试复用本记录（failed → running → success/failed） */
  retry_count: number
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

// 当前租户上下文（决策 31）：multi_site_enabled 为 M06 租户级行政能力开关，不在 UI 提供运行时切换；
// 页面入口与字段展示由数据驱动（Agent 状态入口按 EdgeAgent 实例存在性、字段按下发通道）
export const currentTenant: Tenant = {
  id: 'platform_admin',
  name: '平台默认租户',
  multi_site_enabled: true,
}

// ---------- 用户角色（动线分离演示：本模块按用户职责区分运维工程师1/2） ----------
export type UserRole = 'ops1' | 'ops2'
export const USER_ROLE_MAP: Record<UserRole, string> = {
  ops1: '运维工程师1',
  ops2: '运维工程师2',
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
 * 纳管网域时默认按「中心 ingress 地址 + 网域路径」自动生成（可手动覆盖），减少人工填写项；
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

/**
 * 审批分级策略（{v1.32} M01/M08/M09 告警规则职责重构，PRD 3.4）：
 * - 人工确认（go/no-go）：prometheus.yml、targets/*.json、rules.yml、blackbox.yml 的变更进入待确认列表；
 * - 自动生效：alertmanager.yml 由 Module_08 直接写文件并触发 Alertmanager reload，不进入本模块 ConfigDraft / 配置变更确认流程；
 * - 混单规则：若某次变更同时涉及人工确认文件与 alertmanager.yml（防御性说明），按高风险文件走人工确认。
 * 原因：通知路由/接收人/静默/抑制调整频繁、风险低（仅影响告警体验，不影响采集/规则求值），且 M08 是 Alertmanager 配置的唯一 Owner。
 */
export const approvalTieringNote = {
  manual:
    '人工确认（go/no-go）：prometheus.yml、targets/*.json、rules.yml、blackbox.yml 的变更进入待确认列表，由运维审批后发布',
  auto:
    '自动生效：alertmanager.yml 由 Module_08（告警收敛与通知管理）直接写文件并触发 Alertmanager reload，不进入本模块变更单 / 配置变更确认流程',
  mixed:
    '混单规则：若某次变更同时涉及人工确认文件与 alertmanager.yml（防御性说明），按高风险文件走人工确认',
  reason:
    '原因：通知路由 / 接收人 / 静默 / 抑制调整频繁、风险低（仅影响告警体验，不影响采集 / 规则求值），且 Module_08 是 Alertmanager 配置的唯一 Owner',
}

/**
 * change_status 全链路回写 M01（{v1.43} 联动 M01 草稿，PRD 3.3/3.4/3.5，M01 侧 v3.22 演示）：
 * - ConfigDraft 生成 → 回写 pending（待确认）；
 * - ConfigDraft 确认并生成 ConfigVersion → 回写 confirmed（已确认）；
 * - ConfigDeployment.status=success（local reload 成功 / agent_pull 被 Edge Agent 成功应用）→ 回写 deployed（v0.2 起精确回写）；
 *   MVP 阶段 deployed 由 none 占位，即确认下发成功后直接回写 none（M01 列表「下发状态=无变更」）；
 * - 无相关在途变更 → 回写 none。
 */
export const changeStatusEnumDemo = {
  pending: 'pending 待确认：ConfigDraft 生成后回写，M01 列表「下发状态=待确认」',
  confirmed: 'confirmed 已确认：ConfigDraft 确认并生成 ConfigVersion 后回写',
  deployed:
    'deployed 已下发（v0.2 起精确回写）：ConfigDeployment.status=success 后回写；MVP 阶段由 none 占位，即确认下发成功后直接回写 none',
  none: 'none 无变更：无相关在途变更时回写，M01 列表「下发状态=无变更」',
}

/**
 * 网闸 / 隔离区连接约束（{v1.31}，强制，PRD §6）：在政务云等网闸隔离场景
 * （互联网区 ↔ 政务外网区，双向网闸地址策略不同）下，禁止任何中心 → 边缘方向的主动连接——
 * 所有交互（心跳、配置拉取、指标 remote_write）一律由边缘 Agent 向中心发起（pull / push 上行）；
 * 中心侧不实现也不保留「主动触达边缘」的能力（如主动 reload、主动探测）。
 * 所有面向边缘的地址均为「该网域视角的可达地址」（网闸地址映射后的地址），不是中心自认地址。
 */
export const gatewayConstraintNote =
  '网闸 / 隔离区连接约束（强制）：禁止任何中心 → 边缘方向的主动连接，所有交互（心跳 / 配置拉取 / 指标回传）一律由边缘 Agent 向中心发起（pull / push 上行），中心无入站端口；面向边缘的地址均为该网域视角的可达地址（网闸映射后地址），配置拉取地址由网域级 center_endpoint + 相对路径合成绝对地址下发给 Agent'

/**
 * rules.yml 分组派生（{v1.32}，PRD 3.3）：M09 读取 MonitoringRule 后按 Prometheus `group` 语法组织 rules.yml，
 * group 由 M09 内部自动派生（默认按 resource_type 或 rule_type 聚类），MVP 不暴露用户可管理的 RuleGroup 实体；
 * 按规则作用域生成：中心域（default）包含 scope=central/both 规则，边缘域仅当存在 scope=edge/both 规则时
 * （v0.4+）随配置包生成，MVP 阶段由中心统一求值。
 */
export const rulesGroupDerivationNote =
  'rules.yml 按 Prometheus group 语法组织：分组由配置中心内部自动派生（默认按 resource_type / rule_type 聚类），MVP 不暴露用户可管理的规则分组实体；按规则作用域生成——中心域（default）包含 scope=central/both 规则，边缘域仅当存在 scope=edge/both 规则时（v0.4+）随配置包下发，MVP 阶段由中心统一求值'

/**
 * 配置包绝对下载地址合成（{v1.31}，PRD 6.1）：返回绝对地址 = 该网域 center_endpoint
 * （该网域视角的中心可达地址，网闸映射后地址）+ 固定相对路径 /api/v2/platform/edge/config?network_domain=<id>；
 * 禁止返回相对路径由 Agent 自行拼接（网闸场景下 Agent 无法推导中心映射地址）。
 * center_endpoint 缺失（如管理域）时不走本协议。
 */
export function deriveConfigDownloadUrl(domain: Pick<NetworkDomain, 'id' | 'center_endpoint'>): string {
  if (!domain.center_endpoint) return ''
  return `${domain.center_endpoint}/api/v2/platform/edge/config?network_domain=${domain.id}`
}

export const networkDomains: NetworkDomain[] = [
  {
    id: 'default',
    name: 'default',
    description: '默认中心管理域，承载单机与中心采集模式；可修改名称以匹配云区域命名',
    domain_type: 'management',
    tenant_id: 'platform_admin',
    // {v1.33}/{v1.34} default 固定 channel=local（决策 32/33）：中心直接采集，不部署 Edge Agent
    channel: 'local',
    // {v1.31} 管理域（default）由中心直接采集，无网闸拓扑：zone_type 为空、center_endpoint 为空（不走边缘协议）
    zone_type: '',
    center_endpoint: '',
    // {v1.33} channel=local：不生成 Token / Agent 类型 / Remote Write / 运行态心跳字段（PRD 4.1 为空且不展示）
    token: '',
    agent_type: '',
    remote_write_url: '',
    status: '',
    last_heartbeat: '',
    agent_version: '',
    registration_status: 'monitored',
    created_at: '2026-07-01 00:00:00',
    updated_at: '2026-08-03 14:30:00',
  },
  {
    id: 'gov-cloud-a',
    name: '政务网 A 区',
    description: '物理隔离政务网，通过 Edge Agent 单向 HTTPS 出站接入',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    // {v1.33}/{v1.34} 非 default 网域固定 channel=agent_pull（决策 33）
    channel: 'agent_pull',
    // {v1.31} 政务外网区（M06 行政登记）；center_endpoint 为网闸映射后的中心可达地址，用于合成配置包绝对下载地址
    zone_type: 'extranet',
    center_endpoint: 'https://10.8.0.5:8443',
    token: 'tk_gova_7g8h9i0j1k2l',
    agent_type: 'vmagent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'online',
    last_heartbeat: '2026-08-03 14:28:00',
    agent_version: 'v1.102.0',
    registration_status: 'monitored',
    created_at: '2026-07-10 00:00:00',
    updated_at: '2026-08-03 14:28:00',
  },
  {
    id: 'finance-dmz',
    name: '金融 DMZ',
    description: '金融专网 DMZ 区，部署 Prometheus Agent Mode',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    // {v1.33}/{v1.34} 非 default 网域固定 channel=agent_pull（决策 33）
    channel: 'agent_pull',
    // {v1.31} 互联网区（M06 行政登记）；center_endpoint 为网闸映射后的中心可达地址
    zone_type: 'internet',
    center_endpoint: 'https://10.30.2.100:8443',
    token: 'tk_finance_3m4n5o6p7q8r',
    agent_type: 'prometheus-agent',
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    status: 'offline',
    last_heartbeat: '2026-08-03 13:50:00',
    agent_version: 'v2.54.0',
    registration_status: 'monitored',
    created_at: '2026-07-12 00:00:00',
    updated_at: '2026-08-03 13:50:00',
  },
  {
    id: 'manufacturing-edge',
    name: '制造边缘节点',
    description: '工厂边缘网关，网络不稳定，启用 WAL 本地缓冲',
    domain_type: 'edge',
    tenant_id: 'platform_admin',
    // {v1.33}/{v1.34} 非 default 网域固定 channel=agent_pull（决策 33）；未纳管（created）时监控参数为空
    channel: 'agent_pull',
    // {v1.31} 未登记 zone_type（M06 未配置）→ 不注入 external_labels.zone_type（PRD 9.2「登记了 zone_type 时同步注入」）
    zone_type: '',
    center_endpoint: '',
    token: '',
    agent_type: '',
    remote_write_url: '',
    status: '',
    last_heartbeat: '',
    agent_version: '',
    registration_status: 'created',
    created_at: '2026-07-20 00:00:00',
    updated_at: '2026-08-03 14:25:00',
  },
]

/**
 * 配置产物形态分层（决策 6 / 决策 32）：按下发通道区分——`channel=local`（如 default）=本地文件集
 * （写入中心 Prometheus 配置目录，无 zip / metadata.json 下载校验）；`channel=agent_pull`=zip 配置包
 * （含 metadata.json 供拉取后 checksum 校验）。分层依据是**下发通道**（`local` / `agent_pull`）而非域类型（决策 32）。
 */
export type ConfigArtifactShape = 'local_files' | 'zip_package'

export function domainArtifactShape(domain: Pick<NetworkDomain, 'channel'>): ConfigArtifactShape {
  return domain.channel === 'agent_pull' ? 'zip_package' : 'local_files'
}

/** 下发通道中文语义（决策 31/32/33）：用户可见文案，不含实现层决策引用 */
export const channelLabel: Record<Channel, string> = {
  local: 'local',
  agent_pull: 'agent_pull',
}

export const channelTip: Record<Channel, string> = {
  local: '采集器与中心同机/同 Pod，中心直接写盘并 reload（如默认 default 网域）；无 Edge Agent / Token / 安装指引',
  agent_pull: '采集器位于远端/隔离节点，由 Edge Sync Agent 心跳拉取 zip 配置包（Token 认证 + checksum 校验）',
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
    // {v1.41} 采集器已停止（组件健康问题）：配置版本已同步（in_sync），不产生配置同步引导按钮；
    // 整体状态=部分异常，用户从详情抽屉查看组件错误 + 维修提示（进程异常 ≠ 配置未同步）
    config_sync_status: 'in_sync',
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
    // {v1.40} 决策 40-1 成因 C（local_reset）：Agent 本地 checksum 校验失败保留旧配置 →「立即同步」强制重新拉包（无视版本一致 304）
    config_sync_status: 'out_of_sync',
    out_of_sync_cause: 'local_reset',
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
    id: 'ea-gov-a-04',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-gova-04',
    agent_ip: '10.20.1.14',
    status: 'online',
    last_heartbeat: '2026-08-03 14:31:00',
    heartbeat_rtt_ms: 50,
    last_config_pull: '2026-08-03 14:12:00',
    config_version: '20260803-141500',
    config_sync_status: 'manual_override',
    wal_backlog_bytes: 262144,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '本地手工修改 prometheus.yml（平台不强制回拉覆盖），需人工重新确认下发以恢复一致性',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-141500',
        last_error: '本地手工修改 prometheus.yml（平台不强制回拉覆盖），需人工重新确认下发以恢复一致性',
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
    created_at: '2026-07-22 00:00:00',
    updated_at: '2026-08-03 14:31:00',
  },
  {
    // {v1.37} no_version（未下发配置）演示：Agent 已上线（心跳正常）但网域尚无成功下发的 ConfigVersion
    id: 'ea-gov-a-05',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-gova-05',
    agent_ip: '10.20.1.15',
    status: 'online',
    last_heartbeat: '2026-08-03 14:32:00',
    heartbeat_rtt_ms: 49,
    last_config_pull: '2026-08-03 14:02:00',
    config_version: '',
    config_sync_status: 'no_version',
    wal_backlog_bytes: 131072,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '',
      },
      {
        type: 'collector',
        name: 'vmagent',
        status: 'running',
        version: 'v1.102.0',
        config_version: '',
      },
      {
        type: 'blackbox_exporter',
        name: 'blackbox-exporter',
        status: 'running',
        version: 'v0.25.0',
        config_version: '',
      },
    ],
    created_at: '2026-07-23 00:00:00',
    updated_at: '2026-08-03 14:32:00',
  },
  {
    // {v1.40} 决策 40-1 成因 A（pending_draft）：中心存在该网域待确认变更草稿（draft-gov-003 待确认）→「前往配置确认」（预选该网域）
    id: 'ea-gov-a-06',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-gova-06',
    agent_ip: '10.20.1.16',
    status: 'online',
    last_heartbeat: '2026-08-03 14:33:00',
    heartbeat_rtt_ms: 48,
    last_config_pull: '2026-08-03 14:18:00',
    config_version: '20260803-141500',
    config_sync_status: 'out_of_sync',
    out_of_sync_cause: 'pending_draft',
    wal_backlog_bytes: 393216,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '中心存在待确认变更草稿（draft-gov-003），配置变更确认后随下次心跳拉取生效',
    components: [
      {
        type: 'edge_sync_agent',
        name: 'metric-center-edge-agent',
        status: 'online',
        version: 'v1.2.0',
        config_version: '20260803-141500',
        last_error: '中心存在待确认变更草稿（draft-gov-003），配置变更确认后随下次心跳拉取生效',
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
    created_at: '2026-07-24 00:00:00',
    updated_at: '2026-08-03 14:33:00',
  },
  {
    // {v1.41} 决策 40-1 成因 B（pull_pending）典型场景：采集器运行正常，配置已确认（变更单 CHG-20260803-004）后等待 Agent 拉包/生效
    // → 纯展示等待（心跳自动 out_of_sync → in_sync，无需操作）+「查看下发记录」
    id: 'ea-gov-a-07',
    network_domain_id: 'gov-cloud-a',
    agent_type: 'vmagent',
    version: 'v1.2.0',
    collector_version: 'v1.102.0',
    collector_status: 'running',
    hostname: 'edge-agent-gova-07',
    agent_ip: '10.20.1.17',
    status: 'online',
    last_heartbeat: '2026-08-03 14:34:00',
    heartbeat_rtt_ms: 46,
    last_config_pull: '2026-08-03 14:16:00',
    config_version: '20260803-141500',
    config_sync_status: 'out_of_sync',
    out_of_sync_cause: 'pull_pending',
    wal_backlog_bytes: 786432,
    remote_write_url: 'https://metriccenter.example.com/api/v2/ingest/prometheus',
    last_error: '配置变更已确认（CHG-20260803-004），随下次心跳拉取生效中（拉包/生效延迟，等待自动流转）',
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
    created_at: '2026-07-25 00:00:00',
    updated_at: '2026-08-03 14:34:00',
  },
]

// prometheus.yml 为 file_sd 骨架（PRD 3.3 / 3.3.2）：仅含 job 结构（job_name / metrics_path / params / relabel / file_sd 引用），
// targets 列表统一放入 targets/*.json（file_sd_configs 引用，固定文件名覆盖写），不内联 static_configs。
// {v1.31} external_labels 注入：network_domain / tenant_id 必注入；zone_type 仅当网域登记了 zone_type 时注入（PRD 9.2）
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
    zone_type: 'extranet'

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
    zone_type: 'internet'

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

// {v1.37} default 域校验失败草稿的 prometheus.yml：含 plc-gateway job 骨架（与 targetsDefaultInvalid 的 plc-gateway 联动，
// 演示 configgen 侧 targets schema 校验失败——promtool 对 file_sd 内容不校验，缺口由生成器弥补，PRD 3.5.1）
const prometheusYmlDefaultInvalid = `global:
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

// {v1.37} default 域校验失败演示（决策 37-1/37-2 联动）：plc-gateway 文件故意未闭合（JSON 数组缺 `]`），
// 演示 configgen 侧 targets schema 校验失败——挂在 default（local 通道、单域可达），保证校验失败 UI 可演示
const targetsDefaultInvalid: ConfigTargetsFiles = {
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
  'plc-gateway': `[
  {
    "targets": ["localhost:9273"],
    "labels": {"network_domain": "default", "app": "app-plc", "biz": "order", "env": "prod"}
  }`,
}

// {v1.37} default 域第二版本 targets（cv-default-002 / draft-default-004）：node-exporter 新增第二实例，供 local 回滚演示
const targetsDefaultV2: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['localhost:9100', 'localhost:9101'],
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

// {v1.38} 分级下发自动生效演示（决策 38-1）：纯 targets 变更（node-exporter 新增第三实例），
// file_sd 热加载免 reload，自动生成 cv + deployment（triggered_by=系统自动），不进入人工确认列表
const targetsDefaultV3: ConfigTargetsFiles = {
  'node-exporter': [
    {
      targets: ['localhost:9100', 'localhost:9101', 'localhost:9102'],
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

// rules.yml（{v1.32} M01/M08/M09 告警规则职责重构）：由 M09 按 Prometheus `group` 语法组织——
// M09 读取 Module_01 的 MonitoringRule，按规则字段自动派生 group 分组（默认按 resource_type / rule_type 聚类），
// MVP 不暴露用户可管理的 RuleGroup 实体；按规则作用域生成：中心域（default）包含 scope=central/both 规则，
// 边缘域仅当存在 scope=edge/both 规则时（v0.4+）随配置包生成，MVP 阶段由中心统一求值。
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
    // {v1.39 决策 39-3} 平台技术故障演示（gov 域）：promtool 校验服务瞬时不可用 → 校验层自动重试（30s/2min/5min 指数退避，用户无感）；
    // 持续失败标记「平台故障」，仅提示联系平台侧 / 查看日志，不展示「重新校验」（用户修不了平台侧 bug）
    id: 'draft-gov-003',
    change_no: 'CHG-20260803-009',
    network_domain_id: 'gov-cloud-a',
    source_version: 'cv-gov-002',
    prometheus_yml: prometheusYmlGov,
    rules_yml: rulesYmlChanged,
    blackbox_yml: blackboxYml,
    targets_files: targetsGovDraft,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '规则阈值调整（校验平台故障）',
      source_data_version: '2026-08-03 14:50:00',
      trigger_summary: 'MonitoringRule#HighDiskUsage updated_at 变更（2026-08-03 14:50:00）触发重算',
      checksum: computeJointChecksum(prometheusYmlGov, rulesYmlChanged, blackboxYml, targetsGovDraft),
      source_summary: 'MonitoringRule#HighDiskUsage 阈值调整，promtool 校验服务瞬时不可用（平台技术故障）',
    },
    status: 'pending',
    validation_status: 'failed',
    validation_error:
      '平台技术故障：promtool 校验服务瞬时不可用，校验层已自动重试（30s / 2min / 5min 指数退避，用户无感）；持续失败请查看平台日志 / 联系平台侧',
    validation_cause: 'platform_fault',
    validation_details: [
      { file: 'rules.yml', line: 18, message: 'promtool check rules 执行超时（校验服务不可用）' },
    ],
    summary: 'HighDiskUsage 告警规则阈值调整（校验平台故障，系统自动重试中）',
    change_items: [
      {
        type: 'modify',
        target: 'alert_rule',
        description: 'HighDiskUsage 阈值调整（校验受平台故障阻塞，系统自动重试中）',
        risk: 'high',
        affected_files: ['rules.yml'],
      },
    ],
    created_at: '2026-08-03 14:52:00',
    updated_at: '2026-08-03 14:52:00',
  },
  {
    // {v1.37} 校验失败演示迁至 default 域（原 manufacturing-edge 未纳管、草稿被 domainOptions 过滤不可达，断点修复）：
    // plc-gateway 采集新增，targets/plc-gateway.json 语法错误（JSON 数组未闭合）→ configgen 侧 targets schema 校验失败
    id: 'draft-default-003',
    change_no: 'CHG-20260803-005',
    network_domain_id: 'default',
    source_version: 'cv-default-002',
    prometheus_yml: prometheusYmlDefaultInvalid,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefaultInvalid,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '新增 plc-gateway 采集',
      source_data_version: '2026-08-03 14:20:00',
      trigger_summary: 'ScrapeJob#plc-gateway updated_at 变更（2026-08-03 14:20:00）触发重算',
      checksum: computeJointChecksum(prometheusYmlDefaultInvalid, rulesYml, blackboxYml, targetsDefaultInvalid),
      source_summary: 'ScrapeJob#plc-gateway 新增，targets/plc-gateway.json 语法错误（JSON 数组未闭合）',
    },
    status: 'pending',
    validation_status: 'failed',
    validation_error:
      '中心内容校验失败：configgen 侧 targets schema 校验失败：targets/plc-gateway.json 解析失败（JSON 数组未闭合，unexpected end of input）；prometheus.yml 骨架本身可过 promtool 校验（file_sd 仅查文件存在性），草稿保持待确认，不进入下发流程',
    /** {v1.39 决策 39-1} 用户配置问题：错误原因 + 定位详情 + 行内引导「前往修改」跳 M01 */
    validation_cause: 'user_config',
    validation_details: [
      { file: 'targets/plc-gateway.json', line: 4, message: 'JSON 数组未闭合（unexpected end of input），请检查 new_targets 数组是否完整闭合' },
    ],
    summary: '新增 plc-gateway 采集（校验未通过，待修复）',
    change_items: [
      {
        type: 'add',
        target: 'scrape_job',
        description: '新增 plc-gateway 采集（localhost:9273）',
        risk: 'low',
        affected_files: ['prometheus.yml', 'targets'],
      },
    ],
    created_at: '2026-08-03 14:22:00',
    updated_at: '2026-08-03 14:22:00',
  },
  {
    // {v1.37} default 域已确认变更（对应 cv-default-002）：node-exporter 新增第二实例，已确认发布但 local reload 失败（deploy-008），
    // 供「未同步（out_of_sync）+ 重试 / 回滚」演示（决策 37-2）
    id: 'draft-default-004',
    change_no: 'CHG-20260803-007',
    network_domain_id: 'default',
    source_version: 'cv-default-001',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefaultV2,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '新增采集实例',
      source_data_version: '2026-08-03 14:30:00',
      trigger_summary: 'Resource#R-1010 updated_at 变更（2026-08-03 14:30:00）触发重算',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefaultV2),
      source_summary: 'node-exporter 目标 +1（localhost:9101），targets/node-exporter.json 更新（prometheus.yml 骨架不变）',
    },
    status: 'confirmed',
    validation_status: 'passed',
    validation_error: '',
    summary: '新增 1 台服务器（localhost:9101）加入 node-exporter 采集',
    change_items: [
      {
        type: 'add',
        target: 'scrape_target',
        description: 'node-exporter 新增实例 localhost:9101',
        risk: 'low',
        affected_files: ['targets'],
      },
    ],
    created_at: '2026-08-03 14:31:00',
    updated_at: '2026-08-03 14:33:00',
    confirmed_by: '张伟（运维）',
    confirmed_at: '2026-08-03 14:33:00',
  },
  {
    // {v1.38} 分级下发自动生效演示（决策 38-1）：纯 targets 变更（node-exporter 新增第三实例）自动生效——
    // 不进入人工确认列表（无确认动作），草稿由系统自动确认留痕（confirmed_by=系统自动），对应 cv-default-003 / deploy-009
    id: 'draft-default-005',
    change_no: 'CHG-20260803-008',
    network_domain_id: 'default',
    source_version: 'cv-default-002',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefaultV3,
    metadata: {
      generated_by: 'system',
      generator_version: 'configgen v1.7.0',
      reason: '新增采集实例（targets 变更自动生效）',
      source_data_version: '2026-08-03 14:40:00',
      trigger_summary: 'Resource#R-1011 updated_at 变更（2026-08-03 14:40:00）触发重算，影响文件 ⊆ targets/*.json → 自动生效',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefaultV3),
      source_summary: 'node-exporter 目标 +1（localhost:9102），纯 targets 变更，file_sd 热加载免 reload',
    },
    status: 'confirmed',
    validation_status: 'passed',
    validation_error: '',
    summary: '新增 1 台服务器（localhost:9102）加入 node-exporter 采集（自动生效）',
    change_items: [
      {
        type: 'add',
        target: 'scrape_target',
        description: 'node-exporter 新增实例 localhost:9102',
        risk: 'low',
        affected_files: ['targets'],
      },
    ],
    created_at: '2026-08-03 14:41:00',
    updated_at: '2026-08-03 14:41:00',
    confirmed_by: '系统自动',
    confirmed_at: '2026-08-03 14:41:00',
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
    // {v1.37} default 域第二个版本：node-exporter 新增实例（local 回滚演示用历史版本，断点修复）
    id: 'cv-default-002',
    network_domain_id: 'default',
    draft_id: 'draft-default-004',
    change_no: 'CHG-20260803-007',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefaultV2,
    metadata: {
      version_note: 'add second node',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefaultV2),
      source_data_version: '2026-08-03 14:30:00',
    },
    created_at: '2026-08-03 14:33:00',
    created_by: '张伟（运维）',
  },
  {
    // {v1.38} 分级下发自动生效版本（决策 38-1）：纯 targets 差异自动生成 ConfigVersion（无人工确认动作）
    id: 'cv-default-003',
    network_domain_id: 'default',
    draft_id: 'draft-default-005',
    change_no: 'CHG-20260803-008',
    prometheus_yml: prometheusYmlDefault,
    rules_yml: rulesYml,
    blackbox_yml: blackboxYml,
    targets_files: targetsDefaultV3,
    metadata: {
      version_note: 'auto-apply targets-only change',
      checksum: computeJointChecksum(prometheusYmlDefault, rulesYml, blackboxYml, targetsDefaultV3),
      source_data_version: '2026-08-03 14:40:00',
    },
    created_at: '2026-08-03 14:41:00',
    created_by: '系统自动',
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
    channel: 'local',
    target_type: 'central_prometheus',
    target_address: 'metric-center-local',
    status: 'success',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: true,
    error_message: '',
    retry_count: 0,
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
    channel: 'agent_pull',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-01',
    status: 'success',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: '',
    retry_count: 0,
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:15:10',
    completed_at: '2026-08-03 14:15:20',
    created_at: '2026-08-03 14:15:10',
  },
  {
    // {v1.40 决策 40-2 语义修正} agent_pull 发布失败 = 中心侧平台故障（对象存储写入超时，已触发平台侧自动重试）；
    // 「拉包/生效失败」不产生下发记录（由采集节点状态页 config_sync_status 承载）；agent_pull 行不提供「重试」按钮（平台故障用户无法修复）
    id: 'deploy-003',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-002',
    source_change_no: 'CHG-20260803-003',
    channel: 'agent_pull',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-02',
    status: 'failed',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: '发布配置包写入对象存储超时（平台侧故障，已触发平台自动重试，无需人工操作）',
    retry_count: 0,
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:20:10',
    completed_at: '2026-08-03 14:21:10',
    created_at: '2026-08-03 14:20:10',
  },
  {
    id: 'deploy-005',
    network_domain_id: 'gov-cloud-a',
    config_version_id: 'cv-gov-001',
    source_change_no: 'CHG-20260803-003',
    channel: 'agent_pull',
    target_type: 'edge_agent',
    target_address: 'edge-agent-gova-02',
    status: 'rolled_back',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: false,
    error_message: '',
    retry_count: 0,
    triggered_by: 'admin',
    triggered_at: '2026-08-03 14:05:10',
    completed_at: '2026-08-03 14:06:00',
    created_at: '2026-08-03 14:05:10',
  },
  {
    // {v1.37} default 域 local reload 失败演示（决策 37-2）：cv-default-002 下发写盘后 reload 超时，
    // 记录 failed、行内可「重试」（复用记录 retry_count 递增）；生效版本仍为 cv-default-001（failed 目标版本不计入生效）
    id: 'deploy-008',
    network_domain_id: 'default',
    config_version_id: 'cv-default-002',
    source_change_no: 'CHG-20260803-007',
    channel: 'local',
    target_type: 'central_prometheus',
    target_address: 'metric-center-local',
    status: 'failed',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: true,
    error_message: 'config reload: timeout waiting for response',
    retry_count: 0,
    triggered_by: '张伟（运维）',
    triggered_at: '2026-08-03 14:33:00',
    completed_at: '2026-08-03 14:33:05',
    created_at: '2026-08-03 14:33:00',
  },
  {
    // {v1.38} 分级下发自动生效记录（决策 38-1）：纯 targets 变更自动生效（file_sd 热加载免 reload），留痕来源「系统自动」
    id: 'deploy-009',
    network_domain_id: 'default',
    config_version_id: 'cv-default-003',
    source_change_no: 'CHG-20260803-008',
    channel: 'local',
    target_type: 'central_prometheus',
    target_address: 'metric-center-local',
    status: 'success',
    validation_status: 'passed',
    validation_error: '',
    includes_blackbox: true,
    error_message: '',
    retry_count: 0,
    triggered_by: '系统自动',
    triggered_at: '2026-08-03 14:41:00',
    completed_at: '2026-08-03 14:41:00',
    created_at: '2026-08-03 14:41:00',
  },
]

// 变更检测状态（PRD 3.3.3「检测状态可观测」P0）：每个网域最近一次轮询的检测结果，
// 三种结果均有演示：changes_found（default / gov）/ no_change（finance）
export const changeDetectionStatus: ChangeDetectionStatus[] = [
  {
    network_domain_id: 'default',
    last_checked_at: '2026-08-03 14:22:30',
    source_data_version: '2026-08-03 14:20:00',
    outcome: 'changes_found',
    generated_drafts: [
      {
        id: 'draft-default-003',
        trigger_summary: 'ScrapeJob#plc-gateway updated_at 变更（2026-08-03 14:20:00）触发重算',
      },
    ],
    summary:
      '本轮检测到变更：生成 draft-default-003（新增 plc-gateway 采集），进入确认列表（targets schema 校验失败，待修复）',
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
  /** {v1.31} 网闸 / 隔离区连接约束：禁止中心→边缘主动连接，全部交互由边缘发起；地址为网域视角可达地址 */
  gateway_note: string
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
    'Edge Sync Agent 是部署在边缘监控代理节点的独立客户端程序（非中心平台内置进程）；与中心通过 outbound HTTPS 443 + 每网域 Token 通信，心跳 / 配置拉取 / remote_write 全部由边缘主动出站，中心无入站端口；default 域固定 local 通道（中心直接采集）不部署，agent_pull 通道网域每个边缘节点部署一个（离线二进制包 + systemd 交付）',
  gateway_note:
    '网闸 / 隔离区连接约束（强制）：禁止任何中心 → 边缘方向的主动连接（中心无入站端口、无主动 reload / 探测能力），所有交互（心跳 / 配置拉取 / 指标回传）一律由边缘 Agent 向中心发起（pull / push 上行）；面向边缘的地址均为该网域视角的可达地址（网闸映射后地址，center_endpoint / remote_write_url 按区配置），配置拉取地址 = 网域 center_endpoint + 相对路径合成绝对地址下发给 Agent',
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
    NETWORK_DOMAIN_ID: '网域 ID（由 Module_06 行政创建，本页纳管）',
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
        '在边缘节点配置环境变量（或写入 systemd 环境文件）：NETWORK_DOMAIN_ID=Module_06 行政创建的网域 ID，TOKEN=本页纳管时生成/重置的网域认证 Token。',
    },
    {
      title: '启动 Edge Sync Agent（systemd）',
      description:
        '启动 systemd 服务（metric-center-edge-agent）。Agent 启动后自动部署并守护本节点采集器（vmagent）与 blackbox exporter（可选）进程：启动顺序 blackbox → 采集器，健康检查、配置包更新 reload、进程异常自动重启；无需手动安装采集器。',
    },
  ],
}
