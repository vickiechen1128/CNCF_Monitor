import { Badge, Tooltip } from 'antd'
import type { TargetHealth } from '../types/query'

interface MonitorStatusBadgeProps {
  state: 'collecting' | 'partial_collecting' | 'pending_down' | 'not_monitored'
  health?: TargetHealth | null
  lastError?: string
}

const META = {
  collecting: { label: '采集中', badge: 'success' as const },
  partial_collecting: { label: '部分采集中', badge: 'warning' as const },
  pending_down: { label: '已下发未采到', badge: 'warning' as const },
  not_monitored: { label: '未监控', badge: 'default' as const },
}

/** 资源实例采集状态：全部成功、部分成功、全部失败和未监控。 */
export function MonitorStatusBadge({ state, health, lastError }: MonitorStatusBadgeProps) {
  const meta = META[state]
  if (state === 'partial_collecting') {
    return (
      <Tooltip title={lastError || '部分 Target 采集成功，部分采集失败，请到监控目标状态页查看明细'}>
        <Badge status={meta.badge} text={meta.label} />
      </Tooltip>
    )
  }
  if (state === 'pending_down') {
    // health=unknown 表示「待首抓 / 变更未确认下发 / 未 reload」（coverage.go 三态判定），
    // 对用户无可执行信息，落到 PRD M07 §11.2 指引文案；仅 down 等有诊断值的状态才展示 health。
    const tip =
      lastError ||
      (health && health !== 'unknown'
        ? `health=${health}`
        : // PRD M07 §11.2 口径：coverage 不感知 M09 下发时序，「含变更未确认下发情形」须显式提示
          '已选中但未采集到数据（含变更未确认下发情形），请检查变更下发状态、采集器安装与网络连通')
    return (
      <Tooltip title={tip}>
        <Badge status={meta.badge} text={meta.label} />
      </Tooltip>
    )
  }
  return <Badge status={meta.badge} text={meta.label} />
}