import type { BadgeProps } from 'antd'

/**
 * 采集 Job 状态聚合（Module_01 §8 状态机 / §11.1「状态聚合四态」，F3）。
 * 优先级：草稿（v0.2 灰显占位）> 已停用（enabled=false）> 下发状态（pending/confirmed/deployed）。
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
      return { label: '待下发', badgeStatus: 'warning', disabled: false }
    case 'confirmed':
      return { label: '已确认', badgeStatus: 'processing', disabled: false }
    case 'deployed':
    default:
      return { label: '已生效', badgeStatus: 'success', disabled: false }
  }
}