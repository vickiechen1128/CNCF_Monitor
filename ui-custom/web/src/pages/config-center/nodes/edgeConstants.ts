/**
 * 采集节点状态页 枚举/UI 展示名映射（edge，M11 契约 §1）。
 * 展示名遵循契约：queue_backlog_bytes →「回传积压」（绝非「WAL 积压」，T11-21 C5 改名）。
 * 用户可见文案遵循 PRD 术语映射；补齐 agent/collector 缺省标签兜底。
 */
import type {
  AgentOverall,
  AgentStatus,
  ConfigSyncStatus,
  EdgeComponentStatus,
  EdgeComponentType,
  OutOfSyncCause,
} from '../../../types/edge'

/** 节点存活状态展示名与颜色（与 AgentStatus 完全对齐：online/offline/unknown/retired；partial 由采集器异常派生，经 overall 呈现） */
export const agentStatusLabel: Record<AgentStatus, string> = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
  retired: '已退纳',
}

export const agentStatusBadgeStatus: Record<AgentStatus, 'success' | 'processing' | 'error' | 'default'> = {
  online: 'success',
  offline: 'error',
  unknown: 'default',
  retired: 'default',
}

/** 列表整体聚合档（顶部三档统计色） */
export const agentOverallLabel: Record<AgentOverall, string> = {
  normal: '正常',
  partial: '部分异常',
  offline: '离线',
  unknown: '未知',
}

/** 配置同步状态五档 */
export const configSyncStatusLabel: Record<ConfigSyncStatus, string> = {
  in_sync: '已同步',
  out_of_sync: '未同步',
  unknown: '未知',
  manual_override: '手动覆盖',
  no_version: '无版本',
}

/** 配置同步 Badge 状态色（含「同步中」中间态使用的 processing） */
export type ConfigSyncBadgeStatus = 'success' | 'error' | 'default' | 'warning' | 'processing'

export const configSyncStatusBadgeStatus: Record<ConfigSyncStatus, ConfigSyncBadgeStatus> = {
  in_sync: 'success',
  out_of_sync: 'error',
  unknown: 'default',
  manual_override: 'warning',
  no_version: 'default',
}

/**
 * 「同步中」中间态判定（F-16）：中心已确认下发、但 Agent 尚未在下次心跳（准实时 ≤30s）拉取应用，
 * 体现为 `out_of_sync` + 成因 `pull_pending`。其余 out_of_sync 成因（pending_draft / local_reset / 空）仍按「未同步」展示。
 */
export function isConfigSyncInProgress(
  status: ConfigSyncStatus | undefined,
  cause?: OutOfSyncCause,
): boolean {
  return status === 'out_of_sync' && cause === 'pull_pending'
}

/**
 * 「同步失败」判定（M11 设计提案 D-2）：`out_of_sync` + 成因 `apply_failed`——Agent 已拉取
 * 最新配置但应用失败（已回滚至上一可用版本）。属**终态失败**而非常规进行中，故不命中
 * isConfigSyncInProgress（决策 4：本轮不做「同步中长停留提示」）。
 */
export function isConfigSyncApplyFailed(
  status: ConfigSyncStatus | undefined,
  cause?: OutOfSyncCause,
): boolean {
  return status === 'out_of_sync' && cause === 'apply_failed'
}

/** 配置同步展示文案（cause 感知：pull_pending →「同步中」；apply_failed →「同步失败」） */
export function configSyncDisplayLabel(status: ConfigSyncStatus, cause?: OutOfSyncCause): string {
  if (isConfigSyncApplyFailed(status, cause)) return '同步失败'
  return isConfigSyncInProgress(status, cause) ? '同步中' : configSyncStatusLabel[status]
}

/** 配置同步 Badge 色（cause 感知；「同步中」processing 蓝、「同步失败」error 红，均区别于「未同步」的 error 红文案） */
export function configSyncDisplayBadgeStatus(
  status: ConfigSyncStatus,
  cause?: OutOfSyncCause,
): ConfigSyncBadgeStatus {
  if (isConfigSyncApplyFailed(status, cause)) return 'error'
  return isConfigSyncInProgress(status, cause) ? 'processing' : configSyncStatusBadgeStatus[status]
}

/** out_of_sync 成因分档引导（文案 + 跳转目标；local_reset 无明确页面，走消息） */
export const outOfSyncCauseHint: Record<OutOfSyncCause, string> = {
  pending_draft: '存在待确认的配置变更单，确认后随下次心跳拉取生效',
  pull_pending: '新配置包已就绪，等待 Agent 下次心跳拉取（准实时 30s）',
  local_reset: '本地配置已重置，需重新拉取中心最新配置包',
  apply_failed: '配置包已拉取，但 Agent 应用失败并已回滚至上一可用版本，请查看失败原因并修正后重新下发',
}

