import type { BadgeProps } from 'antd'

/**
 * 采集 Job「生效状态」聚合（Module_01 §8 状态机 / §11.1，F3）。
 * 用户视角的生命周期，回答「这个 job 现在算不算数」：
 * 草稿（v0.2 灰显占位）> 已停用（enabled=false）> 待生效（pending/confirmed，尚未真正下发）> 已生效（deployed）。
 */
export interface JobStatusView {
  label: string
  badgeStatus: BadgeProps['status']
  disabled: boolean
}

export function aggregateJobStatus(job: {
  draft_status?: string
  enabled?: boolean
  change_status?: string
  /** v3 同步状态；存在时优先于 legacy change_status。 */
  sync?: { status?: string }
}): JobStatusView {
  if (job.draft_status === 'draft') {
    return { label: '草稿', badgeStatus: 'default', disabled: true }
  }
  if (!job.enabled) {
    return { label: '已停用', badgeStatus: 'error', disabled: true }
  }
  if (job.sync?.status) {
    switch (job.sync.status) {
      case 'failed':
        return { label: '同步失败', badgeStatus: 'error', disabled: false }
      case 'synced':
        return { label: '已同步', badgeStatus: 'success', disabled: false }
      case 'pending':
      case 'syncing':
      default:
        return { label: '待同步', badgeStatus: 'warning', disabled: false }
    }
  }
  switch (job.change_status) {
    case 'pending':
    case 'confirmed':
      return { label: '待生效', badgeStatus: 'warning', disabled: false }
    case 'deployed':
    default:
      return { label: '已生效', badgeStatus: 'success', disabled: false }
  }
}