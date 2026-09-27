/**
 * Module_09 配置中心 枚举/常量/UI 展示名映射（config-center）。
 * 权威契约：docs/05-execution-records/module-09/api-contract-snapshot.md（§8 枚举字典 / §10 UI 展示名）。
 * 用户可见文案遵循 PRD §10 术语映射；技术字段（checksum/generator_version 等）不下沉为 UI 文案。
 *
 * 待办：CURRENT_USER 为 MVP 预置的确认人硬编码（decision 19 文档化妥协）；
 * M06 用户管理接入后应删除并改用真实登录账号（见设计决策 19），实现 login 前勿新增硬编码凭据/姓名。
 */
import type {
  AffectedFile,
  AgentType,
  Channel,
  ChangeTarget,
  ChangeType,
  DeploymentStatus,
  DraftStatus,
  DraftValidationStatus,
  NetworkDomain,
  RegistrationStatus,
  Risk,
} from '../../types/config-center'

/** 当前登录用户（决策 19：MVP 预置确认人；用户管理接入后同步为真实用户） */
export const CURRENT_USER = '张伟（运维）'

/** Token 完全脱敏串（不显示任何明文片段，含首尾 6 位） */
export const TOKEN_MASK = '••••••••'

/**
 * Token 用户指引完整文案（F-30）：明文仅纳管/重置单次展示，用普通用户语言说明
 * 「为什么看不到原文」「丢了怎么办」「重置的代价」，供安装指引 Steps 与一次性
 * 明文弹窗共用（单一事实来源）。
 */
export const TOKEN_USER_GUIDE =
  '出于安全考虑，网域的接入 Token 只在第一次纳管成功或主动重置时完整显示一次，页面列表里只保留脱敏 Token，无法再次查看原文。请务必在弹窗出现时立即复制并妥善保存——它等同于该网域的「接入密码」。如果之后需要用到 Token（例如换机重装采集节点）却没有保存，可在网域行「更多 → 重置 Token」重新生成；注意重置后旧 Token 立即失效，已在运行的采集节点必须同步更换，否则会掉线。'

/** Token 列表列短提示（F-30）：Tooltip 场景下的精简版，与 TOKEN_USER_GUIDE 口径一致 */
export const TOKEN_CREDENTIAL_TIP =
  '接入 Token 出于安全考虑只显示脱敏值，原文仅在纳管成功或重置时完整显示一次。需要再次获取请用「更多 → 重置 Token」；重置后旧 Token 立即失效，已在运行的采集节点须同步更换。'

/** 下发通道用户可见文案（local=中性 / agent_pull=蓝） */
export const channelLabel: Record<Channel, string> = {
  local: 'local',
  agent_pull: 'agent_pull',
}

export const channelTip: Record<Channel, string> = {
  local: '平台与采集在同侧：由平台直接完成采集与配置更新（配置写盘并生效），无需安装采集节点、无需接入 Token',
  agent_pull: '网域与平台网络隔离：由部署在网域内的采集节点定期向平台拉取配置、回传监控数据（接入 Token 作为身份凭据）',
}

export const channelColor: Record<Channel, string> = {
  local: 'default',
  agent_pull: 'blue',
}

/** Agent 类型文案 */
export const agentTypeLabel: Record<AgentType, string> = {
  vmagent: 'VMAgent',
  'prometheus-agent': 'Prometheus Agent',
}

/**
 * 域类型文案（用户术语与 M06 网域管理页统一：中心直连域 / 采集节点域，
 * 对齐决策 74 术语表；不再使用「管理域 / 边缘域」表述，避免引入新概念）。
 */
export const domainTypeLabel: Record<NetworkDomain['domain_type'], string> = {
  management: '中心直连域',
  edge: '采集节点域',
}

/**
 * 字段解释文案（网域纳管页 —— 纳管抽屉 / 编辑抽屉共用，单一事实来源）。
 * 形态约定：字段级解释统一走 `FieldLabel` 的问号 Tooltip，字段下方不再散落小字注释。
 */
export const DOMAIN_FIELD_TIP = {
  /** 目标网域（只读行政信息） */
  domain: '网域的行政信息（名称 / ID / 归属租户）由「系统与平台管理 · 网域管理」维护，此处只读展示、不可修改。',
  /** 接入方式 —— 中心直连域 */
  channelLocal: '中心直连域：平台与被采集对象同侧可达，由平台直接完成采集与配置更新，无需安装采集节点、无需接入 Token。',
  /** 接入方式 —— 采集节点域 */
  channelAgentPull:
    '采集节点域：该网域与平台网络隔离，需在网域内一台常开机器上安装采集节点，由它代理采集并把监控数据回传给平台。接入方式由网域登记结果决定，此处只读。',
  /** 指标采集器类型 —— 中心直连域 */
  agentTypeLocal: '中心直连域由平台直接采集，不需要独立的采集组件。',
  /** 指标采集器类型 —— 采集节点域 */
  agentType: '采集节点用于抓取指标的组件。当前版本固定使用 VMAgent，无需选择；更多采集组件在后续版本开放。',
  /** 指标回传地址（remote_write_url） */
  remoteWriteUrl:
    '采集节点把监控数据回传到平台的入口地址（即 Prometheus 的 Remote Write URL）。留空由平台自动生成；若该网域经网闸 / 代理转发，请填写采集节点侧实际可达的地址。',
  /** 描述 */
  description: '该网域的用途与网络特征，便于后续识别与交接；不影响采集行为。',
} as const

