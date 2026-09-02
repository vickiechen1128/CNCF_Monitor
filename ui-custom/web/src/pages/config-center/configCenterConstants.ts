/**
 * Module_09 配置中心 枚举/常量/UI 展示名映射（config-center）。
 * 权威契约：docs/05-execution-records/module-09/api-contract-snapshot.md（§8 枚举字典 / §10 UI 展示名）。
 * 用户可见文案遵循 PRD §10 术语映射；技术字段（checksum/generator_version 等）不下沉为 UI 文案。
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

/** 下发通道用户可见文案（local=中性 / agent_pull=蓝） */
export const channelLabel: Record<Channel, string> = {
  local: 'local',
  agent_pull: 'agent_pull',
}

export const channelTip: Record<Channel, string> = {
  local: '采集器与中心同机/同 Pod，中心直接写盘并 reload（如默认 default 网域）；无 Edge Agent / Token / 安装指引',
  agent_pull: '采集器位于远端/隔离节点，由 Edge Sync Agent 心跳拉取配置包（Token 认证 + 校验值校验）',
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

/** 域类型文案（M06 只读展示） */
export const domainTypeLabel: Record<NetworkDomain['domain_type'], string> = {
  management: '管理域',
  edge: '边缘域',
}

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

/** 运行态（agent_pull 心跳） */
export const monitoredStatusLabel: Record<NonNullable<NetworkDomain['monitored_status']>, string> = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
}

export const monitoredStatusColor: Record<NonNullable<NetworkDomain['monitored_status']>, string> = {
  online: 'success',
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

/** 变更对象（源数据对象，对应 PRD §10；决策 60 追加 alertmanager_config） */
export const changeTargetLabel: Record<ChangeTarget, string> = {
  scrape_job: '采集 Job',
  target_instance: '采集目标',
  monitoring_rule: '告警规则',
  probe_target: '拨测目标',
  label_template: '标签模板',
  alertmanager_config: '告警配置',
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