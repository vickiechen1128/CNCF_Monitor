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

/** 节点存活状态展示名与颜色 */
export const agentStatusLabel: Record<AgentStatus, string> = {
  online: '在线',
  partial: '部分异常',
  offline: '离线',
  retired: '已退纳',
}

export const agentStatusBadgeStatus: Record<AgentStatus, 'success' | 'processing' | 'error' | 'default'> = {
  online: 'success',
  partial: 'processing',
  offline: 'error',
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

export const configSyncStatusBadgeStatus: Record<
  ConfigSyncStatus,
  'success' | 'error' | 'default' | 'warning' | 'processing'
> = {
  in_sync: 'success',
  out_of_sync: 'error',
  unknown: 'default',
  manual_override: 'warning',
  no_version: 'default',
}

/** out_of_sync 成因分档引导（文案 + 跳转目标；local_reset 无明确页面，走消息） */
export const outOfSyncCauseHint: Record<OutOfSyncCause, string> = {
  pending_draft: '存在待确认的配置变更单，确认后随下次心跳拉取生效',
  pull_pending: '新配置包已就绪，等待 Agent 下次心跳拉取（准实时 30s）',
  local_reset: '本地配置已重置，需重新拉取中心最新配置包',
}

/** out_of_sync 成因 → 引导按钮：文案 + 单参数跳转集中管理（无对应页面则返回 null） */
export const outOfSyncCauseAction: Record<
  OutOfSyncCause,
  { text: string; target?: string } | null
> = {
  pending_draft: { text: '前往配置确认', target: '/config-preview' },
  pull_pending: { text: '查看下发', target: '/deployments' },
  local_reset: { text: '重新同步', target: undefined },
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