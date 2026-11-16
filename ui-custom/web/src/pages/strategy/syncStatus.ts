import type { BadgeProps } from 'antd'
import type { SyncState, SyncStatus } from '../../types/strategyV3'

/** v3 同步状态展示模型（M01 SRS §3.6 / FR-12）。 */
export interface SyncStatusView {
  label: string
  badgeStatus: BadgeProps['status']
  color: string
  description: string
}

const VIEWS: Record<SyncStatus, SyncStatusView> = {
  draft: {
    label: '草稿',
    badgeStatus: 'default',
    color: 'default',
    description: '草稿或已停用，未进入 M09 同步候选集',
  },
  pending: {
    label: '待同步',
    badgeStatus: 'warning',
    color: 'gold',
    description: '源数据已变更，等待 M09 下一轮生成',
  },
  syncing: {
    label: '同步中',
    badgeStatus: 'processing',
    color: 'blue',
    description: 'M09 正在生成或分发配置',
  },
  synced: {
    label: '已同步',
    badgeStatus: 'success',
    color: 'green',
    description: '当前源数据已纳入 M09 最新快照',
  },
  failed: {
    label: '同步失败',
    badgeStatus: 'error',
    color: 'red',
    description: 'M09 校验或分发失败，请查看失败原因',
  },
}

/** 将 v3 sync 状态映射为展示模型；未知值按待同步处理。 */
export function syncStatusView(status: SyncStatus | string | undefined): SyncStatusView {
  if (status && status in VIEWS) {
    return VIEWS[status as SyncStatus]
  }
  return VIEWS.pending
}

/** v3 Job 的聚合状态：草稿/停用优先，其次同步状态。 */
export function aggregateJobSyncStatus(job: {
  draft_status?: string
  enabled?: boolean
  sync?: SyncState
}): SyncStatusView {
  if (job.draft_status === 'draft') {
    return VIEWS.draft
  }
  if (job.enabled === false) {
    return { ...VIEWS.draft, label: '已停用', description: 'Job 已停用，不参与同步' }
  }
  return syncStatusView(job.sync?.status)
}
