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
}): JobStatusView {
  if (job.draft_status === 'draft') {
    return { label: '草稿', badgeStatus: 'default', disabled: true }
  }
  if (!job.enabled) {
    return { label: '已停用', badgeStatus: 'error', disabled: true }
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