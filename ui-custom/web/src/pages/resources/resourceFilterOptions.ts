import type { CoverageState } from '../../types/query'

/** 运行状态筛选项（与资源表单 / 列表 badge 同一文案口径） */
export const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'online', label: '在线' },
  { value: 'offline', label: '离线' },
  { value: 'maintenance', label: '维护中' },
]

/** 采集状态筛选项（M09 coverage 派生字段） */
export const MONITOR_STATE_FILTER_OPTIONS: { value: CoverageState; label: string }[] = [
  { value: 'collecting', label: '采集中' },
  { value: 'partial_collecting', label: '部分采集中' },
  { value: 'pending_down', label: '已下发未采到' },
  { value: 'not_monitored', label: '未监控' },
]