/** out_of_sync 成因 → 引导按钮：文案 + 单参数跳转集中管理（无对应页面则返回 null） */
export const outOfSyncCauseAction: Record<
  OutOfSyncCause,
  { text: string; target?: string } | null
> = {
  pending_draft: { text: '前往配置确认', target: '/config-preview' },
  pull_pending: { text: '查看下发', target: '/deployments' },
  local_reset: { text: '重新同步', target: undefined },
  apply_failed: { text: '查看下发', target: '/deployments' },
}

/** 组件类型展示名 */
export const componentTypeLabel: Record<EdgeComponentType, string> = {
  agent: '中心代理',
  collector: '指标采集器',
  blackbox_exporter: '拨测器',
}

/** 组件守护状态展示名与 Tag 色 */
export const componentStatusLabel: Record<EdgeComponentStatus, string> = {
  running: '运行中',
  restarting: '重启中',
  crash_loop: '崩溃回环',
  not_deployed: '未部署',
  unknown: '未知',
}

export const componentStatusColor: Record<EdgeComponentStatus, string> = {
  running: 'success',
  restarting: 'warning',
  crash_loop: 'error',
  not_deployed: 'default',
  unknown: 'default',
}

/** 高风险组件状态（top 高危横幅判定） */
export const HIGH_RISK_COMPONENT_STATUS: EdgeComponentStatus[] = ['crash_loop', 'restarting']

/** 回传积压格式化（B/KB/MB/GB；缺省或非法返回 '-'） */
export function formatBacklogBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = units[0]
  for (let i = 1; i < units.length && v >= 1024; i += 1) {
    v /= 1024
    u = units[i]
  }
  return `${v.toFixed(u === 'B' ? 0 : 1)} ${u}`
}

/** 积压数据龄列头/抽屉提示（F-40 延展①）：积压字节 ÷ 近期生产速率的估算口径 */
export const BACKLOG_AGE_TOOLTIP =
  '按近期积压增速（相邻心跳差分）推算攒出当前积压所需时长，约等于「积压字节 ÷ 近期生产速率」。显示「-」表示 30 分钟窗口内心跳不足、积压未上涨（消化中）或心跳过期；数值越大说明积压越久未被消费'

/** 积压数据龄格式化（秒 → 时长；<60s「<1 分钟」，其余「N 分钟 / N 小时」；缺省/非法返回 '-'） */
export function formatBacklogAge(seconds?: number | null): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return '-'
  if (seconds < 60) return '<1 分钟'
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins} 分钟`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  return rest > 0 ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

/** 积压增速格式化（字节/秒 → 带符号速率；缺省/0 返回 '-'；负值表示积压在消化） */
export function formatBacklogGrowth(bytesPerSec?: number | null): string {
  if (typeof bytesPerSec !== 'number' || !Number.isFinite(bytesPerSec) || bytesPerSec === 0) return '-'
  const sign = bytesPerSec > 0 ? '+' : '-'
  return `${sign}${formatBacklogBytes(Math.abs(bytesPerSec))}/s`
}

/** 回传通道态展示名（F-40 延展③）：abnormal=积压上涨且错误持续；空/未知不展示 */
export function channelStatusLabel(status?: string): string | null {
  if (status === 'abnormal') return '通道异常'
  return null
}

/** 回传通道态 Badge 色（仅 abnormal → error 红；其余 null 由调用方决定是否渲染） */
export function channelStatusBadge(status?: string): 'error' | null {
  return status === 'abnormal' ? 'error' : null
}

/** 回传通道态提示（F-40 延展③，联动 F-39 指标；F-42 补抓取间隔互相指引 → M02） */
export const CHANNEL_STATUS_TOOLTIP =
  '积压持续上涨，且最近心跳持续上报回传错误或发送重试增长（联动 remote_write_last_error / remote_write_retries_total），说明回传通道异常，需排查带宽/网络/对端接收；若因抓取间隔过密、数据生产过快导致积压，可到「采集策略」调大对应 Job 的抓取间隔'

/** 版本号比较：去 v 前缀按语义化段位比较；返回 >0 表示 a>b（用于「可升级」判定） */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((s) => parseInt(s, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((s) => parseInt(s, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da !== db) return da - db
  }
  return 0
}

/** 从离线包清单取最新（版本号最大）的包版本；空清单返回 null */
export function latestPackageVersion(versions: string[]): string | null {
  if (versions.length === 0) return null
  return versions.reduce((acc, v) => (compareVersions(v, acc) > 0 ? v : acc))
}