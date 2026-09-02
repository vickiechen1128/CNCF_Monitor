import { Badge, Tooltip } from 'antd'
import type { TargetHealth } from '../types/query'

interface MonitorStatusBadgeProps {
  /** 采集状态三态（collecting 采集中 / pending_down 已下发未采到 / not_monitored 未监控） */
  state: 'collecting' | 'pending_down' | 'not_monitored'
  /** pending_down 附带的最近抓取状态（决策 47-3 Tooltip 提示） */
  health?: TargetHealth | null
  /** pending_down 附带的最近抓取错误（决策 47-3 Tooltip 提示） */
  lastError?: string
}

const META = {
  collecting: { label: '采集中', badge: 'success' as const },
  pending_down: { label: '已下发未采到', badge: 'warning' as const },
  not_monitored: { label: '未监控', badge: 'default' as const },
}

/**
 * 资源「采集状态」三态 badge（决策 47-3，M07 资源列表 row 级）。
 * - collecting     → 绿「采集中」（被 Job 选中且 target up）
 * - pending_down   → 橙「已下发未采到」（被选中但 down/待首次抓取；Tooltip 提示 health/last_error）
 * - not_monitored  → 灰「未监控」（未被任何 Job 选中）
 * 纯展示组件，仅消费 coverage.monitor_state 等字段，不拉取数据。
 */
export function MonitorStatusBadge({ state, health, lastError }: MonitorStatusBadgeProps) {
  const meta = META[state]
  if (state === 'pending_down') {
    const tip =
      lastError || (health ? `health=${health}` : '配置已下发但未采集到数据，请检查采集器安装与网络连通')
    return (
      <Tooltip title={tip}>
        <Badge status={meta.badge} text={meta.label} />
      </Tooltip>
    )
  }
  return <Badge status={meta.badge} text={meta.label} />
}