/** 域类型颜色（与 domainTypeLabel 配套） */
export const domainTypeColor: Record<NetworkDomain['domain_type'], string> = {
  management: 'blue',
  edge: 'cyan',
}

/** 网域注册态（由 is_monitored 派生，frontend 派生） */
export function deriveRegistrationStatus(domain: Pick<NetworkDomain, 'is_monitored'>): RegistrationStatus {
  return domain.is_monitored ? 'monitored' : 'created'
}

export const registrationStatusLabel: Record<RegistrationStatus, string> = {
  created: '已创建未纳管',
  monitored: '已纳管',
}

export const registrationStatusColor: Record<RegistrationStatus, string> = {
  created: 'default',
  monitored: 'processing',
}

/** 区域类型 Tag 颜色（M06 字典 code 维度，兜底 default） */
export const zoneTypeColor: Record<string, string> = {
  internet: 'volcano',
  extranet: 'purple',
  'private-network': 'cyan',
  'region-beijing': 'geekblue',
  'region-shanghai': 'geekblue',
  'region-shenzhen': 'geekblue',
}

/** 运行态（agent_pull 心跳）——枚举值与后端 offline_detector 四档一致：
 *  normal（全部在线）/ partial（在线离线混合）/ offline（全部失联）/ unknown（无节点） */
export const monitoredStatusLabel: Record<NonNullable<NetworkDomain['monitored_status']>, string> = {
  normal: '在线',
  partial: '部分离线',
  offline: '离线',
  unknown: '未知',
}

export const monitoredStatusColor: Record<NonNullable<NetworkDomain['monitored_status']>, string> = {
  normal: 'success',
  partial: 'warning',
  offline: 'error',
  unknown: 'default',
}

/** 草稿状态 */
export const draftStatusLabel: Record<DraftStatus, string> = {
  pending: '待确认',
  confirmed: '已确认',
  discarded: '已废弃',
}

export const draftStatusColor: Record<DraftStatus, string> = {
  pending: 'warning',
  confirmed: 'success',
  discarded: 'default',
}

/** 下发前校验 */
export const validationLabel: Record<DraftValidationStatus, string> = {
  passed: '校验通过',
  failed: '校验失败',
  pending: '待校验',
  rejected: '已拒绝',
}

export const validationColor: Record<DraftValidationStatus, string> = {
  passed: 'success',
  failed: 'error',
  pending: 'default',
  rejected: 'default',
}

/** 风险等级 */
export const riskLabel: Record<Risk, string> = {
  low: '低风险',
  high: '高风险',
}

export const riskColor: Record<Risk, string> = {
  low: 'default',
  high: 'error',
}

/** 变更类型 */
export const changeTypeLabel: Record<ChangeType, string> = {
  add: '新增',
  update: '修改',
  delete: '移除',
}

export const changeTypeColor: Record<ChangeType, string> = {
  add: 'green',
  update: 'orange',
  delete: 'red',
}

/** 变更对象（源数据对象，对应 PRD §10；决策 60 追加 alertmanager_config；决策 68-2 补丁追加 prom_alerting） */
export const changeTargetLabel: Record<ChangeTarget, string> = {
  scrape_job: '采集 Job',
  target_instance: '采集目标',
  monitoring_rule: '告警规则',
  probe_target: '拨测目标',
  label_template: '标签模板',
  alertmanager_config: '告警配置',
  prom_alerting: '告警投递',
}

/** 影响的配置文件（对应 PRD §10；决策 60 追加 alertmanager） */
export const affectedFileLabel: Record<AffectedFile, string> = {
  prometheus: 'prometheus.yml',
  targets: 'targets/*.json',
  rules: 'rules.yml',
  blackbox: 'blackbox.yml',
  alertmanager: 'alertmanager.yml',
}

export const affectedFileColor: Record<AffectedFile, string> = {
  prometheus: 'geekblue',
  targets: 'purple',
  rules: 'orange',
  blackbox: 'cyan',
  alertmanager: 'magenta',
}

/** 下发记录状态 */
export const deploymentStatusLabel: Record<DeploymentStatus, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  rolled_back: '已回滚',
}

export const deploymentStatusColor: Record<DeploymentStatus, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  rolled_back: 'warning',
}

/** Remote Write URL 自动推导（决策 14）：留空自动生成，可手动覆盖 */
export function deriveRemoteWriteUrl(domainId: string): string {
  return `https://metriccenter.example.com/api/v2/ingest/${domainId}/prometheus`
}

/** 最高风险（列表风险等级列：取给定变更项集的最高风险） */
export function highestRisk(items: { risk: Risk }[] | undefined): Risk {
  return (items ?? []).some((i) => i.risk === 'high') ? 'high' : 'low'
}

/** 展示用相对时间（如「5 分钟前」「2 小时前」） */
export function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return dateStr
  const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60000)
  if (diffMinutes < 1) return '刚刚'
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours} 小时前`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天前`
}

/**
 * 绝对时间本地化展示（口径对齐 M08 告警页 formatTime：zh-CN 24 小时制，
 * 如「2026/9/11 17:01:26」）。后端时间为 RFC3339（含纳秒/时区），直接原样展示
 * 会出现 T/Z/纳秒等机器格式，此函数统一转为本地可读串；缺省或非法值返回 '-'。
 */
export function formatLocalTime(iso?: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('zh-CN', { hour12: false })
}