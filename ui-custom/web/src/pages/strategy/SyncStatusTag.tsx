import { Tag, Tooltip } from 'antd'
import type { SyncState } from '../../types/strategyV3'
import { aggregateJobSyncStatus, syncStatusView } from './syncStatus'

interface SyncStatusTagProps {
  /** v3 Job/Rule 的内联 sync 对象。 */
  sync?: SyncState
  /** 直接指定状态（规则/独立展示时使用）。 */
  status?: string
  draftStatus?: string
  enabled?: boolean
  showError?: boolean
}

/**
 * 同步状态标签（FR-12/FR-16）。优先使用 Job 聚合状态；失败时通过 Tooltip
 * 展示 M09 返回的原因。
 */
export default function SyncStatusTag({ sync, status, draftStatus, enabled, showError = true }: SyncStatusTagProps) {
  const view =
    status !== undefined
      ? syncStatusView(status)
      : aggregateJobSyncStatus({ draft_status: draftStatus, enabled, sync })
  const tooltip = showError && sync?.status === 'failed' && sync.error ? sync.error : view.description

  return (
    <Tooltip title={tooltip}>
      <Tag color={view.color} data-testid="sync-status-tag">
        {view.label}
      </Tag>
    </Tooltip>
  )
}
